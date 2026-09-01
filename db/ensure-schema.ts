import { env } from 'cloudflare:workers';

let ensured: Promise<void> | null = null;

export function ensureSchema() {
  if (ensured) return ensured;
  ensured = createSchema().catch((error) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

async function createSchema() {
  const db = env.DB;
  if (!db) throw new Error('D1 binding DB is unavailable.');

  const ensureColumn = async (table: string, column: string, statement: string) => {
    const readColumns = () => db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const before = await readColumns();
    if (before.results.some((existing) => existing.name === column)) return false;
    try {
      await db.prepare(statement).run();
      return true;
    } catch (error) {
      const after = await readColumns();
      if (!after.results.some((existing) => existing.name === column)) throw error;
      return false;
    }
  };

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      build_type TEXT NOT NULL,
      concept TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      revision INTEGER NOT NULL DEFAULT 1,
      locks_revision INTEGER NOT NULL DEFAULT 1,
      forge_document_id TEXT NOT NULL,
      forge_revision_id TEXT NOT NULL,
      forge_manifest_hash TEXT NOT NULL,
      player_boundary TEXT NOT NULL DEFAULT 'undefined',
      content_boundary TEXT NOT NULL DEFAULT 'general',
      authority_map_json TEXT NOT NULL DEFAULT '[]',
      locks_json TEXT NOT NULL DEFAULT '[]',
      answers_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT,
      qa_json TEXT,
      research_enabled INTEGER NOT NULL DEFAULT 0,
      research_cost_approved INTEGER NOT NULL DEFAULT 0,
      processing_consent_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_id, updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS projects_owner_status_idx ON projects (owner_id, status)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'canon',
      authority TEXT NOT NULL DEFAULT 'creator_source',
      visibility TEXT NOT NULL DEFAULT 'creator_only',
      uri TEXT,
      r2_key TEXT,
      text_content TEXT,
      content_hash TEXT NOT NULL,
      read_status TEXT NOT NULL DEFAULT 'verified_full',
      coverage_state TEXT NOT NULL DEFAULT 'ready',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS sources_project_owner_idx ON sources (project_id, owner_id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS sources_owner_project_hash_uq ON sources (owner_id, project_id, content_hash)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      run_kind TEXT NOT NULL DEFAULT 'pre_quampute',
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      research_enabled INTEGER NOT NULL DEFAULT 0,
      project_revision INTEGER NOT NULL,
      locks_revision INTEGER NOT NULL,
      forge_revision_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      upstream_response_id TEXT,
      upstream_request_id TEXT,
      upstream_client_request_id TEXT,
      context_receipt_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT,
      citations_json TEXT NOT NULL DEFAULT '[]',
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`),
    db.prepare('DROP INDEX IF EXISTS runs_owner_idempotency_uq'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS runs_owner_project_idempotency_uq ON runs (owner_id, project_id, idempotency_key)'),
    db.prepare('CREATE INDEX IF NOT EXISTS runs_project_owner_created_idx ON runs (project_id, owner_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS pending_file_deletions (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'delete_ready',
      lease_until TEXT,
      claim_token TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS pending_file_deletions_key_uq ON pending_file_deletions (r2_key)'),
    db.prepare('CREATE INDEX IF NOT EXISTS pending_file_deletions_owner_created_idx ON pending_file_deletions (owner_id, created_at)'),
  ]);

  await ensureColumn(
    'projects',
    'processing_consent_version',
    'ALTER TABLE projects ADD COLUMN processing_consent_version INTEGER NOT NULL DEFAULT 0',
  );

  await ensureColumn(
    'pending_file_deletions',
    'state',
    "ALTER TABLE pending_file_deletions ADD COLUMN state TEXT NOT NULL DEFAULT 'delete_ready'",
  );
  await ensureColumn(
    'pending_file_deletions',
    'lease_until',
    'ALTER TABLE pending_file_deletions ADD COLUMN lease_until TEXT',
  );
  await ensureColumn(
    'pending_file_deletions',
    'claim_token',
    'ALTER TABLE pending_file_deletions ADD COLUMN claim_token TEXT',
  );
  await db.prepare(`CREATE INDEX IF NOT EXISTS pending_file_deletions_owner_state_lease_idx
    ON pending_file_deletions (owner_id, state, lease_until)`).run();

  const upgradingLegacyRuns = await ensureColumn(
    'runs',
    'upstream_response_id',
    'ALTER TABLE runs ADD COLUMN upstream_response_id TEXT',
  );
  await ensureColumn('runs', 'upstream_request_id', 'ALTER TABLE runs ADD COLUMN upstream_request_id TEXT');
  await ensureColumn('runs', 'upstream_client_request_id', 'ALTER TABLE runs ADD COLUMN upstream_client_request_id TEXT');
  if (upgradingLegacyRuns) {
    await db.prepare(`UPDATE runs SET status = 'failed', error_code = 'UPSTREAM_FAILED',
      error_message = 'Legacy synchronous run could not be recovered after the durable-background upgrade.',
      completed_at = CURRENT_TIMESTAMP
      WHERE status = 'running' AND upstream_response_id IS NULL`).run();
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS runs_active_snapshot_uq ON runs (owner_id, project_id, input_hash) WHERE status IN ('running', 'unknown')").run();
}
