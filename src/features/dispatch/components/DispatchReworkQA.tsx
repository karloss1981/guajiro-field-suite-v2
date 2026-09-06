// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { createAuditLog } from '../../../services/audit.service';
import { OpsButton, OpsCard, OpsEmpty, OpsError, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';

const LOCAL_REWORKS_KEY = 'gfs_local_reworks_v233';
const ISSUE_LABELS: Record<string,string> = {
  missing_before: 'Missing BEFORE photo',
  missing_after: 'Missing AFTER photo',
  missing_billing: 'Missing billing code',
  zero_value: 'Billing value is $0',
  not_done_no_reason: 'Not Done without reason',
  not_done_with_value: 'Not Done has billing value',
  duplicate_job: 'Possible duplicate job',
  problem_phrase: 'Problem phrase match',
  pending_close: 'Pending Close / sync risk',
};

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
  issue_codes?: string[];
};

function norm(v:any){ return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function money(v:any){ const n=Number(String(v ?? '').replace(/[$,]/g,'')); return Number.isFinite(n) ? n : 0; }
function todayIso(){ return new Date().toLocaleDateString('en-CA'); }
function daysAgo(days:number){ const d=new Date(); d.setDate(d.getDate()-days); return d.toLocaleDateString('en-CA'); }
function uuidish(v:any){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')); }
function safeJson(raw:string|null,fallback:any){ try{return raw?JSON.parse(raw):fallback;}catch{return fallback;} }
function getLocalReworks(){ return safeJson(localStorage.getItem(LOCAL_REWORKS_KEY), []); }
function setLocalReworks(rows:any[]){ try{ localStorage.setItem(LOCAL_REWORKS_KEY, JSON.stringify(rows)); }catch{} }
async function safe(label:string, promise:any){ try{ const r=await promise; if(r?.error) return { data:[], warning:`${label}: ${r.error.message || r.error}` }; return { data:r?.data || [], warning:'' }; }catch(e:any){ return { data:[], warning:`${label}: ${e?.message || String(e)}` }; } }
function statusGroup(status:any){
  const s=norm(status);
  if(['done','completed','complete','closed'].includes(s)) return 'completed';
  if(['notdone','not_done','not completed','not_completed','cancelled','canceled','fail','failed'].includes(s)) return 'not_done';
  if(['pending','open','assigned','in_progress',''].includes(s)) return 'pending';
  return 'other';
}
function first(...values:any[]){ return values.find(v=>String(v ?? '').trim()) ?? ''; }
function mapRow(row:any, source:string):FactRow{
  const date = String(first(row.date,row.route_date,row.completed_at,row.created_at,row.source_route_date)).slice(0,10);
  return {
    id: `${source}:${first(row.id,row.route_id,row.job_id,row.job_number,row.address,Math.random())}`,
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
    notes: first(row.notes,row.comments,row.latest_notes,row.description),
    pay_code: first(row.pay_code,row.billing_code,row.code),
    pay_total: money(first(row.pay_total,row.pay,row.value,row.amount)),
    source,
  };
}
function flattenSnapshot(record:any, source:string):FactRow[]{
  const raw = record?.snapshot || record?.route_data || record?.jobs || [];
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.jobs) ? raw.jobs : []);
  const defaultDate = first(record.date, record.route_date, record.created_at).slice(0,10);
  return list.map((job:any)=>mapRow({ ...job, date:first(job.date, defaultDate), region:first(job.region,record.region) }, source));
}
function dedupe(rows:FactRow[]){
  const map=new Map<string,FactRow>();
  const priority:any={ routes:5, completed_jobs:4, not_done_reports:4, not_done_pool:3, daily_route_snapshots:2, archived_routes:1 };
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
function buildIssueCodes(row:FactRow, all:FactRow[], phrase:string){
  const codes:string[]=[];
  const hay = norm([row.reason,row.notes,row.status,row.type,row.address,row.job_id].join(' '));
  if(row.status_group==='completed'){
    if(!row.pay_code) codes.push('missing_billing');
    if(!Number(row.pay_total||0)) codes.push('zero_value');
    if(!row.photo_before) codes.push('missing_before');
    if(!row.photo_after) codes.push('missing_after');
  }
  if(row.status_group==='not_done'){
    if(!row.reason && !row.notes) codes.push('not_done_no_reason');
    if(Number(row.pay_total||0)>0) codes.push('not_done_with_value');
  }
  const dupes = all.filter(other => other !== row && norm(other.job_id || other.address) && norm(other.job_id || other.address) === norm(row.job_id || row.address) && other.date === row.date && String(other.tech_id||'') === String(row.tech_id||''));
  if(dupes.length) codes.push('duplicate_job');
  if(phrase && hay.includes(norm(phrase))) codes.push('problem_phrase');
  return [...new Set(codes)];
}
function scoreFromRow(row:FactRow){
  const checklist = {
    before_photo: Number(row.photo_before || 0) > 0,
    after_photo: Number(row.photo_after || 0) > 0,
    billing_code: row.status_group !== 'completed' || Boolean(row.pay_code),
    billing_value: row.status_group !== 'completed' || Number(row.pay_total || 0) > 0,
    reason_notes: row.status_group !== 'not_done' || Boolean(row.reason || row.notes),
    address_present: Boolean(row.address),
  };
  const values = Object.values(checklist);
  const score = Math.round((values.filter(Boolean).length / values.length) * 100);
  return { checklist, score, passed: score >= 84 };
}
function exportRework(rows:FactRow[], reworks:any[], reviews:any[], filename:string){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r=>({Date:r.date,Tech:r.tech_id,'Tech Name':r.tech_name,'Job ID':r.job_id,Status:r.status_group,Address:r.address,City:r.city,ZIP:r.zip,Reason:r.reason,Notes:r.notes,'Billing Code':r.pay_code,Value:r.pay_total,Before:r.photo_before,After:r.photo_after,Issues:(r.issue_codes||[]).map(c=>ISSUE_LABELS[c]||c).join(' | '),Source:r.source}))), 'Problem Jobs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reworks.map(r=>({ID:r.id,Job:r.original_job_id,Route:r.route_id,Assigned:r.assigned_to,Resolved:r.resolved?'YES':'NO',Reason:r.reason,Resolution:r.resolution_notes,Created:r.created_at,Source:r._local?'local':'supabase'}))), 'Reworks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reviews.map(r=>({ID:r.id,Job:r.job_id,Route:r.route_id,Score:r.score,Passed:r.passed?'YES':'NO',Comments:r.comments,Reviewed:r.reviewed_at}))), 'QA Reviews');
  XLSX.writeFile(wb, filename);
}

