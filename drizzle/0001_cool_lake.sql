CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`code_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`consumed_at` text,
	`locked_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "auth_challenges_code_hash_non_empty" CHECK(length("auth_challenges"."code_hash") > 0),
	CONSTRAINT "auth_challenges_purpose_check" CHECK("auth_challenges"."purpose" IN ('sign_in', 'delete_household')),
	CONSTRAINT "auth_challenges_attempt_count_check" CHECK("auth_challenges"."attempt_count" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_active_lookup_idx` ON `auth_challenges` (`email_normalized`,`purpose`,`expires_at`,`consumed_at`,`locked_at`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `child_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`device_label` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "child_devices_label_non_empty" CHECK(length(trim("child_devices"."device_label")) > 0),
	CONSTRAINT "child_devices_token_hash_non_empty" CHECK(length("child_devices"."token_hash") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_devices_token_hash_unique` ON `child_devices` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `child_devices_household_id_unique` ON `child_devices` (`household_id`,`id`);--> statement-breakpoint
CREATE INDEX `child_devices_profile_idx` ON `child_devices` (`household_id`,`child_profile_id`);--> statement-breakpoint
CREATE INDEX `child_devices_active_idx` ON `child_devices` (`token_hash`,`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `child_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`nickname` text NOT NULL,
	`emoji` text NOT NULL,
	`age_band` text,
	`companion_access_eligible` integer DEFAULT 0 NOT NULL,
	`active_reward_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "child_profiles_nickname_non_empty" CHECK(length(trim("child_profiles"."nickname")) > 0),
	CONSTRAINT "child_profiles_age_band_check" CHECK("child_profiles"."age_band" IS NULL OR "child_profiles"."age_band" IN ('under_13', '13_15', '16_17', '18_plus', 'not_provided')),
	CONSTRAINT "child_profiles_eligibility_check" CHECK("child_profiles"."companion_access_eligible" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_profiles_household_id_unique` ON `child_profiles` (`household_id`,`id`);--> statement-breakpoint
CREATE INDEX `child_profiles_household_idx` ON `child_profiles` (`household_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `household_users` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_users_role_check" CHECK("household_users"."role" IN ('parent', 'caregiver'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_users_membership_unique` ON `household_users` (`household_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `household_users_user_idx` ON `household_users` (`user_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "households_name_non_empty" CHECK(length(trim("households"."name")) > 0),
	CONSTRAINT "households_timezone_non_empty" CHECK(length(trim("households"."timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`consumed_at` text,
	`cancelled_at` text,
	`locked_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pairing_codes_code_hash_non_empty" CHECK(length("pairing_codes"."code_hash") > 0),
	CONSTRAINT "pairing_codes_token_hash_non_empty" CHECK(length("pairing_codes"."token_hash") > 0),
	CONSTRAINT "pairing_codes_attempt_count_check" CHECK("pairing_codes"."attempt_count" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_codes_code_hash_unique` ON `pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_codes_token_hash_unique` ON `pairing_codes` (`token_hash`);--> statement-breakpoint
CREATE INDEX `pairing_codes_active_lookup_idx` ON `pairing_codes` (`code_hash`,`expires_at`,`consumed_at`,`cancelled_at`,`locked_at`);--> statement-breakpoint
CREATE INDEX `pairing_codes_profile_idx` ON `pairing_codes` (`household_id`,`child_profile_id`);--> statement-breakpoint
CREATE INDEX `pairing_codes_expiry_idx` ON `pairing_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `point_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`event_type` text NOT NULL,
	`stars_delta` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`reason` text,
	`actor_user_id` text,
	`local_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "point_ledger_event_type_check" CHECK("point_ledger"."event_type" IN ('task_approved', 'parent_completed_task', 'task_reversed', 'reward_redeemed', 'manual_adjustment')),
	CONSTRAINT "point_ledger_delta_non_zero" CHECK("point_ledger"."stars_delta" <> 0),
	CONSTRAINT "point_ledger_source_non_empty" CHECK(length(trim("point_ledger"."source_id")) > 0),
	CONSTRAINT "point_ledger_local_date_check" CHECK("point_ledger"."local_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_ledger_source_unique` ON `point_ledger` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `point_ledger_profile_date_idx` ON `point_ledger` (`household_id`,`child_profile_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `point_ledger_profile_created_idx` ON `point_ledger` (`household_id`,`child_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "rate_limit_buckets_count_check" CHECK("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_expiry_idx` ON `rate_limit_buckets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reward_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by_device_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`reward_id`) REFERENCES `rewards`(`household_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`household_id`,`requested_by_device_id`) REFERENCES `child_devices`(`household_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reward_requests_status_check" CHECK("reward_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "reward_requests_state_fields_check" CHECK(("reward_requests"."status" = 'pending' AND "reward_requests"."resolved_at" IS NULL AND "reward_requests"."resolved_by_user_id" IS NULL) OR ("reward_requests"."status" IN ('approved', 'rejected') AND "reward_requests"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_requests_pending_unique` ON `reward_requests` (`household_id`,`child_profile_id`,`reward_id`) WHERE "reward_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `reward_requests_pending_parent_idx` ON `reward_requests` (`household_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `reward_requests_profile_idx` ON `reward_requests` (`household_id`,`child_profile_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`title` text NOT NULL,
	`emoji` text NOT NULL,
	`star_cost` integer NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rewards_title_non_empty" CHECK(length(trim("rewards"."title")) > 0),
	CONSTRAINT "rewards_star_cost_positive" CHECK("rewards"."star_cost" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rewards_household_id_unique` ON `rewards` (`household_id`,`id`);--> statement-breakpoint
CREATE INDEX `rewards_active_profile_idx` ON `rewards` (`household_id`,`child_profile_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_token_hash_non_empty" CHECK(length("sessions"."token_hash") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `task_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`task_id` text NOT NULL,
	`due_date` text NOT NULL,
	`submitted_by_type` text NOT NULL,
	`submitted_by_device_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`task_id`) REFERENCES `tasks`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by_device_id`) REFERENCES `child_devices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_claims_submitter_check" CHECK(("task_claims"."submitted_by_type" = 'companion' AND "task_claims"."submitted_by_device_id" IS NOT NULL) OR ("task_claims"."submitted_by_type" = 'parent' AND "task_claims"."submitted_by_device_id" IS NULL)),
	CONSTRAINT "task_claims_status_check" CHECK("task_claims"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "task_claims_state_fields_check" CHECK(("task_claims"."status" = 'pending' AND "task_claims"."resolved_at" IS NULL AND "task_claims"."resolved_by_user_id" IS NULL) OR ("task_claims"."status" IN ('approved', 'rejected') AND "task_claims"."resolved_at" IS NOT NULL)),
	CONSTRAINT "task_claims_due_date_check" CHECK("task_claims"."due_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `task_claims_profile_due_idx` ON `task_claims` (`household_id`,`child_profile_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `task_claims_pending_parent_idx` ON `task_claims` (`household_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `task_claims_task_idx` ON `task_claims` (`household_id`,`task_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_profile_id` text NOT NULL,
	`title` text NOT NULL,
	`emoji` text NOT NULL,
	`stars` integer NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_data` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`,`child_profile_id`) REFERENCES `child_profiles`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_title_non_empty" CHECK(length(trim("tasks"."title")) > 0),
	CONSTRAINT "tasks_stars_check" CHECK("tasks"."stars" BETWEEN 1 AND 3),
	CONSTRAINT "tasks_schedule_type_check" CHECK("tasks"."schedule_type" IN ('daily', 'weekdays', 'one_off')),
	CONSTRAINT "tasks_schedule_json_check" CHECK(json_valid("tasks"."schedule_data")),
	CONSTRAINT "tasks_position_check" CHECK("tasks"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_household_id_unique` ON `tasks` (`household_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_active_position_unique` ON `tasks` (`household_id`,`child_profile_id`,`position`) WHERE "tasks"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `tasks_profile_idx` ON `tasks` (`household_id`,`child_profile_id`,`archived_at`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text,
	CONSTRAINT "users_email_non_empty" CHECK(length(trim("users"."email")) > 0),
	CONSTRAINT "users_email_normalized_non_empty" CHECK(length(trim("users"."email_normalized")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalized_unique` ON `users` (`email_normalized`);
