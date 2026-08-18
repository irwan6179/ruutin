import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  COMPANION_SESSION_COOKIE,
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  type CompanionContext,
  type D1DatabaseLike,
  type D1StatementLike,
  type ParentContext,
} from "../server/auth-context";
import {
  archiveRewardForParent,
  createRewardForParent,
  createRewardRequestForCompanion,
  listPendingRewardRequestsForParent,
  listRewardRequestsForCompanion,
  listRewardsForParent,
  resolveRewardRequestForParent,
  RewardInsufficientBalanceError,
  RewardLimitError,
  setActiveRewardForParent,
  updateRewardForParent,
} from "../server/rewards";
import {
  handleCompanionRewardRequests,
  handleParentRewardRequests,
  handleParentRewards,
} from "../server/reward-routes";
import { issueCsrfToken } from "../server/http-security";
import { REWARD_TEMPLATES } from "../shared/reward-templates";

const SECRET = "g07-session-secret-for-tests-0123456789";
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

function openDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  return database;
}

function createDb(databasePath = ":memory:"): { database: DatabaseSync; db: BatchedSqliteD1Shim } {
  const database = openDatabase(databasePath);
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
  profile.run("p2", "h1", "Bea", "🌸", "16_17", 1, timestamp);
  profile.run("p3", "h2", "Cai", "☀️", "13_15", 1, timestamp);
  const device = database.prepare(`INSERT INTO child_devices
    (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  device.run("d1", "h1", "p1", "Ari device", "device-hash-1", timestamp, timestamp);
  device.run("d2", "h1", "p2", "Bea device", "device-hash-2", timestamp, timestamp);
  device.run("d3", "h2", "p3", "Cai device", "device-hash-3", timestamp, timestamp);
  return { database, db: new BatchedSqliteD1Shim(database) };
}

function parent(householdId = "h1"): ParentContext {
  return {
    kind: "parent",
    sessionId: `session-${householdId}`,
    tokenHash: "parent-hash",
    userId: householdId === "h1" ? "u1" : "u2",
    householdId,
    role: "parent",
    memberships: [{ householdId, role: "parent" }],
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
}

function companion(profileId = "p1"): CompanionContext {
  const deviceId = profileId === "p1" ? "d1" : profileId === "p2" ? "d2" : "d3";
  return {
    kind: "companion",
    deviceId,
    tokenHash: `device-hash-${profileId === "p1" ? "1" : profileId === "p2" ? "2" : "3"}`,
    householdId: profileId === "p3" ? "h2" : "h1",
    profileId,
    profile: { nickname: profileId === "p1" ? "Ari" : profileId === "p2" ? "Bea" : "Cai", emoji: "🌿" },
    expiresAt: null,
  };
}

function seedStars(database: DatabaseSync, profileId: string, stars: number, sourceId: string): void {
  database.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta,
     source_type, source_id, reason, actor_user_id, local_date, created_at)
    VALUES (?, 'h1', ?, 'manual_adjustment', ?, 'test', ?, 'Fixture stars', 'u1', '2026-08-18', ?)`)
    .run(`ledger-${sourceId}`, profileId, stars, sourceId, timestamp);
}

async function seedReward(
  db: D1DatabaseLike,
  profileId = "p1",
  rewardId = `reward-${profileId}`,
  starCost = 3,
): Promise<{ id: string; starCost: number }> {
  const reward = await createRewardForParent(
    db,
    parent(profileId === "p3" ? "h2" : "h1"),
    { profileId, title: `Reward ${rewardId}`, emoji: "🎁", starCost },
    { rewardId, now: new Date(timestamp) },
  );
  return { id: reward.id, starCost: reward.starCost };
}

function parentSessionHeaders(rawToken: string, csrf: { token: string; cookie: string }): Record<string, string> {
  return {
    Origin: "https://ruutin.test",
    Cookie: `${PARENT_SESSION_COOKIE}=${rawToken}; ${csrf.cookie.split(";", 1)[0]}`,
    "x-ruutin-csrf": csrf.token,
    "Content-Type": "application/json",
  };
}

