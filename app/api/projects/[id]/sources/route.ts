import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerContext, isPublicDemoMode } from '@/lib/server/auth';
import { apiError, hashText, nowIso } from '@/lib/server/http';
import {
  FILE_DELETE_IN_PROGRESS,
  FILE_DELETE_READY,
  FILE_UPLOAD_IN_PROGRESS,
  finishPendingFileDeletion,
  pendingUploadLeaseUntil,
} from '@/lib/server/file-deletions';
import { getActiveProjectRun, getOwnedProject, listOwnedSourceSummaries, sourceDto } from '@/lib/server/projects';

type Context = { params: Promise<{ id: string }> };
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'application/json', 'text/csv']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_TEXT_BYTES = 1_400_000;
const MAX_PROJECT_INLINE_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_SOURCES = 40;
const PUBLIC_DEMO_SOURCE_SLOT_LIMIT = 12;
const PUBLIC_DEMO_MAX_INLINE_TEXT_BYTES = 100_000;
const PUBLIC_DEMO_MAX_PROJECT_INLINE_BYTES = 500_000;
const SOURCE_ROLES = ['canon', 'reference', 'inspiration', 'format_only'] as const;

export async function GET(_request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id } = await context.params;
  if (!await getOwnedProject(id, owner.ownerId)) return apiError('NOT_FOUND', 'Project not found.', 404);
  const sources = await listOwnedSourceSummaries(id, owner.ownerId);
  return NextResponse.json({ ok: true, sources: sources.map(sourceDto) });
}

