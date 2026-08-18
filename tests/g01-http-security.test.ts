import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1DatabaseLike, D1StatementLike } from "../server/auth-context";
import {
  applyPrivateHeaders,
  assertCsrf,
  assertSameOrigin,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  issueCsrfToken,
} from "../server/http-security";
import { publicErrorResponse, sanitizedLogContext } from "../server/error-safety";
import { RateLimitError } from "../server/rate-limit";
import { ValidationError } from "../server/validation";
import {
  consumeRateLimit,
  D1RateLimitStore,
  emailRateLimitKey,
  enforceRateLimit,
  MemoryRateLimitStore,
} from "../server/rate-limit";

class SqliteD1Shim implements D1DatabaseLike {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string): D1StatementLike {
    const statement = this.database.prepare(query);
    const bind = (values: SQLInputValue[]): D1StatementLike => ({
      bind: (...nextValues: unknown[]) => bind(nextValues as SQLInputValue[]),
      first: async <T>() => statement.get(...values) as T | null,
      all: async <T>() => ({ results: statement.all(...values) as T[] }),
      run: async () => statement.run(...values),
    });
    return bind([]);
  }
}

test("state-changing requests require same-origin double-submit CSRF", () => {
  const { token, cookie } = issueCsrfToken();
  const good = new Request("https://ruutin.example/app/profile", {
    method: "POST",
    headers: {
      Origin: "https://ruutin.example",
      Cookie: cookie,
      [CSRF_HEADER_NAME]: token,
    },
  });
  assert.doesNotThrow(() => assertCsrf(good));
  assert.doesNotThrow(() => assertSameOrigin(good));

  const wrongOrigin = new Request(good, {
    headers: {
      Origin: "https://attacker.example",
      Cookie: cookie,
      [CSRF_HEADER_NAME]: token,
    },
  });
  assert.throws(() => assertCsrf(wrongOrigin), /origin|verified/i);

  const wrongToken = new Request(good, {
    headers: {
      Origin: "https://ruutin.example",
      Cookie: cookie,
      [CSRF_HEADER_NAME]: `${token}x`,
    },
  });
  assert.throws(() => assertCsrf(wrongToken), /could not be verified/i);

  const missingOrigin = new Request(good, {
    headers: {
      Cookie: cookie,
      [CSRF_HEADER_NAME]: token,
    },
  });
  assert.throws(() => assertCsrf(missingOrigin), /origin|verified/i);

  const get = new Request(good, { method: "GET" });
  assert.doesNotThrow(() => assertCsrf(get));
  assert.match(cookie, new RegExp(`^${CSRF_COOKIE_NAME}=`));
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});

test("private responses cannot be stored in caches", async () => {
  const response = applyPrivateHeaders(new Response(JSON.stringify({ ok: true })));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { ok: true });
});

test("public error mapping omits internal causes and sensitive input", async () => {
  const response = publicErrorResponse(new Error("D1 SQL includes a TAC and parent@example.test"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "server_error",
    message: "Something went wrong",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  const rateResponse = publicErrorResponse(new RateLimitError(17));
  assert.equal(rateResponse.headers.get("retry-after"), "17");
  assert.equal(publicErrorResponse(new ValidationError("email", "email is malformed")).status, 400);
  assert.deepEqual(sanitizedLogContext(new Error("raw secret")), {
    errorType: "Error",
    status: 500,
    code: "server_error",
  });
});

test("rate limits are bounded, reset at the policy boundary, and normalize identities", async () => {
  const store = new MemoryRateLimitStore();
  const policy = { limit: 2, windowMs: 60_000 };
  const start = new Date("2026-01-01T00:00:00.000Z");
  const keyA = emailRateLimitKey(" Parent@Example.TEST ", " 203.0.113.4 ");
  const keyB = emailRateLimitKey("parent@example.test", "203.0.113.4");
  assert.equal(keyA, keyB);
  assert.equal((await consumeRateLimit(store, keyA, policy, { now: start })).allowed, true);
  assert.equal((await consumeRateLimit(store, keyB, policy, { now: new Date(start.getTime() + 1) })).allowed, true);
  const blocked = await consumeRateLimit(store, keyA, policy, { now: new Date(start.getTime() + 2) });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  await assert.rejects(
    enforceRateLimit(store, keyA, policy, { now: new Date(start.getTime() + 3) }),
    /Too many requests/,
  );
  const reset = await consumeRateLimit(store, keyA, policy, {
    now: new Date(start.getTime() + 60_001),
  });
  assert.equal(reset.allowed, true);
  assert.equal(reset.count, 1);

  const concurrentStore = new MemoryRateLimitStore();
  const decisions = await Promise.all(
    Array.from({ length: 5 }, () =>
      consumeRateLimit(concurrentStore, "same-key", policy, { now: start }),
    ),
  );
  assert.equal(decisions.filter((decision) => decision.allowed).length, 2);
  assert.equal(Math.max(...decisions.map((decision) => decision.count)), 3);
});

test("D1 rate-limit consumption updates and returns the counter atomically", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE rate_limit_buckets (
    key TEXT PRIMARY KEY NOT NULL,
    window_started_at TEXT NOT NULL,
    count INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const store = new D1RateLimitStore(new SqliteD1Shim(database));
  const policy = { limit: 2, windowMs: 60_000 };
  const start = new Date("2026-01-01T00:00:00.000Z");

  const first = await consumeRateLimit(store, "d1-key", policy, { now: start });
  const second = await consumeRateLimit(store, "d1-key", policy, { now: start });
  const third = await consumeRateLimit(store, "d1-key", policy, { now: start });

  assert.deepEqual(
    [first.count, second.count, third.count],
    [1, 2, 3],
  );
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(
    database.prepare("SELECT count FROM rate_limit_buckets WHERE key = ?").get("d1-key")
      ?.count,
    3,
  );
});
