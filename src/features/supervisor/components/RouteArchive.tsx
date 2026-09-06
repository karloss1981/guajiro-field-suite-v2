// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { parseRouteImport } from '../../../services/routeImport.service';
import { getDefaultImportRouteDate, getRouteUploadWindowLabel } from '../../../services/routeDate.service';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { getTechName } from '../../../legacy/data';
import { saveDailyRouteSnapshot, savePermanentRouteArchive } from '../../../services/routeArchive.service';
import { addAppNotification } from '../../../services/notification.service';
import { createAuditLog } from '../../../services/audit.service';
import { isMissingRelationError, operationsSetupMessage } from '../../../services/operations/schema.service';
import { checkDestructiveAction, guardDestructiveAction } from '../../../services/actionGuard.service';

const inputStyle = {
  background:'#0e1e3a', border:'1px solid #162e58', borderRadius:8, padding:'8px 10px',
  color:C.text, fontSize:12, outline:'none', fontFamily:"'Barlow',sans-serif"
};

const actionButton = (bg:string, border:string, color:string, disabled=false) => ({
  background:bg, border, borderRadius:10, padding:'10px 12px', color, fontWeight:900,
  fontSize:12, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.55:1,
  fontFamily:"'Barlow Condensed',sans-serif"
});

function safeDate() { return new Date().toLocaleDateString('en-CA'); }
function norm(v:any){ return String(v ?? '').trim(); }
function cleanPhone(v:any){ return norm(v).replace(/\D/g,'').slice(-10); }
function isDone(status:any){ return ['done','completed'].includes(String(status||'').toLowerCase()); }
function isNotDone(status:any){ return ['notdone','not_done','not_completed','cancelled'].includes(String(status||'').toLowerCase()); }
function makeRouteJob(job:any, date:string, region:string, resetToPending:boolean, index:number){
  const copy:any = {
    date,
    region,
    tech_id: norm(job.tech_id || job.tech || job.technician_id),
    job_id: norm(job.job_id || job.jobId || job.work_order || job.wo),
    address: norm(job.address || job.service_address || job.location),
    city: norm(job.city),
    zip: norm(job.zip || job.zone || job.postal_code),
    phone: cleanPhone(job.phone || job.home || job.mobile || job.customer_phone),
    type: norm(job.type || job.job_type || job.work_type) || 'JS:BURY COAX',
    status: resetToPending ? 'pending' : (norm(job.status) || 'pending'),
    order_num: Number.isFinite(Number(job.order_num)) ? Number(job.order_num) : index,
    pay_code: norm(job.pay_code || job.billing_code),
    pay_total: Number(job.pay_total || job.pay || 0) || 0,
    reason: resetToPending ? '' : norm(job.reason),
    job_note: norm(job.job_note || job.notes || job.note),
    is_duplicate: Boolean(job.is_duplicate),
  };
  if(!copy.tech_id || !copy.job_id || !copy.address) return null;
  return copy;
}

async function upsertTechniciansFromJobs(jobs:any[], region:string) {
  const ids = [...new Set(jobs.map(j => String(j.tech_id || '')).filter(Boolean))];
  if(!ids.length) return;
  const existing = await sb.from('technicians').select('id').in('id', ids);
  const known = new Set((existing.data || []).map((t:any)=>String(t.id)));
  const missing = ids.filter(id => !known.has(id)).map(id => ({ id, name: getTechName(id) || `Tech #${id}`, region, active:true }));
  if(missing.length) await sb.from('technicians').upsert(missing, { onConflict:'id' });
}

