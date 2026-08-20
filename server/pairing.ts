/**
 * Profile-scoped companion pairing.
 *
 * Pairing has two intentionally different pieces of material: a short code
 * that is easy to read aloud and a high-entropy token used by a QR/deep link.
 * Neither raw value is persisted.  The parent receives the raw values only
 * in the create response so they can be displayed once; the companion sends
 * one of them back to validate the challenge.
 */

import type {
  CompanionContext,
  D1DatabaseLike,
  D1StatementLike,
  ParentContext,
} from "./auth-context";
import { hashOpaqueToken, timingSafeEqual } from "./auth-context";
import { ScopeError } from "./scoped-data";
import { hmacSha256Base64Url } from "./tac";
import {
  createId,
  createOpaqueToken,
  toUtcTimestamp,
  ValidationError,
} from "./validation";
import { validateNickname } from "./profiles";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_CODE_DIGITS = 6;
export const COMPANION_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PAIRING_PURPOSE = "companion_pairing" as const;

export type PairingChallenge = {
  id: string;
  householdId: string;
  profileId: string;
  code: string;
  pairingToken: string;
  codeHash: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type PairingPreview = {
  nickname: string;
  emoji: string;
  expiresAt: string;
};

export type PairingConsumeResult = PairingPreview & {
  deviceId: string;
  deviceToken: string;
  deviceExpiresAt: string;
};

type PairingChallengeRow = {
  id: string;
  householdId: string;
  profileId: string;
  codeHash: string;
  tokenHash: string;
  expiresAt: string;
  attemptCount: number;
  consumedAt: string | null;
  cancelledAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  nickname: string;
  emoji: string;
  ageBand: string | null;
  companionAccessEligible: number;
  archivedAt: string | null;
};

export class PairingVerificationError extends Error {
  readonly status = 400;
  readonly reason:
    | "invalid"
    | "expired"
    | "consumed"
    | "cancelled"
    | "locked"
    | "ineligible";

  constructor(reason: PairingVerificationError["reason"] = "invalid") {
    // All invalid states deliberately share one public message.  The reason
    // is useful to tests/operational code but is never serialized by routes.
    super("That pairing request is invalid or has expired. Ask the parent for a new one.");
    this.name = "PairingVerificationError";
    this.reason = reason;
  }
}

/** Pairing must never consume a challenge outside D1's atomic batch API. */
export class PairingAtomicityError extends Error {
  readonly status = 503;

  constructor() {
    super("Atomic D1 pairing transaction unavailable");
    this.name = "PairingAtomicityError";
  }
}

export type PairingInput = {
  code?: unknown;
  token?: unknown;
};

type CreatePairingOptions = {
  now?: Date;
  ttlMs?: number;
  id?: string;
  code?: string;
  pairingToken?: string;
};

type ConsumePairingOptions = {
  now?: Date;
  deviceId?: string;
  deviceToken?: string;
  deviceLabel?: string;
  /** Session tokens use their own server secret, separate from pairing HMACs. */
  sessionSecret?: string;
};

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  return statement.run();
}

function resultChanges(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as { changes?: unknown; meta?: { changes?: unknown } };
  const changes = record.meta?.changes ?? record.changes;
  if (typeof changes === "number") return changes;
  if (typeof changes === "bigint") return Number(changes);
  return null;
}

function assertParentOwner(context: ParentContext): string {
  if (
    context.kind !== "parent" ||
    context.role !== "parent" ||
    !context.memberships.some(
      (membership) =>
        membership.householdId === context.householdId && membership.role === "parent",
    )
  ) {
    throw new ScopeError();
  }
  return context.householdId;
}

function assertTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60 * 60 * 1000) {
    throw new ValidationError("ttlMs", "pairing lifetime is invalid");
  }
  return ttlMs;
}

export function normalizePairingCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}$/u.test(value)) {
    throw new PairingVerificationError("invalid");
  }
  return value;
}

export const normalizePairingCodeValue = normalizePairingCode;

export function generatePairingCode(): string {
  const maxUint32 = 0x1_0000_0000;
  const range = Math.floor(maxUint32 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= range);
  return String(values[0] % 1_000_000).padStart(PAIRING_CODE_DIGITS, "0");
}

