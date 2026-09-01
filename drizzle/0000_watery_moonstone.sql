CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`build_type` text NOT NULL,
	`concept` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`locks_revision` integer DEFAULT 1 NOT NULL,
	`forge_document_id` text NOT NULL,
	`forge_revision_id` text NOT NULL,
	`forge_manifest_hash` text NOT NULL,
	`player_boundary` text DEFAULT 'undefined' NOT NULL,
	`content_boundary` text DEFAULT 'general' NOT NULL,
	`authority_map_json` text DEFAULT '[]' NOT NULL,
	`locks_json` text DEFAULT '[]' NOT NULL,
	`answers_json` text DEFAULT '[]' NOT NULL,
	`result_json` text,
	`qa_json` text,
	`research_enabled` integer DEFAULT false NOT NULL,
	`research_cost_approved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated_idx` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `projects_owner_status_idx` ON `projects` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`run_kind` text DEFAULT 'pre_quampute' NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`research_enabled` integer DEFAULT false NOT NULL,
	`project_revision` integer NOT NULL,
	`locks_revision` integer NOT NULL,
	`forge_revision_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`context_receipt_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_owner_idempotency_uq` ON `runs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `runs_project_owner_created_idx` ON `runs` (`project_id`,`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`role` text DEFAULT 'canon' NOT NULL,
	`authority` text DEFAULT 'creator_source' NOT NULL,
	`visibility` text DEFAULT 'creator_only' NOT NULL,
	`uri` text,
	`r2_key` text,
	`text_content` text,
	`content_hash` text NOT NULL,
	`read_status` text DEFAULT 'verified_full' NOT NULL,
	`coverage_state` text DEFAULT 'ready' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_project_owner_idx` ON `sources` (`project_id`,`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_owner_project_hash_uq` ON `sources` (`owner_id`,`project_id`,`content_hash`);