function RouteArchive({region, lang, onBack, actorName='Supervisor', actorRole='supervisor', readOnly=false, auth=null}:{region:string, lang:string, onBack:()=>void, actorName?:string, actorRole?:string, readOnly?:boolean, auth?:any}) {
  const es = lang === 'es';
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string|null>(null);
  const [loadWarning, setLoadWarning] = useState<string|null>(null);
  const [selected, setSelected] = useState<any|null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 60*86400000).toLocaleDateString('en-CA'));
  const [dateTo, setDateTo] = useState(() => getDefaultImportRouteDate());
  const [restoreConfirm, setRestoreConfirm] = useState<null|{mode:'same'|'today'}>(null);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string|null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string|null>(null);
  const [uploadDate, setUploadDate] = useState(()=>getDefaultImportRouteDate());
  const [uploadSuccess, setUploadSuccess] = useState<string|null>(null);

  const loadSnapshots = useCallback(async () => {
    setLoading(true); setLoadError(null); setLoadWarning(null);
    try {
      const daily = await sb.from('daily_route_snapshots')
        .select('id,region,date,job_count,done_count,total_earned,saved_at')
        .eq('region', region)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', {ascending:false})
        .limit(180);
      if (daily.error) throw daily.error;

      const permanent = await sb.from('archived_routes')
        .select('id,region,route_date,job_count,done_count,notdone_count,total_earned,archived_at')
        .eq('region', region)
        .gte('route_date', dateFrom)
        .lte('route_date', dateTo)
        .order('archived_at', {ascending:false})
        .limit(180);

      let permanentRows:any[]=[];
      if(permanent.error){
        if(isMissingRelationError(permanent.error,'archived_routes')) setLoadWarning(operationsSetupMessage(permanent.error,'Permanent route versions'));
        else throw permanent.error;
      }else{
        permanentRows=(permanent.data||[]).map((row:any)=>({...row,date:row.route_date,saved_at:row.archived_at,_source:'permanent'}));
      }
      const dailyRows=(daily.data||[]).map((row:any)=>({...row,notdone_count:Math.max(0,Number(row.job_count||0)-Number(row.done_count||0)),_source:'daily'}));
      const combined=[...permanentRows,...dailyRows].sort((a:any,b:any)=>String(b.saved_at||b.date).localeCompare(String(a.saved_at||a.date)));
      setSnapshots(combined);
    } catch(error:any) {
      setLoadError(operationsSetupMessage(error,'Route Archive'));
      setSnapshots([]);
    } finally { setLoading(false); }
  }, [region, dateFrom, dateTo]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const loadSnapshot = async (snap:any) => {
    setLoadError(null); setRestoreMessage(null);
    const relation=snap._source==='permanent'?'archived_routes':'daily_route_snapshots';
    const {data,error} = await sb.from(relation).select('snapshot').eq('id', snap.id).maybeSingle();
    if(error){setLoadError(operationsSetupMessage(error,'Route Archive'));return;}
    setSelected({...snap, jobs: Array.isArray(data?.snapshot) ? data.snapshot : []});
    setSearchQ('');
  };

  const visibleSnapshots = useMemo(() => {
    const q=searchQ.trim().toLowerCase();
    return snapshots.filter(s => {
      if(sourceFilter !== 'all' && s._source !== sourceFilter) return false;
      if(!q) return true;
      return String(s.date||'').includes(q) || String(s.id||'').toLowerCase().includes(q) || String(s._source||'').toLowerCase().includes(q);
    });
  }, [snapshots, searchQ, sourceFilter]);

  const listStats = useMemo(() => {
    const totalJobs = visibleSnapshots.reduce((sum, s) => sum + Number(s.job_count || 0), 0);
    const totalDone = visibleSnapshots.reduce((sum, s) => sum + Number(s.done_count || 0), 0);
    const totalEarned = visibleSnapshots.reduce((sum, s) => sum + Number(s.total_earned || 0), 0);
    return { versions: visibleSnapshots.length, totalJobs, totalDone, totalEarned };
  }, [visibleSnapshots]);

  const exportSelectedXlsx = () => {
    if(!selected?.jobs?.length)return;
    const rows=selected.jobs.map((job:any)=>({
      Date:job.date||selected.date,
      Tech:job.tech_id,
      'Tech Name':getTechName(job.tech_id),
      'Job ID':job.job_id,
      Address:job.address,
      City:job.city,
      ZIP:job.zip,
      Phone:job.phone,
      Type:job.type,
      Status:job.status,
      'Billing Code':job.pay_code||'',
      Pay:Number(job.pay_total||0),
      Reason:job.reason||'',
      Notes:job.job_note||''
    }));
    const worksheet=XLSX.utils.json_to_sheet(rows);
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,worksheet,'Route Archive');
    XLSX.writeFile(workbook,`route_archive_${region}_${selected.date}_${selected._source}_${selected.id}.xlsx`);
  };

  const restoreSelected = async (mode:'same'|'today') => {
    if(!selected?.jobs?.length) return;
    // V25.2: restoring replaces the ACTIVE route for the target date
    // (delete + insert), which makes it a destructive action per the V25
    // spec — PIN sessions must not be able to restore/replace routes.
    // The previous route is archived first, but the replacement itself
    // still requires an active Super Admin session.
    const gate=checkDestructiveAction(auth,lang);
    if(!gate.allowed){
      setRestoreConfirm(null); setRestorePhrase('');
      setLoadError(`🔒 ${gate.message}`);
      guardDestructiveAction({auth,lang,action:'route_restore',entity:'route_archive',entityId:selected?.id,metadata:{region,actorRole,actorName,sourceDate:selected?.date,mode}}).catch(()=>{});
      return;
    }
    setRestoring(true); setRestoreMessage(null); setLoadError(null);
    const targetDate = mode === 'today' ? safeDate() : selected.date;
    const resetToPending = mode === 'today';
    try {
      const normalized = selected.jobs
        .map((job:any, index:number) => makeRouteJob(job, targetDate, region, resetToPending, index))
        .filter(Boolean);
      if(!normalized.length) throw new Error(es?'No hay trabajos válidos para restaurar.':'There are no valid jobs to restore.');

      const previous = await sb.from('routes').select('*').eq('region', region).eq('date', targetDate);
      if(previous.error) throw previous.error;
      const previousRoutes = previous.data || [];
      if(previousRoutes.length){
        await saveDailyRouteSnapshot(region, targetDate, previousRoutes);
        const permanent = await savePermanentRouteArchive(region, targetDate, previousRoutes);
        if(permanent.warning) addAppNotification({kind:'info', title:'Route archive warning', body:permanent.warning, tag:`restore-archive-warning-${region}-${targetDate}`});
      }

      await upsertTechniciansFromJobs(normalized, region);
      const deletion = await sb.from('routes').delete().eq('region', region).eq('date', targetDate);
      if(deletion.error) throw deletion.error;
      for(let i=0; i<normalized.length; i+=50){
        const chunk = normalized.slice(i, i+50);
        const inserted = await sb.from('routes').insert(chunk);
        if(inserted.error) throw inserted.error;
      }
      await saveDailyRouteSnapshot(region, targetDate, normalized);

      createAuditLog({
        action:'route_archive_restored', entity:'route_archive', entityId:selected.id,
        metadata:{ region, actorRole, actorName, source:selected._source, sourceDate:selected.date, targetDate, restoredJobs:normalized.length, mode, previousRouteJobs:previousRoutes.length, summary:`Restored ${normalized.length} jobs from ${selected.date} to ${targetDate}` }
      }).catch(()=>{});
      addAppNotification({kind:'info', title:es?'Ruta restaurada':'Route restored', body:`${targetDate} · ${normalized.length} jobs · ${region.toUpperCase()}`, tag:`route-restored-${region}-${targetDate}`});
      setRestoreMessage(`✅ ${normalized.length} ${es?'trabajos restaurados para':'jobs restored to'} ${targetDate}${previousRoutes.length?` · ${previousRoutes.length} ${es?'trabajos anteriores archivados primero':'previous jobs archived first'}`:''}`);
      await loadSnapshots();
    } catch(error:any) {
      const msg = operationsSetupMessage(error, 'Route Restore');
      setLoadError(msg);
      createAuditLog({ action:'route_archive_restore_failed', entity:'route_archive', entityId:selected?.id, metadata:{ region, actorRole, actorName, sourceDate:selected?.date, mode, error:msg, summary:`Route restore failed: ${msg}` } }).catch(()=>{});
    } finally {
      setRestoring(false); setRestoreConfirm(null); setRestorePhrase('');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadError(null); setUploadSuccess(null);
    try {
      const preview = await parseRouteImport(file, region, uploadDate);
      const jobs = preview.jobs.map((job:any, i:number)=>({ ...job, date:uploadDate, region, order_num:i }));
      if (jobs.length === 0) {
        setUploadError(`0 ${es?'trabajos detectados':'jobs found'}`);
        setUploading(false); return;
      }

      await upsertTechniciansFromJobs(jobs, region);
      await saveDailyRouteSnapshot(region,uploadDate,jobs);
      setUploadSuccess(`✅ ${jobs.length} ${es?'trabajos archivados y verificados para':'jobs archived and verified for'} ${uploadDate}`);
      addAppNotification({kind:'info',title:es?'Ruta XLS archivada':'XLS route archived',body:`${file.name} · ${jobs.length} jobs · ${uploadDate}`,tag:`archive-upload-${region}-${uploadDate}`});
      createAuditLog({ action:'route_archive_uploaded', entity:'route_archive', metadata:{ region, actorRole, actorName, date:uploadDate, filename:file.name, count:jobs.length, warnings: preview.warnings, summary:`Manual archive upload: ${jobs.length} jobs for ${uploadDate}` } }).catch(()=>{});
      loadSnapshots();
    } catch(err:any) { setUploadError(err?.message||String(err)); }
    setUploading(false);
    e.target.value = '';
  };


  if (selected) {
    const jobs: any[] = selected.jobs || [];
    const q = searchQ.trim().toLowerCase();
    const filtered = q ? jobs.filter(j =>
      String(j.job_id||'').toLowerCase().includes(q) ||
      String(j.address||'').toLowerCase().includes(q) ||
      String(j.city||'').toLowerCase().includes(q) ||
      String(j.zip||'').toLowerCase().includes(q) ||
      String(j.tech_id||'').toLowerCase().includes(q) ||
      String(j.pay_code||'').toLowerCase().includes(q) ||
      String(j.reason||'').toLowerCase().includes(q)
    ) : jobs;
    const done = jobs.filter(j=>isDone(j.status));
    const notdone = jobs.filter(j=>isNotDone(j.status));
    const pending = jobs.filter(j=>!isDone(j.status)&&!isNotDone(j.status));
    const earned = done.reduce((sum:number, j:any) => sum + Number(j.pay_total || 0), 0);

    return (
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <button onClick={()=>{setSelected(null); setRestoreMessage(null);}} style={{...actionButton('#0e1e3a','1px solid #162e58',C.dim)}}>← {es?'Archivo':'Archive'}</button>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:19,fontWeight:900,color:'#00b8f5'}}>🗃️ {selected.date} · {selected._source==='permanent'?(es?'Versión guardada':'Saved version'):(es?'Snapshot diario':'Daily snapshot')}</div>
          <button onClick={exportSelectedXlsx} style={{...actionButton('#00b8f522','1px solid #00b8f5','#00b8f5')}}>📥 XLSX</button>
        </div>

        {loadError&&<div style={{fontSize:12,color:'#ff6677',background:'#ff334811',border:'1px solid #ff334855',borderRadius:9,padding:'9px 11px'}}>⚠️ {loadError}</div>}
        {restoreMessage&&<div style={{fontSize:12,color:'#00dc85',background:'#00dc8511',border:'1px solid #00dc8544',borderRadius:9,padding:'9px 11px'}}>{restoreMessage}</div>}

        <div className="route-archive-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(120px,1fr))',gap:10}}>
          {[
            {l:es?'Trabajos':'Jobs',v:jobs.length,c:'#00b8f5'},
            {l:es?'Completados':'Done',v:done.length,c:'#00dc85'},
            {l:es?'No completados':'Not Done',v:notdone.length,c:'#ff3348'},
            {l:es?'Ganado':'Earned',v:`$${earned.toFixed(0)}`,c:'#ffbe00'},
          ].map(card=><div key={card.l} style={{background:'#0e1e3a',border:`1px solid ${card.c}44`,borderRadius:12,padding:'12px'}}><div style={{fontSize:24,fontWeight:900,color:card.c}}>{card.v}</div><div style={{fontSize:10,color:C.dim,textTransform:'uppercase',letterSpacing:1}}>{card.l}</div></div>)}
        </div>

        <div style={{background:C.card,border:'1px solid #1e4080',borderRadius:14,padding:'14px 16px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,fontWeight:900,color:C.text}}>♻️ {es?'Restaurar ruta':'Restore route'}</div>
              <div style={{fontSize:11,color:C.dim,marginTop:2}}>{es?'Antes de reemplazar una ruta activa, la app guarda la ruta actual como respaldo.':'Before replacing an active route, the app saves the current route as a backup.'}</div>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <button disabled={readOnly || restoring || !jobs.length} onClick={()=>setRestoreConfirm({mode:'same'})} style={actionButton('#9d5fff22','1px solid #9d5fff','#caaaff',readOnly||restoring||!jobs.length)}>↩️ {es?'Restaurar misma fecha':'Restore same date'}</button>
              <button disabled={readOnly || restoring || !jobs.length} onClick={()=>setRestoreConfirm({mode:'today'})} style={actionButton('#00dc8522','1px solid #00dc85','#00dc85',readOnly||restoring||!jobs.length)}>📅 {es?'Copiar a hoy pendiente':'Copy to today pending'}</button>
            </div>
          </div>
          {readOnly&&<div style={{marginTop:8,fontSize:11,color:'#ffbe00'}}>{es?'Modo solo lectura: no puedes restaurar rutas.':'Read-only mode: route restore is disabled.'}</div>}
        </div>

        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={es?'Buscar job, técnico, dirección, ZIP...':'Search job, tech, address, ZIP...'} style={{...inputStyle,flex:1,minWidth:220}}/>
          <div style={{fontSize:12,color:C.dim,alignSelf:'center'}}>{filtered.length}/{jobs.length}</div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:10}}>
          {filtered.map((job:any, index:number) => {
            const status = String(job.status || 'pending').toLowerCase();
            const color = isDone(status) ? '#00dc85' : isNotDone(status) ? '#ff3348' : '#ffbe00';
            return (
              <div key={`${job.job_id}-${index}`} style={{background:C.card,border:`1px solid ${color}44`,borderRadius:12,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontWeight:900,color:C.text,fontSize:15}}>#{job.job_id}</div>
                    <div style={{fontSize:11,color:'#fff',fontWeight:900,marginTop:2}}>👷 {getTechName(job.tech_id)} · {job.tech_id}</div>
                  </div>
                  <span style={{background:`${color}22`,border:`1px solid ${color}55`,color,borderRadius:999,padding:'3px 8px',fontSize:10,fontWeight:900,textTransform:'uppercase'}}>{status}</span>
                </div>
                <div style={{marginTop:8,fontSize:12,color:C.text,lineHeight:1.35}}>📍 {job.address} {job.city?`· ${job.city}`:''} {job.zip?`· ${job.zip}`:''}</div>
                <div style={{marginTop:6,display:'flex',gap:8,flexWrap:'wrap',fontSize:11,color:C.dim}}>
                  {job.type&&<span>🧾 {job.type}</span>}
                  {job.phone&&<span>☎️ {job.phone}</span>}
                  {job.pay_total&&<span style={{color:'#00dc85'}}>${Number(job.pay_total||0).toFixed(0)}</span>}
                </div>
                {(job.reason||job.job_note)&&<div style={{marginTop:7,fontSize:11,color:C.dim,background:'#071327',borderRadius:8,padding:'7px 8px'}}>{job.reason||job.job_note}</div>}
              </div>
            );
          })}
        </div>

        {restoreConfirm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.84)',zIndex:950,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#0b1830',border:'1px solid #ffbe0044',borderRadius:18,padding:22,width:'100%',maxWidth:430}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:'#ffbe00'}}>⚠️ {es?'Confirmar restauración':'Confirm route restore'}</div>
            <div style={{fontSize:12,color:C.dim,margin:'8px 0 12px',lineHeight:1.45}}>
              {restoreConfirm.mode==='same'
                ? (es?`Esto reemplazará la ruta activa de ${selected.date} con ${jobs.length} trabajos del archivo.`:`This will replace the active route for ${selected.date} with ${jobs.length} jobs from the archive.`)
                : (es?`Esto copiará ${jobs.length} trabajos a la ruta de hoy como pendientes.`:`This will copy ${jobs.length} jobs into today's route as pending.`)}<br/>
              {es?'Si ya existe una ruta activa para esa fecha, primero se archivará como respaldo.':'If an active route already exists for that date, it will be archived as a backup first.'}
            </div>
            <label style={{fontSize:11,color:C.dim,display:'block',marginBottom:5}}>{es?'Escribe RESTORE ROUTE':'Type RESTORE ROUTE'}</label>
            <input value={restorePhrase} onChange={e=>setRestorePhrase(e.target.value.toUpperCase())} placeholder="RESTORE ROUTE" style={{...inputStyle,width:'100%',marginBottom:14,letterSpacing:1}}/>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>{setRestoreConfirm(null);setRestorePhrase('');}} style={{...actionButton('transparent','1px solid #162e58',C.dim),flex:1}}>{es?'Cancelar':'Cancel'}</button>
              <button disabled={restorePhrase.trim()!=='RESTORE ROUTE'||restoring} onClick={()=>restoreSelected(restoreConfirm.mode)} style={{...actionButton('linear-gradient(135deg,#ff9c00,#ffbe00)','none','#1d1200',restorePhrase.trim()!=='RESTORE ROUTE'||restoring),flex:1}}>{restoring?(es?'Restaurando...':'Restoring...'):(es?'Restaurar':'Restore')}</button>
            </div>
          </div>
        </div>}
        <style>{`@media(max-width:780px){.route-archive-grid{grid-template-columns:repeat(2,minmax(120px,1fr))!important}}`}</style>
      </div>
    );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,flexWrap:'wrap'}}>
        <button onClick={onBack} style={actionButton('#0e1e3a','1px solid #162e58',C.dim)}>← {es?'Dashboard':'Dashboard'}</button>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:900,color:'#00b8f5'}}>🗃️ {es?'Archivo de Rutas':'Route Archive'}</div>
        <button onClick={loadSnapshots} disabled={loading} style={actionButton('#00b8f522','1px solid #00b8f5','#00b8f5',loading)}>↻ {es?'Actualizar':'Refresh'}</button>
      </div>

      {loadError&&<div style={{fontSize:12,color:'#ff6677',background:'#ff334811',border:'1px solid #ff334855',borderRadius:9,padding:'9px 11px'}}>⚠️ {loadError}</div>}
      {loadWarning&&<div style={{fontSize:11,color:'#ffcf55',background:'#ffbe0011',border:'1px solid #ffbe0044',borderRadius:9,padding:'9px 11px'}}>⚠️ {loadWarning}</div>}

      <div className="route-archive-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(120px,1fr))',gap:10}}>
        {[
          {l:es?'Versiones':'Versions',v:listStats.versions,c:'#9d5fff'},
          {l:es?'Trabajos':'Jobs',v:listStats.totalJobs,c:'#00b8f5'},
          {l:es?'Completados':'Done',v:listStats.totalDone,c:'#00dc85'},
          {l:es?'Ganado':'Earned',v:`$${listStats.totalEarned.toFixed(0)}`,c:'#ffbe00'},
        ].map(card=><div key={card.l} style={{background:'#0e1e3a',border:`1px solid ${card.c}44`,borderRadius:12,padding:'12px'}}><div style={{fontSize:24,fontWeight:900,color:card.c}}>{card.v}</div><div style={{fontSize:10,color:C.dim,textTransform:'uppercase',letterSpacing:1}}>{card.l}</div></div>)}
      </div>

      <div style={{background:C.card,border:'1px solid #1e4080',borderRadius:14,padding:'16px 18px'}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:800,color:'#00b8f5',marginBottom:12,letterSpacing:0.5}}>📤 {es?'Subir Ruta al Archivo':'Upload Route to Archive'}</div>
        <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:4}}>{es?'Fecha de la ruta':'Route date'}</label><input type="date" value={uploadDate} onChange={e=>setUploadDate(e.target.value)} style={inputStyle}/><div style={{fontSize:10,color:C.dim,marginTop:4,maxWidth:380}}>{getRouteUploadWindowLabel(lang)}</div></div>
          <button onClick={()=>uploadRef.current?.click()} disabled={uploading} style={actionButton('#00b8f5','none','#04091c',uploading)}>{uploading?`⏳ ${es?'Procesando...':'Processing...'}`:`📂 ${es?'Seleccionar Excel':'Select Excel'}`}</button>
          <input ref={uploadRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={handleUpload}/>
        </div>
        {uploadError&&<div style={{marginTop:10,fontSize:12,color:'#ff3348',background:'#ff334811',borderRadius:8,padding:'8px 12px'}}>⚠️ {uploadError}</div>}
        {uploadSuccess&&<div style={{marginTop:10,fontSize:12,color:'#00dc85',background:'#00dc8511',borderRadius:8,padding:'8px 12px'}}>{uploadSuccess}</div>}
        <div style={{marginTop:10,fontSize:11,color:C.dim}}>{es?'Guarda un Excel histórico sin publicarlo como ruta activa. Luego puedes restaurarlo si lo necesitas.':'Save a historical Excel without publishing it as the active route. You can restore it later if needed.'}</div>
      </div>

      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'12px 14px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={es?'Buscar fecha, tipo, ID...':'Search date, type, ID...'} style={{...inputStyle,flex:1,minWidth:180}}/>
        <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} style={inputStyle}>
          <option value="all">{es?'Todas':'All'}</option>
          <option value="daily">{es?'Snapshots diarios':'Daily snapshots'}</option>
          <option value="permanent">{es?'Versiones guardadas':'Saved versions'}</option>
        </select>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inputStyle}/>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inputStyle}/>
      </div>

      {loading?(
        <div style={{textAlign:'center',padding:'40px',color:C.dim}}>{es?'Cargando...':'Loading...'}</div>
      ):visibleSnapshots.length===0?(
        <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'40px',textAlign:'center',color:C.dim}}>{es?'No hay rutas archivadas con esos filtros.':'No archived routes match those filters.'}</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {visibleSnapshots.map(snap => {
            const pct = snap.job_count>0?Math.round((snap.done_count/snap.job_count)*100):0;
            const dayLabel = snap.date ? new Date(snap.date+'T12:00:00').toLocaleDateString(es?'es-US':'en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric'}) : snap.date;
            const sourceColor = snap._source==='permanent' ? '#9d5fff' : '#00b8f5';
            return (
              <button key={`${snap._source}-${snap.id}`} onClick={()=>loadSnapshot(snap)} style={{background:C.card,border:'1px solid #162e58',borderRadius:12,padding:'14px 16px',cursor:'pointer',textAlign:'left',width:'100%'}} onMouseEnter={e=>(e.currentTarget.style.borderColor='#00b8f544')} onMouseLeave={e=>(e.currentTarget.style.borderColor='#162e58')}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,fontWeight:900,color:C.text,marginBottom:4,textTransform:'capitalize'}}>{dayLabel}</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:10,color:sourceColor,fontWeight:900}}>{snap._source==='permanent'?(es?'VERSIÓN GUARDADA':'SAVED VERSION'):(es?'SNAPSHOT DIARIO':'DAILY SNAPSHOT')}</span>
                      <span style={{fontSize:11,color:C.dim}}>📋 {snap.job_count} {es?'trabajos':'jobs'}</span>
                      <span style={{fontSize:11,color:'#00dc85'}}>✅ {snap.done_count}</span>
                      <span style={{fontSize:11,color:'#ff3348'}}>❌ {snap.notdone_count ?? (snap.job_count-snap.done_count)}</span>
                      <span style={{fontSize:11,color:C.dim}}>🕒 {snap.saved_at ? new Date(snap.saved_at).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:'#00dc85'}}>${(Number(snap.total_earned)||0).toFixed(0)}</div>
                    <div style={{fontSize:11,color:C.dim,marginTop:2}}>{pct}% {es?'completado':'done'}</div>
                  </div>
                </div>
                <div style={{height:4,background:'#162e58',borderRadius:99,marginTop:10,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:'linear-gradient(90deg,#00dc85,#00b8f5)',borderRadius:99,transition:'width 0.4s'}}/></div>
              </button>
            );
          })}
        </div>
      )}
      <style>{`@media(max-width:780px){.route-archive-grid{grid-template-columns:repeat(2,minmax(120px,1fr))!important}}`}</style>
    </div>
  );
}

export { RouteArchive };
