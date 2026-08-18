import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  COMPANION_SESSION_COOKIE,
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  resolveCompanionContext,
  type D1DatabaseLike,
  type D1StatementLike,
  type ParentContext,
} from "../server/auth-context";
import { getCompanionRewards, getCompanionToday } from "../server/companion";
import { handleCompanionClaim, handleParentClaims, handleParentCompletion, handleParentLedger } from "../server/claim-routes";
import { DeterministicEmailAdapter } from "../server/email-adapter";
import { handleTacRequest } from "../server/auth-routes";
import { issueCsrfToken } from "../server/http-security";
import {
  handleParentDevices,
  handleParentHousehold,
  handleParentOnboarding,
  handleParentPairing,
  handleParentProfile,
  handleParentProfiles,
  handleParentTask,
  handleParentTaskBulk,
  handleParentTaskReorder,
  handleParentTasks,
  handleParentToday,
} from "../server/parent-routes";
import {
  createPairingChallenge,
  consumePairingChallenge,
  PairingAtomicityError,
} from "../server/pairing";
import { handlePairing } from "../server/pairing-routes";
import {
  handleCompanionRewardRequests,
  handleParentActiveReward,
  handleParentReward,
  handleParentRewardRequests,
  handleParentRewards,
} from "../server/reward-routes";
import {
  handleHouseholdDeletion,
  handleHouseholdDeletionChallenge,
  handleHouseholdDeletionVerify,
  handleParentHouseholdExport,
  handleParentSettings,
  type SettingsRouteDependencies,
} from "../server/settings-routes";
import { createTacChallenge, TacVerificationError, verifyTac } from "../server/tac";
import { ScopeError } from "../server/scoped-data";

