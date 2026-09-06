import { sb } from '../config/supabase';
import { enqueueSync } from '../offline/syncQueue';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'job_created'
  | 'job_updated'
  | 'job_completed'
  | 'job_not_completed'
  | 'job_reopened_by_technician'
  | 'photo_uploaded'
  | 'photo_requirement_override'
  | 'report_created'
  | 'route_imported'
  | 'route_optimized'
  | 'pin_updated'
  | string;

export type AuditLogInput = {
  action: AuditAction;
  entity: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
};

export type LocalAuditRecord = {
  id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  sync_status: 'pending' | 'synced';
  remote_error?: string | null;
};

const LOCAL_AUDIT_KEY = 'gfs_local_audit_v2';
const LOCAL_AUDIT_EVENT = 'gfs:audit-changed';
const MAX_LOCAL_AUDIT = 1000;

function emitAuditChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_AUDIT_EVENT));
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function readAuthContext() {
  if (typeof window === 'undefined') return null;
  const auth = safeJsonParse<any>(localStorage.getItem('gfs_auth'), null) || safeJsonParse<any>(sessionStorage.getItem('gfs_auth'), null);
  if (!auth) return null;
  const actorName = auth.user?.name || auth.tech?.name || auth.tech?.id || auth.accessRole || auth.role || 'unknown';
  return {
    region: auth.region || auth.tech?.region || null,
    actorRole: auth.accessRole || auth.role || null,
    actorName,
    authMode: auth.authMode || 'legacy',
    tech_id: auth.tech?.id || null,
    user_email: auth.user?.email || null,
  };
}

function enrichMetadata(metadata: Record<string, unknown> = {}) {
  const auth = readAuthContext();
  return {
    ...auth,
    ...metadata,
    app_version: 'v23.6',
    client_time: new Date().toISOString(),
  };
}

export function getLocalAuditLogs(): LocalAuditRecord[] {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse<LocalAuditRecord[]>(localStorage.getItem(LOCAL_AUDIT_KEY), []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveLocalAudit(record: LocalAuditRecord) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalAuditLogs().filter((item) => item.id !== record.id);
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify([record, ...existing].slice(0, MAX_LOCAL_AUDIT)));
  } catch {
    // Local audit is best-effort and must never interrupt field work.
  }
  emitAuditChange();
}

function updateLocalAudit(id: string, patch: Partial<LocalAuditRecord>) {
  if (typeof window === 'undefined') return;
  try {
    const next = getLocalAuditLogs().map((item) => item.id === id ? { ...item, ...patch } : item);
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(next));
  } catch {}
  emitAuditChange();
}

function markLocalAuditSynced(id: string) {
  updateLocalAudit(id, { sync_status: 'synced', remote_error: null });
}

export function subscribeLocalAudit(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LOCAL_AUDIT_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(LOCAL_AUDIT_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

async function insertRemoteAudit(payload: Omit<LocalAuditRecord, 'id' | 'sync_status' | 'remote_error'>) {
  return sb.from('audit_logs').insert(payload);
}

export async function createAuditLog(input: AuditLogInput) {
  const userResult = await sb.auth.getUser().catch(() => null);
  const localId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    user_id: userResult?.data?.user?.id ?? null,
    action: input.action,
    entity: input.entity,
    entity_id: input.entityId ? String(input.entityId) : null,
    metadata: enrichMetadata(input.metadata ?? {}),
    created_at: new Date().toISOString(),
  };

  saveLocalAudit({ id: localId, ...payload, sync_status: 'pending', remote_error: null });

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await enqueueSync('audit_logs.insert', payload, 'audit_logs');
    return { storedLocally: true, synced: false };
  }

  const { error } = await insertRemoteAudit(payload);
  if (error) {
    await enqueueSync('audit_logs.insert', payload, 'audit_logs');
    updateLocalAudit(localId, { remote_error: error.message || 'Remote insert failed' });
    console.warn('[Audit] Remote insert failed; retained locally and queued.', error.message);
    return { storedLocally: true, synced: false, error };
  }

  markLocalAuditSynced(localId);
  return { storedLocally: true, synced: true };
}

export async function syncPendingLocalAuditLogs(limit = 100) {
  const pending = getLocalAuditLogs().filter((item) => item.sync_status === 'pending').slice(0, limit);
  let synced = 0;
  let failed = 0;
  let lastError = '';

  for (const item of pending) {
    const payload = {
      user_id: item.user_id,
      action: item.action,
      entity: item.entity,
      entity_id: item.entity_id,
      metadata: item.metadata ?? {},
      created_at: item.created_at,
    };
    const { error } = await insertRemoteAudit(payload);
    if (error) {
      failed += 1;
      lastError = error.message || 'Remote insert failed';
      updateLocalAudit(item.id, { remote_error: lastError });
    } else {
      synced += 1;
      markLocalAuditSynced(item.id);
    }
  }

  return { attempted: pending.length, synced, failed, lastError };
}

export function exportAuditLogsCsv(logs: any[], filename = `gfs-audit-${new Date().toISOString().slice(0,10)}.csv`) {
  const headers = ['created_at', 'sync', 'action', 'entity', 'entity_id', 'actor', 'role', 'tech_id', 'region', 'job_id', 'summary'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = logs.map((log: any) => {
    const metadata = log.metadata || {};
    return [
      log.created_at,
      log.sync_status || 'remote',
      log.action,
      log.entity,
      log.entity_id,
      metadata.actorName,
      metadata.actorRole,
      metadata.tech_id,
      metadata.region,
      metadata.job_id,
      metadata.summary,
    ].map(escape).join(',');
  });
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