export const generatePairingManualCode = generatePairingCode;

export function normalizePairingToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,512}$/u.test(value)) {
    throw new PairingVerificationError("invalid");
  }
  return value;
}

export async function hashPairingCode(code: unknown, secret: string): Promise<string> {
  const normalized = normalizePairingCode(code);
  return hmacSha256Base64Url(
    `ruutin-pairing-code-v1\u0000${PAIRING_PURPOSE}\u0000${normalized}`,
    secret,
  );
}

export async function hashPairingToken(token: unknown, secret: string): Promise<string> {
  const normalized = normalizePairingToken(token);
  return hmacSha256Base64Url(
    `ruutin-pairing-token-v1\u0000${PAIRING_PURPOSE}\u0000${normalized}`,
    secret,
  );
}

export const protectPairingCode = hashPairingCode;
export const protectPairingToken = hashPairingToken;

function challengeSelect(): string {
  return `SELECT c.id, c.household_id AS householdId,
                 c.child_profile_id AS profileId, c.code_hash AS codeHash,
                 c.token_hash AS tokenHash, c.expires_at AS expiresAt,
                 c.attempt_count AS attemptCount, c.consumed_at AS consumedAt,
                 c.cancelled_at AS cancelledAt, c.locked_at AS lockedAt,
                 c.created_at AS createdAt, p.nickname, p.emoji,
                 p.age_band AS ageBand,
                 p.companion_access_eligible AS companionAccessEligible,
                 p.archived_at AS archivedAt
          FROM pairing_codes AS c
          INNER JOIN child_profiles AS p
            ON p.household_id = c.household_id
           AND p.id = c.child_profile_id`;
}

function assertChallengeEligible(challenge: PairingChallengeRow, now: string): void {
  if (
    challenge.consumedAt ||
    challenge.cancelledAt ||
    challenge.lockedAt ||
    challenge.attemptCount >= PAIRING_MAX_ATTEMPTS
  ) {
    throw new PairingVerificationError(
      challenge.consumedAt ? "consumed" : challenge.cancelledAt ? "cancelled" : "locked",
    );
  }
  if (challenge.expiresAt <= now) throw new PairingVerificationError("expired");
  // Check both the persisted eligibility flag and the age band.  The latter
  // prevents a stale/inconsistent flag from opening an under-13 profile.
  if (
    challenge.archivedAt ||
    challenge.companionAccessEligible !== 1 ||
    challenge.ageBand === "under_13"
  ) {
    throw new PairingVerificationError("ineligible");
  }
}

function parseInput(input: PairingInput): { code: string | null; token: string | null } {
  const hasCode = input.code !== undefined && input.code !== null && input.code !== "";
  const hasToken = input.token !== undefined && input.token !== null && input.token !== "";
  if (!hasCode && !hasToken) throw new PairingVerificationError("invalid");
  const code = hasCode ? normalizePairingCode(input.code) : null;
  const token = hasToken ? normalizePairingToken(input.token) : null;
  return { code, token };
}

