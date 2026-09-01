import { env } from 'cloudflare:workers';
import { ensureSchema } from '@/db/ensure-schema';
import { nowIso } from './http';

export const FILE_UPLOAD_IN_PROGRESS = 'uploading';
export const FILE_UPLOAD_TOMBSTONE = 'upload_tombstone';
export const FILE_DELETE_READY = 'delete_ready';
export const FILE_DELETE_IN_PROGRESS = 'deleting';
const UPLOAD_LEASE_MS = 60 * 60 * 1_000;
const CLEANUP_LEASE_MS = 5 * 60 * 1_000;
const FAILURE_RETRY_MS = 5 * 60 * 1_000;
const TOMBSTONE_RETRY_MS = 60 * 60 * 1_000;

export function pendingUploadLeaseUntil() {
  return new Date(Date.now() + UPLOAD_LEASE_MS).toISOString();
}

type FinishOptions = { force?: boolean };

export async function finishPendingFileDeletion(
  deletionId: string,
  ownerId: string,
  r2Key: string,
  options: FinishOptions = {},
) {
  await ensureSchema();
  const now = nowIso();
  const cleanupLeaseUntil = new Date(Date.now() + CLEANUP_LEASE_MS).toISOString();
  const claimToken = crypto.randomUUID();
  let targetId = deletionId;
  let claimedState = FILE_DELETE_IN_PROGRESS;
  let retainUploadTombstone = false;

  if (options.force) {
    await env.DB.prepare(`INSERT OR IGNORE INTO pending_file_deletions
      (id, owner_id, r2_key, state, lease_until, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?)`)
      .bind(deletionId, ownerId, r2Key, FILE_DELETE_READY, now, now).run();
    const target = await env.DB.prepare(`SELECT id FROM pending_file_deletions
      WHERE owner_id = ? AND r2_key = ? LIMIT 1`)
      .bind(ownerId, r2Key).first<{ id: string }>();
    if (!target) return false;
    targetId = target.id;
  }

  const claim = await env.DB.prepare(`UPDATE pending_file_deletions
      SET state = ?, lease_until = ?, claim_token = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND r2_key = ?
        AND (
          (state = ? AND (lease_until IS NULL OR lease_until <= ?))
          OR (state = ? AND (lease_until IS NULL OR lease_until <= ?))
          OR (? = 1 AND id = ? AND state IN (?, ?))
        )`)
    .bind(
      FILE_DELETE_IN_PROGRESS, cleanupLeaseUntil, claimToken, now,
      targetId, ownerId, r2Key,
      FILE_DELETE_READY, now,
      FILE_DELETE_IN_PROGRESS, now,
      options.force ? 1 : 0, deletionId, FILE_UPLOAD_IN_PROGRESS, FILE_UPLOAD_TOMBSTONE,
    ).run();
  if (Number((claim.meta as { changes?: number }).changes ?? 0) !== 1) {
    if (options.force) return false;
    // R2 resolves overlapping PUT/DELETE calls by the last operation to finish, and an
    // HTTP upload has no reliable wall-time fence. Keep expired uploads as durable
    // tombstones so a late PUT is still discoverable and can be deleted again later.
    const tombstoneClaim = await env.DB.prepare(`UPDATE pending_file_deletions
        SET state = ?, lease_until = ?, claim_token = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND r2_key = ?
          AND state IN (?, ?)
          AND (lease_until IS NULL OR lease_until <= ?)`)
      .bind(
        FILE_UPLOAD_TOMBSTONE, cleanupLeaseUntil, claimToken, now,
        targetId, ownerId, r2Key,
        FILE_UPLOAD_IN_PROGRESS, FILE_UPLOAD_TOMBSTONE, now,
      ).run();
    if (Number((tombstoneClaim.meta as { changes?: number }).changes ?? 0) !== 1) return false;
    claimedState = FILE_UPLOAD_TOMBSTONE;
    retainUploadTombstone = true;
  }

  try {
    const releasedForLiveSource = await env.DB.prepare(`DELETE FROM pending_file_deletions
      WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ? AND claim_token = ?
        AND EXISTS (
          SELECT 1 FROM sources WHERE owner_id = ? AND r2_key = ?
        )`)
      .bind(
        targetId, ownerId, r2Key, claimedState, claimToken,
        ownerId, r2Key,
      ).run();
    if (Number((releasedForLiveSource.meta as { changes?: number }).changes ?? 0) === 1) {
      return true;
    }

    const stillClaimed = await env.DB.prepare(`SELECT 1 AS present FROM pending_file_deletions
      WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ? AND claim_token = ? LIMIT 1`)
      .bind(targetId, ownerId, r2Key, claimedState, claimToken)
      .first<{ present: number }>();
    if (!stillClaimed) {
      const stillPending = await env.DB.prepare(`SELECT 1 AS present FROM pending_file_deletions
        WHERE owner_id = ? AND r2_key = ? LIMIT 1`)
        .bind(ownerId, r2Key).first<{ present: number }>();
      return !stillPending;
    }

    await env.FILES.delete(r2Key);
    if (retainUploadTombstone) {
      const tombstoneRetryUntil = new Date(Date.now() + TOMBSTONE_RETRY_MS).toISOString();
      const retained = await env.DB.prepare(`UPDATE pending_file_deletions
        SET lease_until = ?, claim_token = NULL, attempts = attempts + 1,
          last_error = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ? AND claim_token = ?`)
        .bind(
          tombstoneRetryUntil, nowIso(), targetId, ownerId, r2Key,
          FILE_UPLOAD_TOMBSTONE, claimToken,
        ).run();
      if (Number((retained.meta as { changes?: number }).changes ?? 0) === 1) return true;
      const stillPending = await env.DB.prepare(`SELECT 1 AS present FROM pending_file_deletions
        WHERE owner_id = ? AND r2_key = ? LIMIT 1`)
        .bind(ownerId, r2Key).first<{ present: number }>();
      return !stillPending;
    }
    const removed = await env.DB.prepare(`DELETE FROM pending_file_deletions
      WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ? AND claim_token = ?`)
      .bind(targetId, ownerId, r2Key, claimedState, claimToken).run();
    if (Number((removed.meta as { changes?: number }).changes ?? 0) === 1) return true;
    const stillPending = await env.DB.prepare(`SELECT 1 AS present FROM pending_file_deletions
      WHERE owner_id = ? AND r2_key = ? LIMIT 1`)
      .bind(ownerId, r2Key).first<{ present: number }>();
    return !stillPending;
  } catch (error) {
    const retryUntil = new Date(Date.now() + FAILURE_RETRY_MS).toISOString();
    await env.DB.prepare(`UPDATE pending_file_deletions
      SET state = ?, lease_until = ?, claim_token = NULL, attempts = attempts + 1,
        last_error = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND r2_key = ? AND state = ? AND claim_token = ?`)
      .bind(
        retainUploadTombstone ? FILE_UPLOAD_TOMBSTONE : FILE_DELETE_READY,
        retryUntil,
        error instanceof Error ? error.message.slice(0, 1_000) : 'R2 deletion failed',
        nowIso(), targetId, ownerId, r2Key, claimedState, claimToken,
      ).run();
    return false;
  }
}

