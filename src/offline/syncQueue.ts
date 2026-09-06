import { getAllOffline, putOffline, deleteOffline } from './db';

export type SyncAction =
  | 'jobs.insert'
  | 'jobs.update'
  | 'routes.update'
  | 'photos.insert'
  | 'reports.insert'
  | 'notes.insert'
  | 'audit_logs.insert'
  | 'generic';

export type SyncQueueItem = {
  id: string;
  action: SyncAction;
  table?: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

export async function enqueueSync(action: SyncAction, payload: unknown, table?: string) {
  const item: SyncQueueItem = {
    id: crypto.randomUUID(),
    action,
    table,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await putOffline('syncQueue', item);
  return item;
}

export function getQueuedSyncItems() {
  return getAllOffline<SyncQueueItem>('syncQueue');
}

export function removeQueuedSyncItem(id: string) {
  return deleteOffline('syncQueue', id);
}

export function updateQueuedSyncItem(item: SyncQueueItem) {
  return putOffline('syncQueue', item);
}
