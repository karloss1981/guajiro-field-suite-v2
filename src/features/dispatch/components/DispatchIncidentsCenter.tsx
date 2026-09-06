// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { createAuditLog } from '../../../services/audit.service';
import { OpsButton, OpsCard, OpsEmpty, OpsError, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';

const LOCAL_INCIDENTS_KEY = 'gfs_local_incidents_v234';
const QUICK_PHRASES = ['811', 'customer absent', 'customer ausente', 'misil', 'no access', 'missing photo', 'billing', 'pending close'];
const CATEGORY_LABELS: Record<string,string> = {
  customer_absent: 'Customer absent',
  access_811: '811 / utility mark',
  misil: 'Misil',
  missing_photo: 'Missing photo',
  billing_risk: 'Billing risk',
  duplicate: 'Duplicate',
  pending_close: 'Pending close',
  not_done: 'Not done',
  dispatch_problem: 'Dispatch problem',
  other: 'Other problem',
};
const SEVERITY_COLOR: Record<string,string> = { critical: OPS.red, high: OPS.yellow, medium: OPS.blue, low: OPS.dim };

type FactRow = {
  id: string;
  route_id?: string;
  job_id?: string;
  date?: string;
  tech_id?: string;
  tech_name?: string;
  status?: string;
  status_group: 'completed' | 'not_done' | 'pending' | 'other';
  address?: string;
  city?: string;
  zip?: string;
  phone?: string;
  type?: string;
  reason?: string;
  notes?: string;
  pay_code?: string;
  pay_total: number;
  source: string;
  photo_before?: number;
  photo_after?: number;
  categories?: string[];
  severity?: string;
};

function norm(v:any){ return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function money(v:any){ const n=Number(String(v ?? '').replace(/[$,]/g,'')); return Number.isFinite(n) ? n : 0; }
function todayIso(){ return new Date().toLocaleDateString('en-CA'); }
function daysAgo(days:number){ const d=new Date(); d.setDate(d.getDate()-days); return d.toLocaleDateString('en-CA'); }
function tomorrowIso(){ const d=new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); }
function uuidish(v:any){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')); }
function safeJson(raw:string|null,fallback:any){ try{return raw?JSON.parse(raw):fallback;}catch{return fallback;} }
function localIncidents(){ return safeJson(localStorage.getItem(LOCAL_INCIDENTS_KEY), []); }
function saveLocalIncidents(rows:any[]){ try{ localStorage.setItem(LOCAL_INCIDENTS_KEY, JSON.stringify(rows)); }catch{} }
function localId(){ return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
async function safe(label:string, promise:any){ try{ const r=await promise; if(r?.error) return { data:[], warning:`${label}: ${r.error.message || r.error}` }; return { data:r?.data || [], warning:'' }; }catch(e:any){ return { data:[], warning:`${label}: ${e?.message || String(e)}` }; } }
function first(...values:any[]){ return values.find(v=>String(v ?? '').trim()) ?? ''; }
function statusGroup(status:any){ const s=norm(status); if(['done','completed','complete','closed'].includes(s)) return 'completed'; if(['notdone','not_done','not completed','not_completed','cancelled','canceled','fail','failed'].includes(s)) return 'not_done'; if(['pending','open','assigned','in_progress',''].includes(s)) return 'pending'; return 'other'; }
function mapRow(row:any, source:string):FactRow{
  const date = String(first(row.date,row.route_date,row.completed_at,row.created_at,row.source_route_date)).slice(0,10);
  return {
    id: `${source}:${first(row.id,row.route_id,row.job_id,row.job_number,row.work_order,row.address,Math.random())}`,
    route_id: first(row.route_id,row.id),
    job_id: first(row.job_id,row.job_number,row.work_order,row.original_job_id,row.jobNumber),
    date,
    tech_id: first(row.tech_id,row.technician_id,row.latest_technician_id,row.source_technician_id,row.tech_number,row.assigned_to),
    tech_name: first(row.tech_name,row.technician_name,row.name),
    status: first(row.status,row.current_status),
    status_group: statusGroup(first(row.status,row.current_status)),
    address: first(row.address,row.service_address,row.location),
    city: first(row.city,row.town),
    zip: first(row.zip,row.zip_code,row.postal_code),
    phone: first(row.phone,row.customer_phone),
    type: first(row.type,row.work_type,row.service_type),
    reason: first(row.reason,row.not_done_reason,row.latest_reason,row.original_reason),
    notes: first(row.notes,row.comments,row.latest_notes,row.description,row.resolution_notes),
    pay_code: first(row.pay_code,row.billing_code,row.code),
    pay_total: money(first(row.pay_total,row.pay,row.value,row.amount)),
    source,
  };
}
function flattenSnapshot(record:any, source:string):FactRow[]{
  const raw = record?.snapshot || record?.route_data || record?.jobs || [];
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.jobs) ? raw.jobs : []);
  const defaultDate = String(first(record.date, record.route_date, record.created_at)).slice(0,10);
  return list.map((job:any)=>mapRow({ ...job, date:first(job.date, defaultDate), region:first(job.region,record.region) }, source));
}
function dedupe(rows:FactRow[]){
  const map=new Map<string,FactRow>();
  const priority:any={ incident_reports:8, routes:6, completed_jobs:5, not_done_reports:5, not_done_pool:4, reworks:3, daily_route_snapshots:2, archived_routes:1 };
  [...rows].sort((a,b)=>(priority[b.source]||0)-(priority[a.source]||0)).forEach((r,i)=>{
    const key=[r.date||'unknown',r.tech_id||'unassigned',r.job_id||r.address||i].map(norm).join('|');
    if(!map.has(key)) map.set(key,r);
  });
  return [...map.values()];
}
async function fetchPhotoCounts(rows:FactRow[]){
  const routeIds=[...new Set(rows.map(r=>r.route_id).filter(Boolean))].slice(0,700);
  const jobIds=[...new Set(rows.map(r=>r.job_id).filter(Boolean))].slice(0,700);
  const photoRows:any[]=[]; const warnings:string[]=[];
  if(routeIds.length){ const r=await safe('photos by route', sb.from('photos').select('route_id,job_id,photo_type').in('route_id', routeIds).limit(6000)); photoRows.push(...r.data); if(r.warning)warnings.push(r.warning); }
  if(jobIds.length){ const r=await safe('photos by job', sb.from('photos').select('route_id,job_id,photo_type').in('job_id', jobIds).limit(6000)); photoRows.push(...r.data); if(r.warning)warnings.push(r.warning); }
  const byRoute=new Map<string,any>(); const byJob=new Map<string,any>();
  const add=(map:Map<string,any>,key:any,p:any)=>{ if(!key)return; const item=map.get(String(key))||{before:0,after:0,other:0}; const t=norm(p.photo_type || p.type || 'other'); if(t==='evidence'||t.includes('before') || t==='b')item.before++; else if(t==='pht'||t.includes('after') || t==='a')item.after++; else item.other++; map.set(String(key),item); };
  photoRows.forEach(p=>{ add(byRoute,p.route_id,p); add(byJob,p.job_id,p); });
  return { byRoute, byJob, warnings };
}
function classify(row:FactRow){
  const hay=norm([row.reason,row.notes,row.status,row.type,row.address,row.job_id,row.pay_code].join(' '));
  const categories:string[]=[];
  if(hay.includes('811')) categories.push('access_811');
  if(hay.includes('customer absent') || hay.includes('customer ausente') || hay.includes('customer no home') || hay.includes('no home')) categories.push('customer_absent');
  if(hay.includes('misil') || hay.includes('missile') || hay.includes('missed')) categories.push('misil');
  if(row.status_group==='completed' && (!row.photo_before || !row.photo_after)) categories.push('missing_photo');
  if(row.status_group==='completed' && (!row.pay_code || !Number(row.pay_total||0))) categories.push('billing_risk');
  if(row.status_group==='not_done') categories.push('not_done');
  if(hay.includes('pending close') || hay.includes('sync') || hay.includes('upload pending')) categories.push('pending_close');
  if(row.status_group==='pending' && !row.tech_id) categories.push('dispatch_problem');
  if(!categories.length && row.source==='reworks') categories.push('dispatch_problem');
  return [...new Set(categories)];
}
function severityFor(row:FactRow, cats:string[]){
  if(cats.includes('missing_photo') || cats.includes('billing_risk') || cats.includes('pending_close')) return 'critical';
  if(cats.includes('access_811') || cats.includes('misil') || cats.includes('customer_absent')) return 'high';
  if(cats.includes('not_done') || cats.includes('dispatch_problem')) return 'medium';
  return 'low';
}
function exportIncidents(rows:FactRow[], incidents:any[], filename:string){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r=>({ Date:r.date, Tech:r.tech_id, 'Tech Name':r.tech_name, 'Job ID':r.job_id, Severity:r.severity, Categories:(r.categories||[]).map(c=>CATEGORY_LABELS[c]||c).join(' | '), Status:r.status_group, Address:r.address, City:r.city, ZIP:r.zip, Reason:r.reason, Notes:r.notes, 'Billing Code':r.pay_code, Value:r.pay_total, Before:r.photo_before, After:r.photo_after, Source:r.source }))), 'Detected Problems');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incidents.map(i=>({ ID:i.id, Date:i.date, Status:i.status, Severity:i.severity, Category:i.incident_type, Tech:i.tech_id, Assigned:i.assigned_to, Job:i.job_id, Address:i.address, Title:i.title, Notes:i.notes, Source:i._local?'local':'supabase', Created:i.created_at, Updated:i.updated_at }))), 'Incidents');
  XLSX.writeFile(wb, filename);
}
function toIncidentPayload(row:FactRow, actorName:string, region:string, status='open'){
  const cats=row.categories?.length ? row.categories : classify(row);
  const type=cats[0] || 'other';
  const title=`${CATEGORY_LABELS[type] || type} · ${row.job_id || row.address || 'job'}`;
  return {
    region,
    job_id:String(row.job_id || ''),
    route_id:uuidish(row.route_id) ? row.route_id : null,
    source:row.source,
    incident_type:type,
    severity:row.severity || severityFor(row,cats),
    status,
    priority: type==='missing_photo' || type==='billing_risk' ? 1 : type==='access_811' || type==='customer_absent' || type==='misil' ? 2 : 3,
    tech_id:String(row.tech_id || ''),
    assigned_to:String(row.tech_id || ''),
    date:row.date || null,
    address:row.address || '',
    city:row.city || '',
    zip:row.zip || '',
    title,
    description:[row.reason,row.notes].filter(Boolean).join(' · '),
    tags:cats,
    notes:'',
    billing_code:row.pay_code || '',
    billing_value:Number(row.pay_total || 0),
    photo_before:Number(row.photo_before || 0),
    photo_after:Number(row.photo_after || 0),
    created_by:actorName,
    updated_at:new Date().toISOString(),
  };
}
function upsertLocalIncident(payload:any){
  const rows=localIncidents();
  const key=norm([payload.date,payload.tech_id,payload.job_id || payload.address,payload.incident_type].join('|'));
  const existing=rows.find((r:any)=>r._key===key || String(r.id)===String(payload.id));
  const next={ ...(existing||{}), ...payload, id:existing?.id || payload.id || localId(), _key:key, _local:true, updated_at:new Date().toISOString(), created_at:existing?.created_at || new Date().toISOString() };
  saveLocalIncidents([next, ...rows.filter((r:any)=>r.id!==next.id && r._key!==key)].slice(0,1000));
  return next;
}
function patchLocalIncident(id:string, patch:any){
  const rows=localIncidents();
  const next=rows.map((r:any)=>String(r.id)===String(id)?{...r,...patch,updated_at:new Date().toISOString()}:r);
  saveLocalIncidents(next);
}