test("reward templates are typed source data and are not D1 rows", () => {
  assert.deepEqual(
    REWARD_TEMPLATES.map(({ title, starCost }) => ({ title, starCost })),
    [
      { title: "Choose the family movie", starCost: 10 },
      { title: "Choose dessert", starCost: 10 },
      { title: "Extra leisure time", starCost: 20 },
      { title: "Choose a weekend activity", starCost: 30 },
      { title: "Special family outing", starCost: 50 },
    ],
  );
  const { database } = createDb();
  assert.throws(() => database.prepare("SELECT * FROM reward_templates").all(), /no such table/i);
  database.close();
});

test("parent reward CRUD is household/profile scoped and active selection is safe", async () => {
  const { database, db } = createDb();
  const reward = await seedReward(db, "p1", "reward-crud", 5);
  const updated = await updateRewardForParent(
    db,
    parent(),
    reward.id,
    { title: "Movie night", emoji: "🎬", starCost: 7 },
    { now: new Date(timestamp) },
  );
  assert.deepEqual(
    { title: updated.title, emoji: updated.emoji, starCost: updated.starCost },
    { title: "Movie night", emoji: "🎬", starCost: 7 },
  );
  await assert.rejects(
    createRewardForParent(db, parent(), { profileId: "p1", title: "Invalid", emoji: "🎁", starCost: 0 }),
    /positive|invalid/i,
  );
  await assert.rejects(
    updateRewardForParent(db, parent(), reward.id, { starCost: -1 }),
    /positive|invalid/i,
  );
  await assert.rejects(
    createRewardForParent(db, parent(), { profileId: "p3", title: "Foreign", emoji: "🎁", starCost: 1 }),
    /not found|scope/i,
  );
  await assert.rejects(
    createRewardForParent(
      db,
      { ...parent(), role: "caregiver", memberships: [{ householdId: "h1", role: "caregiver" }] },
      { profileId: "p1", title: "Caregiver", emoji: "🎁", starCost: 1 },
    ),
    /not found|scope/i,
  );
  const selected = await setActiveRewardForParent(db, parent(), "p1", reward.id);
  assert.equal(selected?.id, reward.id);
  assert.equal(database.prepare("SELECT active_reward_id AS active FROM child_profiles WHERE id = 'p1'").get()?.active, reward.id);
  const archived = await archiveRewardForParent(db, parent(), reward.id, { now: new Date(timestamp) });
  assert.ok(archived.archivedAt);
  assert.equal(database.prepare("SELECT active_reward_id AS active FROM child_profiles WHERE id = 'p1'").get()?.active, null);
  assert.equal((await listRewardsForParent(db, parent(), "p1")).length, 1);
  await assert.rejects(setActiveRewardForParent(db, parent(), "p1", reward.id), /not found|scope/i);
  const noBatch = new SqliteD1Shim(database);
  const second = await seedReward(db, "p1", "reward-no-batch", 2);
  await assert.rejects(archiveRewardForParent(noBatch, parent(), second.id), /temporarily unavailable/i);
  assert.equal(database.prepare("SELECT archived_at AS archived FROM rewards WHERE id = ?").get(second.id)?.archived, null);
  database.close();
});

