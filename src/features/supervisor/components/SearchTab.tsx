// @ts-nocheck
// GUAJIRO V25.12 — Search Tab
// - Clickable job cards (whole card opens the detail panel)
// - Photo download button per card + in the detail panel
// - Photo filenames follow: Tech{ID}_Job{ID}_{YYYY-MM-DD}_{N}.jpg
import { useEffect, useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { APP_FIRST_DATE } from '../../../config/constants';
import { buildHash } from '../../../legacy/routing';

function normalize(v:any){return String(v||'').toLowerCase().trim();}
function normalizeStatus(v:any){
  const s=normalize(v);
  if(['done','completed','resolved','complete'].includes(s))return 'done';
  if(['notdone','not_done','not completed','not_completed','cancelled','canceled','open'].includes(s))return 'notdone';
  if(['scheduled','assigned','in_progress','arrived','en_route'].includes(s))return 'pending';
  return s||'pending';
}
function matches(job:any, q:string){
  if(!q) return true;
  const hay=[job.job_id,job.address,job.city,job.tech_id,job.latest_technician_id,job.zip,job.zip_code,job.pay_code,job.reason,job.latest_reason,job.original_reason,job.job_note,job.notes,job.latest_notes,job.phone,job.type,job.work_type,job.status,job.current_status,job._src]
    .map(normalize).join(' | ');
  return hay.includes(q);
}
function jobDate(job:any){return String(job._sortDate||job.date||job.last_not_done_date||job.first_not_done_date||job.created_at||job.updated_at||'').slice(0,10);}
function statusColor(s:string){return normalizeStatus(s)==='done' ? '#00dc85' : normalizeStatus(s)==='notdone' ? '#ff3348' : '#ffbe00';}
function mapPoolRow(row:any){return {...row,status:row.current_status||'open',date:row.last_not_done_date||row.first_not_done_date,tech_id:row.latest_technician_id||row.source_technician_id,type:row.work_type,reason:row.latest_reason||row.original_reason,notes:row.latest_notes,_src:'not_done_pool',_sortDate:row.last_not_done_date||row.first_not_done_date||row.updated_at};}
function mapReportRow(row:any){return {...row,status:row.status||'notdone',zip:row.zip||row.zone,type:row.type||row.work_type,_src:'not_done_reports',_sortDate:row.date||row.created_at};}

// V25.12 — Download all photos for a job with normalized filenames
async function downloadJobPhotos(photos:any[], job:any, es:boolean){
  if(!photos?.length){ alert(es?'No hay fotos para descargar.':'No photos to download.'); return; }
  const tech = String(job.tech_id||job.latest_technician_id||'unknown').trim();
  const jobId = String(job.job_id||'unknown').trim();
  const date = jobDate(job) || new Date().toISOString().slice(0,10);
  let downloaded = 0;
  let failed = 0;
  for(let i=0; i<photos.length; i++){
    const p = photos[i];
    const url = p.photo_url || p.thumb_url;
    if(!url){ failed++; continue; }
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      // pick extension from content-type or URL
      const ct = blob.type || '';
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('heic') ? 'heic' : 'jpg';
      const filename = `Tech${tech}_Job${jobId}_${date}_${String(i+1).padStart(2,'0')}.${ext}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      downloaded++;
      // small delay so the browser doesn't queue-block downloads
      await new Promise(r=>setTimeout(r, 250));
    }catch(err){
      console.warn('[Photo download] failed for', url, err);
      failed++;
    }
  }
  if(failed>0) alert(es?`Descargadas: ${downloaded}. Fallidas: ${failed}.`:`Downloaded: ${downloaded}. Failed: ${failed}.`);
}

// V25.12 — Fetch photos for a specific job (used when downloading directly from card)
async function fetchPhotosForJob(job:any){
  const jobId = String(job.job_id||'').trim();
  if(!jobId) return [];
  const photoMap = new Map<string,any>();
  try{
    const byJobId = await sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at').eq('job_id',jobId).order('created_at',{ascending:false}).limit(100);
    (byJobId.data||[]).forEach((p:any)=>photoMap.set(String(p.id||p.photo_url),p));
    if(job.id){
      const byRoute = await sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at').eq('route_id',job.id).order('created_at',{ascending:false}).limit(100);
      (byRoute.data||[]).forEach((p:any)=>photoMap.set(String(p.id||p.photo_url),p));
    }
  }catch(err){ console.warn('[Photo fetch] failed', err); }
  return [...photoMap.values()];
}

function SearchTab({lang, region, initialQuery}:{lang:string, region?:string, initialQuery?:string}){
  const es=lang==='es';
  const[query,setQuery]=useState(initialQuery||'');
  const[dateFrom,setDateFrom]=useState(APP_FIRST_DATE);
  const[dateTo,setDateTo]=useState(new Date().toISOString().split('T')[0]);
  const[filterStatus,setFilterStatus]=useState('all');
  const[results,setResults]=useState<any[]>([]);
  const[loading,setLoading]=useState(false);
  const[searched,setSearched]=useState(false);
  const[warning,setWarning]=useState('');
  const[selected,setSelected]=useState<any|null>(null);
  const[details,setDetails]=useState<any>({photos:[],reports:[],events:[]});
  const[detailLoading,setDetailLoading]=useState(false);
  const[copied,setCopied]=useState(false);
  const[photoCounts,setPhotoCounts]=useState<Record<string,number>>({});
  const[downloadingCard,setDownloadingCard]=useState<string>('');

  useEffect(()=>{
    if(typeof initialQuery==='string') setQuery(initialQuery);
  },[initialQuery]);

  const todayIso=new Date().toISOString().split('T')[0];
  const canOpenLiveRoute=(job:any)=>Boolean(region&&job?.tech_id&&job?.job_id&&job?._src==='routes'&&String(job.date||'')===todayIso);

  const openRouteJob=(job:any)=>{
    if(!canOpenLiveRoute(job))return;
    const hash=buildHash('supervisor',region,'route',encodeURIComponent(`${job.tech_id}~${job.job_id}`)).replace(/%257E/g,'%7E');
    window.history.replaceState({gfsInAppNavigation:true},'',hash);
    window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL:window.location.href,newURL:`${window.location.origin}${window.location.pathname}${hash}`}));
  };

  const historyUrl=(job:any)=>{
    const r=region||job.region||'miami';
    const id=encodeURIComponent(String(job.job_id||''));
    return `${window.location.origin}${window.location.pathname}${buildHash('supervisor',r,'search',id)}`;
  };
  const copyHistoryLink=async(job:any)=>{try{await navigator.clipboard.writeText(historyUrl(job));setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{}};

  const safe=async(label:string, queryPromise:any)=>{
    try{
      const res=await queryPromise;
      if(res?.error){console.warn(`[History Search] ${label}`,res.error);return {data:[],warning:`${label}: ${res.error.message||res.error}`};}
      return {data:res?.data||[],warning:''};
    }catch(error:any){console.warn(`[History Search] ${label}`,error);return {data:[],warning:`${label}: ${error?.message||String(error)}`};}
  };

  const loadHistory=async(opts:{q?:string;from?:string;to?:string;status?:string;autoOpen?:boolean}={})=>{
    setLoading(true); setSearched(true); setWarning('');
    const q=normalize(opts.q ?? query);
    const from=opts.from||dateFrom;
    const to=opts.to||dateTo;
    const status=opts.status||filterStatus;
    try{
      const reportQuery=(()=>{let qq=sb.from('not_done_reports').select('*').gte('date',from).lte('date',to).order('created_at',{ascending:false}).limit(500); if(region)qq=qq.eq('region',region); return qq;})();
      const poolQuery=(()=>{let qq=sb.from('not_done_pool').select('*').order('updated_at',{ascending:false}).limit(1000); if(region)qq=qq.eq('region',region); return qq;})();
      const [routesRes, completedRes, cancelledRes, archiveRes, poolRes, reportsRes] = await Promise.all([
        safe('routes', sb.from('routes').select('*').gte('date',from).lte('date',to).order('date',{ascending:false}).limit(500)),
        safe('completed_jobs', sb.from('completed_jobs').select('*').gte('date',from).lte('date',to).order('date',{ascending:false}).limit(500)),
        safe('cancelled_jobs', sb.from('cancelled_jobs').select('*').gte('source_route_date',from).lte('source_route_date',to).order('cancelled_at',{ascending:false}).limit(500)),
        safe('daily_route_snapshots', sb.from('daily_route_snapshots').select('date,region,snapshot').gte('date',from).lte('date',to).order('date',{ascending:false}).limit(120)),
        safe('not_done_pool', poolQuery),
        safe('not_done_reports', reportQuery),
      ]);

      const jobs:any[]=[];
      (routesRes.data||[]).forEach((r:any)=>jobs.push({...r,_src:'routes',_sortDate:r.date}));
      (completedRes.data||[]).forEach((r:any)=>jobs.push({...r,status:r.status||'done',_src:'completed_jobs',_sortDate:r.date}));
      (cancelledRes.data||[]).forEach((r:any)=>jobs.push({...r,date:r.source_route_date,status:r.status||'cancelled',_src:'cancelled_jobs',_sortDate:r.source_route_date}));
      (poolRes.data||[]).forEach((r:any)=>jobs.push(mapPoolRow(r)));
      (reportsRes.data||[]).forEach((r:any)=>jobs.push(mapReportRow(r)));
      (archiveRes.data||[]).forEach((snap:any)=>{
        (snap.snapshot||[]).forEach((job:any,idx:number)=>jobs.push({
          ...job,
          id: job.id || `${snap.date}-${job.job_id||idx}-${job.tech_id||'tech'}`,
          region: job.region || snap.region,
          _src:'snapshot',
          _sortDate: job.date || snap.date,
          _snapshotDate: snap.date,
        }));
      });

      const warnings=[routesRes.warning,completedRes.warning,cancelledRes.warning,archiveRes.warning,poolRes.warning,reportsRes.warning].filter(Boolean);
      setWarning(warnings.length?warnings.slice(0,2).join(' · '):'');

      const dedupe=new Map<string, any>();
      jobs.forEach((job:any,index:number)=>{
        const key=[job._src, job.id||'', job.job_id||'', job.address||'', job.tech_id||job.latest_technician_id||'', jobDate(job)||'', index].join('|');
        if(!dedupe.has(key)) dedupe.set(key, job);
      });

      const filtered=[...dedupe.values()]
        .filter((job:any)=>!region || !job.region || job.region===region)
        .filter((job:any)=>{const d=jobDate(job);return !d || (d>=from && d<=to);})
        .filter((job:any)=> status==='all' ? true : normalizeStatus(job.status||job.current_status)===normalizeStatus(status))
        .filter((job:any)=> matches(job,q))
        .sort((a:any,b:any)=> String(jobDate(b)||'').localeCompare(String(jobDate(a)||'')) || String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')))
        .slice(0,700);

      setResults(filtered);

      // V25.12 — Fetch photo counts for each unique job_id so cards can show a photo button
      const uniqueJobIds = [...new Set(filtered.map((j:any)=>String(j.job_id||'')).filter(Boolean))];
      if(uniqueJobIds.length){
        try{
          const { data: countData } = await sb.from('job_photos').select('job_id').in('job_id', uniqueJobIds.slice(0,200));
          const counts:Record<string,number> = {};
          (countData||[]).forEach((row:any)=>{ const j=String(row.job_id||''); counts[j]=(counts[j]||0)+1; });
          setPhotoCounts(counts);
        }catch{}
      }

      if(opts.autoOpen){
        setSelected(filtered[0]||null);
        setTimeout(()=>document.getElementById('history-detail-panel')?.scrollIntoView({behavior:'smooth',block:'start'}),180);
      }
    }catch(err:any){
      console.error('History search failed', err);
      setWarning(err?.message||'History search failed');
      setResults([]);
    }finally{setLoading(false);}
  };

  useEffect(()=>{
    const q=String(initialQuery||'').trim();
    if(!q)return;
    setFilterStatus('all');
    setDateFrom(APP_FIRST_DATE);
    setDateTo(new Date().toISOString().split('T')[0]);
    setQuery(q);
    window.setTimeout(()=>loadHistory({q,from:APP_FIRST_DATE,to:new Date().toISOString().split('T')[0],status:'all',autoOpen:true}),0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initialQuery,region]);

  useEffect(()=>{
    const job=selected;
    if(!job?.job_id){setDetails({photos:[],reports:[],events:[]});return;}
    let cancelled=false;
    const run=async()=>{
      setDetailLoading(true);
      const jobId=String(job.job_id);
      const photoByJob=safe('job_photos job_id', sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at').eq('job_id',jobId).order('created_at',{ascending:false}).limit(100));
      const photoByRoute=job.id?safe('job_photos route_id', sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at').eq('route_id',job.id).order('created_at',{ascending:false}).limit(100)):Promise.resolve({data:[],warning:''});
      const reportsQuery=(()=>{let qq=sb.from('not_done_reports').select('*').eq('job_id',jobId).order('created_at',{ascending:false}).limit(100); if(region)qq=qq.eq('region',region); return qq;})();
      const eventsQuery=(()=>{let qq=sb.from('not_done_pool_events').select('*').eq('job_id',jobId).order('created_at',{ascending:false}).limit(100); if(region)qq=qq.eq('region',region); return qq;})();
      const [p1,p2,r,e]=await Promise.all([photoByJob,photoByRoute,safe('not_done_reports detail',reportsQuery),safe('not_done_pool_events detail',eventsQuery)]);
      if(cancelled)return;
      const photoMap=new Map<string,any>();
      [...(p1.data||[]),...(p2.data||[])].forEach((p:any)=>photoMap.set(String(p.id||p.photo_url),p));
      setDetails({photos:[...photoMap.values()],reports:r.data||[],events:e.data||[]});
      setDetailLoading(false);
    };
    run().catch(()=>setDetailLoading(false));
    return()=>{cancelled=true;};
  },[selected?.job_id,selected?.id,region]);

  // V25.12 — Download photos directly from a card (fetches them if not already loaded)
  const downloadFromCard = async (job:any, e:any) => {
    e.stopPropagation();
    const key = `${job._src}-${job.id||''}-${job.job_id||''}`;
    setDownloadingCard(key);
    try{
      const photos = await fetchPhotosForJob(job);
      if(!photos.length){ alert(es?'No hay fotos guardadas para este trabajo.':'No photos saved for this job.'); return; }
      await downloadJobPhotos(photos, job, es);
    }finally{
      setDownloadingCard('');
    }
  };

  const doneN=results.filter((r:any)=>normalizeStatus(r.status||r.current_status)==='done').length;
  const ndN=results.filter((r:any)=>normalizeStatus(r.status||r.current_status)==='notdone').length;
  const pendingN=results.filter((r:any)=>normalizeStatus(r.status||r.current_status)==='pending').length;
  const earned=results.filter((r:any)=>normalizeStatus(r.status)==='done').reduce((s:number,r:any)=>s+(Number(r.pay_total)||0),0);
  const sourceN=useMemo(()=>results.reduce((acc:any,r:any)=>{acc[r._src]=(acc[r._src]||0)+1;return acc;},{}),[results]);

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'16px'}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:900,color:C.text,marginBottom:10}}>🔎 {es?'Buscador inteligente de historial':'Smart history search'}</div>
        <div style={{fontSize:12,color:C.dim,marginBottom:12}}>{es?'Busca rutas activas, completadas, canceladas, snapshots, Not Done Pool y reportes históricos.':'Searches active routes, completed jobs, cancelled jobs, snapshots, Not Done Pool and historical reports.'}</div>
        <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadHistory()}
          placeholder={es?'Job #, address, city, tech, pay code, phone...':'Job #, address, city, tech, pay code, phone...'}
          style={{width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:10,padding:'12px 14px',color:C.text,fontSize:14,outline:'none',marginBottom:10}}/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>
          <div><label style={{fontSize:11,color:C.dim,display:'block',marginBottom:4}}>{es?'Desde':'From'}</label><input type='date' value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}/></div>
          <div><label style={{fontSize:11,color:C.dim,display:'block',marginBottom:4}}>{es?'Hasta':'To'}</label><input type='date' value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}/></div>
          <div><label style={{fontSize:11,color:C.dim,display:'block',marginBottom:4}}>{es?'Estado':'Status'}</label>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}>
              <option value='all'>{es?'Todos':'All'}</option>
              <option value='done'>{es?'Completados':'Done'}</option>
              <option value='notdone'>{es?'No completados / abiertos':'Not done / open'}</option>
              <option value='pending'>{es?'Pendientes / asignados':'Pending / assigned'}</option>
              <option value='cancelled'>{es?'Cancelados':'Cancelled'}</option>
            </select>
          </div>
          <div style={{display:'flex',alignItems:'end'}}>
            <button onClick={()=>loadHistory()} disabled={loading} style={{width:'100%',background:'linear-gradient(135deg,#0040c0,#00b8f5)',border:'none',borderRadius:10,padding:'11px 14px',color:'#fff',fontWeight:800,cursor:'pointer'}}>{loading?(es?'Buscando...':'Searching...'):(es?'Buscar ahora':'Search now')}</button>
          </div>
        </div>
        {warning&&<div style={{marginTop:10,background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:9,padding:'8px 10px',color:'#ffcf55',fontSize:11}}>⚠ {warning}</div>}
      </div>

      {selected&&<div id="history-detail-panel" style={{background:'#07162c',border:'2px solid #00b8f566',borderRadius:16,padding:16,boxShadow:'0 0 0 4px rgba(0,184,245,.08)'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:'#fff'}}>📌 {es?'Detalle del trabajo':'Job detail'} #{selected.job_id||'—'}</div>
            <div style={{fontSize:12,color:C.dim,marginTop:2}}>{es?'Abierto desde historial de base de datos. No depende de tener ruta importada.':'Opened from database history. It does not require an imported route.'}</div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>copyHistoryLink(selected)} style={{background:'#9d5fff22',border:'1px solid #9d5fff',borderRadius:8,padding:'8px 10px',color:'#c39dff',fontSize:11,fontWeight:900,cursor:'pointer'}}>{copied?(es?'Copiado':'Copied'):'🔗 Link'}</button>
            {canOpenLiveRoute(selected)&&<button onClick={()=>openRouteJob(selected)} style={{background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'8px 10px',color:'#00b8f5',fontSize:11,fontWeight:900,cursor:'pointer'}}>{es?'Abrir ruta activa':'Open live route'}</button>}
            <button onClick={()=>setSelected(null)} style={{background:'#162e58',border:'1px solid #27436f',borderRadius:8,padding:'8px 10px',color:'#c8d8f4',fontSize:11,fontWeight:900,cursor:'pointer'}}>✕</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,marginTop:14}}>
          {[
            ['Status',selected.status||selected.current_status||'pending',statusColor(selected.status||selected.current_status)],
            ['Source',selected._src||'database','#9d5fff'],
            ['Date',jobDate(selected)||'—','#00b8f5'],
            ['Tech',selected.tech_id||selected.latest_technician_id||'—','#00dc85'],
          ].map(([l,v,c]:any)=><div key={l} style={{background:'#0b1830',border:`1px solid ${c}44`,borderRadius:10,padding:'9px 10px'}}><div style={{fontSize:10,color:C.dim,textTransform:'uppercase'}}>{l}</div><div style={{fontSize:15,fontWeight:900,color:c}}>{v}</div></div>)}
        </div>
        <div style={{marginTop:12,display:'grid',gridTemplateColumns:'minmax(0,1.3fr) minmax(220px,.7fr)',gap:12}} className="history-detail-grid">
          <div style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:12}}>
            <div style={{fontSize:13,fontWeight:900,color:'#fff',marginBottom:6}}>{selected.address||'—'}{selected.city?`, ${selected.city}`:''}{selected.zip?` ${selected.zip}`:''}</div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:C.dim}}>
              {selected.phone&&<span>📞 {selected.phone}</span>}{(selected.type||selected.work_type)&&<span>🧰 {selected.type||selected.work_type}</span>}{selected.pay_code&&<span>💳 {selected.pay_code}</span>}{Number(selected.pay_total||0)>0&&<span style={{color:'#00dc85'}}>💵 ${Number(selected.pay_total).toFixed(0)}</span>}
            </div>
            {(selected.reason||selected.latest_reason||selected.original_reason||selected.job_note||selected.notes||selected.latest_notes)&&<div style={{marginTop:10,background:'#07162c',border:'1px solid #162e58',borderRadius:10,padding:'9px 10px',fontSize:12,color:'#dbe8ff'}}>{selected.reason||selected.latest_reason||selected.original_reason||selected.job_note||selected.notes||selected.latest_notes}</div>}
          </div>
          <div style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:6,flexWrap:'wrap'}}>
              <div style={{fontSize:12,fontWeight:900,color:'#fff'}}>📷 {es?'Fotos':'Photos'} {detailLoading?'…':`(${details.photos.length})`}</div>
              {details.photos.length>0 && <button onClick={()=>downloadJobPhotos(details.photos, selected, es)} style={{background:'#00dc8522',border:'1px solid #00dc85',borderRadius:8,padding:'6px 10px',color:'#00dc85',fontSize:10,fontWeight:900,cursor:'pointer'}}>📥 {es?'Descargar todas':'Download all'}</button>}
            </div>
            {details.photos.length===0?<div style={{fontSize:11,color:C.dim}}>{es?'No hay fotos encontradas para este Job ID.':'No photos found for this Job ID.'}</div>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(74px,1fr))',gap:7}}>{details.photos.map((p:any)=><a key={p.id||p.photo_url} href={p.photo_url} target="_blank" rel="noreferrer" title={p.note||p.photo_type||'photo'} style={{display:'block',border:'1px solid #27436f',borderRadius:8,overflow:'hidden',background:'#07162c'}}><img src={p.thumb_url||p.photo_url} style={{width:'100%',height:70,objectFit:'cover',display:'block'}}/></a>)}</div>}
          </div>
        </div>
        {(details.reports.length>0||details.events.length>0)&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10,marginTop:12}}>
          {details.reports.length>0&&<div style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:12}}><div style={{fontSize:12,fontWeight:900,color:'#fff',marginBottom:8}}>🧾 Not Done Reports</div>{details.reports.slice(0,6).map((r:any)=><div key={r.id||r.created_at} style={{borderTop:'1px solid #162e58',padding:'7px 0',fontSize:11,color:'#dbe8ff'}}><b>{r.date||String(r.created_at||'').slice(0,10)}</b> · Tech #{r.tech_id||'—'} · {r.reason||r.status||'not done'}{(r.notes||r.job_note)&&<div style={{color:C.dim,marginTop:3}}>{r.notes||r.job_note}</div>}</div>)}</div>}
          {details.events.length>0&&<div style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:12}}><div style={{fontSize:12,fontWeight:900,color:'#fff',marginBottom:8}}>🕒 Pool Events</div>{details.events.slice(0,6).map((e:any)=><div key={e.id||e.created_at} style={{borderTop:'1px solid #162e58',padding:'7px 0',fontSize:11,color:'#dbe8ff'}}><b>{String(e.event_type||'event').replace(/_/g,' ')}</b> · {e.event_date||String(e.created_at||'').slice(0,10)}{e.reason&&<div style={{color:C.dim,marginTop:3}}>{e.reason}</div>}</div>)}</div>}
        </div>}
        <style>{`@media(max-width:760px){.history-detail-grid{grid-template-columns:1fr!important}}`}</style>
      </div>}

      {searched && (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}>
            {[{l:es?'Done':'Done',v:doneN,c:'#00dc85'},{l:es?'Not done/open':'Not done/open',v:ndN,c:'#ff3348'},{l:es?'Pending':'Pending',v:pendingN,c:'#ffbe00'},{l:es?'Earned':'Earned',v:`$${earned.toLocaleString()}`,c:'#00b8f5'}].map((s)=> <div key={s.l} style={{background:C.card,border:`1px solid ${s.c}44`,borderRadius:10,padding:'10px',textAlign:'center'}}><div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:10,color:C.dim}}>{s.l}</div></div>)}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',fontSize:12,color:C.dim}}><span>{results.length} {es?'resultados':'results'}</span><span>{Object.entries(sourceN).map(([k,v])=>`${k}: ${v}`).join(' · ')}</span></div>
          {results.length===0 ? <div style={{background:C.card,border:'1px solid #162e58',borderRadius:12,padding:24,textAlign:'center',color:C.dim}}>{es?'Sin resultados. Amplía el rango de fechas o usa menos filtros.':'No results. Widen the date range or remove filters.'}</div> : results.map((job:any)=>{
            const c=statusColor(job.status||job.current_status);
            const isSelected=selected&&String(selected._src)===String(job._src)&&String(selected.id||'')===String(job.id||'')&&String(selected.job_id||'')===String(job.job_id||'');
            const jobKey = `${job._src}-${job.id||''}-${job.job_id||''}`;
            const photoCount = photoCounts[String(job.job_id||'')] || 0;
            const downloading = downloadingCard === jobKey;
            return <div
              key={`${job._src}-${job.id}-${job.job_id}-${jobDate(job)}`}
              onClick={()=>{ setSelected(job); setTimeout(()=>document.getElementById('history-detail-panel')?.scrollIntoView({behavior:'smooth',block:'start'}),120); }}
              style={{
                background:C.card,
                border:`1px solid ${isSelected?'#00b8f5':c+'33'}`,
                borderRadius:12,
                padding:'12px 14px',
                cursor:'pointer',
                transition:'border-color .12s, box-shadow .12s',
                boxShadow: isSelected ? '0 0 0 2px rgba(0,184,245,.15)' : 'none',
              }}
              onMouseEnter={(e:any)=>{ if(!isSelected) e.currentTarget.style.borderColor = '#00b8f5aa'; }}
              onMouseLeave={(e:any)=>{ if(!isSelected) e.currentTarget.style.borderColor = c+'33'; }}
            >
              <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                    <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:'#00b8f5'}}>#{job.job_id||'—'}</span>
                    <span style={{background:`${c}22`,border:`1px solid ${c}55`,borderRadius:20,padding:'2px 8px',fontSize:10,fontWeight:700,color:c}}>{String(job.status||job.current_status||'pending').toUpperCase()}</span>
                    <span style={{background:'#162e58',borderRadius:20,padding:'2px 8px',fontSize:10,color:'#c8d8f4'}}>{job._src}</span>
                    {(job.tech_id||job.latest_technician_id)&&<span style={{fontSize:11,color:C.dim}}>👷 {job.tech_id||job.latest_technician_id}</span>}
                    {job.pay_code&&<span style={{fontSize:11,color:'#00dc85'}}>💳 {job.pay_code}</span>}
                    {photoCount>0 && <span style={{background:'#00dc8518',border:'1px solid #00dc8555',borderRadius:20,padding:'2px 8px',fontSize:10,color:'#00dc85',fontWeight:700}}>📷 {photoCount}</span>}
                  </div>
                  <div style={{fontSize:13,color:'#fff',fontWeight:800}}>{job.address||'—'}{job.city?`, ${job.city}`:''}</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:4}}>
                    {jobDate(job)&&<span style={{fontSize:11,color:C.dim}}>📅 {jobDate(job)}</span>}
                    {job.phone&&<span style={{fontSize:11,color:C.dim}}>📞 {job.phone}</span>}
                    {(job.type||job.work_type)&&<span style={{fontSize:11,color:C.dim}}>🧰 {job.type||job.work_type}</span>}
                    {job._snapshotDate&&<span style={{fontSize:11,color:'#9d5fff'}}>🗃️ {es?'Archivado':'Archived'} {job._snapshotDate}</span>}
                  </div>
                  {(job.reason||job.latest_reason||job.original_reason||job.job_note||job.notes||job.latest_notes) && <div style={{marginTop:8,fontSize:11,color:'#b7c6de',background:'#0e1e3a',borderRadius:8,padding:'6px 8px'}}>{job.reason||job.latest_reason||job.original_reason||job.job_note||job.notes||job.latest_notes}</div>}
                </div>
                <div style={{minWidth:120,textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:7}}>
                  {Number(job.pay_total||0)>0 && <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:'#00dc85'}}>${Number(job.pay_total).toFixed(0)}</div>}
                  <button onClick={(e)=>{ e.stopPropagation(); setSelected(job); setTimeout(()=>document.getElementById('history-detail-panel')?.scrollIntoView({behavior:'smooth',block:'start'}),120); }} style={{background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'7px 10px',color:'#00b8f5',fontSize:11,fontWeight:900,cursor:'pointer'}}>{es?'Ver detalle':'View details'}</button>
                  {photoCount>0 && <button
                    onClick={(e)=>downloadFromCard(job, e)}
                    disabled={downloading}
                    style={{background:'#00dc8522',border:'1px solid #00dc85',borderRadius:8,padding:'7px 10px',color:'#00dc85',fontSize:11,fontWeight:900,cursor:downloading?'wait':'pointer',opacity:downloading?0.6:1}}
                  >{downloading?(es?'Descargando…':'Downloading…'):`📥 ${es?'Fotos':'Photos'} (${photoCount})`}</button>}
                  {canOpenLiveRoute(job)
                    ? <button onClick={(e)=>{ e.stopPropagation(); openRouteJob(job); }} style={{background:'#00dc8522',border:'1px solid #00dc85',borderRadius:8,padding:'7px 10px',color:'#00dc85',fontSize:11,fontWeight:900,cursor:'pointer'}}>{es?'Ruta activa':'Live route'}</button>
                    : <div style={{background:'#9d5fff18',border:'1px solid #9d5fff44',borderRadius:8,padding:'7px 10px',color:'#c39dff',fontSize:10,fontWeight:900,display:'inline-block'}}>{es?'Histórico':'History'}</div>}
                </div>
              </div>
            </div>
          })}
        </>
      )}
    </div>
  );
}

export { SearchTab };
