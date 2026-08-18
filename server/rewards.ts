import type {
  CompanionContext,
  D1DatabaseLike,
  D1StatementLike,
  ParentContext,
} from "./auth-context";
import { ScopeError } from "./scoped-data";
import {
  createId,
  localDateFor,
  toUtcTimestamp,
  type LedgerEventType,
  ValidationError,
} from "./validation";

export type RewardRecord = {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  emoji: string;
  starCost: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RewardRequestRecord = {
  id: string;
  householdId: string;
  profileId: string;
  rewardId: string;
  status: "pending" | "approved" | "rejected";
  requestedByDeviceId: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
};

export type RewardRequestView = RewardRequestRecord & {
  nickname: string;
  profileEmoji: string;
  rewardTitle: string;
  rewardEmoji: string;
  starCost: number;
  rewardArchivedAt: string | null;
};

export type RewardDecision = "approve" | "reject";

export type RewardDecisionResult = {
  request: RewardRequestRecord;
  balance: number;
};

export type RewardLedgerRow = {
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

export class RewardConflictError extends Error {
  readonly status = 409;

  constructor(message = "This reward action conflicts with current state") {
    super(message);
    this.name = "RewardConflictError";
  }
}

export class RewardStateError extends Error {
  readonly status = 409;

  constructor(message = "This reward request has already been resolved") {
    super(message);
    this.name = "RewardStateError";
  }
}

export class RewardLimitError extends Error {
  readonly status = 409;

  constructor() {
    super("This profile already has the maximum number of active rewards");
    this.name = "RewardLimitError";
  }
}

export class RewardInsufficientBalanceError extends RewardStateError {
  constructor() {
    super("This profile does not have enough stars for that reward");
    this.name = "RewardInsufficientBalanceError";
  }
}

export class RewardAtomicityError extends Error {
  readonly status = 503;

  constructor() {
    super("Reward operation is temporarily unavailable");
    this.name = "RewardAtomicityError";
  }
}

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new RewardAtomicityError();
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

function assertCompanion(context: CompanionContext): void {
  if (context.kind !== "companion") throw new ScopeError();
}

function validateId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    [...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
  ) {
    throw new ValidationError(field, `${field} is invalid`);
  }
  return value;
}

function validateTitle(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("title", "title is invalid");
  const title = value.normalize("NFKC").trim();
  if (title.length < 1 || title.length > 120) throw new ValidationError("title", "title is invalid");
  if ([...title].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("title", "title is invalid");
  }
  return title;
}

function validateEmoji(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("emoji", "emoji is invalid");
  const emoji = value.trim();
  const codePoints = [...emoji];
  if (
    codePoints.length < 1 ||
    codePoints.length > 8 ||
    codePoints.some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
  ) {
    throw new ValidationError("emoji", "emoji is invalid");
  }
  return emoji;
}

function validateStarCost(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError("starCost", "starCost must be a positive whole number");
  }
  return value;
}

function validateReason(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Reward approved by parent";
  if (typeof value !== "string") throw new ValidationError("reason", "reason is invalid");
  const reason = value.normalize("NFKC").trim();
  if (reason.length < 1 || reason.length > 240) throw new ValidationError("reason", "reason is invalid");
  if ([...reason].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("reason", "reason is invalid");
  }
  return reason;
}

function rewardSelect(): string {
  return `SELECT id, household_id AS householdId, child_profile_id AS profileId,
                 title, emoji, star_cost AS starCost,
                 archived_at AS archivedAt, created_at AS createdAt,
                 updated_at AS updatedAt
          FROM rewards`;
}