export default function DispatchReworkQA({ region, lang, readOnly=false, actorName='Supervisor' }:{ region:string; lang:string; readOnly?:boolean; actorName?:string }){
  const es=lang==='es';
  const [from,setFrom]=useState(daysAgo(14));
  const [to,setTo]=useState(todayIso());
  const [techQuery,setTechQuery]=useState('');
  const [phrase,setPhrase]=useState('');
  const [issueFilter,setIssueFilter]=useState('all');
  const [showResolved,setShowResolved]=useState(false);
  const [rows,setRows]=useState<FactRow[]>([]);
  const [reworks,setReworks]=useState<any[]>([]);
  const [reviews,setReviews]=useState<any[]>([]);
  const [techs,setTechs]=useState<any[]>([]);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState('');
  const [assignTo,setAssignTo]=useState('');
  const [manualReason,setManualReason]=useState('');
  const [resolution,setResolution]=useState('');

  const load = useCallback(async()=>{
    setLoading(true); setError(''); setWarnings([]);
    const [routes,completed,reports,pool,daily,archive,techResult,reworkResult,reviewResult] = await Promise.all([
      safe('routes', (()=>{ let q=sb.from('routes').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('completed_jobs', (()=>{ let q=sb.from('completed_jobs').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_reports', (()=>{ let q=sb.from('not_done_reports').select('*').gte('date',from).lte('date',to).limit(5000); if(region)q=q.eq('region',region); return q; })()),
      safe('not_done_pool', (()=>{ let q=sb.from('not_done_pool').select('*').limit(2500); if(region)q=q.eq('region',region); return q; })()),
      safe('daily_route_snapshots', (()=>{ let q=sb.from('daily_route_snapshots').select('date,region,snapshot').gte('date',from).lte('date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
      safe('archived_routes', (()=>{ let q=sb.from('archived_routes').select('route_date,region,snapshot').gte('route_date',from).lte('route_date',to).limit(500); if(region)q=q.eq('region',region); return q; })()),
      safe('technicians', (()=>{ let q=sb.from('technicians').select('id,name,region').limit(1000); if(region)q=q.eq('region',region); return q; })()),
      safe('reworks', sb.from('reworks').select('*').order('created_at',{ascending:false}).limit(1000)),
      safe('qa_reviews', sb.from('qa_reviews').select('*').order('reviewed_at',{ascending:false}).limit(1000)),
    ]);
    const base = dedupe([
      ...(routes.data||[]).map((r:any)=>mapRow(r,'routes')),
      ...(completed.data||[]).map((r:any)=>mapRow({...r,status:first(r.status,'done')},'completed_jobs')),
      ...(reports.data||[]).map((r:any)=>mapRow({...r,status:first(r.status,'not_done')},'not_done_reports')),
      ...(pool.data||[]).map((r:any)=>mapRow({...r,date:first(r.last_not_done_date,r.first_not_done_date),status:first(r.current_status,'not_done'),tech_id:first(r.latest_technician_id,r.source_technician_id),reason:first(r.latest_reason,r.original_reason),notes:r.latest_notes,type:r.work_type},'not_done_pool')),
      ...(daily.data||[]).flatMap((r:any)=>flattenSnapshot(r,'daily_route_snapshots')),
      ...(archive.data||[]).flatMap((r:any)=>flattenSnapshot(r,'archived_routes')),
    ].filter((r:FactRow)=>!r.date || (r.date>=from && r.date<=to)));
    const photos=await fetchPhotoCounts(base);
    const withPhotos = base.map(row=>{ const c=photos.byRoute.get(String(row.route_id||'')) || photos.byJob.get(String(row.job_id||'')) || {before:0,after:0}; return {...row, photo_before:c.before||0, photo_after:c.after||0}; });
    const withIssues = withPhotos.map(row=>({ ...row, issue_codes: buildIssueCodes(row, withPhotos, phrase) })).filter(r=>r.issue_codes.length>0 || ['not_done'].includes(r.status_group));
    const localReworks = getLocalReworks();
    setRows(withIssues); setTechs(techResult.data||[]); setReworks([...(reworkResult.data||[]), ...localReworks]); setReviews(reviewResult.data||[]);
    setWarnings([routes.warning,completed.warning,reports.warning,pool.warning,daily.warning,archive.warning,techResult.warning,reworkResult.warning,reviewResult.warning,...photos.warnings].filter(Boolean));
    setLoading(false);
  },[from,to,region,phrase]);
  useEffect(()=>{ load(); },[load]);

  const filtered = useMemo(()=>{
    const tq=norm(techQuery); const ph=norm(phrase);
    return rows.filter(row=>{
      const techHay=norm([row.tech_id,row.tech_name].join(' '));
      const hay=norm([row.job_id,row.address,row.city,row.zip,row.reason,row.notes,row.status,row.type,row.pay_code].join(' '));
      const issueOk=issueFilter==='all' || (row.issue_codes||[]).includes(issueFilter) || (issueFilter==='not_done' && row.status_group==='not_done') || (issueFilter==='completed' && row.status_group==='completed');
      return (!tq || techHay.includes(tq)) && (!ph || hay.includes(ph)) && issueOk;
    });
  },[rows,techQuery,phrase,issueFilter]);

  const openReworks = useMemo(()=>reworks.filter(r=>showResolved || r.resolved !== true),[reworks,showResolved]);
  const reviewByJob = useMemo(()=>{ const map=new Map<string,any[]>(); reviews.forEach(r=>{ const k=norm(r.job_id || r.route_id); if(!k)return; map.set(k,[...(map.get(k)||[]),r]); }); return map; },[reviews]);
  const reworkByJob = useMemo(()=>{ const map=new Map<string,any[]>(); reworks.forEach(r=>{ const k=norm(r.original_job_id || r.route_id); if(!k)return; map.set(k,[...(map.get(k)||[]),r]); }); return map; },[reworks]);
  const stats = useMemo(()=>{
    const critical = filtered.filter(r=>(r.issue_codes||[]).some(c=>['missing_before','missing_after','missing_billing','zero_value'].includes(c))).length;
    const valueRisk = filtered.reduce((sum,r)=>sum+Number(r.pay_total||0),0);
    return { problems: filtered.length, critical, open: reworks.filter(r=>r.resolved!==true).length, qaFailed: reviews.filter(r=>r.passed===false).length, valueRisk };
  },[filtered,reworks,reviews]);

  async function createQA(row:FactRow){
    if(readOnly)return; setBusy(`qa-${row.id}`); setError('');
    try{
      const calc=scoreFromRow(row);
      const payload:any={ job_id:String(row.job_id||''), score:calc.score, passed:calc.passed, comments:`${actorName}: ${row.issue_codes?.map(c=>ISSUE_LABELS[c]||c).join(', ') || 'QA review'}${manualReason?` — ${manualReason}`:''}`, checklist:calc.checklist };
      if(uuidish(row.route_id)) payload.route_id=row.route_id;
      const { error } = await sb.from('qa_reviews').insert(payload).select().single();
      if(error) throw error;
      await createAuditLog({ action:'qa_review_created', entity:'qa_reviews', entityId:row.route_id || row.job_id, metadata:{ region, actorName, job_id:row.job_id, score:calc.score, passed:calc.passed, issues:row.issue_codes, summary:`QA review for ${row.job_id} score ${calc.score}` } });
      setManualReason(''); await load();
    }catch(e:any){ setError(e?.message || String(e)); }
    finally{ setBusy(''); }
  }
  async function createReworkFor(row:FactRow){
    if(readOnly)return; setBusy(`rw-${row.id}`); setError('');
    const reasonText = `${row.issue_codes?.map(c=>ISSUE_LABELS[c]||c).join(', ') || 'Field problem'}${manualReason ? ` — ${manualReason}` : ''}. Job ${row.job_id || ''} ${row.address || ''}`.trim();
    const payload:any={ original_job_id:String(row.job_id || row.route_id || ''), reason:reasonText, assigned_to:String(assignTo || row.tech_id || '') || null };
    if(uuidish(row.route_id)) payload.route_id=row.route_id;
    try{
      const { error } = await sb.from('reworks').insert(payload).select().single();
      if(error) throw error;
      await createAuditLog({ action:'rework_created', entity:'reworks', entityId:row.route_id || row.job_id, metadata:{ region, actorName, job_id:row.job_id, assigned_to:payload.assigned_to, reason:reasonText, summary:`Rework created for ${row.job_id}` } });
    }catch(e:any){
      const local=[...getLocalReworks(), { id:`local-${Date.now()}`, ...payload, resolved:false, created_at:new Date().toISOString(), _local:true }];
      setLocalReworks(local);
      setWarnings(prev=>[...prev, `Rework saved locally because Supabase insert failed: ${e?.message || String(e)}`]);
    }finally{ setManualReason(''); setBusy(''); await load(); }
  }
  async function resolveItem(item:any){
    if(readOnly)return; setBusy(`resolve-${item.id}`); setError('');
    try{
      if(item._local){ const next=getLocalReworks().map((r:any)=>r.id===item.id?{...r,resolved:true,resolution_notes:resolution,resolved_at:new Date().toISOString()}:r); setLocalReworks(next); }
      else { const { error }=await sb.from('reworks').update({ resolved:true, resolved_at:new Date().toISOString(), resolution_notes:resolution }).eq('id', item.id); if(error) throw error; }
      await createAuditLog({ action:'rework_resolved', entity:'reworks', entityId:item.id, metadata:{ region, actorName, original_job_id:item.original_job_id, resolution, summary:`Rework resolved for ${item.original_job_id || item.id}` } });
      setResolution(''); await load();
    }catch(e:any){ setError(e?.message || String(e)); } finally{ setBusy(''); }
  }

  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <OpsError message={error}/>
    {warnings.length>0&&<div style={{background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:10,padding:'9px 11px',color:'#ffd86b',fontSize:11}}>⚠ {warnings.slice(0,4).join(' · ')}</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:8}}>
      {[{l:es?'Problemas':'Problems',v:stats.problems,c:OPS.blue},{l:es?'Críticos':'Critical',v:stats.critical,c:OPS.red},{l:es?'Reworks abiertos':'Open reworks',v:stats.open,c:OPS.yellow},{l:es?'QA fallidos':'Failed QA',v:stats.qaFailed,c:OPS.purple},{l:es?'Valor en riesgo':'At-risk value',v:`$${stats.valueRisk.toFixed(0)}`,c:OPS.green}].map(card=><OpsCard key={card.l} style={{borderColor:`${card.c}55`}}><div style={{fontSize:23,fontWeight:900,color:card.c}}>{card.v}</div><div style={{fontSize:10,color:OPS.dim}}>{card.l}</div></OpsCard>)}
    </div>
    <OpsCard>
      <div style={{display:'grid',gridTemplateColumns:'130px 130px minmax(150px,1fr) minmax(150px,1fr) 170px auto',gap:8,alignItems:'center'}} className="dispatch-filters">
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={fieldStyle}/>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={fieldStyle}/>
        <input value={techQuery} onChange={e=>setTechQuery(e.target.value)} placeholder={es?'Técnico nombre o #':'Tech name or #'} style={fieldStyle}/>
        <input value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder={es?'811, misil, customer ausente...':'811, missile, customer absent...'} style={fieldStyle}/>
        <select value={issueFilter} onChange={e=>setIssueFilter(e.target.value)} style={fieldStyle}>
          <option value="all">{es?'Todos los problemas':'All issues'}</option>
          <option value="missing_before">Missing BEFORE</option><option value="missing_after">Missing AFTER</option><option value="missing_billing">Missing billing</option><option value="zero_value">$0 value</option><option value="not_done">Not Done</option><option value="not_done_no_reason">Not Done no reason</option><option value="not_done_with_value">Not Done with value</option><option value="duplicate_job">Duplicate</option><option value="problem_phrase">Phrase match</option>
        </select>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><OpsButton onClick={load} tone="dim">↻</OpsButton><OpsButton onClick={()=>exportRework(filtered,openReworks,reviews,`rework_qa_${region}_${from}_${to}.xlsx`)} tone="green">Export</OpsButton></div>
      </div>
      <div style={{marginTop:8,display:'grid',gridTemplateColumns:'minmax(160px,1fr) 190px',gap:8}} className="dispatch-filters">
        <input value={manualReason} onChange={e=>setManualReason(e.target.value)} placeholder={es?'Nota para QA/Rework':'QA/Rework note'} style={fieldStyle}/>
        <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} style={fieldStyle}><option value="">{es?'Asignar al técnico original':'Assign original tech'}</option>{techs.map(t=><option key={t.id} value={t.id}>{t.name || 'Tech'} · #{t.id}</option>)}</select>
      </div>
    </OpsCard>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.35fr) minmax(280px,.65fr)',gap:12,alignItems:'start'}} className="dispatch-simple-grid">
      <section style={{display:'flex',flexDirection:'column',gap:8}}>
        <div style={{fontWeight:900,color:OPS.text}}>🧪 {es?'Cola de QA / problemas detectados':'QA queue / detected problems'} {loading&&<span style={{fontSize:11,color:OPS.dim}}>…</span>}</div>
        {!filtered.length?<OpsEmpty>{es?'No hay problemas con estos filtros.':'No issues with these filters.'}</OpsEmpty>:filtered.slice(0,250).map(row=>{
          const jobReviews=reviewByJob.get(norm(row.job_id||row.route_id))||[]; const jobReworks=reworkByJob.get(norm(row.job_id||row.route_id))||[];
          return <OpsCard key={row.id} style={{borderColor:(row.issue_codes||[]).some(c=>['missing_before','missing_after','missing_billing','zero_value'].includes(c))?'#ff334866':OPS.border}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
              <div><div style={{fontWeight:900,color:OPS.text,fontSize:14}}>#{row.job_id || 'NO JOB'} · Tech {row.tech_id || '—'} {row.tech_name?`· ${row.tech_name}`:''}</div><div style={{fontSize:11,color:OPS.dim}}>{row.date || 'no date'} · {row.status_group} · {row.source}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontWeight:900,color:OPS.green}}>${Number(row.pay_total||0).toFixed(0)}</div><div style={{fontSize:10,color:OPS.dim}}>B{row.photo_before||0} / A{row.photo_after||0}</div></div>
            </div>
            <div style={{marginTop:8,fontSize:12,color:OPS.text}}>{row.address || 'No address'} {row.city?`· ${row.city}`:''} {row.zip?`· ${row.zip}`:''}</div>
            {(row.reason || row.notes)&&<div style={{marginTop:6,fontSize:11,color:OPS.dim}}>{row.reason || row.notes}</div>}
            <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:8}}>{(row.issue_codes||[]).map(code=><span key={code} style={{fontSize:10,fontWeight:900,padding:'4px 7px',borderRadius:999,background:code.includes('missing')||code==='zero_value'?'#ff334822':'#ffbe0022',color:code.includes('missing')||code==='zero_value'?OPS.red:OPS.yellow}}>{ISSUE_LABELS[code]||code}</span>)}{jobReviews.length>0&&<span style={{fontSize:10,fontWeight:900,padding:'4px 7px',borderRadius:999,background:'#9d5fff22',color:OPS.purple}}>QA {jobReviews[0].score}</span>}{jobReworks.length>0&&<span style={{fontSize:10,fontWeight:900,padding:'4px 7px',borderRadius:999,background:'#00b8f522',color:OPS.blue}}>Rework {jobReworks.filter(r=>r.resolved!==true).length} open</span>}</div>
            {!readOnly&&<div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:10}}><OpsButton onClick={()=>createQA(row)} disabled={busy===`qa-${row.id}`} tone="purple">🧪 {busy===`qa-${row.id}`?'…':es?'Crear QA':'Create QA'}</OpsButton><OpsButton onClick={()=>createReworkFor(row)} disabled={busy===`rw-${row.id}`} tone="yellow">🛠 {busy===`rw-${row.id}`?'…':es?'Crear Rework':'Create Rework'}</OpsButton></div>}
          </OpsCard>})}
      </section>
      <aside style={{display:'flex',flexDirection:'column',gap:8}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><div style={{fontWeight:900,color:OPS.text}}>🛠 {es?'Reworks':'Reworks'}</div><label style={{fontSize:10,color:OPS.dim,display:'flex',alignItems:'center',gap:5}}><input type="checkbox" checked={showResolved} onChange={e=>setShowResolved(e.target.checked)}/>{es?'Resueltos':'Resolved'}</label></div>
        <input value={resolution} onChange={e=>setResolution(e.target.value)} placeholder={es?'Nota de resolución':'Resolution note'} style={fieldStyle}/>
        {!openReworks.length?<OpsEmpty>{es?'No hay reworks abiertos.':'No open reworks.'}</OpsEmpty>:openReworks.slice(0,120).map(item=><OpsCard key={item.id} style={{padding:11,borderColor:item.resolved?'#00dc8544':'#ffbe0066'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}><div style={{fontWeight:900,color:OPS.text,fontSize:12}}>#{item.original_job_id || item.route_id || item.id}</div><div style={{fontSize:10,color:item.resolved?OPS.green:OPS.yellow}}>{item.resolved?'Resolved':'Open'}</div></div>
          <div style={{fontSize:10,color:OPS.dim,marginTop:3}}>Assigned: {item.assigned_to || '—'} · {String(item.created_at||'').slice(0,10)} {item._local?'· local':''}</div>
          <div style={{fontSize:11,color:OPS.text,marginTop:7}}>{item.reason}</div>
          {item.resolution_notes&&<div style={{fontSize:10,color:OPS.green,marginTop:6}}>✓ {item.resolution_notes}</div>}
          {!readOnly&&!item.resolved&&<div style={{marginTop:8}}><OpsButton onClick={()=>resolveItem(item)} disabled={busy===`resolve-${item.id}`} tone="green">✓ {es?'Resolver':'Resolve'}</OpsButton></div>}
        </OpsCard>)}
      </aside>
    </div>
  </div>;
}
