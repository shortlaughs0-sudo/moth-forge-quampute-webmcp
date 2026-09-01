import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/db/ensure-schema';
import { getOwnerContext, isPublicDemoMode } from '@/lib/server/auth';
import { verifyForgeAnchor } from '@/lib/server/forge-anchor';
import { apiError, nowIso, titleFromConcept } from '@/lib/server/http';
import { listOwnedProjectSummaries, projectDto, projectSummaryDto } from '@/lib/server/projects';

const BUILD_TYPES = new Set(['character', 'scenario', 'cast', 'world', 'hybrid']);
const CONTENT_BOUNDARIES = new Set(['general', 'mature_18_plus', 'mixed_private']);
const PUBLIC_DEMO_PROJECT_LIMIT = 3;

export async function GET(request: NextRequest) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const cursor = parseProjectCursor(request.nextUrl.searchParams.get('cursor'));
  if (request.nextUrl.searchParams.has('cursor') && !cursor) {
    return apiError('INVALID_INPUT', 'The project-page cursor was invalid.', 400, 'projects');
  }
  const page = await listOwnedProjectSummaries(owner.ownerId, cursor);
  return NextResponse.json({
    ok: true,
    projects: page.projects.map(projectSummaryDto),
    nextCursor: page.nextCursor,
  });
}

function parseProjectCursor(value: string | null) {
  if (!value) return null;
  const separator = value.lastIndexOf('|');
  if (separator <= 0) return null;
  const updatedAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!updatedAt || !id || !Number.isFinite(Date.parse(updatedAt))) return null;
  return { updatedAt, id };
}

export async function POST(request: NextRequest) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const publicDemoMode = isPublicDemoMode();

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'The project request was not valid JSON.', 400);
  }

  const concept = typeof body.concept === 'string' ? body.concept.trim() : '';
  const buildType = typeof body.buildType === 'string' ? body.buildType.toLowerCase() : '';
  if (concept.length < 12 || concept.length > 18_000) {
    return apiError('INVALID_INPUT', 'Give the Forge a concept between 12 and 18,000 characters.', 400, 'spark');
  }
  if (!BUILD_TYPES.has(buildType)) {
    return apiError('INVALID_INPUT', 'Choose a supported build shape.', 400, 'spark');
  }

  const anchor = await verifyForgeAnchor();
  if (anchor.status !== 'verified') {
    return apiError('FORGE_PARTIAL', 'The complete Forge bundle did not pass integrity verification.', 409, 'anchor');
  }

  await ensureSchema();
  const id = crypto.randomUUID();
  const now = nowIso();
  let title = titleFromConcept(concept);
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
      return apiError('INVALID_INPUT', 'Title must be non-empty text no longer than 120 characters.', 400, 'spark');
    }
    title = body.title.trim();
  }
  let playerBoundary = 'Do not supply actions, inner states, speech, appearance, or permission on behalf of the participant.';
  if (body.playerBoundary !== undefined) {
    if (typeof body.playerBoundary !== 'string' || !body.playerBoundary.trim() || body.playerBoundary.trim().length > 500) {
      return apiError('INVALID_INPUT', 'Player boundary must be non-empty text no longer than 500 characters.', 400, 'locks');
    }
    playerBoundary = body.playerBoundary.trim();
  }
  let contentBoundary = 'general';
  if (body.contentBoundary !== undefined) {
    if (typeof body.contentBoundary !== 'string' || !CONTENT_BOUNDARIES.has(body.contentBoundary)) {
      return apiError('INVALID_INPUT', 'Choose a supported content boundary.', 400, 'locks');
    }
    contentBoundary = body.contentBoundary;
  }
  let locks: string[] = [];
  if (body.locks !== undefined) {
    if (!Array.isArray(body.locks) || body.locks.length > 80) {
      return apiError('INVALID_INPUT', 'Creator locks must be an array of at most 80 text values.', 400, 'locks');
    }
    for (const item of body.locks) {
      if (typeof item !== 'string' || item.length > 500 || !item.trim()) {
        return apiError('INVALID_INPUT', 'Each creator lock must be non-empty text no longer than 500 characters.', 400, 'locks');
      }
      locks.push(item.trim());
    }
    locks = [...new Set(locks)];
  }

  const insert = await env.DB.prepare(`INSERT INTO projects (
    id, owner_id, title, build_type, concept, status, revision, locks_revision,
    forge_document_id, forge_revision_id, forge_manifest_hash,
    player_boundary, content_boundary, authority_map_json, locks_json, answers_json,
    result_json, qa_json, research_enabled, research_cost_approved, created_at, updated_at
  ) SELECT ?, ?, ?, ?, ?, 'draft', 1, 1, ?, ?, ?, ?, ?, '[]', ?, '[]', NULL, NULL, 0, 0, ?, ?
    WHERE ? = 0 OR (
      SELECT COUNT(*) FROM projects WHERE owner_id = ?
    ) < ?`)
    .bind(
      id, owner.ownerId, title, buildType, concept,
      anchor.documentId, anchor.revisionId, anchor.manifestHash,
      playerBoundary, contentBoundary, JSON.stringify(locks), now, now,
      publicDemoMode ? 1 : 0, owner.ownerId, PUBLIC_DEMO_PROJECT_LIMIT,
    ).run();
  if (Number((insert.meta as { changes?: number }).changes ?? 0) !== 1) {
    return apiError(
      'RATE_LIMITED',
      `The public demo keeps up to ${PUBLIC_DEMO_PROJECT_LIMIT} private work orders per account. Reuse an existing work order for this demonstration.`,
      429,
      'projects',
    );
  }

  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
    .bind(id, owner.ownerId).first();
  return NextResponse.json({ ok: true, project: projectDto(project as never) }, { status: 201 });
}
