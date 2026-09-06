// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import DispatchPage from '../dispatch/pages/DispatchPage';
import QAPage from '../qa/pages/QAPage';
import ReworksPage from '../reworks/pages/ReworksPage';
import CustomersPage from '../customers/pages/CustomersPage';
import DocumentsPage from '../documents/pages/DocumentsPage';
import VehiclesPage from '../vehicles/pages/VehiclesPage';
import TrainingPage from '../training/pages/TrainingPage';
import AnalyticsPage from '../analytics/pages/AnalyticsPage';
import CommunicationsPage from '../communications/pages/CommunicationsPage';
import { OPS } from './components/OperationsPrimitives';
import { checkOperationsHealth } from '../../services/operations/schema.service';

const MODULES = [
  ['dispatch','🚚 Dispatch'],
  ['qa','✅ QA'],
  ['reworks','🔁 Reworks'],
  ['customers','👥 Customers'],
  ['documents','📄 Documents'],
  ['vehicles','🚐 Vehicles'],
  ['training','🎓 Training'],
  ['communications','📣 Communications'],
  ['analytics','📊 Analytics'],
] as const;
const FALLBACK_MODULES = new Set(['dispatch','analytics']);
const isUsableModule = (id: string, item?: any) => !item || item.ready || FALLBACK_MODULES.has(id);

export default function OperationsCenter({region,lang,readOnly=false,actorName='Supervisor',actorId}:{region:string;lang:string;readOnly?:boolean;actorName?:string;actorId?:string}){
  const [module,setModule]=useState('dispatch');
  const [health,setHealth]=useState<any[]>([]);
  const [checking,setChecking]=useState(false);
  const loadHealth=useCallback(async()=>{
    setChecking(true);
    try{setHealth(await checkOperationsHealth(MODULES.map(([id])=>id as any)));}
    finally{setChecking(false);}
  },[]);
  useEffect(()=>{loadHealth();},[loadHealth]);
  const missing=useMemo(()=>health.filter(item=>!item.ready),[health]);
  const selectedHealth=health.find(item=>item.id===module);
  const canUseFallback=FALLBACK_MODULES.has(module);
  const usableModules=useMemo(()=>MODULES.filter(([id])=>isUsableModule(id,health.find(entry=>entry.id===id))),[health]);
  const hiddenModules=useMemo(()=>MODULES.filter(([id])=>{const item=health.find(entry=>entry.id===id);return item&&!isUsableModule(id,item);}),[health]);
  const moduleBlocked=Boolean(selectedHealth&&!selectedHealth.ready&&!canUseFallback);
  useEffect(()=>{if(moduleBlocked&&usableModules.length)setModule(usableModules[0][0]);},[moduleBlocked,usableModules]);
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:4}}>{usableModules.map(([id,label])=>{const item=health.find(entry=>entry.id===id);const fallback=item&&!item.ready&&FALLBACK_MODULES.has(id);return <button key={id} onClick={()=>setModule(id)} style={{flexShrink:0,background:module===id?`${OPS.blue}22`:OPS.card,border:`1px solid ${fallback?OPS.yellow:module===id?OPS.blue:OPS.border}`,borderRadius:8,padding:'8px 10px',color:fallback?OPS.yellow:module===id?OPS.blue:OPS.dim,fontWeight:800,cursor:'pointer',fontSize:11}}>{label}{fallback?' · limited':''}</button>})}</div>

    {hiddenModules.length>0&&<div style={{background:'#ff334808',border:'1px solid #ff334833',borderRadius:9,padding:'8px 10px',fontSize:10,color:OPS.dim}}>
      <b style={{color:OPS.red}}>Hidden until database setup:</b> {hiddenModules.map(([,label])=>label).join(' · ')}
    </div>}

    {health.length>0&&<div style={{background:missing.length?'#ff334810':'#00dc8510',border:`1px solid ${missing.length?'#ff334855':'#00dc8544'}`,borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <div style={{flex:1,minWidth:220}}>
        <div style={{fontSize:11,fontWeight:900,color:missing.length?OPS.red:OPS.green}}>{missing.length?`${missing.length} operations module${missing.length===1?'':'s'} need database setup`:'Operations database is ready'}</div>
        <div style={{fontSize:10,color:OPS.dim,marginTop:3}}>{missing.length?'The UI is loaded, but the connected Supabase project is missing tables, columns, views, or policies required by these modules. Apply migration 202606150009_operations_archive_notifications_repair.sql.':'All checked operations relations are available.'}</div>
      </div>
      <button onClick={loadHealth} disabled={checking} style={{background:'#00b8f518',border:'1px solid #00b8f555',borderRadius:8,color:'#00b8f5',padding:'7px 10px',fontSize:10,fontWeight:900,cursor:'pointer'}}>{checking?'Checking…':'Check again'}</button>
    </div>}

    {selectedHealth&&!selectedHealth.ready&&<div style={{background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:9,padding:'9px 11px',color:'#ffcf55',fontSize:11}}>⚠ {selectedHealth.message}{canUseFallback&&<div style={{marginTop:4,color:OPS.dim}}>This module will continue with a limited fallback until the repair migration is deployed.</div>}</div>}

    {moduleBlocked&&<div style={{background:OPS.card,border:`1px solid ${OPS.border}`,borderRadius:12,padding:'28px 18px',textAlign:'center'}}><div style={{fontSize:30}}>🛠️</div><div style={{fontSize:14,fontWeight:900,color:OPS.text,marginTop:7}}>Database setup required</div><div style={{fontSize:11,color:OPS.dim,marginTop:5}}>This page is intentionally paused instead of showing repeated database errors. Apply <b>SUPABASE_OPERATIONS_REPAIR.sql</b>, then press Check again.</div></div>}
    {!moduleBlocked&&module==='dispatch'&&<DispatchPage region={region} lang={lang} readOnly={readOnly} actorName={actorName}/>} 
    {!moduleBlocked&&module==='qa'&&<QAPage lang={lang} readOnly={readOnly} actorName={actorName}/>} 
    {!moduleBlocked&&module==='reworks'&&<ReworksPage lang={lang} readOnly={readOnly} actorName={actorName}/>} 
    {!moduleBlocked&&module==='customers'&&<CustomersPage lang={lang} readOnly={readOnly} actorName={actorName}/>} 
    {!moduleBlocked&&module==='documents'&&<DocumentsPage lang={lang} readOnly={readOnly}/>} 
    {!moduleBlocked&&module==='vehicles'&&<VehiclesPage lang={lang} readOnly={readOnly}/>} 
    {!moduleBlocked&&module==='training'&&<TrainingPage lang={lang} readOnly={readOnly}/>} 
    {!moduleBlocked&&module==='communications'&&<CommunicationsPage lang={lang} readOnly={readOnly} actorId={actorId}/>} 
    {!moduleBlocked&&module==='analytics'&&<AnalyticsPage lang={lang}/>} 
  </div>;
}
