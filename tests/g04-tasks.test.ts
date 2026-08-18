import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { hashOpaqueToken, PARENT_SESSION_COOKIE, type D1DatabaseLike, type D1StatementLike, type ParentContext } from "../server/auth-context";
import { createHouseholdForParent } from "../server/households";
import { createProfileForParent } from "../server/profiles";
import { issueCsrfToken } from "../server/http-security";
import { handleParentTaskBulk, handleParentTasks } from "../server/parent-routes";
import { archiveTaskForParent, createTaskForParent, createTasksForParentBulk, listTaskOccurrencesForParent, listTasksForParent, reorderTasksForParent, updateTaskForParent } from "../server/tasks";
import { isTaskDueOnLocalDate, isValidIanaTimezone, isTaskDueOnLocalDate as dueOnDate } from "../server/validation";
import { ROUTINE_CATEGORIES } from "../shared/task-templates";
import { localDateFor } from "../server/validation";

const SESSION_SECRET = "session-secret-for-g04-tests-012345";
const timestamp = "2026-08-18T00:00:00.000Z";

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

function createDb(): { database: DatabaseSync; db: SqliteD1Shim } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "drizzle/0000_careless_colossus.sql",
    "drizzle/0001_cool_lake.sql",
    "drizzle/0002_old_ben_parker.sql",
    "drizzle/0003_g01_integrity.sql",
  ]) database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", timestamp);
  return { database, db: new SqliteD1Shim(database) };
}

function parent(householdId = "h1"): ParentContext {
  return { kind: "parent", sessionId: "s1", tokenHash: "hash", userId: "u1", householdId, role: "parent", memberships: [{ householdId, role: "parent" }], expiresAt: "2027-01-01T00:00:00.000Z" };
}

test("version-controlled templates contain every supplied category and starter task", () => {
  assert.equal(ROUTINE_CATEGORIES.length, 8);
  assert.deepEqual(ROUTINE_CATEGORIES.map((category) => category.label), [
    "Morning routine", "School preparation", "Homework and reading", "Personal care",
    "Helping at home", "Bedroom and belongings", "Bedtime routine", "Weekend responsibilities",
  ]);
  assert.equal(ROUTINE_CATEGORIES.reduce((count, category) => count + category.templates.length, 0), 26);
  assert.equal(ROUTINE_CATEGORIES.find((category) => category.id === "helping-at-home")?.templates.filter((template) => "scheduleMode" in template && template.scheduleMode === "parent_selected_days").length, 3);
  assert.deepEqual(ROUTINE_CATEGORIES[0]?.templates.map((template) => template.title), ["Make the bed", "Brush teeth", "Get dressed", "Pack water bottle", "Be ready by the agreed time"]);
  assert.deepEqual(ROUTINE_CATEGORIES[6]?.templates.map((template) => template.title), ["Shower and brush teeth", "Prepare clothes for tomorrow", "Put devices away at the agreed time", "Be in bed by the agreed time"]);
  const tables = new DatabaseSync(":memory:");
  assert.equal(tables.prepare("SELECT 1").get()?.["1"], 1);
  assert.ok(!readFileSync("db/schema.ts", "utf8").includes("routine_templates"), "templates must not become a D1 table");
});

test("due dates use household-local calendar dates across midnight, DST, weekdays, and one-offs", () => {
  assert.equal(isValidIanaTimezone("America/Los_Angeles"), true);
  assert.equal(localDateFor("2026-03-08T07:59:59.000Z", "America/Los_Angeles"), "2026-03-07");
  assert.equal(localDateFor("2026-03-08T08:00:00.000Z", "America/Los_Angeles"), "2026-03-08");
  assert.equal(localDateFor("2026-08-17T15:59:59.000Z", "Asia/Kuala_Lumpur"), "2026-08-17");
  assert.equal(localDateFor("2026-08-17T16:00:00.000Z", "Asia/Kuala_Lumpur"), "2026-08-18");
  assert.equal(isTaskDueOnLocalDate({ type: "daily" }, "2026-08-18"), true);
  assert.equal(isTaskDueOnLocalDate({ type: "weekdays", days: [1, 3, 5] }, "2026-08-18"), false);
  assert.equal(isTaskDueOnLocalDate({ type: "weekdays", days: [1, 3, 5] }, "2026-08-19"), true);
  assert.equal(dueOnDate({ type: "one_off", localDate: "2026-08-19" }, "2026-08-18"), false);
  assert.equal(dueOnDate({ type: "one_off", localDate: "2026-08-19" }, "2026-08-19"), true);
});

