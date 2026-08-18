import {
  getCookie,
  timingSafeEqual,
  type D1DatabaseLike,
  type ParentContext,
} from "./auth-context";
import { D1RateLimitStore, type RateLimitPolicy } from "./rate-limit";
import {
  enforceTacRequestLimits,
  getRequestSource,
  TAC_EMAIL_POLICY,
  TAC_EMAIL_SOURCE_POLICY,
  TAC_SOURCE_POLICY,
} from "./auth-service";
import {
  DELETE_HOUSEHOLD_TAC_PURPOSE,
  hmacSha256Base64Url,
  TAC_TTL_MS,
  verifyOneTimeTac,
  type TacChallenge,
} from "./tac";
import {
  createId,
  normalizeEmail,
  toUtcTimestamp,
  validateIanaTimezone,
  ValidationError,
} from "./validation";
import { ScopeError } from "./scoped-data";
import type { EmailSender } from "./email-adapter";
import { TacDeliveryError, createTacChallenge } from "./tac";

export const DELETE_REAUTH_COOKIE = "__Host-ruutin_delete_reauth";
export const DELETE_CONFIRMATION = "DELETE";

export class DeletionReauthError extends Error {
  readonly status = 403;

  constructor() {
    super("A fresh confirmation is required");
    this.name = "DeletionReauthError";
  }
}

export class DeletionAtomicityError extends Error {
  readonly status = 503;

  constructor() {
    super("Household deletion is temporarily unavailable");
    this.name = "DeletionAtomicityError";
  }
}

export type ParentSettings = Readonly<{
  account: Readonly<{ email: string }>;
  household: Readonly<{
    id: string;
    name: string;
    timezone: string;
    createdAt: string;
  }>;
}>;

export type HouseholdExport = Readonly<{
  household: Readonly<{
    id: string;
    name: string;
    timezone: string;
    createdAt: string;
  }>;
  profiles: readonly Record<string, unknown>[];
  tasks: readonly Record<string, unknown>[];
  claims: readonly Record<string, unknown>[];
  rewards: readonly Record<string, unknown>[];
  rewardRequests: readonly Record<string, unknown>[];
  ledger: readonly Record<string, unknown>[];
  linkedDevices: readonly Record<string, unknown>[];
}>;

type UserEmailRow = { email: string; emailNormalized: string };

function assertParentOwner(context: ParentContext): void {
  if (context.role !== "parent") throw new DeletionReauthError();
}

