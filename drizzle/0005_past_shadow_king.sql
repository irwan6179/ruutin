CREATE TABLE `experience_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_key` text NOT NULL,
	`event_name` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`local_date` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "experience_events_actor_kind_check" CHECK("experience_events"."actor_kind" IN ('parent', 'companion')),
	CONSTRAINT "experience_events_name_check" CHECK("experience_events"."event_name" IN ('parent_today_opened', 'companion_today_opened', 'onboarding_completed', 'reward_goal_selected', 'install_guidance_opened')),
	CONSTRAINT "experience_events_subject_check" CHECK(("experience_events"."subject_type" IS NULL AND "experience_events"."subject_id" IS NULL) OR ("experience_events"."subject_type" = 'reward' AND length(trim("experience_events"."subject_id")) > 0)),
	CONSTRAINT "experience_events_shape_check" CHECK((
		("experience_events"."event_name" = 'reward_goal_selected' AND "experience_events"."subject_type" = 'reward' AND "experience_events"."subject_id" IS NOT NULL)
		OR ("experience_events"."event_name" <> 'reward_goal_selected' AND "experience_events"."subject_type" IS NULL AND "experience_events"."subject_id" IS NULL)
	) AND (
		("experience_events"."actor_kind" = 'parent' AND "experience_events"."event_name" IN ('parent_today_opened', 'onboarding_completed', 'reward_goal_selected'))
		OR ("experience_events"."actor_kind" = 'companion' AND "experience_events"."event_name" IN ('companion_today_opened', 'install_guidance_opened'))
	)),
	CONSTRAINT "experience_events_local_date_check" CHECK("experience_events"."local_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("experience_events"."local_date") IS NOT NULL AND date("experience_events"."local_date") = "experience_events"."local_date"),
	CONSTRAINT "experience_events_dedupe_non_empty" CHECK(length(trim("experience_events"."dedupe_key")) > 0 AND "experience_events"."dedupe_key" = "experience_events"."event_name" || ':' || "experience_events"."actor_kind" || ':' || "experience_events"."actor_key" || ':' || "experience_events"."local_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experience_events_household_dedupe_unique` ON `experience_events` (`household_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `experience_events_household_event_date_idx` ON `experience_events` (`household_id`,`event_name`,`local_date`);--> statement-breakpoint
CREATE INDEX `experience_events_actor_date_idx` ON `experience_events` (`household_id`,`actor_kind`,`actor_key`,`local_date`);
--> statement-breakpoint
CREATE TRIGGER `experience_events_parent_actor_scope_insert`
BEFORE INSERT ON `experience_events`
WHEN NEW.`actor_kind` = 'parent'
  AND NOT EXISTS (
    SELECT 1 FROM `household_users`
    WHERE `household_users`.`household_id` = NEW.`household_id`
      AND `household_users`.`user_id` = NEW.`actor_key`
      AND `household_users`.`role` IN ('parent', 'caregiver')
  )
BEGIN
  SELECT RAISE(ABORT, 'experience event parent actor is outside household');
END;
--> statement-breakpoint
CREATE TRIGGER `experience_events_companion_actor_scope_insert`
BEFORE INSERT ON `experience_events`
WHEN NEW.`actor_kind` = 'companion'
  AND NOT EXISTS (
    SELECT 1
    FROM `child_devices` AS d
    INNER JOIN `child_profiles` AS p
      ON p.`household_id` = d.`household_id`
     AND p.`id` = d.`child_profile_id`
    WHERE d.`id` = NEW.`actor_key`
      AND d.`household_id` = NEW.`household_id`
      AND d.`revoked_at` IS NULL
      AND (d.`expires_at` IS NULL OR d.`expires_at` > NEW.`created_at`)
      AND p.`archived_at` IS NULL
      AND p.`companion_access_eligible` = 1
      AND (p.`age_band` IS NULL OR p.`age_band` <> 'under_13')
  )
BEGIN
  SELECT RAISE(ABORT, 'experience event companion actor is outside household');
END;
--> statement-breakpoint
CREATE TRIGGER `experience_events_reward_scope_insert`
BEFORE INSERT ON `experience_events`
WHEN NEW.`subject_type` = 'reward'
  AND NOT EXISTS (
    SELECT 1 FROM `rewards`
    WHERE `rewards`.`id` = NEW.`subject_id`
      AND `rewards`.`household_id` = NEW.`household_id`
      AND `rewards`.`archived_at` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'experience event reward is outside household');
END;
--> statement-breakpoint
CREATE TRIGGER `experience_events_no_update`
BEFORE UPDATE ON `experience_events`
BEGIN
  SELECT RAISE(ABORT, 'experience events are append-only');
END;