test("parent task CRUD, archive, reorder, occurrence states, and foreign scope are enforced", async () => {
  const { database, db } = createDb();
  const session = { kind: "parent_session" as const, sessionId: "s1", tokenHash: "hash", userId: "u1", memberships: [], expiresAt: "2027-01-01T00:00:00.000Z" };
  await createHouseholdForParent(db, session, { name: "Home", timezone: "Asia/Kuala_Lumpur" }, { householdId: "h1", now: new Date(timestamp) });
  const context = parent();
  await createProfileForParent(db, context, { nickname: "Ari", emoji: "🌿", ageBand: "under_13", consentConfirmed: false }, { profileId: "p1", now: new Date(timestamp) });
  await createProfileForParent(db, context, { nickname: "Bea", emoji: "🌸", ageBand: "under_13", consentConfirmed: false }, { profileId: "p2", now: new Date(timestamp) });
  const first = await createTaskForParent(db, context, { profileId: "p1", title: "Brush teeth", emoji: "🪥", stars: 1, schedule: { type: "daily" } }, { taskId: "t1", now: new Date(timestamp) });
  const second = await createTaskForParent(db, context, { profileId: "p1", title: "Read", emoji: "📖", stars: 2, schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] } }, { taskId: "t2", now: new Date(timestamp) });
  await assert.rejects(createTaskForParent(db, context, { profileId: "p1", title: "Broken", emoji: "x", stars: 1, schedule: { type: "weekly" } }), /unsupported/i);
  const edited = await updateTaskForParent(db, context, first.id, { title: "Brush teeth gently", stars: 3, schedule: { type: "one_off", localDate: "2026-08-19" } }, { now: new Date("2026-08-19T00:00:00.000Z") });
  assert.equal(edited.title, "Brush teeth gently");
  assert.deepEqual(edited.schedule, { type: "one_off", localDate: "2026-08-19" });
  const reordered = await reorderTasksForParent(db, context, "p1", [second.id, first.id]);
  assert.deepEqual(reordered.map((task) => [task.id, task.position]), [["t2", 0], ["t1", 1]]);
  database.prepare("UPDATE tasks SET position = 100001 WHERE id = 't2'").run();
  database.prepare("UPDATE tasks SET position = 100002 WHERE id = 't1'").run();
  const highPositionReordered = await reorderTasksForParent(db, context, "p1", [first.id, second.id]);
  assert.deepEqual(highPositionReordered.map((task) => [task.id, task.position]), [["t1", 0], ["t2", 1]]);
  const archived = await archiveTaskForParent(db, context, first.id, { now: new Date("2026-08-20T00:00:00.000Z") });
  assert.ok(archived.archivedAt);
  assert.equal((await listTasksForParent(db, context, "p1")).length, 1);
  assert.equal((await listTaskOccurrencesForParent(db, context, "p1", { localDate: "2026-08-19" })).occurrences.length, 1);
  await assert.rejects(createTaskForParent(db, { ...context, householdId: "h2", memberships: [{ householdId: "h2", role: "parent" }] }, { profileId: "p1", title: "Foreign", emoji: "x", stars: 1, schedule: { type: "daily" } }), /not found|scope/i);
  assert.equal(database.prepare("SELECT count(*) AS count FROM tasks WHERE household_id = ?").get("h1")?.count, 2);
});

