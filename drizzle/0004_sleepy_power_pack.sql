PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reward_requests` (
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
	FOREIGN KEY (`household_id`,`reward_id`) REFERENCES `rewards`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`requested_by_device_id`) REFERENCES `child_devices`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reward_requests_status_check" CHECK("__new_reward_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "reward_requests_state_fields_check" CHECK(("__new_reward_requests"."status" = 'pending' AND "__new_reward_requests"."resolved_at" IS NULL AND "__new_reward_requests"."resolved_by_user_id" IS NULL) OR ("__new_reward_requests"."status" IN ('approved', 'rejected') AND "__new_reward_requests"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_reward_requests`("id", "household_id", "child_profile_id", "reward_id", "status", "requested_by_device_id", "requested_at", "resolved_at", "resolved_by_user_id") SELECT "id", "household_id", "child_profile_id", "reward_id", "status", "requested_by_device_id", "requested_at", "resolved_at", "resolved_by_user_id" FROM `reward_requests`;--> statement-breakpoint
DROP TABLE `reward_requests`;--> statement-breakpoint
ALTER TABLE `__new_reward_requests` RENAME TO `reward_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `reward_requests_pending_unique` ON `reward_requests` (`household_id`,`child_profile_id`,`reward_id`) WHERE "reward_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `reward_requests_pending_parent_idx` ON `reward_requests` (`household_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `reward_requests_profile_idx` ON `reward_requests` (`household_id`,`child_profile_id`,`requested_at`);
--> statement-breakpoint
-- Recreate the G01 cross-row guards after Drizzle's table rebuild drops the
-- triggers attached to the previous reward_requests table.
CREATE TRIGGER `reward_requests_profile_reward_scope_insert`
BEFORE INSERT ON `reward_requests`
WHEN NOT EXISTS (
  SELECT 1 FROM `rewards`
  WHERE `rewards`.`id` = NEW.`reward_id`
    AND `rewards`.`household_id` = NEW.`household_id`
    AND `rewards`.`child_profile_id` = NEW.`child_profile_id`
)
BEGIN
  SELECT RAISE(ABORT, 'reward request reward/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_profile_reward_scope_update`
BEFORE UPDATE OF `household_id`, `child_profile_id`, `reward_id` ON `reward_requests`
WHEN NOT EXISTS (
  SELECT 1 FROM `rewards`
  WHERE `rewards`.`id` = NEW.`reward_id`
    AND `rewards`.`household_id` = NEW.`household_id`
    AND `rewards`.`child_profile_id` = NEW.`child_profile_id`
)
BEGIN
  SELECT RAISE(ABORT, 'reward request reward/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_device_profile_scope_insert`
BEFORE INSERT ON `reward_requests`
WHEN NOT EXISTS (
  SELECT 1 FROM `child_devices`
  WHERE `child_devices`.`id` = NEW.`requested_by_device_id`
    AND `child_devices`.`household_id` = NEW.`household_id`
    AND `child_devices`.`child_profile_id` = NEW.`child_profile_id`
)
BEGIN
  SELECT RAISE(ABORT, 'reward request device/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_state_transition`
BEFORE UPDATE OF `status` ON `reward_requests`
WHEN OLD.`status` <> 'pending' AND NEW.`status` <> OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'reward request is already resolved');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_resolved_user_scope_insert`
BEFORE INSERT ON `reward_requests`
WHEN NEW.`resolved_by_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`resolved_by_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'reward resolver is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_resolved_user_scope_update`
BEFORE UPDATE OF `household_id`, `resolved_by_user_id` ON `reward_requests`
WHEN NEW.`resolved_by_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`resolved_by_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'reward resolver is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `reward_requests_pending_only_resolution`
BEFORE UPDATE OF `status` ON `reward_requests`
WHEN OLD.`status` = 'pending' AND NEW.`status` NOT IN ('approved', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'reward request has an invalid state transition');
END;