export default function DispatchIncidentsCenter({ region, lang, readOnly=false, actorName='Supervisor' }:{ region:string; lang:string; readOnly?:boolean; actorName?:string }){
  const es=lang==='es';
  const [from,setFrom]=useState(daysAgo(30));
  const [to,setTo]=useState(todayIso());
  const [techQuery,setTechQuery]=useState('');
  const [phrase,setPhrase]=useState('');
  const [statusFilter,setStatusFilter]=useState('open');
  const [categoryFilter,setCategoryFilter]=useState('all');
  const [severityFilter,setSeverityFilter]=useState('all');
  const [rows,setRows]=useState<FactRow[]>([]);
  const [incidents,setIncidents]=useState<any[]>([]);
  const [techs,setTechs]=useState<any[]>([]);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState('');
  const [note,setNote]=useState('');
  const [assignTo,setAssignTo]=useState('');
  const [targetDate,setTargetDate]=useState(tomorrowIso());

  const load = useCallback(async()=>{
    setLoading(true); setError(''); setWarnings([]);
    const [routes,completed,reports,pool,daily,archive,reworkResult,incidentResult,techResult] = await Promise.all([
      safe('routes', (()=>{ let q=sb.from('routes').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('completed_jobs', (()=>{ let q=sb.from('completed_jobs').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_reports', (()=>{ let q=sb.from('not_done_reports').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_pool', (()=>{ let q=sb.from('not_done_pool').select('*').limit(2500); if(region)q=q.eq('region',region); return q; })()),
      safe('daily_route_snapshots', (()=>{ let q=sb.from('daily_route_snapshots').select('date,region,snapshot').gte('date',from).lte('date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
      safe('archived_routes', (()=>{ let q=sb.from('archived_routes').select('route_date,region,snapshot').gte('route_date',from).lte('route_date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
      safe('reworks', sb.from('reworks').select('*').order('created_at',{ascending:false}).limit(1000)),
      safe('incident_reports', (()=>{ let q=sb.from('incident_reports').select('*').order('updated_at',{ascending:false}).limit(1500); if(region)q=q.eq('region',region); return q; })()),
      safe('technicians', (()=>{ let q=sb.from('technicians').select('id,name,region').limit(1000); if(region)q=q.eq('region',region); return q; })()),
    ]);
    const base = dedupe([
      ...(routes.data||[]).map((r:any)=>mapRow(r,'routes')),
      ...(completed.data||[]).map((r:any)=>mapRow({...r,status:first(r.status,'done')},'completed_jobs')),
      ...(reports.data||[]).map((r:any)=>mapRow({...r,status:first(r.status,'not_done')},'not_done_reports')),
      ...(pool.data||[]).map((r:any)=>mapRow({...r,date:first(r.last_not_done_date,r.first_not_done_date),status:first(r.current_status,'not_done'),tech_id:first(r.latest_technician_id,r.source_technician_id),reason:first(r.latest_reason,r.original_reason),notes:r.latest_notes,type:r.work_type},'not_done_pool')),
      ...(daily.data||[]).flatMap((r:any)=>flattenSnapshot(r,'daily_route_snapshots')),
      ...(archive.data||[]).flatMap((r:any)=>flattenSnapshot(r,'archived_routes')),
      ...(reworkResult.data||[]).map((r:any)=>mapRow({...r,status:r.resolved?'resolved':'rework',reason:r.reason,notes:r.resolution_notes,job_id:r.original_job_id,tech_id:r.assigned_to},'reworks')),
    ].filter((r:FactRow)=>!r.date || (r.date>=from && r.date<=to)));
    const photos=await fetchPhotoCounts(base);
    const withPhotos = base.map(row=>{ const c=photos.byRoute.get(String(row.route_id||'')) || photos.byJob.get(String(row.job_id||'')) || {before:0,after:0}; const cats=classify({...row,photo_before:c.before||0,photo_after:c.after||0}); return {...row, photo_before:c.before||0, photo_after:c.after||0, categories:cats, severity:severityFor(row,cats)}; });
    const problemRows = withPhotos.filter(r=>r.categories?.length);
    const local = localIncidents();
    setRows(problemRows); setTechs(techResult.data||[]); setIncidents([...(incidentResult.data||[]), ...local]);
    setWarnings([routes.warning,completed.warning,reports.warning,pool.warning,daily.warning,archive.warning,reworkResult.warning,incidentResult.warning,techResult.warning,...photos.warnings].filter(Boolean));
    setLoading(false);
  },[from,to,region]);
  useEffect(()=>{ load(); },[load]);

  const incidentKeySet = useMemo(()=>new Set(incidents.map((i:any)=>norm([i.date,i.tech_id,i.job_id || i.address,i.incident_type].join('|')))),[incidents]);
  const filteredRows = useMemo(()=>{
    const tq=norm(techQuery); const ph=norm(phrase);
    return rows.filter(row=>{
      const techHay=norm([row.tech_id,row.tech_name].join(' '));
      const hay=norm([row.job_id,row.address,row.city,row.zip,row.reason,row.notes,row.status,row.type,row.pay_code,(row.categories||[]).join(' ')].join(' '));
      const catOk=categoryFilter==='all' || (row.categories||[]).includes(categoryFilter);
      const sevOk=severityFilter==='all' || row.severity===severityFilter;
      return (!tq || techHay.includes(tq)) && (!ph || hay.includes(ph)) && catOk && sevOk;
    });
  },[rows,techQuery,phrase,categoryFilter,severityFilter]);
  const filteredIncidents = useMemo(()=>{
    const tq=norm(techQuery); const ph=norm(phrase);
    return incidents.filter((i:any)=>{
      const techHay=norm([i.tech_id,i.assigned_to].join(' '));
      const hay=norm([i.job_id,i.address,i.city,i.zip,i.title,i.description,i.notes,i.status,i.incident_type,(i.tags||[]).join(' ')].join(' '));
      const statusOk=statusFilter==='all' || (statusFilter==='open' ? !['resolved','cancelled','canceled'].includes(norm(i.status)) : norm(i.status)===statusFilter);
      const catOk=categoryFilter==='all' || norm(i.incident_type)===categoryFilter || (Array.isArray(i.tags)&&i.tags.map(norm).includes(categoryFilter));
      const sevOk=severityFilter==='all' || norm(i.severity)===severityFilter;
      return statusOk && (!tq || techHay.includes(tq)) && (!ph || hay.includes(ph)) && catOk && sevOk;
    });
  },[incidents,techQuery,phrase,statusFilter,categoryFilter,severityFilter]);
  const stats = useMemo(()=>{
    const open=incidents.filter((i:any)=>!['resolved','cancelled','canceled'].includes(norm(i.status))).length;
    const critical=incidents.filter((i:any)=>norm(i.severity)==='critical' && !['resolved','cancelled','canceled'].includes(norm(i.status))).length;
    const route=incidents.filter((i:any)=>norm(i.status).includes('route')).length;
    const resolved=incidents.filter((i:any)=>['resolved'].includes(norm(i.status))).length;
    const atRisk=filteredRows.reduce((s,r)=>s+Number(r.pay_total||0),0);
    return { detected:filteredRows.length, incidents:filteredIncidents.length, open, critical, route, resolved, atRisk };
  },[filteredRows,filteredIncidents,incidents]);
  const techStats = useMemo(()=>{
    const map=new Map<string,any>();
    filteredRows.forEach(r=>{ const id=String(r.tech_id || 'unassigned'); const item=map.get(id)||{id,name:r.tech_name||'',count:0,critical:0,value:0,cats:{}}; item.count++; if(r.severity==='critical')item.critical++; item.value+=Number(r.pay_total||0); (r.categories||[]).forEach(c=>item.cats[c]=(item.cats[c]||0)+1); map.set(id,item); });
    return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,12);
  },[filteredRows]);

  async function createIncident(row:FactRow, status='open'){
    if(readOnly)return; setBusy(`inc-${row.id}`); setError('');
    const payload=toIncidentPayload(row, actorName, region, status);
    try{
      const { error } = await sb.from('incident_reports').insert(payload).select().single();
      if(error) throw error;
      await createAuditLog({ action:'incident_created', entity:'incident_reports', entityId:row.route_id || row.job_id, metadata:{ region, actorName, job_id:row.job_id, status, type:payload.incident_type, severity:payload.severity, summary:`Incident created for ${row.job_id || row.address}` } });
    }catch(e:any){
      const local=upsertLocalIncident(payload);
      await createAuditLog({ action:'incident_created_local', entity:'incident_reports', entityId:row.route_id || row.job_id, metadata:{ region, actorName, job_id:row.job_id, status, local_id:local.id, warning:e?.message, summary:`Incident retained locally for ${row.job_id || row.address}` } });
    }finally{ setBusy(''); await load(); }
  }
  async function createVisibleIncidents(){
    if(readOnly)return; setBusy('bulk-incidents');
    const targets=filteredRows.filter(row=>!incidentKeySet.has(norm([row.date,row.tech_id,row.job_id || row.address,(row.categories||['other'])[0]].join('|')))).slice(0,50);
    for(const row of targets){ await createIncident(row,'open'); }
    setBusy('');
  }
  async function updateIncident(incident:any, patch:any){
    if(readOnly)return; setBusy(`upd-${incident.id}`); setError('');
    const next={...patch, updated_at:new Date().toISOString()};
    if(patch.status==='resolved') next.resolved_at=new Date().toISOString();
    try{
      if(incident._local) throw new Error('Local incident');
      const { error }=await sb.from('incident_reports').update(next).eq('id',incident.id);
      if(error) throw error;
      await createAuditLog({ action:'incident_updated', entity:'incident_reports', entityId:incident.id, metadata:{ region, actorName, job_id:incident.job_id, patch:next, summary:`Incident ${incident.job_id || incident.id} updated to ${patch.status || 'updated'}` } });
    }catch(e:any){
      patchLocalIncident(incident.id,next);
      await createAuditLog({ action:'incident_updated_local', entity:'incident_reports', entityId:incident.id, metadata:{ region, actorName, job_id:incident.job_id, patch:next, warning:e?.message, summary:`Local incident ${incident.job_id || incident.id} updated` } });
    }finally{ setBusy(''); await load(); }
  }
  async function addToRoute(row:FactRow){
    if(readOnly)return; setBusy(`route-${row.id}`); setError('');
    const payload:any={
      region,
      date:targetDate,
      job_id:String(row.job_id || ''),
      tech_id:String(assignTo || row.tech_id || ''),
      tech_name: techs.find((t:any)=>String(t.id)===String(assignTo || row.tech_id))?.name || row.tech_name || '',
      address:row.address || '', city:row.city || '', zip:row.zip || '', phone:row.phone || '', type:row.type || '', status:'pending',
      reason:row.reason || '', notes:`Incident follow-up: ${(row.categories||[]).map(c=>CATEGORY_LABELS[c]||c).join(', ')}${note?` — ${note}`:''}`,
      pay_code:row.pay_code || '', pay_total:Number(row.pay_total || 0), source_route_date:row.date || null,
    };
    try{
      const { error }=await sb.from('routes').insert(payload).select().single();
      if(error) throw error;
      await createIncident(row,'route_next_day');
      await createAuditLog({ action:'incident_added_to_route', entity:'routes', entityId:row.route_id || row.job_id, metadata:{ region, actorName, job_id:row.job_id, targetDate, targetTech:payload.tech_id, summary:`Incident ${row.job_id} copied to ${targetDate} route` } });
    }catch(e:any){
      const local=upsertLocalIncident({...toIncidentPayload(row,actorName,region,'route_next_day'), notes:`Queued for route ${targetDate}. ${note || ''}`, assigned_to:payload.tech_id, target_route_date:targetDate, route_payload:payload, sync_error:e?.message});
      await createAuditLog({ action:'incident_route_queue_local', entity:'incident_reports', entityId:row.route_id || row.job_id, metadata:{ region, actorName, local_id:local.id, job_id:row.job_id, targetDate, warning:e?.message, summary:`Incident ${row.job_id} queued locally for ${targetDate}` } });
    }finally{ setBusy(''); setNote(''); await load(); }
  }

  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <OpsError message={error} />
    {warnings.length>0 && <div style={{background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:10,padding:'10px 12px',color:'#ffcf55',fontSize:11}}>⚠ {warnings.slice(0,5).join(' · ')}{warnings.length>5?' …':''}</div>}

    <div style={{display:'grid',gridTemplateColumns:'repeat(6,minmax(120px,1fr))',gap:10}} className="dispatch-incidents-stats">
      {[['Detected',stats.detected,OPS.blue],['Open',stats.open,OPS.yellow],['Critical',stats.critical,OPS.red],['Route queue',stats.route,OPS.purple],['Resolved',stats.resolved,OPS.green],['At-risk $',`$${stats.atRisk.toFixed(0)}`,OPS.green]].map(([label,value,color])=><OpsCard key={label} style={{padding:12}}><div style={{fontSize:10,color:OPS.dim,fontWeight:900,textTransform:'uppercase'}}>{label}</div><div style={{fontSize:24,color,fontWeight:900,marginTop:4}}>{value}</div></OpsCard>)}
    </div>

    <OpsCard>
      <div style={{display:'grid',gridTemplateColumns:'120px 120px 1fr 150px 150px 150px auto',gap:8,alignItems:'center'}} className="dispatch-incidents-filters">
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={fieldStyle}/>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={fieldStyle}/>
        <input value={techQuery} onChange={e=>setTechQuery(e.target.value)} placeholder={es?'Técnico nombre o número':'Tech name or number'} style={fieldStyle}/>
        <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)} style={fieldStyle}><option value="all">All categories</option>{Object.entries(CATEGORY_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <select value={severityFilter} onChange={e=>setSeverityFilter(e.target.value)} style={fieldStyle}><option value="all">All severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={fieldStyle}><option value="open">Open incidents</option><option value="all">All incidents</option><option value="route_next_day">Route next day</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="cancelled">Cancelled</option></select>
        <OpsButton onClick={load} tone="dim">↻ Refresh</OpsButton>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 150px 150px auto auto',gap:8,alignItems:'center',marginTop:8}} className="dispatch-incidents-filters">
        <input value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder={es?'Buscar frases: 811, customer ausente, misil, no access':'Search phrases: 811, customer absent, misil, no access'} style={fieldStyle}/>
        <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} style={fieldStyle}/>
        <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} style={fieldStyle}><option value="">Target tech</option>{techs.map((t:any)=><option key={t.id} value={t.id}>{t.name} · #{t.id}</option>)}</select>
        <OpsButton onClick={()=>exportIncidents(filteredRows,filteredIncidents,`incidents-${region}-${from}-${to}.xlsx`)} tone="green">Export XLSX</OpsButton>
        <OpsButton disabled={readOnly || busy==='bulk-incidents'} onClick={createVisibleIncidents} tone="purple">{busy==='bulk-incidents'?'…':'Auto-create visible'}</OpsButton>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>{QUICK_PHRASES.map(p=><button key={p} onClick={()=>setPhrase(p)} style={{background:norm(phrase)===norm(p)?'#00b8f522':'#162e58',border:`1px solid ${norm(phrase)===norm(p)?OPS.blue:OPS.border}`,borderRadius:20,color:norm(phrase)===norm(p)?OPS.blue:OPS.dim,padding:'5px 9px',fontWeight:900,fontSize:10,cursor:'pointer'}}>{p}</button>)}</div>
    </OpsCard>

    <div style={{display:'grid',gridTemplateColumns:'minmax(260px,320px) minmax(0,1fr)',gap:12,alignItems:'start'}} className="dispatch-incidents-grid">
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <OpsCard><div style={{fontWeight:900,color:OPS.text,marginBottom:8}}>Technician problem ranking</div>{techStats.length===0?<div style={{color:OPS.dim,fontSize:11}}>No technician stats for these filters.</div>:techStats.map(t=><div key={t.id} style={{borderTop:`1px solid ${OPS.border}`,padding:'8px 0'}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><b style={{color:OPS.text}}>#{t.id} {t.name}</b><span style={{color:t.critical?OPS.red:OPS.blue,fontWeight:900}}>{t.count}</span></div><div style={{fontSize:10,color:OPS.dim}}>critical {t.critical} · ${t.value.toFixed(0)}</div><div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:5}}>{Object.entries(t.cats).sort((a:any,b:any)=>b[1]-a[1]).slice(0,4).map(([c,n]:any)=><span key={c} style={{fontSize:9,background:'#162e58',borderRadius:20,padding:'2px 6px',color:'#dbe8ff'}}>{CATEGORY_LABELS[c]||c}: {n}</span>)}</div></div>)}</OpsCard>
        <OpsCard><div style={{fontWeight:900,color:OPS.text,marginBottom:6}}>Workflow</div><div style={{fontSize:11,color:OPS.dim,lineHeight:1.7}}>Detected problem → Create incident → assign / route next day → in review → resolved. Local fallback keeps the incident if Supabase/RLS blocks the insert.</div></OpsCard>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <OpsCard><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:10}}><div><div style={{fontWeight:900,color:OPS.text}}>Open / saved incidents</div><div style={{fontSize:10,color:OPS.dim}}>{filteredIncidents.length} incidents</div></div></div>{filteredIncidents.length===0?<OpsEmpty>No incidents for these filters yet.</OpsEmpty>:filteredIncidents.slice(0,120).map((i:any)=><div key={i.id} style={{borderTop:`1px solid ${OPS.border}`,padding:'10px 0',display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10}} className="incident-row"><div><div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}><span style={{color:SEVERITY_COLOR[norm(i.severity)]||OPS.dim,fontWeight:900}}>{norm(i.severity)||'medium'}</span><b style={{color:OPS.blue}}>#{i.job_id || 'no-job'}</b><span style={{fontSize:9,background:'#162e58',borderRadius:20,padding:'2px 6px',color:'#dbe8ff'}}>{CATEGORY_LABELS[norm(i.incident_type)]||i.incident_type||'incident'}</span><span style={{fontSize:9,color:i._local?OPS.yellow:OPS.green}}>{i._local?'local':'supabase'}</span><span style={{fontSize:9,color:OPS.dim}}>{i.status || 'open'}</span></div><div style={{fontSize:12,color:OPS.text,marginTop:3}}>{i.title || i.address}</div><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>Tech #{i.tech_id || i.assigned_to || '-'} · {i.date || '-'} · {i.address || ''} {i.city || ''}</div><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>{i.description || i.notes || ''}</div></div><div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'flex-end'}}>{!readOnly&&<><OpsButton disabled={busy===`upd-${i.id}`} onClick={()=>updateIncident(i,{status:'in_review', notes:note || i.notes || ''})} tone="yellow">Review</OpsButton><OpsButton disabled={busy===`upd-${i.id}`} onClick={()=>updateIncident(i,{status:'route_next_day', assigned_to:assignTo || i.assigned_to || i.tech_id, target_route_date:targetDate, notes:note || i.notes || ''})} tone="purple">Route</OpsButton><OpsButton disabled={busy===`upd-${i.id}`} onClick={()=>updateIncident(i,{status:'resolved', notes:note || i.notes || 'Resolved'})} tone="green">Resolve</OpsButton></>}</div></div>)}</OpsCard>

        <OpsCard><div style={{fontWeight:900,color:OPS.text,marginBottom:10}}>Detected problem jobs</div><input value={note} onChange={e=>setNote(e.target.value)} placeholder={es?'Nota rápida para incidente / resolución':'Quick note for incident / resolution'} style={{...fieldStyle,marginBottom:8}} />{loading?<div style={{padding:25,textAlign:'center',color:OPS.dim}}>Loading…</div>:filteredRows.length===0?<OpsEmpty>No problem jobs detected for these filters.</OpsEmpty>:filteredRows.slice(0,250).map(row=>{
          const key=norm([row.date,row.tech_id,row.job_id || row.address,(row.categories||['other'])[0]].join('|'));
          const exists=incidentKeySet.has(key);
          return <div key={row.id} style={{borderTop:`1px solid ${OPS.border}`,padding:'10px 0',display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10}} className="incident-row"><div><div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}><b style={{color:OPS.blue}}>#{row.job_id || 'no-job'}</b><span style={{color:SEVERITY_COLOR[row.severity||'medium'],fontWeight:900}}>{row.severity}</span>{(row.categories||[]).map(c=><span key={c} style={{fontSize:9,background:'#162e58',borderRadius:20,padding:'2px 6px',color:'#dbe8ff'}}>{CATEGORY_LABELS[c]||c}</span>)}{exists&&<span style={{fontSize:9,color:OPS.green}}>incident exists</span>}</div><div style={{fontSize:12,color:OPS.text,marginTop:3}}>{row.address}</div><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>Tech #{row.tech_id || '-'} {row.tech_name || ''} · {row.date || '-'} · {row.city || ''} {row.zip || ''} · {row.source}</div><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>{row.reason || row.notes || row.status}</div><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>B{row.photo_before||0}/A{row.photo_after||0} · {row.pay_code || 'no code'} · ${Number(row.pay_total||0).toFixed(0)}</div></div><div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'flex-end'}}>{!readOnly&&<><OpsButton disabled={exists || busy===`inc-${row.id}`} onClick={()=>createIncident(row)} tone="red">{busy===`inc-${row.id}`?'…':'Create'}</OpsButton><OpsButton disabled={busy===`route-${row.id}`} onClick={()=>addToRoute(row)} tone="purple">{busy===`route-${row.id}`?'…':'Route next'}</OpsButton></>}</div></div>;
        })}</OpsCard>
      </div>
    </div>
    <style>{`@media(max-width:1050px){.dispatch-incidents-grid{grid-template-columns:1fr!important}.dispatch-incidents-stats{grid-template-columns:repeat(2,1fr)!important}.dispatch-incidents-filters{grid-template-columns:1fr!important}.incident-row{grid-template-columns:1fr!important}}`}</style>
  </div>;
}
