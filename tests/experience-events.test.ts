import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  COMPANION_SESSION_COOKIE,
  type CompanionContext,
  type D1DatabaseLike,
  type D1StatementLike,
  type ParentContext,
} from "../server/auth-context";
import {
  EXPERIENCE_EVENT_NAMES,
  handleExperienceEvent,
  recordExperienceEvent,
  type ExperienceEventName,
} from "../server/experience-events";
import { issueCsrfToken } from "../server/http-security";

const SESSION_SECRET = "experience-session-secret-for-tests-0123456789";
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
    });
    return bind([]);
  }
}

function createDb(): { database: DatabaseSync; db: SqliteD1Shim } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database.exec(`
    INSERT INTO users (id, email, email_normalized, created_at)
      VALUES ('u1', 'parent@example.test', 'parent@example.test', '${timestamp}');
    INSERT INTO users (id, email, email_normalized, created_at)
      VALUES ('u2', 'other@example.test', 'other@example.test', '${timestamp}');
    INSERT INTO households (id, name, timezone, created_at)
      VALUES ('h1', 'Home', 'Asia/Kuala_Lumpur', '${timestamp}');
    INSERT INTO households (id, name, timezone, created_at)
      VALUES ('h2', 'Other', 'UTC', '${timestamp}');
    INSERT INTO household_users (household_id, user_id, role, created_at)
      VALUES ('h1', 'u1', 'parent', '${timestamp}');
    INSERT INTO household_users (household_id, user_id, role, created_at)
      VALUES ('h2', 'u2', 'parent', '${timestamp}');
    INSERT INTO child_profiles
      (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
      VALUES ('p1', 'h1', 'Ari', '🌿', '13_15', 1, '${timestamp}');
    INSERT INTO child_profiles
      (id, household_id, nickname, emoji, age_band, companion_access_eligible, created_at)
      VALUES ('p2', 'h2', 'Cai', '☀️', '13_15', 1, '${timestamp}');
    INSERT INTO child_devices
      (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
      VALUES ('d1', 'h1', 'p1', 'Ari tablet', 'device-hash-1', '${timestamp}', '${timestamp}');
    INSERT INTO rewards
      (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at)
      VALUES ('r1', 'h1', 'p1', 'Movie night', '🎬', 3, '${timestamp}', '${timestamp}');
    INSERT INTO rewards
      (id, household_id, child_profile_id, title, emoji, star_cost, created_at, updated_at)
      VALUES ('r2', 'h2', 'p2', 'Outing', '🚲', 3, '${timestamp}', '${timestamp}');
  `);
  return { database, db: new SqliteD1Shim(database) };
}

function parent(): ParentContext {
  return {
    kind: "parent",
    sessionId: "s1",
    tokenHash: "parent-hash",
    userId: "u1",
    householdId: "h1",
    role: "parent",
    memberships: [{ householdId: "h1", role: "parent" }],
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
}

function companion(): CompanionContext {
  return {
    kind: "companion",
    deviceId: "d1",
    tokenHash: "device-hash-1",
    householdId: "h1",
    profileId: "p1",
    profile: { nickname: "Ari", emoji: "🌿" },
    expiresAt: null,
  };
}

function eventCount(database: DatabaseSync, eventName?: string): number {
  const row = database
    .prepare(
      eventName
        ? "SELECT count(*) AS count FROM experience_events WHERE event_name = ?"
        : "SELECT count(*) AS count FROM experience_events",
    )
    .get(...(eventName ? [eventName] : [])) as { count: number };
  return Number(row.count);
}

test("experience events are idempotent per actor and household-local day", async () => {
  const { database, db } = createDb();
  const first = new Date("2026-08-18T16:00:00.000Z");
  const retry = await recordExperienceEvent(db, parent(), "parent_today_opened", { now: first });
  const sameDay = await recordExperienceEvent(db, parent(), "parent_today_opened", {
    now: new Date("2026-08-19T00:00:00.000Z"),
  });
  assert.equal(sameDay.id, retry.id);
  assert.equal(sameDay.localDate, "2026-08-19");
  const nextDay = await recordExperienceEvent(db, parent(), "parent_today_opened", {
    now: new Date("2026-08-19T16:00:00.000Z"),
  });
  assert.notEqual(nextDay.id, retry.id);
  assert.equal(nextDay.localDate, "2026-08-20");
  const companionEvent = await recordExperienceEvent(db, companion(), "companion_today_opened", {
    now: first,
  });
  assert.equal(companionEvent.actorKind, "companion");
  assert.equal(eventCount(database, "parent_today_opened"), 2);
  assert.equal(eventCount(database, "companion_today_opened"), 1);
  database.close();
});

test("allow-listed client events cannot cross parent/companion scope", async () => {
  const { database, db } = createDb();
  await assert.rejects(
    recordExperienceEvent(db, companion(), "parent_today_opened"),
    /event is not supported/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "companion_today_opened"),
    /event is not supported/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "not_an_event" as ExperienceEventName),
    /event is not supported/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "parent_today_opened", {
      subject: { type: "reward", id: "r1" },
    }),
    /subject is not supported/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "reward_goal_selected"),
    /subject.*required/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "reward_goal_selected", {
      subject: { type: "reward", id: "r2" },
    }),
    /not found|scope/i,
  );
  await assert.rejects(
    recordExperienceEvent(db, parent(), "reward_goal_selected", {
      subject: { type: "reward", id: "Ari's movie night" },
    }),
    /subjectId is invalid/i,
  );
  database.close();
});

