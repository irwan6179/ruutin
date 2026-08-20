import type {
  CompanionContext,
  D1DatabaseLike,
  D1StatementLike,
  ParentContext,
} from "./auth-context";

export class ScopeError extends Error {
  readonly status = 404;

  constructor() {
    // A missing record and a foreign record intentionally look identical.
    super("Resource not found");
    this.name = "ScopeError";
  }
}

function parentHousehold(context: ParentContext, householdId = context.householdId): string {
  if (
    context.role !== "parent" ||
    !context.memberships.some(
      (membership) =>
        membership.householdId === householdId && membership.role === "parent",
    )
  ) {
    throw new ScopeError();
  }
  return householdId;
}

/** Use only the server-resolved companion profile; never a URL/body profile ID. */
export function companionProfile(context: CompanionContext): string {
  return context.profileId;
}

export function assertCompanionProfileScope(
  context: CompanionContext,
  candidateProfileId: unknown,
): void {
  if (candidateProfileId !== undefined && candidateProfileId !== context.profileId) {
    throw new ScopeError();
  }
}

async function first<T>(statement: D1StatementLike): Promise<T | null> {
  return statement.first<T>();
}

export async function getParentProfile(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: string,
  householdId?: string,
) {
  const scope = parentHousehold(context, householdId);
  const profile = await first(
    db
      .prepare(
        `SELECT id, household_id AS householdId, nickname, emoji, age_band AS ageBand,
                companion_access_eligible AS companionAccessEligible,
                active_reward_id AS activeRewardId, archived_at AS archivedAt,
                created_at AS createdAt
         FROM child_profiles
         WHERE id = ? AND household_id = ?
         LIMIT 1`,
      )
      .bind(profileId, scope),
  );
  if (!profile) throw new ScopeError();
  return profile;
}

export async function listParentProfiles(
  db: D1DatabaseLike,
  context: ParentContext,
  householdId?: string,
) {
  const scope = parentHousehold(context, householdId);
  const result = await db
    .prepare(
      `SELECT id, nickname, emoji, age_band AS ageBand,
              companion_access_eligible AS companionAccessEligible,
              active_reward_id AS activeRewardId, archived_at AS archivedAt,
              created_at AS createdAt
       FROM child_profiles
       WHERE household_id = ?
       ORDER BY archived_at IS NOT NULL ASC, created_at ASC, id ASC`,
    )
    .bind(scope)
    .all();
  return result.results ?? [];
}

export async function getCompanionProfile(
  db: D1DatabaseLike,
  context: CompanionContext,
) {
  // The profile ID comes from the verified device row, not from a route.
  const profile = await first(
    db
      .prepare(
        `SELECT id, nickname, emoji
         FROM child_profiles
         WHERE household_id = ?
           AND id = ?
           AND archived_at IS NULL
           AND companion_access_eligible = 1
         LIMIT 1`,
      )
      .bind(context.householdId, context.profileId),
  );
  if (!profile) throw new ScopeError();
  return profile;
}

export async function listCompanionTasks(
  db: D1DatabaseLike,
  context: CompanionContext,
  localDate: string,
) {
  const result = await db
    .prepare(
      `SELECT id, title, emoji, stars, schedule_type AS scheduleType,
              schedule_data AS scheduleData, position
       FROM tasks
       WHERE household_id = ?
         AND child_profile_id = ?
         AND archived_at IS NULL
       ORDER BY position ASC, id ASC`,
    )
    .bind(context.householdId, context.profileId)
    .all();
  // Date/schedule validation is kept in the shared module; this query is
  // intentionally profile-scoped and may be filtered by the due-date service.
  void localDate;
  return result.results ?? [];
}

export async function getParentTask(
  db: D1DatabaseLike,
  context: ParentContext,
  taskId: string,
  householdId?: string,
) {
  const scope = parentHousehold(context, householdId);
  const task = await first(
    db
      .prepare(
        `SELECT id, household_id AS householdId, child_profile_id AS childProfileId,
                title, emoji, stars, schedule_type AS scheduleType,
                schedule_data AS scheduleData, position,
                archived_at AS archivedAt, created_at AS createdAt,
                updated_at AS updatedAt
         FROM tasks
         WHERE id = ? AND household_id = ?
         LIMIT 1`,
      )
      .bind(taskId, scope),
  );
  if (!task) throw new ScopeError();
  return task;
}

