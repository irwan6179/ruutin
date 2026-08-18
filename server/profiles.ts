import type { D1DatabaseLike, D1StatementLike, ParentContext } from "./auth-context";
import { ScopeError } from "./scoped-data";
import { assertEligibilityInput } from "./eligibility";
import {
  createId,
  toUtcTimestamp,
  validateAgeBand,
  type AgeBand,
  ValidationError,
} from "./validation";

export type ParentProfile = {
  id: string;
  householdId: string;
  nickname: string;
  emoji: string;
  ageBand: AgeBand | null;
  companionAccessEligible: 0 | 1;
  activeRewardId: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type ProfileInput = {
  nickname: unknown;
  emoji: unknown;
  ageBand: unknown;
  consentConfirmed: unknown;
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

export function validateNickname(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("nickname", "nickname is invalid");
  const nickname = value.normalize("NFKC").trim();
  if (nickname.length < 1 || nickname.length > 40) {
    throw new ValidationError("nickname", "nickname is invalid");
  }
  if ([...nickname].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("nickname", "nickname is invalid");
  }
  return nickname;
}

export function validateEmoji(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("emoji", "emoji is invalid");
  const emoji = value.trim();
  const codePoints = [...emoji];
  if (codePoints.length < 1 || codePoints.length > 8 || codePoints.some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new ValidationError("emoji", "emoji is invalid");
  }
  return emoji;
}

function profileSelect(): string {
  return `SELECT id, household_id AS householdId, nickname, emoji,
                 age_band AS ageBand,
                 companion_access_eligible AS companionAccessEligible,
                 active_reward_id AS activeRewardId, archived_at AS archivedAt,
                 created_at AS createdAt
          FROM child_profiles`;
}

export async function getProfileForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: string,
): Promise<ParentProfile> {
  const profile = await db
    .prepare(`${profileSelect()} WHERE id = ? AND household_id = ? LIMIT 1`)
    .bind(profileId, scopedHousehold(context))
    .first<ParentProfile>();
  if (!profile) throw new ScopeError();
  return profile;
}

export async function listProfilesForParent(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<ParentProfile[]> {
  const result = await db
    .prepare(
      `${profileSelect()}
       WHERE household_id = ?
       ORDER BY archived_at IS NOT NULL ASC, created_at ASC, id ASC`,
    )
    .bind(scopedHousehold(context))
    .all<ParentProfile>();
  return result.results ?? [];
}

export async function createProfileForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  input: ProfileInput,
  options: { now?: Date; profileId?: string } = {},
): Promise<ParentProfile> {
  const householdId = scopedHousehold(context);
  const nickname = validateNickname(input.nickname);
  const emoji = validateEmoji(input.emoji);
  const eligibility = assertEligibilityInput(input.ageBand, input.consentConfirmed);
  const createdAt = toUtcTimestamp(options.now ?? new Date());
  const id = options.profileId ?? createId();
  await runStatement(
    db
      .prepare(
        `INSERT INTO child_profiles
          (id, household_id, nickname, emoji, age_band,
           companion_access_eligible, active_reward_id, archived_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(
        id,
        householdId,
        nickname,
        emoji,
        eligibility.ageBand,
        eligibility.companionAccessEligible,
        createdAt,
      ),
  );
  return getProfileForParent(db, context, id);
}

export type ProfilePatch = Partial<ProfileInput> & { archived?: unknown };

export async function updateProfileForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: string,
  patch: ProfilePatch,
  options: { now?: Date } = {},
): Promise<ParentProfile> {
  const current = await getProfileForParent(db, context, profileId);
  const nextNickname = patch.nickname === undefined ? current.nickname : validateNickname(patch.nickname);
  const nextEmoji = patch.emoji === undefined ? current.emoji : validateEmoji(patch.emoji);
  let nextAgeBand: AgeBand | null = current.ageBand;
  let nextEligibility: 0 | 1 = current.companionAccessEligible;
  if (patch.archived !== undefined && typeof patch.archived !== "boolean") {
    throw new ValidationError("archived", "archived must be a boolean");
  }
  if (patch.ageBand !== undefined || patch.consentConfirmed !== undefined) {
    const ageBandChanged = patch.ageBand !== undefined;
    const ageBand = ageBandChanged ? validateAgeBand(patch.ageBand) : current.ageBand;
    // Changing the broad band starts a fresh eligibility decision. Reusing a
    // previous eligible bit would turn omitted age/consent into an implicit yes.
    const consent = patch.consentConfirmed;
    const eligibility = assertEligibilityInput(ageBand, consent);
    nextAgeBand = eligibility.ageBand;
    nextEligibility = eligibility.companionAccessEligible;
  }
  const archived = patch.archived === undefined ? current.archivedAt !== null : patch.archived === true;
  const archivedAt = archived ? current.archivedAt ?? toUtcTimestamp(options.now ?? new Date()) : null;
  if (archived) nextEligibility = 0;
  await runStatement(
    db
      .prepare(
        `UPDATE child_profiles
         SET nickname = ?, emoji = ?, age_band = ?,
             companion_access_eligible = ?, archived_at = ?
         WHERE id = ? AND household_id = ?`,
      )
      .bind(
        nextNickname,
        nextEmoji,
        nextAgeBand,
        nextEligibility,
        archivedAt,
        profileId,
        scopedHousehold(context),
      ),
  );
  return getProfileForParent(db, context, profileId);
}

export async function archiveProfileForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  profileId: string,
  options: { now?: Date } = {},
): Promise<ParentProfile> {
  return updateProfileForParent(db, context, profileId, { archived: true }, options);
}