export async function drainPendingFileDeletions(ownerId: string, limit = 100) {
  await ensureSchema();
  let remaining = Math.max(1, Math.min(limit, 100));
  let attempted = 0;
  let cleaned = 0;
  while (remaining > 0) {
    const now = nowIso();
    const batchSize = Math.min(remaining, 25);
    const pending = await env.DB.prepare(`SELECT id, r2_key FROM pending_file_deletions
      WHERE owner_id = ?
        AND (
          (state = ? AND (lease_until IS NULL OR lease_until <= ?))
          OR (state IN (?, ?, ?) AND (lease_until IS NULL OR lease_until <= ?))
        )
      ORDER BY
        CASE state
          WHEN ? THEN 0
          WHEN ? THEN 1
          WHEN ? THEN 2
          ELSE 3
        END,
        updated_at ASC,
        created_at ASC
      LIMIT ?`)
      .bind(
        ownerId,
        FILE_DELETE_READY, now,
        FILE_UPLOAD_IN_PROGRESS, FILE_UPLOAD_TOMBSTONE, FILE_DELETE_IN_PROGRESS, now,
        FILE_DELETE_READY, FILE_DELETE_IN_PROGRESS, FILE_UPLOAD_IN_PROGRESS,
        batchSize,
      )
      .all<{ id: string; r2_key: string }>();
    if (pending.results.length === 0) break;
    attempted += pending.results.length;
    remaining -= pending.results.length;
    for (const item of pending.results) {
      if (await finishPendingFileDeletion(item.id, ownerId, item.r2_key)) cleaned += 1;
    }
  }
  return { attempted, cleaned };
}