export async function getParentClaim(
  db: D1DatabaseLike,
  context: ParentContext,
  claimId: string,
  householdId?: string,
) {
  const scope = parentHousehold(context, householdId);
  const claim = await first(
    db
      .prepare(
        `SELECT id, household_id AS householdId, child_profile_id AS childProfileId,
                task_id AS taskId, due_date AS dueDate,
                submitted_by_type AS submittedByType,
                submitted_by_device_id AS submittedByDeviceId, status,
                submitted_at AS submittedAt, resolved_at AS resolvedAt,
                resolved_by_user_id AS resolvedByUserId
         FROM task_claims
         WHERE id = ? AND household_id = ?
         LIMIT 1`,
      )
      .bind(claimId, scope),
  );
  if (!claim) throw new ScopeError();
  return claim;
}

export async function getCompanionClaim(
  db: D1DatabaseLike,
  context: CompanionContext,
  claimId: string,
) {
  const claim = await first(
    db
      .prepare(
        `SELECT id, child_profile_id AS childProfileId, task_id AS taskId,
                due_date AS dueDate, status, submitted_at AS submittedAt,
                resolved_at AS resolvedAt
         FROM task_claims
         WHERE id = ?
           AND household_id = ?
           AND child_profile_id = ?
           AND submitted_by_device_id = ?
         LIMIT 1`,
      )
      .bind(claimId, context.householdId, context.profileId, context.deviceId),
  );
  if (!claim) throw new ScopeError();
  return claim;
}

export async function getParentReward(
  db: D1DatabaseLike,
  context: ParentContext,
  rewardId: string,
  householdId?: string,
) {
  const scope = parentHousehold(context, householdId);
  const reward = await first(
    db
      .prepare(
        `SELECT id, household_id AS householdId, child_profile_id AS childProfileId,
                title, emoji, star_cost AS starCost, archived_at AS archivedAt,
                created_at AS createdAt, updated_at AS updatedAt
         FROM rewards
         WHERE id = ? AND household_id = ?
         LIMIT 1`,
      )
      .bind(rewardId, scope),
  );
  if (!reward) throw new ScopeError();
  return reward;
}

export async function getCompanionReward(
  db: D1DatabaseLike,
  context: CompanionContext,
  rewardId: string,
) {
  const reward = await first(
    db
      .prepare(
        `SELECT id, title, emoji, star_cost AS starCost, archived_at AS archivedAt
         FROM rewards
         WHERE id = ?
           AND household_id = ?
           AND child_profile_id = ?
           AND archived_at IS NULL
         LIMIT 1`,
      )
      .bind(rewardId, context.householdId, context.profileId),
  );
  if (!reward) throw new ScopeError();
  return reward;
}

export async function getProfileBalance(
  db: D1DatabaseLike,
  context: ParentContext | CompanionContext,
  profileId?: string,
): Promise<number> {
  const resolvedProfileId =
    context.kind === "companion" ? context.profileId : profileId;
  if (!resolvedProfileId) throw new ScopeError();
  if (context.kind === "companion") assertCompanionProfileScope(context, profileId);
  const result = await first<{ balance: number | null }>(
    db
      .prepare(
        `SELECT COALESCE(SUM(stars_delta), 0) AS balance
         FROM point_ledger
         WHERE household_id = ? AND child_profile_id = ?`,
      )
      .bind(context.householdId, resolvedProfileId),
  );
  return Number(result?.balance ?? 0);
}

/** Mutation helper with the scope predicate mandatory at the call site. */
export async function archiveParentProfile(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: string,
  archivedAt: string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE child_profiles
       SET archived_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(archivedAt, profileId, parentHousehold(context))
    .run?.();
  if (result && typeof result === "object" && "meta" in result) {
    const changes = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changes === 0) throw new ScopeError();
  }
}
