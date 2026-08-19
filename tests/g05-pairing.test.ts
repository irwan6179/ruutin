import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import QRCode from "qrcode";
import {
  COMPANION_SESSION_COOKIE,
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  resolveCompanionContext,
  touchSessionIfDue,
  type CompanionContext,
  type D1DatabaseLike,
  type D1StatementLike,
  type ParentContext,
} from "../server/auth-context";
import { getCompanionRewards, getCompanionToday } from "../server/companion";
import { issueCsrfToken } from "../server/http-security";
import { handleParentPairing } from "../server/parent-routes";
import {
  cancelPairingChallenge,
  createPairingChallenge,
  PairingVerificationError,
  previewPairingChallenge,
  consumePairingChallenge,
} from "../server/pairing";
import { handlePairing } from "../server/pairing-routes";
import { requestSourceFromHeaders } from "../server/auth-service";

const SECRET = "pairing-auth-secret-for-tests-0123456789";
const SESSION_SECRET = "pairing-session-secret-for-tests-0123456789";
const timestamp = "2026-08-18T00:00:00.000Z";
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
      execute: () => statement.run(...values),
    } as D1StatementLike);
    return bind([]);
  }
}

class BatchedSqliteD1Shim extends SqliteD1Shim {
  async batch(statements: readonly unknown[]): Promise<unknown[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => (statement as { execute: () => unknown }).execute());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDb(batched = false): { database: DatabaseSync; db: D1DatabaseLike } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", timestamp);
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u2", "other@example.test", "other@example.test", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h1", "Home", "UTC", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h2", "Other", "UTC", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run("h1", "u1", "parent", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run("h2", "u2", "parent", timestamp);
  const addProfile = database.prepare(
    `INSERT INTO child_profiles (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  addProfile.run("p1", "h1", "Ari", "🌿", "13_15", 1, timestamp);
  addProfile.run("p2", "h1", "Bea", "🌸", "13_15", 1, timestamp);
  addProfile.run("under", "h1", "Uma", "🌙", "under_13", 0, timestamp);
  addProfile.run("p3", "h2", "Cai", "☀️", "13_15", 1, timestamp);
  return { database, db: batched ? new BatchedSqliteD1Shim(database) : new SqliteD1Shim(database) };
}

function parent(householdId = "h1"): ParentContext {
  return {
    kind: "parent",
    sessionId: "s1",
    tokenHash: "parent-hash",
    userId: householdId === "h1" ? "u1" : "u2",
    householdId,
    role: "parent",
    memberships: [{ householdId, role: "parent" }],
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
}

test("pairing challenge stores only protected values and replacement/cancellation are scoped", async () => {
  const { database, db } = createDb(true);
  const first = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date(timestamp),
    code: "123456",
    pairingToken: "a".repeat(43),
    id: "pair-1",
  });
  assert.equal(first.code, "123456");
  assert.notEqual(database.prepare("SELECT code_hash FROM pairing_codes WHERE id = ?").get("pair-1")?.code_hash, first.code);
  assert.notEqual(database.prepare("SELECT token_hash FROM pairing_codes WHERE id = ?").get("pair-1")?.token_hash, first.pairingToken);
  const second = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date("2026-08-18T00:01:00.000Z"),
    code: "654321",
    pairingToken: "b".repeat(43),
    id: "pair-2",
  });
  assert.ok(database.prepare("SELECT cancelled_at FROM pairing_codes WHERE id = ?").get(first.id)?.cancelled_at);
  assert.equal((await previewPairingChallenge(db, { code: second.code }, SECRET, { now: new Date("2026-08-18T00:02:00.000Z") })).nickname, "Ari");
  await assert.rejects(previewPairingChallenge(db, { code: first.code }, SECRET, { now: new Date("2026-08-18T00:02:00.000Z") }), PairingVerificationError);
  await assert.rejects(createPairingChallenge(db, parent(), "under", SECRET), /Resource not found/);
  await assert.rejects(createPairingChallenge(db, parent(), "p3", SECRET), /Resource not found/);
  await cancelPairingChallenge(db, parent(), second.id, { now: new Date("2026-08-18T00:03:00.000Z") });
  await assert.rejects(previewPairingChallenge(db, { token: second.pairingToken }, SECRET, { now: new Date("2026-08-18T00:03:01.000Z") }), PairingVerificationError);
});

test("wrong pairing code attempts lock at exactly five and expiry is server-authoritative", async () => {
  const { database, db } = createDb();
  const challenge = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date(timestamp),
    code: "111111",
    pairingToken: "c".repeat(43),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      previewPairingChallenge(db, { token: challenge.pairingToken, code: "000000" }, SECRET, { now: new Date("2026-08-18T00:0" + String(attempt + 1) + ":00.000Z") }),
      PairingVerificationError,
    );
  }
  assert.equal(database.prepare("SELECT attempt_count AS count FROM pairing_codes WHERE id = ?").get(challenge.id)?.count, 5);
  await assert.rejects(previewPairingChallenge(db, { token: challenge.pairingToken, code: challenge.code }, SECRET, { now: new Date("2026-08-18T00:06:00.000Z") }), PairingVerificationError);
  const expired = await createPairingChallenge(db, parent(), "p2", SECRET, { now: new Date(timestamp), ttlMs: 10, code: "222222", pairingToken: "d".repeat(43) });
  await assert.rejects(previewPairingChallenge(db, { token: expired.pairingToken }, SECRET, { now: new Date("2026-08-18T00:00:00.011Z") }), PairingVerificationError);
});

test("concurrent challenge consumption creates one profile-scoped device", async () => {
  const { database, db } = createDb(true);
  const challenge = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date(timestamp),
    code: "345678",
    pairingToken: "e".repeat(43),
  });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumePairingChallenge(db, { token: challenge.pairingToken }, SECRET, { now: new Date("2026-08-18T00:01:00.000Z") })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM child_devices").get()?.count, 1);
  assert.equal(database.prepare("SELECT consumed_at FROM pairing_codes WHERE id = ?").get(challenge.id)?.consumed_at, "2026-08-18T00:01:00.000Z");
  const success = results.find((result) => result.status === "fulfilled");
  assert.ok(success && success.status === "fulfilled");
  assert.ok(success.value.deviceToken);
  assert.notEqual(database.prepare("SELECT token_hash FROM child_devices").get()?.token_hash, success.value.deviceToken);
  const context = await resolveCompanionContext(new Request("https://ruutin.test/companion/today", { headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${success.value.deviceToken}` } }), db, { sessionSecret: SECRET, now: new Date("2026-08-18T00:02:00.000Z") });
  assert.equal(context?.profileId, "p1");
});

