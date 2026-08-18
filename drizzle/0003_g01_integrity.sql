-- G01 integrity rules that cannot be expressed as SQLite column constraints.
-- These triggers are deliberately kept in a reviewable migration instead of
-- relying on route code alone.  D1 has foreign keys enabled for application
-- requests; the triggers provide the cross-row ownership and state guards.

CREATE TRIGGER `task_claims_profile_task_scope_insert`
BEFORE INSERT ON `task_claims`
WHEN NOT EXISTS (
  SELECT 1 FROM `tasks`
  WHERE `tasks`.`id` = NEW.`task_id`
    AND `tasks`.`household_id` = NEW.`household_id`
    AND `tasks`.`child_profile_id` = NEW.`child_profile_id`
)
BEGIN
  SELECT RAISE(ABORT, 'task claim task/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_profile_task_scope_update`
BEFORE UPDATE OF `household_id`, `child_profile_id`, `task_id` ON `task_claims`
WHEN NOT EXISTS (
  SELECT 1 FROM `tasks`
  WHERE `tasks`.`id` = NEW.`task_id`
    AND `tasks`.`household_id` = NEW.`household_id`
    AND `tasks`.`child_profile_id` = NEW.`child_profile_id`
)
BEGIN
  SELECT RAISE(ABORT, 'task claim task/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_pending_state_transition`
BEFORE UPDATE OF `status` ON `task_claims`
WHEN OLD.`status` <> 'pending' AND NEW.`status` <> OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'task claim is already resolved');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_pending_only_resolution`
BEFORE UPDATE OF `status` ON `task_claims`
WHEN OLD.`status` = 'pending' AND NEW.`status` NOT IN ('approved', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'task claim has an invalid state transition');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_device_scope_insert`
BEFORE INSERT ON `task_claims`
WHEN NEW.`submitted_by_device_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `child_devices`
    WHERE `child_devices`.`id` = NEW.`submitted_by_device_id`
      AND `child_devices`.`household_id` = NEW.`household_id`
      AND `child_devices`.`child_profile_id` = NEW.`child_profile_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'task claim device/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_device_scope_update`
BEFORE UPDATE OF `household_id`, `child_profile_id`, `submitted_by_device_id` ON `task_claims`
WHEN NEW.`submitted_by_device_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `child_devices`
    WHERE `child_devices`.`id` = NEW.`submitted_by_device_id`
      AND `child_devices`.`household_id` = NEW.`household_id`
      AND `child_devices`.`child_profile_id` = NEW.`child_profile_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'task claim device/profile scope mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_resolved_user_scope_insert`
BEFORE INSERT ON `task_claims`
WHEN NEW.`resolved_by_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`resolved_by_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'task claim resolver is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `task_claims_resolved_user_scope_update`
BEFORE UPDATE OF `household_id`, `resolved_by_user_id` ON `task_claims`
WHEN NEW.`resolved_by_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`resolved_by_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'task claim resolver is outside household');
END;
--> statement-breakpoint

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
--> statement-breakpoint

CREATE TRIGGER `pairing_codes_creator_scope_insert`
BEFORE INSERT ON `pairing_codes`
WHEN NOT EXISTS (
  SELECT 1 FROM `household_users`
  WHERE `household_users`.`household_id` = NEW.`household_id`
    AND `household_users`.`user_id` = NEW.`created_by_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'pairing code creator is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `child_profiles_active_reward_scope_insert`
BEFORE INSERT ON `child_profiles`
WHEN NEW.`active_reward_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `rewards`
    WHERE `rewards`.`id` = NEW.`active_reward_id`
      AND `rewards`.`household_id` = NEW.`household_id`
      AND `rewards`.`child_profile_id` = NEW.`id`
      AND `rewards`.`archived_at` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'active reward is outside profile');
END;
--> statement-breakpoint

