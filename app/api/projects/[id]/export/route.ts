import { NextRequest } from 'next/server';
import { getOwnerContext } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { getOwnedProject, listOwnedSourceSummaries, projectDto, sourceDto } from '@/lib/server/projects';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id } = await context.params;
  const project = await getOwnedProject(id, owner.ownerId);
  if (!project) return apiError('NOT_FOUND', 'Project not found.', 404);
  const sources = await listOwnedSourceSummaries(id, owner.ownerId);
  const format = request.nextUrl.searchParams.get('format') === 'markdown' ? 'markdown' : 'json';
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'moth-forge';

  const bundle = {
    exportSchemaVersion: 'moth_forge_project_v1',
    packageKind: 'review_manifest_not_source_backup',
    sourceContentIncluded: false,
    exportedAt: new Date().toISOString(),
    verificationStatus: 'exported_not_installed_or_runtime_tested',
    project: projectDto(project),
    sourceManifest: sources.map(sourceDto),
  };

  if (format === 'markdown') {
    return new Response(toMarkdown(bundle), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + slug + '-pre-quampute.md"',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + slug + '-pre-quampute.json"',
      'Cache-Control': 'no-store',
    },
  });
}

function toMarkdown(bundle: {
  exportedAt: string;
  verificationStatus: string;
  project: ReturnType<typeof projectDto>;
  sourceManifest: ReturnType<typeof sourceDto>[];
}) {
  const project = bundle.project;
  const result = project.result as Record<string, unknown> | null;
  const resolutions = Array.isArray(result?.resolutions) ? result.resolutions as Array<Record<string, unknown>> : [];
  const questions = Array.isArray(result?.questions) ? result.questions as Array<Record<string, unknown>> : [];
  const locks = Array.isArray(project.locks) ? project.locks : [];
  return [
    '# ' + project.title,
    '',
    '> MOTH FORGE pre-Quampute export · ' + bundle.exportedAt,
    '> Status: ' + bundle.verificationStatus,
    '> Source content included: no — this is a review manifest, not a backup of pasted text or uploaded files.',
    '',
    '## Concept kernel',
    '',
    project.concept,
    '',
    '## Build',
    '',
    '- Shape: ' + project.buildType,
    '- Forge revision: ' + project.forgeRevisionId,
    '- Project revision: ' + project.revision,
    '- Player boundary: ' + project.playerBoundary,
    '- Content boundary: ' + project.contentBoundary,
    '',
    '## Creator locks',
    '',
    ...(locks.length ? locks.map((lock) => '- ' + lock) : ['- None recorded.']),
    '',
    '## Sources',
    '',
    ...(bundle.sourceManifest.length
      ? bundle.sourceManifest.map((source) => '- **' + source.name + '** — ' + source.role + ', ' + source.readStatus + ', sha256 ' + source.contentHash)
      : ['- No project sources attached.']),
    '',
    '## Resolutions',
    '',
    ...(resolutions.length ? resolutions.map((resolution) => [
      '### [' + String(resolution.status) + '] ' + String(resolution.category),
      '',
      String(resolution.statement ?? ''),
      '',
      'Reason: ' + String(resolution.justification ?? ''),
      'Evidence: ' + (Array.isArray(resolution.evidenceRefs) ? resolution.evidenceRefs.join(', ') : 'none'),
      '',
    ].join('\n')) : ['No Quampute result has been run yet.', '']),
    '## Creator questions',
    '',
    ...(questions.length ? questions.map((question) => '- **' + String(question.factBeingDetermined) + ':** ' + String(question.meaning)) : ['- None in the current pass.']),
    '',
    '## QA receipt',
    '',
    '~~~json',
    JSON.stringify(project.qa ?? {}, null, 2),
    '~~~',
    '',
    'This package is exported for review. It is not proof of compilation, live installation, runtime testing, or release readiness.',
  ].join('\n');
}
