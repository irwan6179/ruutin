import type { D1DatabaseLike, D1StatementLike, ParentContext } from "./auth-context";
import { getParentHousehold } from "./households";
import { getProfileForParent } from "./profiles";
import { ScopeError } from "./scoped-data";
import {
  createId,
  isTaskDueOnLocalDate,
  localDateFor,
  scheduleFromStorage,
  scheduleToStorage,
  toUtcTimestamp,
  validateLocalDate,
  validateStars,
  type TaskSchedule,
  ValidationError,
} from "./validation";

export type ParentTask = {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  emoji: string;
  stars: number;
  schedule: TaskSchedule;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskInput = {
  profileId: unknown;
  title: unknown;
  emoji: unknown;
  stars: unknown;
  schedule: unknown;
};

export type BulkTaskDraft = Omit<TaskInput, "profileId">;

export type TaskPatch = Partial<Omit<TaskInput, "profileId">> & { archived?: unknown };

export type TaskOccurrence = ParentTask & {
  dueDate: string;
  state: "todo" | "waiting" | "completed";
  claimId: string | null;
  submittedAt: string | null;
  awardReversed: boolean;
};

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  return statement.run();
}

function scopedHousehold(context: ParentContext): string {
  if (
    context.role !== "parent" ||
    !context.memberships.some(
      (membership) =>
        membership.householdId === context.householdId && membership.role === "parent",
    )
  ) {
    throw new ScopeError();
  }
  return context.householdId;
}

function validateTaskId(value: unknown, field = "taskId"): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new ValidationError(field, `${field} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate every draft before preparing a single D1 write statement. */
export function validateBulkTaskDrafts(value: unknown): BulkTaskDraft[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new ValidationError("drafts", "drafts must contain between 1 and 100 tasks");
  }
  return value.map((draft, index) => {
    if (!isRecord(draft) || Object.keys(draft).some((key) => !["title", "emoji", "stars", "schedule"].includes(key))) {
      throw new ValidationError(`drafts[${index}]`, "task draft contains unsupported fields");
    }
    if (!["title", "emoji", "stars", "schedule"].every((key) => key in draft)) {
      throw new ValidationError(`drafts[${index}]`, "task draft is incomplete");
    }
    return {
      title: draft.title,
      emoji: draft.emoji,
      stars: draft.stars,
      schedule: draft.schedule,
    };
  });
}

export function validateTaskTitle(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("title", "title is invalid");
  const title = value.normalize("NFKC").trim();
  if (title.length < 1 || title.length > 120) throw new ValidationError("title", "title is invalid");
  if ([...title].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("title", "title is invalid");
  }
  return title;
}

export function validateTaskEmoji(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("emoji", "emoji is invalid");
  const emoji = value.trim();
  const codePoints = [...emoji];
  if (codePoints.length < 1 || codePoints.length > 8 || codePoints.some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("emoji", "emoji is invalid");
  }
  return emoji;
}

function taskSelect(): string {
  return `SELECT id, household_id AS householdId, child_profile_id AS profileId,
                 title, emoji, stars, schedule_type AS scheduleType,
                 schedule_data AS scheduleData, position,
                 archived_at AS archivedAt, created_at AS createdAt,
                 updated_at AS updatedAt
          FROM tasks`;
}

function parseTask(row: {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  emoji: string;
  stars: number;
  scheduleType: string;
  scheduleData: string;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}): ParentTask {
  return {
    id: row.id,
    householdId: row.householdId,
    profileId: row.profileId,
    title: row.title,
    emoji: row.emoji,
    stars: row.stars,
    schedule: scheduleFromStorage(row.scheduleType, row.scheduleData),
    position: row.position,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function activeProfile(db: D1DatabaseLike, context: ParentContext, profileId: unknown) {
  const profile = await getProfileForParent(db, context, validateTaskId(profileId, "profileId"));
  if (profile.archivedAt) throw new ScopeError();
  return profile;
}

async function taskRowForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  taskId: unknown,
  options: { includeArchived?: boolean } = {},
): Promise<ParentTask> {
  const householdId = scopedHousehold(context);
  const id = validateTaskId(taskId);
  const archivedClause = options.includeArchived ? "" : " AND archived_at IS NULL";
  const row = await db
    .prepare(`${taskSelect()} WHERE id = ? AND household_id = ?${archivedClause} LIMIT 1`)
    .bind(id, householdId)
    .first<Parameters<typeof parseTask>[0]>();
  if (!row) throw new ScopeError();
  return parseTask(row);
}

export async function getTaskForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  taskId: unknown,
): Promise<ParentTask> {
  return taskRowForParent(db, context, taskId);
}

export async function listTasksForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  options: { includeArchived?: boolean } = {},
): Promise<ParentTask[]> {
  const householdId = scopedHousehold(context);
  const profile = await getProfileForParent(db, context, validateTaskId(profileId, "profileId"));
  const archivedClause = options.includeArchived ? "" : " AND archived_at IS NULL";
  const rows = await db
    .prepare(`${taskSelect()} WHERE household_id = ? AND child_profile_id = ?${archivedClause} ORDER BY position ASC, created_at ASC, id ASC`)
    .bind(householdId, profile.id)
    .all<Parameters<typeof parseTask>[0]>();
  return (rows.results ?? []).map(parseTask);
}

async function nextPosition(db: D1DatabaseLike, householdId: string, profileId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) AS maxPosition FROM tasks WHERE household_id = ? AND child_profile_id = ? AND archived_at IS NULL`)
    .bind(householdId, profileId)
    .first<{ maxPosition: number | null }>();
  return Number(row?.maxPosition ?? -1) + 1;
}

