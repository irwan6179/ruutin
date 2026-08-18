import {
  createOpaqueToken,
  toUtcTimestamp,
  type HouseholdRole,
} from "./validation";

/**
 * Cookie names use the __Host- prefix so a parent or companion session cannot
 * be planted for a sibling subdomain.  Both cookies are host-only, Secure,
 * HttpOnly, and scoped to the root path.
 */
export const PARENT_SESSION_COOKIE = "__Host-ruutin_parent_session";
export const COMPANION_SESSION_COOKIE = "__Host-ruutin_companion_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type D1QueryResult<T> = {
  results?: T[];
  success?: boolean;
};

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1QueryResult<T>>;
  run?(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

export type ParentMembership = {
  householdId: string;
  role: HouseholdRole;
};

export type ParentContext = {
  kind: "parent";
  sessionId: string;
  tokenHash: string;
  userId: string;
  householdId: string;
  role: HouseholdRole;
  memberships: readonly ParentMembership[];
  expiresAt: string;
};

export type CompanionContext = {
  kind: "companion";
  deviceId: string;
  tokenHash: string;
  householdId: string;
  profileId: string;
  profile: {
    nickname: string;
    emoji: string;
  };
  expiresAt: string | null;
};

export class AuthorizationError extends Error {
  readonly status = 401;

  constructor() {
    // Never include whether a user, session, household, or profile existed.
    super("Authentication required");
    this.name = "AuthorizationError";
  }
}

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u;

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 8192) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return SAFE_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

/** HMAC-SHA-256 protects even accidentally short or future token values. */
export async function hashOpaqueToken(
  token: string,
  secret: string,
): Promise<string> {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 512 ||
    secret.trim().length < 16
  ) {
    throw new Error("Invalid token hashing input");
  }
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
    new TextEncoder().encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Constant-time comparison for protected hashes and CSRF values. */
export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function readMemberships(
  db: D1DatabaseLike,
  userId: string,
): Promise<ParentMembership[]> {
  const result = await db
    .prepare(
      `SELECT household_id AS householdId, role
       FROM household_users
       WHERE user_id = ? AND role = 'parent'
       ORDER BY created_at ASC, household_id ASC`,
    )
    .bind(userId)
    .all<ParentMembership>();
  return (result.results ?? []).filter(
    (membership): membership is ParentMembership =>
      typeof membership.householdId === "string" &&
      (membership.role === "parent" || membership.role === "caregiver"),
  );
}

/** Resolve parent scope solely from the secure cookie and D1 membership. */
export async function resolveParentContext(
  request: Request,
  db: D1DatabaseLike,
  options: { sessionSecret: string; now?: Date } ,
): Promise<ParentContext | null> {
  const rawToken = getCookie(request, PARENT_SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashOpaqueToken(rawToken, options.sessionSecret);
  const now = toUtcTimestamp(options.now ?? new Date());
  const session = await db
    .prepare(
      `SELECT id AS sessionId, user_id AS userId, token_hash AS tokenHash,
              expires_at AS expiresAt
       FROM sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<{
      sessionId: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
    }>();
  if (!session || !timingSafeEqual(session.tokenHash, tokenHash)) return null;

  const memberships = await readMemberships(db, session.userId);
  if (memberships.length === 0) return null;

  // MVP presents one household.  If a future UI supports switching, it must
  // add a server-maintained active-household choice rather than trusting a
  // URL/body household ID.  The context still returns every verified member.
  const primary = memberships[0];
  return {
    kind: "parent",
    sessionId: session.sessionId,
    tokenHash,
    userId: session.userId,
    householdId: primary.householdId,
    role: primary.role,
    memberships,
    expiresAt: session.expiresAt,
  };
}

export async function requireParentContext(
  request: Request,
  db: D1DatabaseLike,
  options: { sessionSecret: string; now?: Date },
): Promise<ParentContext> {
  const context = await resolveParentContext(request, db, options);
  if (!context) throw new AuthorizationError();
  return context;
}

/** Resolve one permanently profile-scoped companion device context. */
export async function resolveCompanionContext(
  request: Request,
  db: D1DatabaseLike,
  options: { sessionSecret: string; now?: Date },
): Promise<CompanionContext | null> {
  const rawToken = getCookie(request, COMPANION_SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashOpaqueToken(rawToken, options.sessionSecret);
  const now = toUtcTimestamp(options.now ?? new Date());
  const device = await db
    .prepare(
      `SELECT d.id AS deviceId, d.token_hash AS tokenHash,
              d.household_id AS householdId, d.child_profile_id AS profileId,
              d.expires_at AS expiresAt, p.nickname AS nickname, p.emoji AS emoji
       FROM child_devices AS d
       INNER JOIN child_profiles AS p
         ON p.household_id = d.household_id
        AND p.id = d.child_profile_id
       WHERE d.token_hash = ?
         AND d.revoked_at IS NULL
         AND (d.expires_at IS NULL OR d.expires_at > ?)
         AND p.archived_at IS NULL
         AND p.companion_access_eligible = 1
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<{
      deviceId: string;
      tokenHash: string;
      householdId: string;
      profileId: string;
      expiresAt: string | null;
      nickname: string;
      emoji: string;
    }>();
  if (!device || !timingSafeEqual(device.tokenHash, tokenHash)) return null;
  return {
    kind: "companion",
    deviceId: device.deviceId,
    tokenHash,
    householdId: device.householdId,
    profileId: device.profileId,
    profile: { nickname: device.nickname, emoji: device.emoji },
    expiresAt: device.expiresAt,
  };
}

export async function requireCompanionContext(
  request: Request,
  db: D1DatabaseLike,
  options: { sessionSecret: string; now?: Date },
): Promise<CompanionContext> {
  const context = await resolveCompanionContext(request, db, options);
  if (!context) throw new AuthorizationError();
  return context;
}

/** Throttle last-seen writes so a read-heavy screen does not write every request. */
export async function touchSessionIfDue(
  db: D1DatabaseLike,
  context: ParentContext | CompanionContext,
  options: { now?: Date; throttleMs?: number } = {},
): Promise<void> {
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  const threshold = new Date(nowDate.getTime() - (options.throttleMs ?? 5 * 60 * 1000));
  const table = context.kind === "parent" ? "sessions" : "child_devices";
  await db
    .prepare(
      `UPDATE ${table}
       SET last_seen_at = ?
       WHERE id = ?
         AND token_hash = ?
         AND last_seen_at < ?
         AND revoked_at IS NULL`,
    )
    .bind(now, context.kind === "parent" ? context.sessionId : context.deviceId, context.tokenHash, toUtcTimestamp(threshold))
    .run?.();
}

export function serializeSessionCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; httpOnly?: boolean; sameSite?: "Strict" | "Lax" } = {},
): string {
  if (!SAFE_TOKEN_PATTERN.test(value)) throw new Error("Invalid session cookie value");
  const maxAge = options.maxAgeSeconds ?? SESSION_COOKIE_MAX_AGE_SECONDS;
  const sameSite = options.sameSite ?? "Lax";
  return [
    `${name}=${value}`,
    "Path=/",
    "Secure",
    options.httpOnly === false ? "" : "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(name: string): string {
  return serializeSessionCookie(name, createOpaqueToken(16), {
    maxAgeSeconds: 0,
  });
}
