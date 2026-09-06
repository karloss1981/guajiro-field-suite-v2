import { sb } from '../config/supabase';
import { getQueuedSyncItems, removeQueuedSyncItem, updateQueuedSyncItem, type SyncQueueItem } from './syncQueue';

function getTableForAction(item: SyncQueueItem): string | null {
  if (item.table) return item.table;
  if (item.action.includes('.')) return item.action.split('.')[0];
  return null;
}

async function pushItem(item: SyncQueueItem) {
  const table = getTableForAction(item);
  if (!table) throw new Error('Missing table for sync item');

  if (item.action.endsWith('.update')) {
    const payload = item.payload as { id?: string; [key: string]: unknown };
    if (!payload.id) throw new Error('Update payload requires id');
    const { id, ...data } = payload;
    const { error } = await sb.from(table).update(data).eq('id', id);
    if (error) throw error;
    return;
  }

  const { error } = await sb.from(table).insert(item.payload as never);
  if (error) throw error;
}

export async function syncPendingRecords() {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  const items = await getQueuedSyncItems();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await pushItem(item);
      await removeQueuedSyncItem(item.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await updateQueuedSyncItem({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { synced, failed };
}

export function bootOfflineSync() {
  window.addEventListener('online', () => {
    void syncPendingRecords();
  });

  setInterval(() => {
    if (navigator.onLine) void syncPendingRecords();
  }, 60_000);
}