export async function createTaskForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  input: TaskInput,
  options: { now?: Date; taskId?: string } = {},
): Promise<ParentTask> {
  const householdId = scopedHousehold(context);
  const profile = await activeProfile(db, context, input.profileId);
  const title = validateTaskTitle(input.title);
  const emoji = validateTaskEmoji(input.emoji);
  const stars = validateStars(input.stars);
  const storage = scheduleToStorage(input.schedule);
  const now = toUtcTimestamp(options.now ?? new Date());
  const id = options.taskId ?? createId();
  const position = await nextPosition(db, householdId, profile.id);
  await runStatement(
    db.prepare(`INSERT INTO tasks
      (id, household_id, child_profile_id, title, emoji, stars,
       schedule_type, schedule_data, position, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(id, householdId, profile.id, title, emoji, stars, storage.type, storage.data, position, now, now),
  );
  return taskRowForParent(db, context, id);
}

/**
 * Persist a reviewed template selection as one D1 batch. All validation and
 * ownership checks happen before the batch is handed to Sites, so an invalid
 * row or a mid-batch D1 failure cannot leave a partially-created routine set.
 */
export async function createTasksForParentBulk(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  drafts: unknown,
  options: { now?: Date } = {},
): Promise<ParentTask[]> {
  const householdId = scopedHousehold(context);
  const profile = await activeProfile(db, context, profileId);
  const validatedDrafts = validateBulkTaskDrafts(drafts);
  if (!db.batch) throw new Error("D1 atomic batch capability is unavailable");
  const now = toUtcTimestamp(options.now ?? new Date());
  const startingPosition = await nextPosition(db, householdId, profile.id);
  const prepared = validatedDrafts.map((draft, index) => {
    const title = validateTaskTitle(draft.title);
    const emoji = validateTaskEmoji(draft.emoji);
    const stars = validateStars(draft.stars);
    const storage = scheduleToStorage(draft.schedule);
    const id = createId();
    return {
      id,
      statement: db.prepare(`INSERT INTO tasks
        (id, household_id, child_profile_id, title, emoji, stars,
         schedule_type, schedule_data, position, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).bind(
        id,
        householdId,
        profile.id,
        title,
        emoji,
        stars,
        storage.type,
        storage.data,
        startingPosition + index,
        now,
        now,
      ),
    };
  });
  await db.batch(prepared.map((entry) => entry.statement));
  const created = await listTasksForParent(db, context, profile.id);
  const createdIds = new Set(prepared.map((entry) => entry.id));
  return created.filter((task) => createdIds.has(task.id));
}

export async function updateTaskForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  taskId: unknown,
  patch: TaskPatch,
  options: { now?: Date } = {},
): Promise<ParentTask> {
  const current = await taskRowForParent(db, context, taskId, { includeArchived: true });
  const householdId = scopedHousehold(context);
  const title = patch.title === undefined ? current.title : validateTaskTitle(patch.title);
  const emoji = patch.emoji === undefined ? current.emoji : validateTaskEmoji(patch.emoji);
  const stars = patch.stars === undefined ? current.stars : validateStars(patch.stars);
  const schedule = patch.schedule === undefined ? scheduleToStorage(current.schedule) : scheduleToStorage(patch.schedule);
  if (patch.archived !== undefined && typeof patch.archived !== "boolean") {
    throw new ValidationError("archived", "archived must be a boolean");
  }
  const wantsArchived = patch.archived === undefined ? current.archivedAt !== null : patch.archived;
  const now = toUtcTimestamp(options.now ?? new Date());
  const archivedAt = wantsArchived ? current.archivedAt ?? now : null;
  const position = !wantsArchived && current.archivedAt ? await nextPosition(db, householdId, current.profileId) : current.position;
  await runStatement(
    db.prepare(`UPDATE tasks
      SET title = ?, emoji = ?, stars = ?, schedule_type = ?, schedule_data = ?,
          position = ?, archived_at = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND child_profile_id = ?`)
      .bind(title, emoji, stars, schedule.type, schedule.data,
        position, archivedAt, now, current.id, householdId, current.profileId),
  );
  return taskRowForParent(db, context, current.id, { includeArchived: true });
}

