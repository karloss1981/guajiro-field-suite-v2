// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { getTechsByRegion } from '../../../config/regions';
import { createAuditLog } from '../../../services/audit.service';
import {
  analyzeRitWorkbook,
  exportRitWorkbook,
  jobsFromDraft,
  loadRitCandidates,
  loadRitDrafts,
  publishRitDraft,
  saveRitDraft,
  type RitImportAnalysis,
  type RitPoolJob,
} from '../../../services/routeIntelligence.service';
import { exportLocalOperationsBackup, getRitStorageMode } from '../../../services/localRitStore.service';
import './RouteIntelligencePage.css';

const clean = (value: unknown) => String(value ?? '').trim();
const jobIdOf = (value: unknown) => clean(value).replace(/\.0$/, '').replace(/\s+/g, '');

function sourceLabel(source: string, es: boolean) {
  const labels: Record<string, [string, string]> = {
    new_route: ['Nuevo', 'New'],
    matched_past_pending: ['Pendiente detectado', 'Past pending match'],
    carryover_pending: ['Pendiente acumulado', 'Carryover pending'],
    existing_route: ['Ya en la suite', 'Already in suite'],
    resolved_reference: ['Resuelto anteriormente', 'Previously resolved'],
    cancelled_reference: ['Cancelado anteriormente', 'Previously cancelled'],
  };
  return labels[source]?.[es ? 0 : 1] || source;
}

function sourceColor(source: string) {
  if (source === 'matched_past_pending') return '#ffbe00';
  if (source === 'carryover_pending') return '#ff4055';
  if (source === 'existing_route') return '#9d5fff';
  if (source === 'resolved_reference') return '#00dc85';
  if (source === 'cancelled_reference') return '#ff6b7b';
  return '#00b8f5';
}

function normalizeOrders(items: RitPoolJob[]) {
  const byTech = new Map<string, RitPoolJob[]>();
  items.forEach((job) => {
    const tech = clean(job.assigned_tech_id) || '__unassigned__';
    byTech.set(tech, [...(byTech.get(tech) || []), job]);
  });
  const normalized: RitPoolJob[] = [];
  byTech.forEach((group) => {
    group
      .sort((a, b) => Number(a.route_order || 0) - Number(b.route_order || 0))
      .forEach((job, index) => normalized.push({ ...job, route_order: index + 1 }));
  });
  const orderByKey = new Map(normalized.map((job) => [job.key, job.route_order]));
  return items.map((job) => ({ ...job, route_order: orderByKey.get(job.key) || job.route_order || 1 }));
}

function groupKey(job: RitPoolJob, mode: string) {
  const city = clean(job.city) || 'Unknown City';
  const zip = clean(job.zip) || 'No ZIP';
  if (mode === 'city') return city;
  if (mode === 'zip') return zip;
  return `${city} · ${zip}`;
}

function clusterKey(job: RitPoolJob) {
  return `${clean(job.city) || 'Unknown City'}|${clean(job.zip) || 'No ZIP'}`;
}

function isSpecialCategory(job: RitPoolJob) {
  const text = `${clean(job.work_type || job.type)} ${clean(job.imported_note)} ${clean(job.rit_note)}`.toLowerCase();
  return /(aerial|mdu|811|cancel(?:led)?|locate|permit|engineering|special)/.test(text);
}

