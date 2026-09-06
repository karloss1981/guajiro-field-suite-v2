// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../../../config/theme';
import { getTechName } from '../../../legacy/data';
import { notifyWithSound, requestNotificationPermission } from '../../../services/notification.service';
import { createAuditLog } from '../../../services/audit.service';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export default function SupervisorCloseoutMonitor({ routes, techLocations, region, lang = 'en', role = 'supervisor', onOpenRoute }) {
  const es = lang === 'es';
  const pending = useMemo(() => (routes || []).filter((job) => job.status === 'pending'), [routes]);
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    pending.forEach((job) => {
      groups[job.tech_id] = groups[job.tech_id] || [];
      groups[job.tech_id].push(job);
    });
    return Object.entries(groups).map(([techId, jobs]) => ({
      techId,
      jobs,
      location: (techLocations || []).find((location) => String(location.tech_id) === String(techId)),
    }));
  }, [pending, techLocations]);

  const storageKey = `gfs_closeout_${role}_${region}_${new Date().toLocaleDateString('en-CA')}`;
  const [snoozedUntil, setSnoozedUntil] = useState(() => Number(localStorage.getItem(`${storageKey}_snooze`) || 0));
  const [acknowledgedAt, setAcknowledgedAt] = useState(() => Number(localStorage.getItem(`${storageKey}_ack`) || 0));
  const [popup, setPopup] = useState(false);
  const lastAlertRef = useRef(Number(localStorage.getItem(`${storageKey}_last`) || 0));

  const buildBody = () => grouped.map((group) => `${group.techId}: ${group.jobs.length}`).join(' · ');

  const alert = async () => {
    if (!pending.length) return;
    const isAdmin = role === 'admin';
    const title = isAdmin
      ? (es ? 'Resumen de cierre de las 7 PM' : '7 PM Closeout Summary')
      : (es ? 'Trabajos pendientes por ruta' : 'Route Pending Jobs Alert');
    const body = isAdmin
      ? `${region.toUpperCase()}: ${pending.length} ${es ? 'trabajos pendientes' : 'pending jobs'} · ${grouped.length} ${es ? 'técnicos' : 'technicians'}`
      : buildBody();
    setPopup(true);
    lastAlertRef.current = Date.now();
    localStorage.setItem(`${storageKey}_last`, String(lastAlertRef.current));
    await notifyWithSound('pending', title, body, `closeout-${role}-${region}`);
    createAuditLog({
      action: 'closeout_alert_sent',
      entity: 'route',
      metadata: {
        region,
        actorRole: 'system',
        recipientRole: role,
        pendingCount: pending.length,
        technicianCount: grouped.length,
        summary: `${role} closeout alert sent for ${pending.length} pending jobs`,
      },
    }).catch(() => {});
  };

  useEffect(() => {
    const evaluate = () => {
      const now = Date.now();
      const afterSeven = new Date().getHours() >= 19;
      if (!afterSeven || !pending.length || now < snoozedUntil) return;
      if (now - lastAlertRef.current >= FIFTEEN_MINUTES) alert();
    };
    evaluate();
    const timer = setInterval(evaluate, 60_000);
    return () => clearInterval(timer);
  }, [pending.length, snoozedUntil, role, region, lang]);

  const snooze = () => {
    const until = Date.now() + FIFTEEN_MINUTES;
    setSnoozedUntil(until);
    localStorage.setItem(`${storageKey}_snooze`, String(until));
    setPopup(false);
    createAuditLog({
      action: 'closeout_alert_snoozed',
      entity: 'route',
      metadata: { region, actorRole: role, snoozedUntil: new Date(until).toISOString(), pendingCount: pending.length },
    }).catch(() => {});
  };

  const acknowledge = () => {
    const now = Date.now();
    setAcknowledgedAt(now);
    localStorage.setItem(`${storageKey}_ack`, String(now));
    setPopup(false);
    createAuditLog({
      action: 'closeout_alert_acknowledged',
      entity: 'route',
      metadata: { region, actorRole: role, acknowledgedAt: new Date(now).toISOString(), pendingCount: pending.length },
    }).catch(() => {});
  };

  return (
    <>
      <div className="supervisor-closeout-monitor" style={{ background: C.card, border: `1px solid ${pending.length ? '#ffbe0055' : '#00dc8544'}`, borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: pending.length ? '#ffbe00' : '#00dc85' }}>
              🔔 {es ? 'Monitor de cierre de las 7 PM' : '7 PM Closeout Monitor'}
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
              {pending.length
                ? `${pending.length} ${es ? 'trabajos pendientes entre' : 'pending jobs across'} ${grouped.length} ${es ? 'técnicos' : 'technicians'}`
                : (es ? 'No hay trabajos pendientes.' : 'No pending jobs.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button onClick={() => requestNotificationPermission()} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 8, padding: '7px 10px', color: '#00b8f5', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>{es ? 'Activar alertas' : 'Enable alerts'}</button>
            {pending.length > 0 && <button onClick={alert} style={{ background: '#ffbe0022', border: '1px solid #ffbe00', borderRadius: 8, padding: '7px 10px', color: '#ffbe00', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>{es ? 'Probar sonido' : 'Test alert'}</button>}
          </div>
        </div>
        {grouped.length > 0 && (
          <div className="supervisor-closeout-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginTop: 12 }}>
            {grouped.map((group) => (
              <button key={group.techId} onClick={onOpenRoute} style={{ background: '#0e1e3a', border: '1px solid #162e58', borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ fontWeight: 900, color: C.text }}>👷 {getTechName(group.techId)}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#ffbe00', marginTop: 3 }}>{group.jobs.length}</div>
                <div style={{ fontSize: 10, color: C.dim }}>{es ? 'pendientes' : 'pending'}</div>
                <div style={{ fontSize: 10, color: group.location ? '#00dc85' : '#ff3348', marginTop: 5 }}>
                  {group.location
                    ? `${es ? 'Último GPS' : 'Last GPS'}: ${new Date(group.location.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : (es ? 'Sin ubicación reciente' : 'No recent location')}
                </div>
              </button>
            ))}
          </div>
        )}
        {acknowledgedAt > 0 && <div style={{ fontSize: 10, color: C.dim, marginTop: 9 }}>{es ? 'Última confirmación' : 'Last acknowledgement'}: {new Date(acknowledgedAt).toLocaleString()}</div>}
      </div>

      {popup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 995, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ width: '100%', maxWidth: 470, background: '#0b1830', border: '2px solid #ffbe00', borderRadius: 18, padding: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#ffbe00', letterSpacing: 1.5 }}>7 PM CLOSEOUT ALERT</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26, fontWeight: 900, color: '#fff', margin: '6px 0 12px' }}>{pending.length} {es ? 'trabajos pendientes' : 'pending jobs'}</div>
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {grouped.map((group) => <div key={group.techId} style={{ background: '#071327', border: '1px solid #162e58', borderRadius: 9, padding: '9px 11px' }}><div style={{ color: '#00b8f5', fontWeight: 900 }}>{group.techId} — {getTechName(group.techId)}</div><div style={{ color: C.text, fontSize: 11 }}>{group.jobs.map((job) => `#${job.job_id}`).join(', ')}</div></div>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={snooze} style={{ flex: 1, background: '#ffbe0022', border: '1px solid #ffbe00', borderRadius: 9, padding: 10, color: '#ffbe00', fontWeight: 900, cursor: 'pointer' }}>Snooze 15 min</button>
              <button onClick={() => { acknowledge(); onOpenRoute?.(); }} style={{ flex: 1, background: 'linear-gradient(135deg,#0040c0,#00b8f5)', border: 'none', borderRadius: 9, padding: 10, color: '#fff', fontWeight: 900, cursor: 'pointer' }}>{es ? 'Abrir ruta' : 'Open route'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
