type StoreName = 'not_done_pool' | 'not_done_pool_events' | 'rit_route_drafts';

type AnyRow = Record<string, any>;

const DB_NAME = 'gfs-local-operations';
const DB_VERSION = 1;
const FALLBACK_PREFIX = 'gfs_local_store_';

const MODE_KEY = 'gfs_rit_storage_mode';

export function markLocalRitMode() {
  try { localStorage.setItem(MODE_KEY, 'local'); } catch {}
}

export function markRemoteRitMode() {
  try { localStorage.setItem(MODE_KEY, 'remote'); } catch {}
}

export function getRitStorageMode(): 'local' | 'remote' {
  try { return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'remote'; } catch { return 'local'; }
}

function uuid() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function fallbackRead(store: StoreName): AnyRow[] {
  try { return JSON.parse(localStorage.getItem(`${FALLBACK_PREFIX}${store}`) || '[]'); } catch { return []; }
}

function fallbackWrite(store: StoreName, rows: AnyRow[]) {
  localStorage.setItem(`${FALLBACK_PREFIX}${store}`, JSON.stringify(rows));
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('not_done_pool')) {
        const store = db.createObjectStore('not_done_pool', { keyPath: 'id' });
        store.createIndex('region_job', ['region', 'job_id'], { unique: true });
        store.createIndex('region_status', ['region', 'current_status'], { unique: false });
      }
      if (!db.objectStoreNames.contains('not_done_pool_events')) {
        const store = db.createObjectStore('not_done_pool_events', { keyPath: 'id' });
        store.createIndex('pool_id', 'pool_id', { unique: false });
        store.createIndex('region_job', ['region', 'job_id'], { unique: false });
      }
      if (!db.objectStoreNames.contains('rit_route_drafts')) {
        const store = db.createObjectStore('rit_route_drafts', { keyPath: 'id' });
        store.createIndex('region', 'region', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function all(store: StoreName): Promise<AnyRow[]> {
  const db = await openDb();
  if (!db) return fallbackRead(store);
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve(fallbackRead(store));
  });
}

async function put(store: StoreName, row: AnyRow): Promise<AnyRow> {
  const value = { id: row.id || uuid(), ...row };
  const db = await openDb();
  if (!db) {
    const rows = fallbackRead(store);
    const index = rows.findIndex((item) => item.id === value.id);
    if (index >= 0) rows[index] = value; else rows.push(value);
    fallbackWrite(store, rows);
    return value;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

async function remove(store: StoreName, id: string) {
  const db = await openDb();
  if (!db) {
    fallbackWrite(store, fallbackRead(store).filter((row) => row.id !== id));
    return;
  }
  return new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function isMissingRelationError(error: any) {
  const message = String(error?.message || error?.details || error || '').toLowerCase();
  return error?.code === '42P01' || error?.code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find the table');
}

export async function localListPool(region: string, statuses?: string[]) {
  const rows = await all('not_done_pool');
  return rows
    .filter((row) => row.region === region && (!statuses?.length || statuses.includes(row.current_status)))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function localFindPool(region: string, jobId: string) {
  const rows = await all('not_done_pool');
  return rows.find((row) => row.region === region && String(row.job_id) === String(jobId)) || null;
}

export async function localUpsertPool(row: AnyRow) {
  const existing = await localFindPool(row.region, row.job_id);
  return put('not_done_pool', {
    ...(existing || {}),
    ...row,
    id: existing?.id || row.id || uuid(),
    created_at: existing?.created_at || row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  });
}

export async function localUpdatePool(id: string, patch: AnyRow) {
  const rows = await all('not_done_pool');
  const existing = rows.find((row) => row.id === id);
  if (!existing) return null;
  return put('not_done_pool', { ...existing, ...patch, id, updated_at: patch.updated_at || new Date().toISOString() });
}

export async function localAddPoolEvent(row: AnyRow) {
  return put('not_done_pool_events', { ...row, id: row.id || uuid(), created_at: row.created_at || new Date().toISOString() });
}

export async function localListDrafts(region: string) {
  const rows = await all('rit_route_drafts');
  return rows.filter((row) => row.region === region).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 30);
}

export async function localSaveDraft(row: AnyRow) {
  return put('rit_route_drafts', {
    ...row,
    id: row.id || uuid(),
    created_at: row.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function localUpdateDraft(id: string, patch: AnyRow) {
  const rows = await all('rit_route_drafts');
  const existing = rows.find((row) => row.id === id);
  if (!existing) return null;
  return put('rit_route_drafts', { ...existing, ...patch, id, updated_at: new Date().toISOString() });
}

export async function localDeleteDraft(id: string) {
  await remove('rit_route_drafts', id);
}

export async function exportLocalOperationsBackup() {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    not_done_pool: await all('not_done_pool'),
    not_done_pool_events: await all('not_done_pool_events'),
    rit_route_drafts: await all('rit_route_drafts'),
  };
}