test("experience event route requires CSRF, private headers, and a verified actor", async () => {
  const { database, db } = createDb();
  const now = new Date("2026-08-18T16:00:00.000Z");
  const parentToken = "parent-token-experience-012345678901234567890";
  const companionToken = "companion-token-experience-012345678901234567890";
  const parentHash = await hashOpaqueToken(parentToken, SESSION_SECRET);
  const companionHash = await hashOpaqueToken(companionToken, SESSION_SECRET);
  database.prepare(`INSERT INTO sessions
    (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES ('s1', 'u1', ?, '2027-01-01T00:00:00.000Z', ?, ?)`)
    .run(parentHash, timestamp, timestamp);
  database.prepare(`UPDATE child_devices SET token_hash = ?, expires_at = '2027-01-01T00:00:00.000Z' WHERE id = 'd1'`)
    .run(companionHash);
  const csrf = issueCsrfToken();
  const cookie = csrf.cookie.split(";", 1)[0];
  const dependencies = { db, sessionSecret: SESSION_SECRET, now };
  const bootstrap = await handleExperienceEvent(
    new Request("https://ruutin.test/api/experience"),
    dependencies,
  );
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(bootstrap.headers.get("x-content-type-options"), "nosniff");
  assert.match(bootstrap.headers.get("set-cookie") ?? "", /__Host-ruutin_csrf=/);

  const missingCsrf = await handleExperienceEvent(
    new Request("https://ruutin.test/api/experience", {
      method: "POST",
      headers: {
        Origin: "https://ruutin.test",
        Cookie: `${PARENT_SESSION_COOKIE}=${parentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventName: "parent_today_opened" }),
    }),
    dependencies,
  );
  assert.equal(missingCsrf.status, 403);

  const headers = {
    Origin: "https://ruutin.test",
    Cookie: `${PARENT_SESSION_COOKIE}=${parentToken}; ${cookie}`,
    "Content-Type": "application/json",
    "x-ruutin-csrf": csrf.token,
  };
  const valid = await handleExperienceEvent(
    new Request("https://ruutin.test/api/experience", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventName: "parent_today_opened" }),
    }),
    dependencies,
  );
  assert.equal(valid.status, 202);
  assert.match(valid.headers.get("cache-control") ?? "", /private, no-store/);
  const unsupportedBody = await handleExperienceEvent(
    new Request("https://ruutin.test/api/experience", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventName: "reward_goal_selected" }),
    }),
    dependencies,
  );
  assert.equal(unsupportedBody.status, 400);

  const companionHeaders = {
    Origin: "https://ruutin.test",
    Cookie: `${COMPANION_SESSION_COOKIE}=${companionToken}; ${cookie}`,
    "Content-Type": "application/json",
    "x-ruutin-csrf": csrf.token,
  };
  const companionParentEvent = await handleExperienceEvent(
    new Request("https://ruutin.test/api/experience", {
      method: "POST",
      headers: companionHeaders,
      body: JSON.stringify({ eventName: "parent_today_opened" }),
    }),
    dependencies,
  );
  assert.equal(companionParentEvent.status, 401);
  assert.equal(eventCount(database, "parent_today_opened"), 1);
  database.close();
});

test("household deletion cascades experience signals and rejects invalid database shapes", () => {
  const { database } = createDb();
  database.prepare(`INSERT INTO experience_events
    (id, household_id, actor_kind, actor_key, event_name, local_date, dedupe_key, created_at)
    VALUES ('e1', 'h1', 'parent', 'u1', 'parent_today_opened', '2026-08-18',
            'parent_today_opened:parent:u1:2026-08-18', ?)`)
    .run(timestamp);
  assert.throws(() => database.prepare(`INSERT INTO experience_events
    (id, household_id, actor_kind, actor_key, event_name, local_date, dedupe_key, created_at)
    VALUES ('e2', 'h1', 'companion', 'u1', 'companion_today_opened', '2026-08-18',
            'companion_today_opened:companion:u1:2026-08-18', ?)`)
    .run(timestamp), /experience event companion actor|CHECK/i);
  assert.throws(() => database.prepare(`INSERT INTO experience_events
    (id, household_id, actor_kind, actor_key, event_name, local_date, dedupe_key, created_at)
    VALUES ('e3', 'h1', 'parent', 'u1', 'parent_today_opened', '2026-99-99',
            'parent_today_opened:parent:u1:2026-99-99', ?)`)
    .run(timestamp), /CHECK/i);
  database.prepare("DELETE FROM households WHERE id = 'h1'").run();
  assert.equal(database.prepare("SELECT count(*) AS count FROM experience_events WHERE household_id = 'h1'").get()?.count, 0);
  database.close();
});

test("the client surface remains first-party and payload-free", () => {
  assert.deepEqual(EXPERIENCE_EVENT_NAMES, [
    "parent_today_opened",
    "companion_today_opened",
    "onboarding_completed",
    "reward_goal_selected",
    "install_guidance_opened",
  ]);
  const source = readFileSync("app/components/ExperiencePing.tsx", "utf8");
  assert.match(source, /eventName: ClientExperienceEventName/);
  assert.match(source, /JSON\.stringify\(\{ eventName \}\)/);
  assert.doesNotMatch(source, /nickname|title|metadata|childProfile|deviceLabel/);
});
