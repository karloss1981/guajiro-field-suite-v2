export type AppNotificationKind = 'done' | 'notdone' | 'weather' | 'pending' | 'info';

export type AppNotificationRecord = {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  tag?: string;
  createdAt: string;
  read: boolean;
  target?: { tab?: string; sub?: string; hash?: string };
};

const NOTIFICATION_STORAGE_KEY = 'gfs_notification_center_v1';
const NOTIFICATION_EVENT = 'gfs:notifications-changed';
const MAX_NOTIFICATION_RECORDS = 100;
const TAG_DUPLICATE_COOLDOWN_MS = 10 * 60 * 1000;
const WEATHER_DUPLICATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function tone(frequency: number, start: number, duration: number, volume = 0.12) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

function emitNotificationChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT));
}

export function getAppNotifications(): AppNotificationRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAppNotifications(records: AppNotificationRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(records.slice(0, MAX_NOTIFICATION_RECORDS)));
  } catch {
    // Notification history is best-effort and must never block field work.
  }
  emitNotificationChange();
}

export function addAppNotification(input: Omit<AppNotificationRecord, 'id' | 'createdAt' | 'read'>) {
  const current = getAppNotifications();
  const now = Date.now();
  const duplicateWindow = input.kind === 'weather' ? WEATHER_DUPLICATE_COOLDOWN_MS : TAG_DUPLICATE_COOLDOWN_MS;
  const duplicate = current.find((record) =>
    input.tag && record.tag === input.tag && now - new Date(record.createdAt).getTime() < duplicateWindow,
  );
  if (duplicate) return duplicate;

  const record: AppNotificationRecord = {
    ...input,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date(now).toISOString(),
    read: false,
  };
  saveAppNotifications([record, ...current]);
  return record;
}

export function markAppNotificationRead(id: string) {
  saveAppNotifications(getAppNotifications().map((record) => record.id === id ? { ...record, read: true } : record));
}

export function markAllAppNotificationsRead() {
  saveAppNotifications(getAppNotifications().map((record) => ({ ...record, read: true })));
}

export function clearAppNotifications() {
  saveAppNotifications([]);
}

export function subscribeAppNotifications(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(NOTIFICATION_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(NOTIFICATION_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function playNotificationSound(kind: AppNotificationKind) {
  try {
    if (kind === 'done') {
      tone(660, 0, 0.14, 0.11);
      tone(880, 0.17, 0.18, 0.13);
      tone(1100, 0.38, 0.23, 0.14);
      return;
    }
    if (kind === 'notdone') {
      tone(420, 0, 0.2, 0.12);
      tone(300, 0.22, 0.32, 0.14);
      return;
    }
    if (kind === 'weather') {
      tone(880, 0, 0.15, 0.16);
      tone(620, 0.2, 0.18, 0.16);
      tone(880, 0.42, 0.15, 0.16);
      tone(620, 0.62, 0.25, 0.16);
      return;
    }
    if (kind === 'pending') {
      tone(520, 0, 0.16, 0.12);
      tone(520, 0.28, 0.16, 0.12);
      tone(740, 0.56, 0.22, 0.14);
      return;
    }
    tone(600, 0, 0.18, 0.1);
  } catch (error) {
    console.warn('Notification sound unavailable', error);
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showSystemNotification(options: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker?.ready.catch(() => null);
    if (registration) {
      await registration.showNotification(options.title, {
        body: options.body,
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction,
        icon: '/Lazy_Tech.png',
        badge: '/Lazy_Tech.png',
        vibrate: [180, 90, 180],
      } as NotificationOptions);
      return true;
    }
    new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      data: options.data,
      requireInteraction: options.requireInteraction,
      icon: '/Lazy_Tech.png',
    });
    return true;
  } catch (error) {
    console.warn('System notification unavailable', error);
    return false;
  }
}

export async function notifyWithSound(kind: AppNotificationKind, title: string, body: string, tag?: string, target?: AppNotificationRecord['target']) {
  const now = Date.now();
  const duplicateWindow = kind === 'weather' ? WEATHER_DUPLICATE_COOLDOWN_MS : TAG_DUPLICATE_COOLDOWN_MS;
  const recentDuplicate = getAppNotifications().find((record) =>
    tag && record.tag === tag && now - new Date(record.createdAt).getTime() < duplicateWindow,
  );
  if (recentDuplicate) return false;
  addAppNotification({ kind, title, body, tag, target });
  playNotificationSound(kind);
  return showSystemNotification({ title, body, tag, requireInteraction: kind === 'weather' || kind === 'pending' });
}
