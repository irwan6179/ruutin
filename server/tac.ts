/**
 * Parent email TAC (temporary access code) lifecycle.
 *
 * This module is deliberately framework-free so the security-critical state
 * transitions can be tested against a local SQLite/D1 shim. Raw six-digit
 * codes only exist while an email message is being assembled; D1 receives an
 * HMAC value bound to the normalized email, purpose, and challenge id.
 */

import type { D1DatabaseLike, D1StatementLike } from "./auth-context";
import { hashOpaqueToken, timingSafeEqual } from "./auth-context";
import { createId, normalizeEmail, normalizeEmailFields, toUtcTimestamp, ValidationError } from "./validation";

export const TAC_PURPOSE = "sign_in" as const;
export const TAC_DIGITS = 6;
export const TAC_TTL_MS = 10 * 60 * 1000;
export const TAC_MAX_ATTEMPTS = 5;
export const TAC_EXPIRY_MS = TAC_TTL_MS;
export const MAX_TAC_ATTEMPTS = TAC_MAX_ATTEMPTS;

export type TacPurpose = typeof TAC_PURPOSE;

export type TacChallenge = {
  id: string;
  emailNormalized: string;
  code: string;
  codeHash: string;
  purpose: TacPurpose;
  expiresAt: string;
  createdAt: string;
};

export type TacFailure =
  | "invalid"
  | "expired"
  | "consumed"
  | "locked"
  | "already_used";

export class TacVerificationError extends Error {
  readonly reason: TacFailure;
  readonly status = 400;

  constructor(reason: TacFailure = "invalid") {
    // One public message for every challenge state prevents lifecycle probing.
    super("That code is invalid or has expired. Request a new code and try again.");
    this.name = "TacVerificationError";
    this.reason = reason;
  }
}

export class TacDeliveryError extends Error {
  readonly status = 500;

  constructor() {
    super("Sign-in email could not be sent");
    this.name = "TacDeliveryError";
  }
}

type HashOptions = Readonly<{
  secret: string;
  challengeId?: string;
  purpose?: string;
}>;

function assertHmacSecret(secret: string): void {
  if (typeof secret !== "string" || secret.trim().length < 16) {
    throw new Error("Authentication cryptography is unavailable");
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** HMAC-SHA-256 using Web Crypto, available in the Sites Worker runtime. */
export async function hmacSha256Base64Url(value: string, secret: string): Promise<string> {
  assertHmacSecret(secret);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Protect a TAC with context binding. The optional arguments keep this helper
 * convenient for focused crypto tests while challenge creation always binds
 * all three fields.
 */
export async function hashTac(
  code: string,
  emailNormalized: string,
  options: HashOptions | string,
): Promise<string> {
  const hashOptions: HashOptions = typeof options === "string" ? { secret: options } : options;
  const purpose = hashOptions.purpose ?? TAC_PURPOSE;
  const challengeId = hashOptions.challengeId ?? "unbound";
  const normalizedEmail = normalizeEmail(emailNormalized);
  const normalizedCode = normalizeTacCode(code);
  return hmacSha256Base64Url(
    `ruutin-tac-v1\u0000${purpose}\u0000${normalizedEmail}\u0000${challengeId}\u0000${normalizedCode}`,
    hashOptions.secret,
  );
}

/** Alias used by callers that prefer an explicit protected-value name. */
export const hashTacValue = hashTac;
export const protectTac = hashTac;

export function normalizeTacCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}$/u.test(value)) {
    throw new ValidationError("code", "code must be six digits");
  }
  return value;
}

/** Generate a uniformly distributed six-digit decimal code. */
export function generateTacCode(): string {
  const maxUint32 = 0x1_0000_0000;
  const range = Math.floor(maxUint32 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= range);
  return String(values[0] % 1_000_000).padStart(TAC_DIGITS, "0");
}

export const generateTac = generateTacCode;

function bindStatement(statement: D1StatementLike, ...values: unknown[]): D1StatementLike {
  return statement.bind(...values);
}

async function runStatement(statement: D1StatementLike): Promise<void> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  await statement.run();
}