function JobCard({ job, techs, es, compact = false, onAssign, onUnlock, onUnassign, onExclude, onMove, onDragStart, onDropBefore }) {
  const color = sourceColor(job.source_kind);
  const typeClass = job.source_kind === 'carryover_pending' ? 'carryover'
    : job.source_kind === 'matched_past_pending' ? 'pending'
      : job.source_kind === 'existing_route' ? 'existing' : 'new';
  return <div
    className={`rit-job-card ${typeClass} ${job.manual_locked ? 'locked' : ''}`}
    draggable={!job.manual_locked}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; onDragStart(job.key); }}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDropBefore?.(job.key); }}
  >
    <div className="rit-job-row">
      <div className="rit-job-id">#{job.job_id}</div>
      <div className="rit-job-badges">
        <span className="rit-badge" style={{ color }}>{sourceLabel(job.source_kind, es)}</span>
        {job.manual_locked && <span className="rit-badge" style={{ color: '#c8acff' }}>🔒 {es ? 'Fijo' : 'Locked'}</span>}
      </div>
    </div>
    <div className="rit-job-address">{job.address}{job.city ? `, ${job.city}` : ''} {job.zip || ''}</div>
    <div className="rit-job-meta">
      {job.rit_flag || sourceLabel(job.source_kind, es)}
      {job.occurrence_count ? ` · ${job.occurrence_count} ${es ? 'intento(s)' : 'attempt(s)'}` : ''}
      {job.latest_reason || job.original_reason ? <><br />{job.latest_reason || job.original_reason}</> : null}
    </div>
    <div className="rit-card-actions">
      {!compact && <select
        className="rit-select"
        style={{ padding: '5px 7px', fontSize: 9, flex: '1 1 135px' }}
        value={job.assigned_tech_id || ''}
        onChange={(event) => onAssign(job.key, event.target.value, job.manual_locked)}
      >
        <option value="">{es ? 'Sin asignar' : 'Unassigned'}</option>
        {techs.map((tech) => <option key={tech.id} value={tech.id}>#{tech.id} · {tech.name}</option>)}
      </select>}
      {job.manual_locked
        ? <button className="rit-mini" onClick={() => onUnlock(job.key)}>🔓 {es ? 'Desbloquear' : 'Unlock'}</button>
        : job.assigned_tech_id && <button className="rit-mini" onClick={() => onUnassign(job.key)}>↩ {es ? 'Quitar' : 'Unassign'}</button>}
      {job.assigned_tech_id && <>
        <button className="rit-mini" onClick={() => onMove(job.key, -1)}>↑</button>
        <button className="rit-mini" onClick={() => onMove(job.key, 1)}>↓</button>
      </>}
      <button className="rit-mini" onClick={() => onExclude(job.key)}>✕ {es ? 'Excluir' : 'Exclude'}</button>
    </div>
  </div>;
}

function ZipWorkloadMap({ jobs, selectedCluster, onSelect, es }) {
  const clusters = useMemo(() => {
    const map = new Map<string, RitPoolJob[]>();
    jobs.filter((job) => job.include !== false).forEach((job) => {
      const key = clusterKey(job);
      map.set(key, [...(map.get(key) || []), job]);
    });
    return Array.from(map.entries()).map(([key, cluster]) => {
      const [city, zip] = key.split('|');
      return {
        key, city, zip, jobs: cluster,
        total: cluster.length,
        pending: cluster.filter((job) => ['matched_past_pending', 'carryover_pending'].includes(job.source_kind)).length,
        assigned: cluster.filter((job) => clean(job.assigned_tech_id)).length,
      };
    }).sort((a, b) => b.total - a.total || a.city.localeCompare(b.city)).slice(0, 36);
  }, [jobs]);

  const cols = clusters.length <= 8 ? 4 : clusters.length <= 15 ? 5 : 6;
  const rows = Math.max(1, Math.ceil(clusters.length / cols));
  const width = 760;
  const height = Math.max(250, rows * 112 + 28);
  return <div className="rit-map-wrap">
    <div className="rit-map-head">
      <div>
        <div className="rit-map-title">🗺️ {es ? 'Mapa operativo por ZIP' : 'Operational ZIP map'}</div>
        <div className="rit-map-note">{es ? 'Agrupación visual por ciudad/ZIP para repartir por cercanía. No es navegación de calles.' : 'Visual city/ZIP clustering for proximity assignment. This is not street navigation.'}</div>
      </div>
      {selectedCluster && <button className="rit-mini" onClick={() => onSelect('')}>{es ? 'Mostrar todos' : 'Show all'}</button>}
    </div>
    {clusters.length === 0 ? <div className="rit-empty-drop">{es ? 'No hay trabajos para mostrar.' : 'No jobs to display.'}</div> : <svg className="rit-map-svg" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <filter id="ritGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {clusters.map((cluster, index) => {
        const column = index % cols;
        const row = Math.floor(index / cols);
        const x = 70 + column * ((width - 140) / Math.max(1, cols - 1));
        const y = 65 + row * 108;
        const radius = Math.min(46, 24 + cluster.total * 3.1);
        const allAssigned = cluster.assigned === cluster.total;
        const color = cluster.pending > 0 ? '#ff8a00' : allAssigned ? '#00dc85' : '#00b8f5';
        const active = selectedCluster === cluster.key;
        return <g key={cluster.key} onClick={() => onSelect(cluster.key)} style={{ cursor: 'pointer' }} filter={active ? 'url(#ritGlow)' : undefined}>
          <circle cx={x} cy={y} r={radius + (active ? 5 : 0)} fill={`${color}25`} stroke={color} strokeWidth={active ? 4 : 2}/>
          <text x={x} y={y - 8} textAnchor="middle" fill="#eef6ff" fontSize="13" fontWeight="800">{cluster.zip}</text>
          <text x={x} y={y + 9} textAnchor="middle" fill={color} fontSize="17" fontWeight="900">{cluster.total}</text>
          <text x={x} y={y + 26} textAnchor="middle" fill="#8da9ca" fontSize="8">{cluster.city.slice(0, 18)}</text>
          {cluster.pending > 0 && <text x={x} y={y + radius + 13} textAnchor="middle" fill="#ffbe55" fontSize="8">⚠ {cluster.pending} pending</text>}
        </g>;
      })}
    </svg>}
    <div className="rit-actions" style={{ marginTop: 7, fontSize: 9, color: '#7895bb' }}>
      <span>🔵 {es ? 'Nuevos/sin asignar' : 'New/unassigned'}</span><span>🟠 {es ? 'Incluye pendientes' : 'Contains pending'}</span><span>🟢 {es ? 'Todo asignado' : 'Fully assigned'}</span>
    </div>
  </div>;
}

