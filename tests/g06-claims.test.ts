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
  claimCompanionTask,
  completeTaskForParent,
  createManualAdjustmentForParent,
  getLedgerForParent,
  listPendingClaimsForParent,
  resolveTaskClaimForParent,
  reverseTaskLedgerForParent,
} from "../server/claims";
import { handleCompanionClaim, handleParentClaims, handleParentLedger } from "../server/claim-routes";
import { issueCsrfToken } from "../server/http-security";
import { listTaskOccurrencesForParent } from "../server/tasks";

const SECRET = "g06-session-secret-for-tests-0123456789";
const timestamp = "2026-08-18T00:00:00.000Z";
const migrations = [
  "drizzle/0000_careless_colossus.sql",
  "drizzle/0001_cool_lake.sql",
  "drizzle/0002_old_ben_parker.sql",
  "drizzle/0003_g01_integrity.sql",
  "drizzle/0004_sleepy_power_pack.sql",
  "drizzle/0005_past_shadow_king.sql",
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

function createDb(databasePath = ":memory:"): { database: DatabaseSync; db: BatchedSqliteD1Shim } {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", timestamp);
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u2", "other@example.test", "other@example.test", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h1", "Home", "Asia/Kuala_Lumpur", timestamp);
  database.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run("h2", "Other", "UTC", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h1", "u1", timestamp);
  database.prepare("INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, 'parent', ?)").run("h2", "u2", timestamp);
  const profile = database.prepare(`INSERT INTO child_profiles
    (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
    VALUES (?, ?, ?, ?, '13_15', 1, ?)`);
  profile.run("p1", "h1", "Ari", "🌿", timestamp);
  profile.run("p2", "h1", "Bea", "🌸", timestamp);
  profile.run("p3", "h2", "Cai", "☀️", timestamp);
  const task = database.prepare(`INSERT INTO tasks
    (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
     schedule_data, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'daily', '{"type":"daily"}', ?, ?, ?)`);
  task.run("t1", "h1", "p1", "Brush teeth", "🪥", 2, 0, timestamp, timestamp);
  task.run("t2", "h1", "p2", "Read", "📖", 1, 0, timestamp, timestamp);
  task.run("t3", "h1", "p1", "Pack bag", "🎒", 3, 1, timestamp, timestamp);
  database.prepare(`INSERT INTO tasks
    (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
     schedule_data, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'one_off', ?, ?, ?, ?)`).run(
    "t4", "h1", "p1", "Water plants", "💧", 1,
    '{"type":"one_off","localDate":"2026-08-18"}', 2, timestamp, timestamp,
  );
  database.prepare(`INSERT INTO child_devices
    (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
    VALUES ('d1', 'h1', 'p1', 'Ari device', 'device-hash', ?, ?)`).run(timestamp, timestamp);
  return { database, db: new BatchedSqliteD1Shim(database) };
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

function companion(profileId = "p1"): CompanionContext {
  return {
    kind: "companion",
    deviceId: "d1",
    tokenHash: "device-hash",
    householdId: "h1",
    profileId,
    profile: { nickname: profileId === "p1" ? "Ari" : "Bea", emoji: profileId === "p1" ? "🌿" : "🌸" },
    expiresAt: null,
  };
}

test("ledger is append-only, balance is derived, and manual adjustment is idempotent", async () => {
  const { database, db } = createDb();
  const first = await createManualAdjustmentForParent(db, parent(), { profileId: "p1", starsDelta: 2, reason: "Kindness", requestId: "manual-1" }, { now: new Date(timestamp) });
  const repeated = await createManualAdjustmentForParent(db, parent(), { profileId: "p1", starsDelta: 2, reason: "Different retry", requestId: "manual-1" }, { now: new Date("2026-08-17T16:00:00.000Z") });
  assert.equal(first.balance, 2);
  assert.equal(repeated.balance, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger").get()?.count, 1);
  assert.equal(database.prepare("SELECT reason, actor_user_id AS actor FROM point_ledger").get()?.actor, "u1");
  assert.throws(() => database.prepare("UPDATE point_ledger SET stars_delta = 99").run(), /append-only/i);
  assert.throws(() => database.prepare("DELETE FROM point_ledger").run(), /append-only/i);
  const ledger = await getLedgerForParent(db, parent(), "p1");
  assert.equal(ledger.balance, 2);
  assert.equal(ledger.entries[0]?.localDate, "2026-08-18");
  assert.match(ledger.entries[0]?.sourceId ?? "", /^manual:h1:u1:manual-1$/);
});

test("multi-statement claim transitions fail closed without an atomic batch", async () => {
  const { database, db } = createDb();
  const noBatch = new SqliteD1Shim(database);
  await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-no-batch" });

  await assert.rejects(
    resolveTaskClaimForParent(noBatch, parent(), "claim-no-batch", "approve", { now: new Date(timestamp) }),
    /temporarily unavailable/i,
  );
  assert.equal(database.prepare("SELECT status FROM task_claims WHERE id = 'claim-no-batch'").get()?.status, "pending");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger").get()?.count, 0);

  await assert.rejects(
    completeTaskForParent(noBatch, parent(), { profileId: "p1", taskId: "t3" }, { now: new Date(timestamp) }),
    /temporarily unavailable/i,
  );
  assert.equal(database.prepare("SELECT count(*) AS count FROM task_claims WHERE task_id = 't3'").get()?.count, 0);
});

test("approval idempotency survives independent database connections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ruutin-g06-"));
  const databasePath = join(directory, "claims.sqlite");
  const first = createDb(databasePath);
  const secondDatabase = new DatabaseSync(databasePath);
  secondDatabase.exec("PRAGMA foreign_keys = ON");
  const second = new BatchedSqliteD1Shim(secondDatabase);
  try {
    await claimCompanionTask(first.db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-cross-connection" });
    const results = await Promise.allSettled([
      resolveTaskClaimForParent(first.db, parent(), "claim-cross-connection", "approve", { now: new Date(timestamp) }),
      resolveTaskClaimForParent(second, parent(), "claim-cross-connection", "approve", { now: new Date(timestamp) }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(first.database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'task_approved'").get()?.count, 1);
    assert.equal(first.database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, 2);
  } finally {
    first.database.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("companion claims are due, profile-scoped, duplicate-safe, and return authoritative waiting state", async () => {
  const { db } = createDb();
  const first = await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-1" });
  assert.equal(first.claim.status, "pending");
  assert.equal(first.today.tasks.find((task) => task.id === "t1")?.state, "waiting");
  await assert.rejects(claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-2" }), /active claim|already/i);
  await assert.rejects(claimCompanionTask(db, companion(), "t2", { now: new Date(timestamp) }), /not found|scope/i);
  await assert.rejects(claimCompanionTask(db, companion(), "t4", { now: new Date("2026-08-19T00:00:00.000Z") }), /not due|active claim/i);
  const nextDay = await claimCompanionTask(db, companion(), "t1", { now: new Date("2026-08-19T00:00:00.000Z"), claimId: "claim-next" });
  assert.equal(nextDay.claim.dueDate, "2026-08-19");
  const pending = await listPendingClaimsForParent(db, parent());
  assert.deepEqual(pending.map((claim) => [claim.id, claim.nickname, claim.taskTitle]), [
    ["claim-1", "Ari", "Brush teeth"],
    ["claim-next", "Ari", "Brush teeth"],
  ]);
});

test("direct companion completion awards once while the review path remains available", async () => {
  const { database, db } = createDb();
  const completed = await claimCompanionTask(db, companion(), "t1", {
    now: new Date(timestamp),
    claimId: "claim-direct",
    reviewEnabled: false,
  });
  assert.equal(completed.claim.status, "approved");
  assert.equal(completed.today.tasks.find((task) => task.id === "t1")?.state, "completed");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE source_type = 'task_claim'").get()?.count, 1);
  assert.equal(database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, 2);
  await assert.rejects(
    claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), reviewEnabled: false }),
    /active claim|already/i,
  );
  assert.equal((await listPendingClaimsForParent(db, parent())).length, 0);
});

test("approval is one transaction, repeated/concurrent approval awards exactly once, and rejection awards nothing", async () => {
  const { database, db } = createDb();
  await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-approve" });
  const results = await Promise.allSettled([
    resolveTaskClaimForParent(db, parent(), "claim-approve", "approve", { now: new Date(timestamp) }),
    resolveTaskClaimForParent(db, parent(), "claim-approve", "approve", { now: new Date(timestamp) }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'task_approved'").get()?.count, 1);
  assert.equal(database.prepare("SELECT COALESCE(sum(stars_delta), 0) AS balance FROM point_ledger WHERE child_profile_id = 'p1'").get()?.balance, 2);

  await claimCompanionTask(db, companion(), "t3", { now: new Date(timestamp), claimId: "claim-reject" });
  const rejected = await resolveTaskClaimForParent(db, parent(), "claim-reject", "reject", { now: new Date(timestamp) });
  assert.equal(rejected.claim.status, "rejected");
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE source_id = 'claim-reject'").get()?.count, 0);
  const reclaimed = await claimCompanionTask(db, companion(), "t3", { now: new Date(timestamp), claimId: "claim-retry" });
  assert.equal(reclaimed.claim.status, "pending");
});

test("parent direct completion is idempotent and never double-awards an approved companion occurrence", async () => {
  const { database, db } = createDb();
  await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-companion" });
  await resolveTaskClaimForParent(db, parent(), "claim-companion", "approve", { now: new Date(timestamp) });
  const noDouble = await completeTaskForParent(db, parent(), { profileId: "p1", taskId: "t1", dueDate: "2026-08-18" }, { now: new Date(timestamp) });
  assert.equal(noDouble.balance, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE source_type = 'task_occurrence'").get()?.count, 0);

  const first = await completeTaskForParent(db, parent(), { profileId: "p1", taskId: "t3" }, { now: new Date(timestamp) });
  const repeated = await completeTaskForParent(db, parent(), { profileId: "p1", taskId: "t3" }, { now: new Date(timestamp) });
  assert.equal(first.balance, 5);
  assert.equal(repeated.balance, 5);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'parent_completed_task'").get()?.count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM task_claims WHERE task_id = 't3' AND status = 'approved'").get()?.count, 1);
});

test("parent completion resolves a pending companion claim once and reversal is compensating", async () => {
  const { database, db } = createDb();
  await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-pending" });
  const completed = await completeTaskForParent(db, parent(), { profileId: "p1", taskId: "t1" }, { now: new Date(timestamp) });
  assert.equal(completed.balance, 2);
  assert.equal(database.prepare("SELECT status FROM task_claims WHERE id = 'claim-pending'").get()?.status, "approved");
  const reversed = await reverseTaskLedgerForParent(db, parent(), "claim-pending", "Award corrected", { now: new Date("2026-08-19T00:00:00.000Z") });
  assert.equal(reversed.entry.eventType, "task_reversed");
  assert.equal(reversed.entry.starsDelta, -2);
  assert.equal(reversed.balance, 0);
  const repeated = await reverseTaskLedgerForParent(db, parent(), "claim-pending", "Retry", { now: new Date("2026-08-19T00:00:00.000Z") });
  assert.equal(repeated.balance, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'task_reversed'").get()?.count, 1);
  const today = await listTaskOccurrencesForParent(db, parent(), "p1", { now: new Date(timestamp) });
  assert.equal(today.occurrences.find((task) => task.id === "t1")?.awardReversed, true);
});

test("claim routes enforce parent CSRF, companion origin, private responses, and household scope", async () => {
  const { database, db } = createDb();
  const rawParent = "parent-token-g06-012345678901234567890";
  const parentHash = await hashOpaqueToken(rawParent, SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s1", "u1", parentHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const parentCookie = `${PARENT_SESSION_COOKIE}=${rawParent}; ${csrf.cookie.split(";", 1)[0]}`;
  await claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-route" });
  const missingCsrf = await handleParentClaims(new Request("https://ruutin.test/api/parent/claims", { method: "POST", headers: { Origin: "https://ruutin.test", Cookie: parentCookie, "Content-Type": "application/json" }, body: JSON.stringify({ claimId: "claim-route", decision: "approve" }) }), { db, sessionSecret: SECRET, now: new Date(timestamp) });
  assert.equal(missingCsrf.status, 403);
  const approved = await handleParentClaims(new Request("https://ruutin.test/api/parent/claims", { method: "POST", headers: { Origin: "https://ruutin.test", Cookie: parentCookie, "x-ruutin-csrf": csrf.token, "Content-Type": "application/json" }, body: JSON.stringify({ claimId: "claim-route", decision: "approve" }) }), { db, sessionSecret: SECRET, now: new Date(timestamp) });
  assert.equal(approved.status, 200);
  assert.match(approved.headers.get("cache-control") ?? "", /private, no-store/);

  const rawDevice = "device-token-g06-012345678901234567890";
  const deviceHash = await hashOpaqueToken(rawDevice, SECRET);
  database.prepare("UPDATE child_devices SET token_hash = ? WHERE id = 'd1'").run(deviceHash);
  const invalidOrigin = await handleCompanionClaim(new Request("https://ruutin.test/api/companion/today", { method: "POST", headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawDevice}`, Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify({ taskId: "t3" }) }), { db, sessionSecret: SECRET, now: new Date(timestamp) });
  assert.equal(invalidOrigin.status, 403);
  const foreign = await handleParentClaims(new Request("https://ruutin.test/api/parent/claims?householdId=h2", { headers: { Cookie: parentCookie } }), { db, sessionSecret: SECRET, now: new Date(timestamp) });
  assert.equal(foreign.status, 200);
  assert.doesNotMatch(await foreign.text(), /Other|Cai|h2/);
});

test("manual adjustments derive source/local date server-side and expose a scoped ledger query", async () => {
  const { database, db } = createDb();
  const rawParent = "parent-token-g06-ledger-012345678901234567890";
  const parentHash = await hashOpaqueToken(rawParent, SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s-ledger", "u1", parentHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const parentCookie = `${PARENT_SESSION_COOKIE}=${rawParent}; ${csrf.cookie.split(";", 1)[0]}`;
  const requestOptions = {
    method: "POST",
    headers: {
      Origin: "https://ruutin.test",
      Cookie: parentCookie,
      "x-ruutin-csrf": csrf.token,
      "Content-Type": "application/json",
    },
  } as const;
  const first = await handleParentLedger(
    new Request("https://ruutin.test/api/parent/ledger", {
      ...requestOptions,
      body: JSON.stringify({ action: "adjust", profileId: "p1", starsDelta: 2, reason: "Kindness", requestId: "adjust-1" }),
    }),
    { db, sessionSecret: SECRET, now: new Date("2026-08-17T16:00:00.000Z") },
  );
  assert.equal(first.status, 201);
  assert.match(first.headers.get("cache-control") ?? "", /private, no-store/);
  const repeated = await handleParentLedger(
    new Request("https://ruutin.test/api/parent/ledger", {
      ...requestOptions,
      body: JSON.stringify({ action: "adjust", profileId: "p1", starsDelta: 2, reason: "Retry wording", requestId: "adjust-1" }),
    }),
    { db, sessionSecret: SECRET, now: new Date("2026-08-18T16:00:00.000Z") },
  );
  assert.equal(repeated.status, 201);
  assert.equal(database.prepare("SELECT count(*) AS count FROM point_ledger WHERE event_type = 'manual_adjustment'").get()?.count, 1);
  assert.equal(database.prepare("SELECT local_date AS localDate FROM point_ledger WHERE event_type = 'manual_adjustment'").get()?.localDate, "2026-08-18");

  const clientOverrides = await handleParentLedger(
    new Request("https://ruutin.test/api/parent/ledger", {
      ...requestOptions,
      body: JSON.stringify({ action: "adjust", profileId: "p1", starsDelta: 1, reason: "No override", sourceId: "forged", localDate: "1900-01-01" }),
    }),
    { db, sessionSecret: SECRET, now: new Date("2026-08-18T16:00:00.000Z") },
  );
  assert.equal(clientOverrides.status, 400);

  const foreignProfile = await handleParentLedger(
    new Request("https://ruutin.test/api/parent/ledger", {
      ...requestOptions,
      body: JSON.stringify({ action: "adjust", profileId: "p3", starsDelta: 1, reason: "Probe", requestId: "foreign-1" }),
    }),
    { db, sessionSecret: SECRET, now: new Date("2026-08-18T16:00:00.000Z") },
  );
  assert.equal(foreignProfile.status, 404);
  assert.doesNotMatch(await foreignProfile.text(), /Other|Cai|h2|p3/);

  const ledger = await handleParentLedger(
    new Request("https://ruutin.test/api/parent/ledger?profileId=p1", { headers: { Cookie: parentCookie } }),
    { db, sessionSecret: SECRET, now: new Date("2026-08-18T16:00:00.000Z") },
  );
  assert.equal(ledger.status, 200);
  assert.match(ledger.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal((await ledger.json() as { ledger?: { balance?: number } }).ledger?.balance, 2);
});

test("companion routes deny ineligible profiles and cannot call parent endpoints", async () => {
  const { database, db } = createDb();
  database.prepare("UPDATE child_profiles SET age_band = 'under_13', companion_access_eligible = 0 WHERE id = 'p1'").run();
  await assert.rejects(
    claimCompanionTask(db, companion(), "t1", { now: new Date(timestamp), claimId: "claim-underage" }),
  );
  const rawDevice = "device-token-g06-underage-012345678901234567890";
  const deviceHash = await hashOpaqueToken(rawDevice, SECRET);
  database.prepare("UPDATE child_devices SET token_hash = ? WHERE id = 'd1'").run(deviceHash);
  const underage = await handleCompanionClaim(
    new Request("https://ruutin.test/api/companion/today", {
      method: "POST",
      headers: {
        Cookie: `${COMPANION_SESSION_COOKIE}=${rawDevice}`,
        Origin: "https://ruutin.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId: "t1" }),
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(underage.status, 401);
  const parentOnly = await handleParentClaims(
    new Request("https://ruutin.test/api/parent/claims", {
      headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawDevice}` },
    }),
    { db, sessionSecret: SECRET, now: new Date(timestamp) },
  );
  assert.equal(parentOnly.status, 401);
});

test("claims UI has direct action/refetch states and reduced-motion design guard", () => {
  const companionUi = readFileSync("app/companion/today/CompanionTodayManager.tsx", "utf8");
  const parentUi = readFileSync("app/app/today/TodayManager.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(companionUi, /visibilitychange/);
  assert.match(companionUi, /void submitClaim\(task\)/);
  assert.match(companionUi, /className="ruutin-inline-spinner"/);
  assert.doesNotMatch(companionUi, /Send for approval|role="dialog"/);
  assert.doesNotMatch(companionUi, /Pick a routine|Your parent reviews|take a breath/);
  assert.ok(
    companionUi.indexOf('className="companion-routines"') < companionUi.indexOf('className="ruutin-card companion-today-summary"')
      && companionUi.indexOf('className="companion-routines"') < companionUi.indexOf("<InstallGuidance"),
    "routines should appear before the summary and contextual install guidance",
  );
  assert.match(companionUi, /await refreshToday\(\)/);
  assert.match(companionUi, /role="progressbar"/);
  assert.match(companionUi, /task\.state === "completed" \? "Done" : "Waiting"/);
  assert.match(companionUi, /companion-unfinished-routines/);
  assert.match(companionUi, /companion-completed-routines/);
  assert.match(companionUi, /Waiting for parent/);
  assert.match(companionUi, /companion-all-done/);
  assert.match(companionUi, /data-motion="gentle"/);
  assert.match(companionUi, /companion-active-goal/);
  assert.ok(companionUi.includes("/api/companion/today"));
  assert.ok(parentUi.includes("/api/parent/claims"));
  assert.ok(parentUi.includes("/api/parent/completions"));
  assert.ok(parentUi.includes("/api/parent/ledger"));
  assert.match(parentUi, /cache: "no-store"/);
  assert.match(parentUi, /timeZone: timezone/);
  assert.match(parentUi, /requestId/);
  assert.match(parentUi, /role="progressbar"/);
  assert.match(parentUi, /Reverse stars/);
  assert.match(parentUi, /awardReversed/);
  assert.match(parentUi, /type="submit"/);
  assert.match(parentUi, /Adjust stars/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /ruutin-inline-dialog/);
});
