import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerContext } from '@/lib/server/auth';
import { verifyForgeAnchor } from '@/lib/server/forge-anchor';
import { apiError, nowIso } from '@/lib/server/http';
import { deleteStoredResponse, type ResponseDeletionReceipt } from '@/lib/server/provider-responses';
import { getOwnedProject } from '@/lib/server/projects';

type Context = { params: Promise<{ id: string; runId: string }> };
const ABANDONMENT_CLEANUP_SQL = `UPDATE runs SET context_receipt_json = json_set(
    CASE WHEN json_valid(context_receipt_json) THEN context_receipt_json ELSE '{}' END,
    '$.processing.abandonmentCleanup', json(?)
  )
  WHERE id = ? AND project_id = ? AND owner_id = ? AND status = ?
    AND upstream_response_id = ?`;

export async function DELETE(request: NextRequest, context: Context) {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'This Forge is owner-only.', 401, 'authentication');
  const { id: projectId, runId } = await context.params;
  if (!await getOwnedProject(projectId, owner.ownerId)) return apiError('NOT_FOUND', 'Project not found.', 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError('INVALID_INPUT', 'The reconciliation confirmation was not valid JSON.', 400, 'model_reconciliation');
  }
  const run = await env.DB.prepare(`SELECT id, status, upstream_client_request_id, upstream_response_id,
      forge_revision_id, context_receipt_json FROM runs
    WHERE id = ? AND project_id = ? AND owner_id = ? LIMIT 1`)
    .bind(runId, projectId, owner.ownerId)
    .first<{
      id: string;
      status: string;
      upstream_client_request_id: string | null;
      upstream_response_id: string | null;
      forge_revision_id: string;
      context_receipt_json: string | null;
    }>();
  if (!run) return apiError('NOT_FOUND', 'Run not found.', 404, 'model_reconciliation');
  const traceId = run.upstream_client_request_id || run.id;
  const abandoningUnknown = run.status === 'unknown';
  let abandoningStaleActive = false;
  if (run.status === 'running') {
    const anchor = await verifyForgeAnchor();
    abandoningStaleActive = anchor.status === 'verified' && run.forge_revision_id !== anchor.revisionId;
  }
  if (!abandoningUnknown && !abandoningStaleActive) {
    return apiError('INVALID_INPUT', 'Only an uncertain run or an active run pinned to an older verified Forge can be deliberately abandoned.', 409, 'model_reconciliation');
  }
  const expectedAction = abandoningUnknown ? 'ABANDON_UNCERTAIN_RUN' : 'ABANDON_STALE_ACTIVE_RUN';
  if (body.confirmTrace !== traceId || body.confirmAction !== expectedAction) {
    return apiError('INVALID_INPUT', 'Exact trace confirmation is required. No run state changed.', 409, 'model_reconciliation');
  }

  if (!run.upstream_response_id) {
    return apiError(
      'UPSTREAM_STATE_UNKNOWN',
      'This uncertain run has no durable provider recovery handle, so abandonment cannot safely prove that stored provider data was removed. Retry reconciliation with the same run key or resolve the provider trace before starting another paid request.',
      409,
      'model_reconciliation',
      false,
      runId,
      { preserveIdempotencyKey: true, traceId },
    );
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return apiError(
      'ENGINE_NOT_CONFIGURED',
      'Provider cleanup must be confirmed before this run can be abandoned, but the server has no OpenAI API key configured. No run state changed.',
      409,
      'model_reconciliation',
    );
  }
  const deletion = await deleteStoredResponse(apiKey, run.upstream_response_id);
  const cleanupReceipt = {
    schemaVersion: 'provider_abandonment_cleanup_v1',
    recordedAt: nowIso(),
    providerTerminalStatus: 'owner_abandon_requested',
    deletion,
  };
  const cleanupWrite = await env.DB.prepare(ABANDONMENT_CLEANUP_SQL)
    .bind(JSON.stringify(cleanupReceipt), runId, projectId, owner.ownerId, run.status, run.upstream_response_id)
    .run();
  if (Number((cleanupWrite.meta as { changes?: number }).changes ?? 0) !== 1) {
    return apiError('RUN_SUPERSEDED', 'The run changed while its provider-cleanup receipt was being recorded.', 409, 'model_reconciliation');
  }
  if (!(deletion as ResponseDeletionReceipt).providerConfirmedDeleted) {
    return apiError(
      'UPSTREAM_STATE_UNKNOWN',
      `The provider did not yet confirm deletion (${deletion.status}). The cleanup receipt was saved and the run remains pinned; retry this same reconciliation instead of starting another paid request.`,
      409,
      'model_reconciliation',
      true,
      runId,
      { preserveIdempotencyKey: true, traceId },
    );
  }

  const update = await env.DB.prepare(`UPDATE runs SET status = 'abandoned',
    error_code = 'UPSTREAM_STATE_UNKNOWN',
    error_message = ?,
    completed_at = ?
    WHERE id = ? AND project_id = ? AND owner_id = ? AND status = ?`)
    .bind(
      abandoningUnknown
        ? 'Owner explicitly abandoned this uncertain provider state after the provider confirmed that its stored response was deleted or absent. A later retry may still incur another charge.'
        : 'Owner explicitly abandoned a paid run pinned to an older Forge after the provider confirmed that its stored response was deleted or absent. The earlier provider request may still have incurred a charge.',
      nowIso(), runId, projectId, owner.ownerId, run.status,
    ).run();
  if (Number((update.meta as { changes?: number }).changes ?? 0) !== 1) {
    return apiError('RUN_SUPERSEDED', 'The run changed while reconciliation was being confirmed.', 409, 'model_reconciliation');
  }
  return NextResponse.json({ ok: true, abandonedRunId: runId, traceId, deletion });
}
