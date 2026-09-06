import { useEffect, useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';

export default function DashboardPage({region='miami'}:{region?:string}) {
  const [routes,setRoutes]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const today=new Date().toLocaleDateString('en-CA');

  useEffect(()=>{
    let active=true;
    setLoading(true);
    (async()=>{
      const {data,error}=await sb.from('routes').select('id,tech_id,status,pay_total').eq('region',region).eq('date',today);
      if(!active)return;
      if(error)setError(error.message);else setRoutes(data||[]);
      setLoading(false);
    })();
    return()=>{active=false;};
  },[region,today]);

  const stats=useMemo(()=>({
    total:routes.length,
    completed:routes.filter(r=>['done','completed'].includes(r.status)).length,
    notCompleted:routes.filter(r=>['notdone','not_completed'].includes(r.status)).length,
    pending:routes.filter(r=>!['done','completed','notdone','not_completed'].includes(r.status)).length,
    technicians:new Set(routes.map(r=>r.tech_id).filter(Boolean)).size,
    earned:routes.reduce((sum,r)=>sum+Number(r.pay_total||0),0),
  }),[routes]);

  return <section style={{minHeight:'100vh',background:'#04091c',color:'#e8f1ff',padding:20,fontFamily:'Barlow, sans-serif'}}>
    <h1 style={{margin:'0 0 4px'}}>Operations Dashboard</h1><p style={{margin:'0 0 18px',color:'#8da4c9'}}>{region.toUpperCase()} · {today}</p>
    {error&&<div style={{color:'#ff7788',marginBottom:12}}>⚠ {error}</div>}
    {loading?<div style={{color:'#8da4c9'}}>Loading operational totals…</div>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
      {[
        ['Total jobs',stats.total,'#00b8f5'],['Completed',stats.completed,'#00dc85'],['Not completed',stats.notCompleted,'#ff3348'],['Pending',stats.pending,'#ffbe00'],['Technicians',stats.technicians,'#9d5fff'],['Earned',`$${stats.earned.toLocaleString()}`,'#00dc85'],
      ].map(([label,value,color])=><div key={String(label)} style={{background:'#0b1830',border:'1px solid #162e58',borderRadius:12,padding:14}}><div style={{fontSize:10,color:'#8da4c9',textTransform:'uppercase'}}>{label}</div><div style={{fontSize:28,fontWeight:900,color:String(color)}}>{value}</div></div>)}
    </div>}
  </section>;
}