test("reviewed task drafts persist atomically and require explicit selected weekdays", async () => {
  const { database, db } = createDb();
  const session = { kind: "parent_session" as const, sessionId: "s1", tokenHash: "hash", userId: "u1", memberships: [], expiresAt: "2027-01-01T00:00:00.000Z" };
  await createHouseholdForParent(db, session, { name: "Home", timezone: "UTC" }, { householdId: "h1", now: new Date(timestamp) });
  const context = parent();
  await createProfileForParent(db, context, { nickname: "Ari", emoji: "🌿", ageBand: "under_13", consentConfirmed: false }, { profileId: "p1", now: new Date(timestamp) });
  await assert.rejects(createTasksForParentBulk(db, context, "p1", [{ title: "Chore", emoji: "🧺", stars: 2, schedule: { type: "weekdays", days: [] } }]), /at least one weekday/i);
  assert.equal(database.prepare("SELECT count(*) AS count FROM tasks").get()?.count, 0);
  const created = await createTasksForParentBulk(db, context, "p1", [
    { title: "Chore", emoji: "🧺", stars: 2, schedule: { type: "weekdays", days: [6, 7] } },
    { title: "Read", emoji: "📖", stars: 1, schedule: { type: "daily" } },
  ], { now: new Date(timestamp) });
  assert.deepEqual(created.map((task) => task.title), ["Chore", "Read"]);
  const beforeForeign = database.prepare("SELECT count(*) AS count FROM tasks").get()?.count;
  await assert.rejects(createTasksForParentBulk(db, { ...context, householdId: "h2", memberships: [{ householdId: "h2", role: "parent" }] }, "p1", [{ title: "Nope", emoji: "x", stars: 1, schedule: { type: "daily" } }]), /not found|scope/i);
  assert.equal(database.prepare("SELECT count(*) AS count FROM tasks").get()?.count, beforeForeign);
  await assert.rejects(createTasksForParentBulk(db, context, "p1", [{ title: "Nope", emoji: "x", stars: 1, schedule: { type: "daily" }, extra: true }]), /unsupported fields/i);
  assert.equal(database.prepare("SELECT count(*) AS count FROM tasks").get()?.count, beforeForeign);

  const failingDb = new SqliteD1Shim(database);
  failingDb.batch = async (statements) => {
    database.exec("BEGIN");
    try {
      (statements[0] as { execute: () => unknown }).execute();
      throw new Error("simulated second-row failure");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  await assert.rejects(createTasksForParentBulk(failingDb, context, "p1", [{ title: "Atomic", emoji: "✦", stars: 1, schedule: { type: "daily" } }]), /second-row failure/i);
  assert.equal(database.prepare("SELECT count(*) AS count FROM tasks WHERE title = 'Atomic'").get()?.count, 0);
});

test("task route is parent-session scoped, private, CSRF protected, and rejects broad payloads", async () => {
  const { database, db } = createDb();
  const session = { kind: "parent_session" as const, sessionId: "s1", tokenHash: "hash", userId: "u1", memberships: [], expiresAt: "2027-01-01T00:00:00.000Z" };
  await createHouseholdForParent(db, session, { name: "Home", timezone: "UTC" }, { householdId: "h1", now: new Date(timestamp) });
  await createProfileForParent(db, parent(), { nickname: "Ari", emoji: "🌿", ageBand: "under_13", consentConfirmed: false }, { profileId: "p1", now: new Date(timestamp) });
  const rawToken = "parent-token-for-g04-012345678901234567890";
  const tokenHash = await hashOpaqueToken(rawToken, SESSION_SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s1", "u1", tokenHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const baseHeaders = { Origin: "https://ruutin.test", Cookie: `${PARENT_SESSION_COOKIE}=${rawToken}; ${csrf.cookie.split(";", 1)[0]}` };
  const invalid = await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks", { method: "POST", headers: { ...baseHeaders, "content-type": "application/json", "x-ruutin-csrf": csrf.token }, body: JSON.stringify({ profileId: "p1", title: "Task", emoji: "x", stars: 1, schedule: { type: "daily" }, householdId: "h2" }) }), { db, sessionSecret: SESSION_SECRET });
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("cache-control") ?? "", /no-store/);
  const noCsrf = await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks", { method: "POST", headers: { ...baseHeaders, "content-type": "application/json" }, body: JSON.stringify({ profileId: "p1", title: "Task", emoji: "x", stars: 1, schedule: { type: "daily" } }) }), { db, sessionSecret: SESSION_SECRET });
  assert.equal(noCsrf.status, 403);
  const bulkInvalid = await handleParentTaskBulk(new Request("https://ruutin.test/api/parent/tasks/bulk", { method: "POST", headers: { ...baseHeaders, "content-type": "application/json", "x-ruutin-csrf": csrf.token }, body: JSON.stringify({ profileId: "p1", drafts: [{ title: "Task", emoji: "x", stars: 1, schedule: { type: "daily" }, extra: "nope" }] }) }), { db, sessionSecret: SESSION_SECRET });
  assert.equal(bulkInvalid.status, 400);
  const createDaily = await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks", { method: "POST", headers: { ...baseHeaders, "content-type": "application/json", "x-ruutin-csrf": csrf.token }, body: JSON.stringify({ profileId: "p1", title: "Daily", emoji: "🌿", stars: 1, schedule: { type: "daily" } }) }), { db, sessionSecret: SESSION_SECRET });
  assert.equal(createDaily.status, 201);
  const createOneOff = await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks", { method: "POST", headers: { ...baseHeaders, "content-type": "application/json", "x-ruutin-csrf": csrf.token }, body: JSON.stringify({ profileId: "p1", title: "Tomorrow", emoji: "🌙", stars: 1, schedule: { type: "one_off", localDate: "2026-08-19" } }) }), { db, sessionSecret: SESSION_SECRET });
  assert.equal(createOneOff.status, 201);
  const management = await handleParentTasks(new Request("https://ruutin.test/api/parent/tasks?profileId=p1&view=management", { headers: baseHeaders }), { db, sessionSecret: SESSION_SECRET, now: new Date("2026-08-18T12:00:00.000Z") });
  assert.equal(management.status, 200);
  const managementPayload = await management.json() as { tasks?: Array<{ title: string; state?: string }> };
  assert.deepEqual(managementPayload.tasks?.map((task) => task.title), ["Daily", "Tomorrow"]);
  assert.equal(managementPayload.tasks?.find((task) => task.title === "Tomorrow")?.state, "not_due");
});

test("task and progress UI contracts remain accessible and management-safe", () => {
  const taskManager = readFileSync("app/app/family/TaskManager.tsx", "utf8");
  const onboarding = readFileSync("app/app/onboarding/OnboardingFlow.tsx", "utf8");
  const today = readFileSync("app/app/today/page.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(taskManager, /useId/);
  assert.match(taskManager, /view=management/);
  assert.match(taskManager, /reviewDrafts/);
  assert.match(taskManager, /\/api\/parent\/tasks\/bulk/);
  assert.match(taskManager, /Save reviewed routines/);
  assert.match(taskManager, /selected days/);
  assert.match(taskManager, /cancelLabel="Remove from review"/);
  assert.doesNotMatch(taskManager, /Keep edits|onSubmit=\{async \(\) => undefined\}/);
  assert.doesNotMatch(taskManager, /id="task-title"/);
  assert.match(taskManager, /defaultLocalDate/);
  assert.match(taskManager, /Not due today/);
  assert.match(onboarding, /role="progressbar"/);
  assert.match(today, /role="progressbar"/);
  assert.match(styles, /WCAG AA: the neutral state label/);
  assert.match(styles, /\.ruutin-task-state \{[^}]*color: #6a5a73;/);
  assert.match(styles, /\.ruutin-task-state\.waiting \{[^}]*color: #86633b;/);
});