async function readChallengeForInput(
  db: D1DatabaseLike,
  input: PairingInput,
  secret: string,
  now = toUtcTimestamp(new Date()),
): Promise<{ challenge: PairingChallengeRow; codeHash: string | null; tokenHash: string | null }> {
  const parsed = parseInput(input);
  const codeHash = parsed.code ? await hashPairingCode(parsed.code, secret) : null;
  const tokenHash = parsed.token ? await hashPairingToken(parsed.token, secret) : null;
  // A token is a stronger, direct lookup key.  When both values are sent,
  // always anchor on that row so an incorrect code still increments its count.
  const lookupHash = tokenHash ?? codeHash;
  const lookupColumn = tokenHash ? "token_hash" : "code_hash";
  const challenge = await db
    .prepare(`${challengeSelect()} WHERE c.${lookupColumn} = ? LIMIT 1`)
    .bind(lookupHash)
    .first<PairingChallengeRow>();
  if (!challenge) throw new PairingVerificationError("invalid");
  assertChallengeEligible(challenge, now);
  if (tokenHash && !timingSafeEqual(challenge.tokenHash, tokenHash)) {
    throw new PairingVerificationError("invalid");
  }
  if (codeHash && !timingSafeEqual(challenge.codeHash, codeHash)) {
    const updated = await db
      .prepare(
        `UPDATE pairing_codes
         SET attempt_count = attempt_count + 1,
             locked_at = CASE WHEN attempt_count + 1 >= ? THEN ? ELSE locked_at END
         WHERE id = ? AND consumed_at IS NULL AND cancelled_at IS NULL
           AND locked_at IS NULL AND expires_at > ? AND attempt_count < ?
         RETURNING attempt_count AS attemptCount, locked_at AS lockedAt`,
      )
      .bind(PAIRING_MAX_ATTEMPTS, now, challenge.id, now, PAIRING_MAX_ATTEMPTS)
      .first<{ attemptCount: number; lockedAt: string | null }>();
    if (!updated || updated.attemptCount >= PAIRING_MAX_ATTEMPTS) {
      throw new PairingVerificationError("locked");
    }
    throw new PairingVerificationError("invalid");
  }
  return { challenge, codeHash, tokenHash };
}

/** Serialize replacement/cancel/consume operations within one Worker isolate. */
const pairingLocks = new WeakMap<D1DatabaseLike, Map<string, Promise<void>>>();

async function withPairingLock<T>(
  db: D1DatabaseLike,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let locks = pairingLocks.get(db);
  if (!locks) {
    locks = new Map();
    pairingLocks.set(db, locks);
  }
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks?.get(key) === current) locks.delete(key);
  }
}

