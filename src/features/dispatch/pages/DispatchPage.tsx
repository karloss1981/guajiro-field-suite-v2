// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuditLog, getLocalAuditLogs, subscribeLocalAudit } from '../../../services/audit.service';
import { assignJob, autoAssignJob, createDispatchRule, deactivateDispatchRule, getDispatchBoard, getDispatchRules } from '../../../services/operations/dispatch.service';
import { OpsButton, OpsError, OpsPage, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';
import DispatchTechnicianStats from '../components/DispatchTechnicianStats';
import DispatchCloseoutQA from '../components/DispatchCloseoutQA';
import DispatchAlertsPanel from '../components/DispatchAlertsPanel';
import DispatchReworkQA from '../components/DispatchReworkQA';
import DispatchIncidentsCenter from '../components/DispatchIncidentsCenter';
import { operationsSetupMessage } from '../../../services/operations/schema.service';
import { parseHash } from '../../../legacy/routing';

const AREA_KEY = 'gfs_dispatch_tech_areas_v1';
const LOCK_KEY = 'gfs_dispatch_assignment_locks_v23';
const NOTE_KEY = 'gfs_dispatch_notes_v23';

function safeParse(raw: string | null, fallback: any) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function loadAreas() { return safeParse(localStorage.getItem(AREA_KEY), {}); }
function saveAreas(value: any) { try { localStorage.setItem(AREA_KEY, JSON.stringify(value)); } catch {} }
function loadLocks() { return safeParse(localStorage.getItem(LOCK_KEY), {}); }
function saveLocks(value: any) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(value)); } catch {} }
function loadNotes() { return safeParse(localStorage.getItem(NOTE_KEY), {}); }
function saveNotes(value: any) { try { localStorage.setItem(NOTE_KEY, JSON.stringify(value)); } catch {} }
function clean(v: any) { return String(v ?? '').trim(); }
function isClosedStatus(status: any) { return ['done', 'notdone', 'completed', 'not_completed', 'cancelled'].includes(String(status || '').toLowerCase()); }
function workloadColor(count: number) { return count >= 8 ? OPS.red : count >= 5 ? OPS.yellow : OPS.green; }
function workloadLabel(count: number, es: boolean) { return count >= 8 ? (es ? 'Sobrecargado' : 'Heavy') : count >= 5 ? (es ? 'Normal alto' : 'Medium') : (es ? 'Disponible' : 'Light'); }
function normalizeText(value: any) { return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

export default function DispatchPage({ region, lang, readOnly = false, actorName = 'Supervisor' }: { region: string; lang: string; readOnly?: boolean; actorName?: string }) {
  const es = lang === 'es';
  const today = new Date().toLocaleDateString('en-CA');
  const [date, setDate] = useState(today);
  const [jobs, setJobs] = useState<any[]>([]);
  const [techs, setTechs] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedTech, setSelectedTech] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<Record<string, boolean>>({});
  const [bulkTech, setBulkTech] = useState('');
  const [dragJob, setDragJob] = useState<any>(null);
  const [areas, setAreas] = useState<any>(loadAreas);
  const [locks, setLocks] = useState<any>(loadLocks);
  const [notes, setNotes] = useState<any>(loadNotes);
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [viewMode, setViewMode] = useState<'board' | 'stats' | 'closeout' | 'alerts' | 'rework' | 'incidents'>('board');
  const [ruleForm, setRuleForm] = useState({ service_type: '', technician_id: '', specialty: '', priority: 1 });
  const [auditTick, setAuditTick] = useState(0);

  useEffect(() => {
    const syncSubRoute = () => {
      const parsed = parseHash();
      if (parsed.tab === 'dispatch' && parsed.sub === 'alerts') setViewMode('alerts');
      if (parsed.tab === 'dispatch' && parsed.sub === 'stats') setViewMode('stats');
      if (parsed.tab === 'dispatch' && parsed.sub === 'closeout') setViewMode('closeout');
      if (parsed.tab === 'dispatch' && parsed.sub === 'rework') setViewMode('rework');
      if (parsed.tab === 'dispatch' && parsed.sub === 'incidents') setViewMode('incidents');
    };
    syncSubRoute();
    window.addEventListener('hashchange', syncSubRoute);
    return () => window.removeEventListener('hashchange', syncSubRoute);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setWarning('');
    try {
      const [board, ruleResult] = await Promise.all([getDispatchBoard(region, date), getDispatchRules(region)]);
      setJobs(board.jobs); setTechs(board.technicians);
      if (ruleResult.error) throw ruleResult.error;
      setRules(ruleResult.data || []);
      setWarning([...(board.warnings || []), ruleResult.warning].filter(Boolean).join(' '));
    } catch (e: any) { setError(operationsSetupMessage(e, 'Dispatch')); }
    finally { setLoading(false); }
  }, [region, date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeLocalAudit(() => setAuditTick(v => v + 1)), []);

  const openJobs = useMemo(() => jobs.filter(j => !isClosedStatus(j.status)), [jobs]);
  const cities = useMemo(() => [...new Set(openJobs.map(j => (j.city || 'Unknown').trim()).filter(Boolean))].sort(), [openJobs]);
  const selectedJobIds = useMemo(() => Object.entries(selectedJobs).filter(([, yes]) => yes).map(([id]) => id), [selectedJobs]);
  const selectedRows = useMemo(() => openJobs.filter(j => selectedJobIds.includes(String(j.id))), [openJobs, selectedJobIds]);

  const techLoad = useMemo(() => {
    const map = new Map<string, any>();
    techs.forEach(t => map.set(String(t.id), { tech: t, count: 0, pay: 0, cities: new Set(), zip: new Set() }));
    openJobs.forEach(j => {
      const id = String(j.tech_id || '');
      if (!map.has(id)) return;
      const row = map.get(id);
      row.count += 1;
      row.pay += Number(j.pay_total || j.pay || 0) || 0;
      if (j.city) row.cities.add(j.city);
      if (j.zip || j.zip_code) row.zip.add(j.zip || j.zip_code);
    });
    return map;
  }, [openJobs, techs]);

  const recommendTech = useCallback((job: any) => {
    const city = normalizeText(job.city);
    const zip = normalizeText(job.zip || job.zip_code);
    const service = normalizeText(job.type || job.service_type);
    const candidates = techs.map(t => {
      const tId = String(t.id);
      const area = normalizeText(areas[tId] || '');
      const load = techLoad.get(tId)?.count || 0;
      const specialties = Array.isArray(t.specialties) ? t.specialties.map(normalizeText).join(' ') : '';
      let score = 100 - (load * 9);
      if (area && (city.includes(area) || zip.includes(area) || area.includes(city) || area.includes(zip))) score += 30;
      if (service && specialties && (specialties.includes(service) || service.includes(specialties))) score += 18;
      const directRule = rules.find(r => String(r.technician_id || '') === tId && (!r.service_type || normalizeText(r.service_type) === service));
      if (directRule) score += 40 - Number(directRule.priority || 1);
      return { tech: t, score, load };
    }).sort((a, b) => b.score - a.score || a.load - b.load);
    return candidates[0] || null;
  }, [techs, areas, techLoad, rules]);

  const filtered = useMemo(() => openJobs.filter(job => {
    const q = normalizeText(search);
    const zip = job.zip || job.zip_code || '';
    const note = notes[job.id] || '';
    const hay = [job.job_id, job.address, job.city, zip, job.type, job.tech_id, job.status, job.phone, note].join(' ').toLowerCase();
    const selectedMatch = !selectedTech || String(job.tech_id || '') === String(selectedTech) || !job.tech_id;
    return (!q || hay.includes(q))
      && (cityFilter === 'all' || String(job.city || 'Unknown') === cityFilter)
      && (!unassignedOnly || !job.tech_id)
      && selectedMatch;
  }), [openJobs, search, cityFilter, unassignedOnly, selectedTech, notes]);

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach(job => {
      const key = job.tech_id
        ? `${es ? 'Tech' : 'Tech'} #${job.tech_id} · ${techs.find(t => String(t.id) === String(job.tech_id))?.name || 'Assigned'}`
        : `⚠ ${es ? 'Sin asignar' : 'Unassigned'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0].includes('Unassigned') || a[0].includes('Sin asignar')) return -1;
      if (b[0].includes('Unassigned') || b[0].includes('Sin asignar')) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered, es, techs]);

  const updateLocalNote = (jobId: string, value: string) => {
    const next = { ...notes, [jobId]: value };
    setNotes(next); saveNotes(next);
  };

  const setJobSelected = (id: string, value?: boolean) => setSelectedJobs(prev => ({ ...prev, [id]: value ?? !prev[id] }));
  const selectFiltered = () => {
    const next = { ...selectedJobs };
    filtered.forEach(j => { next[String(j.id)] = true; });
    setSelectedJobs(next);
  };
  const clearSelected = () => setSelectedJobs({});

  const doAssign = async (job: any, techId: string, options: { force?: boolean; source?: string } = {}) => {
    if (!techId || readOnly) return;
    const lock = locks[job.id];
    if (lock && !options.force && String(job.tech_id || '') !== String(techId)) {
      setError(es ? `El trabajo ${job.job_id} está bloqueado. Desbloquéalo antes de moverlo.` : `Job ${job.job_id} is locked. Unlock it before moving.`);
      return;
    }
    setBusy(job.id); setError('');
    try {
      const { error } = await assignJob(job.id, techId); if (error) throw error;
      await createAuditLog({ action: 'dispatch_assignment', entity: 'route', entityId: job.id, metadata: { region, actorName, job_id: job.job_id, from: job.tech_id || null, to: techId, source: options.source || 'manual', locked: Boolean(lock), summary: `Job ${job.job_id} assigned to tech ${techId}` } });
      await load();
    } catch (e: any) { setError(operationsSetupMessage(e, 'Dispatch')); }
    finally { setBusy(''); setDragJob(null); }
  };

  const doAuto = async (job: any) => {
    if (readOnly) return;
    if (locks[job.id]) { setError(es ? `El trabajo ${job.job_id} está bloqueado.` : `Job ${job.job_id} is locked.`); return; }
    setBusy(job.id);
    try {
      const result = await autoAssignJob(job.id);
      await createAuditLog({ action: 'dispatch_auto_assignment', entity: 'route', entityId: job.id, metadata: { region, actorName, job_id: job.job_id, to: result.technician.id, summary: `Job ${job.job_id} auto-assigned to tech ${result.technician.id}` } });
      await load();
    } catch (e: any) { setError(operationsSetupMessage(e, 'Dispatch')); }
    finally { setBusy(''); }
  };

  const doSmartAssign = async (job: any) => {
    const rec = recommendTech(job);
    if (!rec?.tech?.id) return;
    await doAssign(job, String(rec.tech.id), { source: 'smart_recommendation' });
  };

  const toggleLock = async (job: any) => {
    if (readOnly) return;
    const next = { ...locks };
    if (next[job.id]) delete next[job.id];
    else next[job.id] = { job_id: job.job_id, tech_id: job.tech_id || null, locked_by: actorName, locked_at: new Date().toISOString() };
    setLocks(next); saveLocks(next);
    await createAuditLog({ action: next[job.id] ? 'dispatch_assignment_locked' : 'dispatch_assignment_unlocked', entity: 'route', entityId: job.id, metadata: { region, actorName, job_id: job.job_id, tech_id: job.tech_id || null, summary: `${next[job.id] ? 'Locked' : 'Unlocked'} dispatch assignment for ${job.job_id}` } });
  };

  const bulkAssign = async (mode: 'selected' | 'filtered' = 'selected') => {
    if (readOnly || !bulkTech) return;
    const source = mode === 'filtered' ? filtered : selectedRows;
    const movable = source.filter(j => !locks[j.id] || String(j.tech_id || '') === String(bulkTech));
    if (!movable.length) { setError(es ? 'No hay trabajos seleccionados disponibles para mover.' : 'No selected jobs are available to move.'); return; }
    setBusy('bulk'); setError('');
    let ok = 0; let fail = 0;
    for (const job of movable) {
      const { error } = await assignJob(job.id, bulkTech);
      if (error) fail += 1;
      else {
        ok += 1;
        await createAuditLog({ action: 'dispatch_bulk_assignment', entity: 'route', entityId: job.id, metadata: { region, actorName, job_id: job.job_id, from: job.tech_id || null, to: bulkTech, summary: `Bulk assigned ${job.job_id} to tech ${bulkTech}` } });
      }
    }
    setBusy(''); clearSelected(); await load();
    if (fail) setError(es ? `${ok} trabajos movidos, ${fail} fallaron.` : `${ok} jobs moved, ${fail} failed.`);
  };

  const bulkSmart = async () => {
    const source = selectedRows.length ? selectedRows : filtered.filter(j => !j.tech_id).slice(0, 25);
    if (!source.length) return;
    setBusy('smartbulk'); setError('');
    let ok = 0; let fail = 0;
    for (const job of source) {
      if (locks[job.id]) continue;
      const rec = recommendTech(job);
      if (!rec?.tech?.id) { fail += 1; continue; }
      const { error } = await assignJob(job.id, String(rec.tech.id));
      if (error) fail += 1;
      else {
        ok += 1;
        await createAuditLog({ action: 'dispatch_bulk_smart_assignment', entity: 'route', entityId: job.id, metadata: { region, actorName, job_id: job.job_id, from: job.tech_id || null, to: rec.tech.id, score: rec.score, summary: `Smart assigned ${job.job_id} to tech ${rec.tech.id}` } });
      }
    }
    setBusy(''); clearSelected(); await load();
    if (fail) setError(es ? `${ok} asignados, ${fail} no se pudieron asignar.` : `${ok} assigned, ${fail} could not be assigned.`);
  };

  const updateArea = (techId: string, value: string) => { const next = { ...areas, [techId]: value }; setAreas(next); saveAreas(next); };
  const addRule = async () => { if (!ruleForm.technician_id) return; try { const { error } = await createDispatchRule({ ...ruleForm, region, priority: Number(ruleForm.priority) || 1 }); if (error) throw error; setRuleForm({ service_type: '', technician_id: '', specialty: '', priority: 1 }); await load(); } catch (e: any) { setError(operationsSetupMessage(e, 'Dispatch')); } };

  const dispatchLogs = useMemo(() => getLocalAuditLogs().filter((log: any) => String(log.action || '').startsWith('dispatch_')).slice(0, 10), [auditTick, jobs]);
  const unassignedCount = openJobs.filter(job => !job.tech_id).length;
  const highLoadCount = techs.filter(tech => (techLoad.get(String(tech.id))?.count || 0) >= 8).length;
  const lockedCount = openJobs.filter(job => locks[job.id]).length;
  const selectedTechName = selectedTech ? (techs.find(t => String(t.id) === String(selectedTech))?.name || selectedTech) : '';


  if (viewMode === 'alerts') return <OpsPage title={es ? '🔔 Dispatch · Alertas y recordatorios' : '🔔 Dispatch · Alerts & Reminders'} subtitle={es ? 'Centro de alertas para cierre de las 7 PM, pendientes, Pending Close, fotos por sincronizar y sonidos.' : 'Alert center for 7 PM closeout, pending jobs, Pending Close, queued photos, and sounds.'} actions={<><OpsButton onClick={() => setViewMode('board')} tone="dim">← {es ? 'Volver al despacho' : 'Back to board'}</OpsButton><OpsButton onClick={() => setViewMode('stats')} tone="purple">📊 Stats</OpsButton><OpsButton onClick={() => setViewMode('closeout')} tone="green">🧾 Billing QA</OpsButton><OpsButton onClick={() => setViewMode('rework')} tone="red">🛠 QA/Rework</OpsButton><OpsButton onClick={() => setViewMode('incidents')} tone="red">🚨 Incidents</OpsButton></>}>
    <DispatchAlertsPanel region={region} lang={lang} jobs={jobs} techs={techs} date={date} scope="supervisor" onOpenBoard={() => setViewMode('board')} />
  </OpsPage>;

  if (viewMode === 'stats') return <OpsPage title={es ? '📊 Dispatch · Estadísticas de técnicos' : '📊 Dispatch · Technician Stats'} subtitle={es ? 'Búsqueda por técnico, día, semana, mes, año, frases, motivos y valor por billing code.' : 'Search by technician, day, week, month, year, phrases, reasons, and billing code value.'} actions={<><OpsButton onClick={() => setViewMode('board')} tone="dim">← {es ? 'Volver al despacho' : 'Back to board'}</OpsButton><OpsButton onClick={() => setViewMode('closeout')} tone="green">🧾 {es ? 'Billing QA' : 'Billing QA'}</OpsButton><OpsButton onClick={() => setViewMode('alerts')} tone="yellow">🔔 {es ? 'Alertas' : 'Alerts'}</OpsButton><OpsButton onClick={() => setViewMode('rework')} tone="red">🛠 QA/Rework</OpsButton><OpsButton onClick={() => setViewMode('incidents')} tone="red">🚨 Incidents</OpsButton></>}>
    <DispatchTechnicianStats region={region} lang={lang} />
  </OpsPage>;

  if (viewMode === 'closeout') return <OpsPage title={es ? '🧾 Dispatch · Billing / Closeout QA' : '🧾 Dispatch · Billing / Closeout QA'} subtitle={es ? 'Revisión de cierre, fotos, billing code, valor en riesgo, duplicados y jobs listos para facturar.' : 'Closeout review for photos, billing code, at-risk value, duplicates, and ready-to-bill jobs.'} actions={<><OpsButton onClick={() => setViewMode('board')} tone="dim">← {es ? 'Volver al despacho' : 'Back to board'}</OpsButton><OpsButton onClick={() => setViewMode('stats')} tone="purple">📊 {es ? 'Stats' : 'Stats'}</OpsButton><OpsButton onClick={() => setViewMode('alerts')} tone="yellow">🔔 {es ? 'Alertas' : 'Alerts'}</OpsButton><OpsButton onClick={() => setViewMode('rework')} tone="red">🛠 QA/Rework</OpsButton><OpsButton onClick={() => setViewMode('incidents')} tone="red">🚨 Incidents</OpsButton></>}>
    <DispatchCloseoutQA region={region} lang={lang} />
  </OpsPage>;

  if (viewMode === 'rework') return <OpsPage title={es ? '🛠 Dispatch · QA / Rework real' : '🛠 Dispatch · QA / Rework'} subtitle={es ? 'Detecta trabajos con problemas, crea revisión QA, abre rework, asigna técnico y cierra con nota de resolución.' : 'Detect problem jobs, create QA reviews, open reworks, assign a technician, and resolve with notes.'} actions={<><OpsButton onClick={() => setViewMode('board')} tone="dim">← {es ? 'Volver al despacho' : 'Back to board'}</OpsButton><OpsButton onClick={() => setViewMode('stats')} tone="purple">📊 Stats</OpsButton><OpsButton onClick={() => setViewMode('closeout')} tone="green">🧾 Billing QA</OpsButton><OpsButton onClick={() => setViewMode('alerts')} tone="yellow">🔔 {es ? 'Alertas' : 'Alerts'}</OpsButton><OpsButton onClick={() => setViewMode('incidents')} tone="red">🚨 Incidents</OpsButton></>}>
    <DispatchReworkQA region={region} lang={lang} readOnly={readOnly} actorName={actorName} />
  </OpsPage>;


  if (viewMode === 'incidents') return <OpsPage title={es ? '🚨 Dispatch · Incidencias / Problemas' : '🚨 Dispatch · Incidents / Problems'} subtitle={es ? 'Centro único para trabajos problemáticos: Not Done, QA, fotos, billing, 811, customer ausente, misil y pendientes para ruta.' : 'Central problem-job center: Not Done, QA, photos, billing, 811, customer absent, misil, and route follow-ups.'} actions={<><OpsButton onClick={() => setViewMode('board')} tone="dim">← {es ? 'Volver al despacho' : 'Back to board'}</OpsButton><OpsButton onClick={() => setViewMode('stats')} tone="purple">📊 Stats</OpsButton><OpsButton onClick={() => setViewMode('closeout')} tone="green">🧾 Billing QA</OpsButton><OpsButton onClick={() => setViewMode('alerts')} tone="yellow">🔔 {es ? 'Alertas' : 'Alerts'}</OpsButton><OpsButton onClick={() => setViewMode('rework')} tone="red">🛠 QA/Rework</OpsButton></>}>
    <DispatchIncidentsCenter region={region} lang={lang} readOnly={readOnly} actorName={actorName} />
  </OpsPage>;

  return <OpsPage title={es ? '🚚 Dispatch Control' : '🚚 Dispatch Control'} subtitle={es ? 'Asignación real, bloqueos, carga por técnico, cola sin asignar y cambios con auditoría.' : 'Real assignment, locks, technician workload, unassigned queue, and audited changes.'} actions={<><OpsButton onClick={() => setViewMode('stats')} tone="purple">📊 {es ? 'Estadísticas' : 'Stats'}</OpsButton><OpsButton onClick={() => setViewMode('closeout')} tone="green">🧾 Billing QA</OpsButton><OpsButton onClick={() => setViewMode('rework')} tone="red">🛠 QA/Rework</OpsButton><OpsButton onClick={() => setViewMode('alerts')} tone="yellow">🔔 {es ? 'Alertas' : 'Alerts'}</OpsButton><OpsButton onClick={() => setViewMode('incidents')} tone="red">🚨 {es ? 'Incidencias' : 'Incidents'}</OpsButton><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...fieldStyle, width: 145 }} /><OpsButton onClick={load} tone="dim">↻ {es ? 'Actualizar' : 'Refresh'}</OpsButton></>}>
    <OpsError message={error} />
    {warning && <div style={{ background: '#ffbe0012', border: '1px solid #ffbe0055', borderRadius: 10, padding: '10px 12px', color: '#ffcf55', fontSize: 11 }}>⚠ {warning}</div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,340px) minmax(0,1fr)', gap: 14, alignItems: 'start' }} className="dispatch-simple-grid">
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 10 }}>
        <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 900, color: OPS.text, fontSize: 16 }}>{es ? 'Técnicos / carga' : 'Technicians / load'}</div>
            {selectedTech && <button onClick={() => setSelectedTech('')} style={{ background: '#162e58', border: '1px solid #27436f', borderRadius: 8, color: '#c8d8f4', fontSize: 9, fontWeight: 900, padding: '4px 7px', cursor: 'pointer' }}>{es ? 'Todos' : 'All'}</button>}
          </div>
          <div style={{ fontSize: 10, color: OPS.dim, marginTop: 3 }}>{selectedTech ? (es ? `Filtrando por ${selectedTechName}. También se muestran trabajos sin asignar.` : `Filtering by ${selectedTechName}. Unassigned jobs remain visible.`) : (es ? 'Arrastra trabajos, usa Smart, o selecciona varios para moverlos.' : 'Drag jobs, use Smart, or select multiple jobs to move them.')}</div>
        </div>
        {techs.map(t => {
          const assigned = openJobs.filter(j => String(j.tech_id || '') === String(t.id));
          const load = techLoad.get(String(t.id));
          const count = assigned.length;
          const color = workloadColor(count);
          return <div key={t.id}
            onDragOver={e => { if (!readOnly) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragJob) void doAssign(dragJob, String(t.id)); }}
            onClick={() => setSelectedTech(String(t.id))}
            style={{ background: selectedTech === String(t.id) ? '#102b50' : '#0b1830', border: `1px solid ${selectedTech === String(t.id) ? '#00b8f5' : OPS.border}`, borderRadius: 12, padding: 11, cursor: 'pointer', boxShadow: dragJob ? '0 0 0 1px #00b8f522' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div><div style={{ fontWeight: 900, color: OPS.text, fontSize: 13 }}>{t.name}</div><div style={{ fontSize: 10, color: OPS.dim }}>Tech #{t.id} · {workloadLabel(count, es)}</div></div>
              <div style={{ minWidth: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: `${color}22`, color, fontWeight: 900 }}>{count}</div>
            </div>
            <input value={areas[t.id] || ''} onChange={e => updateArea(String(t.id), e.target.value)} onClick={e => e.stopPropagation()} placeholder={es ? 'Área: ciudad o ZIP' : 'Area: city or ZIP'} style={{ ...fieldStyle, width: '100%', marginTop: 8, fontSize: 10 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ fontSize: 9, color: OPS.dim }}>{es ? 'Pay' : 'Pay'} ${Number(load?.pay || 0).toFixed(0)}</span>
              {[...Array.from(load?.cities || [])].slice(0, 2).map((c: any) => <span key={c} style={{ fontSize: 9, padding: '2px 5px', borderRadius: 20, background: '#162e58', color: '#dbe8ff' }}>{c}</span>)}
            </div>
            {assigned.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>{assigned.slice(0, 5).map(j => <span key={j.id} style={{ fontSize: 9, padding: '3px 6px', borderRadius: 20, background: locks[j.id] ? '#ffbe0022' : '#162e58', color: locks[j.id] ? OPS.yellow : '#dbe8ff' }}>{locks[j.id] ? '🔒 ' : ''}#{j.job_id}</span>)}{assigned.length > 5 && <span style={{ fontSize: 9, color: OPS.dim }}>+{assigned.length - 5}</span>}</div>}
          </div>;
        })}
      </aside>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
          {[
            { label: es ? 'Abiertos' : 'Open', value: openJobs.length, color: OPS.blue },
            { label: es ? 'Sin asignar' : 'Unassigned', value: unassignedCount, color: OPS.yellow },
            { label: es ? 'Bloqueados' : 'Locked', value: lockedCount, color: OPS.purple },
            { label: es ? 'Sobrecargados' : 'High load', value: highLoadCount, color: OPS.red },
          ].map(card => <div key={card.label} style={{ background: '#0b1830', border: `1px solid ${card.color}44`, borderRadius: 12, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 900, color: card.color }}>{card.value}</div><div style={{ fontSize: 10, color: OPS.dim }}>{card.label}</div></div>)}
        </div>

        <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 170px auto auto', gap: 8, alignItems: 'center' }} className="dispatch-filters">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={es ? 'Buscar Job ID, dirección, ZIP, tipo...' : 'Search Job ID, address, ZIP, type...'} style={fieldStyle} />
          <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} style={fieldStyle}><option value="all">{es ? 'Todas las ciudades' : 'All cities'}</option>{cities.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <button onClick={() => setUnassignedOnly(v => !v)} style={{ background: unassignedOnly ? '#ffbe0022' : '#162e58', border: `1px solid ${unassignedOnly ? OPS.yellow : OPS.border}`, borderRadius: 8, padding: '9px 10px', color: unassignedOnly ? OPS.yellow : OPS.dim, fontWeight: 900, cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap' }}>{es ? 'Solo sin asignar' : 'Unassigned only'}</button>
          <div style={{ fontSize: 11, color: OPS.dim, textAlign: 'right' }}><b style={{ color: OPS.blue, fontSize: 18 }}>{filtered.length}</b> {es ? 'trabajos' : 'jobs'}</div>
        </div>

        {!readOnly && <div style={{ background: '#0b1830', border: `1px solid ${selectedJobIds.length ? OPS.blue : OPS.border}`, borderRadius: 13, padding: 12, display: 'grid', gridTemplateColumns: '1fr 190px auto auto auto', gap: 8, alignItems: 'center' }} className="dispatch-bulkbar">
          <div style={{ fontSize: 11, color: OPS.dim }}><b style={{ color: OPS.text }}>{selectedJobIds.length}</b> {es ? 'seleccionados' : 'selected'} · {es ? 'bloqueados no se mueven' : 'locked jobs will not move'}</div>
          <select value={bulkTech} onChange={e => setBulkTech(e.target.value)} style={fieldStyle}><option value="">{es ? 'Técnico destino' : 'Target tech'}</option>{techs.map(t => <option key={t.id} value={t.id}>{t.name} · #{t.id}</option>)}</select>
          <OpsButton disabled={!bulkTech || !selectedJobIds.length || busy === 'bulk'} onClick={() => bulkAssign('selected')} tone="green">{busy === 'bulk' ? '…' : es ? 'Mover selección' : 'Move selected'}</OpsButton>
          <OpsButton disabled={busy === 'smartbulk'} onClick={bulkSmart} tone="purple">{busy === 'smartbulk' ? '…' : es ? 'Smart bulk' : 'Smart bulk'}</OpsButton>
          <div style={{ display: 'flex', gap: 5 }}><OpsButton onClick={selectFiltered} tone="dim">{es ? 'Seleccionar filtro' : 'Select filtered'}</OpsButton><OpsButton onClick={clearSelected} tone="dim">{es ? 'Limpiar' : 'Clear'}</OpsButton></div>
        </div>}

        {loading ? <div style={{ padding: 30, textAlign: 'center', color: OPS.dim }}>Loading…</div> : groups.length === 0 ? <div style={{ padding: 30, textAlign: 'center', background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, color: OPS.green }}>{es ? 'No hay trabajos abiertos para estos filtros.' : 'No open jobs for these filters.'}</div> : groups.map(([group, items]) => <div key={group} style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0e2344', borderBottom: `1px solid ${OPS.border}` }}><div style={{ fontWeight: 900, color: OPS.text }}>📍 {group}</div><div style={{ fontSize: 10, color: OPS.dim }}>{items.length} {es ? 'trabajos' : 'jobs'}</div></div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>{items.map(job => {
            const rec = recommendTech(job);
            const isLocked = Boolean(locks[job.id]);
            const isSelected = Boolean(selectedJobs[job.id]);
            return <div key={job.id} draggable={!readOnly && !isLocked} onDragStart={() => setDragJob(job)} onDragEnd={() => setDragJob(null)} style={{ display: 'grid', gridTemplateColumns: '32px minmax(180px,1fr) minmax(140px,190px) auto', gap: 8, alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${OPS.border}`, background: dragJob?.id === job.id ? '#102b50' : isSelected ? '#092944' : isLocked ? '#211c08' : 'transparent' }} className="dispatch-job-row">
              <input type="checkbox" checked={isSelected} onChange={() => setJobSelected(String(job.id))} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontWeight: 900, color: OPS.blue }}>#{job.job_id}</span><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: '#162e58', color: '#dbe8ff' }}>{job.type || 'General'}</span>{isLocked && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: '#ffbe0022', color: OPS.yellow }}>🔒 locked</span>}</div>
                <div style={{ fontSize: 11, color: OPS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{job.address}</div>
                <div style={{ fontSize: 9, color: OPS.dim, marginTop: 2 }}>{job.tech_id ? `${es ? 'Asignado a' : 'Assigned to'} #${job.tech_id}` : (es ? 'Sin asignar' : 'Unassigned')} · {job.city || 'No city'} · {job.status}</div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: OPS.green }}>{es ? 'Sugerido' : 'Suggested'}: #{rec?.tech?.id || '-'} {rec?.tech?.name || ''}</span>
                  <input value={notes[job.id] || ''} onChange={e => updateLocalNote(job.id, e.target.value)} placeholder={es ? 'Nota dispatch local' : 'Local dispatch note'} style={{ ...fieldStyle, fontSize: 9, padding: '5px 7px', maxWidth: 220 }} />
                </div>
              </div>
              <select disabled={readOnly || busy === job.id || isLocked} value={job.tech_id || ''} onChange={e => doAssign(job, e.target.value)} style={{ ...fieldStyle, width: '100%' }}><option value="">{es ? 'Seleccionar técnico' : 'Select technician'}</option>{techs.map(t => <option key={t.id} value={t.id}>{t.name} · #{t.id}</option>)}</select>
              {!readOnly && <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}><OpsButton disabled={busy === job.id || isLocked} onClick={() => doSmartAssign(job)} tone="green">{busy === job.id ? '…' : 'Smart'}</OpsButton><OpsButton disabled={busy === job.id || isLocked} onClick={() => doAuto(job)} tone="purple">{busy === job.id ? '…' : es ? 'Auto' : 'Auto'}</OpsButton><OpsButton onClick={() => toggleLock(job)} tone={isLocked ? 'yellow' : 'dim'}>{isLocked ? '🔓' : '🔒'}</OpsButton></div>}
            </div>;
          })}</div>
        </div>)}

        {showLog && <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, padding: 12 }}>
          <button onClick={() => setShowLog(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', background: 'transparent', border: 0, color: OPS.text, fontWeight: 900, cursor: 'pointer', padding: 0 }}><span>🧾 {es ? 'Historial reciente de dispatch' : 'Recent dispatch history'}</span><span>▲</span></button>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>{dispatchLogs.length === 0 ? <div style={{ color: OPS.dim, fontSize: 11 }}>{es ? 'Sin cambios recientes.' : 'No recent dispatch changes.'}</div> : dispatchLogs.map((log: any) => <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: 8, fontSize: 10, color: OPS.dim, borderTop: `1px solid ${OPS.border}`, paddingTop: 6 }}><span>{new Date(log.created_at).toLocaleString()}</span><span style={{ color: OPS.text }}>{log.metadata?.summary || log.action}</span><span style={{ color: log.sync_status === 'synced' ? OPS.green : OPS.yellow }}>{log.sync_status}</span></div>)}</div>
        </div>}

        {!showLog && <OpsButton onClick={() => setShowLog(true)} tone="dim">🧾 {es ? 'Ver historial dispatch' : 'Show dispatch history'}</OpsButton>}

        {!readOnly && <div style={{ background: '#0b1830', border: `1px solid ${OPS.border}`, borderRadius: 13, padding: 12 }}>
          <button onClick={() => setShowRules(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', background: 'transparent', border: 0, color: OPS.text, fontWeight: 900, cursor: 'pointer', padding: 0 }}><span>⚙️ {es ? 'Reglas avanzadas' : 'Advanced rules'}</span><span>{showRules ? '▲' : '▼'}</span></button>
          {showRules && <div style={{ marginTop: 12 }}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 90px auto', gap: 7, marginBottom: 10 }} className="dispatch-rule-grid"><input value={ruleForm.service_type} onChange={e => setRuleForm(f => ({ ...f, service_type: e.target.value }))} placeholder="Service type" style={fieldStyle} /><select value={ruleForm.technician_id} onChange={e => setRuleForm(f => ({ ...f, technician_id: e.target.value }))} style={fieldStyle}><option value="">Technician</option>{techs.map(t => <option value={t.id} key={t.id}>{t.name} · #{t.id}</option>)}</select><input value={ruleForm.specialty} onChange={e => setRuleForm(f => ({ ...f, specialty: e.target.value }))} placeholder="Specialty" style={fieldStyle} /><input type="number" min="1" value={ruleForm.priority} onChange={e => setRuleForm(f => ({ ...f, priority: e.target.value }))} style={fieldStyle} /><OpsButton onClick={addRule} tone="green">Add</OpsButton></div>{rules.length === 0 ? <div style={{ color: OPS.dim, fontSize: 11 }}>No rules.</div> : rules.map(r => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${OPS.border}` }}><div style={{ fontSize: 11, color: OPS.text }}><b>{r.service_type || 'Any service'}</b> → Tech #{r.technician_id || 'best available'} · priority {r.priority}</div><OpsButton onClick={async () => { await deactivateDispatchRule(r.id); load(); }} tone="red">Disable</OpsButton></div>)}</div>}
        </div>}
      </section>
    </div>
    <style>{`@media(max-width:1000px){.dispatch-simple-grid{grid-template-columns:1fr!important}.dispatch-simple-grid aside{position:static!important}} @media(max-width:780px){.dispatch-filters,.dispatch-bulkbar,.dispatch-rule-grid{grid-template-columns:1fr!important}.dispatch-job-row{grid-template-columns:32px 1fr!important}.dispatch-job-row>select,.dispatch-job-row>div:last-child{grid-column:2!important}}`}</style>
  </OpsPage>;
}
