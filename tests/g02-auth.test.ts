import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  requestSourceFromHeaders,
} from "../server/auth-service";
import {
  D1DatabaseLike,
  D1StatementLike,
  PARENT_SESSION_COOKIE,
  resolveParentContext,
} from "../server/auth-context";
import {
  handleParentSignOut,
  handleTacRequest,
  handleTacRequestBootstrap,
  handleTacVerify,
  type AuthRouteDependencies,
} from "../server/auth-routes";
import { DeterministicEmailAdapter } from "../server/email-adapter";
import { MemoryRateLimitStore } from "../server/rate-limit";
import {
  createTacChallenge,
  hashTac,
  verifyTac,
  TacVerificationError,
} from "../server/tac";

const AUTH_SECRET = "auth-secret-for-tests-0123456789";
const SESSION_SECRET = "session-secret-for-tests-0123456789";
const MIGRATIONS = [
  "drizzle/0000_careless_colossus.sql",
  "drizzle/0001_cool_lake.sql",
  "drizzle/0002_old_ben_parker.sql",
  "drizzle/0003_g01_integrity.sql",
] as const;

class SqliteD1Shim implements D1DatabaseLike {
  constructor(readonly database: DatabaseSync) {}

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

class BatchedSqliteD1Shim extends SqliteD1Shim {
  async batch(statements: readonly unknown[]): Promise<unknown[]> {
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) {
        const prepared = statement as D1StatementLike;
        await prepared.run?.();
      }
      this.database.exec("COMMIT");
      return [];
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase(): { database: DatabaseSync; db: SqliteD1Shim } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) {
    database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return { database, db: new SqliteD1Shim(database) };
}

function createBatchedDatabase(): { database: DatabaseSync; db: BatchedSqliteD1Shim } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) {
    database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return { database, db: new BatchedSqliteD1Shim(database) };
}

