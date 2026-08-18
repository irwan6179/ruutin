import type { CompanionContext, D1DatabaseLike } from "./auth-context";
import { getCompanionProfile, getProfileBalance } from "./scoped-data";
import { isTaskDueOnLocalDate, localDateFor, scheduleFromStorage } from "./validation";

export type CompanionTaskView = {
  id: string;
  title: string;
  emoji: string;
  stars: number;
  dueDate: string;
  state: "todo" | "waiting" | "completed";
  claimId: string | null;
  submittedAt: string | null;
};

export type CompanionToday = {
  profile: { nickname: string; emoji: string };
  localDate: string;
  tasks: CompanionTaskView[];
};

export type CompanionRewardView = {
  id: string;
  title: string;
  emoji: string;
  starCost: number;
  isActive: boolean;
};

export type CompanionRewards = {
  profile: { nickname: string; emoji: string };
  balance: number;
  activeReward: CompanionRewardView | null;
  rewards: CompanionRewardView[];
};

type StoredTask = {
  id: string;
  title: string;
  emoji: string;
  stars: number;
  scheduleType: string;
  scheduleData: string;
};

export async function getCompanionToday(
  db: D1DatabaseLike,
  context: CompanionContext,
  options: { now?: Date } = {},
): Promise<CompanionToday> {
  // Re-read the profile using the device-derived scope. This prevents a
  // stale layout snapshot from returning an archived/revoked profile.
  const profile = await getCompanionProfile(db, context) as { nickname: string; emoji: string };
  const household = await db
    .prepare("SELECT timezone FROM households WHERE id = ? LIMIT 1")
    .bind(context.householdId)
    .first<{ timezone: string }>();
  if (!household) throw new Error("Companion household is unavailable");
  const localDate = localDateFor(options.now ?? new Date(), household.timezone);
  const taskResult = await db
    .prepare(
      `SELECT id, title, emoji, stars,
              schedule_type AS scheduleType, schedule_data AS scheduleData
       FROM tasks
       WHERE household_id = ? AND child_profile_id = ? AND archived_at IS NULL
       ORDER BY position ASC, id ASC`,
    )
    .bind(context.householdId, context.profileId)
    .all<StoredTask>();
  const claims = await db
    .prepare(
      `SELECT id, task_id AS taskId, status, submitted_at AS submittedAt
       FROM task_claims
       WHERE household_id = ? AND child_profile_id = ? AND due_date = ?
         AND status IN ('pending', 'approved')
       ORDER BY submitted_at ASC, id ASC`,
    )
    .bind(context.householdId, context.profileId, localDate)
    .all<{
      id: string;
      taskId: string;
      status: "pending" | "approved";
      submittedAt: string;
    }>();
  const byTask = new Map<string, { id: string; taskId: string; status: "pending" | "approved"; submittedAt: string }>();
  for (const claim of claims.results ?? []) {
    if (!byTask.has(claim.taskId)) byTask.set(claim.taskId, claim);
  }
  const tasks: CompanionTaskView[] = [];
  for (const task of taskResult.results ?? []) {
    let due = false;
    try {
      due = isTaskDueOnLocalDate(
        scheduleFromStorage(task.scheduleType, task.scheduleData),
        localDate,
      );
    } catch {
      // A malformed stored schedule is not allowed to broaden companion data.
      continue;
    }
    if (!due) continue;
    const claim = byTask.get(task.id);
    tasks.push({
      id: task.id,
      title: task.title,
      emoji: task.emoji,
      stars: task.stars,
      dueDate: localDate,
      state: claim?.status === "approved" ? "completed" : claim ? "waiting" : "todo",
      claimId: claim?.id ?? null,
      submittedAt: claim?.submittedAt ?? null,
    });
  }
  return { profile, localDate, tasks };
}

export async function getCompanionRewards(
  db: D1DatabaseLike,
  context: CompanionContext,
): Promise<CompanionRewards> {
  const profile = await getCompanionProfile(db, context) as { nickname: string; emoji: string };
  const balance = await getProfileBalance(db, context);
  const activeRow = await db
    .prepare(
      `SELECT active_reward_id AS activeRewardId
       FROM child_profiles
       WHERE household_id = ? AND id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .bind(context.householdId, context.profileId)
    .first<{ activeRewardId: string | null }>();
  const result = await db
    .prepare(
      `SELECT id, title, emoji, star_cost AS starCost
       FROM rewards
       WHERE household_id = ? AND child_profile_id = ? AND archived_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(context.householdId, context.profileId)
    .all<{ id: string; title: string; emoji: string; starCost: number }>();
  const rewards = (result.results ?? []).map((reward) => ({
    ...reward,
    isActive: reward.id === (activeRow?.activeRewardId ?? null),
  }));
  return {
    profile,
    balance,
    activeReward: rewards.find((reward) => reward.isActive) ?? null,
    rewards,
  };
}
