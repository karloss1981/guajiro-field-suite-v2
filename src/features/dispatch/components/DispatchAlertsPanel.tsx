// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getPendingPhotoQueueItems, onPhotoQueueChange, syncPhotoUploadQueue } from '../../../offline/photoUploadQueue';
import { getPendingCloseQueueItems, onPendingCloseQueueChange } from '../../../offline/pendingCloseQueue';
import {
  acknowledgeFieldAlert,
  enableFieldAlerts,
  formatCloseoutTime,
  getCloseoutStartTime,
  getFieldAlertSettings,
  getFieldAlertState,
  saveFieldAlertSettings,
  sendCloseoutAlert,
  shouldRunCloseoutAlert,
  snoozeFieldAlert,
  subscribeFieldAlertSettings,
  testFieldAlertSound,
} from '../../../services/fieldAlertRules.service';
import { createAuditLog } from '../../../services/audit.service';
import { OpsButton, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';

function isClosedStatus(status: any) {
  return ['done', 'notdone', 'completed', 'not_completed', 'cancelled'].includes(String(status || '').toLowerCase());
}
function isNotDone(status: any) {
  return ['notdone', 'not_completed', 'cancelled'].includes(String(status || '').toLowerCase());
}
function techLabel(techs: any[], id: any) {
  const t = techs.find((x) => String(x.id) === String(id));
  return `${t?.name || 'Unknown'} · #${id || 'NA'}`;
}
function minutesUntil(ms: number) {
  const diff = Math.ceil((ms - Date.now()) / 60000);
  if (diff <= 0) return 'now';
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}
function exportAlertRows(rows: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
    Tech: r.techId,
    'Tech Name': r.techName,
    Pending: r.pending,
    Completed: r.completed,
    'Not Done': r.notDone,
    'Pending Close': r.pendingClose,
    'Local Photo Queue': r.photoQueue,
    'At Risk': r.atRisk,
    'Last Pending Job IDs': r.jobIds,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alerts');
  XLSX.writeFile(wb, filename);
}

export default function DispatchAlertsPanel({ region, lang = 'en', jobs = [], techs = [], date, scope = 'supervisor', onOpenBoard }: any) {
  const es = lang === 'es';
  const [settings, setSettings] = useState(() => getFieldAlertSettings());
  const [stateTick, setStateTick] = useState(0);
  const [photoQueue, setPhotoQueue] = useState<any[]>([]);
  const [pendingClose, setPendingClose] = useState<any[]>([]);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [busy, setBusy] = useState('');

  const day = date || new Date().toLocaleDateString('en-CA');
  const alertState = getFieldAlertState(scope, region, day);
  const pendingJobs = useMemo(() => (jobs || []).filter((j: any) => !isClosedStatus(j.status)), [jobs]);
  const closedJobs = useMemo(() => (jobs || []).filter((j: any) => isClosedStatus(j.status)), [jobs]);
  const notDoneJobs = useMemo(() => (jobs || []).filter((j: any) => isNotDone(j.status)), [jobs]);
  const pendingCloseByTech = useMemo(() => {
    const map = new Map<string, any[]>();
    (pendingClose || []).forEach((item) => {
      const key = String(item.tech_id || 'NA');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return map;
  }, [pendingClose]);
  const photoQueueByTech = useMemo(() => {
    const map = new Map<string, any[]>();
    (photoQueue || []).forEach((item) => {
      const key = String(item.tech_id || 'NA');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return map;
  }, [photoQueue]);

  const groups = useMemo(() => {
    const ids = new Set<string>();
    techs.forEach((t: any) => ids.add(String(t.id)));
    pendingJobs.forEach((j: any) => ids.add(String(j.tech_id || 'NA')));
    closedJobs.forEach((j: any) => ids.add(String(j.tech_id || 'NA')));
    pendingClose.forEach((q: any) => ids.add(String(q.tech_id || 'NA')));
    photoQueue.forEach((q: any) => ids.add(String(q.tech_id || 'NA')));
    return [...ids].map((techId) => {
      const tech = techs.find((t: any) => String(t.id) === techId);
      const p = pendingJobs.filter((j: any) => String(j.tech_id || 'NA') === techId);
      const c = closedJobs.filter((j: any) => String(j.tech_id || 'NA') === techId);
      const n = notDoneJobs.filter((j: any) => String(j.tech_id || 'NA') === techId);
      const pc = pendingCloseByTech.get(techId) || [];
      const pq = photoQueueByTech.get(techId) || [];
      return {
        techId,
        techName: tech?.name || 'Unknown',
        pending: p.length,
        completed: c.length - n.length,
        notDone: n.length,
        pendingClose: pc.length,
        photoQueue: pq.length,
        atRisk: p.length + pc.length + pq.length,
        jobs: p,
        jobIds: p.slice(0, 20).map((j: any) => j.job_id).join(', '),
      };
    }).sort((a, b) => b.atRisk - a.atRisk || String(a.techId).localeCompare(String(b.techId)));
  }, [techs, pendingJobs, closedJobs, notDoneJobs, pendingCloseByTech, photoQueueByTech, pendingClose, photoQueue]);

  const due = shouldRunCloseoutAlert({ scope, region, date: day, pendingCount: pendingJobs.length, settings });
  const startAt = getCloseoutStartTime(day, settings);
  const snoozedUntil = Number(alertState.snoozedUntil || 0);
  const acknowledgedAt = Number(alertState.acknowledgedAt || 0);

  useEffect(() => {
    const loadQueues = async () => {
      setPhotoQueue(await getPendingPhotoQueueItems().catch(() => []));
      setPendingClose(await getPendingCloseQueueItems().catch(() => []));
    };
    loadQueues();
    const c1 = onPhotoQueueChange(loadQueues);
    const c2 = onPendingCloseQueueChange(loadQueues);
    const c3 = subscribeFieldAlertSettings(() => { setSettings(getFieldAlertSettings()); setStateTick((x) => x + 1); });
    const timer = setInterval(() => setStateTick((x) => x + 1), 60_000);
    return () => { c1(); c2(); c3(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!pendingJobs.length) return;
      await sendCloseoutAlert({ scope, region, date: day, pendingJobs, grouped: groups, lang }).catch(() => {});
      setStateTick((x) => x + 1);
    };
    run();
    const timer = setInterval(run, 60_000);
    return () => clearInterval(timer);
  }, [pendingJobs.length, groups.length, scope, region, day, lang, settings.closeoutHour, settings.closeoutMinute, settings.repeatMinutes, settings.supervisorEnabled, settings.adminEnabled, stateTick]);

  const updateSetting = (patch: any) => setSettings(saveFieldAlertSettings(patch));
  const enable = async () => setPermission(await enableFieldAlerts() as any);
  const sendNow = async () => {
    setBusy('send');
    try { await sendCloseoutAlert({ scope, region, date: day, pendingJobs, grouped: groups, lang, manual: true }); }
    finally { setBusy(''); setStateTick((x) => x + 1); }
  };
  const snooze = () => { snoozeFieldAlert(scope, region, settings.snoozeMinutes, day); setStateTick((x) => x + 1); };
  const ack = () => { acknowledgeFieldAlert(scope, region, day); setStateTick((x) => x + 1); };
  const syncNow = async () => {
    setBusy('sync');
    try {
      const result = await syncPhotoUploadQueue();
      createAuditLog({ action: 'manual_alert_panel_sync', entity: 'photo_queue', metadata: { region, actorRole: scope, synced: result.synced, failed: result.failed, pending: result.pending, summary: 'Manual sync from Dispatch Alerts panel' } }).catch(() => {});
      setPhotoQueue(await getPendingPhotoQueueItems().catch(() => []));
    } finally { setBusy(''); }
  };

  const cards = [
    { label: es ? 'Pendientes' : 'Pending', value: pendingJobs.length, color: pendingJobs.length ? OPS.yellow : OPS.green },
    { label: es ? 'Técnicos con pendiente' : 'Techs pending', value: groups.filter((g) => g.pending > 0).length, color: OPS.blue },
    { label: es ? 'Not Done' : 'Not Done', value: notDoneJobs.length, color: notDoneJobs.length ? OPS.red : OPS.dim },
    { label: es ? 'Pending Close' : 'Pending Close', value: pendingClose.length, color: pendingClose.length ? OPS.yellow : OPS.green },
    { label: es ? 'Fotos por subir' : 'Photos queued', value: photoQueue.length, color: photoQueue.length ? OPS.yellow : OPS.green },
  ];

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 8 }}>
      {cards.map((card) => <div key={card.label} style={{ background: '#0b1830', border: `1px solid ${card.color}55`, borderRadius: 13, padding: '12px 13px' }}><div style={{ fontSize: 26, fontWeight: 950, color: card.color }}>{card.value}</div><div style={{ fontSize: 10, color: OPS.dim }}>{card.label}</div></div>)}
    </div>

    <div style={{ background: '#0b1830', border: `1px solid ${due.due ? OPS.yellow : OPS.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: due.due ? OPS.yellow : OPS.text }}>🔔 {es ? 'Centro de alertas de cierre' : 'Closeout Alerts Center'}</div>
          <div style={{ fontSize: 11, color: OPS.dim, marginTop: 3 }}>
            {es ? 'Alertas reales para cierre, pendientes, fotos en cola, Pending Close y sonidos distintos.' : 'Real alerts for closeout, pending jobs, photo queue, Pending Close, and distinct sounds.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <OpsButton onClick={enable} tone="blue">🔔 {permission === 'granted' ? (es ? 'Activadas' : 'Enabled') : (es ? 'Activar' : 'Enable')}</OpsButton>
          <OpsButton onClick={sendNow} disabled={!pendingJobs.length || busy === 'send'} tone="yellow">{busy === 'send' ? '…' : es ? 'Enviar ahora' : 'Send now'}</OpsButton>
          <OpsButton onClick={snooze} disabled={!pendingJobs.length} tone="dim">Snooze {settings.snoozeMinutes}m</OpsButton>
          <OpsButton onClick={ack} disabled={!pendingJobs.length} tone="green">{es ? 'Reconocer' : 'Acknowledge'}</OpsButton>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9, marginTop: 12 }}>
        <label style={{ fontSize: 10, color: OPS.dim, fontWeight: 800 }}>Closeout time<input type="time" value={`${String(settings.closeoutHour).padStart(2, '0')}:${String(settings.closeoutMinute).padStart(2, '0')}`} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); updateSetting({ closeoutHour: h, closeoutMinute: m }); }} style={{ ...fieldStyle, marginTop: 4 }} /></label>
        <label style={{ fontSize: 10, color: OPS.dim, fontWeight: 800 }}>{es ? 'Repetir cada' : 'Repeat every'}<select value={settings.repeatMinutes} onChange={(e) => updateSetting({ repeatMinutes: Number(e.target.value) })} style={{ ...fieldStyle, marginTop: 4 }}><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
        <label style={{ fontSize: 10, color: OPS.dim, fontWeight: 800 }}>Snooze<select value={settings.snoozeMinutes} onChange={(e) => updateSetting({ snoozeMinutes: Number(e.target.value) })} style={{ ...fieldStyle, marginTop: 4 }}><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
        <label style={{ fontSize: 10, color: OPS.dim, fontWeight: 800 }}>{es ? 'Al salir de dirección' : 'After leaving address'}<select value={settings.leftJobMinutes} onChange={(e) => updateSetting({ leftJobMinutes: Number(e.target.value) })} style={{ ...fieldStyle, marginTop: 4 }}><option value={15}>15 min</option><option value={30}>30 min</option></select></label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 11, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: OPS.dim, fontSize: 11 }}><input type="checkbox" checked={settings.supervisorEnabled} onChange={(e) => updateSetting({ supervisorEnabled: e.target.checked })} /> Supervisor alerts</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: OPS.dim, fontSize: 11 }}><input type="checkbox" checked={settings.adminEnabled} onChange={(e) => updateSetting({ adminEnabled: e.target.checked })} /> Admin alerts</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: OPS.dim, fontSize: 11 }}><input type="checkbox" checked={settings.technicianEnabled} onChange={(e) => updateSetting({ technicianEnabled: e.target.checked })} /> Tech reminders</label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginTop: 12 }}>
        <div style={{ background: '#071327', border: `1px solid ${OPS.border}`, borderRadius: 11, padding: 10 }}><div style={{ fontSize: 10, color: OPS.dim }}>{es ? 'Próxima alerta' : 'Next alert'}</div><div style={{ fontWeight: 900, color: due.due ? OPS.yellow : OPS.text, marginTop: 3 }}>{Date.now() < startAt ? `${formatCloseoutTime(settings)} · ${minutesUntil(startAt)}` : due.reason}</div></div>
        <div style={{ background: '#071327', border: `1px solid ${OPS.border}`, borderRadius: 11, padding: 10 }}><div style={{ fontSize: 10, color: OPS.dim }}>Snoozed until</div><div style={{ fontWeight: 900, color: snoozedUntil > Date.now() ? OPS.yellow : OPS.dim, marginTop: 3 }}>{snoozedUntil ? new Date(snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div></div>
        <div style={{ background: '#071327', border: `1px solid ${OPS.border}`, borderRadius: 11, padding: 10 }}><div style={{ fontSize: 10, color: OPS.dim }}>{es ? 'Reconocido' : 'Acknowledged'}</div><div style={{ fontWeight: 900, color: acknowledgedAt ? OPS.green : OPS.dim, marginTop: 3 }}>{acknowledgedAt ? new Date(acknowledgedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div></div>
      </div>
    </div>

    <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><div style={{ fontWeight: 900, color: OPS.text }}>🔊 {es ? 'Pruebas de sonido' : 'Sound tests'}</div><div style={{ fontSize: 10, color: OPS.dim }}>{es ? 'Completed, Not Done y Pending suenan diferente.' : 'Completed, Not Done, and Pending have different sounds.'}</div></div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <OpsButton onClick={() => testFieldAlertSound('done')} tone="green">✅ Completed</OpsButton>
          <OpsButton onClick={() => testFieldAlertSound('notdone')} tone="red">❌ Not Done</OpsButton>
          <OpsButton onClick={() => testFieldAlertSound('pending')} tone="yellow">⏰ Pending</OpsButton>
          <OpsButton onClick={syncNow} disabled={busy === 'sync'} tone="purple">{busy === 'sync' ? '…' : 'Sync photos now'}</OpsButton>
        </div>
      </div>
    </div>

    <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '12px 14px', background: '#0e2344', borderBottom: `1px solid ${OPS.border}` }}>
        <div style={{ fontWeight: 900, color: OPS.text }}>👷 {es ? 'Alertas por técnico' : 'Alerts by technician'}</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}><OpsButton onClick={() => exportAlertRows(groups, `dispatch_alerts_${region}_${day}.xlsx`)} tone="green">Export XLSX</OpsButton><OpsButton onClick={onOpenBoard} tone="dim">{es ? 'Ver despacho' : 'Open board'}</OpsButton></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {groups.length === 0 ? <div style={{ padding: 22, textAlign: 'center', color: OPS.dim }}>{es ? 'No hay datos para mostrar.' : 'No data to show.'}</div> : groups.map((g) => <div key={g.techId} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) repeat(5,80px)', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${OPS.border}` }} className="dispatch-alert-tech-row">
          <div style={{ minWidth: 0 }}><div style={{ fontWeight: 900, color: g.atRisk ? OPS.yellow : OPS.text }}>{techLabel(techs, g.techId)}</div><div style={{ fontSize: 9, color: OPS.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.jobIds || (es ? 'Sin pendientes' : 'No pending jobs')}</div></div>
          <div style={{ textAlign: 'center' }}><b style={{ color: g.pending ? OPS.yellow : OPS.dim }}>{g.pending}</b><div style={{ fontSize: 8, color: OPS.dim }}>Pending</div></div>
          <div style={{ textAlign: 'center' }}><b style={{ color: OPS.green }}>{g.completed}</b><div style={{ fontSize: 8, color: OPS.dim }}>Done</div></div>
          <div style={{ textAlign: 'center' }}><b style={{ color: g.notDone ? OPS.red : OPS.dim }}>{g.notDone}</b><div style={{ fontSize: 8, color: OPS.dim }}>Not Done</div></div>
          <div style={{ textAlign: 'center' }}><b style={{ color: g.pendingClose ? OPS.yellow : OPS.dim }}>{g.pendingClose}</b><div style={{ fontSize: 8, color: OPS.dim }}>P.Close</div></div>
          <div style={{ textAlign: 'center' }}><b style={{ color: g.photoQueue ? OPS.yellow : OPS.dim }}>{g.photoQueue}</b><div style={{ fontSize: 8, color: OPS.dim }}>Photos</div></div>
        </div>)}
      </div>
    </div>
  <style>{`@media(max-width:760px){.dispatch-alert-tech-row{grid-template-columns:1fr!important}.dispatch-alert-tech-row>div{text-align:left!important}}`}</style>
  </div>;
}
