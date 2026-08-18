import type {
  CompanionContext,
  D1DatabaseLike,
  D1StatementLike,
  ParentContext,
} from "./auth-context";
import { getProfileForParent } from "./profiles";
import { ScopeError } from "./scoped-data";
import {
  createId,
  isTaskDueOnLocalDate,
  localDateFor,
  scheduleFromStorage,
  toUtcTimestamp,
  validateLocalDate,
  type LedgerEventType,
  ValidationError,
} from "./validation";

export type ClaimDecision = "approve" | "reject";

export type LedgerRow = {
  id: string;
  householdId: string;
  profileId: string;
  eventType: LedgerEventType;
  starsDelta: number;
  sourceType: string;
  sourceId: string;
  reason: string | null;
  actorUserId: string | null;
  localDate: string;
  createdAt: string;
};

export type ClaimRecord = {
  id: string;
  householdId: string;
  profileId: string;
  taskId: string;
  dueDate: string;
  submittedByType: "parent" | "companion";
  submittedByDeviceId: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
};

export type PendingClaim = ClaimRecord & {
  nickname: string;
  profileEmoji: string;
  taskTitle: string;
  taskEmoji: string;
  stars: number;
};

export type ClaimResult = {
  claim: ClaimRecord;
  balance: number;
};

export class ClaimConflictError extends Error {
  readonly status = 409;

  constructor(message = "This routine already has an active claim") {
    super(message);
    this.name = "ClaimConflictError";
  }
}

export class ClaimStateError extends Error {
  readonly status = 409;

  constructor(message = "This routine has already been resolved") {
    super(message);
    this.name = "ClaimStateError";
  }
}

export class LedgerAtomicityError extends Error {
  readonly status = 503;

  constructor() {
    super("Ledger operation is temporarily unavailable");
    this.name = "LedgerAtomicityError";
  }
}

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new LedgerAtomicityError();
  return statement.run();
}

function parentHousehold(context: ParentContext): string {
  if (
    context.kind !== "parent" ||
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

function validateId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new ValidationError(field, `${field} is invalid`);
  }
  return value;
}

function validateReason(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError("reason", "reason is required");
    return null;
  }
  if (typeof value !== "string") throw new ValidationError("reason", "reason is invalid");
  const reason = value.normalize("NFKC").trim();
  if (reason.length < 1 || reason.length > 240) throw new ValidationError("reason", "reason is invalid");
  if ([...reason].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("reason", "reason is invalid");
  }
  return reason;
}

function validateDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0 || Math.abs(value) > 1000) {
    throw new ValidationError("starsDelta", "starsDelta must be a non-zero whole number from -1000 to 1000");
  }
  return value;
}

function occurrenceSourceId(
  householdId: string,
  profileId: string,
  taskId: string,
  dueDate: string,
): string {
  // The source is globally unique in D1. Include the household even though
  // application IDs are normally opaque, so a restored/imported identifier
  // can never make two households share an occurrence award.
  return `${householdId}:${profileId}:${taskId}:${dueDate}`;
}

function claimSelect(): string {
  return `SELECT id, household_id AS householdId, child_profile_id AS profileId,
                 task_id AS taskId, due_date AS dueDate,
                 submitted_by_type AS submittedByType,
                 submitted_by_device_id AS submittedByDeviceId, status,
                 submitted_at AS submittedAt, resolved_at AS resolvedAt,
                 resolved_by_user_id AS resolvedByUserId
          FROM task_claims`;
}

async function getClaimForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  claimId: unknown,
): Promise<ClaimRecord> {
  const id = validateId(claimId, "claimId");
  const row = await db
    .prepare(`${claimSelect()} WHERE id = ? AND household_id = ? LIMIT 1`)
    .bind(id, parentHousehold(context))
    .first<ClaimRecord>();
  if (!row) throw new ScopeError();
  return row;
}

