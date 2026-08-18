import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Small, non-user-facing table created by the Sites D1 base migration.
 *
 * Product tables are introduced in later migrations. Keeping this metadata
 * table separate gives BR-003 a stable, harmless migration/read check without
 * prematurely choosing application schema or storing user data.
 */
export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    createdAt: text("created_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [
    uniqueIndex("users_email_normalized_unique").on(table.emailNormalized),
    check("users_email_non_empty", sql`length(trim(${table.email})) > 0`),
    check(
      "users_email_normalized_non_empty",
      sql`length(trim(${table.emailNormalized})) > 0`,
    ),
  ],
);

export const households = sqliteTable(
  "households",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("households_name_non_empty", sql`length(trim(${table.name})) > 0`),
    check("households_timezone_non_empty", sql`length(trim(${table.timezone})) > 0`),
  ],
);

export const householdUsers = sqliteTable(
  "household_users",
  {
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("household_users_membership_unique").on(
      table.householdId,
      table.userId,
    ),
    index("household_users_user_idx").on(table.userId),
    foreignKey({
      columns: [table.householdId],
      foreignColumns: [households.id],
      name: "household_users_household_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "household_users_user_fk",
    }).onDelete("cascade"),
    check(
      "household_users_role_check",
      sql`${table.role} IN ('parent', 'caregiver')`,
    ),
  ],
);

export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: text("expires_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    consumedAt: text("consumed_at"),
    lockedAt: text("locked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("auth_challenges_active_lookup_idx").on(
      table.emailNormalized,
      table.purpose,
      table.expiresAt,
      table.consumedAt,
      table.lockedAt,
    ),
    index("auth_challenges_expiry_idx").on(table.expiresAt),
    check("auth_challenges_code_hash_non_empty", sql`length(${table.codeHash}) > 0`),
    check(
      "auth_challenges_purpose_check",
      sql`${table.purpose} IN ('sign_in', 'delete_household')`,
    ),
    check(
      "auth_challenges_attempt_count_check",
      sql`${table.attemptCount} BETWEEN 0 AND 5`,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sessions_user_fk",
    }).onDelete("cascade"),
    check("sessions_token_hash_non_empty", sql`length(${table.tokenHash}) > 0`),
  ],
);

export const childProfiles = sqliteTable(
  "child_profiles",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    nickname: text("nickname").notNull(),
    emoji: text("emoji").notNull(),
    ageBand: text("age_band"),
    companionAccessEligible: integer("companion_access_eligible")
      .notNull()
      .default(0),
    activeRewardId: text("active_reward_id"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("child_profiles_household_id_unique").on(
      table.householdId,
      table.id,
    ),
    index("child_profiles_household_idx").on(table.householdId, table.archivedAt),
    foreignKey({
      columns: [table.householdId],
      foreignColumns: [households.id],
      name: "child_profiles_household_fk",
    }).onDelete("cascade"),
    check("child_profiles_nickname_non_empty", sql`length(trim(${table.nickname})) > 0`),
    check(
      "child_profiles_age_band_check",
      sql`${table.ageBand} IS NULL OR ${table.ageBand} IN ('under_13', '13_15', '16_17', '18_plus', 'not_provided')`,
    ),
    check(
      "child_profiles_eligibility_check",
      sql`${table.companionAccessEligible} IN (0, 1)`,
    ),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    title: text("title").notNull(),
    emoji: text("emoji").notNull(),
    stars: integer("stars").notNull(),
    scheduleType: text("schedule_type").notNull(),
    scheduleData: text("schedule_data").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("tasks_household_id_unique").on(table.householdId, table.id),
    uniqueIndex("tasks_active_position_unique")
      .on(table.householdId, table.childProfileId, table.position)
      .where(sql`${table.archivedAt} IS NULL`),
    index("tasks_profile_idx").on(
      table.householdId,
      table.childProfileId,
      table.archivedAt,
      table.position,
    ),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "tasks_profile_scope_fk",
    }).onDelete("cascade"),
    check("tasks_title_non_empty", sql`length(trim(${table.title})) > 0`),
    check("tasks_stars_check", sql`${table.stars} BETWEEN 1 AND 3`),
    check(
      "tasks_schedule_type_check",
      sql`${table.scheduleType} IN ('daily', 'weekdays', 'one_off')`,
    ),
    check("tasks_schedule_json_check", sql`json_valid(${table.scheduleData})`),
    check("tasks_position_check", sql`${table.position} >= 0`),
  ],
);

