CREATE TABLE `pending_file_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_file_deletions_key_uq` ON `pending_file_deletions` (`r2_key`);--> statement-breakpoint
CREATE INDEX `pending_file_deletions_owner_created_idx` ON `pending_file_deletions` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `processing_consent_version` integer DEFAULT 0 NOT NULL;