async function balanceForProfile(
  db: D1DatabaseLike,
  householdId: string,
  profileId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(stars_delta), 0) AS balance
              FROM point_ledger
              WHERE household_id = ? AND child_profile_id = ?`)
    .bind(householdId, profileId)
    .first<{ balance: number | null }>();
  return Number(row?.balance ?? 0);
}

export async function getProfileBalanceForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
): Promise<number> {
  const id = validateId(profileId, "profileId");
  await getProfileForParent(db, context, id);
  return balanceForProfile(db, parentHousehold(context), id);
}

export async function getLedgerForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: unknown,
): Promise<{ profileId: string; balance: number; entries: LedgerRow[] }> {
  const id = validateId(profileId, "profileId");
  await getProfileForParent(db, context, id);
  const householdId = parentHousehold(context);
  const result = await db
    .prepare(`SELECT id, household_id AS householdId, child_profile_id AS profileId,
                     event_type AS eventType, stars_delta AS starsDelta,
                     source_type AS sourceType, source_id AS sourceId,
                     reason, actor_user_id AS actorUserId,
                     local_date AS localDate, created_at AS createdAt
              FROM point_ledger
              WHERE household_id = ? AND child_profile_id = ?
              ORDER BY created_at DESC, id DESC`)
    .bind(householdId, id)
    .all<LedgerRow>();
  return { profileId: id, balance: await balanceForProfile(db, householdId, id), entries: result.results ?? [] };
}

export async function listPendingClaimsForParent(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<PendingClaim[]> {
  const householdId = parentHousehold(context);
  const result = await db
    .prepare(`SELECT c.id, c.household_id AS householdId,
                     c.child_profile_id AS profileId, c.task_id AS taskId,
                     c.due_date AS dueDate, c.submitted_by_type AS submittedByType,
                     c.submitted_by_device_id AS submittedByDeviceId,
                     c.status, c.submitted_at AS submittedAt,
                     c.resolved_at AS resolvedAt,
                     c.resolved_by_user_id AS resolvedByUserId,
                     p.nickname, p.emoji AS profileEmoji,
                     t.title AS taskTitle, t.emoji AS taskEmoji, t.stars
              FROM task_claims AS c
              INNER JOIN child_profiles AS p
                ON p.household_id = c.household_id AND p.id = c.child_profile_id
              INNER JOIN tasks AS t
                ON t.household_id = c.household_id AND t.id = c.task_id
              WHERE c.household_id = ? AND c.status = 'pending'
              ORDER BY c.submitted_at ASC, c.id ASC`)
    .bind(householdId)
    .all<PendingClaim>();
  return result.results ?? [];
}

async function householdLocalDate(
  db: D1DatabaseLike,
  householdId: string,
  now: Date,
): Promise<string> {
  const row = await db.prepare("SELECT timezone FROM households WHERE id = ? LIMIT 1").bind(householdId).first<{ timezone: string }>();
  if (!row) throw new ScopeError();
  return localDateFor(now, row.timezone);
}

export async function claimCompanionTask(
  db: D1DatabaseLike,
  context: CompanionContext,
  taskIdValue: unknown,
  options: { now?: Date; claimId?: string } = {},
): Promise<{ today: import("./companion").CompanionToday; claim: ClaimRecord }> {
  const taskId = validateId(taskIdValue, "taskId");
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  const device = await db.prepare(`SELECT id
      FROM child_devices
      WHERE id = ? AND household_id = ? AND child_profile_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1`).bind(context.deviceId, context.householdId, context.profileId, now).first<{ id: string }>();
  if (!device) throw new ScopeError();
  const localDate = await householdLocalDate(db, context.householdId, nowDate);
  const task = await db
    .prepare(`SELECT tasks.id, schedule_type AS scheduleType, schedule_data AS scheduleData
              FROM tasks
              INNER JOIN child_profiles AS p
                ON p.household_id = tasks.household_id AND p.id = tasks.child_profile_id
              WHERE tasks.id = ? AND tasks.household_id = ?
                AND tasks.child_profile_id = ? AND tasks.archived_at IS NULL
                AND p.archived_at IS NULL AND p.companion_access_eligible = 1
                AND (p.age_band IS NULL OR p.age_band <> 'under_13')
              LIMIT 1`)
    .bind(taskId, context.householdId, context.profileId)
    .first<{ id: string; scheduleType: string; scheduleData: string }>();
  if (!task) throw new ScopeError();
  let due = false;
  try {
    due = isTaskDueOnLocalDate(scheduleFromStorage(task.scheduleType, task.scheduleData), localDate);
  } catch {
    throw new ScopeError();
  }
  if (!due) throw new ClaimConflictError("That routine is not due today");
  const id = options.claimId ?? createId();
  try {
    await runStatement(db.prepare(`INSERT INTO task_claims
      (id, household_id, child_profile_id, task_id, due_date,
       submitted_by_type, submitted_by_device_id, status, submitted_at,
       resolved_at, resolved_by_user_id)
      VALUES (?, ?, ?, ?, ?, 'companion', ?, 'pending', ?, NULL, NULL)`)
      .bind(id, context.householdId, context.profileId, taskId, localDate, context.deviceId, now));
  } catch {
    const existing = await db.prepare(`${claimSelect()}
      WHERE household_id = ? AND child_profile_id = ? AND task_id = ?
        AND due_date = ? AND status IN ('pending', 'approved')
      LIMIT 1`).bind(context.householdId, context.profileId, taskId, localDate).first<ClaimRecord>();
    if (existing) throw new ClaimConflictError();
    throw new LedgerAtomicityError();
  }
  const claim = await db.prepare(`${claimSelect()} WHERE id = ? AND household_id = ? LIMIT 1`).bind(id, context.householdId).first<ClaimRecord>();
  if (!claim) throw new LedgerAtomicityError();
  const { getCompanionToday } = await import("./companion");
  return { claim, today: await getCompanionToday(db, context, { now: nowDate }) };
}

export async function resolveTaskClaimForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  claimIdValue: unknown,
  decision: ClaimDecision,
  options: { now?: Date; reason?: unknown } = {},
): Promise<ClaimResult> {
  const claim = await getClaimForParent(db, context, claimIdValue);
  if (decision !== "approve" && decision !== "reject") throw new ValidationError("decision", "decision is invalid");
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  const reason = validateReason(options.reason, false);
  const householdId = parentHousehold(context);
  if (claim.status !== "pending") {
    if ((decision === "approve" && claim.status === "approved") || (decision === "reject" && claim.status === "rejected")) {
      return { claim, balance: await balanceForProfile(db, householdId, claim.profileId) };
    }
    throw new ClaimStateError();
  }
  if (decision === "reject") {
    await runStatement(db.prepare(`UPDATE task_claims
      SET status = 'rejected', resolved_at = ?, resolved_by_user_id = ?
      WHERE id = ? AND household_id = ? AND status = 'pending'`)
      .bind(now, context.userId, claim.id, householdId));
    const updated = await getClaimForParent(db, context, claim.id);
    // A concurrent approval may win between the initial read and this
    // conditional update. Never report success for a state we did not write.
    if (updated.status !== "rejected") throw new ClaimStateError();
    return { claim: updated, balance: await balanceForProfile(db, householdId, claim.profileId) };
  }
  if (!db.batch) throw new LedgerAtomicityError();
  const occurrenceSource = occurrenceSourceId(householdId, claim.profileId, claim.taskId, claim.dueDate);
  const updateClaim = db.prepare(`UPDATE task_claims
    SET status = 'approved', resolved_at = ?, resolved_by_user_id = ?
    WHERE id = ? AND household_id = ? AND status = 'pending'`)
    .bind(now, context.userId, claim.id, householdId);
  const insertLedger = db.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta,
     source_type, source_id, reason, actor_user_id, local_date, created_at)
    SELECT ?, c.household_id, c.child_profile_id, 'task_approved', t.stars,
           'task_claim', c.id, ?, ?, c.due_date, ?
    FROM task_claims AS c
    INNER JOIN tasks AS t
      ON t.household_id = c.household_id AND t.id = c.task_id
    WHERE c.id = ? AND c.household_id = ? AND c.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger AS existing
        WHERE existing.source_type = 'task_claim' AND existing.source_id = c.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger AS parent_event
        WHERE parent_event.source_type = 'task_occurrence'
          AND parent_event.source_id = ?
      )`)
    .bind(createId(), reason ?? "Routine approved by parent", context.userId, now, claim.id, householdId, occurrenceSource);
  await db.batch([updateClaim, insertLedger]);
  const updated = await getClaimForParent(db, context, claim.id);
  if (updated.status !== "approved") throw new LedgerAtomicityError();
  // D1 batches are atomic, but keep an explicit postcondition so a test or
  // provider shim that silently drops the second statement cannot report an
  // approved claim without an attributable award.
  const award = await db.prepare(`SELECT 1 AS present
    FROM point_ledger
    WHERE household_id = ? AND child_profile_id = ?
      AND ((source_type = 'task_claim' AND source_id = ?)
        OR (source_type = 'task_occurrence' AND source_id = ?))
    LIMIT 1`).bind(householdId, claim.profileId, claim.id, occurrenceSource).first<{ present: number }>();
  if (!award) throw new LedgerAtomicityError();
  return { claim: updated, balance: await balanceForProfile(db, householdId, claim.profileId) };
}

