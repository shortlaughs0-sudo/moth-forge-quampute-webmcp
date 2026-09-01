import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerContext, isPublicDemoMode } from '@/lib/server/auth';
import { verifyForgeAnchor } from '@/lib/server/forge-anchor';
import { mergeCreatorAnswers } from '@/lib/server/creator-answers';
import { apiError, nowIso, parseJson } from '@/lib/server/http';
import { shouldPreserveGuidedDemoReview } from '@/lib/server/guided-demo-state';
import {
  FILE_DELETE_IN_PROGRESS,
  FILE_DELETE_READY,
  finishPendingFileDeletion,
} from '@/lib/server/file-deletions';
import { CURRENT_PROCESSING_CONSENT_VERSION } from '@/lib/server/processing-consent';
import { getActiveProjectRun, getOwnedProject, listOwnedSourceSummaries, projectDto, sourceDto } from '@/lib/server/projects';
import { validateQuamputeOutput } from '@/lib/server/quampute-schema';

type Context = { params: Promise<{ id: string }> };
const MAX_CREATOR_ANSWERS = 607;
const CONTENT_BOUNDARIES = new Set(['general', 'mature_18_plus', 'mixed_private']);

export async function GET(_request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id } = await context.params;
  const project = await getOwnedProject(id, owner.ownerId);
  if (!project) return apiError('NOT_FOUND', 'Project not found.', 404);

  const [sources, runs] = await Promise.all([
    listOwnedSourceSummaries(id, owner.ownerId),
    env.DB.prepare(`SELECT id, run_kind AS runKind, stage, status, model,
      research_enabled AS researchEnabled, upstream_client_request_id AS traceId,
      project_revision AS projectRevision, locks_revision AS locksRevision,
      forge_revision_id AS forgeRevisionId,
      error_code AS errorCode, error_message AS errorMessage,
      created_at AS createdAt, completed_at AS completedAt
      FROM runs WHERE project_id = ? AND owner_id = ?
      ORDER BY CASE WHEN status IN ('running', 'unknown') THEN 0 ELSE 1 END, created_at DESC LIMIT 20`)
      .bind(id, owner.ownerId).all(),
  ]);

  return NextResponse.json({
    ok: true,
    project: projectDto(project),
    sources: sources.map(sourceDto),
    runs: runs.results,
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const publicDemoMode = isPublicDemoMode();
  const { id } = await context.params;
  const current = await getOwnedProject(id, owner.ownerId);
  if (!current) return apiError('NOT_FOUND', 'Project not found.', 404);
  const activeRun = await getActiveProjectRun(id, owner.ownerId);
  if (activeRun) {
    return apiError(
      'RUN_SUPERSEDED',
      activeRun.status === 'unknown'
        ? 'Reconcile the uncertain paid run before changing or rebasing this work order. No model call was made.'
        : 'Resume or wait for the active paid run before changing or rebasing this work order. No model call was made.',
      409,
      'project',
      activeRun.status === 'running',
      activeRun.id,
      { traceId: activeRun.upstream_client_request_id ?? activeRun.id },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'The project update was not valid JSON.', 400);
  }

  const currentResult = typeof current.result_json === 'string'
    ? parseJson<Record<string, unknown> | null>(current.result_json, null)
    : null;
  const preserveGuidedDemoReview = shouldPreserveGuidedDemoReview({
    publicDemoMode,
    projectId: current.id,
    bodyKeys: Object.keys(body).sort(),
    result: currentResult,
  }) && validateQuamputeOutput(currentResult);

  if (body.rebaseForge === true) {
    const anchor = await verifyForgeAnchor();
    if (anchor.status !== 'verified') {
      return apiError('FORGE_PARTIAL', 'The current 29-tab Forge failed integrity verification. The project was not rebased.', 409, 'anchor');
    }
    if (current.forge_revision_id === anchor.revisionId && current.forge_manifest_hash === anchor.manifestHash) {
      return NextResponse.json({ ok: true, project: projectDto(current), unchanged: true });
    }
    const now = nowIso();
    const update = await env.DB.prepare(`UPDATE projects SET
      forge_document_id = ?, forge_revision_id = ?, forge_manifest_hash = ?,
      revision = revision + 1, status = 'draft', result_json = NULL, qa_json = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
        AND NOT EXISTS (
          SELECT 1 FROM runs AS active
          WHERE active.project_id = projects.id AND active.owner_id = projects.owner_id
            AND active.status IN ('running', 'unknown')
        )`)
      .bind(
        anchor.documentId, anchor.revisionId, anchor.manifestHash, now,
        id, owner.ownerId, current.revision, current.locks_revision,
      ).run();
    if (Number((update.meta as { changes?: number }).changes ?? 0) !== 1) {
      return apiError('RUN_SUPERSEDED', 'The project changed before the verified Forge rebase could be applied.', 409, 'anchor');
    }
    const rebased = await getOwnedProject(id, owner.ownerId);
    return NextResponse.json({ ok: true, project: projectDto(rebased!), rebased: true });
  }

  const concept = typeof body.concept === 'string' ? body.concept.trim() : current.concept;
  if (concept.length < 12 || concept.length > 18_000) {
    return apiError('INVALID_INPUT', 'Concept must be between 12 and 18,000 characters.', 400, 'spark');
  }
  let title = current.title;
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
      return apiError('INVALID_INPUT', 'Title must be non-empty text no longer than 120 characters.', 400, 'project');
    }
    title = body.title.trim();
  }
  let playerBoundary = current.player_boundary;
  if (body.playerBoundary !== undefined) {
    if (typeof body.playerBoundary !== 'string' || !body.playerBoundary.trim() || body.playerBoundary.trim().length > 500) {
      return apiError('INVALID_INPUT', 'Player boundary must be non-empty text no longer than 500 characters.', 400, 'locks');
    }
    playerBoundary = body.playerBoundary.trim();
  }
  let contentBoundary = current.content_boundary;
  if (body.contentBoundary !== undefined) {
    if (typeof body.contentBoundary !== 'string' || !CONTENT_BOUNDARIES.has(body.contentBoundary)) {
      return apiError('INVALID_INPUT', 'Choose a supported content boundary.', 400, 'locks');
    }
    contentBoundary = body.contentBoundary;
  }
  let locks = parseJson<string[]>(current.locks_json, []);
  if (body.locks !== undefined) {
    if (!Array.isArray(body.locks) || body.locks.length > 80) {
      return apiError('INVALID_INPUT', 'Creator locks must be an array of at most 80 text values.', 400, 'locks');
    }
    const incomingLocks: string[] = [];
    for (const item of body.locks) {
      if (typeof item !== 'string' || item.length > 500 || !item.trim()) {
        return apiError('INVALID_INPUT', 'Each creator lock must be non-empty text no longer than 500 characters.', 400, 'locks');
      }
      incomingLocks.push(item.trim());
    }
    const locksMode = body.locksMode === undefined ? 'append' : body.locksMode;
    if (locksMode !== 'append' && locksMode !== 'replace') {
      return apiError('INVALID_INPUT', 'locksMode must be append or replace.', 400, 'locks');
    }
    if (!Number.isInteger(body.expectedLocksRevision) || Number(body.expectedLocksRevision) !== current.locks_revision) {
      return apiError(
        'RUN_SUPERSEDED',
        `Creator locks changed after inspection. Reload the project and retry against locks revision ${current.locks_revision}.`,
        409,
        'locks',
      );
    }
    locks = locksMode === 'replace'
      ? [...new Set(incomingLocks)]
      : [...new Set([...locks, ...incomingLocks])];
    if (locks.length > 80) {
      return apiError('INVALID_INPUT', 'Appending those creator locks would exceed the 80-lock project limit.', 400, 'locks');
    }
  }
  let answers = parseJson<unknown[]>(current.answers_json, []);
  if (Array.isArray(body.answers)) {
    const merged = mergeCreatorAnswers(answers, body.answers, nowIso());
    if (!merged) return apiError('INVALID_INPUT', `Creator answers require a named fact, a non-empty answer, and no more than ${MAX_CREATOR_ANSWERS} active decisions.`, 400, 'questions');
    answers = merged;
  }
  const researchEnabled = publicDemoMode ? false : typeof body.researchEnabled === 'boolean'
    ? body.researchEnabled
    : Boolean(current.research_enabled);
  const researchCostApproved = publicDemoMode ? false : typeof body.researchCostApproved === 'boolean'
    ? body.researchCostApproved
    : Boolean(current.research_cost_approved)
      && current.processing_consent_version === CURRENT_PROCESSING_CONSENT_VERSION;
  const processingConsentVersion = researchCostApproved ? CURRENT_PROCESSING_CONSENT_VERSION : 0;

  const locksChanged = JSON.stringify(locks) !== current.locks_json;
  const answersChanged = JSON.stringify(answers) !== current.answers_json;
  const substantiveChanged = title !== current.title
    || concept !== current.concept
    || locksChanged
    || playerBoundary !== current.player_boundary
    || contentBoundary !== current.content_boundary
    || researchEnabled !== Boolean(current.research_enabled)
    || researchCostApproved !== Boolean(current.research_cost_approved)
    || processingConsentVersion !== current.processing_consent_version
    || (answersChanged && !preserveGuidedDemoReview);
  const now = nowIso();

  const update = await env.DB.prepare(`UPDATE projects SET
    title = ?, concept = ?, player_boundary = ?, content_boundary = ?,
    locks_json = ?, answers_json = ?, research_enabled = ?, research_cost_approved = ?, processing_consent_version = ?,
    revision = ?, locks_revision = ?, status = ?, result_json = ?, qa_json = ?, updated_at = ?
    WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
      AND NOT EXISTS (
        SELECT 1 FROM runs AS active
        WHERE active.project_id = projects.id AND active.owner_id = projects.owner_id
          AND active.status IN ('running', 'unknown')
      )`)
    .bind(
      title, concept, playerBoundary, contentBoundary,
      JSON.stringify(locks), JSON.stringify(answers),
      researchEnabled ? 1 : 0, researchCostApproved ? 1 : 0, processingConsentVersion,
      substantiveChanged ? current.revision + 1 : current.revision,
      locksChanged ? current.locks_revision + 1 : current.locks_revision,
      substantiveChanged ? 'draft' : current.status,
      substantiveChanged ? null : current.result_json,
      substantiveChanged ? null : current.qa_json,
      now, id, owner.ownerId, current.revision, current.locks_revision,
    ).run();
  if (Number((update.meta as { changes?: number }).changes ?? 0) !== 1) {
    return apiError('RUN_SUPERSEDED', 'The project changed in another request. Reload it before saving these edits.', 409, 'project');
  }

  const updated = await getOwnedProject(id, owner.ownerId);
  return NextResponse.json({ ok: true, project: projectDto(updated!) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id } = await context.params;
  const current = await getOwnedProject(id, owner.ownerId);
  if (!current) return apiError('NOT_FOUND', 'Project not found.', 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'Exact title confirmation is required.', 400);
  }
  if (body.confirmTitle !== current.title) {
    return apiError('INVALID_INPUT', 'Exact title confirmation did not match.', 409);
  }

  const stored = await env.DB.prepare(
    'SELECT r2_key FROM sources WHERE project_id = ? AND owner_id = ? AND r2_key IS NOT NULL',
  ).bind(id, owner.ownerId).all<{ r2_key: string }>();
  const now = nowIso();
  const pending = stored.results.map((source) => ({ id: crypto.randomUUID(), r2Key: source.r2_key }));
  const statements = [
    ...pending.map((item) => env.DB.prepare(`INSERT OR IGNORE INTO pending_file_deletions
      (id, owner_id, r2_key, state, lease_until, attempts, last_error, created_at, updated_at)
      SELECT ?, ?, ?, ?, NULL, 0, NULL, ?, ? FROM sources AS source
      WHERE source.project_id = ? AND source.owner_id = ? AND source.r2_key = ?
        AND EXISTS (
          SELECT 1 FROM projects AS project
          WHERE project.id = ? AND project.owner_id = ? AND project.title = ?
            AND project.revision = ? AND project.locks_revision = ?
            AND NOT EXISTS (
              SELECT 1 FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
            )
        )`)
      .bind(
        item.id, owner.ownerId, item.r2Key, FILE_DELETE_READY, now, now,
        id, owner.ownerId, item.r2Key,
        id, owner.ownerId, current.title, current.revision, current.locks_revision,
        id, owner.ownerId,
      )),
    env.DB.prepare(`DELETE FROM projects
      WHERE id = ? AND owner_id = ? AND title = ? AND revision = ? AND locks_revision = ?
        AND NOT EXISTS (
          SELECT 1 FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
        )
        AND NOT EXISTS (
          SELECT 1 FROM sources AS file_source
          WHERE file_source.project_id = projects.id
            AND file_source.owner_id = projects.owner_id
            AND file_source.r2_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM pending_file_deletions AS pending
              WHERE pending.owner_id = projects.owner_id
                AND pending.r2_key = file_source.r2_key
                AND pending.state IN (?, ?)
            )
        )`)
      .bind(
        id, owner.ownerId, current.title, current.revision, current.locks_revision,
        id, owner.ownerId,
        FILE_DELETE_READY, FILE_DELETE_IN_PROGRESS,
      ),
  ];
  const writes = await env.DB.batch(statements);
  const projectWrite = writes[writes.length - 1];
  if (Number((projectWrite.meta as { changes?: number }).changes ?? 0) < 1) {
    for (const item of pending) {
      await finishPendingFileDeletion(item.id, owner.ownerId, item.r2Key, { force: true });
    }
    return apiError('RUN_SUPERSEDED', 'The project changed or still has an active or uncertain paid run. Reload, wait, or reconcile before deleting it.', 409, 'project');
  }
  let cleanupPending = 0;
  for (const item of pending) {
    if (!await finishPendingFileDeletion(item.id, owner.ownerId, item.r2Key, { force: true })) cleanupPending += 1;
  }
  return NextResponse.json({ ok: true, deletedProjectId: id, cleanupPending });
}
