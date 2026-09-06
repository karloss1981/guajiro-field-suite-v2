// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOperationsDashboard } from '../../../services/operations/analytics.service';
import { OpsButton, OpsCard, OpsEmpty, OpsError, OpsPage, OPS } from '../../operations/components/OperationsPrimitives';

export default function AnalyticsPage({lang}:{lang:string}) {
  const es=lang==='es';
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try { setData(await getOperationsDashboard()); }
    catch(e:any) { setError(e.message||String(e)); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{load();},[load]);

  const totals=useMemo(()=>{
    const rows=data?.productivity||[];
    return rows.reduce((acc:any,row:any)=>({
      completed:acc.completed+Number(row.completed_jobs||0),
      notDone:acc.notDone+Number(row.not_done_jobs||0),
      jobs:acc.jobs+Number(row.total_jobs||0),
      earned:acc.earned+Number(row.total_earned||0),
    }),{completed:0,notDone:0,jobs:0,earned:0});
  },[data]);

  return <OpsPage
    title={es?'📊 Analítica':'📊 Analytics'}
    subtitle={es?'Producción actual e histórica basada en rutas y archivos verificados.':'Current and historical production from live routes and verified archives.'}
    actions={<OpsButton onClick={load} disabled={loading}>{loading?'Loading…':'Refresh'}</OpsButton>}
  >
    <OpsError message={error}/>
    {data?.warnings?.length>0&&<div style={{background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:9,padding:'9px 11px',color:'#ffcf55',fontSize:11}}>{data.warnings.map((warning:string)=><div key={warning}>⚠ {warning}</div>)}</div>}
    {!data?<OpsEmpty>{loading?'Loading analytics…':'No analytics available.'}</OpsEmpty>:<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:8}}>
        {[
          [es?'Trabajos':'Jobs',totals.jobs,OPS.blue],
          [es?'Completados':'Completed',totals.completed,OPS.green],
          [es?'No completados':'Not done',totals.notDone,OPS.red],
          [es?'Generado':'Earned',`$${totals.earned.toLocaleString()}`,OPS.blue],
          [es?'Técnicos':'Techs',data.productivity?.length||0,OPS.purple],
          ['QA',`${data.qa?.average_score||0}%`,OPS.green],
          [es?'Retrabajos abiertos':'Open reworks',data.reworks?.open_reworks||0,OPS.yellow],
        ].map(([label,value,color])=><OpsCard key={String(label)}><div style={{fontSize:10,color:OPS.dim}}>{label}</div><div style={{fontSize:23,fontWeight:900,color}}>{value}</div></OpsCard>)}
      </div>

      <OpsCard>
        <b style={{color:OPS.text}}>{es?'Productividad por técnico':'Technician productivity'}</b>
        {(data.productivity||[]).length===0?<div style={{color:OPS.dim,fontSize:11,marginTop:10}}>No route or archive data is available yet.</div>:<div style={{marginTop:8,overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11,color:OPS.text}}><thead><tr>{['Tech',es?'Completados':'Completed',es?'No hechos':'Not done','Total',es?'Generado':'Earned'].map(h=><th key={h} style={{textAlign:'left',padding:7,borderBottom:`1px solid ${OPS.border}`,color:OPS.dim}}>{h}</th>)}</tr></thead><tbody>{(data.productivity||[]).map((r:any)=><tr key={r.technician_id}><td style={{padding:7}}>#{r.technician_id}</td><td style={{padding:7,color:OPS.green}}>{r.completed_jobs}</td><td style={{padding:7,color:OPS.red}}>{r.not_done_jobs}</td><td style={{padding:7}}>{r.total_jobs}</td><td style={{padding:7}}>${Number(r.total_earned||0).toLocaleString()}</td></tr>)}</tbody></table></div>}
      </OpsCard>

      <OpsCard>
        <b style={{color:OPS.text}}>{es?'Producción diaria':'Daily production'}</b>
        {(data.production||[]).length===0?<div style={{color:OPS.dim,fontSize:11,marginTop:10}}>No daily production records.</div>:<div style={{marginTop:8,overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11,color:OPS.text}}><thead><tr>{[es?'Fecha':'Date','Tech',es?'Completados':'Completed',es?'No hechos':'Not done','Total'].map(h=><th key={h} style={{textAlign:'left',padding:7,borderBottom:`1px solid ${OPS.border}`,color:OPS.dim}}>{h}</th>)}</tr></thead><tbody>{(data.production||[]).slice(0,100).map((r:any,index:number)=><tr key={`${r.technician_id}-${r.day}-${index}`}><td style={{padding:7}}>{r.day||'—'}</td><td style={{padding:7}}>#{r.technician_id}</td><td style={{padding:7,color:OPS.green}}>{r.jobs_completed}</td><td style={{padding:7,color:OPS.red}}>{r.jobs_not_done}</td><td style={{padding:7}}>{r.total_jobs}</td></tr>)}</tbody></table></div>}
      </OpsCard>
    </>}
  </OpsPage>;
}
