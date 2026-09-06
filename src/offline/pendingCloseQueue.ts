// @ts-nocheck
import { createAuditLog } from '../services/audit.service';
import { deleteOffline, getAllOffline, putOffline } from './db';

export type PendingCloseAction = 'done' | 'notdone';
export type PendingCloseStatus = 'pending' | 'processing' | 'failed' | 'conflict';

export type PendingCloseQueueItem = {
  id: string;
  route_id: string;
  tech_id: string;
  job_id: string;
  region?: string;
  action: PendingCloseAction;
  pay_code?: string;
  pay_total?: number;
  reason?: string;
  job_note?: string;
  createdAt: string;
  status: PendingCloseStatus;
  attempts: number;
  lastError?: string;
  client_updated_at?: string;
  remote_updated_at?: string;
  conflict_detected_at?: string;
  conflict_reason?: string;
  remote_snapshot?: Record<string, unknown> | null;
};

const EVENT_NAME = 'gfs-pending-close-queue-updated';

function emitPendingCloseUpdate() {
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME)); } catch {}
}

export function onPendingCloseQueueChange(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener('online', callback);
  window.addEventListener('gfs-photo-queue-updated', callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener('online', callback);
    window.removeEventListener('gfs-photo-queue-updated', callback);
  };
}

export async function enqueuePendingClose(input: Omit<PendingCloseQueueItem, 'id' | 'createdAt' | 'status' | 'attempts'>) {
  const existing = (await getPendingCloseQueueItems()).find((item) =>
    String(item.route_id) === String(input.route_id) && String(item.tech_id) === String(input.tech_id)
  );
  const item: PendingCloseQueueItem = {
    ...(existing || {}),
    ...input,
    id: existing?.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    status: 'pending',
    attempts: existing?.attempts || 0,
    lastError: '',
  };
  await putOffline('pendingCloseQueue', item);
  emitPendingCloseUpdate();
  createAuditLog({
    action: 'job_close_queued_offline',
    entity: 'route',
    entityId: item.route_id,
    metadata: {
      tech_id: item.tech_id,
      job_id: item.job_id,
      result: item.action,
      pay_code: item.pay_code || '',
      reason: item.reason || '',
      region: item.region || '',
      summary: `Job close queued for job ${item.job_id}`,
    },
  }).catch(() => {});
  return item;
}

export async function getPendingCloseQueueItems() {
  const items = await getAllOffline<PendingCloseQueueItem>('pendingCloseQueue');
  return items
    .filter((item) => item.status !== 'synced')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getPendingCloseQueueForTech(techId: string) {
  const items = await getPendingCloseQueueItems();
  return items.filter((item) => String(item.tech_id) === String(techId));
}

export async function getPendingCloseQueueForJob(job: { id?: string; job_id?: string }) {
  const routeId = String(job?.id || '');
  const jobId = String(job?.job_id || '');
  const items = await getPendingCloseQueueItems();
  return items.filter((item) => String(item.route_id) === routeId || String(item.job_id) === jobId);
}

export async function deletePendingCloseQueueItem(id: string) {
  await deleteOffline('pendingCloseQueue', id);
  emitPendingCloseUpdate();
}

export async function markPendingCloseProcessing(item: PendingCloseQueueItem) {
  const next = { ...item, status: 'processing' as PendingCloseStatus, lastError: '' };
  await putOffline('pendingCloseQueue', next);
  emitPendingCloseUpdate();
  return next;
}

export async function markPendingCloseConflict(item: PendingCloseQueueItem, remoteSnapshot: Record<string, unknown> | null, reason = 'Remote route changed before queued close synced') {
  const next = {
    ...item,
    status: 'conflict' as PendingCloseStatus,
    remote_updated_at: remoteSnapshot?.updated_at ? String(remoteSnapshot.updated_at) : item.remote_updated_at || '',
    remote_snapshot: remoteSnapshot || null,
    conflict_detected_at: new Date().toISOString(),
    conflict_reason: reason,
    lastError: reason,
  };
  await putOffline('pendingCloseQueue', next);
  emitPendingCloseUpdate();
  createAuditLog({
    action: 'job_close_queue_conflict',
    entity: 'route',
    entityId: item.route_id,
    metadata: {
      tech_id: item.tech_id,
      job_id: item.job_id,
      result: item.action,
      client_updated_at: item.client_updated_at || '',
      remote_updated_at: next.remote_updated_at || '',
      region: item.region || '',
      summary: `Queued job close conflict detected for job ${item.job_id}`,
    },
  }).catch(() => {});
  return next;
}

export async function markPendingCloseFailed(item: PendingCloseQueueItem, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const next = {
    ...item,
    status: 'failed' as PendingCloseStatus,
    attempts: (item.attempts || 0) + 1,
    lastError: message,
  };
  await putOffline('pendingCloseQueue', next);
  emitPendingCloseUpdate();
  createAuditLog({
    action: 'job_close_queue_failed',
    entity: 'route',
    entityId: item.route_id,
    metadata: {
      tech_id: item.tech_id,
      job_id: item.job_id,
      result: item.action,
      attempts: next.attempts,
      error: message,
      region: item.region || '',
      summary: `Queued job close failed for job ${item.job_id}`,
    },
  }).catch(() => {});
  return next;
}
