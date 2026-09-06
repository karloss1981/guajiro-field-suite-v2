// @ts-nocheck
// GUAJIRO V25.10 — Not Done Pool View
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { buildHash, parseHash } from '../../../legacy/routing';
import { listNotDonePool, resolveNotDonePool } from '../../../services/notDonePool.service';
import { getRitStorageMode } from '../../../services/localRitStore.service';
import { deriveCity, ZONE_EMOJI, ZONE_COLOR, ZONE_ORDER, type ZoneKey } from '../../../services/city.util';
import { feedCharlieLearning } from '../../../services/charlieLearning.service';
import * as XLSX from 'xlsx';

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function getWeekRange(weekKey: string): { start: string; end: string; label: string } {
  const start = new Date(weekKey + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: weekKey,
    end: end.toISOString().slice(0, 10),
    label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
  };
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function getMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function NotDonePoolView({ region, lang, actorName = 'supervisor' }: { region: string; lang: string; actorName?: string }) {
  const es = lang === 'es';
  const [rows, setRows] = useState<any[]>([]);
  const [techs, setTechs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pool' | 'weekly' | 'monthly'>('pool');
  const [weekFilter, setWeekFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [autoChecked, setAutoChecked] = useState(false);
  const [autoRemovedCount, setAutoRemovedCount] = useState(0);
  const [focused, setFocused] = useState(() => decodeURIComponent(parseHash().sub || ''));
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statuses = status === 'active' ? ['open', 'scheduled'] : status === 'all' ? undefined : [status];
      const data = await listNotDonePool(region, statuses);
      setRows(data || []);
    } catch (error) { console.error(error); setRows([]); }
    setLoading(false);
  }, [region, status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await sb.from('technicians').select('tech_id,name').limit(500);
        const map: Record<string, string> = {};
        for (const t of data || []) {
          const id = String((t as any).tech_id || '').trim();
          if (id) map[id] = String((t as any).name || '').trim();
        }
        setTechs(map);
      } catch { /* ignore */ }
    })();
  }, []);

  const techName = useCallback((id: string) => {
    const t = techs[String(id || '').trim()];
    return t || '';
  }, [techs]);

  const autoDetectCompleted = useCallback(async (allRows: any[]) => {
    if (!allRows.length || !sb) return allRows;
    const openJobIds = allRows
      .filter(r => ['open', 'scheduled'].includes(r.current_status))
      .map(r => r.job_id)
      .filter(Boolean);
    if (!openJobIds.length) return allRows;

    try {
      const { data: doneRoutes } = await sb
        .from('routes')
        .select('job_id')
        .eq('region', region)
        .eq('status', 'done')
        .in('job_id', openJobIds);

      const doneJobIds = new Set((doneRoutes || []).map((r: any) => r.job_id));
      if (!doneJobIds.size) return allRows;

      const removed = allRows.filter(r => doneJobIds.has(r.job_id));
      setAutoRemovedCount(removed.length);

      for (const r of removed) {
        await resolveNotDonePool(
          { ...r, region, date: new Date().toLocaleDateString('en-CA'), tech_id: r.latest_technician_id },
          'completed',
          'system_auto',
          es ? 'Auto-detectado como completado' : 'Auto-detected as completed',
        ).catch(() => {});
        feedCharlieLearning({
          event_type: 'resolved_completed',
          region,
          job_id: r.job_id,
          address: r.address,
          city: r.city,
          zip: r.zip,
          reason: r.latest_reason || r.original_reason,
          category: r.inferred_category,
          tech_id: r.latest_technician_id,
          tech_name: techName(r.latest_technician_id),
          occurrence_count: r.occurrence_count,
          metadata: { auto: true },
        });
      }

      return allRows.filter(r => !doneJobIds.has(r.job_id));
    } catch { return allRows; }
  }, [region, es, techName]);

  useEffect(() => {
    if (rows.length && !autoChecked) {
      setAutoChecked(true);
      (async () => {
        const cleaned = await autoDetectCompleted(rows);
        if (cleaned.length !== rows.length) setRows(cleaned);
      })();
    }
  }, [rows, autoChecked, autoDetectCompleted]);

  useEffect(() => { setAutoChecked(false); }, [region, status]);

  useEffect(() => {
    const onHash = () => setFocused(decodeURIComponent(parseHash().sub || ''));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!focused || loading) return;
    const el = document.getElementById(`pool-${focused}`) || document.getElementById(`pool-job-${focused}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [focused, loading, rows.length]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(r => !q || [r.job_id, r.address, r.city, r.latest_reason, r.latest_technician_id].some(v => String(v || '').toLowerCase().includes(q)));
    if (!focused) return filtered;
    return [...filtered].sort((a, b) => {
      const am = String(a.id) === focused || String(a.job_id) === focused;
      const bm = String(b.id) === focused || String(b.job_id) === focused;
      return Number(bm) - Number(am);
    });
  }, [rows, search, focused]);

  const activeRows = useMemo(() => rows.filter(r => ['open', 'scheduled'].includes(r.current_status)), [rows]);

  const rowsByZone = useMemo(() => {
    const groups: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
    for (const r of activeRows) {
      const z = deriveCity(r.address || '', r.zip || '', r.city || '');
      groups[z].push(r);
    }
    return groups;
  }, [activeRows]);

  const weeklyData = useMemo(() => {
    const byWeek: Record<string, Record<string, any[]>> = {};
    for (const r of activeRows) {
      const dateStr = r.last_not_done_date || r.first_not_done_date || r.scheduled_route_date;
      if (!dateStr) continue;
      const wk = getWeekKey(dateStr);
      if (!byWeek[wk]) byWeek[wk] = {};
      if (!byWeek[wk][dateStr]) byWeek[wk][dateStr] = [];
      byWeek[wk][dateStr].push(r);
    }
    return Object.entries(byWeek).sort(([a], [b]) => b.localeCompare(a));
  }, [activeRows]);

  const allWeeks = useMemo(() => {
    const weeks = new Set<string>();
    for (const r of activeRows) {
      const dateStr = r.last_not_done_date || r.first_not_done_date || r.scheduled_route_date;
      if (dateStr) weeks.add(getWeekKey(dateStr));
    }
    return [...weeks].sort((a, b) => b.localeCompare(a));
  }, [activeRows]);

  const filteredWeekly = useMemo(() => {
    if (!weekFilter) return weeklyData;
    return weeklyData.filter(([wk]) => wk === weekFilter);
  }, [weeklyData, weekFilter]);

  const monthlyData = useMemo(() => {
    const byMonth: Record<string, Record<string, any[]>> = {};
    for (const r of activeRows) {
      const dateStr = r.last_not_done_date || r.first_not_done_date || r.scheduled_route_date;
      if (!dateStr) continue;
      const mo = getMonthKey(dateStr);
      if (!byMonth[mo]) byMonth[mo] = {};
      if (!byMonth[mo][dateStr]) byMonth[mo][dateStr] = [];
      byMonth[mo][dateStr].push(r);
    }
    return Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a));
  }, [activeRows]);

  const allMonths = useMemo(() => {
    const months = new Set<string>();
    for (const r of activeRows) {
      const dateStr = r.last_not_done_date || r.first_not_done_date || r.scheduled_route_date;
      if (dateStr) months.add(getMonthKey(dateStr));
    }
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [activeRows]);

  const filteredMonthly = useMemo(() => {
    if (!monthFilter) return monthlyData;
    return monthlyData.filter(([mo]) => mo === monthFilter);
  }, [monthlyData, monthFilter]);

  const active = activeRows.length;
  const cancelled = rows.filter(r => r.current_status === 'cancelled').length;
  const aged = activeRows.filter(r => ((Date.now() - new Date(r.first_not_done_date).getTime()) / 86400000) >= 7).length;

  const close = async (row: any, type: 'completed' | 'cancelled' | 'admin_resolved') => {
    const note = window.prompt(es ? 'Nota de resolución:' : 'Resolution note:') || '';
    await resolveNotDonePool({ ...row, region, date: new Date().toLocaleDateString('en-CA'), tech_id: row.latest_technician_id }, type, actorName, note);
    feedCharlieLearning({
      event_type: type === 'completed' ? 'resolved_completed' : 'resolved_cancelled',
      region,
      job_id: row.job_id,
      address: row.address,
      city: row.city,
      zip: row.zip,
      reason: row.latest_reason || row.original_reason,
      category: row.inferred_category,
      tech_id: row.latest_technician_id,
      tech_name: techName(row.latest_technician_id),
      occurrence_count: row.occurrence_count,
      metadata: { manual: true, note, actor: actorName },
    });
    load();
  };

  const statusColor = (s: string) => s === 'resolved' ? '#00dc85' : s === 'cancelled' ? '#8da4c9' : s === 'scheduled' ? '#00b8f5' : '#ff3348';

  const directUrl = (row: any) => `${window.location.origin}${window.location.pathname}${buildHash('supervisor', region, 'search', encodeURIComponent(String(row.job_id || row.id)))}`;
  const copyLink = async (row: any) => {
    try { await navigator.clipboard.writeText(directUrl(row)); setCopied(String(row.id || row.job_id)); setTimeout(() => setCopied(''), 1800); } catch {}
  };

  const navigateInsideApp = (hash: string) => {
    window.history.replaceState({ gfsInAppNavigation: true }, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: window.location.href, newURL: `${window.location.origin}${window.location.pathname}${hash}` }));
  };

  const openCurrentRoute = async (row: any) => {
    const jobId = String(row.job_id || '').trim();
    if (!jobId) return;
    navigateInsideApp(buildHash('supervisor', region, 'search', encodeURIComponent(jobId)));
  };

  function buildCityGroupedText(rowsToReport: any[]): string {
    const groups: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
    for (const r of rowsToReport) {
      const z = deriveCity(r.address || '', r.zip || '', r.city || '');
      groups[z].push(r);
    }
    const lines: string[] = [];
    for (const zone of ZONE_ORDER) {
      const bucket = groups[zone];
      if (!bucket.length) continue;
      lines.push(`${ZONE_EMOJI[zone]} ${zone}`);
      for (const r of bucket) {
        const reason = String(r.latest_reason || r.original_reason || '').trim();
        const shortAddr = String(r.address || '').trim();
        const tid = String(r.latest_technician_id || r.source_technician_id || '').trim();
        const tname = techName(tid);
        const techLabel = tid ? (tname ? `${tid} – ${tname}` : `${tid}`) : '—';
        lines.push(`${r.job_id} – ${shortAddr} → ${reason}`);
        lines.push(`  ↳ Tech ${techLabel}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  const downloadDailyTxt = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const today = new Date().toLocaleDateString('en-CA');
    const todayRows = activeRows.filter(r => {
      const d = r.last_not_done_date || r.first_not_done_date;
      return d === today;
    });
    const source = todayRows.length ? todayRows : activeRows;
    const header = `${es ? 'REPORTE DIARIO NO COMPLETADOS' : 'DAILY NOT DONE REPORT'} — ${dateStr}\n${region.toUpperCase()}\n\n`;
    const body = buildCityGroupedText(source);
    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NoCompletados_${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadWeeklyExcel = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = es ? `NoCompletados_Semana_${dateStr}` : `NotDone_Weekly_${dateStr}`;
    const wb = XLSX.utils.book_new();

    for (const [weekKey, days] of filteredWeekly) {
      const wr = getWeekRange(weekKey);
      const sheetName = wr.label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 28) || weekKey;
      const headers = es
        ? ['Zona', 'Fecha', 'Tech #', 'Técnico', 'Job Number', 'Dirección', 'Ciudad', 'Razón', 'Categoría', 'Ocurrencias', 'Días Pendiente', 'Estado']
        : ['Zone', 'Date', 'Tech #', 'Technician', 'Job Number', 'Address', 'City', 'Reason', 'Category', 'Occurrences', 'Days Pending', 'Status'];
      const sheetRows: any[][] = [headers];

      const flatRows: any[] = [];
      Object.entries(days).forEach(([day, dayRows]) => (dayRows as any[]).forEach(r => flatRows.push({ ...r, __day: day })));
      const byZone: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
      for (const r of flatRows) {
        byZone[deriveCity(r.address || '', r.zip || '', r.city || '')].push(r);
      }
      for (const zone of ZONE_ORDER) {
        const bucket = byZone[zone];
        if (!bucket.length) continue;
        for (const r of bucket) {
          const age = Math.max(0, Math.floor((Date.now() - new Date(r.first_not_done_date).getTime()) / 86400000));
          const tid = r.latest_technician_id || r.source_technician_id || '';
          sheetRows.push([
            `${ZONE_EMOJI[zone]} ${zone}`,
            r.__day,
            tid || '—',
            techName(tid),
            r.job_id || '',
            r.address || '',
            r.city || '',
            r.latest_reason || r.original_reason || '',
            r.inferred_category || 'Follow-up',
            r.occurrence_count || 1,
            age,
            r.current_status || 'open',
          ]);
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (wb.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([[es ? 'Sin datos' : 'No data']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Empty');
    }

    XLSX.writeFile(wb, filename + '.xlsx');
  };

  const downloadMonthlyExcel = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = es ? `NoCompletados_Mes_${dateStr}` : `NotDone_Monthly_${dateStr}`;
    const wb = XLSX.utils.book_new();

    for (const [monthKey, days] of filteredMonthly) {
      const sheetName = getMonthLabel(monthKey).replace(/[^a-zA-Z0-9]/g, '').slice(0, 28) || monthKey;
      const headers = es
        ? ['Zona', 'Fecha', 'Tech #', 'Técnico', 'Job Number', 'Dirección', 'Ciudad', 'Razón', 'Categoría', 'Ocurrencias', 'Días Pendiente', 'Estado']
        : ['Zone', 'Date', 'Tech #', 'Technician', 'Job Number', 'Address', 'City', 'Reason', 'Category', 'Occurrences', 'Days Pending', 'Status'];
      const sheetRows: any[][] = [headers];

      const flatRows: any[] = [];
      Object.entries(days).forEach(([day, dayRows]) => (dayRows as any[]).forEach(r => flatRows.push({ ...r, __day: day })));
      const byZone: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
      for (const r of flatRows) {
        byZone[deriveCity(r.address || '', r.zip || '', r.city || '')].push(r);
      }
      for (const zone of ZONE_ORDER) {
        const bucket = byZone[zone];
        if (!bucket.length) continue;
        for (const r of bucket) {
          const age = Math.max(0, Math.floor((Date.now() - new Date(r.first_not_done_date).getTime()) / 86400000));
          const tid = r.latest_technician_id || r.source_technician_id || '';
          sheetRows.push([
            `${ZONE_EMOJI[zone]} ${zone}`,
            r.__day,
            tid || '—',
            techName(tid),
            r.job_id || '',
            r.address || '',
            r.city || '',
            r.latest_reason || r.original_reason || '',
            r.inferred_category || 'Follow-up',
            r.occurrence_count || 1,
            age,
            r.current_status || 'open',
          ]);
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (wb.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([[es ? 'Sin datos' : 'No data']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Empty');
    }

    XLSX.writeFile(wb, filename + '.xlsx');
  };

  const runAutoDetect = async () => {
    setAutoChecked(false);
    const cleaned = await autoDetectCompleted(rows);
    if (cleaned.length !== rows.length) {
      setRows(cleaned);
    } else {
      setAutoRemovedCount(0);
    }
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ background: C.card, border: '1px solid #162e58', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: C.text }}>🧺 {es ? 'Pool de No Completados / Pendientes' : 'Not Done / Pending Pool'}</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{es ? 'Solo lo que sigue pendiente. Los que se completan salen solos.' : 'Only what is still pending. Completed jobs auto-remove themselves.'}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setView('pool')} style={{ background: view === 'pool' ? '#00b8f522' : 'none', border: `1px solid ${view === 'pool' ? '#00b8f5' : '#162e58'}`, borderRadius: 8, padding: '8px 14px', color: view === 'pool' ? '#00b8f5' : C.dim, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>Pool</button>
          <button onClick={() => setView('weekly')} style={{ background: view === 'weekly' ? '#ffbe0022' : 'none', border: `1px solid ${view === 'weekly' ? '#ffbe00' : '#162e58'}`, borderRadius: 8, padding: '8px 14px', color: view === 'weekly' ? '#ffbe00' : C.dim, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📅 {es ? 'Semanal' : 'Weekly'}</button>
          <button onClick={() => setView('monthly')} style={{ background: view === 'monthly' ? '#b98cff22' : 'none', border: `1px solid ${view === 'monthly' ? '#b98cff' : '#162e58'}`, borderRadius: 8, padding: '8px 14px', color: view === 'monthly' ? '#b98cff' : C.dim, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📆 {es ? 'Mensual' : 'Monthly'}</button>
        </div>
      </div>
      {getRitStorageMode() === 'local' && <div style={{ marginTop: 9, padding: '8px 10px', borderRadius: 8, background: '#ffbe0018', border: '1px solid #ffbe0055', color: '#ffcf55', fontSize: 10, fontWeight: 800 }}>💾 {es ? 'Modo local activo' : 'Local mode active'}</div>}
      {autoRemovedCount > 0 && <div style={{ marginTop: 9, padding: '8px 10px', borderRadius: 8, background: '#00dc8518', border: '1px solid #00dc8555', color: '#00dc85', fontSize: 11, fontWeight: 800 }}>✓ {es ? `${autoRemovedCount} trabajo(s) auto-detectado(s) como completado(s) y removido(s)` : `${autoRemovedCount} job(s) auto-detected as completed and removed`}</div>}

      {view === 'pool' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginTop: 12 }}>{[
          [es ? 'Activos' : 'Active', active, '#ff3348'],
          [es ? 'Programados' : 'Scheduled', rows.filter(r => r.current_status === 'scheduled').length, '#00b8f5'],
          [es ? 'Más de 7 días' : '7+ days old', aged, '#ffbe00'],
          [es ? 'Resueltos' : 'Resolved', rows.filter(r => r.current_status === 'resolved').length, '#00dc85'],
          [es ? 'Cancelados' : 'Cancelled', cancelled, '#8da4c9'],
        ].map(([l, v, c]: any) => <div key={l} style={{ background: `${c}14`, border: `1px solid ${c}44`, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 23, fontWeight: 900, color: c }}>{v}</div><div style={{ fontSize: 10, color: C.dim }}>{l}</div></div>)}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 6, marginTop: 10 }}>
          {ZONE_ORDER.map(z => {
            const n = rowsByZone[z].length;
            if (!n) return null;
            return <div key={z} style={{ background: `${ZONE_COLOR[z]}14`, border: `1px solid ${ZONE_COLOR[z]}55`, borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 18 }}>{ZONE_EMOJI[z]}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: ZONE_COLOR[z] }}>{n}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700 }}>{z}</div>
            </div>;
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={es ? 'Buscar Job ID, dirección, técnico...' : 'Search Job ID, address, technician...'} style={{ flex: 1, minWidth: 220, background: '#0e1e3a', border: '1px solid #162e58', borderRadius: 8, padding: '9px 12px', color: C.text }} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ background: '#0e1e3a', border: '1px solid #162e58', borderRadius: 8, padding: '9px 10px', color: C.text }}>
            <option value='active'>{es ? 'Activos' : 'Active'}</option>
            <option value='open'>{es ? 'Abiertos' : 'Open'}</option>
            <option value='scheduled'>{es ? 'En nueva ruta' : 'Scheduled'}</option>
            <option value='resolved'>{es ? 'Resueltos' : 'Resolved'}</option>
            <option value='cancelled'>{es ? 'Cancelados' : 'Cancelled'}</option>
            <option value='all'>{es ? 'Todos' : 'All'}</option>
          </select>
          <button onClick={load} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 8, padding: '9px 14px', color: '#00b8f5', fontWeight: 800 }}>↻</button>
          <button onClick={runAutoDetect} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 8, padding: '9px 14px', color: '#00dc85', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>✓ {es ? 'Verificar completados' : 'Auto-detect done'}</button>
          <button onClick={downloadDailyTxt} style={{ background: '#ffbe0022', border: '1px solid #ffbe00', borderRadius: 8, padding: '9px 14px', color: '#ffbe00', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📄 TXT</button>
        </div>
      </>}

      {view === 'weekly' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <select value={weekFilter} onChange={e => setWeekFilter(e.target.value)} style={{ background: '#0e1e3a', border: '1px solid #162e58', borderRadius: 8, padding: '9px 10px', color: C.text, minWidth: 200 }}>
            <option value=''>{es ? 'Todas las semanas' : 'All weeks'}</option>
            {allWeeks.map(wk => { const wr = getWeekRange(wk); return <option key={wk} value={wk}>{wr.label}</option>; })}
          </select>
          <button onClick={runAutoDetect} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 8, padding: '9px 14px', color: '#00dc85', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>✓ {es ? 'Verificar completados' : 'Auto-detect done'}</button>
          <button onClick={downloadWeeklyExcel} style={{ background: '#ffbe0022', border: '1px solid #ffbe00', borderRadius: 8, padding: '9px 14px', color: '#ffbe00', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📥 Excel</button>
          <button onClick={downloadDailyTxt} style={{ background: '#ffbe0022', border: '1px solid #ffbe00', borderRadius: 8, padding: '9px 14px', color: '#ffbe00', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📄 TXT diario</button>
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
          {es ? 'Trabajos completados salen automáticamente. Solo se muestra lo pendiente real.' : 'Completed jobs auto-remove themselves. Only truly pending items show here.'}
        </div>
      </>}

      {view === 'monthly' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ background: '#0e1e3a', border: '1px solid #162e58', borderRadius: 8, padding: '9px 10px', color: C.text, minWidth: 200 }}>
            <option value=''>{es ? 'Todos los meses' : 'All months'}</option>
            {allMonths.map(mo => <option key={mo} value={mo}>{getMonthLabel(mo)}</option>)}
          </select>
          <button onClick={runAutoDetect} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 8, padding: '9px 14px', color: '#00dc85', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>✓ {es ? 'Verificar completados' : 'Auto-detect done'}</button>
          <button onClick={downloadMonthlyExcel} style={{ background: '#b98cff22', border: '1px solid #b98cff', borderRadius: 8, padding: '9px 14px', color: '#b98cff', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>📥 Excel</button>
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
          {es ? 'Vista consolidada del mes. Ideal para revisión con George o análisis de patrones.' : 'Consolidated monthly view. Useful for supervisor review or pattern analysis.'}
        </div>
      </>}
    </div>

    {view === 'pool' && (
      loading ? <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>
      : visible.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.card, borderRadius: 14, border: '1px solid #162e58' }}>{es ? 'No hay registros en este grupo.' : 'No records in this group.'}</div>
      : visible.map(row => {
        const zone = deriveCity(row.address || '', row.zip || '', row.city || '');
        const zoneColor = ZONE_COLOR[zone];
        const age = Math.max(0, Math.floor((Date.now() - new Date(row.first_not_done_date).getTime()) / 86400000));
        const match = focused && (String(row.id) === focused || String(row.job_id) === focused);
        return <div id={`pool-${row.id}`} key={row.id} style={{ background: C.card, border: `2px solid ${match ? '#ffffff' : statusColor(row.current_status) + '55'}`, borderLeft: `5px solid ${zoneColor}`, borderRadius: 12, padding: 14, boxShadow: match ? '0 0 0 3px rgba(255,255,255,.10)' : 'none', scrollMarginTop: 90 }}>
          <span id={`pool-job-${row.job_id}`} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>{ZONE_EMOJI[zone]}</span>
                <strong style={{ color: C.accent }}>#{row.job_id}</strong>
                <span style={{ fontSize: 10, color: statusColor(row.current_status), border: `1px solid ${statusColor(row.current_status)}`, borderRadius: 20, padding: '2px 8px' }}>{row.current_status}</span>
                <span style={{ fontSize: 10, color: '#ffcf55', border: '1px solid #ffbe0055', background: '#ffbe0012', borderRadius: 20, padding: '2px 8px' }}>{row.inferred_category || 'Follow-up'}</span>
                <span style={{ fontSize: 10, color: age >= 7 ? '#ffbe00' : C.dim }}>{age} {es ? 'días' : 'days'}</span>
                <span style={{ fontSize: 10, color: C.dim }}>×{row.occurrence_count}</span>
              </div>
              <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 900, marginTop: 5 }}>{row.address}{row.city ? `, ${row.city}` : ''}</div>
              <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 800, marginTop: 2 }}>👷 Tech #{row.latest_technician_id || '—'}{techName(row.latest_technician_id) ? ` – ${techName(row.latest_technician_id)}` : ''}</div>
              <div style={{ fontSize: 11, color: '#ff6677', marginTop: 3 }}>{row.latest_reason || row.original_reason}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 5 }}>First: {row.first_not_done_date} · Last: {row.last_not_done_date}{row.scheduled_route_date ? ` · Route: ${row.scheduled_route_date}` : ''}</div>
              {row.resolution_notes && <div style={{ fontSize: 11, color: '#00dc85', marginTop: 5 }}>✓ {row.resolution_notes}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
              <button onClick={() => openCurrentRoute(row)} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 7, padding: '7px 9px', color: '#00b8f5', fontSize: 10, fontWeight: 800 }}>{es ? 'Abrir trabajo' : 'Open job'}</button>
              <button onClick={() => copyLink(row)} style={{ background: '#9d5fff22', border: '1px solid #9d5fff', borderRadius: 7, padding: '7px 9px', color: '#c39dff', fontSize: 10, fontWeight: 800 }}>{copied === String(row.id || row.job_id) ? (es ? 'Copiado' : 'Copied') : '🔗 Link'}</button>
              {['open', 'scheduled'].includes(row.current_status) && <>
                <button onClick={() => close(row, 'completed')} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 7, padding: '7px 9px', color: '#00dc85', fontSize: 10, fontWeight: 800 }}>{es ? 'Resuelto' : 'Resolved'}</button>
                <button onClick={() => close(row, 'cancelled')} style={{ background: '#8da4c922', border: '1px solid #8da4c9', borderRadius: 7, padding: '7px 9px', color: '#c8d8f4', fontSize: 10, fontWeight: 800 }}>{es ? 'Cancelado' : 'Cancelled'}</button>
              </>}
            </div>
          </div>
        </div>;
      })
    )}

    {view === 'weekly' && (
      loading ? <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>
      : filteredWeekly.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.card, borderRadius: 14, border: '1px solid #162e58' }}>{es ? 'No hay trabajos pendientes en ninguna semana.' : 'No pending jobs in any week.'}</div>
      : filteredWeekly.map(([weekKey, days]) => {
        const wr = getWeekRange(weekKey);
        const weekTotal = Object.values(days).reduce((sum: number, dayRows: any[]) => sum + dayRows.length, 0);
        const sortedDays = Object.entries(days).sort(([a], [b]) => b.localeCompare(a));
        return <div key={weekKey} style={{ background: C.card, border: '1px solid #162e58', borderRadius: 14, padding: 16, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: '#ffbe00' }}>📅 {wr.label}</div>
            <div style={{ fontSize: 12, color: C.dim, fontWeight: 700 }}>{weekTotal} {es ? 'trabajos' : 'jobs'}</div>
          </div>
          {sortedDays.map(([day, dayRows]) => {
            const dayDate = new Date(day + 'T00:00:00');
            const dayLabel = dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const byZone: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
            for (const r of dayRows) byZone[deriveCity(r.address || '', r.zip || '', r.city || '')].push(r);
            return <div key={day} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.accent, marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #162e58' }}>{dayLabel} · {dayRows.length} {es ? 'trabajos' : 'jobs'}</div>
              {ZONE_ORDER.map(zone => {
                const bucket = byZone[zone];
                if (!bucket.length) return null;
                return <div key={zone} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: ZONE_COLOR[zone], marginBottom: 4 }}>{ZONE_EMOJI[zone]} {zone} · {bucket.length}</div>
                  {bucket.map((row: any) => {
                    const age = Math.max(0, Math.floor((Date.now() - new Date(row.first_not_done_date).getTime()) / 86400000));
                    return <div key={row.id || row.job_id} style={{ display: 'flex', gap: 8, padding: '8px 0 8px 12px', borderLeft: `3px solid ${ZONE_COLOR[zone]}55`, marginBottom: 4 }}>
                      <div style={{ flex: '0 0 60px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>#{row.latest_technician_id || row.source_technician_id || '—'}</div>
                        <div style={{ fontSize: 9, color: C.dim }}>{techName(row.latest_technician_id) || '—'}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>#{row.job_id} — {row.address}{row.city ? `, ${row.city}` : ''}</div>
                        <div style={{ fontSize: 11, color: '#ff6677', marginTop: 2 }}>{row.latest_reason || row.original_reason || '—'}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 9, color: statusColor(row.current_status), border: `1px solid ${statusColor(row.current_status)}`, borderRadius: 20, padding: '1px 6px' }}>{row.current_status}</span>
                          {row.inferred_category && <span style={{ fontSize: 9, color: '#ffcf55', border: '1px solid #ffbe0055', borderRadius: 20, padding: '1px 6px' }}>{row.inferred_category}</span>}
                          <span style={{ fontSize: 9, color: age >= 7 ? '#ffbe00' : C.dim }}>{age}d {es ? 'pendiente' : 'pending'}</span>
                          <span style={{ fontSize: 9, color: C.dim }}>×{row.occurrence_count || 1}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button onClick={() => openCurrentRoute(row)} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 6, padding: '5px 7px', color: '#00b8f5', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>{es ? 'Abrir' : 'Open'}</button>
                        <button onClick={() => close(row, 'completed')} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 6, padding: '5px 7px', color: '#00dc85', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>✓</button>
                      </div>
                    </div>;
                  })}
                </div>;
              })}
            </div>;
          })}
        </div>;
      })
    )}

    {view === 'monthly' && (
      loading ? <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>
      : filteredMonthly.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.card, borderRadius: 14, border: '1px solid #162e58' }}>{es ? 'No hay trabajos pendientes en ningún mes.' : 'No pending jobs in any month.'}</div>
      : filteredMonthly.map(([monthKey, days]) => {
        const monthTotal = Object.values(days).reduce((sum: number, dayRows: any[]) => sum + dayRows.length, 0);
        const flat: any[] = [];
        Object.values(days).forEach((dayRows: any[]) => dayRows.forEach(r => flat.push(r)));
        const byZone: Record<ZoneKey, any[]> = { HIALEAH: [], MIAMI: [], HOMESTEAD: [], DORAL: [], BROWARD: [], OTROS: [] };
        for (const r of flat) byZone[deriveCity(r.address || '', r.zip || '', r.city || '')].push(r);
        return <div key={monthKey} style={{ background: C.card, border: '1px solid #162e58', borderRadius: 14, padding: 16, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: '#b98cff' }}>📆 {getMonthLabel(monthKey)}</div>
            <div style={{ fontSize: 12, color: C.dim, fontWeight: 700 }}>{monthTotal} {es ? 'trabajos' : 'jobs'}</div>
          </div>
          {ZONE_ORDER.map(zone => {
            const bucket = byZone[zone];
            if (!bucket.length) return null;
            return <div key={zone} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: ZONE_COLOR[zone], marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${ZONE_COLOR[zone]}33` }}>{ZONE_EMOJI[zone]} {zone} · {bucket.length} {es ? 'trabajos' : 'jobs'}</div>
              {bucket.map((row: any) => {
                const age = Math.max(0, Math.floor((Date.now() - new Date(row.first_not_done_date).getTime()) / 86400000));
                return <div key={row.id || row.job_id} style={{ display: 'flex', gap: 8, padding: '6px 0 6px 12px', borderLeft: `3px solid ${ZONE_COLOR[zone]}55`, marginBottom: 3 }}>
                  <div style={{ flex: '0 0 60px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>#{row.latest_technician_id || row.source_technician_id || '—'}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>{techName(row.latest_technician_id) || '—'}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>#{row.job_id} — {row.address}</div>
                    <div style={{ fontSize: 10, color: '#ff6677', marginTop: 2 }}>{row.latest_reason || row.original_reason || '—'}</div>
                    <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{row.last_not_done_date} · {age}d · ×{row.occurrence_count || 1}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button onClick={() => openCurrentRoute(row)} style={{ background: '#00b8f522', border: '1px solid #00b8f5', borderRadius: 6, padding: '5px 7px', color: '#00b8f5', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>{es ? 'Abrir' : 'Open'}</button>
                    <button onClick={() => close(row, 'completed')} style={{ background: '#00dc8522', border: '1px solid #00dc85', borderRadius: 6, padding: '5px 7px', color: '#00dc85', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>✓</button>
                  </div>
                </div>;
              })}
            </div>;
          })}
        </div>;
      })
    )}
  </div>;
}