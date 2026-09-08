// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG } from '../../../config/constants';
import { JOB_NOTES_ES, JOB_NOTES_EN } from '../../../config/regions';
import { NOTE_TYPES, PAY_CODES, REASONS_LIST, getTechName } from '../../../legacy/data';
import { compressImage, downloadPhotosZip } from '../../../services/photos.service';
import { generateEODPDF, generateJobPDF } from '../../../legacy/reporting';
import { InlineTechPhotoManager } from './InlineTechPhotoManager';
import { isRecoverableReason } from '../../../services/customerRecovery.service';
import { getPhotoQueueSummaryForJob, onPhotoQueueChange, syncPhotoUploadQueue } from '../../../offline/photoUploadQueue';
import { enqueuePendingClose, getPendingCloseQueueForJob, onPendingCloseQueueChange } from '../../../offline/pendingCloseQueue';

/* ── TECH JOB CARD — v4 ── */

function TechJobCard({job,notes,onMarkDone,onMarkNotDone,onReopen,onNotifyCustomer,onMarkCustomerSmsSent,onRecordCustomerReply,index,techId,t,lang,allPhotos}){
  const[expanded,setExpanded]=useState(false);
  const[mode,setMode]=useState(null);
  const[selectedCodes,setSelectedCodes]=useState([]);
  const[ftValues,setFtValues]=useState({SQFT:'',CRUCE:''});
  const[reason,setReason]=useState('');
  const[cancelNote,setCancelNote]=useState('');
  const[jobNote,setJobNote]=useState('');
  const[saving,setSaving]=useState(false);
  const[showPhotoManager,setShowPhotoManager]=useState(false);
  const[photoQueue,setPhotoQueue]=useState({total:0,before:0,after:0,uploading:0,failed:0,pending:0});
  const[pendingClose,setPendingClose]=useState(null);
  useEffect(()=>{
    let active=true;
    const loadQueue=()=>getPhotoQueueSummaryForJob(job).then(summary=>{if(active)setPhotoQueue(summary);}).catch(()=>{});
    loadQueue();
    const cleanup=onPhotoQueueChange(loadQueue);
    return()=>{active=false;cleanup();};
  },[job.id,job.job_id]);

  useEffect(()=>{
    let active=true;
    const loadPendingClose=()=>getPendingCloseQueueForJob(job).then(rows=>{if(active)setPendingClose(rows[0]||null);}).catch(()=>{});
    loadPendingClose();
    const cleanup=onPendingCloseQueueChange(loadPendingClose);
    return()=>{active=false;cleanup();};
  },[job.id,job.job_id]);

  const jobPhotos=(allPhotos||[]).filter(p=>p.route_id===job.id || String(p.job_id||'')===String(job.job_id||''));
  const beforePhotos=jobPhotos.filter(p=>p.photo_type==='evidence'||p.photo_type==='before'||!p.photo_type);
  const afterPhotos=jobPhotos.filter(p=>p.photo_type==='pht'||p.photo_type==='after');
  const pendingPhotoUploads=photoQueue.total>0;
  const effectiveBefore=beforePhotos.length+photoQueue.before;
  const effectiveAfter=afterPhotos.length+photoQueue.after;
  const photoChecklistOk=beforePhotos.length>0&&afterPhotos.length>0;
  const localPhotoChecklistOk=effectiveBefore>0&&effectiveAfter>0;
  const es=(lang||'es')==='es';
  const isDone=job.status==='done';
  const isNotDone=job.status==='notdone';
  const isPending=job.status==='pending';
  const isRecoverable=isNotDone&&isRecoverableReason(job.reason);
  const statusColor=isDone?C.green:isNotDone?C.red:'#ffbe00'; // V25.7: pending=yellow, done=green, notdone=red
  const PRESET_NOTES=es?JOB_NOTES_ES:JOB_NOTES_EN;

  const openMaps=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address+', '+(job.city||''))}`, '_blank');
  const callClient=()=>{if(job.phone)window.open(`tel:${job.phone.replace(/\D/g,'')}`, '_self');};
  const sendOnMyWay=()=>{
    if(!job.phone)return;
    const phone=job.phone.replace(/\D/g,'');
    window.open(`sms:${phone}?body=${encodeURIComponent(SMS_MSG)}`,'_self');
  };

  const toggleCode=(code)=>{
    setSelectedCodes(prev=>{
      if(prev.includes(code)) return prev.filter(c=>c!==code);
      if(prev.length>=3) return prev;
      return [...prev,code];
    });
  };
  const buildPayStr=()=>selectedCodes.map(c=>{
    const pc=PAY_CODES.find(p=>p.code===c);
    if(pc?.needsFt&&ftValues[c]) return `${c}(${ftValues[c]}${pc.unit})`;
    return c;
  }).join('+');
  const calcTotal=()=>selectedCodes.reduce((sum,c)=>{
    const pc=PAY_CODES.find(p=>p.code===c);
    return sum+(pc?.total||0);
  },0);
  const canConfirm=selectedCodes.length>0&&selectedCodes.every(c=>{
    const pc=PAY_CODES.find(p=>p.code===c);
    return !pc?.needsFt||ftValues[c];
  });
  const queueDoneClose=async()=>{
    await enqueuePendingClose({
      route_id:String(job.id), tech_id:String(techId), job_id:String(job.job_id||''), region:job.region||'',
      action:'done', pay_code:buildPayStr(), pay_total:calcTotal(), job_note:jobNote||'',
      client_updated_at:String(job.updated_at||job.modified_at||job.created_at||'')
    });
    alert(es
      ? '✅ Trabajo marcado como Pending Close. Cuando las fotos suban y vuelva la señal, la app lo cerrará automáticamente.'
      : '✅ Job marked Pending Close. When photos upload and signal returns, the app will close it automatically.');
    setMode(null);setSelectedCodes([]);setFtValues({SQFT:'',CRUCE:''});setJobNote('');
  };

  const confirmDone=async()=>{
    if(!canConfirm)return;
    let closeBefore=beforePhotos.length;
    let closeAfter=afterPhotos.length;
    if(!navigator.onLine){
      const queue=window.confirm(es
        ? 'No hay internet. ¿Guardar este cierre como Pending Close para que se complete solo cuando vuelva la señal?'
        : 'No internet. Save this as Pending Close so it completes automatically when signal returns?');
      if(queue) await queueDoneClose();
      return;
    }
    if(pendingPhotoUploads){
      const queue=window.confirm(es
        ? `Este trabajo tiene ${photoQueue.total} foto(s) guardadas en el teléfono pendientes de subir. ¿Dejarlo como Pending Close para que se cierre automáticamente cuando suban?`
        : `This job has ${photoQueue.total} photo(s) saved on the phone waiting to upload. Queue Pending Close so it closes automatically after upload?`);
      if(queue){ await queueDoneClose(); return; }
      const trySync=window.confirm(es
        ? '¿Intentar sincronizar ahora?'
        : 'Try syncing now?');
      if(trySync){
        await syncPhotoUploadQueue();
        const fresh=await getPhotoQueueSummaryForJob(job);
        setPhotoQueue(fresh);
        if(fresh.total>0){
          alert(es?'Todavía quedan fotos pendientes. Puedes dejarlo en Pending Close o probar Sync now cuando mejore la señal.':'Photos are still pending. You can queue Pending Close or try Sync now when signal improves.');
          return;
        }
        const {data}=await sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_type').eq('route_id',job.id);
        const freshPhotos=data||[];
        closeBefore=freshPhotos.filter(p=>p.photo_type==='evidence'||p.photo_type==='before'||!p.photo_type).length;
        closeAfter=freshPhotos.filter(p=>p.photo_type==='pht'||p.photo_type==='after').length;
        window.dispatchEvent(new CustomEvent('gfs-photo-queue-updated'));
      }else return;
    }
    const closePhotoOk=closeBefore>0&&closeAfter>0;
    if(!closePhotoOk){
      const proceed=window.confirm(es
        ? `Este trabajo no tiene fotos completas subidas a Supabase. BEFORE: ${closeBefore}, AFTER: ${closeAfter}. ¿Quieres completarlo de todas formas?`
        : `This job does not have a complete photo set uploaded to Supabase. BEFORE: ${closeBefore}, AFTER: ${closeAfter}. Complete anyway?`);
      if(!proceed)return;
    }
    setSaving(true);
    await onMarkDone(job.id, buildPayStr(), calcTotal(), jobNote, {before:closeBefore, after:closeAfter, override:!closePhotoOk});
    setSaving(false);setMode(null);setSelectedCodes([]);setFtValues({SQFT:'',CRUCE:''});setJobNote('');
  };
  const queueNotDoneClose=async()=>{
    const fullReason=cancelNote.trim()?`${reason} — ${cancelNote.trim()}`:reason;
    await enqueuePendingClose({
      route_id:String(job.id), tech_id:String(techId), job_id:String(job.job_id||''), region:job.region||'',
      action:'notdone', reason:fullReason, job_note:jobNote||'',
      client_updated_at:String(job.updated_at||job.modified_at||job.created_at||'')
    });
    alert(es
      ? '✅ Not Done guardado como Pending Close. Cuando las fotos suban y vuelva la señal, la app lo guardará automáticamente.'
      : '✅ Not Done saved as Pending Close. When photos upload and signal returns, the app will save it automatically.');
    setMode(null);setReason('');setCancelNote('');setJobNote('');
  };

  const confirmNotDone=async()=>{
    if(!reason||!cancelNote.trim())return;
    if(!navigator.onLine){
      const queue=window.confirm(es
        ? 'No hay internet. ¿Guardar este Not Done como Pending Close para enviarlo cuando vuelva la señal?'
        : 'No internet. Save this Not Done as Pending Close so it sends when signal returns?');
      if(queue) await queueNotDoneClose();
      return;
    }
    if(pendingPhotoUploads){
      const queue=window.confirm(es
        ? `Este Not Done tiene ${photoQueue.total} foto(s) pendientes de subir. ¿Dejarlo como Pending Close para que se guarde automáticamente cuando suban?`
        : `This Not Done has ${photoQueue.total} photo(s) waiting to upload. Queue Pending Close so it saves automatically after upload?`);
      if(queue){ await queueNotDoneClose(); return; }
      const trySync=window.confirm(es
        ? '¿Intentar sincronizar antes de guardar?'
        : 'Try syncing before saving?');
      if(trySync){
        await syncPhotoUploadQueue();
        const fresh=await getPhotoQueueSummaryForJob(job);
        setPhotoQueue(fresh);
        if(fresh.total>0){
          alert(es?'Todavía quedan fotos pendientes. Puedes dejarlo en Pending Close o probar Sync now cuando mejore la señal.':'Photos are still pending. You can queue Pending Close or try Sync now when signal improves.');
          return;
        }
      }else return;
    }
    if(jobPhotos.length===0){
      const proceed=window.confirm(es
        ? 'Este Not Done no tiene ninguna foto. ¿Quieres guardarlo de todas formas?'
        : 'This Not Done has no photos. Save it anyway?');
      if(!proceed)return;
    }
    setSaving(true);
    const fullReason=cancelNote.trim()?`${reason} — ${cancelNote.trim()}`:reason;
    await onMarkNotDone(job.id,fullReason,jobNote,{before:beforePhotos.length, after:afterPhotos.length, total:jobPhotos.length, override:jobPhotos.length===0});
    setSaving(false);setMode(null);setReason('');setCancelNote('');setJobNote('');
  };

  // Note selector panel (used in both done and not-done)
  const notePanel=(
    <div style={{marginBottom:10}}>
      <div style={{fontSize:11,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
        📝 {es?'Nota del trabajo (opcional)':'Job note (optional)'}
      </div>
      {/* Predefined notes */}
      <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
        {PRESET_NOTES.map((n,i)=>(
          <button key={i} onClick={()=>setJobNote(jobNote===n?'':n)}
            style={{background:jobNote===n?"#00b8f522":"#0a1428",border:`1px solid ${jobNote===n?"#00b8f5":"#162e58"}`,borderRadius:8,padding:"7px 10px",cursor:"pointer",textAlign:"left",fontSize:11,color:jobNote===n?"#00b8f5":C.text,fontWeight:jobNote===n?700:400,lineHeight:1.3}}>
            {n}
          </button>
        ))}
      </div>
      {/* Custom note */}
      <textarea
        placeholder={es?'O escribe tu propia nota...':'Or write your own note...'}
        value={PRESET_NOTES.includes(jobNote)?'':jobNote}
        onChange={e=>setJobNote(e.target.value)}
        style={{width:"100%",boxSizing:"border-box",background:"#0a1428",border:"1px solid #162e58",borderRadius:8,padding:"8px 10px",color:C.text,fontSize:11,fontFamily:"'Barlow',sans-serif",outline:"none",minHeight:44,resize:"vertical"}}
      />
    </div>
  );

  return(
    <div style={{background:C.card,border:`1px solid ${isDone?"#00dc8544":isNotDone?"#ff334844":expanded?"#00b8f544":"#162e58"}`,borderLeft:`5px solid ${statusColor}`,borderRadius:12,marginBottom:10,overflow:"hidden",transition:"border-color .2s",opacity:isDone?0.82:isNotDone?0.82:1}}>
      {/* Tappable header */}
      <div onClick={()=>setExpanded(v=>!v)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"flex-start",gap:10,userSelect:"none"}}>
        <div style={{width:28,height:28,borderRadius:"50%",background:`${statusColor}22`,border:`2px solid ${statusColor}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:statusColor,fontSize:13,flexShrink:0}}>{index}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:800,color:C.accent}}>#{job.job_id}</span>
            <span style={{background:job.type?.includes("FIBER")?"#9d5fff22":"#00b8f522",border:`1px solid ${job.type?.includes("FIBER")?"#9d5fff66":"#00b8f566"}`,borderRadius:20,padding:"1px 7px",fontSize:10,color:job.type?.includes("FIBER")?C.purple:C.accent,fontWeight:700}}>{job.type?.includes("FIBER")?"FIBER":"COAX"}</span>
            {!isPending&&<span style={{background:`${statusColor}22`,border:`1px solid ${statusColor}66`,borderRadius:20,padding:"1px 7px",fontSize:10,color:statusColor,fontWeight:700}}>{isDone?`✅ ${job.pay_code}`:"❌ "+job.reason?.substring(0,22)}</span>}
            {jobPhotos.length>0&&<span style={{background:"#9d5fff22",border:"1px solid #9d5fff44",borderRadius:20,padding:"1px 7px",fontSize:10,color:C.purple,fontWeight:700}}>📷 {jobPhotos.length}</span>}
            {photoQueue.total>0&&<span style={{background:"#ffbe0022",border:"1px solid #ffbe0066",borderRadius:20,padding:"1px 7px",fontSize:10,color:"#ffbe00",fontWeight:800}}>⏳ {photoQueue.total}</span>}
            {pendingClose&&<span style={{background:"#00b8f522",border:"1px solid #00b8f566",borderRadius:20,padding:"1px 7px",fontSize:10,color:C.accent,fontWeight:900}}>⏱ Pending Close</span>}
            {job.is_duplicate&&<span style={{background:"#ff8c0022",border:"1px solid #ff8c0088",borderRadius:20,padding:"1px 7px",fontSize:10,color:"#ff8c00",fontWeight:700}}>⚠️ {es?'Dir. repetida':'Repeat addr'}</span>}
          </div>
          <div style={{fontSize:13,color:C.text,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{job.address}</div>
          {job.city&&<div style={{fontSize:11,color:C.dim}}>{job.city}</div>}
          {job.phone&&<div style={{fontSize:11,color:C.dim,marginTop:1}}>📞 {job.phone}</div>}
          {job.job_note&&<div style={{fontSize:10,color:"#00b8f5",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📝 {job.job_note}</div>}
        </div>
        <div style={{color:C.dim,fontSize:18,lineHeight:1,flexShrink:0,marginTop:4,transition:"transform .2s",transform:expanded?"rotate(180deg)":"rotate(0deg)"}}>⌄</div>
      </div>

      {/* Expandable body */}
      {expanded&&(
        <div style={{padding:"0 16px 16px",borderTop:"1px solid #162e5844"}}>
          {/* Supervisor notes */}
          {notes.filter(n=>!n.tech_id||n.tech_id===job.tech_id).map(n=>{
            const nt=NOTE_TYPES[n.type]||NOTE_TYPES.recommendation;
            return(
              <div key={n.id} style={{background:nt.bg,border:`1px solid ${nt.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8,marginTop:8,display:"flex",gap:8}}>
                <span style={{fontSize:16,flexShrink:0}}>{nt.icon}</span>
                <div>
                  <div style={{fontSize:10,color:nt.color,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:2}}>{nt.label}</div>
                  <div style={{fontSize:12,color:C.text,lineHeight:1.4}}>{n.content}</div>
                </div>
              </div>
            );
          })}

          {/* Map link */}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address+(job.city?', '+job.city:''))}`}
            target="_blank" rel="noopener noreferrer"
            style={{marginTop:10,marginBottom:8,borderRadius:8,overflow:"hidden",border:"1px solid #1e3a6a",height:52,background:"linear-gradient(135deg,#0a1e40,#0d2550)",display:"flex",alignItems:"center",gap:12,padding:"0 14px",textDecoration:"none",cursor:"pointer"}}>
            <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#003580,#00b8f5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📍</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:"#7eb8f7",fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{job.address}</div>
              {job.city&&<div style={{fontSize:10,color:"#4a7aaa",marginTop:1}}>{job.city}</div>}
            </div>
            <div style={{fontSize:11,color:"#00b8f5",fontWeight:700,flexShrink:0,display:"flex",alignItems:"center",gap:4}}><span>🗺️</span><span>Maps</span></div>
          </a>

          <div style={{marginTop:8,marginBottom:8,display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <div style={{background:effectiveBefore?'#ffbe0022':'#ff334822',border:`1px solid ${effectiveBefore?'#ffbe0066':'#ff334866'}`,borderRadius:8,padding:'7px 9px',fontSize:10,color:effectiveBefore?'#ffcf55':'#ff6677',fontWeight:900,textAlign:'center'}}>B {beforePhotos.length}{photoQueue.before>0?` + ⏳${photoQueue.before}`:''}</div>
            <div style={{background:effectiveAfter?'#00dc8522':'#ff334822',border:`1px solid ${effectiveAfter?'#00dc8566':'#ff334866'}`,borderRadius:8,padding:'7px 9px',fontSize:10,color:effectiveAfter?'#00dc85':'#ff6677',fontWeight:900,textAlign:'center'}}>A {afterPhotos.length}{photoQueue.after>0?` + ⏳${photoQueue.after}`:''}</div>
          </div>
          {pendingClose&&<div style={{background:'#00b8f514',border:'1px solid #00b8f544',borderRadius:9,padding:'8px 10px',fontSize:11,color:'#9be8ff',lineHeight:1.45,marginBottom:8}}>
            ⏱ {es?'Pending Close activo: la app cerrará este trabajo automáticamente cuando las fotos estén sincronizadas y haya internet.':'Pending Close active: the app will close this job automatically when photos are synced and internet is available.'}
          </div>}

          {isPending&&(
            <>
              {/* Action row 1 */}
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <button onClick={e=>{e.stopPropagation();openMaps();}} style={{flex:1,background:"#00b8f518",border:"1px solid #00b8f544",borderRadius:8,padding:"9px 4px",color:C.accent,fontWeight:700,cursor:"pointer",fontSize:11,textAlign:"center"}}>{t.directionsBtn}</button>
                {job.phone&&<button onClick={e=>{e.stopPropagation();callClient();}} style={{flex:1,background:"#00dc8518",border:"1px solid #00dc8544",borderRadius:8,padding:"9px 4px",color:C.green,fontWeight:700,cursor:"pointer",fontSize:11,textAlign:"center"}}>{t.callBtn}</button>}
                {job.phone&&<button onClick={e=>{e.stopPropagation();sendOnMyWay();}} style={{flex:1,background:"#9d5fff22",border:"1px solid #9d5fff44",borderRadius:8,padding:"9px 4px",color:"#9d5fff",fontWeight:700,cursor:"pointer",fontSize:11,textAlign:"center"}}>📱 SMS</button>}
              </div>
              {/* Action row 2 — done / not done */}
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <button onClick={e=>{e.stopPropagation();setMode(mode==='pay'?null:'pay');}} style={{flex:1,background:mode==='pay'?"#00dc85":"#00dc8522",border:"2px solid #00dc85",borderRadius:8,padding:"9px 4px",color:mode==='pay'?"#04091c":C.green,fontWeight:800,cursor:"pointer",fontSize:11,textAlign:"center"}}>{t.markDoneBtn}</button>
                <button onClick={e=>{e.stopPropagation();setMode(mode==='reason'?null:'reason');}} style={{flex:1,background:mode==='reason'?"#ff3348":"#ff334822",border:"2px solid #ff3348",borderRadius:8,padding:"9px 4px",color:mode==='reason'?"#fff":C.red,fontWeight:800,cursor:"pointer",fontSize:11,textAlign:"center"}}>{t.markNotDoneBtn}</button>
              </div>
              {/* Photo buttons — ANTES / DESPUÉS */}
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <button onClick={e=>{e.stopPropagation();setShowPhotoManager(v=>!v);}}
                  style={{flex:1,background:showPhotoManager?"#9d5fff":"#9d5fff22",border:"1px solid #9d5fff66",borderRadius:8,padding:"9px 8px",color:showPhotoManager?"#fff":"#9d5fff",fontWeight:700,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                  <span>📷</span><span>{es?`Fotos${jobPhotos.length>0||photoQueue.total>0?` (${jobPhotos.length}${photoQueue.total>0?` + ⏳${photoQueue.total}`:''})`:''}`:`Photos${jobPhotos.length>0||photoQueue.total>0?` (${jobPhotos.length}${photoQueue.total>0?` + ⏳${photoQueue.total}`:''})`:''}`}</span>
                </button>
                <button onClick={e=>{e.stopPropagation();sb.from('job_photos').select('*').eq('route_id',job.id).then(({data})=>generateJobPDF(job,data||[],getTechName(techId),lang||'es',null));}}
                  style={{flex:1,background:"#ff5a1f22",border:"1px solid #ff5a1f66",borderRadius:8,padding:"9px 6px",color:C.orange,fontWeight:700,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                  <span style={{fontSize:14}}>⎙</span><span>PDF</span>
                </button>
              </div>
              {showPhotoManager&&<InlineTechPhotoManager job={job} techId={techId} t={t} lang={lang||'es'}/>}

              {/* ── PAY MODE ── */}
              {mode==='pay'&&(
                <div style={{marginTop:10,background:C.card2,borderRadius:12,padding:"14px",border:"1px solid #162e58"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontSize:11,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>{t.payCodeLabel} <span style={{color:C.yellow}}>(máx 3)</span></div>
                    {selectedCodes.length>0&&<div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:900,color:C.green}}>{buildPayStr()}</div>}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                    {PAY_CODES.map(p=>{
                      const sel=selectedCodes.includes(p.code);
                      const disabled=!sel&&selectedCodes.length>=3;
                      return(
                        <div key={p.code}>
                          <button onClick={()=>!disabled&&toggleCode(p.code)}
                            style={{width:"100%",background:sel?"#00b8f522":disabled?"#0a1528":C.card,border:`1.5px solid ${sel?C.accent:disabled?C.muted:C.border}`,borderRadius:8,padding:"8px",cursor:disabled?"default":"pointer",textAlign:"left",opacity:disabled?0.4:1,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div>
                              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:800,color:sel?C.accent:C.text}}>{p.code}</div>
                              <div style={{fontSize:10,color:C.dim,lineHeight:1.3,marginTop:2}}>{p.label.split('—')[1]?.trim()||p.label}</div>
                              {p.needsFt&&<div style={{fontSize:9,color:C.yellow,marginTop:2}}>📏 {lang==='es'?'Ingresa medida':'Enter measurement'}</div>}
                            </div>
                            {sel&&<span style={{fontSize:14,color:C.green}}>✓</span>}
                          </button>
                          {sel&&p.needsFt&&(
                            <input type="number" min="0"
                              placeholder={p.unit==='sqft'?'Sqft...':'Pies (ft)...'}
                              value={ftValues[p.code]||''}
                              onChange={e=>setFtValues(v=>({...v,[p.code]:e.target.value}))}
                              style={{width:"100%",boxSizing:"border-box",marginTop:4,background:C.card,border:`1px solid ${C.accent}`,borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13,fontFamily:"'Barlow',sans-serif",outline:"none"}}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Job note selector */}
                  {notePanel}
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={confirmDone} disabled={!canConfirm||saving}
                      style={{flex:1,background:canConfirm?C.green:C.muted,border:"none",borderRadius:8,padding:"11px",color:canConfirm?"#04091c":C.dim,fontWeight:700,cursor:canConfirm?"pointer":"default",fontSize:13}}>
                      {saving?t.savingLabel:t.confirmBtn}
                    </button>
                    <button onClick={()=>{setMode(null);setSelectedCodes([]);setFtValues({SQFT:'',CRUCE:''});setJobNote('');}} style={{background:"none",border:"1px solid #162e58",borderRadius:8,padding:"11px 14px",color:C.dim,cursor:"pointer"}}>✕</button>
                  </div>
                </div>
              )}

              {/* ── REASON MODE ── */}
              {mode==='reason'&&(
                <div style={{marginTop:10,background:C.card2,borderRadius:12,padding:"14px",border:"1px solid #162e58"}}>
                  <div style={{fontSize:11,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{t.reasonLabel}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:10}}>
                    {REASONS_LIST.map(r=>(
                      <button key={r.id} onClick={()=>setReason(r.label)}
                        style={{background:reason===r.label?`${r.color}28`:C.card,border:`1.5px solid ${reason===r.label?r.color:C.border}`,borderRadius:8,padding:"7px 8px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14}}>{r.emoji}</span>
                        <span style={{fontSize:11,color:reason===r.label?r.color:C.text,fontWeight:reason===r.label?700:400,lineHeight:1.2}}>{r.label}</span>
                      </button>
                    ))}
                  </div>
                  {reason&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:11,color:C.red,marginBottom:5,fontWeight:700}}>{lang==='es'?'¿Por qué no pudiste realizar el trabajo? (obligatorio):':"Why couldn't you complete the job? (required):"}</div>
                      <textarea placeholder={lang==='es'?'Explica el motivo...':'Explain the reason...'}
                        value={cancelNote} onChange={e=>setCancelNote(e.target.value)}
                        style={{width:"100%",boxSizing:"border-box",background:"#0a1428",border:`1px solid ${cancelNote.trim()?"#00b8f544":"#ff334888"}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"'Barlow',sans-serif",outline:"none",minHeight:80,resize:"vertical"}}/>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={confirmNotDone} disabled={!reason||!cancelNote.trim()||saving}
                      style={{flex:1,background:(reason&&cancelNote.trim())?C.red:C.muted,border:"none",borderRadius:8,padding:"11px",color:(reason&&cancelNote.trim())?"#fff":C.dim,fontWeight:700,cursor:(reason&&cancelNote.trim())?"pointer":"default",fontSize:13}}>
                      {saving?t.savingLabel:t.confirmBtn}
                    </button>
                    <button onClick={()=>{setMode(null);setReason('');setCancelNote('');setJobNote('');}} style={{background:"none",border:"1px solid #162e58",borderRadius:8,padding:"11px 14px",color:C.dim,cursor:"pointer"}}>✕</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Done / Not done: photos + export */}
          {(isDone||isNotDone)&&(
            <>
              <div style={{marginTop:8,background:isNotDone?'#ffbe0014':'#00b8f514',border:`1px solid ${isNotDone?'#ffbe0044':'#00b8f544'}`,borderRadius:9,padding:'9px 10px',fontSize:11,color:C.text,lineHeight:1.45}}>
                {isNotDone
                  ? (es?'Si regresaste y ahora puedes completar el trabajo, reábrelo para cambiar el resultado y añadir el billing code.':'If you returned and can now complete the job, reopen it to change the outcome and add the billing code.')
                  : (es?'Puedes reabrir este trabajo para corregir el billing code, las notas o el resultado.':'You can reopen this job to correct the billing code, notes or outcome.')}
              </div>
              <button onClick={async e=>{e.stopPropagation();if(onReopen)await onReopen(job.id);setMode(null);setExpanded(true);}}
                style={{width:'100%',marginTop:8,background:'#ffbe0022',border:'1px solid #ffbe00',borderRadius:8,padding:'10px 8px',color:'#ffbe00',fontWeight:800,cursor:'pointer',fontSize:12}}>
                ↩️ {es?'Reabrir / Editar resultado':'Reopen / Edit result'}
              </button>
              {isRecoverable&&job.phone&&<>
                <div style={{marginTop:8,background:'#00b8f512',border:'1px solid #00b8f544',borderRadius:9,padding:'9px 10px',fontSize:10,color:C.dim,lineHeight:1.45}}>
                  {es
                    ? 'El SMS se abrirá en la aplicación de mensajes del teléfono y usará el plan móvil del técnico. La app no puede verificar el envío automáticamente.'
                    : 'The SMS opens in the phone messaging app and uses the technician mobile plan. The app cannot verify delivery automatically.'}
                </div>
                <button onClick={async e=>{e.stopPropagation();if(onNotifyCustomer)await onNotifyCustomer(job,job.reason,true);}}
                  style={{width:'100%',marginTop:8,background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'10px 8px',color:'#00b8f5',fontWeight:800,cursor:'pointer',fontSize:12}}>
                  📲 {es?'Abrir SMS al cliente':'Open customer SMS'}
                </button>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginTop:6}}>
                  <button onClick={async e=>{e.stopPropagation();if(onMarkCustomerSmsSent)await onMarkCustomerSmsSent(job);}}
                    style={{background:'#00dc8522',border:'1px solid #00dc85',borderRadius:8,padding:'9px 7px',color:'#00dc85',fontWeight:800,cursor:'pointer',fontSize:10}}>
                    ✅ {es?'Marcar SMS enviado':'Mark SMS sent'}
                  </button>
                  <button onClick={async e=>{e.stopPropagation();if(onRecordCustomerReply)await onRecordCustomerReply(job);}}
                    style={{background:'#9d5fff22',border:'1px solid #9d5fff',borderRadius:8,padding:'9px 7px',color:'#c39dff',fontWeight:800,cursor:'pointer',fontSize:10}}>
                    💬 {es?'Registrar respuesta':'Record reply'}
                  </button>
                </div>
              </>}
              <div style={{marginTop:8,display:"flex",gap:6}}>
                <button onClick={e=>{e.stopPropagation();setShowPhotoManager(v=>!v);}}
                  style={{flex:2,background:showPhotoManager?"#9d5fff":"#9d5fff22",border:"1px solid #9d5fff66",borderRadius:8,padding:"9px 8px",color:showPhotoManager?"#fff":"#9d5fff",fontWeight:700,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                  <span>📷</span><span>{lang==='es'?`Fotos${jobPhotos.length>0?` (${jobPhotos.length})`:''}`:`Photos${jobPhotos.length>0?` (${jobPhotos.length})`:''}`}</span>
                </button>
                <button onClick={e=>{e.stopPropagation();sb.from('job_photos').select('*').eq('route_id',job.id).then(({data})=>generateJobPDF(job,data||[],getTechName(techId),lang||'es',null));}}
                  style={{flex:1,background:"#ff5a1f22",border:"1px solid #ff5a1f66",borderRadius:8,padding:"9px 6px",color:C.orange,fontWeight:700,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                  <span style={{fontSize:14}}>⎙</span><span>PDF</span>
                </button>
              </div>
              {showPhotoManager&&<InlineTechPhotoManager job={job} techId={techId} t={t} lang={lang||'es'}/>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { TechJobCard };
