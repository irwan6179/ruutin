import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { hashOpaqueToken, PARENT_SESSION_COOKIE, type D1DatabaseLike, type D1StatementLike, type ParentContext, type ParentSessionContext } from "../server/auth-context";
import { createHouseholdForParent } from "../server/households";
import { companionAccessEligibility, assertEligibilityInput } from "../server/eligibility";
import { archiveProfileForParent, createProfileForParent, listProfilesForParent, updateProfileForParent } from "../server/profiles";
import { deriveOnboardingState } from "../server/onboarding";
import { handleParentProfiles } from "../server/parent-routes";
import { issueCsrfToken } from "../server/http-security";
import { requiresCompanionConsent } from "../app/app/profile-contracts";
import { renameDeviceForParent, revokeDeviceForParent } from "../server/devices";

const SESSION_SECRET = "session-secret-for-g03-tests-012345";
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
    });
    return bind([]);
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
  "drizzle/0004_sleepy_power_pack.sql",
  "drizzle/0005_past_shadow_king.sql",
]) database.exec(readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", ""));
  database.prepare("INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)").run("u1", "parent@example.test", "parent@example.test", timestamp);
  return { database, db: new SqliteD1Shim(database) };
}

function session(): ParentSessionContext {
  return { kind: "parent_session", sessionId: "s1", tokenHash: "hash", userId: "u1", memberships: [], expiresAt: "2027-01-01T00:00:00.000Z" };
}

function parent(householdId = "h1"): ParentContext {
  return { kind: "parent", sessionId: "s1", tokenHash: "hash", userId: "u1", householdId, role: "parent", memberships: [{ householdId, role: "parent" }], expiresAt: "2027-01-01T00:00:00.000Z" };
}

test("launch eligibility is explicit and never permits under-13 companion access", () => {
  assert.equal(companionAccessEligibility({ ageBand: "under_13", consentConfirmed: true }), false);
  assert.equal(companionAccessEligibility({ ageBand: "13_15", consentConfirmed: false }), false);
  assert.equal(companionAccessEligibility({ ageBand: "13_15", consentConfirmed: true }), true);
  assert.equal(companionAccessEligibility({ ageBand: null, consentConfirmed: false }), false);
  assert.equal(companionAccessEligibility({ ageBand: null, consentConfirmed: true }), true);
  assert.equal(assertEligibilityInput("under_13", undefined).companionAccessEligible, 0);
  assert.throws(() => assertEligibilityInput("13_15", undefined), /consent/i);
});

test("family profile editing does not demand companion consent for under-13 profiles", () => {
  assert.equal(requiresCompanionConsent("under_13"), false);
  assert.equal(requiresCompanionConsent("13_15"), true);
  assert.equal(requiresCompanionConsent("16_17"), true);
  assert.equal(requiresCompanionConsent("18_plus"), true);
  assert.equal(requiresCompanionConsent("not_provided"), true);
  assert.equal(requiresCompanionConsent(null), true);
});

test("household creation is session-scoped, timezone-validated, and one-per-parent", async () => {
  const { database, db } = createDb();
  const created = await createHouseholdForParent(db, session(), { name: "  The Home  ", timezone: "Asia/Kuala_Lumpur" }, { now: new Date(timestamp), householdId: "h1" });
  assert.deepEqual({ ...created }, { id: "h1", name: "The Home", timezone: "Asia/Kuala_Lumpur", createdAt: timestamp });
  assert.equal(database.prepare("SELECT count(*) AS count FROM household_users WHERE user_id = ?").get("u1")?.count, 1);
  await assert.rejects(createHouseholdForParent(db, session(), { name: "Second", timezone: "UTC" }), /already exists/i);
  await assert.rejects(createHouseholdForParent(db, session(), { name: "Other", timezone: "Not/AZone" }), /timezone/i);
});

test("multiple profiles remain household-scoped and archive removes pairing eligibility", async () => {
  const { db } = createDb();
  await createHouseholdForParent(db, session(), { name: "Home", timezone: "UTC" }, { householdId: "h1", now: new Date(timestamp) });
  const context = parent();
  const first = await createProfileForParent(db, context, { nickname: "Ari", emoji: "🌿", ageBand: "13_15", consentConfirmed: true }, { profileId: "p1", now: new Date(timestamp) });
  const second = await createProfileForParent(db, context, { nickname: "Bea", emoji: "🌸", ageBand: "under_13", consentConfirmed: undefined }, { profileId: "p2", now: new Date(timestamp) });
  assert.equal(first.companionAccessEligible, 1);
  assert.equal(second.companionAccessEligible, 0);
  assert.equal((await listProfilesForParent(db, context)).length, 2);
  const updated = await updateProfileForParent(db, context, "p1", { nickname: "Aria", ageBand: "16_17", consentConfirmed: true });
  assert.equal(updated.nickname, "Aria");
  assert.equal(updated.companionAccessEligible, 1);
  await assert.rejects(updateProfileForParent(db, context, "p1", { ageBand: null }), /consent/i);
  await assert.rejects(updateProfileForParent(db, { ...context, householdId: "h2", memberships: [{ householdId: "h2", role: "parent" }] }, "p1", { nickname: "Foreign" }), /not found/i);
  const archived = await archiveProfileForParent(db, context, "p1", { now: new Date("2026-08-19T00:00:00.000Z") });
  assert.equal(archived.archivedAt, "2026-08-19T00:00:00.000Z");
  assert.equal(archived.companionAccessEligible, 0);
  await assert.rejects(createProfileForParent(db, { ...context, householdId: "h2", memberships: [{ householdId: "h2", role: "parent" }] }, { nickname: "Nope", emoji: "x", ageBand: "under_13", consentConfirmed: false }), /FOREIGN KEY|not found/i);
});

