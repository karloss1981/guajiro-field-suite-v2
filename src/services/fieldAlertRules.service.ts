// @ts-nocheck
import { createAuditLog } from './audit.service';
import { notifyWithSound, requestNotificationPermission, playNotificationSound } from './notification.service';

export type FieldAlertSettings = {
  closeoutHour: number;
  closeoutMinute: number;
  repeatMinutes: number;
  snoozeMinutes: number;
  leftJobMinutes: number;
  adminEnabled: boolean;
  supervisorEnabled: boolean;
  technicianEnabled: boolean;
  completedSound: boolean;
  notDoneSound: boolean;
  pendingSound: boolean;
};

export const DEFAULT_FIELD_ALERT_SETTINGS: FieldAlertSettings = {
  closeoutHour: 19,
  closeoutMinute: 0,
  repeatMinutes: 15,
  snoozeMinutes: 15,
  leftJobMinutes: 15,
  adminEnabled: true,
  supervisorEnabled: true,
  technicianEnabled: true,
  completedSound: true,
  notDoneSound: true,
  pendingSound: true,
};

const SETTINGS_KEY = 'gfs_field_alert_settings_v232';
const STATE_PREFIX = 'gfs_field_alert_state_v232';

function clampNumber(value: any, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function getFieldAlertSettings(): FieldAlertSettings {
  if (typeof window === 'undefined') return DEFAULT_FIELD_ALERT_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return normalizeFieldAlertSettings({ ...DEFAULT_FIELD_ALERT_SETTINGS, ...(parsed || {}) });
  } catch {
    return DEFAULT_FIELD_ALERT_SETTINGS;
  }
}

export function normalizeFieldAlertSettings(input: Partial<FieldAlertSettings>): FieldAlertSettings {
  return {
    closeoutHour: clampNumber(input.closeoutHour, 0, 23, DEFAULT_FIELD_ALERT_SETTINGS.closeoutHour),
    closeoutMinute: clampNumber(input.closeoutMinute, 0, 59, DEFAULT_FIELD_ALERT_SETTINGS.closeoutMinute),
    repeatMinutes: clampNumber(input.repeatMinutes, 5, 120, DEFAULT_FIELD_ALERT_SETTINGS.repeatMinutes),
    snoozeMinutes: clampNumber(input.snoozeMinutes, 5, 120, DEFAULT_FIELD_ALERT_SETTINGS.snoozeMinutes),
    leftJobMinutes: clampNumber(input.leftJobMinutes, 5, 120, DEFAULT_FIELD_ALERT_SETTINGS.leftJobMinutes),
    adminEnabled: input.adminEnabled !== false,
    supervisorEnabled: input.supervisorEnabled !== false,
    technicianEnabled: input.technicianEnabled !== false,
    completedSound: input.completedSound !== false,
    notDoneSound: input.notDoneSound !== false,
    pendingSound: input.pendingSound !== false,
  };
}

export function saveFieldAlertSettings(input: Partial<FieldAlertSettings>) {
  const next = normalizeFieldAlertSettings({ ...getFieldAlertSettings(), ...(input || {}) });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('gfs-field-alert-settings-changed'));
  } catch {}
  return next;
}