CREATE TRIGGER `child_profiles_active_reward_scope_update`
BEFORE UPDATE OF `active_reward_id`, `household_id` ON `child_profiles`
WHEN NEW.`active_reward_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `rewards`
    WHERE `rewards`.`id` = NEW.`active_reward_id`
      AND `rewards`.`household_id` = NEW.`household_id`
      AND `rewards`.`child_profile_id` = NEW.`id`
      AND `rewards`.`archived_at` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'active reward is outside profile');
END;
--> statement-breakpoint

CREATE TRIGGER `rewards_active_limit_insert`
BEFORE INSERT ON `rewards`
WHEN NEW.`archived_at` IS NULL
  AND (
    SELECT count(*) FROM `rewards`
    WHERE `rewards`.`household_id` = NEW.`household_id`
      AND `rewards`.`child_profile_id` = NEW.`child_profile_id`
      AND `rewards`.`archived_at` IS NULL
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'a profile may have at most five active rewards');
END;
--> statement-breakpoint

CREATE TRIGGER `rewards_active_limit_unarchive`
BEFORE UPDATE OF `archived_at` ON `rewards`
WHEN OLD.`archived_at` IS NOT NULL
  AND NEW.`archived_at` IS NULL
  AND (
    SELECT count(*) FROM `rewards` AS `other_rewards`
    WHERE `other_rewards`.`household_id` = NEW.`household_id`
      AND `other_rewards`.`child_profile_id` = NEW.`child_profile_id`
      AND `other_rewards`.`archived_at` IS NULL
      AND `other_rewards`.`id` <> NEW.`id`
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'a profile may have at most five active rewards');
END;
--> statement-breakpoint

CREATE TRIGGER `point_ledger_actor_scope_insert`
BEFORE INSERT ON `point_ledger`
WHEN NEW.`actor_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`actor_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'ledger actor is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `point_ledger_actor_scope_update`
BEFORE UPDATE OF `household_id`, `actor_user_id` ON `point_ledger`
WHEN NEW.`actor_user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`actor_user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'ledger actor is outside household');
END;
--> statement-breakpoint

CREATE TRIGGER `rewards_active_reward_archive_guard`
BEFORE UPDATE OF `archived_at` ON `rewards`
WHEN NEW.`archived_at` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `child_profiles`
    WHERE `child_profiles`.`household_id` = NEW.`household_id`
      AND `child_profiles`.`id` = NEW.`child_profile_id`
      AND `child_profiles`.`active_reward_id` = NEW.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'active reward must be cleared before archive');
END;
--> statement-breakpoint

CREATE TRIGGER `rewards_active_reward_delete_guard`
BEFORE DELETE ON `rewards`
WHEN EXISTS (
    SELECT 1 FROM `child_profiles`
    WHERE `child_profiles`.`household_id` = OLD.`household_id`
      AND `child_profiles`.`id` = OLD.`child_profile_id`
      AND `child_profiles`.`active_reward_id` = OLD.`id`
  )
  AND EXISTS (
    SELECT 1 FROM `households`
    WHERE `households`.`id` = OLD.`household_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'active reward must be cleared before delete');
END;
--> statement-breakpoint

CREATE TRIGGER `child_devices_profile_immutable`
BEFORE UPDATE OF `household_id`, `child_profile_id` ON `child_devices`
WHEN OLD.`household_id` <> NEW.`household_id`
  OR OLD.`child_profile_id` <> NEW.`child_profile_id`
BEGIN
  SELECT RAISE(ABORT, 'device profile assignment is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER `point_ledger_no_update`
BEFORE UPDATE ON `point_ledger`
BEGIN
  SELECT RAISE(ABORT, 'point ledger is append-only');
END;
--> statement-breakpoint

CREATE TRIGGER `point_ledger_no_delete`
BEFORE DELETE ON `point_ledger`
WHEN EXISTS (
  SELECT 1 FROM `households`
  WHERE `households`.`id` = OLD.`household_id`
)
BEGIN
  SELECT RAISE(ABORT, 'point ledger is append-only');
END;