export async function completeTaskForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  input: { profileId: unknown; taskId: unknown; dueDate?: unknown },
  options: { now?: Date; reason?: unknown } = {},
): Promise<ClaimResult> {
  const profileId = validateId(input.profileId, "profileId");
  const taskId = validateId(input.taskId, "taskId");
  const householdId = parentHousehold(context);
  await getProfileForParent(db, context, profileId);
  const nowDate = options.now ?? new Date();
  const localDate = await householdLocalDate(db, householdId, nowDate);
  if (input.dueDate !== undefined && validateLocalDate(input.dueDate) !== localDate) {
    throw new ClaimConflictError("That routine is only available for today");
  }
  const task = await db.prepare(`SELECT id, stars, schedule_type AS scheduleType, schedule_data AS scheduleData
    FROM tasks WHERE id = ? AND household_id = ? AND child_profile_id = ?
      AND archived_at IS NULL LIMIT 1`).bind(taskId, householdId, profileId).first<{
    id: string;
    stars: number;
    scheduleType: string;
    scheduleData: string;
  }>();
  if (!task) throw new ScopeError();
  try {
    if (!isTaskDueOnLocalDate(scheduleFromStorage(task.scheduleType, task.scheduleData), localDate)) {
      throw new ClaimConflictError("That routine is not due today");
    }
  } catch (error) {
    if (error instanceof ClaimConflictError) throw error;
    throw new ScopeError();
  }
  if (!db.batch) throw new LedgerAtomicityError();
  const now = toUtcTimestamp(nowDate);
  const occurrenceSource = occurrenceSourceId(householdId, profileId, taskId, localDate);
  const claimId = createId();
  const reason = validateReason(options.reason, false) ?? "Routine completed by parent";
  const approvePending = db.prepare(`UPDATE task_claims
    SET status = 'approved', resolved_at = ?, resolved_by_user_id = ?
    WHERE household_id = ? AND child_profile_id = ? AND task_id = ? AND due_date = ?
      AND status = 'pending'`).bind(now, context.userId, householdId, profileId, taskId, localDate);
  const insertParentClaim = db.prepare(`INSERT INTO task_claims
    (id, household_id, child_profile_id, task_id, due_date,
     submitted_by_type, submitted_by_device_id, status, submitted_at,
     resolved_at, resolved_by_user_id)
    SELECT ?, ?, ?, ?, ?, 'parent', NULL, 'approved', ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM task_claims
      WHERE household_id = ? AND child_profile_id = ? AND task_id = ?
        AND due_date = ? AND status IN ('pending', 'approved')
    )`).bind(claimId, householdId, profileId, taskId, localDate, now, now, context.userId, householdId, profileId, taskId, localDate);
  const insertLedger = db.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta,
     source_type, source_id, reason, actor_user_id, local_date, created_at)
    SELECT ?, ?, ?, 'parent_completed_task', ?, 'task_occurrence', ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM task_claims
      WHERE household_id = ? AND child_profile_id = ? AND task_id = ?
        AND due_date = ? AND status = 'approved'
    )
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger
        WHERE source_type = 'task_occurrence' AND source_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger AS companion_event
        INNER JOIN task_claims AS companion_claim
          ON companion_claim.id = companion_event.source_id
        WHERE companion_event.source_type = 'task_claim'
          AND companion_claim.household_id = ?
          AND companion_claim.child_profile_id = ?
          AND companion_claim.task_id = ?
          AND companion_claim.due_date = ?
      )`).bind(createId(), householdId, profileId, task.stars, occurrenceSource, reason, context.userId, localDate, now, householdId, profileId, taskId, localDate, occurrenceSource, householdId, profileId, taskId, localDate);
  await db.batch([approvePending, insertParentClaim, insertLedger]);
  const resolved = await db.prepare(`${claimSelect()}
    WHERE household_id = ? AND child_profile_id = ? AND task_id = ? AND due_date = ?
      AND status IN ('pending', 'approved') ORDER BY submitted_at DESC, id DESC LIMIT 1`).bind(householdId, profileId, taskId, localDate).first<ClaimRecord>();
  if (!resolved || resolved.status !== "approved") throw new LedgerAtomicityError();
  const award = await db.prepare(`SELECT 1 AS present
    FROM point_ledger
    WHERE household_id = ? AND child_profile_id = ?
      AND ((source_type = 'task_occurrence' AND source_id = ?)
        OR (source_type = 'task_claim' AND source_id = ?))
    LIMIT 1`).bind(householdId, profileId, occurrenceSource, resolved.id).first<{ present: number }>();
  if (!award) throw new LedgerAtomicityError();
  return { claim: resolved, balance: await balanceForProfile(db, householdId, profileId) };
}

export async function reverseTaskLedgerForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  claimIdValue: unknown,
  reasonValue: unknown,
  options: { now?: Date } = {},
): Promise<{ entry: LedgerRow; balance: number }> {
  const claim = await getClaimForParent(db, context, claimIdValue);
  if (claim.status !== "approved") throw new ClaimStateError("Only an approved routine can be reversed");
  const householdId = parentHousehold(context);
  const occurrenceSource = occurrenceSourceId(householdId, claim.profileId, claim.taskId, claim.dueDate);
  const sourceType = claim.submittedByType === "parent" ? "task_occurrence" : "task_claim";
  const sourceId = claim.submittedByType === "parent" ? occurrenceSource : claim.id;
  let original = await db.prepare(`SELECT id, household_id AS householdId,
      child_profile_id AS profileId, event_type AS eventType,
      stars_delta AS starsDelta, source_type AS sourceType,
      source_id AS sourceId, reason, actor_user_id AS actorUserId,
      local_date AS localDate, created_at AS createdAt
    FROM point_ledger WHERE household_id = ? AND child_profile_id = ?
      AND source_type = ? AND source_id = ? LIMIT 1`).bind(householdId, claim.profileId, sourceType, sourceId).first<LedgerRow>();
  // A parent can approve a pending companion claim through direct completion.
  // In that case the occurrence still has a parent-completion event, so the
  // reversal must find that compensating source without rewriting the claim.
  if (!original && claim.submittedByType === "companion") {
    original = await db.prepare(`SELECT id, household_id AS householdId,
        child_profile_id AS profileId, event_type AS eventType,
        stars_delta AS starsDelta, source_type AS sourceType,
        source_id AS sourceId, reason, actor_user_id AS actorUserId,
        local_date AS localDate, created_at AS createdAt
      FROM point_ledger WHERE household_id = ? AND child_profile_id = ?
        AND source_type = 'task_occurrence' AND source_id = ? LIMIT 1`).bind(householdId, claim.profileId, occurrenceSource).first<LedgerRow>();
  }
  if (!original) throw new ScopeError();
  const reason = validateReason(reasonValue, true);
  const nowDate = options.now ?? new Date();
  const localDate = await householdLocalDate(db, householdId, nowDate);
  const reversalSourceId = `${original.sourceType}:${original.sourceId}`;
  try {
    await runStatement(db.prepare(`INSERT INTO point_ledger
      (id, household_id, child_profile_id, event_type, stars_delta,
       source_type, source_id, reason, actor_user_id, local_date, created_at)
      SELECT ?, ?, ?, 'task_reversed', ?, 'task_reversal', ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM point_ledger
        WHERE source_type = 'task_reversal' AND source_id = ?
      )`).bind(createId(), householdId, claim.profileId, -original.starsDelta, reversalSourceId, reason, context.userId, localDate, toUtcTimestamp(nowDate), reversalSourceId));
  } catch {
    const existing = await db.prepare(`SELECT id, household_id AS householdId,
      child_profile_id AS profileId, event_type AS eventType,
      stars_delta AS starsDelta, source_type AS sourceType,
      source_id AS sourceId, reason, actor_user_id AS actorUserId,
      local_date AS localDate, created_at AS createdAt
      FROM point_ledger WHERE source_type = 'task_reversal' AND source_id = ? LIMIT 1`).bind(reversalSourceId).first<LedgerRow>();
    if (!existing) throw new LedgerAtomicityError();
  }
  const entry = await db.prepare(`SELECT id, household_id AS householdId,
      child_profile_id AS profileId, event_type AS eventType,
      stars_delta AS starsDelta, source_type AS sourceType,
      source_id AS sourceId, reason, actor_user_id AS actorUserId,
      local_date AS localDate, created_at AS createdAt
    FROM point_ledger WHERE source_type = 'task_reversal' AND source_id = ? LIMIT 1`).bind(reversalSourceId).first<LedgerRow>();
  if (!entry) throw new LedgerAtomicityError();
  return { entry, balance: await balanceForProfile(db, householdId, claim.profileId) };
}

export async function createManualAdjustmentForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  input: { profileId: unknown; starsDelta: unknown; reason: unknown; requestId?: unknown },
  options: { now?: Date } = {},
): Promise<{ entry: LedgerRow; balance: number }> {
  const profileId = validateId(input.profileId, "profileId");
  await getProfileForParent(db, context, profileId);
  const householdId = parentHousehold(context);
  const starsDelta = validateDelta(input.starsDelta);
  const reason = validateReason(input.reason, true);
  // A browser may provide an opaque retry key, but never a ledger source key.
  // Namespacing it with the verified household and actor makes the stored
  // source server-derived and prevents cross-profile replay of one key.
  const requestId = input.requestId === undefined
    ? createId()
    : validateId(input.requestId, "requestId");
  if ([...requestId].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("requestId", "requestId is invalid");
  }
  const sourceId = `manual:${householdId}:${context.userId}:${requestId}`;
  const nowDate = options.now ?? new Date();
  // The ledger's local date is always derived from the household timezone;
  // a client cannot backdate or move an adjustment across a local-day edge.
  const localDate = await householdLocalDate(db, householdId, nowDate);
  const now = toUtcTimestamp(nowDate);
  try {
    await runStatement(db.prepare(`INSERT INTO point_ledger
      (id, household_id, child_profile_id, event_type, stars_delta,
       source_type, source_id, reason, actor_user_id, local_date, created_at)
      VALUES (?, ?, ?, 'manual_adjustment', ?, 'manual_adjustment', ?, ?, ?, ?, ?)`)
      .bind(createId(), householdId, profileId, starsDelta, sourceId, reason, context.userId, localDate, now));
  } catch {
    const existing = await db.prepare(`SELECT id, household_id AS householdId,
      child_profile_id AS profileId, event_type AS eventType,
      stars_delta AS starsDelta, source_type AS sourceType,
      source_id AS sourceId, reason, actor_user_id AS actorUserId,
      local_date AS localDate, created_at AS createdAt
      FROM point_ledger WHERE source_type = 'manual_adjustment' AND source_id = ?
        AND household_id = ? LIMIT 1`).bind(sourceId, householdId).first<LedgerRow>();
    if (!existing) throw new LedgerAtomicityError();
    // A reused key for a different profile/delta is not a successful retry.
    // Keep the response generic so it cannot be used to probe ledger rows.
    if (existing.profileId !== profileId || existing.starsDelta !== starsDelta) {
      throw new ClaimConflictError();
    }
  }
  const entry = await db.prepare(`SELECT id, household_id AS householdId,
      child_profile_id AS profileId, event_type AS eventType,
      stars_delta AS starsDelta, source_type AS sourceType,
      source_id AS sourceId, reason, actor_user_id AS actorUserId,
      local_date AS localDate, created_at AS createdAt
    FROM point_ledger WHERE source_type = 'manual_adjustment' AND source_id = ?
      AND household_id = ? LIMIT 1`).bind(sourceId, householdId).first<LedgerRow>();
  if (!entry) throw new LedgerAtomicityError();
  return { entry, balance: await balanceForProfile(db, householdId, profileId) };
}

export async function getClaimForCompanion(
  db: D1DatabaseLike,
  context: CompanionContext,
  claimId: unknown,
): Promise<ClaimRecord> {
  const id = validateId(claimId, "claimId");
  const claim = await db.prepare(`${claimSelect()}
    WHERE id = ? AND household_id = ? AND child_profile_id = ?
      AND submitted_by_device_id = ? LIMIT 1`).bind(id, context.householdId, context.profileId, context.deviceId).first<ClaimRecord>();
  if (!claim) throw new ScopeError();
  return claim;
}
