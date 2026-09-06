// @ts-nocheck
import { sb } from '../config/supabase';
import { createAuditLog } from '../services/audit.service';
import { deleteOffline, getAllOffline, putOffline } from './db';

export type PhotoQueueStatus = 'pending' | 'uploading' | 'synced' | 'failed';

export type PhotoUploadQueueItem = {
  id: string;
  route_id: string;
  tech_id: string;
  job_id: string;
  region?: string;
  photo_type: 'evidence' | 'pht' | 'before' | 'after' | 'other';
  file: File | Blob;
  filename: string;
  storage_path: string;
  content_type: string;
  createdAt: string;
  captured_at?: string;
  gps?: {
    latitude: number | null;
    longitude: number | null;
    accuracy_meters: number | null;
  };
  address?: string;
  city_line?: string;
  timestamp_source?: string;
  status: PhotoQueueStatus;
  attempts: number;
  lastError?: string;
  publicUrl?: string;
};

const EVENT_NAME = 'gfs-photo-queue-updated';
const BUCKET = 'job-photos';

function emitQueueUpdate() {
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME)); } catch {}
}

export function onPhotoQueueChange(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener('online', callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener('online', callback);
  };
}

export async function enqueuePhotoUpload(input: Omit<PhotoUploadQueueItem, 'id' | 'createdAt' | 'status' | 'attempts'>) {
  const item: PhotoUploadQueueItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  };
  await putOffline('photoUploadQueue', item);
  emitQueueUpdate();
  createAuditLog({
    action: 'photo_saved_offline',
    entity: 'job_photo',
    entityId: item.route_id,
    metadata: {
      tech_id: item.tech_id,
      job_id: item.job_id,
      photo_type: item.photo_type,
      filename: item.filename,
      region: item.region || '',
      summary: `Photo queued locally for job ${item.job_id}`,
    },
  }).catch(() => {});
  return item;
}

