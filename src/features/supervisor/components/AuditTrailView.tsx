// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { exportAuditLogsCsv, getLocalAuditLogs, subscribeLocalAudit, syncPendingLocalAuditLogs } from '../../../services/audit.service';

function fmtDate(d:string, lang:string){
  if(!d) return '—';
  return new Date(d).toLocaleString(lang==='es'?'es-US':'en-US', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function cleanAction(value:string){return String(value||'unknown').replace(/_/g,' ');}
function meta(log:any){return log?.metadata || {};}
function textIncludes(log:any,q:string){
  if(!q)return true;
  const m=meta(log);
  return [log.action,log.entity,log.entity_id,log.user_id,m.summary,m.actorName,m.actorRole,m.targetTech,m.tech_id,m.job_id,m.region,m.address,m.reason].join(' ').toLowerCase().includes(q);
}

function AuditTrailView({lang, region}:{lang:string, region?:string}){
  const es=lang==='es';
  const[remoteLogs,setRemoteLogs]=useState<any[]>([]);
  const[localLogs,setLocalLogs]=useState<any[]>(()=>getLocalAuditLogs());
  const[loading,setLoading]=useState(true);
  const[remoteError,setRemoteError]=useState('');
  const[search,setSearch]=useState('');
  const[actionFilter,setActionFilter]=useState('all');
  const[syncFilter,setSyncFilter]=useState('all');
  const[roleFilter,setRoleFilter]=useState('all');
  const[syncing,setSyncing]=useState(false);
  const[syncMessage,setSyncMessage]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);
    setLocalLogs(getLocalAuditLogs());
    const {data,error}=await sb.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(500);
    setRemoteError(error?.message||'');
    setRemoteLogs((data||[]).map((x:any)=>({...x,sync_status:x.sync_status||'remote'})));
    setLoading(false);
  },[]);

  useEffect(()=>{load();return subscribeLocalAudit(()=>setLocalLogs(getLocalAuditLogs()));},[load]);

  const logs=useMemo(()=>{
    const byKey=new Map<string,any>();
    [...remoteLogs,...localLogs].forEach((log:any)=>{
      const key=log.id || `${log.action}|${log.entity}|${log.entity_id||''}|${log.created_at}`;
      const existing=byKey.get(key);
      byKey.set(key, existing ? {...existing,...log,metadata:{...(existing.metadata||{}),...(log.metadata||{})}} : log);
    });
    const q=search.trim().toLowerCase();
    return [...byKey.values()]
      .filter((log:any)=>{const r=meta(log).region;return !region||!r||String(r)===String(region);})
      .filter((log:any)=>actionFilter==='all'||String(log.action||'')===actionFilter)
      .filter((log:any)=>roleFilter==='all'||String(meta(log).actorRole||'unknown')===roleFilter)
      .filter((log:any)=>syncFilter==='all'||(syncFilter==='pending'?log.sync_status==='pending':syncFilter==='remote'?log.sync_status==='remote':log.sync_status==='synced'))
      .filter((log:any)=>textIncludes(log,q))
      .sort((a:any,b:any)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
      .slice(0,500);
  },[localLogs,remoteLogs,region,search,actionFilter,syncFilter,roleFilter]);

  const actions=useMemo(()=>[...new Set([...localLogs,...remoteLogs].map((log:any)=>String(log.action||'unknown')))].sort(),[localLogs,remoteLogs]);
  const roles=useMemo(()=>[...new Set([...localLogs,...remoteLogs].map((log:any)=>String(meta(log).actorRole||'unknown')))].filter(Boolean).sort(),[localLogs,remoteLogs]);
  const pendingLocal=localLogs.filter((x:any)=>x.sync_status==='pending').length;

  const runSync=async()=>{
    setSyncing(true);setSyncMessage('');
    const result=await syncPendingLocalAuditLogs(200).catch((e:any)=>({attempted:0,synced:0,failed:1,lastError:e?.message||'sync failed'}));
    setLocalLogs(getLocalAuditLogs());
    setSyncing(false);
    setSyncMessage(result.failed
      ? (es?`⚠️ ${result.synced}/${result.attempted} sincronizados. ${result.lastError||''}`:`⚠️ ${result.synced}/${result.attempted} synced. ${result.lastError||''}`)
      : (es?`✅ ${result.synced}/${result.attempted} sincronizados`:`✅ ${result.synced}/${result.attempted} synced`));
    load();
  };

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap'}}>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:21,fontWeight:900,color:C.text}}>🧾 {es?'Trace / Auditoría':'Trace / Audit'}</div>
            <div style={{fontSize:12,color:C.dim,marginTop:2}}>{es?'Vista combinada: auditoría local inmediata + auditoría remota de Supabase.':'Combined view: instant local audit + remote Supabase audit.'}</div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={runSync} disabled={syncing||pendingLocal===0} style={{background:pendingLocal?'#ffbe0022':'#0e1e3a',border:`1px solid ${pendingLocal?'#ffbe00':'#162e58'}`,borderRadius:8,padding:'8px 12px',color:pendingLocal?'#ffcf55':C.dim,fontWeight:800,cursor:pendingLocal?'pointer':'default'}}>{syncing?(es?'Sync...':'Sync...'):(es?`Sync pendientes (${pendingLocal})`:`Sync pending (${pendingLocal})`)}</button>
            <button onClick={()=>exportAuditLogsCsv(logs)} style={{background:'#9d5fff22',border:'1px solid #9d5fff',borderRadius:8,padding:'8px 12px',color:'#c39dff',fontWeight:800,cursor:'pointer'}}>⬇ CSV</button>
            <button onClick={load} style={{background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'8px 12px',color:'#00b8f5',fontWeight:800,cursor:'pointer'}}>{es?'Actualizar':'Refresh'}</button>
          </div>
        </div>
        {syncMessage&&<div style={{marginTop:8,background:'#0e1e3a',border:'1px solid #162e58',borderRadius:9,padding:'8px 10px',color:C.text,fontSize:11}}>{syncMessage}</div>}
        <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) repeat(3,minmax(120px,170px))',gap:8,marginTop:10}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={es?'Buscar Job ID, técnico, usuario, acción...':'Search Job ID, tech, user, action...'} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}/>
          <select value={actionFilter} onChange={e=>setActionFilter(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}>
            <option value='all'>{es?'Todas las acciones':'All actions'}</option>
            {actions.map(a=><option key={a} value={a}>{cleanAction(a)}</option>)}
          </select>
          <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}>
            <option value='all'>{es?'Todos los roles':'All roles'}</option>
            {roles.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
          <select value={syncFilter} onChange={e=>setSyncFilter(e.target.value)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'9px 10px',color:C.text}}>
            <option value='all'>{es?'Todo sync':'All sync'}</option>
            <option value='remote'>{es?'Remoto':'Remote'}</option>
            <option value='synced'>{es?'Local sincronizado':'Local synced'}</option>
            <option value='pending'>{es?'Pendiente local':'Local pending'}</option>
          </select>
        </div>
        {remoteError&&<div style={{marginTop:8,background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:9,padding:'8px 10px',color:'#ffcf55',fontSize:11}}>⚠ {es?'Supabase no permitió leer la auditoría remota. La traza local sigue visible.':'Supabase did not allow remote audit reads. Local trace remains visible.'} <span style={{opacity:.75}}>{remoteError}</span></div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:8,marginTop:10}}>
          {[{l:es?'Registros visibles':'Visible records',v:logs.length,c:'#00b8f5'},{l:es?'Hoy':'Today',v:logs.filter((x:any)=>String(x.created_at||'').slice(0,10)===new Date().toISOString().slice(0,10)).length,c:'#00dc85'},{l:es?'Pendientes sync':'Pending sync',v:pendingLocal,c:'#ffbe00'},{l:'Jobs',v:logs.filter((x:any)=>String(x.entity||'').includes('route')||String(meta(x).job_id||'')).length,c:'#9d5fff'}].map(s=><div key={s.l} style={{background:'#0e1e3a',border:`1px solid ${s.c}44`,borderRadius:10,padding:'10px 12px'}}><div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:10,color:C.dim}}>{s.l}</div></div>)}
        </div>
      </div>
      {loading ? <div style={{textAlign:'center',padding:30,color:C.dim}}>{es?'Cargando traza...':'Loading trace...'}</div> : logs.length===0 ? <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:30,textAlign:'center',color:C.dim}}>{es?'No hay trazas todavía.':'No trace entries yet.'}</div> : logs.map((log:any)=>{
        const m=meta(log);
        const pending=log.sync_status==='pending';
        const remote=log.sync_status==='remote';
        const border=pending?'#ffbe00':remote?'#00b8f5':'#00dc85';
        return <div key={`${log.id||''}-${log.created_at}-${log.action}`} style={{background:C.card,border:`1px solid ${border}55`,borderRadius:12,padding:'12px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap',marginBottom:5}}>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:900,color:C.text,textTransform:'uppercase'}}>{cleanAction(log.action)}</span>
                <span style={{fontSize:10,color:border,border:`1px solid ${border}88`,borderRadius:20,padding:'1px 8px',fontWeight:800}}>{pending?'LOCAL PENDING':remote?'REMOTE':'SYNCED'}</span>
                {m.actorRole&&<span style={{fontSize:10,color:C.dim}}>👤 {m.actorRole}</span>}
                {m.tech_id&&<span style={{fontSize:10,color:C.dim}}>Tech #{m.tech_id}</span>}
                {m.job_id&&<span style={{fontSize:10,color:'#00b8f5'}}>Job #{m.job_id}</span>}
              </div>
              <div style={{fontSize:13,color:C.text,fontWeight:700}}>{m.summary || `${log.entity}${log.entity_id?` #${log.entity_id}`:''}`}</div>
              <div style={{fontSize:11,color:C.dim,marginTop:4}}>{fmtDate(log.created_at,lang)} · {m.actorName||'unknown'} · {log.entity}{log.entity_id?` / ${log.entity_id}`:''}</div>
              {log.remote_error&&<div style={{fontSize:10,color:'#ff6677',marginTop:5}}>⚠ {log.remote_error}</div>}
            </div>
            <details style={{fontSize:10,color:C.dim,maxWidth:420}}>
              <summary style={{cursor:'pointer',color:'#8da4c9',fontWeight:800}}>{es?'Detalles':'Details'}</summary>
              <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:8,maxHeight:220,overflow:'auto'}}>{JSON.stringify({entity:log.entity,entity_id:log.entity_id,metadata:m},null,2)}</pre>
            </details>
          </div>
        </div>;
      })}
    </div>
  );
}

export { AuditTrailView };