export async function POST(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const publicDemoMode = isPublicDemoMode();
  const maxInlineTextBytes = publicDemoMode ? PUBLIC_DEMO_MAX_INLINE_TEXT_BYTES : MAX_INLINE_TEXT_BYTES;
  const maxProjectInlineBytes = publicDemoMode ? PUBLIC_DEMO_MAX_PROJECT_INLINE_BYTES : MAX_PROJECT_INLINE_BYTES;
  const { id: projectId } = await context.params;
  const project = await getOwnedProject(projectId, owner.ownerId);
  if (!project) return apiError('NOT_FOUND', 'Project not found.', 404);
  const activeRun = await getActiveProjectRun(projectId, owner.ownerId);
  if (activeRun) return activeRunMutationError(activeRun, 'add sources to');
  const sourceStats = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM sources WHERE project_id = ? AND owner_id = ?) AS source_count,
    (SELECT COALESCE(SUM(LENGTH(cast(COALESCE(text_content, '') AS BLOB))), 0)
      FROM sources WHERE project_id = ? AND owner_id = ?) AS inline_bytes,
    (SELECT COUNT(*) FROM sources WHERE owner_id = ?) AS owner_source_count,
    (SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?) AS pending_deletion_count`)
    .bind(projectId, owner.ownerId, projectId, owner.ownerId, owner.ownerId, owner.ownerId)
    .first<{ source_count: number; inline_bytes: number; owner_source_count: number; pending_deletion_count: number }>();
  const occupiedOwnerSlots = (sourceStats?.owner_source_count ?? 0) + (sourceStats?.pending_deletion_count ?? 0);
  if (publicDemoMode && occupiedOwnerSlots >= PUBLIC_DEMO_SOURCE_SLOT_LIMIT) {
    return apiError('RATE_LIMITED', `The public demo keeps up to ${PUBLIC_DEMO_SOURCE_SLOT_LIMIT} occupied evidence slots per account.`, 429, 'sources');
  }
  if ((sourceStats?.source_count ?? 0) >= MAX_PROJECT_SOURCES) {
    return apiError('INVALID_INPUT', `A project may hold up to ${MAX_PROJECT_SOURCES} sources. Consolidate or remove evidence before adding more.`, 413, 'sources');
  }

  const sourceId = crypto.randomUUID();
  const now = nowIso();
  const contentType = request.headers.get('content-type') ?? '';
  if (publicDemoMode && contentType.includes('multipart/form-data')) {
    return apiError('PUBLIC_DEMO_RESTRICTED', 'The public challenge demo accepts pasted text or URL evidence only; file storage is disabled.', 403, 'sources');
  }

  let name = '';
  let kind = 'text';
  let role = '';
  let authority = 'supporting_evidence';
  let visibility = 'creator_only';
  let uri: string | null = null;
  let r2Key: string | null = null;
  let uploadCleanupId: string | null = null;
  let textContent: string | null = null;
  let readStatus = 'verified_full';
  let coverageState = 'ready';
  let metadata: Record<string, unknown> = {};
  let hashInput = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return apiError('INVALID_INPUT', 'Choose a file to add.', 400, 'sources');
    if (file.size > MAX_FILE_BYTES) return apiError('INVALID_INPUT', 'Source files may be up to 10 MB.', 413, 'sources');
    if (file.name.length > 500) return apiError('INVALID_INPUT', 'Original file names may be up to 500 characters.', 400, 'sources');
    const suppliedName = form.get('name');
    name = typeof suppliedName === 'string' && suppliedName.trim() ? suppliedName.trim() : file.name.trim();
    if (!name || name.length > 180) return apiError('INVALID_INPUT', 'Source names must be non-empty text no longer than 180 characters.', 400, 'sources');
    role = requiredRole(form.get('role')) ?? '';
    if (!role) return apiError('INVALID_INPUT', 'Choose an explicit source role. Ambiguous evidence is never promoted to canon.', 400, 'sources');
    const requestedVisibility = cleanEnum(form.get('visibility'), ['creator_only', 'narrator_private', 'actor_known', 'public'], 'creator_only');
    if (!requestedVisibility) return apiError('INVALID_INPUT', 'Choose a supported source visibility.', 400, 'sources');
    visibility = requestedVisibility;
    const imageMimeType = supportedImageMimeType(file);
    kind = imageMimeType ? 'image' : 'file';
    const bytes = await file.arrayBuffer();
    hashInput = await hashBytes(bytes);
    r2Key = `owners/${owner.ownerId}/projects/${projectId}/sources/${sourceId}/original`;
    uploadCleanupId = crypto.randomUUID();
    const uploadLeaseUntil = pendingUploadLeaseUntil();
    await env.DB.prepare(`INSERT INTO pending_file_deletions
      (id, owner_id, r2_key, state, lease_until, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
      .bind(uploadCleanupId, owner.ownerId, r2Key, FILE_UPLOAD_IN_PROGRESS, uploadLeaseUntil, now, now).run();
    try {
      await env.FILES.put(r2Key, bytes, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { originalName: file.name, ownerId: owner.ownerId, projectId },
      });
    } catch (error) {
      await finishPendingFileDeletion(uploadCleanupId, owner.ownerId, r2Key, { force: true });
      throw error;
    }
    const leaseRenewedAt = nowIso();
    const renewedLeaseUntil = pendingUploadLeaseUntil();
    const renewedLease = await env.DB.prepare(`UPDATE pending_file_deletions
      SET lease_until = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ?`)
      .bind(
        renewedLeaseUntil, leaseRenewedAt,
        uploadCleanupId, owner.ownerId, r2Key, FILE_UPLOAD_IN_PROGRESS,
      ).run();
    if (Number((renewedLease.meta as { changes?: number }).changes ?? 0) !== 1) {
      await finishPendingFileDeletion(uploadCleanupId, owner.ownerId, r2Key, { force: true });
      return apiError('RUN_SUPERSEDED', 'The upload lease expired before the source could be attached. Retry the source.', 409, 'sources');
    }
    if (imageMimeType) {
      readStatus = 'verified_visual';
      coverageState = 'ready';
    } else if ((TEXT_TYPES.has(file.type) || /\.(txt|md|json|csv)$/i.test(file.name)) && file.size <= MAX_INLINE_TEXT_BYTES) {
      try {
        textContent = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        readStatus = 'opaque';
        coverageState = 'awaiting_extraction';
      }
    } else {
      readStatus = 'opaque';
      coverageState = 'awaiting_extraction';
    }
    metadata = { fileName: file.name, mimeType: imageMimeType || file.type || 'application/octet-stream', bytes: file.size };
  } else {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return apiError('INVALID_INPUT', 'The source request was not valid JSON.', 400, 'sources');
    }
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length > 180)) {
      return apiError('INVALID_INPUT', 'Source names may be up to 180 characters.', 400, 'sources');
    }
    name = typeof body.name === 'string' ? body.name.trim() : '';
    role = requiredRole(body.role) ?? '';
    if (!role) return apiError('INVALID_INPUT', 'Choose an explicit source role. Ambiguous evidence is never promoted to canon.', 400, 'sources');
    const requestedVisibility = cleanEnum(body.visibility, ['creator_only', 'narrator_private', 'actor_known', 'public'], 'creator_only');
    if (!requestedVisibility) return apiError('INVALID_INPUT', 'Choose a supported source visibility.', 400, 'sources');
    visibility = requestedVisibility;
    if (body.uri !== undefined && (typeof body.uri !== 'string' || body.uri.trim().length > 2_000)) {
      return apiError('INVALID_INPUT', 'Source URLs may be up to 2,000 characters.', 400, 'sources');
    }
    uri = typeof body.uri === 'string' && body.uri.trim() ? body.uri.trim() : null;
    textContent = typeof body.textContent === 'string' && body.textContent.trim() ? body.textContent.trim() : null;
    if (textContent && new TextEncoder().encode(textContent).byteLength > maxInlineTextBytes) {
      return apiError('INVALID_INPUT', `Pasted sources may be up to ${Math.floor(maxInlineTextBytes / 1_000)} KB after UTF-8 encoding in this mode.`, 413, 'sources');
    }
    kind = uri ? 'url' : 'text';
    if (uri) {
      try {
        const parsed = new URL(uri);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
        if (!name) name = parsed.hostname;
      } catch {
        return apiError('INVALID_INPUT', 'Source URLs must be valid HTTP or HTTPS addresses.', 400, 'sources');
      }
    }
    if (!name) name = 'Creator note';
    if (!textContent && uri) {
      readStatus = 'opaque';
      coverageState = 'awaiting_research';
    }
    if (!textContent && !uri) return apiError('INVALID_INPUT', 'Add pasted evidence or a source URL.', 400, 'sources');
    hashInput = await hashText(`${uri ?? ''}\n${textContent ?? ''}`);
  }

  authority = authorityForRole(role);
  const newInlineBytes = textContent ? new TextEncoder().encode(textContent).byteLength : 0;
  if ((sourceStats?.inline_bytes ?? 0) + newInlineBytes > maxProjectInlineBytes) {
    if (r2Key && uploadCleanupId) {
      await finishPendingFileDeletion(uploadCleanupId, owner.ownerId, r2Key, { force: true });
    }
    return apiError('RATE_LIMITED', `This project has reached its ${Math.floor(maxProjectInlineBytes / 1_000)} KB inline-evidence limit for this mode. Consolidate its sources.`, 429, 'sources');
  }

  const contentHash = hashInput.length === 64 ? hashInput : await hashText(hashInput);
  try {
    const statements = [
      env.DB.prepare(`INSERT INTO sources (
        id, project_id, owner_id, name, kind, role, authority, visibility, uri, r2_key,
        text_content, content_hash, read_status, coverage_state, metadata_json, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM projects AS current
        WHERE current.id = ? AND current.owner_id = ?
          AND current.revision = ? AND current.locks_revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM runs AS active
            WHERE active.project_id = current.id AND active.owner_id = current.owner_id
              AND active.status IN ('running', 'unknown')
          )
           AND (? = 0 OR (
             (SELECT COUNT(*) FROM sources WHERE owner_id = ?)
             + (SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?)
           ) < ?)
          AND (? = 0 OR EXISTS (
            SELECT 1 FROM pending_file_deletions AS upload
            WHERE upload.id = ? AND upload.owner_id = current.owner_id AND upload.r2_key = ?
              AND upload.state = ? AND upload.lease_until > ?
          ))`)
        .bind(
          sourceId, projectId, owner.ownerId, name, kind, role, authority, visibility, uri, r2Key,
          textContent, contentHash, readStatus, coverageState, JSON.stringify(metadata), now, now,
           projectId, owner.ownerId, project.revision, project.locks_revision,
           publicDemoMode ? 1 : 0, owner.ownerId, owner.ownerId, PUBLIC_DEMO_SOURCE_SLOT_LIMIT,
           r2Key ? 1 : 0, uploadCleanupId, r2Key, FILE_UPLOAD_IN_PROGRESS, now,
         ),
      env.DB.prepare(`UPDATE projects SET revision = revision + 1, status = 'draft',
        result_json = NULL, qa_json = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM runs AS active
            WHERE active.project_id = projects.id AND active.owner_id = projects.owner_id
              AND active.status IN ('running', 'unknown')
          )
          AND EXISTS (
            SELECT 1 FROM sources AS inserted
            WHERE inserted.id = ? AND inserted.project_id = projects.id AND inserted.owner_id = projects.owner_id
          )`)
        .bind(now, projectId, owner.ownerId, project.revision, project.locks_revision, sourceId),
    ];
    if (r2Key && uploadCleanupId) {
       statements.push(env.DB.prepare(`DELETE FROM pending_file_deletions
         WHERE id = ? AND owner_id = ? AND r2_key = ?
           AND state = ?
           AND EXISTS (
            SELECT 1 FROM sources WHERE id = ? AND project_id = ? AND owner_id = ? AND r2_key = ?
          )
          AND EXISTS (
            SELECT 1 FROM projects
            WHERE id = ? AND owner_id = ?
              AND revision = ? AND locks_revision = ? AND updated_at = ?
          )`)
         .bind(
           uploadCleanupId, owner.ownerId, r2Key, FILE_UPLOAD_IN_PROGRESS,
           sourceId, projectId, owner.ownerId, r2Key,
          projectId, owner.ownerId, project.revision + 1, project.locks_revision, now,
        ));
     }
     const writes = await env.DB.batch(statements);
     const cleanupWriteFailed = Boolean(r2Key && uploadCleanupId)
       && Number((writes[2]?.meta as { changes?: number } | undefined)?.changes ?? 0) !== 1;
     if (Number((writes[0].meta as { changes?: number }).changes ?? 0) !== 1
       || Number((writes[1].meta as { changes?: number }).changes ?? 0) !== 1
       || cleanupWriteFailed) {
       await env.DB.prepare('DELETE FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?')
         .bind(sourceId, projectId, owner.ownerId).run();
       if (r2Key && uploadCleanupId) {
         await finishPendingFileDeletion(uploadCleanupId, owner.ownerId, r2Key, { force: true });
       }
      if (publicDemoMode) {
        const usage = await env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM sources WHERE owner_id = ?) AS source_count,
          (SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?) AS pending_count`)
          .bind(owner.ownerId, owner.ownerId)
          .first<{ source_count: number; pending_count: number }>();
        if ((usage?.source_count ?? 0) + (usage?.pending_count ?? 0) >= PUBLIC_DEMO_SOURCE_SLOT_LIMIT) {
          return apiError('RATE_LIMITED', `The public demo keeps up to ${PUBLIC_DEMO_SOURCE_SLOT_LIMIT} occupied evidence slots per account.`, 429, 'sources');
        }
      }
      const changedRun = await getActiveProjectRun(projectId, owner.ownerId);
      if (changedRun) return activeRunMutationError(changedRun, 'add sources to');
      return apiError('RUN_SUPERSEDED', 'The work order changed before the source could be attached. Reload it and try again.', 409, 'sources');
   }
  } catch (error) {
    if (r2Key && uploadCleanupId) {
      await finishPendingFileDeletion(uploadCleanupId, owner.ownerId, r2Key, { force: true });
    }
    if (String(error).toLowerCase().includes('unique')) {
      return apiError('INVALID_INPUT', 'That exact source is already attached to this project.', 409, 'sources');
    }
    throw error;
  }
  const source = await env.DB.prepare('SELECT * FROM sources WHERE id = ? AND owner_id = ?')
    .bind(sourceId, owner.ownerId).first();
  return NextResponse.json({ ok: true, source: sourceDto(source as never) }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id: projectId } = await context.params;
  const project = await getOwnedProject(projectId, owner.ownerId);
  if (!project) return apiError('NOT_FOUND', 'Project not found.', 404);
  const activeRun = await getActiveProjectRun(projectId, owner.ownerId);
  if (activeRun) return activeRunMutationError(activeRun, 'change sources in');

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'The source update was not valid JSON.', 400, 'sources');
  }
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
  const requestedRole = requiredRole(body.role);
  if (!sourceId || !requestedRole) {
    return apiError('INVALID_INPUT', 'A source ID and explicit source role are required.', 400, 'sources');
  }
  const role: string = requestedRole;
  const current = await env.DB.prepare(`SELECT * FROM sources
    WHERE id = ? AND project_id = ? AND owner_id = ? LIMIT 1`)
    .bind(sourceId, projectId, owner.ownerId)
    .first<Record<string, unknown>>();
  if (!current) return apiError('NOT_FOUND', 'Source not found.', 404, 'sources');
  if (current.role === role && current.authority === authorityForRole(role)) {
    return NextResponse.json({ ok: true, source: sourceDto(current as never), unchanged: true });
  }

  const now = nowIso();
  const writes = await env.DB.batch([
    env.DB.prepare(`UPDATE sources SET role = ?, authority = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_id = ?
        AND EXISTS (
          SELECT 1 FROM projects AS current
          WHERE current.id = ? AND current.owner_id = ?
            AND current.revision = ? AND current.locks_revision = ?
            AND NOT EXISTS (
              SELECT 1 FROM runs AS active
              WHERE active.project_id = current.id AND active.owner_id = current.owner_id
                AND active.status IN ('running', 'unknown')
            )
        )`)
      .bind(
        role, authorityForRole(role), now, sourceId, projectId, owner.ownerId,
        projectId, owner.ownerId, project.revision, project.locks_revision,
      ),
    env.DB.prepare(`UPDATE projects SET revision = revision + 1, status = 'draft',
      result_json = NULL, qa_json = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
        AND NOT EXISTS (
          SELECT 1 FROM runs AS active
          WHERE active.project_id = projects.id AND active.owner_id = projects.owner_id
            AND active.status IN ('running', 'unknown')
        )`)
      .bind(now, projectId, owner.ownerId, project.revision, project.locks_revision),
  ]);
  if (Number((writes[0].meta as { changes?: number }).changes ?? 0) !== 1
    || Number((writes[1].meta as { changes?: number }).changes ?? 0) !== 1) {
    const changedRun = await getActiveProjectRun(projectId, owner.ownerId);
    if (changedRun) return activeRunMutationError(changedRun, 'change sources in');
    return apiError('RUN_SUPERSEDED', 'The source changed before its role could be updated.', 409, 'sources');
  }
  const updated = await env.DB.prepare('SELECT * FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?')
    .bind(sourceId, projectId, owner.ownerId).first();
  return NextResponse.json({ ok: true, source: sourceDto(updated as never) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id: projectId } = await context.params;
  const project = await getOwnedProject(projectId, owner.ownerId);
  if (!project) return apiError('NOT_FOUND', 'Project not found.', 404);
  const activeRun = await getActiveProjectRun(projectId, owner.ownerId);
  if (activeRun) return activeRunMutationError(activeRun, 'remove sources from');

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'The source removal was not valid JSON.', 400, 'sources');
  }
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
  if (!sourceId) return apiError('INVALID_INPUT', 'A source ID is required.', 400, 'sources');
  const current = await env.DB.prepare(`SELECT id, r2_key FROM sources
    WHERE id = ? AND project_id = ? AND owner_id = ? LIMIT 1`)
    .bind(sourceId, projectId, owner.ownerId)
    .first<{ id: string; r2_key: string | null }>();
  if (!current) return apiError('NOT_FOUND', 'Source not found.', 404, 'sources');

  const now = nowIso();
  const deletionId = current.r2_key ? crypto.randomUUID() : null;
  const deleteSource = env.DB.prepare(`DELETE FROM sources
    WHERE id = ? AND project_id = ? AND owner_id = ?
      AND (
        r2_key IS NULL
        OR EXISTS (
          SELECT 1 FROM pending_file_deletions AS pending
          WHERE pending.owner_id = sources.owner_id AND pending.r2_key = sources.r2_key
            AND pending.state IN (?, ?)
        )
      )
      AND EXISTS (
        SELECT 1 FROM projects AS owning_project
        WHERE owning_project.id = ? AND owning_project.owner_id = ?
          AND owning_project.revision = ? AND owning_project.locks_revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM runs AS active
            WHERE active.project_id = owning_project.id AND active.owner_id = owning_project.owner_id
              AND active.status IN ('running', 'unknown')
          )
      )`)
    .bind(
      sourceId, projectId, owner.ownerId,
      FILE_DELETE_READY, FILE_DELETE_IN_PROGRESS,
      projectId, owner.ownerId, project.revision, project.locks_revision,
    );
  const updateProject = env.DB.prepare(`UPDATE projects SET revision = revision + 1, status = 'draft',
    result_json = NULL, qa_json = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
      AND NOT EXISTS (
        SELECT 1 FROM runs AS active
        WHERE active.project_id = projects.id AND active.owner_id = projects.owner_id
          AND active.status IN ('running', 'unknown')
      )
      AND NOT EXISTS (
        SELECT 1 FROM sources AS remaining
        WHERE remaining.id = ? AND remaining.project_id = projects.id
          AND remaining.owner_id = projects.owner_id
      )`)
    .bind(
      now, projectId, owner.ownerId, project.revision, project.locks_revision,
      sourceId,
    );
  const writes = current.r2_key && deletionId
    ? await env.DB.batch([
       env.DB.prepare(`INSERT OR IGNORE INTO pending_file_deletions
          (id, owner_id, r2_key, state, lease_until, attempts, last_error, created_at, updated_at)
          SELECT ?, ?, ?, ?, NULL, 0, NULL, ?, ? FROM sources
          WHERE id = ? AND project_id = ? AND owner_id = ? AND r2_key = ?
            AND EXISTS (
              SELECT 1 FROM projects AS owning_project
              WHERE owning_project.id = ? AND owning_project.owner_id = ?
                AND owning_project.revision = ? AND owning_project.locks_revision = ?
                AND NOT EXISTS (
                  SELECT 1 FROM runs AS active
                  WHERE active.project_id = owning_project.id AND active.owner_id = owning_project.owner_id
                    AND active.status IN ('running', 'unknown')
                )
            )`)
          .bind(
            deletionId, owner.ownerId, current.r2_key, FILE_DELETE_READY, now, now,
            sourceId, projectId, owner.ownerId, current.r2_key,
            projectId, owner.ownerId, project.revision, project.locks_revision,
          ),
        deleteSource,
        updateProject,
      ])
    : await env.DB.batch([deleteSource, updateProject]);
  const sourceWrite = writes[current.r2_key ? 1 : 0];
  const projectWrite = writes[current.r2_key ? 2 : 1];
  if (Number((sourceWrite.meta as { changes?: number }).changes ?? 0) !== 1
    || Number((projectWrite.meta as { changes?: number }).changes ?? 0) !== 1) {
    if (deletionId && current.r2_key) {
      await finishPendingFileDeletion(deletionId, owner.ownerId, current.r2_key, { force: true });
    }
    const changedRun = await getActiveProjectRun(projectId, owner.ownerId);
    if (changedRun) return activeRunMutationError(changedRun, 'remove sources from');
    return apiError('RUN_SUPERSEDED', 'The source or work order changed before it could be removed.', 409, 'sources');
  }
  const cleanupPending = current.r2_key && deletionId
    ? !await finishPendingFileDeletion(deletionId, owner.ownerId, current.r2_key, { force: true })
    : false;
  return NextResponse.json({ ok: true, deletedSourceId: sourceId, cleanupPending });
}

function authorityForRole(role: string) {
  if (role === 'canon') return 'creator_source';
  if (role === 'reference') return 'approved_reference';
  return 'supporting_evidence';
}

function supportedImageMimeType(file: File) {
  const declared = file.type.trim().toLowerCase();
  if (IMAGE_TYPES.has(declared)) return declared;
  if (declared) return null;
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  if (/\.gif$/i.test(file.name)) return 'image/gif';
  return null;
}

function cleanEnum(value: FormDataEntryValue | unknown, allowed: string[], fallback: string): string | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(normalized) ? normalized : null;
}

function requiredRole(value: FormDataEntryValue | unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SOURCE_ROLES.includes(normalized as (typeof SOURCE_ROLES)[number]) ? normalized : null;
}

async function hashBytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function activeRunMutationError(run: {
  id: string;
  status: 'running' | 'unknown';
  upstream_client_request_id: string | null;
}, action: string) {
  return apiError(
    'RUN_SUPERSEDED',
    run.status === 'unknown'
      ? `Reconcile the uncertain paid run before you ${action} this work order. No model call was made.`
      : `Resume or wait for the active paid run before you ${action} this work order. No model call was made.`,
    409,
    'sources',
    run.status === 'running',
    run.id,
    { traceId: run.upstream_client_request_id ?? run.id },
  );
}
