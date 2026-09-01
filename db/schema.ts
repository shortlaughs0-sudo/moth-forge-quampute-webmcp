import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    buildType: text('build_type').notNull(),
    concept: text('concept').notNull(),
    status: text('status').notNull().default('draft'),
    revision: integer('revision').notNull().default(1),
    locksRevision: integer('locks_revision').notNull().default(1),
    forgeDocumentId: text('forge_document_id').notNull(),
    forgeRevisionId: text('forge_revision_id').notNull(),
    forgeManifestHash: text('forge_manifest_hash').notNull(),
    playerBoundary: text('player_boundary').notNull().default('undefined'),
    contentBoundary: text('content_boundary').notNull().default('general'),
    authorityMapJson: text('authority_map_json').notNull().default('[]'),
    locksJson: text('locks_json').notNull().default('[]'),
    answersJson: text('answers_json').notNull().default('[]'),
    resultJson: text('result_json'),
    qaJson: text('qa_json'),
    researchEnabled: integer('research_enabled', { mode: 'boolean' }).notNull().default(false),
    researchCostApproved: integer('research_cost_approved', { mode: 'boolean' }).notNull().default(false),
    processingConsentVersion: integer('processing_consent_version').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('projects_owner_updated_idx').on(table.ownerId, table.updatedAt),
    index('projects_owner_status_idx').on(table.ownerId, table.status),
  ],
);

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    role: text('role').notNull().default('canon'),
    authority: text('authority').notNull().default('creator_source'),
    visibility: text('visibility').notNull().default('creator_only'),
    uri: text('uri'),
    r2Key: text('r2_key'),
    textContent: text('text_content'),
    contentHash: text('content_hash').notNull(),
    readStatus: text('read_status').notNull().default('verified_full'),
    coverageState: text('coverage_state').notNull().default('ready'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('sources_project_owner_idx').on(table.projectId, table.ownerId),
    uniqueIndex('sources_owner_project_hash_uq').on(table.ownerId, table.projectId, table.contentHash),
  ],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    runKind: text('run_kind').notNull().default('pre_quampute'),
    stage: text('stage').notNull(),
    status: text('status').notNull(),
    model: text('model'),
    researchEnabled: integer('research_enabled', { mode: 'boolean' }).notNull().default(false),
    projectRevision: integer('project_revision').notNull(),
    locksRevision: integer('locks_revision').notNull(),
    forgeRevisionId: text('forge_revision_id').notNull(),
    inputHash: text('input_hash').notNull(),
    upstreamResponseId: text('upstream_response_id'),
    upstreamRequestId: text('upstream_request_id'),
    upstreamClientRequestId: text('upstream_client_request_id'),
    contextReceiptJson: text('context_receipt_json').notNull().default('{}'),
    outputJson: text('output_json'),
    citationsJson: text('citations_json').notNull().default('[]'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    uniqueIndex('runs_owner_project_idempotency_uq').on(table.ownerId, table.projectId, table.idempotencyKey),
    uniqueIndex('runs_active_snapshot_uq')
      .on(table.ownerId, table.projectId, table.inputHash)
      .where(sql`${table.status} IN ('running', 'unknown')`),
    index('runs_project_owner_created_idx').on(table.projectId, table.ownerId, table.createdAt),
  ],
);

export const pendingFileDeletions = sqliteTable(
  'pending_file_deletions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    r2Key: text('r2_key').notNull(),
    state: text('state').notNull().default('delete_ready'),
    leaseUntil: text('lease_until'),
    claimToken: text('claim_token'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('pending_file_deletions_key_uq').on(table.r2Key),
    index('pending_file_deletions_owner_created_idx').on(table.ownerId, table.createdAt),
    index('pending_file_deletions_owner_state_lease_idx').on(table.ownerId, table.state, table.leaseUntil),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type PendingFileDeletion = typeof pendingFileDeletions.$inferSelect;
