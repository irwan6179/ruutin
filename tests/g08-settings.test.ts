import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  COMPANION_SESSION_COOKIE,
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  resolveCompanionContext,
  resolveParentSession,
  type D1DatabaseLike,
  type D1StatementLike,
} from "../server/auth-context";
import { issueCsrfToken } from "../server/http-security";
import {
  DELETE_CONFIRMATION,
  DeletionAtomicityError,
  deleteHouseholdForParent,
  exportHouseholdForParent,
  issueDeletionReauthCookie,
  updateParentTimezone,
} from "../server/settings";
import {
  handleHouseholdDeletion,
  handleHouseholdDeletionChallenge,
  handleHouseholdDeletionVerify,
  handleParentHouseholdExport,
  handleParentSettings,
  type SettingsRouteDependencies,
} from "../server/settings-routes";
import { DeterministicEmailAdapter } from "../server/email-adapter";
import { isTaskDueOnLocalDate, localDateFor } from "../server/validation";

const SECRET = "g08-session-secret-for-tests-0123456789";
const AUTH_SECRET = "g08-auth-hmac-secret-for-tests-0123456789";
const timestamp = "2026-08-18T00:00:00.000Z";
const migrations = [
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
    this.database.exec("BEGIN IMMEDIATE");
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

class RollbackBatchD1Shim extends SqliteD1Shim {
  async batch(statements: readonly unknown[]): Promise<unknown[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) (statement as { execute: () => unknown }).execute();
      throw new Error("simulated D1 failure");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDb(): { database: DatabaseSync; db: BatchedSqliteD1Shim } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  for (const migration of migrations) {
    database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", timestamp);
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u2", "other@example.test", "other@example.test", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h1", "Home", "Asia/Kuala_Lumpur", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h2", "Other", "UTC", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h1", "u1", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h2", "u2", timestamp);
  const profile = database.prepare(`INSERT INTO child_profiles
    (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  profile.run("p1", "h1", "Ari", "🌿", "13_15", 1, timestamp);
  profile.run("p2", "h1", "Bea", "🌸", "16_17", 0, timestamp);
  profile.run("p3", "h2", "Cai", "☀️", "13_15", 1, timestamp);
  const device = database.prepare(`INSERT INTO child_devices
    (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  device.run("d1", "h1", "p1", "Ari tablet", "device-hash-1", timestamp, timestamp);
  device.run("d2", "h1", "p2", "Bea tablet", "device-hash-2", timestamp, timestamp);
  device.run("d3", "h2", "p3", "Cai tablet", "device-hash-3", timestamp, timestamp);
  return { database, db: new BatchedSqliteD1Shim(database) };
}

function parent(householdId = "h1") {
  return {
    kind: "parent" as const,
    sessionId: `session-${householdId}`,
    tokenHash: "parent-hash",
    userId: householdId === "h1" ? "u1" : "u2",
    householdId,
    role: "parent" as const,
    memberships: [{ householdId, role: "parent" as const }],
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
}

async function addSessionAsync(database: DatabaseSync, rawToken: string, id = "session-h1"): Promise<void> {
  const hash = await hashOpaqueToken(rawToken, SECRET);
  database.prepare(`INSERT INTO sessions
    (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, 'u1', ?, '2027-01-01T00:00:00.000Z', ?, ?)`)
    .run(id, hash, timestamp, timestamp);
}

function csrfHeaders(rawParentToken: string, csrf: { token: string; cookie: string }): Record<string, string> {
  return {
    Origin: "https://ruutin.test",
    Cookie: `${PARENT_SESSION_COOKIE}=${rawParentToken}; ${csrf.cookie.split(";", 1)[0]}`,
    "x-ruutin-csrf": csrf.token,
    "Content-Type": "application/json",
  };
}

function deps(db: D1DatabaseLike, emailSender = new DeterministicEmailAdapter()): SettingsRouteDependencies {
  return { db, sessionSecret: SECRET, authHmacSecret: AUTH_SECRET, emailSender, now: new Date(timestamp) };
}

test("timezone is IANA-validated and preserves historical ledger local dates", async () => {
  const { database, db } = createDb();
  database.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta, source_type, source_id,
     reason, actor_user_id, local_date, created_at)
    VALUES ('ledger-old', 'h1', 'p1', 'manual_adjustment', 2, 'test', 'old-source',
     'old date', 'u1', '2026-08-18', ?)`)
    .run(timestamp);
  await assert.rejects(updateParentTimezone(db, parent(), "Not/AZone"), /timezone|invalid/i);
  const updated = await updateParentTimezone(db, parent(), "America/New_York");
  assert.equal(updated.timezone, "America/New_York");
  assert.equal(database.prepare("SELECT timezone FROM households WHERE id = 'h1'").get()?.timezone, "America/New_York");
  assert.equal(database.prepare("SELECT local_date AS localDate FROM point_ledger WHERE id = 'ledger-old'").get()?.localDate, "2026-08-18");
  assert.equal(localDateFor("2026-08-19T03:30:00.000Z", "America/New_York"), "2026-08-18");
  assert.equal(isTaskDueOnLocalDate({ type: "daily" }, "2026-08-18"), true);
  database.close();
});

test("settings and export are parent-scoped, private, and omit auth material", async () => {
  const { database, db } = createDb();
  database.prepare(`INSERT INTO tasks
    (id, household_id, child_profile_id, title, emoji, stars, schedule_type, schedule_data, position, created_at, updated_at)
    VALUES ('task-1', 'h1', 'p1', 'Brush teeth', '🪥', 2, 'daily', '{"type":"daily"}', 0, ?, ?)`)
    .run(timestamp, timestamp);
  database.prepare(`INSERT INTO rewards
    (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at)
    VALUES ('reward-1', 'h1', 'p1', 'Movie', '🎬', 5, ?, ?)`)
    .run(timestamp, timestamp);
  database.prepare(`INSERT INTO auth_challenges
    (id, email_normalized, code_hash, purpose, expires_at, created_at)
    VALUES ('tac-1', 'parent@example.test', 'should-not-export', 'delete_household', '2027-01-01T00:00:00.000Z', ?)`)
    .run(timestamp);
  database.prepare(`INSERT INTO pairing_codes
    (id, household_id, child_profile_id, code_hash, token_hash, expires_at, created_by_user_id, created_at)
    VALUES ('pair-1', 'h1', 'p1', 'pair-code-secret', 'pair-token-secret', '2027-01-01T00:00:00.000Z', 'u1', ?)`)
    .run(timestamp);
  const payload = await exportHouseholdForParent(db, parent());
  const text = JSON.stringify(payload);
  assert.deepEqual(Object.keys(payload).sort(), ["claims", "household", "ledger", "linkedDevices", "profiles", "rewardRequests", "rewards", "tasks"].sort());
  assert.equal(payload.tasks[0]?.title, "Brush teeth");
  assert.equal(payload.linkedDevices[0]?.deviceLabel, "Ari tablet");
  assert.doesNotMatch(text, /should-not-export|pair-code-secret|pair-token-secret|token_hash|code_hash|session/i);
  assert.doesNotMatch(text, /Other|Cai|h2|p3/);

  const settings = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings"), deps(db));
  assert.equal(settings.status, 401);
  database.close();
});

test("settings route enforces CSRF, returns parent email only to the parent, and export is private", async () => {
  const { database, db } = createDb();
  const rawParentToken = "parent-token-g08-012345678901234567890";
  await addSessionAsync(database, rawParentToken);
  const csrf = issueCsrfToken();
  const headers = csrfHeaders(rawParentToken, csrf);
  const settings = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings", { headers }), deps(db));
  assert.equal(settings.status, 200);
  assert.match(settings.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(settings.headers.get("referrer-policy"), "no-referrer");
  const settingsBody = await settings.json() as { settings: { account: { email: string }; household: { timezone: string } } };
  assert.equal(settingsBody.settings.account.email, "parent@example.test");
  assert.equal(settingsBody.settings.household.timezone, "Asia/Kuala_Lumpur");

  const missingCsrf = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings", {
    method: "PATCH",
    headers: { Origin: "https://ruutin.test", Cookie: headers.Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: "UTC" }),
  }), deps(db));
  assert.equal(missingCsrf.status, 403);
  const changed = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings", {
    method: "PATCH", headers, body: JSON.stringify({ timezone: "UTC" }),
  }), deps(db));
  assert.equal(changed.status, 200);
  const exportResponse = await handleParentHouseholdExport(new Request("https://ruutin.test/api/parent/settings/export", { headers }), deps(db));
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(exportResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(exportResponse.headers.get("content-disposition") ?? "", /ruutin-household-export\.json/);
  database.close();
});

test("deletion TAC is purpose-bound, generic, one-use, and locks after five wrong codes", async () => {
  const { database, db } = createDb();
  const rawParentToken = "parent-token-g08-delete-012345678901234567890";
  await addSessionAsync(database, rawParentToken);
  const csrf = issueCsrfToken();
  const headers = csrfHeaders(rawParentToken, csrf);
  const sender = new DeterministicEmailAdapter();
  const dependencies = deps(db, sender);
  const request = () => new Request("https://ruutin.test/api/parent/settings/deletion/challenge", { method: "POST", headers, body: "{}" });
  const challengeResponse = await handleHouseholdDeletionChallenge(request(), dependencies);
  assert.equal(challengeResponse.status, 202);
  assert.match(challengeResponse.headers.get("referrer-policy") ?? "", /no-referrer/);
  assert.doesNotMatch(await challengeResponse.text(), /\d{6}/);
  const code = sender.messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  assert.equal(database.prepare("SELECT purpose FROM auth_challenges WHERE email_normalized = 'parent@example.test' ORDER BY created_at DESC LIMIT 1").get()?.purpose, "delete_household");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = await handleHouseholdDeletionVerify(new Request("https://ruutin.test/api/parent/settings/deletion/verify", {
      method: "POST", headers, body: JSON.stringify({ code: "000000" }),
    }), dependencies);
    assert.equal(wrong.status, 400);
    assert.doesNotMatch(await wrong.text(), /parent@example|delete_household|attempt/i);
  }
  assert.equal(database.prepare("SELECT attempt_count AS attempts, locked_at AS locked FROM auth_challenges WHERE purpose = 'delete_household'").get()?.attempts, 5);
  const locked = await handleHouseholdDeletionVerify(new Request("https://ruutin.test/api/parent/settings/deletion/verify", {
    method: "POST", headers, body: JSON.stringify({ code }),
  }), dependencies);
  assert.equal(locked.status, 400);

  const replacement = await handleHouseholdDeletionChallenge(request(), dependencies);
  assert.equal(replacement.status, 202);
  const replacementCode = sender.messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(replacementCode);
  const verified = await handleHouseholdDeletionVerify(new Request("https://ruutin.test/api/parent/settings/deletion/verify", {
    method: "POST", headers, body: JSON.stringify({ code: replacementCode }),
  }), dependencies);
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(verified.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  assert.doesNotMatch(await verified.text(), /ruutin_delete_reauth|challengeId|session-h1/);
  const reused = await handleHouseholdDeletionVerify(new Request("https://ruutin.test/api/parent/settings/deletion/verify", {
    method: "POST", headers, body: JSON.stringify({ code: replacementCode }),
  }), dependencies);
  assert.equal(reused.status, 400);
  assert.equal((await handleHouseholdDeletionChallenge(request(), dependencies)).status, 202);
  assert.equal((await handleHouseholdDeletionChallenge(request(), dependencies)).status, 429);
  database.close();
});

test("deletion requires fresh session-bound proof and deletes household data atomically", async () => {
  const { database, db } = createDb();
  const rawParentToken = "parent-token-g08-delete-success-012345678901234567890";
  const rawCompanionToken = "companion-token-g08-delete-success-012345678901234567890";
  await addSessionAsync(database, rawParentToken);
  const companionHash = await hashOpaqueToken(rawCompanionToken, SECRET);
  database.prepare("UPDATE child_devices SET token_hash = ? WHERE id = 'd1'").run(companionHash);
  const csrf = issueCsrfToken();
  const headers = csrfHeaders(rawParentToken, csrf);
  const noMarker = await handleHouseholdDeletion(new Request("https://ruutin.test/api/parent/settings/deletion", {
    method: "POST", headers, body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }),
  }), deps(db));
  assert.equal(noMarker.status, 403);
  assert.ok(database.prepare("SELECT id FROM households WHERE id = 'h1'").get());

  const marker = await issueDeletionReauthCookie(parent(), "challenge-success", AUTH_SECRET, { now: new Date(timestamp) });
  const deleteHeaders = { ...headers, Cookie: `${headers.Cookie}; __Host-ruutin_delete_reauth=${marker}` };
  database.prepare("UPDATE sessions SET revoked_at = ? WHERE id = 'session-h1'").run(timestamp);
  const staleSession = await handleHouseholdDeletion(new Request("https://ruutin.test/api/parent/settings/deletion", {
    method: "POST", headers: deleteHeaders, body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }),
  }), deps(db));
  assert.equal(staleSession.status, 401);
  database.prepare("UPDATE sessions SET revoked_at = NULL WHERE id = 'session-h1'").run();
  const deleted = await handleHouseholdDeletion(new Request("https://ruutin.test/api/parent/settings/deletion", {
    method: "POST", headers: deleteHeaders, body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }),
  }), deps(db));
  assert.equal(deleted.status, 200);
  assert.ok(database.prepare("SELECT id FROM households WHERE id = 'h2'").get());
  for (const table of ["child_profiles", "tasks", "task_claims", "rewards", "reward_requests", "point_ledger", "child_devices", "pairing_codes"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table} WHERE household_id = 'h1'`).get()?.count, 0, table);
  }
  assert.equal(database.prepare("SELECT revoked_at FROM sessions WHERE id = 'session-h1'").get()?.revoked_at, timestamp);
  assert.equal((await resolveParentSession(new Request("https://ruutin.test", { headers: { Cookie: `${PARENT_SESSION_COOKIE}=${rawParentToken}` } }), db, { sessionSecret: SECRET, now: new Date(timestamp) })), null);
  assert.equal((await resolveCompanionContext(new Request("https://ruutin.test", { headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawCompanionToken}` } }), db, { sessionSecret: SECRET, now: new Date(timestamp) })), null);
  assert.match(deleted.headers.get("set-cookie") ?? "", /Max-Age=0/);
  database.close();
});

test("deletion fails closed without D1 batch and rolls back partial revocation", async () => {
  const { database } = createDb();
  const rawParentToken = "parent-token-g08-no-batch-012345678901234567890";
  await addSessionAsync(database, rawParentToken);
  const marker = await issueDeletionReauthCookie(parent(), "challenge-no-batch", AUTH_SECRET, { now: new Date(timestamp) });
  const request = new Request("https://ruutin.test/api/parent/settings/deletion", {
    headers: {
      Cookie: `${PARENT_SESSION_COOKIE}=${rawParentToken}; __Host-ruutin_delete_reauth=${marker}`,
      Origin: "https://ruutin.test",
      "x-ruutin-csrf": "not-used-by-service",
    },
  });
  const noBatch = new SqliteD1Shim(database);
  await assert.rejects(
    deleteHouseholdForParent(noBatch, parent(), request, AUTH_SECRET, DELETE_CONFIRMATION, { now: new Date(timestamp) }),
    (error: unknown) => error instanceof DeletionAtomicityError,
  );
  assert.ok(database.prepare("SELECT id FROM households WHERE id = 'h1'").get());
  const rollback = new RollbackBatchD1Shim(database);
  await assert.rejects(
    deleteHouseholdForParent(rollback, parent(), request, AUTH_SECRET, DELETE_CONFIRMATION, { now: new Date(timestamp) }),
    (error: unknown) => error instanceof DeletionAtomicityError,
  );
  assert.equal(database.prepare("SELECT revoked_at FROM sessions WHERE id = 'session-h1'").get()?.revoked_at, null);
  database.close();
});

test("settings UI copy keeps privacy, deletion, sign-out, and timezone boundaries visible", () => {
  const page = readFileSync("app/app/settings/SettingsManager.tsx", "utf8");
  assert.match(page, /Parent access/);
  assert.match(page, /never shown in the companion space/);
  assert.match(page, /profiles marked under 13 stay parent-only/);
  assert.match(page, /IANA timezone/);
  assert.match(page, /historical ledger local dates/);
  assert.match(page, /Download JSON/);
  assert.match(page, /session tokens/);
  assert.match(page, /permanently deletes/);
  assert.match(page, /Type DELETE/);
  assert.match(page, /SignOutButton/);
});
