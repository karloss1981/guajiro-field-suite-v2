// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { getTechName } from '../../../legacy/data';
import { getPendingCloseQueueItems } from '../../../offline/pendingCloseQueue';
import { getPendingPhotoQueueItems } from '../../../offline/photoUploadQueue';
import { OpsButton, OpsCard, OpsEmpty, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';

type FactRow = {
  id: string;
  route_id?: string;
  region?: string;
  date?: string;
  tech_id?: string;
  tech_name?: string;
  job_id?: string;
  address?: string;
  city?: string;
  zip?: string;
  type?: string;
  status?: string;
  status_group?: 'completed' | 'not_done' | 'pending';
  reason?: string;
  notes?: string;
  pay_code?: string;
  pay_total?: number;
  source?: string;
  photo_before?: number;
  photo_after?: number;
  photo_other?: number;
  local_pending_photos?: number;
  pending_close?: boolean;
  search_text?: string;
};

type QAIssue = {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  label: string;
  row: FactRow;
};

const td = { padding: '8px 6px', borderBottom: `1px solid ${OPS.border}`, color: OPS.text, verticalAlign: 'top' as const };
const ISSUE_FILTERS = ['all', 'ready', 'critical', 'warning', 'missing_photos', 'missing_billing', 'duplicates', 'pending_close'];

function todayIso(){ return new Date().toLocaleDateString('en-CA'); }
function daysAgo(days:number){ const d=new Date(); d.setDate(d.getDate()-days); return d.toLocaleDateString('en-CA'); }
function clampDate(value:any){ return String(value||'').slice(0,10); }
function norm(v:any){ return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function money(n:any){ return Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}); }
function statusGroup(status:any):FactRow['status_group']{ const s=norm(status).replace(/[\s-]/g,'_'); if(['done','completed','complete','closed','resolved'].includes(s))return 'completed'; if(['notdone','not_done','not_completed','notcompleted','cancelled','canceled','failed','fail','customer_absent','no_access','open'].includes(s))return 'not_done'; return 'pending'; }
function rowDate(row:any, fallback=''){ return clampDate(row.date || row.route_date || row.source_route_date || row.completed_at || row.created_at || row.updated_at || fallback); }
function rowTech(row:any){ return String(row.tech_id || row.technician_id || row.latest_technician_id || row.source_technician_id || row.techNumber || row.tech_number || '').trim(); }
function rowReason(row:any){ return row.reason || row.latest_reason || row.original_reason || row.status_reason || row.not_done_reason || row.job_note || row.notes || row.latest_notes || row.note || ''; }
function payCode(row:any){ return String(row.pay_code || row.billing_code || row.billing || row.code || row.billingCode || '').trim(); }
function payTotal(row:any){ return Number(row.pay_total ?? row.pay ?? row.amount ?? row.total ?? row.value ?? 0) || 0; }
function routeId(row:any){ return String(row.route_id || row.id || '').trim(); }
function jobId(row:any){ return String(row.job_id || row.work_order || row.ticket || row.job || '').trim(); }
function cleanAddress(row:any){ return row.address || row.service_address || row.location || [row.house_number || row.house || row.street_number, row.street || row.street_name].filter(Boolean).join(' '); }
function buildSearch(row:FactRow){ return [row.tech_id,row.tech_name,row.job_id,row.address,row.city,row.zip,row.type,row.status,row.status_group,row.reason,row.notes,row.pay_code,row.pay_total,row.source].map(norm).join(' | '); }
function mapRow(row:any, source:string, fallbackDate='', override:any = {}):FactRow{
  const techId = rowTech(row);
  const status = override.status || row.status || row.current_status || 'pending';
  const r: FactRow = {
    id: String(row.id || row.route_id || `${source}-${rowDate(row,fallbackDate)}-${jobId(row)||cleanAddress(row)||Math.random()}`),
    route_id: routeId(row),
    region: row.region,
    date: rowDate(row, fallbackDate),
    tech_id: techId || 'unassigned',
    tech_name: row.tech_name || row.technician_name || row.latest_technician_name || row.name || (techId ? getTechName(techId) : 'Unassigned'),
    job_id: jobId(row),
    address: cleanAddress(row),
    city: row.city || '',
    zip: row.zip || row.zip_code || row.zone || '',
    type: row.type || row.work_type || row.service_type || '',
    status,
    status_group: statusGroup(status),
    reason: rowReason(row),
    notes: row.notes || row.job_note || row.latest_notes || '',
    pay_code: payCode(row),
    pay_total: payTotal(row),
    source,
    photo_before: 0,
    photo_after: 0,
    photo_other: 0,
    local_pending_photos: 0,
    pending_close: false,
  };
  r.search_text = buildSearch(r);
  return r;
}
function flattenSnapshot(record:any, relation:string){
  const date = clampDate(record.date || record.route_date || record.created_at);
  const snapshot = Array.isArray(record.snapshot) ? record.snapshot : Array.isArray(record.jobs) ? record.jobs : [];
  return snapshot.map((job:any, idx:number) => mapRow({ ...job, region: job.region || record.region, id: job.id || `${relation}-${date}-${idx}` }, relation, date));
}
function dedupeRows(rows:FactRow[]){
  const priority:any = { completed_jobs: 7, routes: 6, cancelled_jobs: 5, not_done_reports: 5, not_done_pool: 4, daily_route_snapshots: 2, archived_routes: 1 };
  const sorted = [...rows].sort((a,b)=>(priority[b.source||'']||0)-(priority[a.source||'']||0));
  const map = new Map<string, FactRow>();
  sorted.forEach((r, idx) => {
    const key = [r.region||'', r.date||'', r.tech_id||'', r.job_id || r.address || idx, r.status_group||'', r.source==='routes'?'route':'fact'].map(norm).join('|');
    if (!map.has(key)) map.set(key, r);
  });
  return [...map.values()];
}
async function safe(label:string, promise:any){
  try { const res = await promise; if (res?.error) return { data: [], warning: `${label}: ${res.error.message || res.error}` }; return { data: res?.data || [], warning: '' }; }
  catch (error:any) { return { data: [], warning: `${label}: ${error?.message || String(error)}` }; }
}
async function fetchPhotosForRows(rows:FactRow[]){
  const ids = [...new Set(rows.map(r => r.route_id).filter(Boolean))];
  const jobIds = [...new Set(rows.map(r => r.job_id).filter(Boolean))];
  const photoRows:any[] = [];
  const warnings:string[] = [];
  for (let i=0; i<ids.length; i+=400) {
    const chunk = ids.slice(i, i+400);
    const result = await safe('job_photos route_id', sb.from('job_photos').select('route_id,job_id,photo_type,created_at').in('route_id', chunk).limit(5000));
    photoRows.push(...result.data); if (result.warning) warnings.push(result.warning);
  }
  if (ids.length === 0 && jobIds.length > 0) {
    for (let i=0; i<jobIds.length; i+=400) {
      const chunk = jobIds.slice(i, i+400);
      const result = await safe('job_photos job_id', sb.from('job_photos').select('route_id,job_id,photo_type,created_at').in('job_id', chunk).limit(5000));
      photoRows.push(...result.data); if (result.warning) warnings.push(result.warning);
    }
  }
  const byRoute = new Map<string, any>();
  const byJob = new Map<string, any>();
  const add = (map:Map<string,any>, key:string, photo:any) => {
    if (!key) return;
    const item = map.get(key) || { before: 0, after: 0, other: 0 };
    const t = norm(photo.photo_type || photo.type || 'other');
    if (t === 'evidence' || t.includes('before') || t === 'b') item.before += 1;
    else if (t === 'pht' || t.includes('after') || t === 'a') item.after += 1;
    else item.other += 1;
    map.set(key, item);
  };
  photoRows.forEach(photo => { add(byRoute, String(photo.route_id||''), photo); add(byJob, String(photo.job_id||''), photo); });
  return { byRoute, byJob, warnings };
}
function applyPhotoCounts(rows:FactRow[], byRoute:Map<string,any>, byJob:Map<string,any>){
  return rows.map(row => {
    const counts = byRoute.get(String(row.route_id||'')) || byJob.get(String(row.job_id||'')) || { before: 0, after: 0, other: 0 };
    return { ...row, photo_before: counts.before || 0, photo_after: counts.after || 0, photo_other: counts.other || 0 };
  });
}
function buildIssues(rows:FactRow[]):QAIssue[]{
  const issues:QAIssue[] = [];
  const completed = rows.filter(r => r.status_group === 'completed');
  const seen = new Map<string, FactRow[]>();
  completed.forEach(row => {
    const key = [row.date, row.tech_id, row.job_id || row.address].map(norm).join('|');
    const list = seen.get(key) || [];
    list.push(row); seen.set(key, list);
    if (!row.pay_code) issues.push({ severity:'critical', code:'missing_billing', label:'Completed job missing billing code', row });
    if (!Number(row.pay_total || 0)) issues.push({ severity:'critical', code:'zero_value', label:'Completed job has zero billing value', row });
    if (!row.photo_before) issues.push({ severity:'critical', code:'missing_before', label:'Completed job missing BEFORE photo', row });
    if (!row.photo_after) issues.push({ severity:'critical', code:'missing_after', label:'Completed job missing AFTER photo', row });
    if (row.local_pending_photos) issues.push({ severity:'warning', code:'pending_photo_sync', label:'Job has local photos still pending upload', row });
    if (row.pending_close) issues.push({ severity:'warning', code:'pending_close', label:'Job is waiting in Pending Close queue', row });
  });
  rows.filter(r => r.status_group === 'not_done').forEach(row => {
    if (Number(row.pay_total || 0) > 0) issues.push({ severity:'warning', code:'not_done_with_value', label:'Not done job has billing value; verify before payroll', row });
    if (!row.reason && !row.notes) issues.push({ severity:'warning', code:'missing_reason', label:'Not done job missing reason/notes', row });
    if (row.local_pending_photos) issues.push({ severity:'info', code:'not_done_pending_photo', label:'Not done job has local photo pending upload', row });
  });
  seen.forEach(list => { if (list.length > 1) list.slice(1).forEach(row => issues.push({ severity:'warning', code:'duplicate_completed', label:'Possible duplicate completed job', row })); });
  rows.filter(r => r.status_group === 'pending' && r.pending_close).forEach(row => issues.push({ severity:'warning', code:'pending_close', label:'Pending close exists but final job is not synced yet', row }));
  return issues;
}
function isReady(row:FactRow, issueMap:Map<string,QAIssue[]>){
  if (row.status_group !== 'completed') return false;
  const issues = issueMap.get(row.id) || [];
  return issues.filter(i => i.severity === 'critical').length === 0 && row.pay_code && Number(row.pay_total||0)>0 && row.photo_before!>0 && row.photo_after!>0;
}
function exportQA(rows:FactRow[], issues:QAIssue[], filename:string){
  const issueByRow = new Map<string,string[]>();
  issues.forEach(i => issueByRow.set(i.row.id, [...(issueByRow.get(i.row.id)||[]), `${i.code}: ${i.label}`]));
  const jobSheet = rows.map(r => ({
    Date:r.date, Tech:r.tech_id, 'Tech Name':r.tech_name, 'Job ID':r.job_id, Status:r.status_group, RawStatus:r.status, Address:r.address, City:r.city, ZIP:r.zip, Type:r.type,
    Reason:r.reason, Notes:r.notes, 'Billing Code':r.pay_code, Value:r.pay_total, Before:r.photo_before, After:r.photo_after, Other:r.photo_other, 'Local Pending Photos':r.local_pending_photos,
    'Pending Close':r.pending_close?'YES':'', Source:r.source, Issues:(issueByRow.get(r.id)||[]).join(' | ')
  }));
  const issueSheet = issues.map(i => ({ Severity:i.severity, Issue:i.code, Description:i.label, Date:i.row.date, Tech:i.row.tech_id, 'Job ID':i.row.job_id, Address:i.row.address, Value:i.row.pay_total, Source:i.row.source }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jobSheet), 'Closeout QA');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issueSheet), 'Issues');
  XLSX.writeFile(wb, filename);
}