function requestSelect(): string {
  return `SELECT q.id, q.household_id AS householdId,
                 q.child_profile_id AS profileId, q.reward_id AS rewardId,
                 q.status, q.requested_by_device_id AS requestedByDeviceId,
                 q.requested_at AS requestedAt, q.resolved_at AS resolvedAt,
                 q.resolved_by_user_id AS resolvedByUserId,
                 p.nickname, p.emoji AS profileEmoji,
                 r.title AS rewardTitle, r.emoji AS rewardEmoji,
                 r.star_cost AS starCost, r.archived_at AS rewardArchivedAt
          FROM reward_requests AS q
          INNER JOIN child_profiles AS p
            ON p.household_id = q.household_id AND p.id = q.child_profile_id
          INNER JOIN rewards AS r
            ON r.household_id = q.household_id AND r.id = q.reward_id`;
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

async function householdLocalDate(
  db: D1DatabaseLike,
  householdId: string,
  now: Date,
): Promise<string> {
  const row = await db
    .prepare("SELECT timezone FROM households WHERE id = ? LIMIT 1")
    .bind(householdId)
    .first<{ timezone: string }>();
  if (!row) throw new ScopeError();
  return localDateFor(now, row.timezone);
}

async function parentProfile(
  db: D1DatabaseLike,
  context: ParentContext,
  profileIdValue: unknown,
  options: { active?: boolean } = {},
): Promise<{ id: string; archivedAt: string | null }> {
  const profileId = validateId(profileIdValue, "profileId");
  const householdId = parentHousehold(context);
  const row = await db
    .prepare(`SELECT id, archived_at AS archivedAt
              FROM child_profiles
              WHERE id = ? AND household_id = ?
                ${options.active ? "AND archived_at IS NULL" : ""}
              LIMIT 1`)
    .bind(profileId, householdId)
    .first<{ id: string; archivedAt: string | null }>();
  if (!row) throw new ScopeError();
  return row;
}

async function activeRewardCount(
  db: D1DatabaseLike,
  householdId: string,
  profileId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS count
              FROM rewards
              WHERE household_id = ? AND child_profile_id = ? AND archived_at IS NULL`)
    .bind(householdId, profileId)
    .first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

export async function getRewardForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  rewardIdValue: unknown,
): Promise<RewardRecord> {
  const rewardId = validateId(rewardIdValue, "rewardId");
  const row = await db
    .prepare(`${rewardSelect()} WHERE id = ? AND household_id = ? LIMIT 1`)
    .bind(rewardId, parentHousehold(context))
    .first<RewardRecord>();
  if (!row) throw new ScopeError();
  return row;
}

export async function listRewardsForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileIdValue?: unknown,
): Promise<RewardRecord[]> {
  const householdId = parentHousehold(context);
  if (profileIdValue !== undefined && profileIdValue !== null) {
    const profileId = validateId(profileIdValue, "profileId");
    await parentProfile(db, context, profileId);
    const result = await db
      .prepare(`${rewardSelect()} WHERE household_id = ? AND child_profile_id = ? ORDER BY archived_at IS NOT NULL ASC, created_at ASC, id ASC`)
      .bind(householdId, profileId)
      .all<RewardRecord>();
    return result.results ?? [];
  }
  const result = await db
    .prepare(`${rewardSelect()} WHERE household_id = ? ORDER BY child_profile_id ASC, archived_at IS NOT NULL ASC, created_at ASC, id ASC`)
    .bind(householdId)
    .all<RewardRecord>();
  return result.results ?? [];
}

export async function createRewardForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  input: { profileId: unknown; title: unknown; emoji: unknown; starCost: unknown },
  options: { now?: Date; rewardId?: string } = {},
): Promise<RewardRecord> {
  const profile = await parentProfile(db, context, input.profileId, { active: true });
  const householdId = parentHousehold(context);
  const title = validateTitle(input.title);
  const emoji = validateEmoji(input.emoji);
  const starCost = validateStarCost(input.starCost);
  const id = options.rewardId === undefined ? createId() : validateId(options.rewardId, "rewardId");
  const now = toUtcTimestamp(options.now ?? new Date());
  try {
    await runStatement(db.prepare(`INSERT INTO rewards
      (id, household_id, child_profile_id, title, emoji, star_cost,
       archived_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?
      WHERE (SELECT count(*) FROM rewards
             WHERE household_id = ? AND child_profile_id = ? AND archived_at IS NULL) < 5`)
      .bind(id, householdId, profile.id, title, emoji, starCost, now, now, householdId, profile.id));
  } catch {
    const existing = await db
      .prepare(`${rewardSelect()} WHERE id = ? AND household_id = ? LIMIT 1`)
      .bind(id, householdId)
      .first<RewardRecord>();
    if (existing) throw new RewardConflictError();
    if (await activeRewardCount(db, householdId, profile.id) >= 5) throw new RewardLimitError();
    throw new RewardAtomicityError();
  }
  const reward = await db
    .prepare(`${rewardSelect()} WHERE id = ? AND household_id = ? LIMIT 1`)
    .bind(id, householdId)
    .first<RewardRecord>();
  if (reward) return reward;
  if (await activeRewardCount(db, householdId, profile.id) >= 5) throw new RewardLimitError();
  throw new RewardAtomicityError();
}

export async function updateRewardForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  rewardIdValue: unknown,
  patch: { title?: unknown; emoji?: unknown; starCost?: unknown },
  options: { now?: Date } = {},
): Promise<RewardRecord> {
  const reward = await getRewardForParent(db, context, rewardIdValue);
  const title = patch.title === undefined ? reward.title : validateTitle(patch.title);
  const emoji = patch.emoji === undefined ? reward.emoji : validateEmoji(patch.emoji);
  const starCost = patch.starCost === undefined ? reward.starCost : validateStarCost(patch.starCost);
  const now = toUtcTimestamp(options.now ?? new Date());
  await runStatement(db.prepare(`UPDATE rewards
    SET title = ?, emoji = ?, star_cost = ?, updated_at = ?
    WHERE id = ? AND household_id = ?`)
    .bind(title, emoji, starCost, now, reward.id, parentHousehold(context)));
  return getRewardForParent(db, context, reward.id);
}

export async function archiveRewardForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  rewardIdValue: unknown,
  options: { now?: Date } = {},
): Promise<RewardRecord> {
  const reward = await getRewardForParent(db, context, rewardIdValue);
  if (reward.archivedAt) return reward;
  if (!db.batch) throw new RewardAtomicityError();
  const householdId = parentHousehold(context);
  const archivedAt = toUtcTimestamp(options.now ?? new Date());
  const clearActive = db.prepare(`UPDATE child_profiles
    SET active_reward_id = NULL
    WHERE household_id = ? AND id = ? AND active_reward_id = ?`)
    .bind(householdId, reward.profileId, reward.id);
  const archive = db.prepare(`UPDATE rewards
    SET archived_at = ?, updated_at = ?
    WHERE household_id = ? AND id = ? AND archived_at IS NULL`)
    .bind(archivedAt, archivedAt, householdId, reward.id);
  await db.batch([clearActive, archive]);
  const archived = await getRewardForParent(db, context, reward.id);
  if (!archived.archivedAt) throw new RewardAtomicityError();
  return archived;
}

export async function setActiveRewardForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileIdValue: unknown,
  rewardIdValue: unknown,
): Promise<RewardRecord | null> {
  const profileId = validateId(profileIdValue, "profileId");
  const profile = await parentProfile(db, context, profileId);
  const householdId = parentHousehold(context);
  if (rewardIdValue !== null && rewardIdValue !== undefined) {
    if (profile.archivedAt) throw new ScopeError();
    const rewardId = validateId(rewardIdValue, "rewardId");
    const reward = await db
      .prepare(`${rewardSelect()} WHERE id = ? AND household_id = ? AND child_profile_id = ? AND archived_at IS NULL LIMIT 1`)
      .bind(rewardId, householdId, profile.id)
      .first<RewardRecord>();
    if (!reward) throw new ScopeError();
    await runStatement(db.prepare(`UPDATE child_profiles
      SET active_reward_id = ?
      WHERE id = ? AND household_id = ? AND archived_at IS NULL`)
      .bind(reward.id, profile.id, householdId));
    const selected = await db
      .prepare(`${rewardSelect()} WHERE id = ? AND household_id = ? AND child_profile_id = ? AND archived_at IS NULL LIMIT 1`)
      .bind(reward.id, householdId, profile.id)
      .first<RewardRecord>();
    if (!selected) throw new RewardAtomicityError();
    return selected;
  }
  await runStatement(db.prepare(`UPDATE child_profiles
    SET active_reward_id = NULL
    WHERE id = ? AND household_id = ?`)
    .bind(profile.id, householdId));
  return null;
}

async function getRewardRequestForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  requestIdValue: unknown,
): Promise<RewardRequestView> {
  const requestId = validateId(requestIdValue, "requestId");
  const row = await db
    .prepare(`${requestSelect()} WHERE q.id = ? AND q.household_id = ? LIMIT 1`)
    .bind(requestId, parentHousehold(context))
    .first<RewardRequestView>();
  if (!row) throw new ScopeError();
  return row;
}

export async function listPendingRewardRequestsForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileIdValue?: unknown,
): Promise<RewardRequestView[]> {
  const householdId = parentHousehold(context);
  if (profileIdValue !== undefined && profileIdValue !== null) {
    const profileId = validateId(profileIdValue, "profileId");
    await parentProfile(db, context, profileId);
    const result = await db
      .prepare(`${requestSelect()} WHERE q.household_id = ? AND q.child_profile_id = ? AND q.status = 'pending' ORDER BY q.requested_at ASC, q.id ASC`)
      .bind(householdId, profileId)
      .all<RewardRequestView>();
    return result.results ?? [];
  }
  const result = await db
    .prepare(`${requestSelect()} WHERE q.household_id = ? AND q.status = 'pending' ORDER BY q.requested_at ASC, q.id ASC`)
    .bind(householdId)
    .all<RewardRequestView>();
  return result.results ?? [];
}

/**
 * Return the household's reward request ledger for the parent Rewards page.
 * Keeping this query beside the pending-only queue makes the UI refetch an
 * authoritative, household-scoped snapshot after every decision.
 */
export async function listRewardRequestsForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileIdValue?: unknown,
): Promise<RewardRequestView[]> {
  const householdId = parentHousehold(context);
  if (profileIdValue !== undefined && profileIdValue !== null) {
    const profileId = validateId(profileIdValue, "profileId");
    await parentProfile(db, context, profileId);
    const result = await db
      .prepare(`${requestSelect()} WHERE q.household_id = ? AND q.child_profile_id = ? ORDER BY q.requested_at DESC, q.id DESC`)
      .bind(householdId, profileId)
      .all<RewardRequestView>();
    return result.results ?? [];
  }
  const result = await db
    .prepare(`${requestSelect()} WHERE q.household_id = ? ORDER BY q.requested_at DESC, q.id DESC`)
    .bind(householdId)
    .all<RewardRequestView>();
  return result.results ?? [];
}

async function getRewardRequestForCompanion(
  db: D1DatabaseLike,
  context: CompanionContext,
  requestIdValue: unknown,
): Promise<RewardRequestRecord> {
  const requestId = validateId(requestIdValue, "requestId");
  const row = await db
    .prepare(`SELECT id, household_id AS householdId, child_profile_id AS profileId,
                     reward_id AS rewardId, status,
                     requested_by_device_id AS requestedByDeviceId,
                     requested_at AS requestedAt, resolved_at AS resolvedAt,
                     resolved_by_user_id AS resolvedByUserId
              FROM reward_requests
              WHERE id = ? AND household_id = ? AND child_profile_id = ?
                AND requested_by_device_id = ? LIMIT 1`)
    .bind(requestId, context.householdId, context.profileId, context.deviceId)
    .first<RewardRequestRecord>();
  if (!row) throw new ScopeError();
  return row;
}

export async function listRewardRequestsForCompanion(
  db: D1DatabaseLike,
  context: CompanionContext,
): Promise<RewardRequestRecord[]> {
  assertCompanion(context);
  const result = await db
    .prepare(`SELECT id, household_id AS householdId, child_profile_id AS profileId,
                     reward_id AS rewardId, status,
                     requested_by_device_id AS requestedByDeviceId,
                     requested_at AS requestedAt, resolved_at AS resolvedAt,
                     resolved_by_user_id AS resolvedByUserId
              FROM reward_requests
              WHERE household_id = ? AND child_profile_id = ?
              ORDER BY requested_at DESC, id DESC`)
    .bind(context.householdId, context.profileId)
    .all<RewardRequestRecord>();
  return result.results ?? [];
}

export async function createRewardRequestForCompanion(
  db: D1DatabaseLike,
  context: CompanionContext,
  rewardIdValue: unknown,
  options: { now?: Date; requestId?: string } = {},
): Promise<RewardRequestRecord> {
  assertCompanion(context);
  const rewardId = validateId(rewardIdValue, "rewardId");
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  const reward = await db
    .prepare(`SELECT r.id
              FROM rewards AS r
              INNER JOIN child_profiles AS p
                ON p.household_id = r.household_id AND p.id = r.child_profile_id
              INNER JOIN child_devices AS d
                ON d.household_id = r.household_id AND d.child_profile_id = r.child_profile_id
               AND d.id = ?
              WHERE r.id = ? AND r.household_id = ? AND r.child_profile_id = ?
                AND r.archived_at IS NULL AND p.archived_at IS NULL
                AND p.companion_access_eligible = 1
                AND (p.age_band IS NULL OR p.age_band <> 'under_13')
                AND d.revoked_at IS NULL
                AND (d.expires_at IS NULL OR d.expires_at > ?)
              LIMIT 1`)
    .bind(context.deviceId, rewardId, context.householdId, context.profileId, now)
    .first<{ id: string }>();
  if (!reward) throw new ScopeError();
  const requestId = options.requestId === undefined ? createId() : validateId(options.requestId, "requestId");
  try {
    await runStatement(db.prepare(`INSERT INTO reward_requests
      (id, household_id, child_profile_id, reward_id, status,
       requested_by_device_id, requested_at, resolved_at, resolved_by_user_id)
      SELECT ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL
      WHERE EXISTS (
        SELECT 1 FROM rewards AS r
        INNER JOIN child_profiles AS p
          ON p.household_id = r.household_id AND p.id = r.child_profile_id
        INNER JOIN child_devices AS d
          ON d.household_id = r.household_id AND d.child_profile_id = r.child_profile_id
         AND d.id = ?
        WHERE r.id = ? AND r.household_id = ? AND r.child_profile_id = ?
          AND r.archived_at IS NULL AND p.archived_at IS NULL
          AND p.companion_access_eligible = 1
          AND (p.age_band IS NULL OR p.age_band <> 'under_13')
          AND d.revoked_at IS NULL
          AND (d.expires_at IS NULL OR d.expires_at > ?)
      )`)
      .bind(requestId, context.householdId, context.profileId, reward.id, context.deviceId, now, context.deviceId, reward.id, context.householdId, context.profileId, now));
  } catch {
    const duplicate = await db
      .prepare(`SELECT id, household_id AS householdId, child_profile_id AS profileId,
                       reward_id AS rewardId, status,
                       requested_by_device_id AS requestedByDeviceId,
                       requested_at AS requestedAt, resolved_at AS resolvedAt,
                       resolved_by_user_id AS resolvedByUserId
                FROM reward_requests
                WHERE household_id = ? AND child_profile_id = ? AND reward_id = ?
                  AND status = 'pending' LIMIT 1`)
      .bind(context.householdId, context.profileId, reward.id)
      .first<RewardRequestRecord>();
    if (duplicate) throw new RewardConflictError();
    throw new RewardAtomicityError();
  }
  const request = await getRewardRequestForCompanion(db, context, requestId);
  if (request.status !== "pending") throw new RewardAtomicityError();
  return request;
}

async function rewardLedgerEntry(
  db: D1DatabaseLike,
  householdId: string,
  profileId: string,
  requestId: string,
): Promise<RewardLedgerRow | null> {
  return db
    .prepare(`SELECT id, household_id AS householdId, child_profile_id AS profileId,
                     event_type AS eventType, stars_delta AS starsDelta,
                     source_type AS sourceType, source_id AS sourceId,
                     reason, actor_user_id AS actorUserId,
                     local_date AS localDate, created_at AS createdAt
              FROM point_ledger
              WHERE household_id = ? AND child_profile_id = ?
                AND event_type = 'reward_redeemed'
                AND source_type = 'reward_request' AND source_id = ?
              LIMIT 1`)
    .bind(householdId, profileId, requestId)
    .first<RewardLedgerRow>();
}

export async function resolveRewardRequestForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  requestIdValue: unknown,
  decision: RewardDecision,
  options: { now?: Date; reason?: unknown } = {},
): Promise<RewardDecisionResult> {
  const request = await getRewardRequestForParent(db, context, requestIdValue);
  if (decision !== "approve" && decision !== "reject") {
    throw new ValidationError("decision", "decision is invalid");
  }
  const householdId = parentHousehold(context);
  const reason = validateReason(options.reason);
  const nowDate = options.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  if (request.status !== "pending") {
    if ((decision === "approve" && request.status === "approved") || (decision === "reject" && request.status === "rejected")) {
      if (request.status === "approved" && !(await rewardLedgerEntry(db, householdId, request.profileId, request.id))) {
        throw new RewardAtomicityError();
      }
      const balance = await balanceForProfile(db, householdId, request.profileId);
      if (request.status === "approved" && balance < 0) throw new RewardAtomicityError();
      return { request, balance };
    }
    throw new RewardStateError();
  }
  if (decision === "reject") {
    await runStatement(db.prepare(`UPDATE reward_requests
      SET status = 'rejected', resolved_at = ?, resolved_by_user_id = ?
      WHERE id = ? AND household_id = ? AND status = 'pending'`)
      .bind(now, context.userId, request.id, householdId));
    const updated = await getRewardRequestForParent(db, context, request.id);
    if (updated.status !== "rejected") throw new RewardStateError();
    return { request: updated, balance: await balanceForProfile(db, householdId, request.profileId) };
  }
  if (!db.batch) throw new RewardAtomicityError();
  const sourceId = request.id;
  const updateRequest = db.prepare(`UPDATE reward_requests
    SET status = 'approved', resolved_at = ?, resolved_by_user_id = ?
    WHERE id = ? AND household_id = ? AND status = 'pending'
      AND EXISTS (
        SELECT 1 FROM rewards AS r
        WHERE r.id = reward_requests.reward_id
          AND r.household_id = reward_requests.household_id
          AND r.child_profile_id = reward_requests.child_profile_id
          AND r.archived_at IS NULL
          AND (SELECT COALESCE(SUM(stars_delta), 0)
               FROM point_ledger
               WHERE household_id = reward_requests.household_id
                 AND child_profile_id = reward_requests.child_profile_id) >= r.star_cost
      )
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger
        WHERE source_type = 'reward_request' AND source_id = ?
      )`)
    .bind(now, context.userId, request.id, householdId, sourceId);
  const insertLedger = db.prepare(`INSERT INTO point_ledger
    (id, household_id, child_profile_id, event_type, stars_delta,
     source_type, source_id, reason, actor_user_id, local_date, created_at)
    SELECT ?, q.household_id, q.child_profile_id, 'reward_redeemed', -r.star_cost,
           'reward_request', q.id, ?, ?, ?, ?
    FROM reward_requests AS q
    INNER JOIN rewards AS r
      ON r.household_id = q.household_id AND r.id = q.reward_id
    WHERE q.id = ? AND q.household_id = ? AND q.status = 'approved'
      AND r.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM point_ledger
        WHERE source_type = 'reward_request' AND source_id = q.id
      )
      AND (SELECT COALESCE(SUM(stars_delta), 0)
           FROM point_ledger
           WHERE household_id = q.household_id
             AND child_profile_id = q.child_profile_id) >= r.star_cost`)
    .bind(createId(), reason, context.userId, await householdLocalDate(db, householdId, nowDate), now, request.id, householdId);
  await db.batch([updateRequest, insertLedger]);
  const updated = await getRewardRequestForParent(db, context, request.id);
  if (updated.status !== "approved") {
    const balance = await balanceForProfile(db, householdId, request.profileId);
    if (balance < updated.starCost) throw new RewardInsufficientBalanceError();
    throw new RewardStateError();
  }
  const entry = await rewardLedgerEntry(db, householdId, request.profileId, request.id);
  if (!entry || entry.starsDelta !== -updated.starCost) throw new RewardAtomicityError();
  const balance = await balanceForProfile(db, householdId, request.profileId);
  if (balance < 0) throw new RewardAtomicityError();
  return { request: updated, balance };
}
