import { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';

export default function JobsPage({region='miami',technicianId}:{region?:string;technicianId?:string}) {
  const [jobs,setJobs]=useState<any[]>([]);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('all');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    let request=sb.from('routes').select('*').eq('region',region).order('date',{ascending:false}).order('order_num',{ascending:true}).limit(300);
    if(technicianId)request=request.eq('tech_id',technicianId);
    const {data,error}=await request;
    if(error)setError(error.message);else setJobs(data||[]);
    setLoading(false);
  },[region,technicianId]);
  useEffect(()=>{load();},[load]);

  const filtered=useMemo(()=>jobs.filter(job=>{
    const normalized=String(query).toLowerCase().trim();
    const matchesQuery=!normalized||[job.job_id,job.address,job.city,job.phone,job.tech_id,job.pay_code].some(value=>String(value||'').toLowerCase().includes(normalized));
    const matchesStatus=status==='all'||String(job.status)===status;
    return matchesQuery&&matchesStatus;
  }),[jobs,query,status]);

  return <section style={{minHeight:'100vh',background:'#04091c',color:'#e8f1ff',padding:20,fontFamily:'Barlow, sans-serif'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><h1 style={{margin:0}}>Jobs</h1><p style={{margin:'4px 0 0',color:'#8da4c9'}}>{technicianId?`Technician #${technicianId}`:region.toUpperCase()} · {filtered.length} records</p></div><button onClick={load} style={{background:'#00b8f522',border:'1px solid #00b8f5',color:'#00b8f5',borderRadius:8,padding:'8px 12px',fontWeight:800}}>Refresh</button></div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) 180px',gap:8,margin:'16px 0'}}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Job ID, address, phone, technician…" style={{background:'#071327',border:'1px solid #162e58',borderRadius:8,padding:'10px 12px',color:'#e8f1ff'}}/><select value={status} onChange={e=>setStatus(e.target.value)} style={{background:'#071327',border:'1px solid #162e58',borderRadius:8,padding:'10px 12px',color:'#e8f1ff'}}><option value="all">All statuses</option><option value="pending">Pending</option><option value="done">Completed</option><option value="notdone">Not completed</option></select></div>
    {error&&<div style={{color:'#ff7788'}}>⚠ {error}</div>}{loading?<div style={{color:'#8da4c9'}}>Loading jobs…</div>:filtered.length===0?<div style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:30,textAlign:'center',color:'#8da4c9'}}>No matching jobs.</div>:<div style={{display:'flex',flexDirection:'column',gap:8}}>{filtered.map(job=><article key={job.id} style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:10,padding:12,display:'grid',gridTemplateColumns:'minmax(160px,1fr) minmax(220px,2fr) 130px',gap:10}}><div><b style={{color:'#00b8f5'}}>#{job.job_id}</b><div style={{fontSize:10,color:'#8da4c9'}}>Tech #{job.tech_id} · {job.date}</div></div><div><div>{job.address}{job.city?`, ${job.city}`:''}</div><div style={{fontSize:10,color:'#8da4c9'}}>{job.phone||'No phone'} · {job.type||'No type'}</div></div><div style={{fontWeight:900,color:job.status==='done'?'#00dc85':job.status==='notdone'?'#ff3348':'#ffbe00',textTransform:'uppercase'}}>{job.status}</div></article>)}</div>}
  </section>;
}
