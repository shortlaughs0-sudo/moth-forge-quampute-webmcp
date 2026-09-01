import { env } from 'cloudflare:workers';
import { ensureSchema } from '@/db/ensure-schema';
import { parseJson } from './http';
import { CURRENT_PROCESSING_CONSENT_VERSION } from './processing-consent';

export type ProjectRecord = {
  id: string;
  owner_id: string;
  title: string;
  build_type: string;
  concept: string;
  status: string;
  revision: number;
  locks_revision: number;
  forge_document_id: string;
  forge_revision_id: string;
  forge_manifest_hash: string;
  player_boundary: string;
  content_boundary: string;
  authority_map_json: string;
  locks_json: string;
  answers_json: string;
  result_json: string | null;
  qa_json: string | null;
  research_enabled: number;
  research_cost_approved: number;
  processing_consent_version: number;
  created_at: string;
  updated_at: string;
};

export type SourceRecord = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  kind: string;
  role: string;
  authority: string;
  visibility: string;
  uri: string | null;
  r2_key: string | null;
  text_content: string | null;
  text_characters?: number;
  content_hash: string;
  read_status: string;
  coverage_state: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type ProjectSummaryRecord = Pick<ProjectRecord,
  'id' | 'title' | 'build_type' | 'status' | 'revision' | 'locks_revision' | 'forge_revision_id' | 'updated_at'>;

export async function getOwnedProject(projectId: string, ownerId: string) {
  await ensureSchema();
  return env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ? LIMIT 1')
    .bind(projectId, ownerId)
    .first<ProjectRecord>();
}

export async function getActiveProjectRun(projectId: string, ownerId: string) {
  await ensureSchema();
  return env.DB.prepare(`SELECT id, status, upstream_client_request_id
    FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
    ORDER BY created_at DESC LIMIT 1`)
    .bind(projectId, ownerId)
    .first<{ id: string; status: 'running' | 'unknown'; upstream_client_request_id: string | null }>();
}

export async function listOwnedProjectSummaries(
  ownerId: string,
  cursor?: { updatedAt: string; id: string } | null,
) {
  await ensureSchema();
  const select = `SELECT id, title, build_type, status, revision, locks_revision, forge_revision_id, updated_at
    FROM projects`;
  const result = cursor
    ? await env.DB.prepare(`${select} WHERE owner_id = ?
        AND (updated_at < ? OR (updated_at = ? AND id < ?))
        ORDER BY updated_at DESC, id DESC LIMIT 101`)
        .bind(ownerId, cursor.updatedAt, cursor.updatedAt, cursor.id).all<ProjectSummaryRecord>()
    : await env.DB.prepare(`${select} WHERE owner_id = ?
        ORDER BY updated_at DESC, id DESC LIMIT 101`)
        .bind(ownerId).all<ProjectSummaryRecord>();
  const projects = result.results.slice(0, 100);
  const last = projects.at(-1);
  return {
    projects,
    nextCursor: result.results.length > 100 && last ? `${last.updated_at}|${last.id}` : null,
  };
}

export async function listOwnedSources(projectId: string, ownerId: string) {
  await ensureSchema();
  const result = await env.DB.prepare(
    'SELECT * FROM sources WHERE project_id = ? AND owner_id = ? ORDER BY created_at ASC',
  ).bind(projectId, ownerId).all<SourceRecord>();
  return result.results;
}

export async function listOwnedSourceSummaries(projectId: string, ownerId: string) {
  await ensureSchema();
  const result = await env.DB.prepare(`SELECT
    id, project_id, owner_id, name, kind, role, authority, visibility, uri, r2_key,
    NULL AS text_content, LENGTH(text_content) AS text_characters,
    content_hash, read_status, coverage_state, metadata_json,
    created_at, updated_at
    FROM sources WHERE project_id = ? AND owner_id = ? ORDER BY created_at ASC`)
    .bind(projectId, ownerId).all<SourceRecord>();
  return result.results;
}

export function projectDto(project: ProjectRecord, includeResult = true) {
  return {
    id: project.id,
    title: project.title,
    buildType: project.build_type,
    concept: project.concept,
    status: project.status,
    revision: project.revision,
    locksRevision: project.locks_revision,
    forgeDocumentId: project.forge_document_id,
    forgeRevisionId: project.forge_revision_id,
    forgeManifestHash: project.forge_manifest_hash,
    playerBoundary: project.player_boundary,
    contentBoundary: project.content_boundary,
    authorityMap: parseJson<unknown[]>(project.authority_map_json, []),
    locks: parseJson<string[]>(project.locks_json, []),
    answers: parseJson<unknown[]>(project.answers_json, []),
    result: includeResult ? parseJson<unknown | null>(project.result_json, null) : undefined,
    qa: includeResult ? parseJson<unknown | null>(project.qa_json, null) : undefined,
    researchEnabled: Boolean(project.research_enabled),
    researchCostApproved: Boolean(project.research_cost_approved)
      && project.processing_consent_version === CURRENT_PROCESSING_CONSENT_VERSION,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

export function projectSummaryDto(project: ProjectSummaryRecord) {
  return {
    id: project.id,
    title: project.title,
    buildType: project.build_type,
    status: project.status,
    revision: project.revision,
    locksRevision: project.locks_revision,
    forgeRevisionId: project.forge_revision_id,
    updatedAt: project.updated_at,
  };
}

export function sourceDto(source: SourceRecord) {
  return {
    id: source.id,
    projectId: source.project_id,
    name: source.name,
    kind: source.kind,
    role: source.role,
    authority: source.authority,
    visibility: source.visibility,
    uri: source.uri,
    hasStoredFile: Boolean(source.r2_key),
    textCharacters: source.text_characters ?? source.text_content?.length ?? 0,
    contentHash: source.content_hash,
    readStatus: source.read_status,
    coverageState: source.coverage_state,
    metadata: parseJson<Record<string, unknown>>(source.metadata_json, {}),
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
}