test("parent device mutations are scoped and fail for missing or foreign devices", async () => {
  const { database, db } = createDb();
  await createHouseholdForParent(db, session(), { name: "Home", timezone: "UTC" }, { householdId: "h1", now: new Date(timestamp) });
  await createProfileForParent(db, parent(), { nickname: "Ari", emoji: "🌿", ageBand: "under_13", consentConfirmed: false }, { profileId: "p1", now: new Date(timestamp) });
  database.prepare(
    `INSERT INTO child_devices
      (id, household_id, child_profile_id, device_label, token_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("d1", "h1", "p1", "Tablet", "device-token-hash", timestamp, timestamp);
  await renameDeviceForParent(db, parent(), "d1", "Kitchen tablet");
  assert.equal(database.prepare("SELECT device_label AS label FROM child_devices WHERE id = ?").get("d1")?.label, "Kitchen tablet");
  await revokeDeviceForParent(db, parent(), "d1", { now: new Date("2026-08-19T00:00:00.000Z") });
  assert.equal(database.prepare("SELECT revoked_at AS revokedAt FROM child_devices WHERE id = ?").get("d1")?.revokedAt, "2026-08-19T00:00:00.000Z");
  await assert.rejects(renameDeviceForParent(db, parent(), "missing", "Nope"), /not found/i);
  await assert.rejects(revokeDeviceForParent(db, { ...parent(), householdId: "h2", memberships: [{ householdId: "h2", role: "parent" }] }, "d1"), /not found/i);
});

test("onboarding derives resume state without browser-owned persistence", () => {
  const newParent = deriveOnboardingState({ hasHousehold: false, profileCount: 0, taskCount: 0, rewardCount: 0 });
  assert.equal(newParent.activeStep, "household");
  const resumed = deriveOnboardingState({ hasHousehold: true, profileCount: 2, taskCount: 0, rewardCount: 0 }, { requestedStep: "profile" });
  assert.equal(resumed.activeStep, "profile");
  const taskBoundary = deriveOnboardingState({ hasHousehold: true, profileCount: 2, taskCount: 0, rewardCount: 0 }, { requestedStep: "rewards" });
  assert.equal(taskBoundary.activeStep, "tasks");
  assert.equal(deriveOnboardingState({ hasHousehold: true, profileCount: 1, taskCount: 2 }).isComplete, false);
  const complete = deriveOnboardingState({ hasHousehold: true, profileCount: 2, taskCount: 4, rewardCount: 0 });
  assert.equal(complete.isComplete, true);
  assert.deepEqual(complete.completedSteps, ["household", "profile", "tasks"]);
  assert.equal(complete.totalSteps, 3);
  assert.equal(complete.canSkip, false);
  const malformed = deriveOnboardingState({ hasHousehold: false, profileCount: 2, taskCount: 4, rewardCount: 2 });
  assert.deepEqual(malformed.completedSteps, []);
  assert.equal(malformed.activeStep, "household");
});

test("profile API requires a parent session, rejects prohibited fields, and uses private responses", async () => {
  const { database, db } = createDb();
  const unauthenticated = await handleParentProfiles(new Request("https://ruutin.test/api/parent/profiles"), { db, sessionSecret: SESSION_SECRET });
  assert.equal(unauthenticated.status, 401);
  await createHouseholdForParent(db, session(), { name: "Home", timezone: "UTC" }, { householdId: "h1", now: new Date(timestamp) });
  const rawToken = "parent-token-for-g03-012345678901234567890";
  const tokenHash = await hashOpaqueToken(rawToken, SESSION_SECRET);
  database.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("s1", "u1", tokenHash, "2027-01-01T00:00:00.000Z", timestamp, timestamp);
  const csrf = issueCsrfToken();
  const body = new Request("https://ruutin.test/api/parent/profiles", { method: "POST", body: JSON.stringify({ nickname: "Ari", emoji: "🌿", ageBand: "under_13", consentConfirmed: false, birthDate: "2012-01-01" }), headers: { "content-type": "application/json", Origin: "https://ruutin.test", Cookie: `${PARENT_SESSION_COOKIE}=${rawToken}; ${csrf.cookie.split(";", 1)[0]}`, "x-ruutin-csrf": csrf.token } });
  const invalid = await handleParentProfiles(body, { db, sessionSecret: SESSION_SECRET });
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("cache-control") ?? "", /no-store/);
});

test("G03 client contracts keep mutation semantics and accessibility safeguards visible", () => {
  const family = readFileSync("app/app/family/FamilyManager.tsx", "utf8");
  const today = readFileSync("app/app/today/page.tsx", "utf8");
  const signOut = readFileSync("app/app/settings/SignOutButton.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(family, /method: "PATCH"/);
  assert.match(family, /consentConfirmed/);
  assert.match(family, /requiresCompanionConsent/);
  assert.match(family, /Under 13 profiles stay parent-managed/);
  assert.match(family, /role="alert"/);
  assert.doesNotMatch(family, /Origin:/);
  const onboarding = readFileSync("app/app/onboarding/OnboardingFlow.tsx", "utf8");
  assert.match(onboarding, /useSyncExternalStore/);
  assert.match(onboarding, /Keep the server render and first browser render deterministic/);
  assert.match(onboarding, /Continue to Today/);
  assert.match(onboarding, /state\.isComplete/);
  assert.match(onboarding, /recordExperienceSignal\("onboarding_completed"\)/);
  assert.doesNotMatch(onboarding, /<RewardsManager|<PairingManager|initialRewards|initialDevices/);
  assert.doesNotMatch(today, /today&apos;s rhythm/);
  assert.match(signOut, /aria-live="assertive"/);
  assert.doesNotMatch(onboarding, /Progress is saved after each step/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /ruutin-card-in/);
});