async function insertChallenge(
  db: D1DatabaseLike,
  values: {
    id: string;
    householdId: string;
    profileId: string;
    codeHash: string;
    tokenHash: string;
    expiresAt: string;
    createdByUserId: string;
    createdAt: string;
  },
): Promise<void> {
  const cancel = db
    .prepare(
      `UPDATE pairing_codes
       SET cancelled_at = ?
       WHERE household_id = ? AND child_profile_id = ?
         AND consumed_at IS NULL AND cancelled_at IS NULL AND locked_at IS NULL`,
    )
    .bind(values.createdAt, values.householdId, values.profileId);
  const insert = db
    .prepare(
      `INSERT INTO pairing_codes
         (id, household_id, child_profile_id, code_hash, token_hash,
          expires_at, attempt_count, consumed_at, cancelled_at, locked_at,
          created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      values.id,
      values.householdId,
      values.profileId,
      values.codeHash,
      values.tokenHash,
      values.expiresAt,
      values.createdByUserId,
      values.createdAt,
    );
  if (db.batch) {
    await db.batch([cancel, insert]);
  } else {
    await runStatement(cancel);
    try {
      await runStatement(insert);
    } catch (error) {
      // Minimal local shims do not expose a transaction API.  Sites D1 uses
      // the atomic batch path; best-effort cleanup keeps tests deterministic.
      await runStatement(
        db
          .prepare("DELETE FROM pairing_codes WHERE id = ?")
          .bind(values.id),
      ).catch(() => undefined);
      throw error;
    }
  }
}

export async function createPairingChallenge(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  secret: string,
  options: CreatePairingOptions = {},
): Promise<PairingChallenge> {
  const householdId = assertParentOwner(context);
  if (typeof profileId !== "string" || profileId.length === 0 || profileId.length > 128) {
    throw new ScopeError();
  }
  const profile = await db
    .prepare(
      `SELECT id, household_id AS householdId,
              companion_access_eligible AS companionAccessEligible,
              age_band AS ageBand, archived_at AS archivedAt
       FROM child_profiles
       WHERE id = ? AND household_id = ? LIMIT 1`,
    )
    .bind(profileId, householdId)
    .first<{
      id: string;
      householdId: string;
      companionAccessEligible: number;
      ageBand: string | null;
      archivedAt: string | null;
    }>();
  if (
    !profile ||
    profile.archivedAt ||
    profile.companionAccessEligible !== 1 ||
    profile.ageBand === "under_13"
  ) {
    throw new ScopeError();
  }
  const nowDate = options.now ?? new Date();
  const createdAt = toUtcTimestamp(nowDate);
  const ttlMs = assertTtl(options.ttlMs ?? PAIRING_TTL_MS);
  const expiresAt = toUtcTimestamp(new Date(nowDate.getTime() + ttlMs));
  const id = options.id ?? createId();
  const code = options.code ?? generatePairingCode();
  const pairingToken = options.pairingToken ?? createOpaqueToken(32);
  const codeHash = await hashPairingCode(code, secret);
  const tokenHash = await hashPairingToken(pairingToken, secret);

  await withPairingLock(db, `${householdId}:${profileId}`, () =>
    insertChallenge(db, {
      id,
      householdId,
      profileId,
      codeHash,
      tokenHash,
      expiresAt,
      createdByUserId: context.userId,
      createdAt,
    }),
  );
  return {
    id,
    householdId,
    profileId,
    code,
    pairingToken,
    codeHash,
    tokenHash,
    expiresAt,
    createdAt,
  };
}

export const createPairingCode = createPairingChallenge;

export async function getActivePairingChallengeForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  options: { now?: Date } = {},
): Promise<{ id: string; profileId: string; expiresAt: string } | null> {
  const householdId = assertParentOwner(context);
  if (typeof profileId !== "string" || profileId.length === 0) throw new ScopeError();
  const now = toUtcTimestamp(options.now ?? new Date());
  const row = await db
    .prepare(
      `SELECT id, child_profile_id AS profileId, expires_at AS expiresAt
       FROM pairing_codes
       WHERE child_profile_id = ? AND household_id = ? AND expires_at > ?
         AND consumed_at IS NULL AND cancelled_at IS NULL AND locked_at IS NULL
       LIMIT 1`,
    )
    .bind(profileId, householdId, now)
    .first<{ id: string; profileId: string; expiresAt: string }>();
  return row ?? null;
}

export async function cancelPairingChallenge(
  db: D1DatabaseLike,
  context: ParentContext,
  challengeId: unknown,
  options: { now?: Date } = {},
): Promise<void> {
  const householdId = assertParentOwner(context);
  if (typeof challengeId !== "string" || challengeId.length === 0 || challengeId.length > 128) {
    throw new ScopeError();
  }
  const cancelledAt = toUtcTimestamp(options.now ?? new Date());
  await withPairingLock(db, `challenge:${challengeId}`, async () => {
    const result = await runStatement(
      db
        .prepare(
          `UPDATE pairing_codes
           SET cancelled_at = ?
           WHERE id = ? AND household_id = ? AND created_by_user_id = ?
             AND consumed_at IS NULL AND cancelled_at IS NULL AND locked_at IS NULL`,
        )
        .bind(cancelledAt, challengeId, householdId, context.userId),
    );
    const changes = resultChanges(result);
    if (changes === 0) {
      const existing = await db
        .prepare(
          "SELECT id FROM pairing_codes WHERE id = ? AND household_id = ? AND created_by_user_id = ? LIMIT 1",
        )
        .bind(challengeId, householdId, context.userId)
        .first<{ id: string }>();
      if (!existing) throw new ScopeError();
    }
  });
}

export const cancelPairingCode = cancelPairingChallenge;

export async function previewPairingChallenge(
  db: D1DatabaseLike,
  input: PairingInput,
  secret: string,
  options: { now?: Date } = {},
): Promise<PairingPreview> {
  const now = toUtcTimestamp(options.now ?? new Date());
  const { challenge } = await readChallengeForInput(db, input, secret, now);
  return {
    nickname: challenge.nickname,
    emoji: challenge.emoji,
    expiresAt: challenge.expiresAt,
  };
}

export const verifyPairingChallenge = previewPairingChallenge;
export const verifyPairingCode = previewPairingChallenge;

async function consumeWithBatch(
  db: D1DatabaseLike,
  challenge: PairingChallengeRow,
  input: { codeHash: string | null; tokenHash: string | null },
  values: {
    now: string;
    deviceId: string;
    deviceLabel: string;
    deviceTokenHash: string;
    deviceExpiresAt: string;
  },
): Promise<boolean> {
  if (!db.batch) return false;
  const consume = db
    .prepare(
      `UPDATE pairing_codes
       SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL AND cancelled_at IS NULL
         AND locked_at IS NULL AND expires_at > ? AND attempt_count < ?
         AND (? IS NULL OR token_hash = ?)
         AND (? IS NULL OR code_hash = ?)
       RETURNING id`,
    )
    .bind(
      values.now,
      challenge.id,
      values.now,
      PAIRING_MAX_ATTEMPTS,
      input.tokenHash,
      input.tokenHash,
      input.codeHash,
      input.codeHash,
    );
  // `changes()` is the transaction-local result of the guarded consume.  A
  // racing verifier therefore cannot create a second child device.
  const guardedInsert = db
    .prepare(
      `INSERT INTO child_devices
         (id, household_id, child_profile_id, device_label, token_hash,
          expires_at, created_at, last_seen_at, revoked_at)
       SELECT ?, c.household_id, c.child_profile_id, ?, ?, ?, ?, ?, NULL
       FROM pairing_codes AS c
       INNER JOIN child_profiles AS p
         ON p.household_id = c.household_id AND p.id = c.child_profile_id
       WHERE c.id = ? AND c.consumed_at = ?
         AND p.archived_at IS NULL
         AND p.companion_access_eligible = 1
         AND (p.age_band IS NULL OR p.age_band <> 'under_13')
         AND changes() = 1`,
    )
    .bind(
      values.deviceId,
      values.deviceLabel,
      values.deviceTokenHash,
      values.deviceExpiresAt,
      values.now,
      values.now,
      challenge.id,
      values.now,
    );
  await db.batch([consume, guardedInsert]);
  const created = await db
    .prepare("SELECT id FROM child_devices WHERE id = ? AND token_hash = ? LIMIT 1")
    .bind(values.deviceId, values.deviceTokenHash)
    .first<{ id: string }>();
  return created?.id === values.deviceId;
}

export async function consumePairingChallenge(
  db: D1DatabaseLike,
  input: PairingInput,
  secret: string,
  options: ConsumePairingOptions = {},
): Promise<PairingConsumeResult> {
  const parsed = parseInput(input);
  const codeHash = parsed.code ? await hashPairingCode(parsed.code, secret) : null;
  const tokenHash = parsed.token ? await hashPairingToken(parsed.token, secret) : null;
  const lookupColumn = tokenHash ? "token_hash" : "code_hash";
  const lookupHash = tokenHash ?? codeHash;
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);

  // A challenge transition and device insert must share one D1 transaction.
  // Refusing a non-D1 adapter is safer than consuming a code and then failing
  // before the device row is durable (or allowing a race to create two rows).
  if (!db.batch) throw new PairingAtomicityError();

  return withPairingLock(db, `consume:${lookupColumn}:${lookupHash}`, async () => {
    const { challenge } = await readChallengeForInput(db, parsed, secret, now);
    assertChallengeEligible(challenge, now);
    const deviceId = options.deviceId ?? createId();
    const deviceToken = options.deviceToken ?? createOpaqueToken(32);
    const deviceTokenHash = await hashOpaqueToken(
      deviceToken,
      options.sessionSecret ?? secret,
    );
    const deviceLabel = options.deviceLabel === undefined
      ? "Companion device"
      : validateNickname(options.deviceLabel);
    const deviceExpiresAt = toUtcTimestamp(new Date(nowDate.getTime() + COMPANION_SESSION_TTL_MS));
    const values = { now, deviceId, deviceLabel, deviceTokenHash, deviceExpiresAt };
    const consumed = await consumeWithBatch(db, challenge, { codeHash, tokenHash }, values);
    if (!consumed) throw new PairingVerificationError("consumed");
    return {
      nickname: challenge.nickname,
      emoji: challenge.emoji,
      expiresAt: challenge.expiresAt,
      deviceId,
      deviceToken,
      deviceExpiresAt,
    };
  });
}

export const consumePairingCode = consumePairingChallenge;

/** Type-only helper used by companion route tests to assert profile scope. */
export function companionContextProfile(context: CompanionContext): string {
  return context.profileId;
}
