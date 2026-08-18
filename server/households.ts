import type {
  D1DatabaseLike,
  D1StatementLike,
  ParentContext,
  ParentSessionContext,
} from "./auth-context";
import { ScopeError } from "./scoped-data";
import { createId, toUtcTimestamp, validateIanaTimezone, ValidationError } from "./validation";

export type HouseholdRecord = {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
};

export class HouseholdAlreadyExistsError extends Error {
  readonly status = 409;

  constructor() {
    super("A household already exists for this parent");
    this.name = "HouseholdAlreadyExistsError";
  }
}

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  return statement.run();
}

function assertHouseholdName(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("name", "name is invalid");
  const name = value.normalize("NFKC").trim();
  if (name.length < 1 || name.length > 80) {
    throw new ValidationError("name", "name is invalid");
  }
  // Keep names useful as UI labels while excluding controls/newlines.
  if ([...name].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("name", "name is invalid");
  }
  return name;
}

function membershipHouseholdIds(context: ParentContext | ParentSessionContext): string[] {
  return context.memberships.map((membership) => membership.householdId);
}

export async function getParentHousehold(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<HouseholdRecord> {
  const result = await db
    .prepare(
      `SELECT id, name, timezone, created_at AS createdAt
       FROM households
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(context.householdId)
    .first<HouseholdRecord>();
  if (!result) throw new ScopeError();
  return result;
}

/**
 * Create the first household from a verified parent session. No household ID
 * from the browser participates in either statement. D1 batch is preferred;
 * the sequential branch keeps the local test shim useful.
 */
export async function createHouseholdForParent(
  db: D1DatabaseLike,
  context: ParentSessionContext,
  input: { name: unknown; timezone: unknown },
  options: { now?: Date; householdId?: string } = {},
): Promise<HouseholdRecord> {
  if (membershipHouseholdIds(context).length > 0) throw new HouseholdAlreadyExistsError();
  const name = assertHouseholdName(input.name);
  const timezone = validateIanaTimezone(input.timezone);
  const now = toUtcTimestamp(options.now ?? new Date());
  const household: HouseholdRecord = {
    id: options.householdId ?? createId(),
    name,
    timezone,
    createdAt: now,
  };
  const householdStatement = db
    .prepare(
      `INSERT INTO households (id, name, timezone, created_at)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM household_users WHERE user_id = ?
       )`,
    )
    .bind(household.id, household.name, household.timezone, household.createdAt, context.userId);
  const membershipStatement = db
    .prepare(
      `INSERT INTO household_users (household_id, user_id, role, created_at)
       SELECT ?, ?, 'parent', ?
       WHERE EXISTS (SELECT 1 FROM households WHERE id = ?)
         AND NOT EXISTS (SELECT 1 FROM household_users WHERE user_id = ?)`,
    )
    .bind(household.id, context.userId, household.createdAt, household.id, context.userId);
  if (db.batch) {
    await db.batch([householdStatement, membershipStatement]);
  } else {
    await runStatement(householdStatement);
    try {
      await runStatement(membershipStatement);
    } catch (error) {
      // Best-effort cleanup for minimal local shims. Sites D1 uses the atomic
      // batch path above, which is the production guarantee.
      await runStatement(
        db.prepare("DELETE FROM households WHERE id = ?").bind(household.id),
      ).catch(() => undefined);
      throw error;
    }
  }
  const inserted = await db
    .prepare("SELECT id, name, timezone, created_at AS createdAt FROM households WHERE id = ? LIMIT 1")
    .bind(household.id)
    .first<HouseholdRecord>();
  if (!inserted) throw new HouseholdAlreadyExistsError();
  return inserted;
}

export async function householdForSession(
  db: D1DatabaseLike,
  context: ParentSessionContext,
): Promise<HouseholdRecord | null> {
  const householdId = context.memberships[0]?.householdId;
  if (!householdId) return null;
  return db
    .prepare(
      `SELECT id, name, timezone, created_at AS createdAt
       FROM households
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(householdId)
    .first<HouseholdRecord>();
}