export const pairingCodes = sqliteTable(
  "pairing_codes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    codeHash: text("code_hash").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    consumedAt: text("consumed_at"),
    cancelledAt: text("cancelled_at"),
    lockedAt: text("locked_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("pairing_codes_code_hash_unique").on(table.codeHash),
    uniqueIndex("pairing_codes_token_hash_unique").on(table.tokenHash),
    index("pairing_codes_active_lookup_idx").on(
      table.codeHash,
      table.expiresAt,
      table.consumedAt,
      table.cancelledAt,
      table.lockedAt,
    ),
    index("pairing_codes_profile_idx").on(table.householdId, table.childProfileId),
    index("pairing_codes_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "pairing_codes_profile_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "pairing_codes_created_by_user_fk",
    }).onDelete("restrict"),
    check("pairing_codes_code_hash_non_empty", sql`length(${table.codeHash}) > 0`),
    check("pairing_codes_token_hash_non_empty", sql`length(${table.tokenHash}) > 0`),
    check("pairing_codes_attempt_count_check", sql`${table.attemptCount} BETWEEN 0 AND 5`),
  ],
);

export const childDevices = sqliteTable(
  "child_devices",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    deviceLabel: text("device_label").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("child_devices_token_hash_unique").on(table.tokenHash),
    uniqueIndex("child_devices_household_id_unique").on(table.householdId, table.id),
    index("child_devices_profile_idx").on(table.householdId, table.childProfileId),
    index("child_devices_active_idx").on(
      table.tokenHash,
      table.expiresAt,
      table.revokedAt,
    ),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "child_devices_profile_scope_fk",
    }).onDelete("cascade"),
    check("child_devices_label_non_empty", sql`length(trim(${table.deviceLabel})) > 0`),
    check("child_devices_token_hash_non_empty", sql`length(${table.tokenHash}) > 0`),
  ],
);