test("parent pairing route is CSRF protected and public pair route reveals only selected profile", async () => {
  const { database, db } = createDb(true);
  const rawSession = "parent-session-for-pairing-01234567890123456789";
  const tokenHash = await hashOpaqueToken(rawSession, SESSION_SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s1", "u1", tokenHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const cookie = `${csrf.cookie.split(";", 1)[0]}; __Host-ruutin_parent_session=${rawSession}`;
  const create = await handleParentPairing(new Request("https://ruutin.test/api/parent/pairing", { method: "POST", headers: { Origin: "https://ruutin.test", Cookie: cookie, "x-ruutin-csrf": csrf.token, "Content-Type": "application/json" }, body: JSON.stringify({ profileId: "p1" }) }), { db, sessionSecret: SESSION_SECRET, authHmacSecret: SECRET, now: new Date(timestamp) });
  assert.equal(create.status, 201);
  const challenge = (await create.json() as { challenge: { code: string; token: string } }).challenge;
  const noCsrf = await handleParentPairing(new Request("https://ruutin.test/api/parent/pairing", { method: "POST", headers: { Origin: "https://ruutin.test", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ profileId: "p1" }) }), { db, sessionSecret: SESSION_SECRET, authHmacSecret: SECRET, now: new Date(timestamp) });
  assert.equal(noCsrf.status, 403);
  const preview = await handlePairing(new Request("https://ruutin.test/api/pair", { method: "POST", headers: { Origin: "https://ruutin.test", "Content-Type": "application/json" }, body: JSON.stringify({ token: challenge.token }) }), { db, authHmacSecret: SECRET, sessionSecret: SESSION_SECRET, now: new Date("2026-08-18T00:01:00.000Z") });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(preview.headers.get("referrer-policy"), "no-referrer");
  assert.equal(preview.headers.get("vary"), "Cookie");
  assert.deepEqual(await preview.json(), { pairing: { nickname: "Ari", emoji: "🌿", expiresAt: "2026-08-18T00:10:00.000Z" } });
  const confirm = await handlePairing(new Request("https://ruutin.test/api/pair", { method: "POST", headers: { Origin: "https://ruutin.test", "Content-Type": "application/json" }, body: JSON.stringify({ token: challenge.token, confirm: true }) }), { db, authHmacSecret: SECRET, sessionSecret: SESSION_SECRET, now: new Date("2026-08-18T00:01:00.000Z") });
  assert.equal(confirm.status, 201);
  const companionCookie = confirm.headers.get("set-cookie") ?? "";
  assert.match(companionCookie, /__Host-ruutin_companion_session=/);
  const companionToken = companionCookie.match(/__Host-ruutin_companion_session=([^;]+)/u)?.[1];
  assert.ok(companionToken);
  const companionContext = await resolveCompanionContext(
    new Request("https://ruutin.test/companion/today", {
      headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${companionToken}` },
    }),
    db,
    { sessionSecret: SESSION_SECRET, now: new Date("2026-08-18T00:02:00.000Z") },
  );
  assert.equal(companionContext?.profileId, "p1");
  const confirmationBody = JSON.stringify(await confirm.json());
  assert.doesNotMatch(confirmationBody, /parent@example|Bea|Home/);
  assert.doesNotMatch(confirmationBody, new RegExp(`${challenge.code}|${challenge.token}`));
  const stored = JSON.stringify(database.prepare("SELECT code_hash, token_hash FROM pairing_codes").all());
  assert.doesNotMatch(stored, new RegExp(`${challenge.code}|${challenge.token}`));
});

test("companion Today reads only the assigned profile's due tasks", async () => {
  const { database, db } = createDb();
  database.prepare(`INSERT INTO tasks (id, household_id, child_profile_id, title, emoji, stars, schedule_type, schedule_data, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("t1", "h1", "p1", "Ari task", "🪥", 1, "daily", '{"type":"daily"}', 0, timestamp, timestamp);
  database.prepare(`INSERT INTO tasks (id, household_id, child_profile_id, title, emoji, stars, schedule_type, schedule_data, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("t2", "h1", "p2", "Sibling task", "🧺", 2, "daily", '{"type":"daily"}', 0, timestamp, timestamp);
  const context: CompanionContext = { kind: "companion", deviceId: "d1", tokenHash: "hash", householdId: "h1", profileId: "p1", profile: { nickname: "Ari", emoji: "🌿" }, expiresAt: null };
  const today = await getCompanionToday(db, context, { now: new Date(timestamp) });
  assert.deepEqual(today.tasks.map((task) => task.title), ["Ari task"]);
  assert.doesNotMatch(JSON.stringify(today), /Sibling|Bea|p2/);
});

test("unknown manual codes consume the source/browser budget and then fail generically", async () => {
  const { db } = createDb(true);
  const request = (cookie = "") => new Request("https://ruutin.test/api/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.77",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ code: "000000" }),
  });
  const first = await handlePairing(request(), { db, authHmacSecret: SECRET, now: new Date(timestamp) });
  assert.equal(first.status, 400);
  const setCookie = first.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /__Host-ruutin_pairing_browser=/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const browserCookie = setCookie.split(";", 1)[0];
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const response = await handlePairing(request(browserCookie), {
      db,
      authHmacSecret: SECRET,
      now: new Date(`2026-08-18T00:0${attempt}:00.000Z`),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /invalid or has expired/);
  }
  const blocked = await handlePairing(request(browserCookie), {
    db,
    authHmacSecret: SECRET,
    now: new Date("2026-08-18T00:05:00.000Z"),
  });
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Too many requests/);
  assert.doesNotMatch(
    JSON.stringify(await db.prepare("SELECT key FROM rate_limit_buckets").all()),
    /ruutin_pairing_browser/,
  );
});

test("the trusted Cloudflare request source is limited even when every browser drops its bucket cookie", async () => {
  const { db } = createDb(true);
  assert.equal(requestSourceFromHeaders(new Headers({ "X-Forwarded-For": "198.51.100.99" })), "unknown");
  const request = () => new Request("https://ruutin.test/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.44" },
    body: JSON.stringify({ code: "999999" }),
  });
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push((await handlePairing(request(), {
      db,
      authHmacSecret: SECRET,
      now: new Date(`2026-08-18T00:0${attempt}:00.000Z`),
    })).status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});

test("a successful code-only preview can confirm on the fifth source attempt via a browser-bound marker", async () => {
  const { db } = createDb(true);
  const challenge = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date(timestamp),
    code: "121212",
    pairingToken: "g".repeat(43),
  });
  const request = (body: Record<string, unknown>, cookie = "") => new Request("https://ruutin.test/api/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.121",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let browserCookie = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await handlePairing(request({ code: "000000" }, browserCookie), {
      db,
      authHmacSecret: SECRET,
      now: new Date(`2026-08-18T00:0${attempt + 1}:00.000Z`),
    });
    assert.equal(response.status, 400);
    if (!browserCookie) browserCookie = (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
  }
  assert.match(browserCookie, /^__Host-ruutin_pairing_browser=/u);
  const preview = await handlePairing(request({ code: challenge.code }, browserCookie), {
    db,
    authHmacSecret: SECRET,
    now: new Date("2026-08-18T00:05:00.000Z"),
  });
  assert.equal(preview.status, 200);
  const markerCookie = (preview.headers.get("set-cookie") ?? "").split(";", 1)[0];
  assert.match(markerCookie, /^__Host-ruutin_pairing_preview=/u);
  const confirm = await handlePairing(request(
    { code: challenge.code, confirm: true },
    `${browserCookie}; ${markerCookie}`,
  ), {
    db,
    authHmacSecret: SECRET,
    now: new Date("2026-08-18T00:06:00.000Z"),
  });
  assert.equal(confirm.status, 201);
});

test("direct code-only confirmation without a preview marker remains source-limited", async () => {
  const { db } = createDb(true);
  const request = () => new Request("https://ruutin.test/api/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.121",
    },
    body: JSON.stringify({ code: "000000", confirm: true }),
  });
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push((await handlePairing(request(), {
      db,
      authHmacSecret: SECRET,
      now: new Date(`2026-08-18T00:0${attempt}:00.000Z`),
    })).status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});

test("under-13 direct pairing route calls are denied without creating a challenge", async () => {
  const { database, db } = createDb(true);
  const rawSession = "parent-session-under13-012345678901234567890";
  const sessionHash = await hashOpaqueToken(rawSession, SESSION_SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s1", "u1", sessionHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const response = await handleParentPairing(new Request("https://ruutin.test/api/parent/pairing", {
    method: "POST",
    headers: {
      Origin: "https://ruutin.test",
      "Content-Type": "application/json",
      Cookie: `${PARENT_SESSION_COOKIE}=${rawSession}; ${csrf.cookie.split(";", 1)[0]}`,
      "x-ruutin-csrf": csrf.token,
    },
    body: JSON.stringify({ profileId: "under" }),
  }), { db, sessionSecret: SESSION_SECRET, authHmacSecret: SECRET, now: new Date(timestamp) });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found", message: "Resource not found" });
  assert.equal(database.prepare("SELECT count(*) AS count FROM pairing_codes").get()?.count, 0);
});

test("a companion cookie cannot authorize a parent-only pairing route", async () => {
  const { db } = createDb(true);
  const csrf = issueCsrfToken();
  const response = await handleParentPairing(new Request("https://ruutin.test/api/parent/pairing", {
    method: "POST",
    headers: {
      Origin: "https://ruutin.test",
      "Content-Type": "application/json",
      Cookie: `${COMPANION_SESSION_COOKIE}=${"x".repeat(43)}; ${csrf.cookie.split(";", 1)[0]}`,
      "x-ruutin-csrf": csrf.token,
    },
    body: JSON.stringify({ profileId: "p1" }),
  }), { db, sessionSecret: SESSION_SECRET, authHmacSecret: SECRET, now: new Date(timestamp) });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /Ari|Bea|Home/);
});

test("companion rewards remain sibling-scoped and headers stay private", async () => {
  const { database, db } = createDb();
  database.prepare("INSERT INTO rewards (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("r1", "h1", "p1", "Ari reward", "🎁", 3, timestamp, timestamp);
  database.prepare("INSERT INTO rewards (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("r2", "h1", "p2", "Sibling reward", "🎮", 7, timestamp, timestamp);
  database.prepare("INSERT INTO point_ledger (id, household_id, child_profile_id, event_type, stars_delta, source_type, source_id, local_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("l1", "h1", "p1", "manual_adjustment", 3, "test", "source-1", "2026-08-18", timestamp);
  database.prepare("INSERT INTO point_ledger (id, household_id, child_profile_id, event_type, stars_delta, source_type, source_id, local_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("l2", "h1", "p2", "manual_adjustment", 99, "test", "source-2", "2026-08-18", timestamp);
  const context: CompanionContext = { kind: "companion", deviceId: "d1", tokenHash: "hash", householdId: "h1", profileId: "p1", profile: { nickname: "Ari", emoji: "🌿" }, expiresAt: null };
  const rewards = await getCompanionRewards(db, context);
  assert.equal(rewards.balance, 3);
  assert.deepEqual(rewards.rewards.map((reward) => reward.title), ["Ari reward"]);
  assert.doesNotMatch(JSON.stringify(rewards), /Sibling|p2|99/);
});

test("companion revocation applies to a retained cookie on the next request, while profile assignment is immutable", async () => {
  const { database, db } = createDb();
  const rawToken = "companion-revocation-token-012345678901234567";
  const tokenHash = await hashOpaqueToken(rawToken, SECRET);
  database.prepare("INSERT INTO child_devices (id, household_id, child_profile_id, device_label, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("d1", "h1", "p1", "Tablet", tokenHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const request = new Request("https://ruutin.test/companion/today", { headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawToken}` } });
  assert.equal((await resolveCompanionContext(request, db, { sessionSecret: SECRET, now: new Date("2026-08-18T00:00:00.000Z") }))?.profileId, "p1");
  assert.throws(() => database.prepare("UPDATE child_devices SET child_profile_id = ? WHERE id = ?").run("p2", "d1"), /immutable/i);
  database.prepare("UPDATE child_devices SET revoked_at = ? WHERE id = ?").run("2026-08-18T00:01:00.000Z", "d1");
  assert.equal(await resolveCompanionContext(request, db, { sessionSecret: SECRET, now: new Date("2026-08-18T00:02:00.000Z") }), null);
});

test("companion last-seen updates are throttled to one write per five minutes", async () => {
  const { database, db } = createDb();
  const rawToken = "companion-touch-token-012345678901234567890";
  const tokenHash = await hashOpaqueToken(rawToken, SECRET);
  database.prepare("INSERT INTO child_devices (id, household_id, child_profile_id, device_label, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("d1", "h1", "p1", "Tablet", tokenHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const context: CompanionContext = { kind: "companion", deviceId: "d1", tokenHash, householdId: "h1", profileId: "p1", profile: { nickname: "Ari", emoji: "🌿" }, expiresAt: "2027-01-01T00:00:00.000Z" };
  await touchSessionIfDue(db, context, { now: new Date("2026-08-18T00:01:00.000Z") });
  assert.equal(database.prepare("SELECT last_seen_at AS seen FROM child_devices WHERE id = ?").get("d1")?.seen, timestamp);
  await touchSessionIfDue(db, context, { now: new Date("2026-08-18T00:06:00.000Z") });
  assert.equal(database.prepare("SELECT last_seen_at AS seen FROM child_devices WHERE id = ?").get("d1")?.seen, "2026-08-18T00:06:00.000Z");
});

test("pairing consumption fails closed when D1 atomic batches are unavailable", async () => {
  const { database, db } = createDb();
  const challenge = await createPairingChallenge(db, parent(), "p1", SECRET, {
    now: new Date(timestamp),
    code: "456789",
    pairingToken: "f".repeat(43),
  });
  await assert.rejects(consumePairingChallenge(db, { token: challenge.pairingToken }, SECRET, { now: new Date("2026-08-18T00:01:00.000Z") }), /atomic/i);
  assert.equal(database.prepare("SELECT consumed_at FROM pairing_codes WHERE id = ?").get(challenge.id)?.consumed_at, null);
  assert.equal(database.prepare("SELECT count(*) AS count FROM child_devices").get()?.count, 0);
});

test("pairing QR contract uses a bundled encoder and only appears in the parent manager", async () => {
  const qrSource = readFileSync("app/pair/PairingQr.tsx", "utf8");
  const managerSource = readFileSync("app/app/family/PairingManager.tsx", "utf8");
  const flowSource = readFileSync("app/pair/PairFlow.tsx", "utf8");
  const pageSource = readFileSync("app/pair/page.tsx", "utf8");
  assert.match(qrSource, /from ["']qrcode["']/u);
  assert.match(qrSource, /QRCode\.toString/u);
  assert.match(qrSource, /data:image\/svg\+xml/u);
  assert.doesNotMatch(qrSource, /qrserver|api\.qr/u);
  const svg = await QRCode.toString("https://ruutin.test/pair?token=" + "a".repeat(43), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });
  assert.match(svg, /^<svg\b/u);
  assert.match(svg, /<path\b/u);
  assert.doesNotMatch(svg, /qrserver|api\.qr/u);
  assert.match(managerSource, /PairingQr/u);
  assert.doesNotMatch(flowSource, /PairingQr/u);
  assert.doesNotMatch(flowSource, /initialToken/u);
  assert.doesNotMatch(pageSource, /searchParams/u);
});

test("a pairing link is accepted automatically and reports success before opening Today", () => {
  const flowSource = readFileSync("app/pair/PairFlow.tsx", "utf8");
  assert.match(flowSource, /pairRequest\(\{ token, confirm: true \}\)/u);
  assert.match(flowSource, /setSuccessProfile\(payload\.profile\)/u);
  assert.match(flowSource, /Device linked/u);
  assert.match(flowSource, /window\.setTimeout/u);
  assert.match(flowSource, /navigate\("\/companion\/today"/u);
});