function csrfRequest(
  method: string,
  url: string,
  cookie: string,
  token: string,
  body?: unknown,
): Request {
  return new Request(url, {
    method,
    headers: {
      Origin: new URL(url).origin,
      Cookie: cookie,
      "x-ruutin-csrf": token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeDependencies(db: SqliteD1Shim, emailSender: DeterministicEmailAdapter): AuthRouteDependencies {
  return {
    db,
    authHmacSecret: AUTH_SECRET,
    sessionSecret: SESSION_SECRET,
    emailSender,
    now: new Date("2026-08-18T00:00:00.000Z"),
  };
}

test("TAC is HMAC-protected, six digits, expires, and prior active code is invalidated", async () => {
  const { database, db } = createDatabase();
  const first = await createTacChallenge(db, " Parent@Example.TEST ", AUTH_SECRET, {
    now: new Date("2026-01-01T00:00:00.000Z"),
    code: "123456",
  });
  assert.equal(first.emailNormalized, "parent@example.test");
  assert.match(first.code, /^\d{6}$/);
  assert.notEqual(first.codeHash, first.code);
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM auth_challenges WHERE code_hash = ?").get(first.code)?.count,
    0,
  );

  const second = await createTacChallenge(db, "parent@example.test", AUTH_SECRET, {
    now: new Date("2026-01-01T00:01:00.000Z"),
    code: "654321",
  });
  assert.equal(
    database.prepare("SELECT consumed_at FROM auth_challenges WHERE id = ?").get(first.id)?.consumed_at,
    "2026-01-01T00:01:00.000Z",
  );
  await assert.rejects(
    verifyTac(db, "parent@example.test", first.code, AUTH_SECRET, {
      now: new Date("2026-01-01T00:02:00.000Z"),
    }),
    (error: unknown) => error instanceof TacVerificationError,
  );
  const result = await verifyTac(db, "parent@example.test", second.code, AUTH_SECRET, {
    now: new Date("2026-01-01T00:02:00.000Z"),
    sessionSecret: SESSION_SECRET,
  });
  assert.equal(result.emailNormalized, "parent@example.test");
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(database.prepare("SELECT count(*) AS count FROM users").get()?.count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
  assert.notEqual(
    database.prepare("SELECT token_hash FROM sessions WHERE id = ?").get(result.sessionId)?.token_hash,
    result.sessionToken,
  );
});

test("expired and reused TACs fail, while exactly five wrong attempts lock the challenge", async () => {
  const { database, db } = createDatabase();
  const expired = await createTacChallenge(db, "expired@example.test", AUTH_SECRET, {
    now: new Date("2026-01-01T00:00:00.000Z"),
    code: "111111",
  });
  await assert.rejects(
    verifyTac(db, expired.emailNormalized, expired.code, AUTH_SECRET, {
      now: new Date("2026-01-01T00:10:00.001Z"),
    }),
    TacVerificationError,
  );

  const locked = await createTacChallenge(db, "locked@example.test", AUTH_SECRET, {
    now: new Date("2026-01-01T00:00:00.000Z"),
    code: "222222",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      verifyTac(db, locked.emailNormalized, "000000", AUTH_SECRET, {
        now: new Date(`2026-01-01T00:0${attempt}:00.000Z`),
      }),
      TacVerificationError,
    );
  }
  assert.equal(
    database.prepare("SELECT attempt_count AS count, locked_at AS lockedAt FROM auth_challenges WHERE id = ?").get(locked.id)?.count,
    5,
  );
  assert.ok(database.prepare("SELECT locked_at FROM auth_challenges WHERE id = ?").get(locked.id)?.locked_at);
  await assert.rejects(
    verifyTac(db, locked.emailNormalized, locked.code, AUTH_SECRET, {
      now: new Date("2026-01-01T00:06:00.000Z"),
    }),
    TacVerificationError,
  );
});

test("concurrent verification consumes one challenge and creates one account/session", async () => {
  const { database, db } = createDatabase();
  const challenge = await createTacChallenge(db, "race@example.test", AUTH_SECRET, {
    code: "345678",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      verifyTac(db, challenge.emailNormalized, challenge.code, AUTH_SECRET, {
        now: new Date("2026-01-01T00:01:00.000Z"),
        sessionSecret: SESSION_SECRET,
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM users").get()?.count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
  assert.equal(database.prepare("SELECT consumed_at FROM auth_challenges WHERE id = ?").get(challenge.id)?.consumed_at, "2026-01-01T00:01:00.000Z");
});

test("D1 batch path keeps challenge consumption and session creation atomic", async () => {
  const { database, db } = createBatchedDatabase();
  const challenge = await createTacChallenge(db, "batched@example.test", AUTH_SECRET, {
    code: "789012",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  const result = await verifyTac(db, challenge.emailNormalized, challenge.code, AUTH_SECRET, {
    now: new Date("2026-01-01T00:01:00.000Z"),
    sessionSecret: SESSION_SECRET,
  });
  assert.equal(database.prepare("SELECT user_id FROM sessions WHERE id = ?").get(result.sessionId)?.user_id, result.userId);
  await assert.rejects(
    verifyTac(db, challenge.emailNormalized, challenge.code, AUTH_SECRET, {
      now: new Date("2026-01-01T00:02:00.000Z"),
      sessionSecret: SESSION_SECRET,
    }),
    TacVerificationError,
  );
  assert.equal(database.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
});

test("a second-device login creates another opaque session for the same parent household", async () => {
  const { database, db } = createDatabase();
  const firstChallenge = await createTacChallenge(db, "same-parent@example.test", AUTH_SECRET, {
    code: "101010",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  const first = await verifyTac(db, firstChallenge.emailNormalized, firstChallenge.code, AUTH_SECRET, {
    sessionSecret: SESSION_SECRET,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  const userId = database.prepare("SELECT id FROM users WHERE email_normalized = ?").get("same-parent@example.test")?.id as string;
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h1", "Home", "UTC", "2026-01-01T00:01:00.000Z");
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run("h1", userId, "parent", "2026-01-01T00:01:00.000Z");

  const secondChallenge = await createTacChallenge(db, firstChallenge.emailNormalized, AUTH_SECRET, {
    code: "202020",
    now: new Date("2026-01-02T00:00:00.000Z"),
  });
  const second = await verifyTac(db, secondChallenge.emailNormalized, secondChallenge.code, AUTH_SECRET, {
    sessionSecret: SESSION_SECRET,
    now: new Date("2026-01-02T00:01:00.000Z"),
  });
  assert.notEqual(first.sessionToken, second.sessionToken);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sessions WHERE user_id = ?").get(userId)?.count, 2);
  const firstContext = await resolveParentContext(
    new Request("https://ruutin.example/app/today", { headers: { Cookie: `${PARENT_SESSION_COOKIE}=${first.sessionToken}` } }),
    db,
    { sessionSecret: SESSION_SECRET, now: new Date("2026-01-02T00:02:00.000Z") },
  );
  const secondContext = await resolveParentContext(
    new Request("https://ruutin.example/app/today", { headers: { Cookie: `${PARENT_SESSION_COOKIE}=${second.sessionToken}` } }),
    db,
    { sessionSecret: SESSION_SECRET, now: new Date("2026-01-02T00:02:00.000Z") },
  );
  assert.equal(firstContext?.householdId, "h1");
  assert.equal(secondContext?.householdId, "h1");
});

test("auth routes bootstrap CSRF, use neutral request responses, verify, and revoke the parent session", async () => {
  const { db } = createDatabase();
  const sender = new DeterministicEmailAdapter();
  const dependencies = routeDependencies(db, sender);
  const bootstrap = handleTacRequestBootstrap(new Request("https://ruutin.example/api/auth/request", { method: "GET" }));
  const bootstrapPayload = await bootstrap.json() as { csrfToken: string };
  const csrfCookie = bootstrap.headers.get("set-cookie") ?? "";
  assert.match(csrfCookie, /__Host-ruutin_csrf=/);
  const request = await handleTacRequest(
    csrfRequest("POST", "https://ruutin.example/api/auth/request", csrfCookie, bootstrapPayload.csrfToken, {
      email: "Parent@Example.test",
    }),
    dependencies,
  );
  assert.equal(request.status, 202);
  const requestPayload = await request.json() as { ok: boolean; message: string };
  assert.equal(requestPayload.ok, true);
  assert.match(requestPayload.message, /six-digit code/i);
  assert.equal(sender.messages.length, 1);
  assert.equal(sender.messages[0]?.to, "parent@example.test");

  const code = sender.messages[0]?.text.match(/\n(\d{6})\n/)?.[1];
  assert.ok(code);
  const verify = await handleTacVerify(
    csrfRequest("POST", "https://ruutin.example/api/auth/verify", csrfCookie, bootstrapPayload.csrfToken, {
      email: "parent@example.test",
      code,
    }),
    dependencies,
  );
  assert.equal(verify.status, 200);
  const sessionCookie = verify.headers.get("set-cookie") ?? "";
  assert.match(sessionCookie, new RegExp(`^${PARENT_SESSION_COOKIE}=`));
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);

  const sessionValue = sessionCookie.match(new RegExp(`^${PARENT_SESSION_COOKIE}=([^;]+)`))?.[1];
  assert.ok(sessionValue);
  const context = await resolveParentContext(
    new Request("https://ruutin.example/app/today", { headers: { Cookie: `${PARENT_SESSION_COOKIE}=${sessionValue}` } }),
    db,
    { sessionSecret: SESSION_SECRET, now: dependencies.now },
  );
  assert.equal(context, null); // no household membership yet; auth itself remains valid in D1.
  const createdUserId = db.database.prepare("SELECT id FROM users WHERE email_normalized = ?").get("parent@example.test")?.id as string;
  db.database
    .prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)")
    .run("h1", "Home", "UTC", dependencies.now?.toISOString() ?? "2026-08-18T00:00:00.000Z");
  db.database
    .prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run("h1", createdUserId, "parent", dependencies.now?.toISOString() ?? "2026-08-18T00:00:00.000Z");
  const resolved = await resolveParentContext(
    new Request("https://ruutin.example/app/today", { headers: { Cookie: `${PARENT_SESSION_COOKIE}=${sessionValue}` } }),
    db,
    { sessionSecret: SESSION_SECRET, now: new Date("2026-08-18T00:01:00.000Z") },
  );
  assert.equal(resolved?.householdId, "h1");


  const signOut = await handleParentSignOut(
    csrfRequest(
      "POST",
      "https://ruutin.example/api/auth/sign-out",
      `${csrfCookie}; ${PARENT_SESSION_COOKIE}=${sessionValue}`,
      bootstrapPayload.csrfToken,
    ),
    dependencies,
  );
  assert.equal(signOut.status, 200);
  assert.match(signOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("known and unknown valid emails receive the same neutral TAC request response", async () => {
  const { database, db } = createDatabase();
  database
    .prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)")
    .run("existing", "known@example.test", "known@example.test", "2026-08-18T00:00:00.000Z");
  const sender = new DeterministicEmailAdapter();
  const dependencies = routeDependencies(db, sender);
  const bootstrap = handleTacRequestBootstrap(new Request("https://ruutin.example/api/auth/request", { method: "GET" }));
  const { csrfToken } = await bootstrap.json() as { csrfToken: string };
  const cookie = bootstrap.headers.get("set-cookie") ?? "";
  const known = await handleTacRequest(
    csrfRequest("POST", "https://ruutin.example/api/auth/request", cookie, csrfToken, { email: "known@example.test" }),
    dependencies,
  );
  const unknown = await handleTacRequest(
    csrfRequest("POST", "https://ruutin.example/api/auth/request", cookie, csrfToken, { email: "new@example.test" }),
    dependencies,
  );
  assert.equal(known.status, unknown.status);
  assert.deepEqual(await known.json(), await unknown.json());
});

test("TAC request limits use normalized identity plus source and reset at the documented window", async () => {
  const { db } = createDatabase();
  const sender = new DeterministicEmailAdapter();
  const dependencies = routeDependencies(db, sender);
  const store = new MemoryRateLimitStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { requestParentTac } = await import("../server/auth-service");
  const base = {
    db,
    authHmacSecret: AUTH_SECRET,
    rateLimitStore: store,
    emailSender: sender,
  };
  for (let index = 0; index < 3; index += 1) {
    await requestParentTac(base, "Parent@Example.test", "203.0.113.10", { now, challengeCode: `${index}${index}${index}${index}${index}${index}` });
  }
  await assert.rejects(
    requestParentTac(base, "Parent@Example.test", "203.0.113.10", { now, challengeCode: "456789" }),
    /Too many requests/,
  );
  await requestParentTac(base, "Parent@Example.test", "203.0.113.10", {
    now: new Date("2026-01-01T00:15:00.001Z"),
    challengeCode: "456789",
  });
  assert.equal(sender.messages.length, 4);
  void dependencies;
});

test("request-source limits trust only Cloudflare's edge-owned address header", () => {
  assert.equal(
    requestSourceFromHeaders(
      new Headers({
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.99",
      }),
    ),
    "203.0.113.10",
  );
  assert.equal(
    requestSourceFromHeaders(
      new Headers({ "x-forwarded-for": "198.51.100.99" }),
    ),
    "unknown",
  );
});

test("hashTac context binding and constant-time mismatch do not accept another email or challenge", async () => {
  const one = await hashTac("123456", "one@example.test", {
    secret: AUTH_SECRET,
    challengeId: "challenge-one",
  });
  const otherEmail = await hashTac("123456", "two@example.test", {
    secret: AUTH_SECRET,
    challengeId: "challenge-one",
  });
  const otherChallenge = await hashTac("123456", "one@example.test", {
    secret: AUTH_SECRET,
    challengeId: "challenge-two",
  });
  assert.notEqual(one, otherEmail);
  assert.notEqual(one, otherChallenge);
});
