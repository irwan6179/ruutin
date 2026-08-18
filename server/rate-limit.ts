import type { D1DatabaseLike } from "./auth-context";

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitStore {
  get(key: string, now: Date): Promise<{ count: number; resetAt: Date } | null>;
  set(key: string, value: { count: number; resetAt: Date }, now: Date): Promise<void>;
  consumeAtomic?(
    key: string,
    policy: RateLimitPolicy,
    now: Date,
  ): Promise<{ count: number; resetAt: Date }>;
}

const rateLimitLocks = new WeakMap<RateLimitStore, Map<string, Promise<void>>>();

async function withKeyLock<T>(
  store: RateLimitStore,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let locks = rateLimitLocks.get(store);
  if (!locks) {
    locks = new Map();
    rateLimitLocks.set(store, locks);
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

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly values = new Map<string, { count: number; resetAt: Date }>();

  async get(key: string, now: Date) {
    const value = this.values.get(key);
    if (!value || value.resetAt.getTime() <= now.getTime()) {
      this.values.delete(key);
      return null;
    }
    return { count: value.count, resetAt: new Date(value.resetAt.getTime()) };
  }

  async set(key: string, value: { count: number; resetAt: Date }) {
    this.values.set(key, {
      count: value.count,
      resetAt: new Date(value.resetAt.getTime()),
    });
  }
}

export class D1RateLimitStore implements RateLimitStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(key: string, now: Date) {
    const row = await this.db
      .prepare(
        `SELECT count, expires_at AS expiresAt
         FROM rate_limit_buckets
         WHERE key = ? AND expires_at > ?
         LIMIT 1`,
      )
      .bind(key, now.toISOString())
      .first<{ count: number; expiresAt: string }>();
    if (!row) return null;
    const resetAt = new Date(row.expiresAt);
    if (Number.isNaN(resetAt.getTime())) return null;
    return { count: Number(row.count), resetAt };
  }

  async set(key: string, value: { count: number; resetAt: Date }, now: Date) {
    const resetAt = value.resetAt.toISOString();
    const timestamp = now.toISOString();
    await this.db
      .prepare(
        `INSERT INTO rate_limit_buckets
           (key, window_started_at, count, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = excluded.count,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .bind(key, timestamp, value.count, resetAt, timestamp)
      .run?.();
  }

  /**
   * D1's single upsert statement is the cross-isolate race guard.  The
   * in-process keyed lock below still keeps tests and one Worker instance
   * tidy, but this statement is the authoritative counter increment.
   */
  async consumeAtomic(key: string, policy: RateLimitPolicy, now: Date) {
    const timestamp = now.toISOString();
    const resetAt = new Date(now.getTime() + policy.windowMs).toISOString();
    const row = await this.db
      .prepare(
        `INSERT INTO rate_limit_buckets
           (key, window_started_at, count, expires_at, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE
             WHEN rate_limit_buckets.expires_at <= excluded.window_started_at THEN 1
             ELSE MIN(rate_limit_buckets.count + 1, ?)
           END,
           window_started_at = CASE
             WHEN rate_limit_buckets.expires_at <= excluded.window_started_at THEN excluded.window_started_at
             ELSE rate_limit_buckets.window_started_at
           END,
           expires_at = CASE
             WHEN rate_limit_buckets.expires_at <= excluded.window_started_at THEN excluded.expires_at
             ELSE rate_limit_buckets.expires_at
           END,
           updated_at = excluded.updated_at
         RETURNING count, expires_at AS expiresAt`,
      )
      .bind(key, timestamp, resetAt, timestamp, policy.limit + 1)
      .first<{ count: number; expiresAt: string }>();
    if (!row) throw new Error("Rate-limit counter unavailable");
    const resultResetAt = new Date(row.expiresAt);
    if (Number.isNaN(resultResetAt.getTime())) throw new Error("Rate-limit counter invalid");
    return { count: Number(row.count), resetAt: resultResetAt };
  }
}

function assertPolicy(policy: RateLimitPolicy): void {
  if (
    !Number.isInteger(policy.limit) ||
    policy.limit < 1 ||
    !Number.isFinite(policy.windowMs) ||
    policy.windowMs <= 0
  ) {
    throw new Error("Invalid rate-limit policy");
  }
}

export async function consumeRateLimit(
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
  options: { now?: Date } = {},
): Promise<RateLimitDecision> {
  return withKeyLock(store, key, async () => {
    assertPolicy(policy);
    const now = options.now ?? new Date();
    if (store.consumeAtomic) {
      const atomic = await store.consumeAtomic(key, policy, now);
      const allowed = atomic.count <= policy.limit;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((atomic.resetAt.getTime() - now.getTime()) / 1000),
      );
      return {
        allowed,
        count: atomic.count,
        remaining: Math.max(0, policy.limit - atomic.count),
        resetAt: atomic.resetAt,
        retryAfterSeconds,
      };
    }
    const current = await store.get(key, now);
    const resetAt = current?.resetAt ?? new Date(now.getTime() + policy.windowMs);
    const count = Math.min((current?.count ?? 0) + 1, policy.limit + 1);
    const allowed = count <= policy.limit;
    await store.set(key, { count, resetAt }, now);
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
    return {
      allowed,
      count,
      remaining: Math.max(0, policy.limit - count),
      resetAt,
      retryAfterSeconds,
    };
  });
}

export async function enforceRateLimit(
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
  options: { now?: Date } = {},
): Promise<RateLimitDecision> {
  const decision = await consumeRateLimit(store, key, policy, options);
  if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
  return decision;
}

/** Normalize all identity/source components before composing a rate-limit key. */
export function rateLimitKey(scope: string, ...parts: unknown[]): string {
  const normalized = [scope, ...parts].map((part) =>
    String(part ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US"),
  );
  return normalized.map((part) => `${part.length}:${part}`).join("|");
}

export function emailRateLimitKey(email: unknown, requestSource: unknown): string {
  return rateLimitKey("email-tac", email, requestSource);
}

export function sourceRateLimitKey(requestSource: unknown): string {
  return rateLimitKey("source-tac", requestSource);
}