export async function archiveTaskForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  taskId: unknown,
  options: { now?: Date } = {},
): Promise<ParentTask> {
  return updateTaskForParent(db, context, taskId, { archived: true }, options);
}

export async function reorderTasksForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  taskIds: unknown,
): Promise<ParentTask[]> {
  const householdId = scopedHousehold(context);
  const profile = await activeProfile(db, context, profileId);
  if (!Array.isArray(taskIds) || taskIds.length > 100 || taskIds.some((id) => typeof id !== "string")) {
    throw new ValidationError("taskIds", "taskIds must be a list of task IDs");
  }
  const ids = taskIds.map((id) => validateTaskId(id, "taskIds"));
  if (new Set(ids).size !== ids.length) throw new ValidationError("taskIds", "taskIds must not contain duplicates");
  const current = await listTasksForParent(db, context, profile.id);
  if (ids.length !== current.length || current.some((task) => !ids.includes(task.id))) {
    throw new ValidationError("taskIds", "taskIds must include every active task for this profile");
  }
  // Move through a collision-free range above the current active maximum. A
  // fixed sentinel (for example 100000) would eventually collide with a
  // legitimate high position and violate the partial unique index.
  const temporaryBase = Math.max(...current.map((task) => task.position), -1) + ids.length + 1;
  const temporary = ids.map((id, index) => db.prepare(`UPDATE tasks SET position = ? WHERE id = ? AND household_id = ? AND child_profile_id = ? AND archived_at IS NULL`).bind(temporaryBase + index, id, householdId, profile.id));
  const final = ids.map((id, index) => db.prepare(`UPDATE tasks SET position = ? WHERE id = ? AND household_id = ? AND child_profile_id = ? AND archived_at IS NULL`).bind(index, id, householdId, profile.id));
  if (db.batch) await db.batch([...temporary, ...final]);
  else {
    for (const statement of [...temporary, ...final]) await runStatement(statement);
  }
  return listTasksForParent(db, context, profile.id);
}

export async function listTaskOccurrencesForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
  options: { now?: Date; localDate?: unknown } = {},
): Promise<{ localDate: string; occurrences: TaskOccurrence[] }> {
  const household = await getParentHousehold(db, context);
  const profile = await activeProfile(db, context, profileId);
  const localDate = options.localDate === undefined
    ? localDateFor(options.now ?? new Date(), household.timezone)
    : validateLocalDate(options.localDate);
  const tasks = await listTasksForParent(db, context, profile.id);
  const [claims, reversals] = await Promise.all([
    db.prepare(`SELECT id, task_id AS taskId, status, submitted_at AS submittedAt
        FROM task_claims
        WHERE household_id = ? AND child_profile_id = ? AND due_date = ?
          AND status IN ('pending', 'approved')
        ORDER BY submitted_at ASC, id ASC`).bind(household.id, profile.id, localDate).all<{
          id: string;
          taskId: string;
          status: "pending" | "approved";
          submittedAt: string;
        }>(),
    db.prepare(`SELECT source_id AS sourceId
        FROM point_ledger
        WHERE household_id = ? AND child_profile_id = ? AND source_type = 'task_reversal'`).bind(household.id, profile.id).all<{
          sourceId: string;
        }>(),
  ]);
  const byTask = new Map<string, { id: string; status: "pending" | "approved"; submittedAt: string }>();
  for (const claim of claims.results ?? []) {
    if (!byTask.has(claim.taskId)) byTask.set(claim.taskId, claim);
  }
  const reversedSources = new Set((reversals.results ?? []).map((reversal) => reversal.sourceId));
  return {
    localDate,
    occurrences: tasks.filter((task) => isTaskDueOnLocalDate(task.schedule, localDate)).map((task) => {
      const claim = byTask.get(task.id);
      const occurrenceSource = `${household.id}:${profile.id}:${task.id}:${localDate}`;
      return {
        ...task,
        dueDate: localDate,
        state: claim?.status === "approved" ? "completed" : claim?.status === "pending" ? "waiting" : "todo",
        claimId: claim?.id ?? null,
        submittedAt: claim?.submittedAt ?? null,
        // A companion claim can be completed by the parent, which records the
        // original award against the occurrence rather than the claim ID. Check
        // both source forms so the UI reflects either path consistently.
        awardReversed: claim
          ? reversedSources.has(`task_claim:${claim.id}`) || reversedSources.has(`task_occurrence:${occurrenceSource}`)
          : false,
      };
    }),
  };
}
