import type { D1DatabaseLike, D1StatementLike, ParentContext } from "./auth-context";
import { ScopeError } from "./scoped-data";
import { validateNickname } from "./profiles";
import { toUtcTimestamp, ValidationError } from "./validation";

export type ParentDevice = {
  id: string;
  profileId: string;
  profileNickname: string;
  profileEmoji: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

function scopedHousehold(context: ParentContext): string {
  if (
    context.role !== "parent" ||
    !context.memberships.some(
      (membership) =>
        membership.householdId === context.householdId && membership.role === "parent",
    )
  ) throw new ScopeError();
  return context.householdId;
}

function resultChanges(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as { changes?: unknown; meta?: { changes?: unknown } };
  const changes = record.meta?.changes ?? record.changes;
  if (typeof changes === "number") return changes;
  if (typeof changes === "bigint") return Number(changes);
  return null;
}

async function runDeviceUpdate(
  db: D1DatabaseLike,
  statement: D1StatementLike,
  deviceId: string,
  householdId: string,
): Promise<void> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  const result = await statement.run();
  const changes = resultChanges(result);
  // D1 exposes meta.changes while local/test adapters commonly expose
  // changes directly. If neither is available, verify the scoped row rather
  // than silently reporting success for a missing or foreign device.
  if (changes === 0 || changes === null) {
    const existing = await db
      .prepare("SELECT id FROM child_devices WHERE id = ? AND household_id = ? LIMIT 1")
      .bind(deviceId, householdId)
      .first<{ id: string }>();
    if (!existing) throw new ScopeError();
  }
}

export async function listDevicesForParent(
  db: D1DatabaseLike,
  context: ParentContext,
): Promise<ParentDevice[]> {
  const result = await db
    .prepare(
      `SELECT d.id, d.child_profile_id AS profileId,
              p.nickname AS profileNickname, p.emoji AS profileEmoji,
              d.device_label AS deviceLabel, d.created_at AS createdAt,
              d.last_seen_at AS lastSeenAt, d.revoked_at AS revokedAt
       FROM child_devices AS d
       INNER JOIN child_profiles AS p
         ON p.household_id = d.household_id AND p.id = d.child_profile_id
       WHERE d.household_id = ?
       ORDER BY d.revoked_at IS NOT NULL ASC, d.created_at DESC, d.id ASC`,
    )
    .bind(scopedHousehold(context))
    .all<ParentDevice>();
  return result.results ?? [];
}

export async function renameDeviceForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  deviceId: string,
  label: unknown,
): Promise<void> {
  const deviceLabel = validateNickname(label);
  const householdId = scopedHousehold(context);
  await runDeviceUpdate(db, db
    .prepare(
      `UPDATE child_devices SET device_label = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(deviceLabel, deviceId, householdId), deviceId, householdId);
}

export async function revokeDeviceForParent(
  db: D1DatabaseLike,
  context: ParentContext,
  deviceId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const householdId = scopedHousehold(context);
  await runDeviceUpdate(db, db
    .prepare(
      `UPDATE child_devices SET revoked_at = COALESCE(revoked_at, ?)
       WHERE id = ? AND household_id = ?`,
    )
    .bind(toUtcTimestamp(options.now ?? new Date()), deviceId, householdId), deviceId, householdId);
}

export function assertDeviceLabel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ValidationError("deviceLabel", "device label is invalid");
  return validateNickname(value);
}