export const taskClaims = sqliteTable(
  "task_claims",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    taskId: text("task_id").notNull(),
    dueDate: text("due_date").notNull(),
    submittedByType: text("submitted_by_type").notNull(),
    submittedByDeviceId: text("submitted_by_device_id"),
    status: text("status").notNull().default("pending"),
    submittedAt: text("submitted_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (table) => [
    uniqueIndex("task_claims_active_occurrence_unique")
      .on(
        table.householdId,
        table.childProfileId,
        table.taskId,
        table.dueDate,
      )
      .where(sql`${table.status} IN ('pending', 'approved')`),
    index("task_claims_profile_due_idx").on(
      table.householdId,
      table.childProfileId,
      table.dueDate,
    ),
    index("task_claims_pending_parent_idx").on(
      table.householdId,
      table.status,
      table.submittedAt,
    ),
    index("task_claims_task_idx").on(table.householdId, table.taskId, table.dueDate),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "task_claims_profile_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.householdId, table.taskId],
      foreignColumns: [tasks.householdId, tasks.id],
      name: "task_claims_task_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.submittedByDeviceId],
      foreignColumns: [childDevices.id],
      name: "task_claims_device_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.resolvedByUserId],
      foreignColumns: [users.id],
      name: "task_claims_resolved_by_user_fk",
    }).onDelete("set null"),
    check(
      "task_claims_submitter_check",
      sql`(${table.submittedByType} = 'companion' AND ${table.submittedByDeviceId} IS NOT NULL) OR (${table.submittedByType} = 'parent' AND ${table.submittedByDeviceId} IS NULL)`,
    ),
    check(
      "task_claims_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      "task_claims_state_fields_check",
      sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL) OR (${table.status} IN ('approved', 'rejected') AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    check(
      "task_claims_due_date_check",
      sql`${table.dueDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const pointLedger = sqliteTable(
  "point_ledger",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    eventType: text("event_type").notNull(),
    starsDelta: integer("stars_delta").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    reason: text("reason"),
    actorUserId: text("actor_user_id"),
    localDate: text("local_date").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("point_ledger_source_unique").on(table.sourceType, table.sourceId),
    index("point_ledger_profile_date_idx").on(
      table.householdId,
      table.childProfileId,
      table.localDate,
    ),
    index("point_ledger_profile_created_idx").on(
      table.householdId,
      table.childProfileId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "point_ledger_profile_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "point_ledger_actor_fk",
    }).onDelete("set null"),
    check(
      "point_ledger_event_type_check",
      sql`${table.eventType} IN ('task_approved', 'parent_completed_task', 'task_reversed', 'reward_redeemed', 'manual_adjustment')`,
    ),
    check("point_ledger_delta_non_zero", sql`${table.starsDelta} <> 0`),
    check("point_ledger_source_non_empty", sql`length(trim(${table.sourceId})) > 0`),
    check(
      "point_ledger_local_date_check",
      sql`${table.localDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const rewards = sqliteTable(
  "rewards",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    title: text("title").notNull(),
    emoji: text("emoji").notNull(),
    starCost: integer("star_cost").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("rewards_household_id_unique").on(table.householdId, table.id),
    index("rewards_active_profile_idx").on(
      table.householdId,
      table.childProfileId,
      table.archivedAt,
    ),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "rewards_profile_scope_fk",
    }).onDelete("cascade"),
    check("rewards_title_non_empty", sql`length(trim(${table.title})) > 0`),
    check("rewards_star_cost_positive", sql`${table.starCost} > 0`),
  ],
);

export const rewardRequests = sqliteTable(
  "reward_requests",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    childProfileId: text("child_profile_id").notNull(),
    rewardId: text("reward_id").notNull(),
    status: text("status").notNull().default("pending"),
    requestedByDeviceId: text("requested_by_device_id").notNull(),
    requestedAt: text("requested_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (table) => [
    uniqueIndex("reward_requests_pending_unique")
      .on(table.householdId, table.childProfileId, table.rewardId)
      .where(sql`${table.status} = 'pending'`),
    index("reward_requests_pending_parent_idx").on(
      table.householdId,
      table.status,
      table.requestedAt,
    ),
    index("reward_requests_profile_idx").on(
      table.householdId,
      table.childProfileId,
      table.requestedAt,
    ),
    foreignKey({
      columns: [table.householdId, table.childProfileId],
      foreignColumns: [childProfiles.householdId, childProfiles.id],
      name: "reward_requests_profile_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.householdId, table.rewardId],
      foreignColumns: [rewards.householdId, rewards.id],
      name: "reward_requests_reward_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.householdId, table.requestedByDeviceId],
      foreignColumns: [childDevices.householdId, childDevices.id],
      name: "reward_requests_device_scope_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.resolvedByUserId],
      foreignColumns: [users.id],
      name: "reward_requests_resolved_by_user_fk",
    }).onDelete("set null"),
    check(
      "reward_requests_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      "reward_requests_state_fields_check",
      sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL) OR (${table.status} IN ('approved', 'rejected') AND ${table.resolvedAt} IS NOT NULL)`,
    ),
  ],
);

/** Durable, coarse-grained counters used by generic request rate limiting. */
export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    windowStartedAt: text("window_started_at").notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("rate_limit_buckets_expiry_idx").on(table.expiresAt),
    check("rate_limit_buckets_count_check", sql`${table.count} >= 0`),
  ],
);