/** Serialize replacement in one Worker instance; D1 batch remains the cross-isolate guard. */
const replacementLocks = new WeakMap<D1DatabaseLike, Promise<void>>();

async function withReplacementLock<T>(db: D1DatabaseLike, work: () => Promise<T>): Promise<T> {
  const previous = replacementLocks.get(db) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  replacementLocks.set(db, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (replacementLocks.get(db) === current) replacementLocks.delete(db);
  }
}

async function replaceActiveChallenge(
  db: D1DatabaseLike,
  values: {
    id: string;
    emailNormalized: string;
    codeHash: string;
    expiresAt: string;
    createdAt: string;
  },
): Promise<void> {
  const invalidation = bindStatement(
    db.prepare(
      `UPDATE auth_challenges
       SET consumed_at = ?
       WHERE email_normalized = ? AND purpose = ?
         AND consumed_at IS NULL AND locked_at IS NULL`,
    ),
    values.createdAt,
    values.emailNormalized,
    TAC_PURPOSE,
  );
  const insertion = bindStatement(
    db.prepare(
      `INSERT INTO auth_challenges
         (id, email_normalized, code_hash, purpose, expires_at,
          attempt_count, consumed_at, locked_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?)`,
    ),
    values.id,
    values.emailNormalized,
    values.codeHash,
    TAC_PURPOSE,
    values.expiresAt,
    values.createdAt,
  );

  if (db.batch) {
    await db.batch([invalidation, insertion]);
    return;
  }
  await runStatement(invalidation);
  await runStatement(insertion);
}

export type CreateTacChallengeOptions = Readonly<{
  now?: Date;
  ttlMs?: number;
  id?: string;
  code?: string;
}>;

/**
 * Create a challenge and invalidate all earlier active sign-in challenges for
 * the same normalized email. The returned code is for the email adapter only;
 * callers must not persist or log it.
 */
export async function createTacChallenge(
  db: D1DatabaseLike,
  email: unknown,
  secret: string,
  options: CreateTacChallengeOptions = {},
): Promise<TacChallenge> {
  const emailNormalized = normalizeEmail(email);
  const nowDate = options.now ?? new Date();
  const createdAt = toUtcTimestamp(nowDate);
  const ttlMs = options.ttlMs ?? TAC_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60 * 60 * 1000) {
    throw new ValidationError("ttlMs", "challenge lifetime is invalid");
  }
  const expiresAt = toUtcTimestamp(new Date(nowDate.getTime() + ttlMs));
  const id = options.id ?? createId();
  const code = options.code ?? generateTacCode();
  normalizeTacCode(code);
  const codeHash = await hashTac(code, emailNormalized, {
    secret,
    challengeId: id,
    purpose: TAC_PURPOSE,
  });

  await withReplacementLock(db, () =>
    replaceActiveChallenge(db, {
      id,
      emailNormalized,
      codeHash,
      expiresAt,
      createdAt,
    }),
  );

  return {
    id,
    emailNormalized,
    code,
    codeHash,
    purpose: TAC_PURPOSE,
    expiresAt,
    createdAt,
  };
}

export const createAuthChallenge = createTacChallenge;

type ActiveChallengeRow = {
  id: string;
  emailNormalized: string;
  codeHash: string;
  purpose: string;
  expiresAt: string;
  attemptCount: number;
  consumedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
};

