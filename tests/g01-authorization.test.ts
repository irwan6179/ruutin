import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  COMPANION_SESSION_COOKIE,
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  resolveCompanionContext,
  resolveParentContext,
  type D1DatabaseLike,
  type D1StatementLike,
} from "../server/auth-context";
import {
  assertCompanionProfileScope,
  getCompanionProfile,
  getParentProfile,
} from "../server/scoped-data";

const SECRET = "0123456789abcdef0123456789abcdef";

class D1Shim implements D1DatabaseLike {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string): D1StatementLike {
    const statement = this.database.prepare(query);
    return this.prepareBound(statement, []);
  }

  private prepareBound(
    statement: ReturnType<DatabaseSync["prepare"]>,
    initialValues: unknown[],
  ): D1StatementLike {
    let values = initialValues;
    const get = statement.get.bind(statement) as (...args: unknown[]) => unknown;
    const all = statement.all.bind(statement) as (...args: unknown[]) => unknown[];
    const run = statement.run.bind(statement) as (...args: unknown[]) => unknown;
    return {
      bind: (...nextValues: unknown[]) => {
        values = nextValues;
        return this.prepareBound(statement, values);
      },
      first: async <T>() => get(...values) as T | null,
      all: async <T>() => ({ results: all(...values) as T[] }),
      run: async () => run(...values),
    };
  }
}

function createDatabase(): { database: DatabaseSync; db: D1DatabaseLike } {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "drizzle/0000_careless_colossus.sql",
    "drizzle/0001_cool_lake.sql",
    "drizzle/0002_old_ben_parker.sql",
    "drizzle/0003_g01_integrity.sql",
    "drizzle/0004_sleepy_power_pack.sql",
    "drizzle/0005_past_shadow_king.sql",
  ]) {
    database.exec(readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return { database, db: new D1Shim(database) };
}

function seed(database: DatabaseSync): void {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const addHousehold = database.prepare(
    "INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)",
  );
  addHousehold.run("h1", "One", "Asia/Kuala_Lumpur", timestamp);
  addHousehold.run("h2", "Two", "UTC", timestamp);
  const addUser = database.prepare(
    "INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)",
  );
  addUser.run("u1", "parent@example.test", "parent@example.test", timestamp);
  addUser.run("u2", "other@example.test", "other@example.test", timestamp);
  const addMembership = database.prepare(
    "INSERT INTO household_users (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
  );
  addMembership.run("h1", "u1", "parent", timestamp);
  addMembership.run("h2", "u2", "parent", timestamp);
  const addProfile = database.prepare(
    `INSERT INTO child_profiles
      (id, household_id, nickname, emoji, companion_access_eligible, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  addProfile.run("p1", "h1", "Ari", "🌿", 1, timestamp);
  addProfile.run("p2", "h1", "Bea", "🌸", 1, timestamp);
  addProfile.run("p3", "h2", "Cai", "☀️", 1, timestamp);
}

test("parent context resolves only unexpired, unrevoked membership scope", async () => {
  const { database, db } = createDatabase();
  seed(database);
  const rawToken = "parent-token-012345678901234567890123";
  const tokenHash = await hashOpaqueToken(rawToken, SECRET);
  database
    .prepare(
      `INSERT INTO sessions
        (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("s1", "u1", tokenHash, "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  const request = new Request("https://ruutin.example/app/today", {
    headers: { Cookie: `${PARENT_SESSION_COOKIE}=${rawToken}` },
  });
  const context = await resolveParentContext(request, db, {
    sessionSecret: SECRET,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });
  assert.ok(context);
  assert.equal(context.kind, "parent");
  assert.equal(context.userId, "u1");
  assert.equal(context.householdId, "h1");
  assert.deepEqual(
    context.memberships.map((membership) => ({ ...membership })),
    [{ householdId: "h1", role: "parent" }],
  );

  database.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run("2026-06-01T00:00:00.000Z", "s1");
  assert.equal(await resolveParentContext(request, db, { sessionSecret: SECRET }), null);

  database.prepare("UPDATE sessions SET revoked_at = NULL, expires_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", "s1");
  assert.equal(await resolveParentContext(request, db, { sessionSecret: SECRET }), null);

  database.prepare("UPDATE sessions SET expires_at = ?, revoked_at = NULL WHERE id = ?").run("2027-01-01T00:00:00.000Z", "s1");
  database.prepare("UPDATE household_users SET role = 'caregiver' WHERE user_id = ?").run("u1");
  assert.equal(await resolveParentContext(request, db, { sessionSecret: SECRET }), null);
});

test("companion context is permanently assigned to one eligible profile", async () => {
  const { database, db } = createDatabase();
  seed(database);
  const rawToken = "companion-token-01234567890123456789";
  const tokenHash = await hashOpaqueToken(rawToken, SECRET);
  database
    .prepare(
      `INSERT INTO child_devices
        (id, household_id, child_profile_id, device_label, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("d1", "h1", "p1", "Tablet", tokenHash, "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  const request = new Request("https://ruutin.example/companion/today", {
    headers: { Cookie: `${COMPANION_SESSION_COOKIE}=${rawToken}` },
  });
  const context = await resolveCompanionContext(request, db, {
    sessionSecret: SECRET,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });
  assert.ok(context);
  assert.equal(context.kind, "companion");
  assert.equal(context.profileId, "p1");
  assert.deepEqual(context.profile, { nickname: "Ari", emoji: "🌿" });
  assert.throws(() => assertCompanionProfileScope(context, "p2"), /not found/);
  assert.doesNotThrow(() => assertCompanionProfileScope(context, undefined));
  assert.deepEqual({ ...(await getCompanionProfile(db, context)) }, {
    id: "p1",
    nickname: "Ari",
    emoji: "🌿",
  });

  database.prepare("UPDATE child_devices SET revoked_at = ? WHERE id = ?").run("2026-06-01T00:00:00.000Z", "d1");
  assert.equal(await resolveCompanionContext(request, db, { sessionSecret: SECRET }), null);
});

test("scoped reads reject foreign household/profile identifiers without disclosure", async () => {
  const { database, db } = createDatabase();
  seed(database);
  const rawToken = "parent-token-012345678901234567890123";
  const tokenHash = await hashOpaqueToken(rawToken, SECRET);
  database
    .prepare(
      `INSERT INTO sessions
        (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("s1", "u1", tokenHash, "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  const context = await resolveParentContext(
    new Request("https://ruutin.example/app/family", {
      headers: { Cookie: `${PARENT_SESSION_COOKIE}=${rawToken}` },
    }),
    db,
    { sessionSecret: SECRET },
  );
  assert.ok(context);
  const ownProfile = await getParentProfile(db, context, "p1");
  assert.equal((ownProfile as { id: string }).id, "p1");
  await assert.rejects(getParentProfile(db, context, "p3"), /not found/);
  await assert.rejects(getParentProfile(db, context, "p1", "h2"), /not found/);
});