export function subscribeFieldAlertSettings(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('gfs-field-alert-settings-changed', listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('gfs-field-alert-settings-changed', listener);
    window.removeEventListener('storage', listener);
  };
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

function stateKey(scope: string, region: string, date = todayKey()) {
  return `${STATE_PREFIX}_${scope}_${region}_${date}`;
}

export function getFieldAlertState(scope: string, region: string, date = todayKey()) {
  try { return JSON.parse(localStorage.getItem(stateKey(scope, region, date)) || '{}') || {}; }
  catch { return {}; }
}

export function saveFieldAlertState(scope: string, region: string, patch: Record<string, any>, date = todayKey()) {
  const current = getFieldAlertState(scope, region, date);
  const next = { ...current, ...patch };
  try { localStorage.setItem(stateKey(scope, region, date), JSON.stringify(next)); }
  catch {}
  return next;
}

export function getCloseoutStartTime(date = todayKey(), settings = getFieldAlertSettings()) {
  const [y, m, d] = String(date).split('-').map(Number);
  const when = new Date(y, (m || 1) - 1, d || new Date().getDate(), settings.closeoutHour, settings.closeoutMinute, 0, 0);
  return when.getTime();
}

export function formatCloseoutTime(settings = getFieldAlertSettings()) {
  const hour = String(settings.closeoutHour).padStart(2, '0');
  const minute = String(settings.closeoutMinute).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function shouldRunCloseoutAlert({ scope, region, date, pendingCount, settings = getFieldAlertSettings() }: any) {
  if (!pendingCount) return { due: false, reason: 'no_pending' };
  if (scope === 'admin' && !settings.adminEnabled) return { due: false, reason: 'admin_disabled' };
  if (scope === 'supervisor' && !settings.supervisorEnabled) return { due: false, reason: 'supervisor_disabled' };
  const now = Date.now();
  if (now < getCloseoutStartTime(date, settings)) return { due: false, reason: 'before_closeout' };
  const state = getFieldAlertState(scope, region, date);
  if (now < Number(state.snoozedUntil || 0)) return { due: false, reason: 'snoozed' };
  if (now - Number(state.lastAlertAt || 0) < settings.repeatMinutes * 60_000) return { due: false, reason: 'cooldown' };
  return { due: true, reason: 'due' };
}

export async function sendCloseoutAlert({ scope = 'supervisor', region = 'miami', date = todayKey(), pendingJobs = [], grouped = [], lang = 'en', manual = false }: any) {
  const es = lang === 'es';
  const settings = getFieldAlertSettings();
  if (!manual) {
    const due = shouldRunCloseoutAlert({ scope, region, date, pendingCount: pendingJobs.length, settings });
    if (!due.due) return { sent: false, reason: due.reason };
  }
  const title = scope === 'admin'
    ? (es ? 'Resumen de cierre pendiente' : 'Pending closeout summary')
    : (es ? 'Alerta de trabajos pendientes' : 'Pending jobs alert');
  const body = grouped.length
    ? grouped.slice(0, 8).map((g: any) => `#${g.techId}: ${g.jobs.length}`).join(' · ')
    : `${pendingJobs.length} ${es ? 'trabajos pendientes' : 'pending jobs'}`;
  saveFieldAlertState(scope, region, { lastAlertAt: Date.now(), lastPendingCount: pendingJobs.length }, date);
  await notifyWithSound('pending', title, `${region.toUpperCase()} · ${body}`, `field-closeout-${scope}-${region}-${date}`, { tab: 'dispatch', sub: 'alerts' });
  createAuditLog({
    action: manual ? 'closeout_alert_manual_sent' : 'closeout_alert_sent',
    entity: 'route',
    metadata: {
      region,
      date,
      actorRole: scope,
      pendingCount: pendingJobs.length,
      technicianCount: grouped.length,
      closeoutTime: formatCloseoutTime(settings),
      repeatMinutes: settings.repeatMinutes,
      summary: `${scope} closeout alert sent for ${pendingJobs.length} pending jobs`,
    },
  }).catch(() => {});
  return { sent: true };
}

export function snoozeFieldAlert(scope: string, region: string, minutes?: number, date = todayKey()) {
  const settings = getFieldAlertSettings();
  const until = Date.now() + (minutes || settings.snoozeMinutes) * 60_000;
  saveFieldAlertState(scope, region, { snoozedUntil: until }, date);
  createAuditLog({
    action: 'field_alert_snoozed',
    entity: 'route',
    metadata: { region, date, actorRole: scope, snoozedUntil: new Date(until).toISOString(), summary: `${scope} alert snoozed` },
  }).catch(() => {});
  return until;
}

export function acknowledgeFieldAlert(scope: string, region: string, date = todayKey()) {
  const acknowledgedAt = Date.now();
  saveFieldAlertState(scope, region, { acknowledgedAt }, date);
  createAuditLog({
    action: 'field_alert_acknowledged',
    entity: 'route',
    metadata: { region, date, actorRole: scope, acknowledgedAt: new Date(acknowledgedAt).toISOString(), summary: `${scope} alert acknowledged` },
  }).catch(() => {});
  return acknowledgedAt;
}

export async function enableFieldAlerts() {
  return requestNotificationPermission();
}

export function testFieldAlertSound(kind: 'done' | 'notdone' | 'pending') {
  const settings = getFieldAlertSettings();
  if (kind === 'done' && settings.completedSound) playNotificationSound('done');
  else if (kind === 'notdone' && settings.notDoneSound) playNotificationSound('notdone');
  else if (kind === 'pending' && settings.pendingSound) playNotificationSound('pending');
}