async function readNewestChallenge(
  db: D1DatabaseLike,
  emailNormalized: string,
): Promise<ActiveChallengeRow | null> {
  return db
    .prepare(
      `SELECT id, email_normalized AS emailNormalized, code_hash AS codeHash,
              purpose, expires_at AS expiresAt, attempt_count AS attemptCount,
              consumed_at AS consumedAt, locked_at AS lockedAt,
              created_at AS createdAt
       FROM auth_challenges
       WHERE email_normalized = ? AND purpose = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(emailNormalized, TAC_PURPOSE)
    .first<ActiveChallengeRow>();
}

type UpdatedAttemptRow = { id: string; attemptCount: number; lockedAt: string | null };

async function registerFailedAttempt(
  db: D1DatabaseLike,
  challengeId: string,
  now: string,
): Promise<UpdatedAttemptRow | null> {
  return db
    .prepare(
      `UPDATE auth_challenges
       SET attempt_count = attempt_count + 1,
           locked_at = CASE
             WHEN attempt_count + 1 >= ? THEN ?
             ELSE locked_at
           END
       WHERE id = ? AND purpose = ?
         AND consumed_at IS NULL AND locked_at IS NULL
         AND expires_at > ? AND attempt_count < ?
       RETURNING id, attempt_count AS attemptCount, locked_at AS lockedAt`,
    )
    .bind(TAC_MAX_ATTEMPTS, now, challengeId, TAC_PURPOSE, now, TAC_MAX_ATTEMPTS)
    .first<UpdatedAttemptRow>();
}

async function consumeChallenge(
  db: D1DatabaseLike,
  challengeId: string,
  now: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE auth_challenges
       SET consumed_at = ?
       WHERE id = ? AND purpose = ?
         AND consumed_at IS NULL AND locked_at IS NULL
         AND expires_at > ? AND attempt_count < ?
       RETURNING id`,
    )
    .bind(now, challengeId, TAC_PURPOSE, now, TAC_MAX_ATTEMPTS)
    .first<{ id: string }>();
  return row?.id === challengeId;
}

type SessionMaterial = Readonly<{
  challengeId: string;
  consumedAt: string;
  userId: string;
  email: string;
  emailNormalized: string;
  sessionId: string;
  sessionTokenHash: string;
  sessionExpiresAt: string;
}>;

/**
 * Consume the challenge and persist the account/session as one D1 batch when
 * the Sites binding supports it. SQLite's `changes()` is evaluated between
 * statements in that transaction: an already-consumed challenge makes both
 * subsequent inserts no-ops, so a second verifier cannot create a session.
 */
