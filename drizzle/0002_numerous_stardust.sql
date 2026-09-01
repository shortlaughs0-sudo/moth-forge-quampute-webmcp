ALTER TABLE `runs` ADD `upstream_response_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `upstream_request_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `upstream_client_request_id` text;--> statement-breakpoint
UPDATE `runs` SET `status` = 'failed', `error_code` = 'UPSTREAM_FAILED',
  `error_message` = 'Legacy synchronous run could not be recovered after the durable-background upgrade.',
  `completed_at` = CURRENT_TIMESTAMP
  WHERE `status` = 'running' AND `upstream_response_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_active_snapshot_uq` ON `runs` (`owner_id`,`project_id`,`input_hash`) WHERE "runs"."status" IN ('running', 'unknown');
