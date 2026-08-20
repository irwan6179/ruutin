import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationFiles = [
  "drizzle/0000_careless_colossus.sql",
  "drizzle/0001_cool_lake.sql",
  "drizzle/0002_old_ben_parker.sql",
  "drizzle/0003_g01_integrity.sql",
  "drizzle/0004_sleepy_power_pack.sql",
  "drizzle/0005_past_shadow_king.sql",
] as const;

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles) {
    database.exec(readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function seedHousehold(database: DatabaseSync): void {
  const timestamp = "2026-01-01T00:00:00.000Z";
  database
    .prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)")
    .run("h1", "Home", "Asia/Kuala_Lumpur", timestamp);
  database
    .prepare(
      "INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("u1", "Parent@Example.test", "parent@example.test", timestamp);
  database
    .prepare(
      "INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("h1", "u1", "parent", timestamp);
  database
    .prepare(
      `INSERT INTO child_profiles
        (id, household_id, nickname, emoji, companion_access_eligible, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("p1", "h1", "Ari", "🌿", 1, timestamp);
  database
    .prepare(
      `INSERT INTO child_devices
        (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("d1", "h1", "p1", "Tablet", "device-hash-1", timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO tasks
        (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
         schedule_data, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "t1",
      "h1",
      "p1",
      "Pack bag",
      "🎒",
      2,
      "daily",
      '{"type":"daily"}',
      0,
      timestamp,
      timestamp,
    );
}

function insertPendingClaim(database: DatabaseSync, id: string, dueDate = "2026-01-01") {
  database
    .prepare(
      `INSERT INTO task_claims
        (id, household_id, child_profile_id, task_id, due_date, submitted_by_type,
         submitted_by_device_id, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, "h1", "p1", "t1", dueDate, "companion", "d1", "2026-01-01T00:00:00.000Z");
}

test("G01 migration creates every durable table and expected lookup indexes", () => {
  const database = createDatabase();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String((row as { name: string }).name));
  assert.deepEqual(tables, [
    "auth_challenges",
    "child_devices",
    "child_profiles",
    "experience_events",
    "household_users",
    "households",
    "pairing_codes",
    "point_ledger",
    "rate_limit_buckets",
    "reward_requests",
    "rewards",
    "runtime_metadata",
    "sessions",
    "task_claims",
    "tasks",
    "users",
  ]);

  for (const indexName of [
    "users_email_normalized_unique",
    "sessions_token_hash_unique",
    "auth_challenges_active_lookup_idx",
    "task_claims_active_occurrence_unique",
    "point_ledger_source_unique",
    "pairing_codes_token_hash_unique",
    "child_devices_token_hash_unique",
    "reward_requests_pending_unique",
    "experience_events_household_dedupe_unique",
    "experience_events_household_event_date_idx",
    "experience_events_actor_date_idx",
  ]) {
    const row = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(indexName);
    assert.ok(row, `missing index ${indexName}`);
  }
  const eventForeignKeys = database
    .prepare("PRAGMA foreign_key_list(experience_events)")
    .all()
    .map((row) => row as { table: string; on_delete: string });
  assert.ok(eventForeignKeys.some((key) => key.table === "households" && key.on_delete === "CASCADE"));
});

test("normalized emails, memberships, token hashes, and foreign keys are database-enforced", () => {
  const database = createDatabase();
  seedHousehold(database);
  assert.throws(() => {
    database
      .prepare(
        "INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("u2", "parent@example.test", "parent@example.test", "2026-01-01T00:00:00.000Z");
  }, /UNIQUE/i);
  assert.throws(() => {
    database
      .prepare(
        "INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("h1", "u1", "parent", "2026-01-01T00:00:00.000Z");
  }, /UNIQUE/i);
  assert.throws(() => {
    database
      .prepare(
        "INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("h1", "u1", "owner", "2026-01-01T00:00:00.000Z");
  }, /CHECK/i);
  assert.throws(() => {
    database
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("s1", "missing-user", "token-hash", "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  }, /FOREIGN KEY/i);
});

test("profiles and tasks enforce ownership, allowed stars, and normalized schedule storage", () => {
  const database = createDatabase();
  seedHousehold(database);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO tasks
          (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
           schedule_data, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("bad-stars", "h1", "p1", "Bad", "⚠️", 4, "daily", '{"type":"daily"}', 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  }, /CHECK/i);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO tasks
          (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
           schedule_data, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("bad-profile", "h1", "not-p1", "Bad", "⚠️", 1, "daily", '{"type":"daily"}', 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  }, /FOREIGN KEY/i);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO tasks
          (id, household_id, child_profile_id, title, emoji, stars, schedule_type,
           schedule_data, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("bad-schedule", "h1", "p1", "Bad", "⚠️", 1, "monthly", '{"type":"monthly"}', 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  }, /CHECK/i);
});

test("claims allow one active occurrence and permit a new claim after rejection", () => {
  const database = createDatabase();
  seedHousehold(database);
  insertPendingClaim(database, "c1");
  assert.throws(() => insertPendingClaim(database, "c2"), /UNIQUE/i);
  database
    .prepare(
      "UPDATE task_claims SET status = 'rejected', resolved_at = ?, resolved_by_user_id = ? WHERE id = ?",
    )
    .run("2026-01-01T01:00:00.000Z", "u1", "c1");
  insertPendingClaim(database, "c2");
  assert.throws(() => {
    database
      .prepare(
        "UPDATE task_claims SET status = 'approved', resolved_at = ?, resolved_by_user_id = ? WHERE id = ?",
      )
      .run("2026-01-01T02:00:00.000Z", "u1", "c1");
  }, /already resolved|UNIQUE/i);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO task_claims
          (id, household_id, child_profile_id, task_id, due_date, submitted_by_type,
           submitted_by_device_id, status, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("wrong-status", "h1", "p1", "t1", "2026-01-02", "companion", "d1", "waiting", "2026-01-01T00:00:00.000Z");
  }, /CHECK/i);
});

test("ledger is append-only and source events are exactly-once", () => {
  const database = createDatabase();
  seedHousehold(database);
  const values = [
    "l1",
    "h1",
    "p1",
    "task_approved",
    2,
    "task_claim",
    "c1",
    "approved",
    "u1",
    "2026-01-01",
    "2026-01-01T02:00:00.000Z",
  ];
  database
    .prepare(
      `INSERT INTO point_ledger
        (id, household_id, child_profile_id, event_type, stars_delta, source_type,
         source_id, reason, actor_user_id, local_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...values);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO point_ledger
          (id, household_id, child_profile_id, event_type, stars_delta, source_type,
           source_id, reason, actor_user_id, local_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("l2", ...values.slice(1));
  }, /UNIQUE/i);
  assert.throws(() => database.prepare("UPDATE point_ledger SET stars_delta = 1 WHERE id = 'l1'").run(), /append-only/i);
  assert.throws(() => database.prepare("DELETE FROM point_ledger WHERE id = 'l1'").run(), /append-only/i);
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO point_ledger
          (id, household_id, child_profile_id, event_type, stars_delta, source_type,
           source_id, local_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("invalid-event", "h1", "p1", "not_an_event", 1, "manual", "invalid", "2026-01-01", "2026-01-01T00:00:00.000Z");
  }, /CHECK/i);
});

test("reward costs, active-reward limit, and pair/device hashes are guarded", () => {
  const database = createDatabase();
  seedHousehold(database);
  const timestamp = "2026-01-01T00:00:00.000Z";
  const insertReward = database.prepare(
    `INSERT INTO rewards
      (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  assert.throws(() => insertReward.run("negative", "h1", "p1", "Bad", "⚠️", 0, timestamp, timestamp), /CHECK/i);
  for (let index = 1; index <= 5; index += 1) {
    insertReward.run(`r${index}`, "h1", "p1", `Reward ${index}`, "🎁", index, timestamp, timestamp);
  }
  assert.throws(() => insertReward.run("r6", "h1", "p1", "Too many", "🎁", 1, timestamp, timestamp), /five active rewards/i);
  const columns = database.prepare("PRAGMA table_info(pairing_codes)").all().map((row) => String((row as { name: string }).name));
  assert.ok(columns.includes("code_hash"));
  assert.ok(columns.includes("token_hash"));
  assert.ok(!columns.some((column) => /(^|_)(code|token)($|_)/u.test(column) && !/hash/u.test(column)));
  const deviceColumns = database.prepare("PRAGMA table_info(child_devices)").all().map((row) => String((row as { name: string }).name));
  assert.ok(deviceColumns.includes("token_hash"));
  assert.ok(!deviceColumns.includes("token"));
  const challengeColumns = database.prepare("PRAGMA table_info(auth_challenges)").all().map((row) => String((row as { name: string }).name));
  assert.ok(challengeColumns.includes("code_hash"));
  assert.ok(!challengeColumns.includes("code"));
  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all().map((row) => String((row as { name: string }).name));
  assert.ok(sessionColumns.includes("token_hash"));
  assert.ok(!sessionColumns.includes("token"));
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO pairing_codes
          (id, household_id, child_profile_id, code_hash, token_hash, expires_at,
           attempt_count, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("pc1", "h1", "p1", "code-hash", "pair-token-hash", "2027-01-01T00:00:00.000Z", 6, "u1", timestamp);
  }, /CHECK/i);
});