export async function getPhotoQueueItems() {
  const items = await getAllOffline<PhotoUploadQueueItem>('photoUploadQueue');
  return items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getPendingPhotoQueueItems() {
  const items = await getPhotoQueueItems();
  return items.filter((item) => item.status !== 'synced');
}

export async function getPhotoQueueForJob(job: { id?: string; job_id?: string }) {
  const routeId = String(job?.id || '');
  const jobId = String(job?.job_id || '');
  const items = await getPendingPhotoQueueItems();
  return items.filter((item) => String(item.route_id) === routeId || String(item.job_id) === jobId);
}

export async function getPhotoQueueSummaryForJob(job: { id?: string; job_id?: string }) {
  const items = await getPhotoQueueForJob(job);
  return {
    total: items.length,
    before: items.filter((item) => item.photo_type === 'evidence' || item.photo_type === 'before').length,
    after: items.filter((item) => item.photo_type === 'pht' || item.photo_type === 'after').length,
    uploading: items.filter((item) => item.status === 'uploading').length,
    failed: items.filter((item) => item.status === 'failed').length,
    pending: items.filter((item) => item.status === 'pending').length,
  };
}

async function markItem(item: PhotoUploadQueueItem, updates: Partial<PhotoUploadQueueItem>) {
  const next = { ...item, ...updates };
  await putOffline('photoUploadQueue', next);
  emitQueueUpdate();
  return next;
}

export async function syncOneQueuedPhoto(item: PhotoUploadQueueItem) {
  let current = await markItem(item, { status: 'uploading', lastError: '' });
  try {
    const file = current.file instanceof File
      ? current.file
      : new File([current.file], current.filename, { type: current.content_type || 'image/jpeg' });

    // FIX V25.3: race the upload against a 45s timeout. On weak field signal
    // the request can hang forever, leaving the item stuck in 'uploading'.
    const upload = await Promise.race([
      sb.storage.from(BUCKET).upload(current.storage_path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: current.content_type || file.type || 'image/jpeg',
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Upload timed out (weak signal) — will retry automatically.')), 45_000)),
    ]) as { error: any };
    if (upload.error) throw upload.error;

    const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(current.storage_path);
    const insert = await sb.from('job_photos').insert({
      route_id: current.route_id,
      tech_id: current.tech_id,
      job_id: current.job_id,
      photo_url: publicUrl,
      thumb_url: publicUrl,
      note: '',
      photo_type: current.photo_type,
    });
    if (insert.error) throw insert.error;

    createAuditLog({
      action: 'photo_upload_success',
      entity: 'job_photo',
      entityId: current.route_id,
      metadata: {
        tech_id: current.tech_id,
        job_id: current.job_id,
        photo_type: current.photo_type,
        filename: current.filename,
        storage_path: current.storage_path,
        region: current.region || '',
        captured_at: current.captured_at || '',
        latitude: current.gps?.latitude ?? null,
        longitude: current.gps?.longitude ?? null,
        accuracy_meters: current.gps?.accuracy_meters ?? null,
        summary: `Queued photo uploaded for job ${current.job_id}`,
      },
    }).catch(() => {});

    await deleteOffline('photoUploadQueue', current.id);
    emitQueueUpdate();
    return { ok: true, item: current };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : (error && typeof error === 'object'
          ? ((error as any).message || (error as any).error || (error as any).error_description || (error as any).statusText || (error as any).hint || JSON.stringify(error))
          : String(error));
    current = await markItem(current, {
      status: 'failed',
      attempts: (current.attempts || 0) + 1,
      lastError: message,
    });
    createAuditLog({
      action: 'photo_upload_failed',
      entity: 'job_photo',
      entityId: current.route_id,
      metadata: {
        tech_id: current.tech_id,
        job_id: current.job_id,
        photo_type: current.photo_type,
        attempts: current.attempts,
        error: message,
        region: current.region || '',
        summary: `Queued photo upload failed for job ${current.job_id}`,
      },
    }).catch(() => {});
    return { ok: false, item: current, error: message };
  }
}

let syncing = false;
let syncingStartedAt = 0;

export async function syncPhotoUploadQueue() {
  // Guard against a stuck syncing flag from a previous session (e.g. app
  // was closed mid-sync). If the flag has been true for more than 2 minutes,
  // force-reset it so new syncs can proceed.
  if (syncing) {
    if (syncingStartedAt && Date.now() - syncingStartedAt > 120_000) {
      console.warn('[photoUploadQueue] syncing flag stuck for >2min, force-resetting');
      syncing = false;
    } else {
      return { synced: 0, failed: 0, pending: 0 };
    }
  }
  if (!navigator.onLine) {
    const pending = await getPendingPhotoQueueItems();
    return { synced: 0, failed: 0, pending: pending.length };
  }

  syncing = true;
  syncingStartedAt = Date.now();
  emitQueueUpdate();
  let synced = 0;
  let failed = 0;
  try {
    // FIX V25.3: recover items stranded in 'uploading' by a previous hung
    // attempt or an app reload mid-upload — put them back to 'pending'.
    const stranded = (await getPendingPhotoQueueItems()).filter((item) => item.status === 'uploading');
    for (const item of stranded) await markItem(item, { status: 'pending' });
    const items = await getPendingPhotoQueueItems();
    // Bad signal mode: upload one photo at a time to avoid killing weak cellular connections.
    for (const item of items) {
      const result = await syncOneQueuedPhoto(item);
      if (result.ok) synced += 1;
      else failed += 1;
    }
    const pending = (await getPendingPhotoQueueItems()).length;
    return { synced, failed, pending };
  } finally {
    syncing = false;
    syncingStartedAt = 0;
    emitQueueUpdate();
  }
}

export function bootPhotoUploadQueueSync() {
  window.addEventListener('online', () => {
    setTimeout(() => { void syncPhotoUploadQueue(); }, 1500);
  });

  setInterval(() => {
    if (navigator.onLine) void syncPhotoUploadQueue();
  }, 45_000);
}