const SESSION_SECRET = "g10-session-secret-for-tests-0123456789";
const AUTH_SECRET = "g10-auth-hmac-secret-for-tests-0123456789";
const TIMESTAMP = "2026-08-18T00:00:00.000Z";
const NOW = new Date("2026-08-18T12:00:00.000Z");
const MIGRATIONS = [
  "drizzle/0000_careless_colossus.sql",
  "drizzle/0001_cool_lake.sql",
  "drizzle/0002_old_ben_parker.sql",
  "drizzle/0003_g01_integrity.sql",
  "drizzle/0004_sleepy_power_pack.sql",
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

type Fixture = {
  database: DatabaseSync;
  db: BatchedSqliteD1Shim;
  parentToken: string;
  companionToken: string;
  csrf: ReturnType<typeof issueCsrfToken>;
};

function applyMigrations(database: DatabaseSync): void {
  for (const migration of MIGRATIONS) {
    database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
}

async function createFixture(): Promise<Fixture> {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  applyMigrations(database);
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", TIMESTAMP);
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u2", "other@example.test", "other@example.test", TIMESTAMP);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h1", "Home", "Asia/Kuala_Lumpur", TIMESTAMP);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h2", "Other", "UTC", TIMESTAMP);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h1", "u1", TIMESTAMP);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h2", "u2", TIMESTAMP);
  const profile = database.prepare(`INSERT INTO child_profiles
    (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  profile.run("p1", "h1", "Ari", "🌿", "13_15", 1, TIMESTAMP);
  profile.run("p2", "h1", "Bea", "🌸", "13_15", 1, TIMESTAMP);
  profile.run("p3", "h2", "Cai", "☀️", "13_15", 1, TIMESTAMP);
  const task = database.prepare(`INSERT INTO tasks
    (id, household_id, child_profile_id, title, emoji, stars, schedule_type, schedule_data, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'daily', '{"type":"daily"}', 0, ?, ?)`);
  task.run("t1", "h1", "p1", "Brush teeth", "🪥", 2, TIMESTAMP, TIMESTAMP);
  task.run("t2", "h1", "p2", "Pack bag", "🎒", 2, TIMESTAMP, TIMESTAMP);
  task.run("t3", "h2", "p3", "Water plants", "🪴", 2, TIMESTAMP, TIMESTAMP);
  const reward = database.prepare(`INSERT INTO rewards
    (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  reward.run("r1", "h1", "p1", "Movie night", "🎬", 3, TIMESTAMP, TIMESTAMP);
  reward.run("r2", "h1", "p2", "Dessert", "🍰", 3, TIMESTAMP, TIMESTAMP);
  reward.run("r3", "h2", "p3", "Outing", "🚲", 3, TIMESTAMP, TIMESTAMP);
  database.prepare("UPDATE child_profiles SET active_reward_id = 'r1' WHERE id = 'p1' AND household_id = 'h1'").run();

  const parentToken = "parent-token-g10-012345678901234567890";
  const companionToken = "companion-token-g10-012345678901234567890";
  const parentHash = await hashOpaqueToken(parentToken, SESSION_SECRET);
  const companionHash = await hashOpaqueToken(companionToken, SESSION_SECRET);
  database.prepare(`INSERT INTO sessions
    (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES ('s1', 'u1', ?, '2027-01-01T00:00:00.000Z', ?, ?)`)
    .run(parentHash, TIMESTAMP, TIMESTAMP);
  const device = database.prepare(`INSERT INTO child_devices
    (id, household_id, child_profile_id, device_label, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, '2027-01-01T00:00:00.000Z', ?, ?)`);
  device.run("d1", "h1", "p1", "Ari tablet", companionHash, TIMESTAMP, TIMESTAMP);
  device.run("d2", "h1", "p2", "Bea tablet", "device-hash-2", TIMESTAMP, TIMESTAMP);
  device.run("d3", "h2", "p3", "Cai tablet", "device-hash-3", TIMESTAMP, TIMESTAMP);

  const claim = database.prepare(`INSERT INTO task_claims
    (id, household_id, child_profile_id, task_id, due_date, submitted_by_type,
     submitted_by_device_id, status, submitted_at, resolved_at, resolved_by_user_id)
    VALUES (?, ?, ?, ?, '2026-08-18', 'companion', ?, 'pending', ?, NULL, NULL)`);
  claim.run("c1", "h1", "p1", "t1", "d1", TIMESTAMP);
  claim.run("c2", "h1", "p2", "t2", "d2", TIMESTAMP);
  claim.run("c3", "h2", "p3", "t3", "d3", TIMESTAMP);
  const request = database.prepare(`INSERT INTO reward_requests
    (id, household_id, child_profile_id, reward_id, status, requested_by_device_id,
     requested_at, resolved_at, resolved_by_user_id)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`);
  request.run("q1", "h1", "p1", "r1", "d1", TIMESTAMP);
  request.run("q2", "h1", "p2", "r2", "d2", TIMESTAMP);
  request.run("q3", "h2", "p3", "r3", "d3", TIMESTAMP);
  database.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta, source_type,
     source_id, reason, actor_user_id, local_date, created_at)
    VALUES ('l1', 'h1', 'p1', 'manual_adjustment', 4, 'manual_adjustment', 'fixture-h1-p1', 'fixture', 'u1', '2026-08-18', ?)`)
    .run(TIMESTAMP);
  database.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta, source_type,
     source_id, reason, actor_user_id, local_date, created_at)
    VALUES ('l2', 'h1', 'p2', 'manual_adjustment', 4, 'manual_adjustment', 'fixture-h1-p2', 'fixture', 'u1', '2026-08-18', ?)`)
    .run(TIMESTAMP);
  database.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta, source_type,
     source_id, reason, actor_user_id, local_date, created_at)
    VALUES ('l3', 'h2', 'p3', 'manual_adjustment', 4, 'manual_adjustment', 'fixture-h2-p3', 'fixture', 'u2', '2026-08-18', ?)`)
    .run(TIMESTAMP);

  return { database, db: new BatchedSqliteD1Shim(database), parentToken, companionToken, csrf: issueCsrfToken() };
}

function parentContext(householdId = "h1"): ParentContext {
  return {
    kind: "parent",
    sessionId: householdId === "h1" ? "s1" : "s2",
    tokenHash: "context-token-hash",
    userId: householdId === "h1" ? "u1" : "u2",
    householdId,
    role: "parent",
    memberships: [{ householdId, role: "parent" }],
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
}

function parentHeaders(fixture: Fixture): Record<string, string> {
  return {
    Origin: "https://ruutin.test",
    Cookie: `${PARENT_SESSION_COOKIE}=${fixture.parentToken}; ${fixture.csrf.cookie.split(";", 1)[0]}`,
    "x-ruutin-csrf": fixture.csrf.token,
    "Content-Type": "application/json",
  };
}

function parentCookie(fixture: Fixture): Record<string, string> {
  return { Cookie: `${PARENT_SESSION_COOKIE}=${fixture.parentToken}` };
}

function companionCookie(fixture: Fixture): Record<string, string> {
  return { Cookie: `${COMPANION_SESSION_COOKIE}=${fixture.companionToken}` };
}

function jsonRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
): Request {
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

async function responseText(response: Response): Promise<string> {
  return response.text();
}

function assertPrivate(response: Response): void {
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

function assertGenericForeign(response: Response, forbidden: readonly string[] = ["Cai", "h2"]): Promise<void> {
  assert.ok([400, 404, 409].includes(response.status), `unexpected status ${response.status}`);
  return responseText(response).then((text) => {
    for (const value of forbidden) assert.doesNotMatch(text, new RegExp(value, "u"));
    assert.doesNotMatch(text, /parent@example\.test|other@example\.test|token_hash|code_hash/u);
  });
}

function routeDeps(fixture: Fixture) {
  return {
    parent: { db: fixture.db, sessionSecret: SESSION_SECRET, authHmacSecret: AUTH_SECRET, now: NOW },
    claims: { db: fixture.db, sessionSecret: SESSION_SECRET, now: NOW },
    rewards: { db: fixture.db, sessionSecret: SESSION_SECRET, now: NOW },
    settings: {
      db: fixture.db,
      sessionSecret: SESSION_SECRET,
      authHmacSecret: AUTH_SECRET,
      emailSender: new DeterministicEmailAdapter(),
      now: NOW,
    } satisfies SettingsRouteDependencies,
  };
}

test("BR-100 parent route matrix denies foreign IDs and returns only own household data", async () => {
  const fixture = await createFixture();
  const deps = routeDeps(fixture);
  const headers = parentHeaders(fixture);
  const readHeaders = parentCookie(fixture);

  const profiles = await handleParentProfiles(new Request("https://ruutin.test/api/parent/profiles", { headers: readHeaders }), deps.parent);
  assert.equal(profiles.status, 200);
  assertPrivate(profiles);
  const profilesBody = await profiles.text();
  assert.match(profilesBody, /Ari/u);
  assert.match(profilesBody, /Bea/u);
  assert.doesNotMatch(profilesBody, /Cai|h2/u);

  await assertGenericForeign(await handleParentProfile(new Request("https://ruutin.test/api/parent/profiles/p3", { headers: readHeaders }), deps.parent, "p3"));
  await assertGenericForeign(await handleParentProfile(jsonRequest("https://ruutin.test/api/parent/profiles/p3", "PATCH", headers, { nickname: "Nope" }), deps.parent, "p3"));
  await assertGenericForeign(await handleParentProfile(jsonRequest("https://ruutin.test/api/parent/profiles/p3", "DELETE", headers, {}), deps.parent, "p3"));

  await assertGenericForeign(await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks?profileId=p3", { headers: readHeaders }), deps.parent));
  await assertGenericForeign(await handleParentTasks(jsonRequest("https://ruutin.test/api/parent/tasks", "POST", headers, { profileId: "p3", title: "Foreign", emoji: "x", stars: 1, schedule: { type: "daily" } }), deps.parent));
  await assertGenericForeign(await handleParentTask(new Request("https://ruutin.test/api/parent/tasks/t3", { headers: readHeaders }), deps.parent, "t3"));
  await assertGenericForeign(await handleParentTask(jsonRequest("https://ruutin.test/api/parent/tasks/t3", "PATCH", headers, { title: "Nope" }), deps.parent, "t3"));
  await assertGenericForeign(await handleParentTask(jsonRequest("https://ruutin.test/api/parent/tasks/t3", "DELETE", headers, {}), deps.parent, "t3"));
  await assertGenericForeign(await handleParentTaskReorder(jsonRequest("https://ruutin.test/api/parent/tasks/reorder", "POST", headers, { profileId: "p3", taskIds: ["t3"] }), deps.parent));
  await assertGenericForeign(await handleParentTaskBulk(jsonRequest("https://ruutin.test/api/parent/tasks/bulk", "POST", headers, { profileId: "p3", drafts: [{ title: "Foreign", emoji: "x", stars: 1, schedule: { type: "daily" } }] }), deps.parent));

  const devices = await handleParentDevices(new Request("https://ruutin.test/api/parent/devices", { headers: readHeaders }), deps.parent);
  assert.equal(devices.status, 200);
  assertPrivate(devices);
  const devicesBody = await devices.text();
  assert.match(devicesBody, /Ari tablet|Bea tablet/u);
  assert.doesNotMatch(devicesBody, /Cai tablet|d3|h2/u);
  await assertGenericForeign(await handleParentDevices(jsonRequest("https://ruutin.test/api/parent/devices/d3", "PATCH", headers, { deviceLabel: "Nope" }), deps.parent, "d3"));
  await assertGenericForeign(await handleParentDevices(jsonRequest("https://ruutin.test/api/parent/devices/d3", "DELETE", headers, {}), deps.parent, "d3"));

  const household = await handleParentHousehold(new Request("https://ruutin.test/api/parent/household", { headers: readHeaders }), deps.parent);
  assert.equal(household.status, 200);
  assertPrivate(household);
  assert.match(await household.text(), /Home/u);
  const onboarding = await handleParentOnboarding(new Request("https://ruutin.test/api/parent/onboarding", { headers: readHeaders }), deps.parent);
  assert.equal(onboarding.status, 200);
  assertPrivate(onboarding);
  assert.doesNotMatch(await onboarding.text(), /Cai|h2|Other/u);

  await assertGenericForeign(await handleParentPairing(jsonRequest("https://ruutin.test/api/parent/pairing", "POST", headers, { profileId: "p3" }), deps.parent));
  const foreignPairingGet = await handleParentPairing(new Request("https://ruutin.test/api/parent/pairing?profileId=p3", { headers: readHeaders }), deps.parent);
  assert.equal(foreignPairingGet.status, 200);
  assertPrivate(foreignPairingGet);
  assert.doesNotMatch(await foreignPairingGet.text(), /p3|h2|Cai|Other/u);
  await assertGenericForeign(await handleParentClaims(jsonRequest("https://ruutin.test/api/parent/claims", "POST", headers, { claimId: "c3", decision: "reject" }), deps.claims));
  const claims = await handleParentClaims(new Request("https://ruutin.test/api/parent/claims", { headers: readHeaders }), deps.claims);
  assert.equal(claims.status, 200);
  assertPrivate(claims);
  assert.doesNotMatch(await claims.text(), /c3|Cai|h2|Other/u);
  const today = await handleParentToday(new Request("https://ruutin.test/api/parent/today", { headers: readHeaders }), deps.parent);
  assert.equal(today.status, 200);
  assertPrivate(today);
  assert.doesNotMatch(await today.text(), /Cai|h2|Other|t3|c3|q3/u);
  await assertGenericForeign(await handleParentCompletion(jsonRequest("https://ruutin.test/api/parent/completions", "POST", headers, { profileId: "p3", taskId: "t3" }), deps.claims));
  await assertGenericForeign(await handleParentLedger(new Request("https://ruutin.test/api/parent/ledger?profileId=p3", { headers: readHeaders }), deps.claims));
  await assertGenericForeign(await handleParentLedger(jsonRequest("https://ruutin.test/api/parent/ledger", "POST", headers, { action: "adjust", profileId: "p3", starsDelta: 1, reason: "Nope" }), deps.claims));
  await assertGenericForeign(await handleParentLedger(jsonRequest("https://ruutin.test/api/parent/ledger", "POST", headers, { action: "reverse", claimId: "c3", reason: "Nope" }), deps.claims));

  await assertGenericForeign(await handleParentRewards(new Request("https://ruutin.test/api/parent/rewards?profileId=p3", { headers: readHeaders }), deps.rewards));
  await assertGenericForeign(await handleParentRewards(jsonRequest("https://ruutin.test/api/parent/rewards", "POST", headers, { profileId: "p3", title: "Nope", emoji: "x", starCost: 1 }), deps.rewards));
  await assertGenericForeign(await handleParentReward(new Request("https://ruutin.test/api/parent/rewards/r3", { headers: readHeaders }), deps.rewards, "r3"));
  await assertGenericForeign(await handleParentReward(jsonRequest("https://ruutin.test/api/parent/rewards/r3", "PATCH", headers, { title: "Nope" }), deps.rewards, "r3"));
  await assertGenericForeign(await handleParentReward(jsonRequest("https://ruutin.test/api/parent/rewards/r3", "DELETE", headers, {}), deps.rewards, "r3"));
  await assertGenericForeign(await handleParentActiveReward(jsonRequest("https://ruutin.test/api/parent/rewards/active", "POST", headers, { profileId: "p3", rewardId: "r3" }), deps.rewards));
  await assertGenericForeign(await handleParentRewardRequests(new Request("https://ruutin.test/api/parent/rewards/requests?profileId=p3", { headers: readHeaders }), deps.rewards));
  await assertGenericForeign(await handleParentRewardRequests(jsonRequest("https://ruutin.test/api/parent/rewards/requests", "POST", headers, { requestId: "q3", decision: "reject" }), deps.rewards));

  const settings = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings", { headers: readHeaders }), deps.settings);
  assert.equal(settings.status, 200);
  assertPrivate(settings);
  assert.equal(settings.headers.get("referrer-policy"), "no-referrer");
  const settingsBody = await settings.text();
  assert.match(settingsBody, /parent@example\.test/u);
  assert.doesNotMatch(settingsBody, /other@example\.test|h2|Cai/u);
  const exportResponse = await handleParentHouseholdExport(new Request("https://ruutin.test/api/parent/settings/export", { headers: readHeaders }), deps.settings);
  assert.equal(exportResponse.status, 200);
  assertPrivate(exportResponse);
  assert.equal(exportResponse.headers.get("referrer-policy"), "no-referrer");
  assert.doesNotMatch(await exportResponse.text(), /Cai|h2|d3|device-hash-3|token_hash|code_hash/u);

  assert.equal(databaseValue(fixture, "SELECT count(*) AS count FROM child_profiles WHERE id = 'p3'"), 1);
  fixture.database.close();
});

function databaseValue(fixture: Fixture, query: string): number {
  return Number((fixture.database.prepare(query).get() as { count?: number } | undefined)?.count ?? 0);
}

test("BR-100 parent-only service guards reject forged caregiver/foreign contexts", async () => {
  const fixture = await createFixture();
  const caregiver = {
    ...parentContext(),
    role: "caregiver" as const,
    memberships: [{ householdId: "h1", role: "caregiver" as const }],
  };
  await assert.rejects(import("../server/profiles").then(({ listProfilesForParent }) => listProfilesForParent(fixture.db, caregiver)), ScopeError);
  await assert.rejects(import("../server/tasks").then(({ listTasksForParent }) => listTasksForParent(fixture.db, caregiver, "p1")), ScopeError);
  await assert.rejects(import("../server/devices").then(({ listDevicesForParent }) => listDevicesForParent(fixture.db, caregiver)), ScopeError);
  await assert.rejects(import("../server/households").then(({ getParentHousehold }) => getParentHousehold(fixture.db, caregiver)), ScopeError);
  await assert.rejects(import("../server/settings").then(({ getParentSettings }) => getParentSettings(fixture.db, caregiver)), /confirmation|required|not found/i);
  fixture.database.close();
});

test("BR-101 companion scope is assigned, sibling-safe, revoked on next request, and throttles last-seen writes", async () => {
  const fixture = await createFixture();
  const companionHeaders = companionCookie(fixture);
  const deps = routeDeps(fixture);
  fixture.database.prepare("UPDATE child_devices SET last_seen_at = ? WHERE id = 'd1'").run(TIMESTAMP);
  const context = await resolveCompanionContext(new Request("https://ruutin.test/companion/today", { headers: companionHeaders }), fixture.db, { sessionSecret: SESSION_SECRET, now: NOW });
  assert.ok(context);
  assert.equal(context.profileId, "p1");
  const today = await getCompanionToday(fixture.db, context, { now: NOW });
  assert.deepEqual(today.tasks.map((task) => task.id), ["t1"]);
  assert.doesNotMatch(JSON.stringify(today), /Bea|Cai|p2|p3|t2|t3/u);
  const rewards = await getCompanionRewards(fixture.db, context);
  assert.deepEqual(rewards.rewards.map((reward) => reward.id), ["r1"]);
  assert.doesNotMatch(JSON.stringify(rewards), /Dessert|Outing|Bea|Cai|r2|r3/u);

  const requestList = await handleCompanionRewardRequests(new Request("https://ruutin.test/api/companion/rewards/requests", { headers: companionHeaders }), deps.rewards);
  assert.equal(requestList.status, 200);
  assertPrivate(requestList);
  assert.doesNotMatch(await requestList.text(), /q2|q3|Bea|Cai|h2/u);
  await assertGenericForeign(await handleCompanionRewardRequests(jsonRequest("https://ruutin.test/api/companion/rewards/requests", "POST", { ...companionHeaders, Origin: "https://ruutin.test", "Content-Type": "application/json" }, { rewardId: "r2" }), deps.rewards), ["Bea", "Cai", "h2"]);
  await assertGenericForeign(await handleCompanionClaim(jsonRequest("https://ruutin.test/api/companion/today", "POST", { ...companionHeaders, Origin: "https://ruutin.test", "Content-Type": "application/json" }, { taskId: "t2" }), deps.claims), ["Bea", "Cai", "h2"]);

  const parentOnCompanion = await handleCompanionRewardRequests(new Request("https://ruutin.test/api/companion/rewards/requests", { headers: parentCookie(fixture) }), deps.rewards);
  assert.equal(parentOnCompanion.status, 401);
  const companionOnParent = await handleParentToday(new Request("https://ruutin.test/api/parent/today", { headers: companionHeaders }), deps.parent);
  assert.equal(companionOnParent.status, 401);
  const companionOnSettings = await handleParentSettings(new Request("https://ruutin.test/api/parent/settings", { headers: companionHeaders }), deps.settings);
  assert.equal(companionOnSettings.status, 401);

  const touched = fixture.database.prepare("SELECT last_seen_at AS lastSeenAt FROM child_devices WHERE id = 'd1'").get() as { lastSeenAt: string };
  assert.equal(touched.lastSeenAt, NOW.toISOString());
  await resolveCompanionContext(new Request("https://ruutin.test/companion/today", { headers: companionHeaders }), fixture.db, { sessionSecret: SESSION_SECRET, now: new Date(NOW.getTime() + 60_000) });
  const throttled = fixture.database.prepare("SELECT last_seen_at AS lastSeenAt FROM child_devices WHERE id = 'd1'").get() as { lastSeenAt: string };
  assert.equal(throttled.lastSeenAt, NOW.toISOString());

  fixture.database.prepare("UPDATE child_devices SET revoked_at = ? WHERE id = 'd1'").run(NOW.toISOString());
  const revoked = await handleCompanionRewardRequests(new Request("https://ruutin.test/api/companion/rewards/requests", { headers: companionHeaders }), deps.rewards);
  assert.equal(revoked.status, 401);
  fixture.database.prepare("UPDATE child_devices SET revoked_at = NULL, expires_at = ? WHERE id = 'd1'").run("2026-08-18T11:59:59.000Z");
  const expired = await handleCompanionRewardRequests(new Request("https://ruutin.test/api/companion/rewards/requests", { headers: companionHeaders }), deps.rewards);
  assert.equal(expired.status, 401);
  fixture.database.prepare("UPDATE child_devices SET expires_at = '2027-01-01T00:00:00.000Z' WHERE id = 'd1'").run();

  assert.throws(() => fixture.database.prepare("UPDATE child_devices SET child_profile_id = 'p2' WHERE id = 'd1'").run(), /immutable|scope/i);
  fixture.database.close();
});

test("BR-102 auth and pairing errors are generic, expiring, one-use, five-attempt, and source-limited", async () => {
  const fixture = await createFixture();
  const sender = new DeterministicEmailAdapter();
  const authDeps = { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, emailSender: sender, now: NOW };
  const csrfHeaders = {
    Origin: "https://ruutin.test",
    Cookie: `${fixture.csrf.cookie.split(";", 1)[0]}`,
    "x-ruutin-csrf": fixture.csrf.token,
    "Content-Type": "application/json",
  };
  const known = await handleTacRequest(jsonRequest("https://ruutin.test/api/auth/request", "POST", csrfHeaders, { email: "parent@example.test" }), authDeps);
  const unknown = await handleTacRequest(jsonRequest("https://ruutin.test/api/auth/request", "POST", csrfHeaders, { email: "unknown@example.test" }), authDeps);
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.doesNotMatch(JSON.stringify(await handleTacRequest(jsonRequest("https://ruutin.test/api/auth/request", "POST", csrfHeaders, { email: "unknown@example.test", code: "123456" }), authDeps)), /123456|parent@example|unknown@example|auth_challenges/u);

  const challenge = await createTacChallenge(fixture.db, "parent@example.test", AUTH_SECRET, { now: NOW, code: "123456", id: "g10-tac" });
  const storedTac = fixture.database.prepare("SELECT code_hash AS codeHash FROM auth_challenges WHERE id = 'g10-tac'").get() as { codeHash: string };
  assert.notEqual(storedTac.codeHash, challenge.code);
  assert.doesNotMatch(JSON.stringify(storedTac), /123456/u);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(verifyTac(fixture.db, "parent@example.test", "000000", AUTH_SECRET, { now: new Date(NOW.getTime() + attempt * 1000) }), TacVerificationError);
  }
  assert.equal((fixture.database.prepare("SELECT attempt_count AS count FROM auth_challenges WHERE id = 'g10-tac'").get() as { count: number }).count, 5);
  await assert.rejects(verifyTac(fixture.db, "parent@example.test", challenge.code, AUTH_SECRET, { now: NOW }), TacVerificationError);
  const expired = await createTacChallenge(fixture.db, "parent@example.test", AUTH_SECRET, { now: NOW, ttlMs: 1, code: "654321", id: "g10-expired" });
  await assert.rejects(verifyTac(fixture.db, "parent@example.test", expired.code, AUTH_SECRET, { now: new Date(NOW.getTime() + 2) }), TacVerificationError);

  const parent = parentContext();
  const pairing = await createPairingChallenge(fixture.db, parent, "p1", AUTH_SECRET, { now: NOW, code: "222222", pairingToken: "g".repeat(43), id: "g10-pair" });
  const pairingStored = fixture.database.prepare("SELECT code_hash AS codeHash, token_hash AS tokenHash FROM pairing_codes WHERE id = 'g10-pair'").get() as { codeHash: string; tokenHash: string };
  assert.doesNotMatch(JSON.stringify(pairingStored), /222222|g{43}/u);
  const preview = await handlePairing(jsonRequest("https://ruutin.test/api/pair", "POST", { Origin: "https://ruutin.test", "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.10", "X-Forwarded-For": "203.0.113.88" }, { token: pairing.pairingToken }), { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, now: NOW });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("referrer-policy") ?? "", /no-referrer/u);
  assertPrivate(preview);
  assert.doesNotMatch(await preview.text(), /222222|g{43}|codeHash|tokenHash/u);

  const noBatch = new SqliteD1Shim(fixture.database);
  await assert.rejects(consumePairingChallenge(noBatch, { token: pairing.pairingToken }, AUTH_SECRET, { now: NOW, sessionSecret: SESSION_SECRET }), PairingAtomicityError);

  const sourceRequests = (attempt: number) => jsonRequest("https://ruutin.test/api/pair", "POST", { Origin: "https://ruutin.test", "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${attempt + 1}` }, { code: "999999" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await handlePairing(sourceRequests(attempt), { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, now: new Date(NOW.getTime() + attempt * 1000) });
    assert.notEqual(response.status, 429);
  }
  const sixth = await handlePairing(sourceRequests(5), { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, now: new Date(NOW.getTime() + 5_000) });
  assert.equal(sixth.status, 429);
  assert.doesNotMatch(await sixth.text(), /999999|198\.51|203\.0\.113/u);
  assert.equal((fixture.database.prepare("SELECT attempt_count AS count FROM pairing_codes WHERE id = 'g10-pair'").get() as { count: number }).count, 0);
  assert.ok(Number((fixture.database.prepare("SELECT count(*) AS count FROM rate_limit_buckets").get() as { count: number }).count) > 0);

  const confirm = await handlePairing(jsonRequest("https://ruutin.test/api/pair", "POST", { Origin: "https://ruutin.test", "Content-Type": "application/json" }, { token: pairing.pairingToken, confirm: true }), { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, now: NOW });
  assert.equal(confirm.status, 201);
  assert.match(confirm.headers.get("set-cookie") ?? "", /__Host-ruutin_companion_session=.*Secure.*HttpOnly.*SameSite=Lax/u);
  assert.doesNotMatch(await confirm.text(), /222222|g{43}|token_hash|code_hash/u);
  const reused = await handlePairing(jsonRequest("https://ruutin.test/api/pair", "POST", { Origin: "https://ruutin.test", "Content-Type": "application/json" }, { token: pairing.pairingToken, confirm: true }), { db: fixture.db, authHmacSecret: AUTH_SECRET, sessionSecret: SESSION_SECRET, now: NOW });
  assert.equal(reused.status, 400);
  fixture.database.close();
});