test("independent connections cannot create more than five active rewards", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ruutin-g07-limit-"));
  const databasePath = join(directory, "rewards.sqlite");
  const first = createDb(databasePath);
  const connections = [first.db];
  const databases = [first.database];
  for (let index = 1; index < 6; index += 1) {
    const database = openDatabase(databasePath);
    databases.push(database);
    connections.push(new BatchedSqliteD1Shim(database));
  }
  try {
    const results = await Promise.allSettled(
      connections.map((db, index) => createRewardForParent(
        db,
        parent(),
        { profileId: "p1", title: `Goal ${index}`, emoji: "🎯", starCost: index + 1 },
        { rewardId: `limit-${index}`, now: new Date(timestamp) },
      )),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof RewardLimitError).length, 1);
    assert.equal(first.database.prepare("SELECT count(*) AS count FROM rewards WHERE household_id = 'h1' AND child_profile_id = 'p1' AND archived_at IS NULL").get()?.count, 5);
  } finally {
    for (const database of databases) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("companion requests are assigned-profile scoped, duplicate-safe, and do not deduct stars", async () => {
  const { database, db } = createDb();
  const firstReward = await seedReward(db, "p1", "reward-p1", 3);
  const secondReward = await seedReward(db, "p2", "reward-p2", 2);
  seedStars(database, "p1", 10, "stars-p1");
  const before = database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance;
  const request = await createRewardRequestForCompanion(db, companion(), firstReward.id, { requestId: "request-p1", now: new Date(timestamp) });
  assert.equal(request.status, "pending");
  assert.equal(database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, before);
  await assert.rejects(
    createRewardRequestForCompanion(db, companion(), firstReward.id, { requestId: "request-p1-retry", now: new Date(timestamp) }),
    /conflict|active|already/i,
  );
  await assert.rejects(createRewardRequestForCompanion(db, companion("p2"), firstReward.id), /not found|scope/i);
  await assert.rejects(createRewardRequestForCompanion(db, { ...companion(), profileId: "p2" }, secondReward.id), /not found|scope/i);
  assert.deepEqual((await listPendingRewardRequestsForParent(db, parent())).map((row) => row.id), ["request-p1"]);
  assert.deepEqual((await listRewardRequestsForCompanion(db, companion())).map((row) => row.id), ["request-p1"]);
  database.prepare(`INSERT INTO child_devices
    (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
    VALUES ('d4', 'h1', 'p1', 'Ari replacement', 'device-hash-4', ?, ?)`)
    .run(timestamp, timestamp);
  assert.deepEqual((await listRewardRequestsForCompanion(db, {
    ...companion(),
    deviceId: "d4",
    tokenHash: "device-hash-4",
  })).map((row) => row.id), ["request-p1"]);
  assert.deepEqual((await listRewardRequestsForCompanion(db, companion("p2"))).map((row) => row.id), []);
  database.close();
});

test("independent companion requests keep one pending row per reward", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ruutin-g07-request-"));
  const databasePath = join(directory, "requests.sqlite");
  const first = createDb(databasePath);
  const secondDatabase = openDatabase(databasePath);
  const second = new BatchedSqliteD1Shim(secondDatabase);
  try {
    const reward = await seedReward(first.db, "p1", "reward-request-race", 2);
    const results = await Promise.allSettled([
      createRewardRequestForCompanion(first.db, companion(), reward.id, { requestId: "request-race-a", now: new Date(timestamp) }),
      createRewardRequestForCompanion(second, companion(), reward.id, { requestId: "request-race-b", now: new Date(timestamp) }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(first.database.prepare("SELECT count(*) AS count FROM reward_requests WHERE status = 'pending'").get()?.count, 1);
  } finally {
    first.database.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reward approval is atomic, balance-derived, idempotent, and rejection has no ledger effect", async () => {
  const { database, db } = createDb();
  const reward = await seedReward(db, "p1", "reward-approve", 3);
  seedStars(database, "p1", 10, "stars-approve");
  await createRewardRequestForCompanion(db, companion(), reward.id, { requestId: "request-approve", now: new Date(timestamp) });
  const results = await Promise.allSettled([
    resolveRewardRequestForParent(db, parent(), "request-approve", "approve", { now: new Date(timestamp) }),
    resolveRewardRequestForParent(db, parent(), "request-approve", "approve", { now: new Date(timestamp) }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'reward_redeemed'").get()?.count, 1);
  assert.equal(database.prepare("SELECT stars_delta AS delta FROM point_ledger WHERE event_type = 'reward_redeemed'").get()?.delta, -3);
  const ledger = database.prepare("SELECT actor_user_id AS actor, local_date AS localDate, reason FROM point_ledger WHERE event_type = 'reward_redeemed'").get() as {
    actor: string;
    localDate: string;
    reason: string;
  };
  assert.equal(ledger.actor, "u1");
  assert.equal(ledger.localDate, "2026-08-18");
  assert.equal(ledger.reason, "Reward approved by parent");
  assert.equal(database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, 7);
  const repeated = await resolveRewardRequestForParent(db, parent(), "request-approve", "approve", { now: new Date(timestamp) });
  assert.equal(repeated.balance, 7);
  await assert.rejects(resolveRewardRequestForParent(db, parent(), "request-approve", "reject"), /already|resolved/i);

  const rejectedReward = await seedReward(db, "p1", "reward-reject", 2);
  await createRewardRequestForCompanion(db, companion(), rejectedReward.id, { requestId: "request-reject", now: new Date(timestamp) });
  const rejected = await resolveRewardRequestForParent(db, parent(), "request-reject", "reject", { now: new Date(timestamp) });
  assert.equal(rejected.request.status, "rejected");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE source_id = 'request-reject'").get()?.count, 0);
  const retried = await createRewardRequestForCompanion(db, companion(), rejectedReward.id, { requestId: "request-retry", now: new Date(timestamp) });
  assert.equal(retried.status, "pending");
  database.close();
});

test("reward approval never goes negative and fails closed without D1 batch", async () => {
  const { database, db } = createDb();
  const reward = await seedReward(db, "p1", "reward-insufficient", 3);
  await createRewardRequestForCompanion(db, companion(), reward.id, { requestId: "request-insufficient", now: new Date(timestamp) });
  await assert.rejects(
    resolveRewardRequestForParent(db, parent(), "request-insufficient", "approve", { now: new Date(timestamp) }),
    (error: unknown) => error instanceof RewardInsufficientBalanceError,
  );
  assert.equal(database.prepare("SELECT status FROM reward_requests WHERE id = 'request-insufficient'").get()?.status, "pending");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'reward_redeemed'").get()?.count, 0);

  const noBatch = new SqliteD1Shim(database);
  seedStars(database, "p1", 10, "stars-no-batch");
  const batchedReward = await seedReward(db, "p1", "reward-no-batch-approve", 3);
  await createRewardRequestForCompanion(db, companion(), batchedReward.id, { requestId: "request-no-batch", now: new Date(timestamp) });
  await assert.rejects(
    resolveRewardRequestForParent(noBatch, parent(), "request-no-batch", "approve", { now: new Date(timestamp) }),
    /temporarily unavailable/i,
  );
  assert.equal(database.prepare("SELECT status FROM reward_requests WHERE id = 'request-no-batch'").get()?.status, "pending");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE source_id = 'request-no-batch'").get()?.count, 0);
  database.close();
});

test("reward approval is idempotent across independent database connections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ruutin-g07-approval-"));
  const databasePath = join(directory, "approval.sqlite");
  const first = createDb(databasePath);
  const secondDatabase = openDatabase(databasePath);
  const second = new BatchedSqliteD1Shim(secondDatabase);
  try {
    const reward = await seedReward(first.db, "p1", "reward-cross-connection", 4);
    seedStars(first.database, "p1", 4, "stars-cross-connection");
    await createRewardRequestForCompanion(first.db, companion(), reward.id, { requestId: "request-cross-connection", now: new Date(timestamp) });
    const results = await Promise.allSettled([
      resolveRewardRequestForParent(first.db, parent(), "request-cross-connection", "approve", { now: new Date(timestamp) }),
      resolveRewardRequestForParent(second, parent(), "request-cross-connection", "approve", { now: new Date(timestamp) }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(first.database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'reward_redeemed'").get()?.count, 1);
    assert.equal(first.database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, 0);
  } finally {
    first.database.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reward routes enforce session scope, CSRF/origin, generic foreign errors, and private responses", async () => {
  const { database, db } = createDb();
  const reward = await seedReward(db, "p1", "reward-route", 2);
  const foreign = await seedReward(db, "p3", "reward-foreign", 2);
  const rawParent = "parent-token-g07-012345678901234567890";
  const parentHash = await hashOpaqueToken(rawParent, SECRET);
  database.prepare(`INSERT INTO sessions
    (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("session-route", "u1", parentHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const parentCookie = parentSessionHeaders(rawParent, csrf);
  const list = await handleParentRewards(
    new Request("https://ruutin.test/api/parent/rewards?profileId=p1", { headers: { Cookie: parentCookie.Cookie as string } }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(list.status, 200);
  assert.match(list.headers.get("cache-control") ?? "", /private, no-store/);
  const listBody = await list.json() as { rewards: Array<{ id: string }>; templates: unknown[] };
  assert.deepEqual(listBody.rewards.map((item) => item.id), [reward.id]);
  assert.equal(listBody.templates.length, 5);

  const missingCsrf = await handleParentRewards(
    new Request("https://ruutin.test/api/parent/rewards", {
      method: "POST",
      headers: { Origin: "https://ruutin.test", Cookie: parentCookie.Cookie as string, "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "p1", title: "Missing CSRF", emoji: "🎁", starCost: 1 }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(missingCsrf.status, 403);
  const created = await handleParentRewards(
    new Request("https://ruutin.test/api/parent/rewards", {
      method: "POST",
      headers: parentCookie,
      body: JSON.stringify({ profileId: "p1", title: "Route reward", emoji: "🎁", starCost: 1 }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(created.status, 201);

  const foreignResponse = await handleParentRewards(
    new Request("https://ruutin.test/api/parent/rewards?profileId=p3", { headers: { Cookie: parentCookie.Cookie as string } }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(foreignResponse.status, 404);
  assert.doesNotMatch(await foreignResponse.text(), /Other|Cai|h2|p3|Foreign/);
  const foreignIdResponse = await handleParentRewards(
    new Request("https://ruutin.test/api/parent/rewards", {
      method: "POST",
      headers: parentCookie,
      body: JSON.stringify({ profileId: "p1", title: "Probe", emoji: "🎁", starCost: 1, rewardId: foreign.id }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(foreignIdResponse.status, 400);

  const rawDevice = "device-token-g07-route-012345678901234567890";
  const deviceHash = await hashOpaqueToken(rawDevice, SECRET);
  database.prepare("UPDATE child_devices SET token_hash = ? WHERE id = 'd1'").run(deviceHash);
  const companionCookie = `${COMPANION_SESSION_COOKIE}=${rawDevice}`;
  const companionRequest = await handleCompanionRewardRequests(
    new Request("https://ruutin.test/api/companion/rewards/requests", {
      method: "POST",
      headers: { Origin: "https://ruutin.test", Cookie: companionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId: reward.id, profileId: "p2" }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(companionRequest.status, 400);
  const validCompanionRequest = await handleCompanionRewardRequests(
    new Request("https://ruutin.test/api/companion/rewards/requests", {
      method: "POST",
      headers: { Origin: "https://ruutin.test", Cookie: companionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId: reward.id }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(validCompanionRequest.status, 201);
  assert.match(validCompanionRequest.headers.get("cache-control") ?? "", /private, no-store/);
  const companionCannotParent = await handleParentRewardRequests(
    new Request("https://ruutin.test/api/parent/rewards/requests", { headers: { Cookie: companionCookie } }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(companionCannotParent.status, 401);
  database.close();
});

test("under-13 companion direct route is denied and retained device revocation fails closed", async () => {
  const { database, db } = createDb();
  const reward = await seedReward(db, "p1", "reward-underage", 2);
  const rawDevice = "device-token-g07-underage-012345678901234567890";
  const deviceHash = await hashOpaqueToken(rawDevice, SECRET);
  database.prepare("UPDATE child_devices SET token_hash = ? WHERE id = 'd1'").run(deviceHash);
  database.prepare("UPDATE child_profiles SET age_band = 'under_13', companion_access_eligible = 0 WHERE id = 'p1'").run();
  const underage = await handleCompanionRewardRequests(
    new Request("https://ruutin.test/api/companion/rewards/requests", {
      method: "POST",
      headers: { Origin: "https://ruutin.test", Cookie: `${COMPANION_SESSION_COOKIE}=${rawDevice}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId: reward.id }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(underage.status, 401);
  database.prepare("UPDATE child_profiles SET age_band = '13_15', companion_access_eligible = 1 WHERE id = 'p1'").run();
  const request = await createRewardRequestForCompanion(db, companion(), reward.id, { requestId: "request-revoke", now: new Date(timestamp) });
  assert.equal(request.status, "pending");
  database.prepare("UPDATE child_devices SET revoked_at = ? WHERE id = 'd1'").run(timestamp);
  const revoked = await handleCompanionRewardRequests(
    new Request("https://ruutin.test/api/companion/rewards/requests", { headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawDevice}` } }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(revoked.status, 401);
  database.close();
});