export default function RouteIntelligencePage({ region, lang, actorName = 'supervisor', readOnly = false, onPublished }) {
  const es = lang === 'es';
  const techs = getTechsByRegion(region);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [poolCandidates, setPoolCandidates] = useState<RitPoolJob[]>([]);
  const [jobs, setJobs] = useState<RitPoolJob[]>([]);
  const [excluded, setExcluded] = useState<RitPoolJob[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<RitImportAnalysis | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [groupMode, setGroupMode] = useState('city_zip');
  const [clusterFilter, setClusterFilter] = useState('');
  const [laneSearch, setLaneSearch] = useState('');
  const [showAllTechs, setShowAllTechs] = useState(true);
  const [routeDate, setRouteDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); });
  const [routeName, setRouteName] = useState(es ? 'Ruta Comcast + pendientes' : 'Comcast route + past pending');
  const [draggedKey, setDraggedKey] = useState('');
  const [dragOverTech, setDragOverTech] = useState('');
  const [preassignTech, setPreassignTech] = useState(region === 'miami' ? '6017' : techs[0]?.id || '');
  const [preassignIds, setPreassignIds] = useState('');
  const [preassignLocked, setPreassignLocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [activeDraft, setActiveDraft] = useState<any | null>(null);
  const [storageMode, setStorageMode] = useState<'local'|'remote'>(() => getRitStorageMode());
  const [manualReservations, setManualReservations] = useState<Record<string,string[]>>({});
  const [techAreas, setTechAreas] = useState<Record<string,string>>({});

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 5000);
  };

  const loadBase = async () => {
    setLoading(true); setError('');
    try {
      const [pool, draftRows] = await Promise.all([loadRitCandidates(region), loadRitDrafts(region)]);
      setPoolCandidates(pool);
      setDrafts(draftRows);
      setStorageMode(getRitStorageMode());
    } catch (caught: any) {
      setError(caught?.message || String(caught));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    setPreassignTech(region === 'miami' ? '6017' : getTechsByRegion(region)[0]?.id || '');
    setJobs([]); setExcluded([]); setAnalysis(null); setSourceFile(null); setActiveDraft(null); setDirty(false);
    loadBase();
  }, [region]);

  useEffect(() => {
    try {
      setManualReservations(JSON.parse(localStorage.getItem(`gfs_rit_reservations_${region}`) || '{}'));
      setTechAreas(JSON.parse(localStorage.getItem(`gfs_rit_areas_${region}`) || '{}'));
    } catch {
      setManualReservations({}); setTechAreas({});
    }
  }, [region]);

  useEffect(() => { try { localStorage.setItem(`gfs_rit_reservations_${region}`, JSON.stringify(manualReservations)); } catch {} }, [manualReservations, region]);
  useEffect(() => { try { localStorage.setItem(`gfs_rit_areas_${region}`, JSON.stringify(techAreas)); } catch {} }, [techAreas, region]);

  const includedJobs = useMemo(() => jobs.filter((job) => job.include !== false), [jobs]);
  const assignedJobs = useMemo(() => includedJobs.filter((job) => clean(job.assigned_tech_id)), [includedJobs]);
  const unassignedJobs = useMemo(() => includedJobs.filter((job) => !clean(job.assigned_tech_id)), [includedJobs]);
  const pendingJobs = useMemo(() => includedJobs.filter((job) => ['matched_past_pending', 'carryover_pending'].includes(job.source_kind)), [includedJobs]);
  const lockedJobs = useMemo(() => includedJobs.filter((job) => job.manual_locked), [includedJobs]);
  const mainRouteJobs = useMemo(() => includedJobs.filter((job) => !isSpecialCategory(job)), [includedJobs]);
  const specialJobs = useMemo(() => includedJobs.filter((job) => isSpecialCategory(job)), [includedJobs]);
  const unassignedMainJobs = useMemo(() => mainRouteJobs.filter((job) => !clean(job.assigned_tech_id)), [mainRouteJobs]);

  const mutateJobs = (updater) => {
    setJobs((previous) => normalizeOrders(typeof updater === 'function' ? updater(previous) : updater));
    setDirty(true); setActiveDraft(null);
  };

  const handleImport = async (file: File) => {
    setProcessing(true); setError('');
    try {
      const result = await analyzeRitWorkbook(file, region, routeDate);
      const reservedByJob = new Map<string,string>();
      Object.entries(manualReservations).forEach(([techId, ids]) => ids.forEach((id) => reservedByJob.set(jobIdOf(id), techId)));
      const importedJobs = result.jobs.map((job) => {
        const reservedTech = reservedByJob.get(jobIdOf(job.job_id));
        return reservedTech ? { ...job, assigned_tech_id: reservedTech, manual_locked: true, rit_note: `${job.rit_note || ''}${job.rit_note ? ' · ' : ''}Reserved before import for Tech #${reservedTech}` } : job;
      });
      const importedIdSet = new Set(importedJobs.map((job) => jobIdOf(job.job_id)));
      setManualReservations((previous) => Object.fromEntries(Object.entries(previous).map(([techId, ids]) => [techId, ids.filter((id) => !importedIdSet.has(jobIdOf(id)))])));
      setAnalysis(result); setSourceFile(file); setJobs(normalizeOrders(importedJobs)); setExcluded(result.excluded);
      setRouteName(`${file.name.replace(/\.[^.]+$/, '')} + Past Pending`);
      setActiveDraft(null); setDirty(true); setClusterFilter('');
      await createAuditLog({ action: 'rit_excel_analyzed', entity: 'rit_workspace', metadata: { region, routeDate, actorName, filename: file.name, ...result.summary } });
      flash(es ? `Excel analizado: ${result.jobs.length} trabajos disponibles y ${result.excluded.length} separados para revisión.` : `Excel analyzed: ${result.jobs.length} route candidates and ${result.excluded.length} separated for review.`);
    } catch (caught: any) {
      setError(caught?.message || String(caught));
    } finally { setProcessing(false); }
  };

  const buildFromPool = () => {
    if (!poolCandidates.length) { flash(es ? 'El pool activo está vacío.' : 'The active pool is empty.'); return; }
    setJobs(normalizeOrders(poolCandidates)); setExcluded([]); setAnalysis(null); setSourceFile(null); setActiveDraft(null); setDirty(true);
    setRouteName(es ? 'Ruta de recuperación desde pool' : 'Recovery route from pool');
    flash(es ? 'Se cargó el pool activo como borrador de ruta.' : 'The active pool was loaded as a route workspace.');
  };

  const assignJob = (key: string, technicianId: string, preserveLock = false) => mutateJobs((previous) => previous.map((job) => job.key === key ? {
    ...job,
    assigned_tech_id: technicianId,
    manual_locked: preserveLock ? job.manual_locked : false,
    route_order: technicianId ? Math.max(0, ...previous.filter((candidate) => candidate.assigned_tech_id === technicianId).map((candidate) => Number(candidate.route_order || 0))) + 1 : 1,
  } : job));

  const unlockJob = (key: string) => mutateJobs((previous) => previous.map((job) => job.key === key ? { ...job, manual_locked: false } : job));
  const unassignJob = (key: string) => mutateJobs((previous) => previous.map((job) => job.key === key ? { ...job, assigned_tech_id: '', manual_locked: false, route_order: 1 } : job));
  const excludeJob = (key: string) => {
    const target = jobs.find((job) => job.key === key);
    if (!target) return;
    mutateJobs((previous) => previous.filter((job) => job.key !== key));
    setExcluded((previous) => [{ ...target, include: false, rit_flag: `${target.rit_flag || ''} · MANUALLY EXCLUDED` }, ...previous]);
  };
  const restoreExcluded = (key: string) => {
    const target = excluded.find((job) => job.key === key);
    if (!target) return;
    if (['resolved_reference', 'cancelled_reference'].includes(target.source_kind) && !window.confirm(es ? 'Este Job ID aparece como resuelto o cancelado. ¿Incluirlo de todas maneras?' : 'This Job ID appears resolved or cancelled. Include it anyway?')) return;
    setExcluded((previous) => previous.filter((job) => job.key !== key));
    mutateJobs((previous) => [...previous, { ...target, include: true, assigned_tech_id: '', manual_locked: false, route_order: previous.length + 1, rit_flag: `${target.rit_flag} · OVERRIDE` }]);
  };

  const moveJob = (key: string, direction: number) => mutateJobs((previous) => {
    const target = previous.find((job) => job.key === key);
    if (!target?.assigned_tech_id) return previous;
    const group = previous.filter((job) => job.assigned_tech_id === target.assigned_tech_id).sort((a, b) => Number(a.route_order) - Number(b.route_order));
    const index = group.findIndex((job) => job.key === key);
    const swap = group[index + direction];
    if (!swap) return previous;
    return previous.map((job) => job.key === key ? { ...job, route_order: swap.route_order } : job.key === swap.key ? { ...job, route_order: target.route_order } : job);
  });

  const dropOnTech = (technicianId: string) => {
    if (!draggedKey) return;
    const dragged = jobs.find((job) => job.key === draggedKey);
    if (dragged?.manual_locked && dragged.assigned_tech_id !== technicianId) { flash(es ? 'Desbloquea el trabajo antes de moverlo.' : 'Unlock the job before moving it.'); return; }
    assignJob(draggedKey, technicianId, false);
    setDraggedKey(''); setDragOverTech('');
  };

  const dropBefore = (targetKey: string) => {
    if (!draggedKey || draggedKey === targetKey) return;
    mutateJobs((previous) => {
      const dragged = previous.find((job) => job.key === draggedKey);
      const target = previous.find((job) => job.key === targetKey);
      if (!dragged || !target || dragged.manual_locked) return previous;
      const targetOrder = Number(target.route_order || 1);
      return previous.map((job) => job.key === draggedKey ? { ...job, assigned_tech_id: target.assigned_tech_id, route_order: targetOrder - 0.5 } : job);
    });
    setDraggedKey(''); setDragOverTech('');
  };

  const bulkAssign = () => {
    if (!preassignTech) { flash(es ? 'Selecciona un técnico.' : 'Select a technician.'); return; }
    const ids = Array.from(new Set(preassignIds.split(/[\s,;|]+/).map(jobIdOf).filter(Boolean)));
    if (!ids.length) { flash(es ? 'Escribe o pega los Job IDs.' : 'Type or paste Job IDs.'); return; }
    const found = new Set<string>();
    mutateJobs((previous) => previous.map((job) => {
      if (!ids.includes(jobIdOf(job.job_id))) return job;
      found.add(jobIdOf(job.job_id));
      return {
        ...job,
        assigned_tech_id: preassignTech,
        manual_locked: preassignLocked,
        route_order: previous.filter((candidate) => candidate.assigned_tech_id === preassignTech).length + found.size,
        rit_note: `${job.rit_note || ''}${job.rit_note ? ' · ' : ''}Manual preassignment to Tech #${preassignTech}`,
      };
    }));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      setManualReservations((previous) => ({
        ...previous,
        [preassignTech]: Array.from(new Set([...(previous[preassignTech] || []), ...missing])),
      }));
    }
    setPreassignIds('');
    flash(missing.length
      ? (es ? `${found.size} asignados ahora y ${missing.length} reservados para cuando aparezcan en una ruta futura.` : `${found.size} assigned now and ${missing.length} reserved for a future route import.`)
      : (es ? `${found.size} trabajos asignados${preassignLocked ? ' y bloqueados' : ''}.` : `${found.size} jobs assigned${preassignLocked ? ' and locked' : ''}.`));
  };


  const removeReservation = (techId: string, jobId: string) => {
    setManualReservations((previous) => ({
      ...previous,
      [techId]: (previous[techId] || []).filter((id) => jobIdOf(id) !== jobIdOf(jobId)),
    }));
  };


  const autoOrder = () => mutateJobs((previous) => {
    const sortedByTech = [...previous].sort((a, b) => {
      const techCompare = clean(a.assigned_tech_id).localeCompare(clean(b.assigned_tech_id));
      if (techCompare) return techCompare;
      const cityCompare = clean(a.city).localeCompare(clean(b.city));
      if (cityCompare) return cityCompare;
      const zipCompare = clean(a.zip).localeCompare(clean(b.zip));
      if (zipCompare) return zipCompare;
      return clean(a.address).localeCompare(clean(b.address));
    });
    const counters = new Map<string, number>();
    const orderMap = new Map<string, number>();
    sortedByTech.forEach((job) => {
      const tech = clean(job.assigned_tech_id) || '__unassigned__';
      const next = (counters.get(tech) || 0) + 1;
      counters.set(tech, next); orderMap.set(job.key, next);
    });
    return previous.map((job) => ({ ...job, route_order: orderMap.get(job.key) || job.route_order }));
  });

  const filteredBacklog = useMemo(() => unassignedJobs.filter((job) => !isSpecialCategory(job)).filter((job) => {
    const text = `${job.job_id} ${job.address} ${job.city} ${job.zip} ${job.latest_reason || ''}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (sourceFilter !== 'all' && job.source_kind !== sourceFilter) return false;
    if (clusterFilter && clusterKey(job) !== clusterFilter) return false;
    return true;
  }), [unassignedJobs, search, sourceFilter, clusterFilter]);

  const groupedBacklog = useMemo(() => {
    const map = new Map<string, RitPoolJob[]>();
    filteredBacklog.forEach((job) => {
      const key = groupKey(job, groupMode);
      map.set(key, [...(map.get(key) || []), job]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredBacklog, groupMode]);

  const visibleTechs = useMemo(() => {
    const query = laneSearch.toLowerCase();
    const quickIds = new Set([preassignTech, region === 'miami' ? '6017' : '', region === 'miami' ? '8807' : ''].filter(Boolean));
    return techs.filter((tech) => {
      const hasJobs = assignedJobs.some((job) => job.assigned_tech_id === tech.id);
      const visible = showAllTechs || hasJobs || quickIds.has(tech.id);
      return visible && (!query || `${tech.id} ${tech.name}`.toLowerCase().includes(query));
    }).sort((a, b) => {
      const aCount = assignedJobs.filter((job) => job.assigned_tech_id === a.id).length;
      const bCount = assignedJobs.filter((job) => job.assigned_tech_id === b.id).length;
      return bCount - aCount || a.name.localeCompare(b.name);
    });
  }, [techs, assignedJobs, showAllTechs, laneSearch, preassignTech, region]);

  const saveCurrentDraft = async () => {
    if (!includedJobs.length) throw new Error(es ? 'No hay trabajos en el espacio de trabajo.' : 'There are no jobs in the workspace.');
    const draft = await saveRitDraft({
      region, routeDate, name: routeName, actor: actorName, jobs: includedJobs,
      sourceFilename: analysis?.filename || sourceFile?.name,
      excludedCount: excluded.length,
    });
    setActiveDraft(draft); setDirty(false);
    await createAuditLog({ action: 'rit_draft_created', entity: 'rit_route_draft', entityId: draft.id, metadata: { region, routeDate, count: includedJobs.length, filename: analysis?.filename || sourceFile?.name, actorName } });
    await loadBase();
    return draft;
  };

  const handleSave = async () => {
    if (readOnly) return;
    setProcessing(true);
    try { await saveCurrentDraft(); flash(es ? 'Borrador RIT guardado.' : 'RIT draft saved.'); }
    catch (caught: any) { setError(caught?.message || String(caught)); }
    finally { setProcessing(false); }
  };

  const handlePublish = async () => {
    if (readOnly) return;
    if (unassignedMainJobs.length) { flash(es ? `Faltan ${unassignedMainJobs.length} trabajos diarios por asignar.` : `${unassignedMainJobs.length} daily-route jobs are still unassigned.`); return; }
    if (!window.confirm(es ? `¿Publicar ${mainRouteJobs.length} trabajos diarios en la ruta ${routeDate}?` : `Publish ${mainRouteJobs.length} daily-route jobs to route ${routeDate}?`)) return;
    setProcessing(true); setError('');
    try {
      const draft = (!activeDraft || dirty) ? await saveCurrentDraft() : activeDraft;
      const result = await publishRitDraft({ draftId: draft.id, region, routeDate, actor: actorName, jobs: mainRouteJobs });
      await createAuditLog({ action: 'rit_route_published', entity: 'rit_route_draft', entityId: draft.id, metadata: { region, routeDate, ...result, actorName } });
      flash(es ? `Ruta publicada: ${result.inserted} nuevos, ${result.updated} actualizados, ${result.skipped} omitidos.` : `Route published: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped.`);
      setActiveDraft(null); setDirty(false); await loadBase(); onPublished?.();
    } catch (caught: any) { setError(caught?.message || String(caught)); }
    finally { setProcessing(false); }
  };

  const handleLocalBackup = async () => {
    const backup = await exportLocalOperationsBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gfs-rit-local-backup-${new Date().toLocaleDateString('en-CA')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash(es ? 'Respaldo local descargado.' : 'Local backup downloaded.');
  };

  const handleExport = () => {
    if (!includedJobs.length) { flash(es ? 'No hay trabajos para exportar.' : 'There are no jobs to export.'); return; }
    const filename = exportRitWorkbook({ jobs: includedJobs, excluded, region, routeDate, routeName, sourceFilename: analysis?.filename || sourceFile?.name });
    createAuditLog({ action: 'rit_excel_exported', entity: 'rit_workspace', metadata: { region, routeDate, filename, jobs: includedJobs.length, excluded: excluded.length, actorName } });
    flash(es ? `Documento creado: ${filename}` : `Workbook created: ${filename}`);
  };

  const loadDraft = (draft: any) => {
    const restored = jobsFromDraft(draft);
    setJobs(restored); setExcluded([]); setAnalysis(null); setSourceFile(null); setRouteDate(draft.route_date); setRouteName(draft.name); setActiveDraft(draft); setDirty(false);
    flash(es ? 'Borrador cargado.' : 'Draft loaded.');
  };

  const stats = [
    [es ? 'Ruta total' : 'Route total', includedJobs.length, '#00b8f5'],
    [es ? 'Pendientes históricos' : 'Past pending', pendingJobs.length, '#ff8a00'],
    [es ? 'Asignados' : 'Assigned', assignedJobs.length, '#00dc85'],
    [es ? 'Sin asignar' : 'Unassigned', unassignedJobs.length, '#ff4055'],
    [es ? 'Preasignados fijos' : 'Locked preassignments', lockedJobs.length, '#9d5fff'],
    [es ? 'Separados/revisión' : 'Excluded/review', excluded.length, '#ffbe00'],
  ];

  return <div className="rit-page rit-v151">
    {message && <div className="rit-toast">{message}</div>}

    <section className="rit-panel rit-v151-header">
      <div>
        <div className="rit-title">RIT · Daily Route Builder <span className="rit-version-badge">v15.2</span></div>
        <div className="rit-subtitle">{es
          ? 'Carga solamente la ruta nueva de Comcast. RIT identifica automáticamente los Job IDs con historial Not Done/Past Pending y muestra las notas de visitas anteriores.'
          : 'Load only the new Comcast route. RIT automatically identifies Job IDs with Not Done/Past Pending history and shows prior visit notes.'}</div>
      </div>
      <div className="rit-actions">
        <button className="rit-button blue" onClick={() => fileInput.current?.click()} disabled={processing}>📥 {es ? 'Importar ruta nueva' : 'Import new route'}</button>
        {storageMode==='local'&&<button className="rit-button dim" onClick={handleLocalBackup}>💾 {es?'Respaldar':'Backup'}</button>}
        <input ref={fileInput} className="rit-hidden-input" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file); event.currentTarget.value = ''; }}/>
      </div>
    </section>

    {error && <div className="rit-alert error">❌ {error}</div>}
    {storageMode==='local'&&<div className="rit-alert warn">💾 {es?'Modo fácil: los borradores se guardan en este navegador.':'Easy mode: drafts are stored in this browser.'}</div>}

    <section className="rit-panel rit-v151-import">
      <div>
        <div className="rit-panel-title">1. {es ? 'Ruta nueva de Comcast' : 'New Comcast route'}</div>
        <div className="rit-column-sub">{analysis
          ? `${analysis.filename} · ${includedJobs.length} jobs · ${pendingJobs.length} con historial · ${specialJobs.length} categorías especiales`
          : (es ? 'Selecciona el Excel diario. No se cargarán los 420 pendientes históricos: solo los trabajos que realmente aparecen en este archivo.' : 'Choose the daily Excel. The full historical pool will not be loaded: only jobs actually present in this file.')}</div>
      </div>
      <div className="rit-route-settings-inline">
        <input className="rit-input" type="date" value={routeDate} onChange={(event) => setRouteDate(event.target.value)}/>
        <input className="rit-input" value={routeName} onChange={(event) => setRouteName(event.target.value)} placeholder={es?'Nombre de la ruta':'Route name'}/>
      </div>
    </section>

    <section className="rit-panel rit-v151-preassign">
      <div>
        <div className="rit-panel-title">2. {es ? 'Reservar Job IDs para un técnico' : 'Reserve Job IDs for a technician'}</div>
        <div className="rit-column-sub">{es
          ? 'Puedes escribir Job IDs aunque todavía no estén en el Excel. Cuando aparezcan en una ruta futura, se asignarán automáticamente.'
          : 'You may enter Job IDs even when they are not in the Excel yet. When they appear in a future route, they will be assigned automatically.'}</div>
      </div>
      <div className="rit-v151-preassign-grid">
        <select className="rit-select" value={preassignTech} onChange={(event) => setPreassignTech(event.target.value)}>
          <option value="">{es ? 'Seleccionar técnico' : 'Select technician'}</option>
          {techs.map((tech) => <option key={tech.id} value={tech.id}>#{tech.id} · {tech.name}</option>)}
        </select>
        <textarea className="rit-textarea rit-v151-textarea" value={preassignIds} onChange={(event) => setPreassignIds(event.target.value)} placeholder={es?'Pega Job IDs separados por espacio, coma o línea':'Paste Job IDs separated by space, comma, or line'}/>
        <button className="rit-button purple" onClick={bulkAssign}>🔒 {es ? 'Guardar reserva / asignar' : 'Save reservation / assign'}</button>
      </div>
      {Object.values(manualReservations).some((ids)=>ids.length>0)&&<div className="rit-v151-reservations">
        {techs.map((tech)=>{
          const ids=manualReservations[tech.id]||[];
          if(!ids.length)return null;
          return <div key={tech.id}><strong>{tech.name}</strong><span>{ids.map((id)=><button key={id} onClick={()=>removeReservation(tech.id,id)}>#{id} ×</button>)}</span></div>;
        })}
      </div>}
    </section>

    {includedJobs.length===0 ? <section className="rit-panel rit-v151-empty">
      <div className="rit-v151-empty-icon">📊</div>
      <div className="rit-panel-title">{es?'Importa la ruta para comenzar':'Import the route to begin'}</div>
      <div className="rit-column-sub">{es?'Después verás técnicos a la izquierda y únicamente los trabajos de esa ruta a la derecha, agrupados por ciudad y ZIP.':'Then you will see technicians on the left and only that route’s jobs on the right, grouped by city and ZIP.'}</div>
    </section> : <>
      <section className="rit-v151-summary">
        <div><b>{includedJobs.length}</b><span>{es?'Ruta nueva':'New route'}</span></div>
        <div><b>{pendingJobs.length}</b><span>{es?'Con historial':'With history'}</span></div>
        <div><b>{assignedJobs.length}</b><span>{es?'Asignados':'Assigned'}</span></div>
        <div><b>{unassignedMainJobs.length}</b><span>{es?'Por repartir':'To assign'}</span></div>
      </section>

      <section className="rit-v151-workspace">
        <aside className="rit-v151-tech-column">
          <div className="rit-v151-column-header">
            <div><div className="rit-panel-title">3. {es?'Técnicos':'Technicians'}</div><div className="rit-column-sub">{es?'Organiza por nombre y área de trabajo.':'Organize by name and work area.'}</div></div>
            <button className="rit-mini" onClick={()=>setShowAllTechs((value)=>!value)}>{showAllTechs?(es?'Solo activos':'Active only'):(es?'Ver todos':'Show all')}</button>
          </div>
          <input className="rit-input" value={laneSearch} onChange={(event)=>setLaneSearch(event.target.value)} placeholder={es?'Buscar técnico':'Search technician'}/>
          <div className="rit-v151-tech-list">
            {visibleTechs.map((tech)=>{
              const techJobs=mainRouteJobs.filter((job)=>job.assigned_tech_id===tech.id).sort((a,b)=>Number(a.route_order)-Number(b.route_order));
              return <div key={tech.id} className={`rit-v151-tech-card ${dragOverTech===tech.id?'drag-over':''}`}
                onDragOver={(event)=>{event.preventDefault();setDragOverTech(tech.id)}}
                onDragLeave={()=>setDragOverTech('')}
                onDrop={(event)=>{event.preventDefault();dropOnTech(tech.id)}}>
                <div className="rit-v151-tech-head"><div><strong>{tech.name}</strong><small>#{tech.id}</small></div><b>{techJobs.length}</b></div>
                <input className="rit-area-input" value={techAreas[tech.id]||''} onChange={(event)=>setTechAreas((previous)=>({...previous,[tech.id]:event.target.value}))} placeholder={es?'Área: ciudad, ZIP o zona':'Area: city, ZIP, or zone'}/>
                <div className="rit-v151-tech-jobs">
                  {techJobs.length===0?<div className="rit-empty-drop">{es?'Suelta trabajos aquí':'Drop jobs here'}</div>:techJobs.map((job)=><div key={job.key} className={`rit-v151-job assigned ${job.source_kind==='matched_past_pending'?'history':''}`} draggable={!job.manual_locked} onDragStart={()=>setDraggedKey(job.key)}>
                    <div><strong>#{job.job_id}</strong><span>{job.city} {job.zip}</span></div>
                    <small>{job.address}</small>
                    {job.source_kind==='matched_past_pending'&&<em>⚠ {job.latest_reason||job.original_reason||'Past Pending'}{job.occurrence_count?` · ${job.occurrence_count} visits`:''}</em>}
                    <button onClick={()=>unassignJob(job.key)}>×</button>
                  </div>)}
                </div>
              </div>;
            })}
          </div>
        </aside>

        <main className="rit-v151-pool-column" onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();if(draggedKey)unassignJob(draggedKey);setDraggedKey('')}}>
          <div className="rit-v151-column-header">
            <div><div className="rit-panel-title">4. {es?'Pool de la ruta nueva':'New route pool'}</div><div className="rit-column-sub">{es?'Solo trabajos del Excel importado, agrupados claramente por ciudad y ZIP.':'Only jobs from the imported Excel, clearly grouped by city and ZIP.'}</div></div>
            <button className="rit-button dim" onClick={autoOrder}>↕ {es?'Ordenar asignados':'Order assigned'}</button>
          </div>
          <div className="rit-v151-pool-filters">
            <input className="rit-input" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder={es?'Buscar Job ID, dirección, ciudad o ZIP':'Search Job ID, address, city, or ZIP'}/>
            <select className="rit-select" value={groupMode} onChange={(event)=>setGroupMode(event.target.value)}><option value="city_zip">{es?'Ciudad + ZIP':'City + ZIP'}</option><option value="city">{es?'Ciudad':'City'}</option><option value="zip">ZIP</option></select>
          </div>
          <div className="rit-v151-city-strip">
            {groupedBacklog.slice(0,18).map(([group,groupJobs])=><button key={group} onClick={()=>setSearch(group.split(' · ')[0])}><b>{groupJobs.length}</b><span>{group}</span></button>)}
          </div>
          <div className="rit-v151-groups">
            {groupedBacklog.length===0?<div className="rit-empty-drop">{es?'No hay trabajos sin asignar.':'No unassigned jobs.'}</div>:groupedBacklog.map(([group,groupJobs])=><section key={group} className="rit-v151-group">
              <header><strong>{group}</strong><span>{groupJobs.length}</span></header>
              <div>{groupJobs.sort((a,b)=>clean(a.address).localeCompare(clean(b.address))).map((job)=><div key={job.key} className={`rit-v151-job pool ${job.source_kind==='matched_past_pending'?'history':''}`} draggable onDragStart={()=>setDraggedKey(job.key)}>
                <div><strong>#{job.job_id}</strong><span>{job.work_type||job.type||''}</span></div>
                <small>{job.address}</small>
                {job.source_kind==='matched_past_pending'&&<em>⚠ {job.latest_reason||job.original_reason||'Past Pending'}{job.occurrence_count?` · ${job.occurrence_count} visits`:''}{job.rit_note?` · ${job.rit_note}`:''}</em>}
                <select value="" onChange={(event)=>{if(event.target.value)assignJob(job.key,event.target.value,false)}}><option value="">{es?'Asignar a…':'Assign to…'}</option>{techs.map((tech)=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>
              </div>)}</div>
            </section>)}
          </div>
        </main>
      </section>

      {specialJobs.length>0&&<section className="rit-panel rit-v151-special">
        <div className="rit-panel-title">5. {es?'Categorías especiales / al final':'Special categories / bottom section'}</div>
        <div className="rit-column-sub">Aerial · MDU · 811 · Cancel · Locate · Permit</div>
        <div>{specialJobs.map((job)=><div key={job.key}><strong>#{job.job_id}</strong><span>{job.city} {job.zip}</span><span>{job.work_type||job.type}</span><small>{job.address}</small></div>)}</div>
      </section>}

      <section className="rit-panel rit-v151-actions">
        <div><div className="rit-panel-title">6. {es?'Guardar, exportar y publicar':'Save, export, and publish'}</div><div className="rit-column-sub">{es?'Primero descarga el XLSX y revísalo. Publica cuando todos los trabajos diarios estén asignados.':'Download and review the XLSX first. Publish after all daily jobs are assigned.'}</div></div>
        <div className="rit-actions">
          <button className="rit-button dim" onClick={handleSave} disabled={processing||readOnly}>💾 {es?'Guardar borrador':'Save draft'}</button>
          <button className="rit-button orange" onClick={handleExport}>⬇ XLSX</button>
          <button className="rit-button blue" onClick={handlePublish} disabled={processing||readOnly||unassignedMainJobs.length>0}>✓ {es?'Publicar ruta':'Publish route'}</button>
        </div>
      </section>
    </>}
  </div>;
}