test("BR-102 deletion TAC and auth cookies do not enumerate secrets or permit stale reuse", async () => {
  const fixture = await createFixture();
  const sender = new DeterministicEmailAdapter();
  const settings: SettingsRouteDependencies = {
    db: fixture.db,
    sessionSecret: SESSION_SECRET,
    authHmacSecret: AUTH_SECRET,
    emailSender: sender,
    now: NOW,
  };
  const headers = parentHeaders(fixture);
  const challenge = await handleHouseholdDeletionChallenge(jsonRequest("https://ruutin.test/api/parent/settings/deletion/challenge", "POST", headers, {}), settings);
  assert.equal(challenge.status, 202);
  assert.equal(challenge.headers.get("referrer-policy"), "no-referrer");
  assert.doesNotMatch(await challenge.text(), /\d{6}|parent@example|challengeId|delete_household/u);
  const code = sender.messages.at(-1)?.text.match(/\b\d{6}\b/u)?.[0];
  assert.ok(code);
  const wrong = await handleHouseholdDeletionVerify(jsonRequest("https://ruutin.test/api/parent/settings/deletion/verify", "POST", headers, { code: "000000" }), settings);
  assert.equal(wrong.status, 400);
  assert.doesNotMatch(await wrong.text(), /parent@example|delete_household|attempt/u);
  const verified = await handleHouseholdDeletionVerify(jsonRequest("https://ruutin.test/api/parent/settings/deletion/verify", "POST", headers, { code }), settings);
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get("set-cookie") ?? "", /Secure.*HttpOnly.*SameSite=Strict/u);
  assert.doesNotMatch(await verified.text(), /challengeId|session-h1|parent@example/u);
  const reused = await handleHouseholdDeletionVerify(jsonRequest("https://ruutin.test/api/parent/settings/deletion/verify", "POST", headers, { code }), settings);
  assert.equal(reused.status, 400);
  const stale = await handleHouseholdDeletion(new Request("https://ruutin.test/api/parent/settings/deletion", { method: "POST", headers: { ...headers, Cookie: `${headers.Cookie}; __Host-ruutin_delete_reauth=invalid` }, body: JSON.stringify({ confirmation: "DELETE" }) }), settings);
  assert.equal(stale.status, 403);
  assert.doesNotMatch(await stale.text(), /invalid|session-h1|h1/u);
  fixture.database.close();
});

test("BR-102 client source contains no server secret or raw credential transport", () => {
  const clientFiles = [
    "app/pair/PairFlow.tsx",
    "app/pair/PairingQr.tsx",
    "app/companion/CompanionShell.tsx",
    "app/companion/today/CompanionTodayManager.tsx",
    "app/companion/rewards/CompanionRewardsManager.tsx",
    "app/app/ParentShell.tsx",
    "app/app/family/PairingManager.tsx",
    "app/app/settings/SettingsManager.tsx",
  ];
  const source = clientFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /AUTH_HMAC_SECRET|SESSION_SECRET|EMAIL_API_KEY|token_hash|code_hash/u);
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem)[^\n]*(session|token|code)/iu);
});
