import { NextResponse } from 'next/server';

export type ForgeErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'PUBLIC_DEMO_RESTRICTED'
  | 'ENGINE_NOT_CONFIGURED'
  | 'COST_APPROVAL_REQUIRED'
  | 'FORGE_STALE'
  | 'FORGE_PARTIAL'
  | 'SOURCE_UNREADABLE'
  | 'SOURCE_CONFLICT'
  | 'RUN_SUPERSEDED'
  | 'OUTPUT_INVALID'
  | 'OUTPUT_INCOMPLETE'
  | 'UPSTREAM_STATE_UNKNOWN'
  | 'UPSTREAM_FAILED';

export function apiError(
  code: ForgeErrorCode,
  message: string,
  status: number,
  stage = 'request',
  retryable = false,
  runId?: string,
  details?: { preserveIdempotencyKey?: boolean; traceId?: string },
) {
  return NextResponse.json(
    { ok: false, error: { code, message, stage, retryable, ...(runId ? { runId } : {}), ...details } },
    { status },
  );
}

export async function hashText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function titleFromConcept(concept: string) {
  const firstLine = concept.trim().split(/\n|(?<=[.!?])\s/)[0] ?? 'Untitled Forge';
  const concise = firstLine.replace(/\s+/g, ' ').trim();
  return concise.length > 72 ? `${concise.slice(0, 69).trimEnd()}…` : concise;
}