export default function DispatchCloseoutQA({ region, lang }:{ region:string; lang:string }){
  const es = lang === 'es';
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayIso());
  const [techSearch, setTechSearch] = useState('');
  const [query, setQuery] = useState('');
  const [issueFilter, setIssueFilter] = useState('all');
  const [rows, setRows] = useState<FactRow[]>([]);
  const [issues, setIssues] = useState<QAIssue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setWarnings([]);
    const [routes, completed, cancelled, reports, pool, daily, archive] = await Promise.all([
      safe('routes', (()=>{ let q=sb.from('routes').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('completed_jobs', (()=>{ let q=sb.from('completed_jobs').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('cancelled_jobs', (()=>{ let q=sb.from('cancelled_jobs').select('*').gte('source_route_date',from).lte('source_route_date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_reports', (()=>{ let q=sb.from('not_done_reports').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_pool', (()=>{ let q=sb.from('not_done_pool').select('*').limit(2500); if(region)q=q.eq('region',region); return q; })()),
      safe('daily_route_snapshots', (()=>{ let q=sb.from('daily_route_snapshots').select('date,region,snapshot').gte('date',from).lte('date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
      safe('archived_routes', (()=>{ let q=sb.from('archived_routes').select('route_date,region,snapshot').gte('route_date',from).lte('route_date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
    ]);
    const base = dedupeRows([
      ...(routes.data||[]).map((r:any)=>mapRow(r,'routes')),
      ...(completed.data||[]).map((r:any)=>mapRow({...r,status:r.status||'done'},'completed_jobs')),
      ...(cancelled.data||[]).map((r:any)=>mapRow({...r,date:r.source_route_date,status:r.status||'cancelled'},'cancelled_jobs')),
      ...(reports.data||[]).map((r:any)=>mapRow({...r,status:r.status||'not_done'},'not_done_reports')),
      ...(pool.data||[]).map((r:any)=>mapRow({...r,date:r.last_not_done_date||r.first_not_done_date,status:r.current_status||'open',tech_id:r.latest_technician_id||r.source_technician_id,reason:r.latest_reason||r.original_reason,notes:r.latest_notes,type:r.work_type},'not_done_pool')),
      ...(daily.data||[]).flatMap((r:any)=>flattenSnapshot(r,'daily_route_snapshots')),
      ...(archive.data||[]).flatMap((r:any)=>flattenSnapshot(r,'archived_routes')),
    ].filter((r:FactRow)=>!r.date || (r.date>=from && r.date<=to)));

    const photoLookup = await fetchPhotosForRows(base);
    let withPhotos = applyPhotoCounts(base, photoLookup.byRoute, photoLookup.byJob);
    try {
      const [localPhotos, pendingCloses] = await Promise.all([getPendingPhotoQueueItems(), getPendingCloseQueueItems()]);
      withPhotos = withPhotos.map(row => {
        const pendingPhotoCount = localPhotos.filter((p:any) => String(p.route_id) === String(row.route_id) || String(p.job_id) === String(row.job_id)).length;
        const pendingClose = pendingCloses.some((p:any) => String(p.route_id) === String(row.route_id) || String(p.job_id) === String(row.job_id));
        return { ...row, local_pending_photos: pendingPhotoCount, pending_close: pendingClose };
      });
    } catch (error:any) {
      photoLookup.warnings.push(`local queues: ${error?.message || String(error)}`);
    }
    const qa = buildIssues(withPhotos);
    setRows(withPhotos); setIssues(qa);
    setWarnings([routes.warning, completed.warning, cancelled.warning, reports.warning, pool.warning, daily.warning, archive.warning, ...photoLookup.warnings].filter(Boolean));
    setLoading(false);
  }, [from, to, region]);

  useEffect(() => { load(); }, [load]);

  const issueByRow = useMemo(() => {
    const map = new Map<string, QAIssue[]>();
    issues.forEach(issue => map.set(issue.row.id, [...(map.get(issue.row.id)||[]), issue]));
    return map;
  }, [issues]);

  const readyRows = useMemo(() => rows.filter(r => isReady(r, issueByRow)), [rows, issueByRow]);

  const filteredRows = useMemo(() => {
    const tq = norm(techSearch);
    const q = norm(query);
    const issueIds = new Set(issues.map(i => i.row.id));
    const criticalIds = new Set(issues.filter(i => i.severity === 'critical').map(i => i.row.id));
    const warningIds = new Set(issues.filter(i => i.severity === 'warning').map(i => i.row.id));
    const missingPhotoIds = new Set(issues.filter(i => ['missing_before','missing_after','pending_photo_sync','not_done_pending_photo'].includes(i.code)).map(i => i.row.id));
    const missingBillingIds = new Set(issues.filter(i => ['missing_billing','zero_value'].includes(i.code)).map(i => i.row.id));
    const duplicateIds = new Set(issues.filter(i => i.code === 'duplicate_completed').map(i => i.row.id));
    const pendingCloseIds = new Set(issues.filter(i => i.code === 'pending_close').map(i => i.row.id));
    const readyIds = new Set(readyRows.map(r => r.id));
    return rows.filter(row => {
      const techText = norm([row.tech_id,row.tech_name,getTechName(row.tech_id||'')].join(' '));
      const hay = norm([row.search_text,row.photo_before,row.photo_after,row.local_pending_photos,(issueByRow.get(row.id)||[]).map(i=>i.code+' '+i.label).join(' ')].join(' '));
      const filterOk = issueFilter === 'all'
        || (issueFilter === 'ready' && readyIds.has(row.id))
        || (issueFilter === 'critical' && criticalIds.has(row.id))
        || (issueFilter === 'warning' && warningIds.has(row.id))
        || (issueFilter === 'missing_photos' && missingPhotoIds.has(row.id))
        || (issueFilter === 'missing_billing' && missingBillingIds.has(row.id))
        || (issueFilter === 'duplicates' && duplicateIds.has(row.id))
        || (issueFilter === 'pending_close' && pendingCloseIds.has(row.id));
      return filterOk && (!tq || techText.includes(tq)) && (!q || hay.includes(q));
    });
  }, [rows, issues, issueByRow, readyRows, techSearch, query, issueFilter]);

  const summary = useMemo(() => {
    const completed = rows.filter(r=>r.status_group==='completed');
    const notDone = rows.filter(r=>r.status_group==='not_done');
    const pending = rows.filter(r=>r.status_group==='pending');
    const critical = issues.filter(i=>i.severity==='critical');
    const warning = issues.filter(i=>i.severity==='warning');
    const billingValue = readyRows.reduce((s,r)=>s+Number(r.pay_total||0),0);
    const grossCompleted = completed.reduce((s,r)=>s+Number(r.pay_total||0),0);
    const atRiskValue = completed.filter(r=>!isReady(r,issueByRow)).reduce((s,r)=>s+Number(r.pay_total||0),0);
    return { total: rows.length, completed: completed.length, notDone: notDone.length, pending: pending.length, ready: readyRows.length, critical: critical.length, warning: warning.length, billingValue, grossCompleted, atRiskValue };
  }, [rows, issues, readyRows, issueByRow]);

  const byTech = useMemo(() => {
    const map = new Map<string, any>();
    rows.forEach(row => {
      const id = row.tech_id || 'unassigned';
      const item = map.get(id) || { tech_id: id, tech_name: row.tech_name || getTechName(id), rows: [] };
      item.rows.push(row); map.set(id,item);
    });
    return [...map.values()].map(item => {
      const rowSet = new Set(item.rows.map((r:FactRow)=>r.id));
      const itemIssues = issues.filter(i => rowSet.has(i.row.id));
      const ready = item.rows.filter((r:FactRow)=>isReady(r,issueByRow));
      return { ...item, total:item.rows.length, ready:ready.length, critical:itemIssues.filter(i=>i.severity==='critical').length, warning:itemIssues.filter(i=>i.severity==='warning').length, value:ready.reduce((s:number,r:FactRow)=>s+Number(r.pay_total||0),0), atRisk:item.rows.filter((r:FactRow)=>r.status_group==='completed' && !isReady(r,issueByRow)).reduce((s:number,r:FactRow)=>s+Number(r.pay_total||0),0) };
    }).sort((a,b)=>b.critical-a.critical || b.atRisk-a.atRisk || b.total-a.total);
  }, [rows, issues, issueByRow]);

  const topIssues = useMemo(() => {
    const map = new Map<string, any>();
    issues.forEach(issue => { const item = map.get(issue.code) || { code: issue.code, label: issue.label, count: 0, severity: issue.severity }; item.count += 1; map.set(issue.code,item); });
    return [...map.values()].sort((a,b)=>b.count-a.count);
  }, [issues]);

  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <OpsCard>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'flex-start'}}>
        <div><div style={{fontSize:17,fontWeight:900,color:OPS.text}}>🧾 {es?'Billing / Closeout QA':'Billing / Closeout QA'}</div><div style={{fontSize:11,color:OPS.dim,marginTop:4}}>{es?'Revisa si los trabajos están listos para facturar antes de enviar cierre del día.':'Check jobs before daily closeout and billing export.'}</div></div>
        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}><OpsButton onClick={load} disabled={loading}>{loading?'…':es?'Actualizar':'Refresh'}</OpsButton><OpsButton tone="green" onClick={()=>exportQA(filteredRows, issues.filter(i=>filteredRows.some(r=>r.id===i.row.id)), `closeout_qa_${from}_${to}.xlsx`)}>⬇ XLSX</OpsButton></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'140px 140px minmax(150px,.8fr) minmax(180px,1fr) 170px',gap:8,marginTop:12}} className="closeout-qa-filters">
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={fieldStyle}/>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={fieldStyle}/>
        <input value={techSearch} onChange={e=>setTechSearch(e.target.value)} placeholder={es?'Nombre o # técnico':'Tech name or #'} style={fieldStyle}/>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={es?'Job, billing, dirección, issue...':'Job, billing, address, issue...'} style={fieldStyle}/>
        <select value={issueFilter} onChange={e=>setIssueFilter(e.target.value)} style={fieldStyle}>{ISSUE_FILTERS.map(f=><option key={f} value={f}>{f.replace('_',' ').toUpperCase()}</option>)}</select>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>{['missing_photos','missing_billing','duplicates','pending_close','ready'].map(f=><button key={f} onClick={()=>setIssueFilter(f)} style={{background:issueFilter===f?'#00b8f522':'#071327',border:`1px solid ${issueFilter===f?OPS.blue:OPS.border}`,borderRadius:20,padding:'5px 8px',color:issueFilter===f?OPS.blue:OPS.dim,fontSize:10,cursor:'pointer'}}>🔎 {f.replace('_',' ')}</button>)}</div>
      {warnings.length>0 && <div style={{marginTop:9,background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:9,padding:'8px 10px',color:'#ffcf55',fontSize:10}}>⚠ {warnings.slice(0,4).join(' · ')}</div>}
    </OpsCard>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:8}}>
      {[{l:es?'Trabajos':'Jobs',v:summary.total,c:OPS.blue},{l:es?'Listos facturar':'Ready to bill',v:summary.ready,c:OPS.green},{l:es?'Valor listo':'Ready value',v:money(summary.billingValue),c:OPS.green},{l:es?'Valor en riesgo':'At-risk value',v:money(summary.atRiskValue),c:OPS.yellow},{l:es?'Críticos':'Critical',v:summary.critical,c:OPS.red},{l:es?'Warnings':'Warnings',v:summary.warning,c:OPS.yellow}].map(card=><div key={card.l} style={{background:OPS.card,border:`1px solid ${card.c}44`,borderRadius:12,padding:'11px 12px'}}><div style={{fontSize:22,fontWeight:900,color:card.c}}>{card.v}</div><div style={{fontSize:10,color:OPS.dim}}>{card.l}</div></div>)}
    </div>

    <div style={{display:'grid',gridTemplateColumns:'minmax(280px,1fr) minmax(260px,.7fr)',gap:12}} className="closeout-qa-grid">
      <OpsCard>
        <div style={{fontSize:15,fontWeight:900,color:OPS.text,marginBottom:8}}>👷 {es?'Riesgo por técnico':'Technician risk'}</div>
        {byTech.length===0?<OpsEmpty>{es?'Sin datos.':'No data.'}</OpsEmpty>:byTech.slice(0,50).map(t=><button key={t.tech_id} onClick={()=>setTechSearch(String(t.tech_id))} style={{width:'100%',textAlign:'left',background:'#071327',border:`1px solid ${t.critical?OPS.red:t.warning?OPS.yellow:OPS.border}`,borderRadius:12,padding:10,marginBottom:7,cursor:'pointer'}}>
          <div style={{display:'grid',gridTemplateColumns:'minmax(130px,1fr) repeat(5,72px)',gap:8,alignItems:'center'}} className="closeout-tech-row">
            <div><div style={{fontWeight:900,color:OPS.text}}>{t.tech_name} <span style={{color:OPS.blue}}>#{t.tech_id}</span></div><div style={{fontSize:10,color:OPS.dim}}>{t.total} jobs · {t.ready} ready</div></div>
            <Metric label="Ready" value={t.ready} color={OPS.green}/><Metric label="Critical" value={t.critical} color={OPS.red}/><Metric label="Warn" value={t.warning} color={OPS.yellow}/><Metric label="Ready $" value={money(t.value)} color={OPS.green}/><Metric label="Risk $" value={money(t.atRisk)} color={OPS.yellow}/>
          </div>
        </button>)}
      </OpsCard>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <OpsCard><div style={{fontSize:15,fontWeight:900,color:OPS.text,marginBottom:8}}>🚩 {es?'Issues principales':'Top issues'}</div>{topIssues.length===0?<div style={{fontSize:11,color:OPS.green}}>✅ {es?'No hay issues visibles.':'No visible issues.'}</div>:topIssues.map(i=><div key={i.code} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,padding:'7px 0',borderTop:`1px solid ${OPS.border}`}}><div style={{fontSize:11,color:OPS.text}}>{i.label}<div style={{fontSize:9,color:OPS.dim}}>{i.code}</div></div><div style={{fontWeight:900,color:i.severity==='critical'?OPS.red:OPS.yellow}}>{i.count}</div></div>)}</OpsCard>
        <OpsCard><div style={{fontSize:15,fontWeight:900,color:OPS.text,marginBottom:8}}>✅ {es?'Regla listo para facturar':'Ready-to-bill rule'}</div><div style={{fontSize:11,color:OPS.dim,lineHeight:1.6}}>{es?'Un trabajo cuenta como listo si está completado, tiene billing code, valor mayor que cero, al menos una foto BEFORE y una foto AFTER sincronizada.':'A job is ready if completed, has billing code, has value greater than zero, and has at least one synced BEFORE and AFTER photo.'}</div></OpsCard>
      </div>
    </div>

    <OpsCard>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}><div style={{fontSize:15,fontWeight:900,color:OPS.text}}>📋 {es?'Trabajos para revisar':'Jobs to review'}</div><div style={{fontSize:11,color:OPS.dim}}>{filteredRows.length} {es?'resultados':'results'}</div></div>
      {loading?<div style={{padding:25,textAlign:'center',color:OPS.dim}}>Loading…</div>:filteredRows.length===0?<OpsEmpty>{es?'Sin resultados para estos filtros.':'No results for these filters.'}</OpsEmpty>:<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr>{['Status','Tech','Job','Billing','Photos','Issue','Source'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 6px',borderBottom:`1px solid ${OPS.border}`,color:OPS.dim}}>{h}</th>)}</tr></thead><tbody>{filteredRows.slice(0,250).map(row=>{ const rowIssues=issueByRow.get(row.id)||[]; const critical=rowIssues.some(i=>i.severity==='critical'); const ready=isReady(row,issueByRow); return <tr key={row.id}><td style={{...td,color:ready?OPS.green:critical?OPS.red:rowIssues.length?OPS.yellow:OPS.dim,fontWeight:900}}>{ready?'READY':row.status_group}</td><td style={td}>#{row.tech_id}<div style={{fontSize:9,color:OPS.dim}}>{row.tech_name}</div></td><td style={td}><b style={{color:OPS.blue}}>#{row.job_id||'—'}</b><div style={{fontSize:9,color:OPS.dim,maxWidth:260,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.address}</div></td><td style={td}><b>{row.pay_code||'—'}</b><div style={{fontSize:9,color:OPS.green}}>{money(row.pay_total)}</div></td><td style={td}><span style={{color:row.photo_before?OPS.green:OPS.red}}>B{row.photo_before||0}</span> / <span style={{color:row.photo_after?OPS.green:OPS.red}}>A{row.photo_after||0}</span>{row.local_pending_photos ? <div style={{fontSize:9,color:OPS.yellow}}>⏳ {row.local_pending_photos} local</div> : null}</td><td style={td}>{rowIssues.length===0?<span style={{color:OPS.green}}>OK</span>:rowIssues.slice(0,3).map(i=><div key={i.code} style={{color:i.severity==='critical'?OPS.red:i.severity==='warning'?OPS.yellow:OPS.blue,fontWeight:800,marginBottom:2}}>{i.label}</div>)}</td><td style={{...td,color:OPS.dim}}>{row.source}</td></tr>; })}</tbody></table></div>}
    </OpsCard>
    <style>{`@media(max-width:1050px){.closeout-qa-filters{grid-template-columns:1fr 1fr!important}.closeout-qa-grid{grid-template-columns:1fr!important}.closeout-tech-row{grid-template-columns:1fr repeat(2,72px)!important}} @media(max-width:650px){.closeout-qa-filters,.closeout-tech-row{grid-template-columns:1fr!important}}`}</style>
  </div>;
}
function Metric({label,value,color}:{label:string;value:any;color:string}){ return <div style={{textAlign:'right'}}><div style={{fontWeight:900,color,fontSize:12}}>{value}</div><div style={{fontSize:8,color:OPS.dim,textTransform:'uppercase'}}>{label}</div></div>; }
