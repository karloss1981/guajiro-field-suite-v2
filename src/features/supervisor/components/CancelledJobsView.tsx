// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { APP_FIRST_DATE } from '../../../config/constants';
import { MIAMI_DADE_ZIPS, BROWARD_ZIPS } from '../../../config/regions';
import { FL_ZIP_GEOJSON_URL, GEO_CACHE_KEY, NOMINATIM_URL } from '../../../config/constants';
import { getTechName } from '../../../legacy/data';
import { buildHash, parseHash } from '../../../legacy/routing';
import { downloadPhotosZip } from '../../../services/photos.service';
import { generateJobExcel, generateJobPDF, generateEarningsExcel } from '../../../legacy/reporting';
import { Lightbox } from '../../technician/components/Lightbox';

/* ── CANCELLED JOBS VIEW ── */
function CancelledJobsView({region,lang,onBack}:{region:string,lang:string,onBack:()=>void}){
  const es=lang==='es';
  const[jobs,setJobs]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[search,setSearch]=useState('');
  const[filterStatus,setFilterStatus]=useState('cancelled');
  const[filterReason,setFilterReason]=useState('');
  const[dateFrom,setDateFrom]=useState(APP_FIRST_DATE);
  const[dateTo,setDateTo]=useState(new Date().toLocaleDateString('en-CA'));

  const PAGE_SIZE_CANCELLED = 50;
  const [cancelledPage, setCancelledPage] = useState(0);
  const [cancelledTotal, setCancelledTotal] = useState(0);

  const load=useCallback(async()=>{
    setLoading(true);
    const from = cancelledPage * PAGE_SIZE_CANCELLED;
    const to = from + PAGE_SIZE_CANCELLED - 1;
    let q=sb.from('cancelled_jobs').select('id,region,job_id,address,city,phone,type,reason,notes,tech_id,source_route_date,zone,status,cancelled_at',{count:'exact'}).eq('region',region)
      .gte('source_route_date',dateFrom).lte('source_route_date',dateTo)
      .order('cancelled_at',{ascending:false}).range(from, to);
    if(filterStatus!=='all') q=q.eq('status',filterStatus);
    const{data, count}=await q;
    setJobs(data||[]);
    setCancelledTotal(count||0);
    setLoading(false);
  },[region,dateFrom,dateTo,filterStatus,cancelledPage]);

  useEffect(()=>{load();},[load]);

  const handleResolve=async(id:string)=>{
    await sb.from('cancelled_jobs').update({status:'resolved'}).eq('id',id);
    setJobs(prev=>prev.map(j=>j.id===id?{...j,status:'resolved'}:j));
  };

  const reasons=[...new Set(jobs.map((j:any)=>j.reason).filter(Boolean))].sort() as string[];
  const filtered=jobs.filter((j:any)=>{
    if(filterReason&&j.reason!==filterReason)return false;
    if(!search.trim())return true;
    const s=search.toLowerCase();
    return[j.job_id,j.address,j.city,j.tech_id,j.reason,j.notes,j.zone].some(v=>String(v||'').toLowerCase().includes(s));
  });

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
          <button onClick={onBack} style={{background:'none',border:'1px solid #162e58',borderRadius:8,padding:'6px 10px',color:C.dim,cursor:'pointer',fontSize:13}}>←</button>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:900,color:C.text}}>🚫 {es?'Trabajos Cancelados / No Realizados':'Cancelled / Not Done Jobs'}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          {[{l:es?'Cancelados':'Cancelled',v:jobs.filter((j:any)=>j.status==='cancelled').length,c:'#ff3348'},{l:es?'Resueltos':'Resolved',v:jobs.filter((j:any)=>j.status==='resolved').length,c:'#00dc85'},{l:'Total',v:jobs.length,c:'#00b8f5'}].map(s=>(
            <div key={s.l} style={{background:`${s.c}18`,border:`1px solid ${s.c}44`,borderRadius:10,padding:'8px 14px',textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
              <div style={{fontSize:11,color:C.dim}}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={es?'Buscar dirección, job, técnico...':'Search address, job, tech...'} style={{flex:1,minWidth:160,background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px 12px',color:C.text,fontSize:13,outline:'none',fontFamily:"'Barlow',sans-serif"}}/>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px 10px',color:C.text,fontSize:12,outline:'none'}}>
            <option value="all">{es?'Todos':'All'}</option>
            <option value="cancelled">{es?'Cancelados':'Cancelled'}</option>
            <option value="resolved">{es?'Resueltos':'Resolved'}</option>
          </select>
          {reasons.length>0&&<select value={filterReason} onChange={e=>setFilterReason(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px 10px',color:C.text,fontSize:12,outline:'none',maxWidth:150}}>
            <option value="">{es?'Todas las razones':'All reasons'}</option>
            {reasons.map((r:string)=><option key={r} value={r}>{r}</option>)}
          </select>}
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'7px 10px',color:C.text,fontSize:12,outline:'none'}}/>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'7px 10px',color:C.text,fontSize:12,outline:'none'}}/>
          <button onClick={load} style={{background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'8px 14px',color:'#00b8f5',fontWeight:700,cursor:'pointer',fontSize:12}}>{es?'Buscar':'Search'}</button>
        </div>
      </div>
      {loading?(
        <div style={{textAlign:'center',padding:40,color:C.dim}}>{es?'Cargando...':'Loading...'}</div>
      ):filtered.length===0?(
        <div style={{textAlign:'center',padding:40,color:C.dim,background:C.card,borderRadius:14,border:'1px solid #162e58'}}>{es?'Sin resultados':'No results'}</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{fontSize:12,color:C.dim,paddingLeft:4}}>{filtered.length} {es?'registros':'records'}</div>
          {filtered.map((j:any)=>(
            <div key={j.id} style={{background:C.card,border:`1px solid ${j.status==='resolved'?'#00dc8544':'#ff334844'}`,borderRadius:12,padding:'14px 16px',display:'flex',alignItems:'flex-start',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:14,color:C.accent}}>#{j.job_id||'—'}</span>
                  <span style={{background:j.status==='resolved'?'#00dc8522':'#ff334822',border:`1px solid ${j.status==='resolved'?'#00dc85':'#ff3348'}`,borderRadius:20,padding:'1px 8px',fontSize:10,fontWeight:700,color:j.status==='resolved'?'#00dc85':'#ff3348'}}>{j.status==='resolved'?(es?'Resuelto':'Resolved'):(es?'Cancelado':'Cancelled')}</span>
                  {j.reason&&<span style={{background:'#ffbe0022',border:'1px solid #ffbe0044',borderRadius:20,padding:'1px 8px',fontSize:10,color:'#ffbe00'}}>{j.reason}</span>}
                </div>
                <div style={{fontSize:13,color:C.text,fontWeight:600,marginBottom:2}}>{j.address}{j.city?`, ${j.city}`:''}</div>
                {j.phone&&<div style={{fontSize:11,color:'#00b8f5',marginBottom:2}}>📞 {j.phone}</div>}
                <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:4}}>
                  {j.tech_id&&<span style={{fontSize:11,color:C.dim}}>👷 {j.tech_id}</span>}
                  {j.source_route_date&&<span style={{fontSize:11,color:C.dim}}>📅 {j.source_route_date}</span>}
                  {j.zone&&<span style={{fontSize:11,color:C.dim}}>📮 {j.zone}</span>}
                </div>
                {j.notes&&<div style={{fontSize:11,color:C.dim,marginTop:4,background:'#0e1e3a',borderRadius:6,padding:'4px 8px'}}>💬 {j.notes}</div>}
              </div>
              {j.status==='cancelled'&&(
                <button onClick={()=>handleResolve(j.id)} style={{background:'#00dc8522',border:'1px solid #00dc85',borderRadius:8,padding:'7px 12px',color:'#00dc85',fontWeight:700,cursor:'pointer',fontSize:11,whiteSpace:'nowrap',flexShrink:0}}>
                  {es?'Marcar Resuelto':'Mark Resolved'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Paginación */}
      {cancelledTotal > PAGE_SIZE_CANCELLED && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,padding:'12px 0'}}>
          <button onClick={()=>setCancelledPage(p=>Math.max(0,p-1))} disabled={cancelledPage===0}
            style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'7px 14px',color:cancelledPage===0?'#2e4470':'#00b8f5',fontWeight:700,cursor:cancelledPage===0?'default':'pointer',fontSize:13}}>← {es?'Anterior':'Prev'}</button>
          <span style={{fontSize:12,color:C.dim}}>{cancelledPage+1} / {Math.ceil(cancelledTotal/PAGE_SIZE_CANCELLED)}</span>
          <button onClick={()=>setCancelledPage(p=>p+1)} disabled={(cancelledPage+1)*PAGE_SIZE_CANCELLED>=cancelledTotal}
            style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'7px 14px',color:(cancelledPage+1)*PAGE_SIZE_CANCELLED>=cancelledTotal?'#2e4470':'#00b8f5',fontWeight:700,cursor:(cancelledPage+1)*PAGE_SIZE_CANCELLED>=cancelledTotal?'default':'pointer',fontSize:13}}>{es?'Siguiente':'Next'} →</button>
        </div>
      )}
    </div>
  );
}

export { CancelledJobsView };