async function consumeAndPersistSession(
  db: D1DatabaseLike,
  material: SessionMaterial,
): Promise<string | null> {
  if (db.batch) {
    const consume = db
      .prepare(
        `UPDATE auth_challenges
         SET consumed_at = ?
         WHERE id = ? AND purpose = ?
           AND consumed_at IS NULL AND locked_at IS NULL
           AND expires_at > ? AND attempt_count < ?`,
      )
      .bind(
        material.consumedAt,
        material.challengeId,
        TAC_PURPOSE,
        material.consumedAt,
        TAC_MAX_ATTEMPTS,
      );
    const upsertUser = db
      .prepare(
        `INSERT INTO users (id, email, email_normalized, created_at, last_login_at)
         SELECT ?, ?, ?, ?, ?
         WHERE changes() = 1
         ON CONFLICT(email_normalized) DO UPDATE SET last_login_at = excluded.last_login_at`,
      )
      .bind(
        material.userId,
        material.email,
        material.emailNormalized,
        material.consumedAt,
        material.consumedAt,
      );
    const insertSession = db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         SELECT ?, id, ?, ?, NULL, ?, ?
         FROM users
         WHERE email_normalized = ? AND changes() = 1`,
      )
      .bind(
        material.sessionId,
        material.sessionTokenHash,
        material.sessionExpiresAt,
        material.consumedAt,
        material.consumedAt,
        material.emailNormalized,
      );
    await db.batch([consume, upsertUser, insertSession]);
    const row = await db
      .prepare("SELECT user_id AS userId FROM sessions WHERE id = ? LIMIT 1")
      .bind(material.sessionId)
      .first<{ userId: string }>();
    return row?.userId ?? null;
  }

  if (!(await consumeChallenge(db, material.challengeId, material.consumedAt))) return null;
  const user = await db
    .prepare(
      `INSERT INTO users (id, email, email_normalized, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email_normalized) DO UPDATE SET last_login_at = excluded.last_login_at
       RETURNING id`,
    )
    .bind(
      material.userId,
      material.email,
      material.emailNormalized,
      material.consumedAt,
      material.consumedAt,
    )
    .first<{ id: string }>();
  if (!user?.id) throw new Error("User account could not be created");
  await runStatement(
    db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        material.sessionId,
        user.id,
        material.sessionTokenHash,
        material.sessionExpiresAt,
        material.consumedAt,
        material.consumedAt,
      ),
  );
  return user.id;
}

export type VerifyTacResult = {
  userId: string;
  sessionId: string;
  sessionToken: string;
  emailNormalized: string;
};

export type VerifyTacOptions = Readonly<{
  now?: Date;
  sessionTtlMs?: number;
  sessionSecret?: string;
  sessionId?: string;
  sessionToken?: string;
  userId?: string;
}>;

const verificationLocks = new WeakMap<D1DatabaseLike, Map<string, Promise<void>>>();

async function withVerificationLock<T>(
  db: D1DatabaseLike,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let locks = verificationLocks.get(db);
  if (!locks) {
    locks = new Map();
    verificationLocks.set(db, locks);
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
    if (locks.get(key) === current) locks.delete(key);
  }
}

/**
 * Verify the newest challenge. The compare and state transition are separate
 * operations, but the transition is conditional and returns its row: only
 * one concurrent request can consume a challenge. User uniqueness then makes
 * account creation idempotent across devices/Worker isolates.
 */
export async function verifyTac(
  db: D1DatabaseLike,
  email: unknown,
  code: unknown,
  secret: string,
  options: VerifyTacOptions = {},
): Promise<VerifyTacResult> {
  const emailFields = normalizeEmailFields(email);
  const emailNormalized = emailFields.emailNormalized;
  const normalizedCode = normalizeTacCode(code);
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);

  return withVerificationLock(db, emailNormalized, async () => {
    const challenge = await readNewestChallenge(db, emailNormalized);
    if (!challenge) throw new TacVerificationError("invalid");
    if (challenge.consumedAt) throw new TacVerificationError("consumed");
    if (challenge.lockedAt || challenge.attemptCount >= TAC_MAX_ATTEMPTS) {
      throw new TacVerificationError("locked");
    }
    if (challenge.expiresAt <= now) throw new TacVerificationError("expired");

    const expectedHash = await hashTac(normalizedCode, emailNormalized, {
      secret,
      challengeId: challenge.id,
      purpose: TAC_PURPOSE,
    });
    if (!timingSafeEqual(challenge.codeHash, expectedHash)) {
      const updated = await registerFailedAttempt(db, challenge.id, now);
      if (!updated || updated.attemptCount >= TAC_MAX_ATTEMPTS) {
        throw new TacVerificationError("locked");
      }
      throw new TacVerificationError("invalid");
    }

    const userId = options.userId ?? createId();
    const sessionId = options.sessionId ?? createId();
    const sessionToken = options.sessionToken ?? createSessionToken();
    const sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0 || sessionTtlMs > 366 * 24 * 60 * 60 * 1000) {
      throw new ValidationError("sessionTtlMs", "session lifetime is invalid");
    }
    const expiresAt = toUtcTimestamp(new Date(nowDate.getTime() + sessionTtlMs));
    // Parent context resolution uses the shared opaque-token HMAC helper.
    // Keeping the exact representation in one place is important: a valid
    // cookie must resolve on a later request, while the raw token never enters
    // D1.
    const tokenHash = await hashOpaqueToken(sessionToken, options.sessionSecret ?? secret);
    const persistedUserId = await consumeAndPersistSession(db, {
      challengeId: challenge.id,
      consumedAt: now,
      userId,
      email: emailFields.email,
      emailNormalized,
      sessionId,
      sessionTokenHash: tokenHash,
      sessionExpiresAt: expiresAt,
    });
    if (!persistedUserId) throw new TacVerificationError("already_used");

    return {
      userId: persistedUserId,
      sessionId,
      sessionToken,
      emailNormalized,
    };
  });
}

export const verifyAuthChallenge = verifyTac;

/** Session tokens are longer than the TAC and have no meaningful structure. */
export function createSessionToken(): string {
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto?.getRandomValues) throw new Error("Secure session generation is unavailable");
  const bytes = new Uint8Array(32);
  runtimeCrypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Hash a session token with the same HMAC representation used on insert. */
export async function hashSessionToken(token: string, secret: string): Promise<string> {
  return hashOpaqueToken(token, secret);
}
