DROP INDEX `runs_owner_idempotency_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_owner_project_idempotency_uq` ON `runs` (`owner_id`,`project_id`,`idempotency_key`);
--> statement-breakpoint
UPDATE `sources` SET `authority` = CASE
  WHEN `role` = 'canon' THEN 'creator_source'
  WHEN `role` = 'reference' THEN 'approved_reference'
  ELSE 'supporting_evidence'
END;
