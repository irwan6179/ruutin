import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationFiles = [
  "drizzle/0000_careless_colossus.sql",
  "drizzle/0001_cool_lake.sql",
  "drizzle/0002_old_ben_parker.sql",
  "drizzle/0003_g01_integrity.sql",
  "drizzle/0004_sleepy_power_pack.sql",
] as const;

const requiredTables = [
  "auth_challenges",
  "child_devices",
  "child_profiles",
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
] as const;

function sourceFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return statSync(path).isFile() && /\.(mjs|ts|tsx|js|json)$/.test(entry.name) ? [path] : [];
  });
}

function applyMigrations(database: DatabaseSync, files: readonly string[] = migrationFiles): void {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  for (const file of files) {
    database.exec(readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
}

function schemaDump(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT type || ':' || name || ':' || sql AS definition FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
    .all()
    .map((row) => String((row as { definition: string }).definition));
}

function foreignKeys(database: DatabaseSync, table: string): Array<{ table: string; from: string; to: string; onDelete: string }> {
  return database
    .prepare(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map((row) => {
      const value = row as { table: string; from: string; to: string; on_delete: string };
      return { table: value.table, from: value.from, to: value.to, onDelete: value.on_delete };
    });
}

test("G10 migration sequence replays deterministically with required indexes and foreign keys", () => {
  const first = new DatabaseSync(":memory:");
  const second = new DatabaseSync(":memory:");
  applyMigrations(first);
  applyMigrations(second);

  assert.equal(first.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.deepEqual(
    first.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String((row as { name: string }).name)),
    [...requiredTables].sort(),
  );
  assert.deepEqual(schemaDump(first), schemaDump(second));

  const indexes = first.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all().map((row) => String((row as { name: string }).name));
  for (const index of [
    "auth_challenges_active_lookup_idx",
    "sessions_token_hash_unique",
    "child_devices_token_hash_unique",
    "task_claims_active_occurrence_unique",
    "point_ledger_source_unique",
    "point_ledger_profile_date_idx",
    "reward_requests_pending_unique",
    "reward_requests_pending_parent_idx",
    "rewards_active_profile_idx",
  ]) assert.ok(indexes.includes(index), index);
  const triggers = first.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((row) => String((row as { name: string }).name));
  for (const trigger of [
    "reward_requests_profile_reward_scope_insert",
    "reward_requests_device_profile_scope_insert",
    "reward_requests_state_transition",
    "point_ledger_no_update",
    "point_ledger_no_delete",
  ]) assert.ok(triggers.includes(trigger), trigger);

  assert.ok(foreignKeys(first, "point_ledger").some((key) => key.table === "child_profiles" && key.onDelete === "CASCADE"));
  assert.ok(foreignKeys(first, "reward_requests").some((key) => key.table === "rewards" && key.onDelete === "CASCADE"));
  assert.ok(foreignKeys(first, "reward_requests").some((key) => key.table === "child_devices" && key.onDelete === "CASCADE"));
  assert.ok(foreignKeys(first, "sessions").some((key) => key.table === "users" && key.onDelete === "CASCADE"));

  const upgraded = new DatabaseSync(":memory:");
  applyMigrations(upgraded, migrationFiles.slice(0, 4));
  upgraded.exec(`
    INSERT INTO users (id, email, email_normalized, created_at) VALUES ('u1', 'parent@example.test', 'parent@example.test', '2026-08-19T00:00:00.000Z');
    INSERT INTO households (id, name, timezone, created_at) VALUES ('h1', 'Home', 'UTC', '2026-08-19T00:00:00.000Z');
    INSERT INTO household_users (household_id, user_id, role, created_at) VALUES ('h1', 'u1', 'parent', '2026-08-19T00:00:00.000Z');
    INSERT INTO child_profiles (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at) VALUES ('p1', 'h1', 'Ari', '🌿', '13_15', 1, '2026-08-19T00:00:00.000Z');
    INSERT INTO rewards (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at) VALUES ('r1', 'h1', 'p1', 'Movie', '🎬', 1, '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
    INSERT INTO child_devices (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at) VALUES ('d1', 'h1', 'p1', 'Tablet', 'device-hash', '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
    INSERT INTO reward_requests (id, household_id, child_profile_id, reward_id, requested_by_device_id, requested_at) VALUES ('q1', 'h1', 'p1', 'r1', 'd1', '2026-08-19T00:00:00.000Z');
  `);
  applyMigrations(upgraded, migrationFiles.slice(4));
  assert.equal(upgraded.prepare("SELECT count(*) AS count FROM reward_requests WHERE id = 'q1'").get()?.count, 1);
  assert.ok(foreignKeys(upgraded, "reward_requests").some((key) => key.table === "rewards" && key.onDelete === "CASCADE"));
  upgraded.prepare("DELETE FROM households WHERE id = 'h1'").run();
  assert.equal(upgraded.prepare("SELECT count(*) AS count FROM reward_requests").get()?.count, 0);

  first.close();
  second.close();
  upgraded.close();
});

test("G10 deletion semantics remove household app data and revoke retained session state", () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const now = "2026-08-19T00:00:00.000Z";
  database.exec(`
    INSERT INTO users (id, email, email_normalized, created_at) VALUES ('u1', 'parent@example.test', 'parent@example.test', '${now}');
    INSERT INTO users (id, email, email_normalized, created_at) VALUES ('u2', 'other@example.test', 'other@example.test', '${now}');
    INSERT INTO households (id, name, timezone, created_at) VALUES ('h1', 'Home', 'UTC', '${now}');
    INSERT INTO households (id, name, timezone, created_at) VALUES ('h2', 'Other', 'UTC', '${now}');
    INSERT INTO household_users (household_id, user_id, role, created_at) VALUES ('h1', 'u1', 'parent', '${now}');
    INSERT INTO household_users (household_id, user_id, role, created_at) VALUES ('h2', 'u2', 'parent', '${now}');
    INSERT INTO child_profiles (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at) VALUES ('p1', 'h1', 'Ari', '🌿', '13_15', 1, '${now}');
    INSERT INTO tasks (id, household_id, child_profile_id, title, emoji, stars, schedule_type, schedule_data, position, created_at, updated_at) VALUES ('t1', 'h1', 'p1', 'Routine', '✓', 1, 'daily', '{"type":"daily"}', 0, '${now}', '${now}');
    INSERT INTO child_devices (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at) VALUES ('d1', 'h1', 'p1', 'Tablet', 'device-hash', '${now}', '${now}');
    INSERT INTO rewards (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at) VALUES ('r1', 'h1', 'p1', 'Movie', '🎬', 1, '${now}', '${now}');
    UPDATE child_profiles SET active_reward_id = 'r1' WHERE id = 'p1';
    INSERT INTO task_claims (id, household_id, child_profile_id, task_id, due_date, submitted_by_type, submitted_by_device_id, status, submitted_at) VALUES ('c1', 'h1', 'p1', 't1', '2026-08-19', 'companion', 'd1', 'pending', '${now}');
    INSERT INTO reward_requests (id, household_id, child_profile_id, reward_id, requested_by_device_id, requested_at) VALUES ('q1', 'h1', 'p1', 'r1', 'd1', '${now}');
    INSERT INTO point_ledger (id, household_id, child_profile_id, event_type, stars_delta, source_type, source_id, local_date, created_at) VALUES ('l1', 'h1', 'p1', 'manual_adjustment', 1, 'manual_adjustment', 'source-1', '2026-08-19', '${now}');
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES ('s1', 'u1', 'session-hash', '2027-01-01T00:00:00.000Z', '${now}', '${now}');
    INSERT INTO auth_challenges (id, email_normalized, code_hash, purpose, expires_at, created_at) VALUES ('a1', 'parent@example.test', 'tac-hash', 'sign_in', '2027-01-01T00:00:00.000Z', '${now}');
  `);

  database.exec("BEGIN IMMEDIATE");
  database.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id IN (SELECT user_id FROM household_users WHERE household_id = ?) AND revoked_at IS NULL").run(now, "h1");
  database.prepare("UPDATE child_devices SET revoked_at = ? WHERE household_id = ? AND revoked_at IS NULL").run(now, "h1");
  database.prepare("DELETE FROM households WHERE id = ?").run("h1");
  database.exec("COMMIT");

  assert.equal(database.prepare("SELECT count(*) AS count FROM households WHERE id = 'h1'").get()?.count, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM households WHERE id = 'h2'").get()?.count, 1);
  for (const table of ["child_profiles", "tasks", "task_claims", "rewards", "reward_requests", "point_ledger", "child_devices", "pairing_codes"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table} WHERE household_id = 'h1'`).get()?.count, 0, table);
  }
  assert.equal(database.prepare("SELECT revoked_at FROM sessions WHERE id = 's1'").get()?.revoked_at, now);
  assert.equal(database.prepare("SELECT count(*) AS count FROM auth_challenges WHERE email_normalized = 'parent@example.test'").get()?.count, 1);
  database.close();
});

test("G10 prohibited-scope inventory remains Sites-only and free of prohibited capabilities", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const allDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).join(" ").toLowerCase();
  for (const dependency of ["stripe", "posthog", "segment", "analytics", "firebase", "aws-sdk"]) {
    assert.doesNotMatch(allDependencies, new RegExp(`(^|[-@])${dependency.replace("-", "\\-")}(?:$|[-/])`), dependency);
  }

  const hosting = JSON.parse(readFileSync(".openai/hosting.json", "utf8")) as { project_id?: string; r2?: unknown };
  assert.ok(hosting.project_id);
  assert.equal(hosting.r2, null);
  assert.match(readFileSync("README.md", "utf8"), /ChatGPT Sites is the only supported deployment\s+target/);

  const source = [
    ...sourceFiles("app"),
    ...sourceFiles("server"),
    ...sourceFiles("shared"),
    ...sourceFiles("scripts"),
    "next.config.ts",
    "vite.config.ts",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(source, /new\s+WebSocket|WebSocket\s*\(|PushManager|R2Bucket|multipart\/form-data|Stripe|posthog|segment/i);
  assert.doesNotMatch(source, /loot[_ -]?box|leaderboard|sibling ranking|virtual currency|gift card|cash reward|purchase flow|payment intent/i);
  assert.match(readFileSync("server/rewards.ts", "utf8"), /reward_redeemed/);
  assert.match(readFileSync("server/claims.ts", "utf8"), /task_reversed/);
});

test("G10 focused suites cover the required release scenarios", () => {
  const claims = readFileSync("tests/g06-claims.test.ts", "utf8");
  const rewards = readFileSync("tests/g07-rewards.test.ts", "utf8");
  const settings = readFileSync("tests/g08-settings.test.ts", "utf8");
  assert.match(claims, /approval is one transaction, repeated\/concurrent approval awards exactly once/);
  assert.match(claims, /parent completion resolves a pending companion claim once and reversal is compensating/);
  assert.match(rewards, /reward approval is idempotent across independent database connections/);
  assert.match(rewards, /reward approval never goes negative/);
  assert.match(settings, /deletion requires fresh session-bound proof and deletes household data atomically/);
  assert.match(settings, /deletion fails closed without D1 batch and rolls back partial revocation/);
});
