import type { D1DatabaseLike, ParentContext } from "./auth-context";
import { localDateFor } from "./validation";
import { getParentHousehold } from "./households";
import { listProfilesForParent, type ParentProfile } from "./profiles";
import { listTaskOccurrencesForParent } from "./tasks";

export type TodayProfileCard = ParentProfile & {
  taskCount: number;
  completedTaskCount: number;
  pendingClaimCount: number;
  balance: number;
  activeReward: { id: string; title: string; emoji: string; starCost: number } | null;
};

export type TodayOverview = {
  localDate: string;
  household: { id: string; name: string; timezone: string };
  profiles: TodayProfileCard[];
  pendingClaims: Array<{
    id: string;
    profileId: string;
    nickname: string;
    emoji: string;
    taskTitle: string;
    stars: number;
    submittedAt: string;
  }>;
};

async function firstNumber(db: D1DatabaseLike, query: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(query).bind(...values).first<{ value: number | null }>();
  return Number(row?.value ?? 0);
}

export async function getTodayOverview(
  db: D1DatabaseLike,
  context: ParentContext,
  options: { now?: Date } = {},
): Promise<TodayOverview> {
  const household = await getParentHousehold(db, context);
  const localDate = localDateFor(options.now ?? new Date(), household.timezone);
  const profiles = await listProfilesForParent(db, context);
  const cards: TodayProfileCard[] = [];
  for (const profile of profiles) {
    const [taskView, pendingClaimCount, balance, activeReward] = await Promise.all([
      profile.archivedAt
        ? Promise.resolve({ localDate, occurrences: [] as never[] })
        : listTaskOccurrencesForParent(db, context, profile.id, { now: options.now }),
      firstNumber(
        db,
        `SELECT count(*) AS value FROM task_claims
         WHERE household_id = ? AND child_profile_id = ? AND status = 'pending'`,
        household.id,
        profile.id,
      ),
      firstNumber(
        db,
        `SELECT COALESCE(sum(stars_delta), 0) AS value FROM point_ledger
         WHERE household_id = ? AND child_profile_id = ?`,
        household.id,
        profile.id,
      ),
      db
        .prepare(
          `SELECT id, title, emoji, star_cost AS starCost
           FROM rewards
           WHERE id = ? AND household_id = ? AND child_profile_id = ? AND archived_at IS NULL
           LIMIT 1`,
        )
        .bind(profile.activeRewardId, household.id, profile.id)
        .first<{ id: string; title: string; emoji: string; starCost: number }>(),
    ]);
    cards.push({
      ...profile,
      taskCount: taskView.occurrences.length,
      completedTaskCount: taskView.occurrences.filter((task) => task.state === "completed").length,
      pendingClaimCount,
      balance,
      activeReward: activeReward ?? null,
    });
  }
  const pending = await db
    .prepare(
      `SELECT c.id, c.child_profile_id AS profileId, p.nickname, p.emoji,
              t.title AS taskTitle, t.stars, c.submitted_at AS submittedAt
       FROM task_claims AS c
       INNER JOIN child_profiles AS p
         ON p.household_id = c.household_id AND p.id = c.child_profile_id
       INNER JOIN tasks AS t
         ON t.household_id = c.household_id AND t.id = c.task_id
       WHERE c.household_id = ? AND c.status = 'pending'
       ORDER BY c.submitted_at ASC, c.id ASC`,
    )
    .bind(household.id)
    .all<TodayOverview["pendingClaims"][number]>();
  return {
    localDate,
    household: { id: household.id, name: household.name, timezone: household.timezone },
    profiles: cards,
    pendingClaims: pending.results ?? [],
  };
}

export async function countOnboardingRows(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<{ taskCount: number; rewardCount: number }> {
  const [tasks, rewards] = await Promise.all([
    firstNumber(db, "SELECT count(*) AS value FROM tasks WHERE household_id = ? AND archived_at IS NULL", context.householdId),
    firstNumber(db, "SELECT count(*) AS value FROM rewards WHERE household_id = ? AND archived_at IS NULL", context.householdId),
  ]);
  return { taskCount: tasks, rewardCount: rewards };
}