async function getParentEmail(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<UserEmailRow> {
  const row = await db
    .prepare(
      `SELECT u.email AS email, u.email_normalized AS emailNormalized
       FROM users AS u
       INNER JOIN household_users AS hu
         ON hu.user_id = u.id
        AND hu.household_id = ?
        AND hu.role = 'parent'
       WHERE u.id = ?
       LIMIT 1`,
    )
    .bind(context.householdId, context.userId)
    .first<UserEmailRow>();
  if (!row) throw new ScopeError();
  return row;
}

export async function getParentSettings(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<ParentSettings> {
  assertParentOwner(context);
  const [user, household] = await Promise.all([
    getParentEmail(db, context),
    db
      .prepare(
        `SELECT id, name, timezone, created_at AS createdAt
         FROM households
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM household_users
             WHERE household_id = households.id
               AND user_id = ?
               AND role = 'parent'
           )
         LIMIT 1`,
      )
      .bind(context.householdId, context.userId)
      .first<ParentSettings["household"]>(),
  ]);
  if (!household) throw new ScopeError();
  return { account: { email: user.email }, household };
}

/**
 * Change only the household's future local-date interpretation. Existing
 * ledger rows are append-only historical facts and are intentionally not
 * rewritten here.
 */
export async function updateParentTimezone(
  db: D1DatabaseLike,
  context: ParentContext,
  timezoneInput: unknown,
): Promise<ParentSettings["household"]> {
  assertParentOwner(context);
  const timezone = validateIanaTimezone(timezoneInput);
  const statement = db
    .prepare(
      `UPDATE households
       SET timezone = ?
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM household_users
           WHERE household_id = households.id
             AND user_id = ?
             AND role = 'parent'
         )`,
    )
    .bind(timezone, context.householdId, context.userId);
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  await statement.run();
  const updated = await db
    .prepare(
      `SELECT id, name, timezone, created_at AS createdAt
       FROM households
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM household_users
           WHERE household_id = households.id
             AND user_id = ?
             AND role = 'parent'
         )
       LIMIT 1`,
    )
    .bind(context.householdId, context.userId)
    .first<ParentSettings["household"]>();
  if (!updated) throw new ScopeError();
  return updated;
}

function rows<T extends Record<string, unknown>>(result: { results?: T[] }): T[] {
  return result.results ?? [];
}

/**
 * Export only household application data. Every child query is independently
 * scoped by the server-resolved household id; auth material and device token
 * hashes are deliberately not selected at all.
 */
export async function exportHouseholdForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  options: { now?: Date } = {},
): Promise<HouseholdExport> {
  assertParentOwner(context);
  void options;
  const household = await db
    .prepare(
      `SELECT id, name, timezone, created_at AS createdAt
       FROM households
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM household_users
           WHERE household_id = households.id
             AND user_id = ?
             AND role = 'parent'
         )
       LIMIT 1`,
    )
    .bind(context.householdId, context.userId)
    .first<ParentSettings["household"]>();
  if (!household) throw new ScopeError();

  const householdId = context.householdId;
  const [profilesResult, tasksResult, claimsResult, rewardsResult, requestsResult, ledgerResult, devicesResult] =
    await Promise.all([
      db
        .prepare(
          `SELECT id, nickname, emoji, age_band AS ageBand,
                  companion_access_eligible AS companionAccessEligible,
                  active_reward_id AS activeRewardId, archived_at AS archivedAt,
                  created_at AS createdAt
           FROM child_profiles
           WHERE household_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, title, emoji, stars,
                  schedule_type AS scheduleType, schedule_data AS scheduleData,
                  position, archived_at AS archivedAt, created_at AS createdAt,
                  updated_at AS updatedAt
           FROM tasks
           WHERE household_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, task_id AS taskId,
                  due_date AS dueDate, submitted_by_type AS submittedByType,
                  status, submitted_at AS submittedAt, resolved_at AS resolvedAt
           FROM task_claims
           WHERE household_id = ?
           ORDER BY submitted_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, title, emoji,
                  star_cost AS starCost, archived_at AS archivedAt,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM rewards
           WHERE household_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, reward_id AS rewardId,
                  status, requested_at AS requestedAt, resolved_at AS resolvedAt
           FROM reward_requests
           WHERE household_id = ?
           ORDER BY requested_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, event_type AS eventType,
                  stars_delta AS starsDelta, source_type AS sourceType,
                  source_id AS sourceId, reason, local_date AS localDate,
                  created_at AS createdAt
           FROM point_ledger
           WHERE household_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, child_profile_id AS profileId, device_label AS deviceLabel,
                  expires_at AS expiresAt, created_at AS createdAt,
                  last_seen_at AS lastSeenAt, revoked_at AS revokedAt
           FROM child_devices
           WHERE household_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(householdId)
        .all<Record<string, unknown>>(),
    ]);

  return {
    household,
    profiles: rows(profilesResult),
    tasks: rows(tasksResult),
    claims: rows(claimsResult),
    rewards: rows(rewardsResult),
    rewardRequests: rows(requestsResult),
    ledger: rows(ledgerResult),
    linkedDevices: rows(devicesResult),
  };
}

export function buildDeletionTacEmail(code: string, to = "") {
  return {
    to,
    subject: "Your Ruutin household deletion code",
    text: [
      "Your Ruutin household deletion confirmation code is:",
      "",
      code,
      "",
      "It expires in 10 minutes and can only be used once.",
      "If you did not request household deletion, you can safely ignore this email.",
    ].join("\n"),
  };
}

export type DeletionTacRequestDependencies = Readonly<{
  db: D1DatabaseLike;
  authHmacSecret: string;
  emailSender: EmailSender;
  rateLimitStore?: import("./rate-limit").RateLimitStore;
}>;

export async function requestHouseholdDeletionTac(
  dependencies: DeletionTacRequestDependencies,
  context: ParentContext,
  request: Request,
  options: {
    now?: Date;
    emailPolicy?: RateLimitPolicy;
    emailSourcePolicy?: RateLimitPolicy;
    sourcePolicy?: RateLimitPolicy;
    challengeCode?: string;
  } = {},
): Promise<TacChallenge> {
  assertParentOwner(context);
  const user = await getParentEmail(dependencies.db, context);
  const emailNormalized = normalizeEmail(user.emailNormalized);
  const rateLimitStore = dependencies.rateLimitStore ?? new D1RateLimitStore(dependencies.db);
  await enforceTacRequestLimits(
    { rateLimitStore },
    emailNormalized,
    getRequestSource(request.headers),
    {
      now: options.now,
      emailPolicy: options.emailPolicy ?? TAC_EMAIL_POLICY,
      emailSourcePolicy: options.emailSourcePolicy ?? TAC_EMAIL_SOURCE_POLICY,
      sourcePolicy: options.sourcePolicy ?? TAC_SOURCE_POLICY,
      namespace: "delete-household",
    },
  );
  const challenge = await createTacChallenge(
    dependencies.db,
    emailNormalized,
    dependencies.authHmacSecret,
    {
      now: options.now,
      code: options.challengeCode,
      purpose: DELETE_HOUSEHOLD_TAC_PURPOSE,
    },
  );
  try {
    await dependencies.emailSender.send({ ...buildDeletionTacEmail(challenge.code), to: emailNormalized });
  } catch {
    throw new TacDeliveryError();
  }
  return challenge;
}

export async function consumeHouseholdDeletionTac(
  db: D1DatabaseLike,
  context: ParentContext,
  code: unknown,
  authHmacSecret: string,
  options: { now?: Date } = {},
): Promise<Readonly<{ challengeId: string; expiresAt: string }>> {
  assertParentOwner(context);
  const user = await getParentEmail(db, context);
  const result = await verifyOneTimeTac(
    db,
    user.emailNormalized,
    code,
    authHmacSecret,
    { now: options.now, purpose: DELETE_HOUSEHOLD_TAC_PURPOSE },
  );
  return {
    challengeId: result.challengeId,
    expiresAt: toUtcTimestamp(new Date(result.consumedAt).getTime() + TAC_TTL_MS),
  };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

type DeletionMarkerPayload = Readonly<{
  v: 1;
  userId: string;
  householdId: string;
  sessionId: string;
  challengeId: string;
  expiresAt: string;
}>;

export async function issueDeletionReauthCookie(
  context: ParentContext,
  challengeId: string,
  authHmacSecret: string,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<string> {
  const nowDate = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? TAC_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > TAC_TTL_MS) {
    throw new ValidationError("ttlMs", "reauth lifetime is invalid");
  }
  const payload: DeletionMarkerPayload = {
    v: 1,
    userId: context.userId,
    householdId: context.householdId,
    sessionId: context.sessionId,
    challengeId,
    expiresAt: toUtcTimestamp(new Date(nowDate.getTime() + ttlMs)),
  };
  const payloadEncoded = encodeBase64Url(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(`ruutin-delete-reauth-v1\u0000${payloadEncoded}`, authHmacSecret);
  return encodeBase64Url(`${payloadEncoded}.${signature}`);
}

export function serializeDeletionReauthCookie(value: string, maxAgeSeconds = TAC_TTL_MS / 1000): string {
  if (!/^[A-Za-z0-9_-]{32,512}$/u.test(value)) throw new Error("Invalid deletion reauth cookie value");
  return [
    `${DELETE_REAUTH_COOKIE}=${value}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

export function clearDeletionReauthCookie(): string {
  return serializeDeletionReauthCookie(createId().replaceAll("-", ""), 0);
}

async function readDeletionMarker(
  request: Request,
  context: ParentContext,
  authHmacSecret: string,
  now: Date,
): Promise<DeletionMarkerPayload> {
  const value = getCookie(request, DELETE_REAUTH_COOKIE);
  if (!value) throw new DeletionReauthError();
  const decoded = decodeBase64Url(value);
  if (!decoded) throw new DeletionReauthError();
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) throw new DeletionReauthError();
  const payloadEncoded = decoded.slice(0, separator);
  const signature = decoded.slice(separator + 1);
  const expected = await hmacSha256Base64Url(`ruutin-delete-reauth-v1\u0000${payloadEncoded}`, authHmacSecret);
  if (!timingSafeEqual(signature, expected)) throw new DeletionReauthError();
  const payloadDecoded = decodeBase64Url(payloadEncoded);
  if (!payloadDecoded) throw new DeletionReauthError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadDecoded);
  } catch {
    throw new DeletionReauthError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new DeletionReauthError();
  const marker = parsed as Partial<DeletionMarkerPayload>;
  const expiry = typeof marker.expiresAt === "string" ? new Date(marker.expiresAt) : new Date(NaN);
  if (
    marker.v !== 1 ||
    marker.userId !== context.userId ||
    marker.householdId !== context.householdId ||
    marker.sessionId !== context.sessionId ||
    typeof marker.challengeId !== "string" ||
    marker.challengeId.length === 0 ||
    Number.isNaN(expiry.getTime()) ||
    expiry.getTime() <= now.getTime()
  ) {
    throw new DeletionReauthError();
  }
  return marker as DeletionMarkerPayload;
}

/**
 * Permanently remove one household. The signed marker is checked against the
 * freshly resolved session before the atomic batch. No fallback is allowed:
 * multi-statement revocation and deletion must be a D1 transaction.
 */
export async function deleteHouseholdForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  request: Request,
  authHmacSecret: string,
  confirmation: unknown,
  options: { now?: Date } = {},
): Promise<void> {
  assertParentOwner(context);
  if (confirmation !== DELETE_CONFIRMATION) {
    throw new ValidationError("confirmation", "confirmation is required");
  }
  const nowDate = options.now ?? new Date();
  await readDeletionMarker(request, context, authHmacSecret, nowDate);
  if (!db.batch) throw new DeletionAtomicityError();

  const household = await db
    .prepare("SELECT id FROM households WHERE id = ? LIMIT 1")
    .bind(context.householdId)
    .first<{ id: string }>();
  if (!household) throw new ScopeError();
  const revokedAt = toUtcTimestamp(nowDate);
  const revokeParentSessions = db
    .prepare(
      `UPDATE sessions
       SET revoked_at = ?
       WHERE user_id IN (
         SELECT user_id FROM household_users WHERE household_id = ?
       )
         AND revoked_at IS NULL`,
    )
    .bind(revokedAt, context.householdId);
  const revokeCompanionDevices = db
    .prepare(
      `UPDATE child_devices
       SET revoked_at = ?
       WHERE household_id = ? AND revoked_at IS NULL`,
    )
    .bind(revokedAt, context.householdId);
  const removeHousehold = db
    .prepare("DELETE FROM households WHERE id = ?")
    .bind(context.householdId);
  try {
    await db.batch([revokeParentSessions, revokeCompanionDevices, removeHousehold]);
  } catch {
    throw new DeletionAtomicityError();
  }
}
