import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getOwnerContext, isPublicDemoMode } from '@/lib/server/auth';
import { verifyForgeAnchor } from '@/lib/server/forge-anchor';
import { apiError } from '@/lib/server/http';
import { drainPendingFileDeletions } from '@/lib/server/file-deletions';
import { listOwnedProjectSummaries, projectSummaryDto } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const demoMode = isPublicDemoMode();

  const [anchor, projectPage] = await Promise.all([
    verifyForgeAnchor(),
    listOwnedProjectSummaries(owner.ownerId),
    drainPendingFileDeletions(owner.ownerId).catch((error) => {
      console.error('Deferred file cleanup retry failed', error);
      return { attempted: 0, cleaned: 0 };
    }),
  ]);

  return NextResponse.json({
    ok: true,
    owner: { displayName: owner.displayName, email: owner.email, local: owner.local },
    forge: anchor,
    engine: {
      configured: !demoMode && Boolean(env.OPENAI_API_KEY?.trim()),
      demoMode,
      paidExecutionDisabled: demoMode,
      model: env.OPENAI_MODEL?.trim() || 'gpt-5.6',
      researchDefault: false,
      externalProcessing: demoMode
        ? 'Paid external processing is disabled in this public demonstration. The completed example is deterministic, uses zero API tokens, and makes no provider request.'
        : 'A paid Quampute run sends the concept, creator locks and answers, source names/roles/hashes, readable source excerpts, and eligible attached image pixels, plus the 607-question index and selected Forge excerpts, to the OpenAI API. Source URLs are not forwarded. The Forge requests deletion of each terminal stored response and records every available provider outcome in the run ledger without inventing a retention-expiry date. If terminal finalization or result attachment loses a compare-and-swap race, its cleanup receipt is added to run context without replacing the winning output. Deliberate abandonment requires a durable provider handle and provider-confirmed deletion or absence before it commits. Background mode is not Zero Data Retention compatible. Web research is optional and separately billable.',
    },
    projects: projectPage.projects.map(projectSummaryDto),
    projectsCursor: projectPage.nextCursor,
  });
}
