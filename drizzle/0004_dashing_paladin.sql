ALTER TABLE `pending_file_deletions` ADD `state` text DEFAULT 'delete_ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_file_deletions` ADD `lease_until` text;--> statement-breakpoint
CREATE INDEX `pending_file_deletions_owner_state_lease_idx` ON `pending_file_deletions` (`owner_id`,`state`,`lease_until`);