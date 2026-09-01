import { nowIso } from '@/lib/server/http';

export type ResponseDeletionReceipt = {
  status: 'succeeded' | 'failed' | 'pending' | 'unknown';
  requested: boolean | null;
  requestedAt: string | null;
  providerHttpStatus: number | null;
  providerRequestId: string | null;
  providerConfirmedDeleted: boolean;
  message: string;
  providerRetentionExpiresAt: string | null;
};

const RESPONSE_DELETE_TIMEOUT_MS = 30_000;

export async function deleteStoredResponse(apiKey: string, responseId: string): Promise<ResponseDeletionReceipt> {
  const requestedAt = nowIso();
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(RESPONSE_DELETE_TIMEOUT_MS),
    });
  } catch {
    return unknownDeletionReceipt(
      'The provider deletion request did not return a response, so deletion and retention state are unknown.',
      requestedAt,
      true,
    );
  }

  const providerRequestId = response.headers.get('x-request-id');
  let body: Record<string, unknown> | null = null;
  try {
    const text = await response.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The HTTP response still establishes its status, but an unreadable body cannot confirm `deleted: true`.
  }

  const base = {
    requested: true,
    requestedAt,
    providerHttpStatus: response.status,
    providerRequestId,
    providerRetentionExpiresAt: null,
  };
  if (body?.deleted === true || response.status === 204 || response.status === 404) {
    return {
      ...base,
      status: 'succeeded',
      providerConfirmedDeleted: true,
      message: body?.deleted === true
        ? 'The provider response explicitly confirmed deletion.'
        : response.status === 404
          ? 'The provider confirmed that no stored response exists at this recovery handle.'
          : 'The provider returned HTTP 204 No Content for the deletion request.',
    };
  }
  if (response.status === 202
    || (response.ok && ['pending', 'queued', 'in_progress'].includes(String(body?.status ?? '')))) {
    return {
      ...base,
      status: 'pending',
      providerConfirmedDeleted: false,
      message: 'The provider accepted the deletion request but did not yet confirm deletion.',
    };
  }
  if (!response.ok) {
    const error = body?.error;
    const providerMessage = error && typeof error === 'object'
      && typeof (error as Record<string, unknown>).message === 'string'
      ? String((error as Record<string, unknown>).message)
      : typeof body?.message === 'string' ? body.message : '';
    return {
      ...base,
      status: 'failed',
      providerConfirmedDeleted: false,
      message: providerMessage || `The provider rejected the deletion request with HTTP ${response.status}.`,
    };
  }
  return {
    ...base,
    status: 'unknown',
    providerConfirmedDeleted: false,
    message: 'The provider returned a successful HTTP status without an explicit deletion confirmation.',
  };
}

export function unknownDeletionReceipt(
  message: string,
  requestedAt: string | null = null,
  requested = false,
): ResponseDeletionReceipt {
  return {
    status: 'unknown',
    requested,
    requestedAt,
    providerHttpStatus: null,
    providerRequestId: null,
    providerConfirmedDeleted: false,
    message,
    providerRetentionExpiresAt: null,
  };
}
