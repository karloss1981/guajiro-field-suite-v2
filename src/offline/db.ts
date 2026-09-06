export type OfflineStoreName = 'syncQueue' | 'jobs' | 'photos' | 'reports' | 'notes' | 'auditLogs' | 'photoUploadQueue' | 'pendingCloseQueue';

const DB_NAME = 'guajiro-field-suite';
const DB_VERSION = 3;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of ['syncQueue', 'jobs', 'photos', 'reports', 'notes', 'auditLogs', 'photoUploadQueue', 'pendingCloseQueue'] as OfflineStoreName[]) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'syncQueue') store.createIndex('createdAt', 'createdAt');
          if (storeName === 'photoUploadQueue') {
            store.createIndex('createdAt', 'createdAt');
            store.createIndex('job_id', 'job_id');
            store.createIndex('route_id', 'route_id');
            store.createIndex('status', 'status');
          }
          if (storeName === 'pendingCloseQueue') {
            store.createIndex('createdAt', 'createdAt');
            store.createIndex('job_id', 'job_id');
            store.createIndex('route_id', 'route_id');
            store.createIndex('tech_id', 'tech_id');
            store.createIndex('status', 'status');
          }
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putOffline<T extends { id: string }>(storeName: OfflineStoreName, value: T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllOffline<T>(storeName: OfflineStoreName): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOffline(storeName: OfflineStoreName, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
