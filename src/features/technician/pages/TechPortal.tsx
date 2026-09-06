// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb, SUPABASE_CONFIGURED } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG, isFieldTrackingWindow } from '../../../config/constants';
import { NOTE_TYPES, REASONS_LIST, T } from '../../../legacy/data';
import { useHashTab } from '../../../legacy/routing';
import { useInactivityTimer } from '../../../legacy/hooks';
import { LangToggle, SessionWarning, Toast } from '../../../legacy/ui';
import { generateEODPDF, generateRouteExcel } from '../../../legacy/reporting';
import { saveGpsConsent } from '../services/gpsConsent';
import { EndOfDayReport, GpsConsentModal, TechHistorySearch, TechJobCard } from '../components/TechnicianComponents';
import { PendingJobReminder } from '../components/PendingJobReminder';
import { PushGate } from '../components/PushGate';
import { getNotificationPermission, isPushSupported } from '../../../services/push.service';
import { WeatherLivePanel } from '../../../shared/components/WeatherLivePanel';
import { notifyWithSound } from '../../../services/notification.service';
import { createAuditLog } from '../../../services/audit.service';
import {
  isRecoverableReason,
  markManualDraftOpened,
  markManualSmsSent,
  openCustomerSms,
  queueCustomerRecovery,
  recordManualCustomerReply,
} from '../../../services/customerRecovery.service';
import AppErrorBoundary from '../../../shared/components/AppErrorBoundary';
import { changeOwnTechnicianPin } from '../../../services/security.service';
import { addOrRefreshNotDonePool, resolveNotDonePool } from '../../../services/notDonePool.service';
import { getPendingPhotoQueueItems, getPhotoQueueSummaryForJob, onPhotoQueueChange, syncPhotoUploadQueue } from '../../../offline/photoUploadQueue';
import { deletePendingCloseQueueItem, getPendingCloseQueueForTech, markPendingCloseConflict, markPendingCloseFailed, markPendingCloseProcessing, onPendingCloseQueueChange } from '../../../offline/pendingCloseQueue';

/* ── TECH PORTAL v4 — auto-reorder, no earnings, combined SMS ── */
function TechPortal({tech,onLogout,onSessionExpired,lang,setLang}){
  const t=T[lang]||T.en;
  const[jobs,setJobs]=useState([]);
  const[techPhotos,setTechPhotos]=useState([]);
  const[notes,setNotes]=useState([]);
  const[loading,setLoading]=useState(true);
  const[loadError,setLoadError]=useState('');
  const[toast,setToast]=useState(null);
  const[activeSection,setActiveSection]=useHashTab('tech', String(tech.id), 'route').slice(0,2) as [string,(t:string)=>void];
  const[reportForm,setReportForm]=useState({job:'',address:'',reason:'',notes:''});
  const[reportSubmitted,setReportSubmitted]=useState(false);
  const[techNoteText,setTechNoteText]=useState('');
  const[techNoteSending,setTechNoteSending]=useState(false);
  const[techNotesSent,setTechNotesSent]=useState<any[]>([]);
  const[showEOD,setShowEOD]=useState(false);
  const[isOnline,setIsOnline]=useState(navigator.onLine);
  const[pushPermission,setPushPermission]=useState(()=>getNotificationPermission());
  const[showBulkSms,setShowBulkSms]=useState(false);
  const[showGpsConsent,setShowGpsConsent]=useState(false);
  const[showPinChange,setShowPinChange]=useState(false);
  const[pinForm,setPinForm]=useState({current:'',next:'',confirm:''});
  const[pinChanging,setPinChanging]=useState(false);
  const[pinError,setPinError]=useState('');
  const[pinSuccess,setPinSuccess]=useState('');
  const[reordering,setReordering]=useState(false);
  const[routePaused,setRoutePaused]=useState(()=>localStorage.getItem(`gfs_route_paused_${tech.id}`)==='1');
  const[photoQueueCount,setPhotoQueueCount]=useState(0);
  const[photoQueueSummary,setPhotoQueueSummary]=useState({total:0,pending:0,uploading:0,failed:0});
  const[photoQueueSyncing,setPhotoQueueSyncing]=useState(false);
  const[pendingCloseCount,setPendingCloseCount]=useState(0);
  const[pendingCloseSummary,setPendingCloseSummary]=useState({total:0,pending:0,processing:0,failed:0,conflict:0});
  const[pendingCloseConflict,setPendingCloseConflict]=useState<any>(null);
  const[pendingCloseSyncing,setPendingCloseSyncing]=useState(false);
  const[routeSearch,setRouteSearch]=useState('');
  const[routeStatusFilter,setRouteStatusFilter]=useState('all');
  const[showRouteTools,setShowRouteTools]=useState(false);
  const{secondsLeft:sessLeft,isWarning:sessWarn}=useInactivityTimer(onSessionExpired||onLogout);
  const locInterval=useRef(null);
  const coordsCache=useRef<{[k:string]:{lat:number,lng:number}}>({});
  const jobsRef=useRef<any[]>([]);
  const lastOptimizationRef=useRef<number>(Number(localStorage.getItem(`gfs_last_optimization_${tech.id}`)||0));
  const lastOptimizationPositionRef=useRef<any>(null);
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  // Robust fallback: if toLocaleDateString fails or produces non-ISO format,
  // compute manually from the America/New_York offset.
  const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : (() => {
    const now = new Date();
    // EST/EDT offset: UTC-5 or UTC-4 (EDT during DST). Approximate by using
    // the en-CA locale which is universally supported in modern browsers.
    try {
      return now.toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });
    } catch {
      return now.toISOString().slice(0, 10);
    }
  })();
  const CACHE_KEY=`gfs_jobs_${tech.id}_${todayISO}`;
  const getLocalRouteRegion=()=>tech.region||'miami';
  const getSupervisorRouteDateKey=()=>`gfs_supervisor_route_date_${getLocalRouteRegion()}`;
  const getSupervisorRouteCacheKey=(date=today)=>`gfs_supervisor_routes_${getLocalRouteRegion()}_${date}`;
  const normalizeLocalTechRows=(rows:any[],date=today)=>rows
    .filter((job:any)=>String(job.tech_id)===String(tech.id))
    .map((job:any,index:number)=>({
      ...job,
      id:job.id||`local-${date}-${job.tech_id||tech.id}-${job.job_id||index}`,
      date:job.date||date,
      region:job.region||getLocalRouteRegion(),
      status:job.status||'pending',
      order_num:Number.isFinite(Number(job.order_num))?Number(job.order_num):index+1,
    }))
    .sort((a:any,b:any)=>{
      // V25.7: pending first, then not-done, completed last — but every job
      // stays visible and keeps its original route order within its group.
      const rank=(s:string)=> s==='done'?2 : s==='notdone'?1 : 0; // pending=0
      const ra=rank(a.status), rb=rank(b.status);
      if(ra!==rb) return ra-rb;
      return Number(a.order_num||0)-Number(b.order_num||0);
    });
  const readSupervisorRouteCache=(date=today)=>{
    try{
      const cached=JSON.parse(localStorage.getItem(getSupervisorRouteCacheKey(date))||'null');
      return Array.isArray(cached)?cached:[];
    }catch{return [];}
  };
  const getCandidateRouteDates=()=>{
    const saved=(()=>{try{return localStorage.getItem(getSupervisorRouteDateKey())||'';}catch{return '';}})();
    return [today,saved].filter(Boolean).filter((date,index,arr)=>arr.indexOf(date)===index);
  };
  const loadSupervisorRouteForTech=()=>{
    for(const date of getCandidateRouteDates()){
      const rows=normalizeLocalTechRows(readSupervisorRouteCache(date),date);
      if(rows.length){
        setJobs(rows);setLoading(false);setLoadError('');
        try{localStorage.setItem(CACHE_KEY,JSON.stringify(rows));}catch(e){}
        return true;
      }
    }
    return false;
  };
  const updateLocalTechRouteJob=(id:string,patch:any)=>{
    const current=jobsRef.current.length?jobsRef.current:jobs;
    const target=current.find((job:any)=>String(job.id)===String(id));
    const routeDate=target?.date||today;
    const allRows=readSupervisorRouteCache(routeDate);
    const nextAll=allRows.map((job:any)=>String(job.id)===String(id)?{...job,...patch,updated_at:new Date().toISOString()}:job);
    try{localStorage.setItem(getSupervisorRouteCacheKey(routeDate),JSON.stringify(nextAll));}catch(e){}
    const nextTechRows=normalizeLocalTechRows(nextAll,routeDate);
    setJobs(nextTechRows);jobsRef.current=nextTechRows;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(nextTechRows));}catch(e){}
    return {job:target,nextTechRows,routeDate};
  };
  const showT=(m)=>{setToast(m);setTimeout(()=>setToast(null),3500);};
  const requireOnlineAction=(actionLabel)=>{
    if(!SUPABASE_CONFIGURED) return true;
    if(navigator.onLine) return true;
    showT(lang==='es'
      ? `📶 Sin conexión. ${actionLabel} se debe hacer cuando vuelva el internet.`
      : `📶 Offline. ${actionLabel} must be done when internet is back.`);
    return false;
  };
  const refreshPhotoQueueCount=useCallback(async()=>{
    try{
      const items=(await getPendingPhotoQueueItems()).filter(i=>String(i.tech_id)===String(tech.id));
      const summary={
        total:items.length,
        pending:items.filter(i=>i.status==='pending').length,
        uploading:items.filter(i=>i.status==='uploading').length,
        failed:items.filter(i=>i.status==='failed').length,
      };
      setPhotoQueueSummary(summary);
      setPhotoQueueCount(summary.total);
    }catch{}
  },[tech.id]);

  useEffect(()=>{
    refreshPhotoQueueCount();
    return onPhotoQueueChange(refreshPhotoQueueCount);
  },[refreshPhotoQueueCount]);

  const refreshPendingCloseCount=useCallback(async()=>{
    try{
      const items=await getPendingCloseQueueForTech(String(tech.id));
      const summary={
        total:items.length,
        pending:items.filter(i=>i.status==='pending').length,
        processing:items.filter(i=>i.status==='processing').length,
        failed:items.filter(i=>i.status==='failed').length,
        conflict:items.filter(i=>i.status==='conflict').length,
      };
      setPendingCloseConflict(items.find(i=>i.status==='conflict')||null);
      setPendingCloseSummary(summary);
      setPendingCloseCount(summary.total);
    }catch{}
  },[tech.id]);

  useEffect(()=>{
    refreshPendingCloseCount();
    return onPendingCloseQueueChange(refreshPendingCloseCount);
  },[refreshPendingCloseCount]);

  const syncQueuedPhotosNow=async()=>{
    setPhotoQueueSyncing(true);
    const result=await syncPhotoUploadQueue();
    setPhotoQueueSyncing(false);
    await refreshPhotoQueueCount();
    await loadPhotos();
    window.dispatchEvent(new CustomEvent('gfs-pending-close-queue-updated'));
    showT(result.failed>0
      ? (lang==='es'?`📷 ${result.synced} subidas, ${result.failed} fallaron. Reintentará solo.`:`📷 ${result.synced} uploaded, ${result.failed} failed. It will retry.`)
      : (lang==='es'?`✅ Fotos sincronizadas: ${result.synced}`:`✅ Photos synced: ${result.synced}`));
  };

  const getPhotoCounts=(job)=>{
    const list=(techPhotos||[]).filter(p=>p.route_id===job.id || String(p.job_id||'')===String(job.job_id||''));
    return {total:list.length,before:list.filter(p=>p.photo_type==='evidence'||p.photo_type==='before'||!p.photo_type).length,after:list.filter(p=>p.photo_type==='pht'||p.photo_type==='after').length};
  };
  const removeTechLocation=async()=>{ if(!SUPABASE_CONFIGURED)return; try{ await sb.from('tech_locations').delete().eq('tech_id',tech.id); }catch{} };
  const findRouteJob=async(id)=>{
    const localJob=jobsRef.current.find((j:any)=>String(j.id)===String(id));
    if(localJob)return localJob;
    try{
      const {data,error}=await sb.from('routes').select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at').eq('id',id).maybeSingle();
      if(error)throw error;
      return data||null;
    }catch(error){
      console.warn('[TechPortal] route lookup failed before close:', error);
      return null;
    }
  };
  useEffect(()=>{jobsRef.current=jobs;},[jobs]);

  // ── Haversine distance ──
  const haversine=(lat1,lng1,lat2,lng2)=>{
    const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.pow(Math.sin(dLat/2),2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.pow(Math.sin(dLng/2),2);
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  };

  // ── Geocode address via Nominatim ──
  const geocodeAddress=async(address,city)=>{
    const key=`${address}|${city||''}`;
    if(coordsCache.current[key]) return coordsCache.current[key];
    try{
      const q=encodeURIComponent(`${address}${city?', '+city:''}, FL, USA`);
      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,{headers:{'User-Agent':'GuajiroAndSons-FieldSuite/4.0'}});
      const data=await res.json();
      if(data.length>0){
        const coords={lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)};
        coordsCache.current[key]=coords;
        return coords;
      }
    }catch(e){}
    return null;
  };

  // ── Reorder pending jobs by current GPS position using nearest-neighbor sequencing ──
  const reorderByLocation=async(currentJobs,reason='manual',force=false)=>{
    if(routePaused&&!force){showT(lang==='es'?'⏸ Ruta pausada por almuerzo':'⏸ Route paused for lunch');return;}
    const pending=currentJobs.filter(j=>j.status==='pending');
    if(pending.length<2)return;
    setReordering(true);
    try{
      const pos=await new Promise<GeolocationPosition|null>(resolve=>{
        if(!navigator.geolocation){resolve(null);return;}
        navigator.geolocation.getCurrentPosition(p=>resolve(p),()=>resolve(null),{enableHighAccuracy:true,timeout:7000,maximumAge:30000});
      });
      if(!pos){showT(lang==='es'?'⚠️ No se pudo obtener GPS':'⚠️ GPS position unavailable');setReordering(false);return;}
      const{latitude:myLat,longitude:myLng}=pos.coords;
      const pendingWithCoords=await Promise.all(pending.map(async(job,i)=>{
        await new Promise(r=>setTimeout(r,Math.min(i*180,1800)));
        try{
          const coords=job.latitude&&job.longitude?{lat:Number(job.latitude),lng:Number(job.longitude)}:await geocodeAddress(job.address,job.city||'');
          return{...job,coords};
        }catch{return{...job,coords:null as any};}
      }));

      const withoutCoords=pendingWithCoords.filter(j=>!j.coords);
      const remaining=pendingWithCoords.filter(j=>j.coords);
      const sorted:any[]=[];
      let cursor={lat:myLat,lng:myLng};
      while(remaining.length){
        let bestIndex=0;
        let bestDistance=Number.POSITIVE_INFINITY;
        remaining.forEach((job,index)=>{
          const distance=haversine(cursor.lat,cursor.lng,job.coords.lat,job.coords.lng);
          if(distance<bestDistance){bestDistance=distance;bestIndex=index;}
        });
        const [next]=remaining.splice(bestIndex,1);
        sorted.push({...next,dist:bestDistance});
        cursor=next.coords;
      }
      sorted.push(...withoutCoords);

      const previousOrder=pending.map(j=>String(j.id));
      const newOrder=sorted.map(j=>String(j.id));
      const changed=previousOrder.some((id,index)=>id!==newOrder[index]);
      if(!changed&&!force){showT(lang==='es'?'📍 La ruta ya está optimizada':'📍 Route is already optimized');setReordering(false);return;}

      const nonPending=currentJobs.filter(j=>j.status!=='pending');
      for(let i=0;i<sorted.length;i++){
        await sb.from('routes').update({order_num:nonPending.length+i}).eq('id',sorted[i].id).eq('tech_id',tech.id).catch(()=>{});
      }
      lastOptimizationRef.current=Date.now();
      lastOptimizationPositionRef.current={lat:myLat,lng:myLng};
      localStorage.setItem(`gfs_last_optimization_${tech.id}`,String(lastOptimizationRef.current));
      await sb.from('route_optimization_events').insert({tech_id:tech.id,region:tech.region||'miami',reason,previous_order:previousOrder,new_order:newOrder,latitude:myLat,longitude:myLng,created_by:tech.name,metadata:{source:'technician_portal'}}).catch(()=>({error:null}));
      await createAuditLog({
        action:'route_optimized',entity:'route',
        metadata:{region:tech.region||'miami',actorRole:'technician',actorName:tech.name,tech_id:tech.id,reason,previousOrder,newOrder,currentPosition:{lat:myLat,lng:myLng},summary:`Route optimized for tech ${tech.id} (${reason})`}
      }).catch(()=>{});
      await loadJobs();
      showT(lang==='es'?'📍 Ruta reorganizada desde tu ubicación actual':'📍 Route updated from your current location');
    }catch(e){console.error('reorder error:',e);}
    setReordering(false);
  };

  const toggleLunchBreak=async()=>{
    const next=!routePaused;
    setRoutePaused(next);
    localStorage.setItem(`gfs_route_paused_${tech.id}`,next?'1':'0');
    if(next){
      const pos=await new Promise<any>(resolve=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,()=>resolve(null),{timeout:5000,maximumAge:60000}):resolve(null));
      const {data}=await sb.from('technician_breaks').insert({tech_id:tech.id,region:tech.region||'miami',break_type:'lunch',start_latitude:pos?.coords?.latitude||null,start_longitude:pos?.coords?.longitude||null,metadata:{source:'technician_portal'}}).select('id').maybeSingle().catch(()=>({data:null}));
      if(data?.id)localStorage.setItem(`gfs_active_break_${tech.id}`,String(data.id));
    }else{
      const breakId=localStorage.getItem(`gfs_active_break_${tech.id}`);
      if(breakId){await sb.from('technician_breaks').update({ended_at:new Date().toISOString()}).eq('id',breakId).catch(()=>({error:null}));localStorage.removeItem(`gfs_active_break_${tech.id}`);}
    }
    await createAuditLog({action:next?'technician_break_started':'technician_break_ended',entity:'technician',entityId:tech.id,metadata:{region:tech.region||'miami',actorRole:'technician',actorName:tech.name,tech_id:tech.id,summary:next?`Lunch break started by tech ${tech.id}`:`Lunch break ended by tech ${tech.id}`}}).catch(()=>{});
    showT(next?(lang==='es'?'🍽 Ruta pausada por almuerzo':'🍽 Route paused for lunch'):(lang==='es'?'▶️ Ruta reanudada':'▶️ Route resumed'));
    if(!next)setTimeout(()=>reorderByLocation(jobsRef.current,'lunch_resume',true),250);
  };

  // ── GPS CONSENT CHECK ──
  useEffect(() => {
    sb.from('technicians').select('gps_consent').eq('id', tech.id).maybeSingle()
      .then(({ data }) => {
        if (!data?.gps_consent) setShowGpsConsent(true);
      });
  }, [tech.id]);

  // ── Offline detection ──
  useEffect(()=>{
    const goOnline=()=>{setIsOnline(true);loadJobs();showT('✅ Conexión restaurada');void syncQueuedPhotosNow();};
    const goOffline=()=>{setIsOnline(false);showT('📶 Sin conexión — modo offline');};
    window.addEventListener('online',goOnline);
    window.addEventListener('offline',goOffline);
    return()=>{window.removeEventListener('online',goOnline);window.removeEventListener('offline',goOffline);};
  },[]);

  const loadJobs=useCallback(async()=>{
    console.log('[TechPortal] loadJobs called: tech.id='+tech.id+' todayISO='+todayISO+' SUPABASE_CONFIGURED='+SUPABASE_CONFIGURED+' online='+navigator.onLine);
    setLoadError('');
    const loadCached=()=>{
      try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(cached){setJobs(cached);return true;}}catch(e){}
      return false;
    };
    if(!SUPABASE_CONFIGURED){
      if(loadSupervisorRouteForTech()) return;
      loadCached();
      setLoading(false);
      setLoadError(lang==='es'?'No hay ruta local publicada para este técnico. Importa y publica la ruta desde Supervisor.':'No local route has been published for this technician. Import and publish the route from Supervisor.');
      return;
    }
    if(!navigator.onLine){
      if(loadSupervisorRouteForTech()) return;
      loadCached();
      setLoading(false);return;
    }
    try{
      let query=await sb.from('routes').select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at').eq('tech_id',String(tech.id)).eq('date',todayISO).order('order_num');
      if(query.error)throw query.error;
      let result=query.data||[];
      console.log('[TechPortal] loadJobs: tech.id='+tech.id+' today='+todayISO+' initial='+result.length);
      if(result.length===0){
        const{data:fallbackRows,error:fallbackError}=await sb.from('routes').select('date').eq('tech_id',String(tech.id)).order('date',{ascending:false}).limit(1);
        const fallbackDate=!fallbackError&&Array.isArray(fallbackRows)&&fallbackRows.length>0?fallbackRows[0].date:null;
        if(fallbackDate&&fallbackDate!==todayISO){
          console.log('[TechPortal] fallback: most recent date='+fallbackDate);
          const{data:recentData,error:recentError}=await sb.from('routes').select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at').eq('tech_id',String(tech.id)).eq('date',fallbackDate).order('order_num');
          if(!recentError)result=recentData||[];
        }
      }
      setJobs(result);setLoading(false);
      try{localStorage.setItem(CACHE_KEY,JSON.stringify(result));}catch(e){}
    }catch(error:any){
      console.warn('[TechPortal] loadJobs failed:',error);
      const hadCache=loadCached();
      setLoadError(error?.message||'Unable to load technician route');
      setLoading(false);
      if(!hadCache)setJobs([]);
    }
  },[tech.id,tech.region,todayISO,CACHE_KEY,lang]);

  const loadNotes=useCallback(async()=>{
    if(!SUPABASE_CONFIGURED){setNotes([]);return;}
    const{data,error}=await sb.from('supervisor_notes').select('*').eq('date',todayISO).eq('region',tech.region||'miami');
    if(error){console.warn('[TechPortal] loadNotes failed:',error);return;}
    setNotes(data||[]);
  },[todayISO,tech.region]);

  const loadPhotos=useCallback(async()=>{
    if(!SUPABASE_CONFIGURED){setTechPhotos([]);return;}
    const{data,error}=await sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at').eq('tech_id',tech.id).order('created_at',{ascending:false}).limit(200);
    if(error){console.warn('[TechPortal] loadPhotos failed:',error);return;}
    setTechPhotos(data||[]);
  },[tech.id]);

  const loadTechNotes=useCallback(async()=>{
    if(!SUPABASE_CONFIGURED){setTechNotesSent([]);return;}
    const{data,error}=await sb.from('tech_notes').select('*').eq('tech_id',tech.id).eq('date',todayISO).order('created_at',{ascending:false});
    if(error){console.warn('[TechPortal] loadTechNotes failed:',error);return;}
    setTechNotesSent(data||[]);
  },[tech.id,todayISO]);

  useEffect(()=>{
    loadJobs();loadNotes();loadPhotos();loadTechNotes();
    // Route data can poll at a lower rate; GPS beacon is near real-time during the 7 AM–7 PM field window.
    const pollInterval = setInterval(()=>{ loadJobs(); loadTechNotes(); }, 60000);
    const clearTechLocation=async()=>{ if(!SUPABASE_CONFIGURED)return; try{ await sb.from('tech_locations').delete().eq('tech_id',tech.id); }catch{} };
    const sendLoc=()=>{
      if(!SUPABASE_CONFIGURED)return;
      if(!navigator.geolocation)return;
      const pendingNow=jobsRef.current.filter(j=>j.status==='pending');
      if(!isFieldTrackingWindow() || pendingNow.length===0){ clearTechLocation(); return; }
      navigator.geolocation.getCurrentPosition(async(pos)=>{
        const current={lat:pos.coords.latitude,lng:pos.coords.longitude};
        await sb.from('tech_locations').upsert({tech_id:tech.id,tech_name:tech.name,lat:current.lat,lng:current.lng,updated_at:new Date().toISOString()},{onConflict:'tech_id'});
        const previous=lastOptimizationPositionRef.current;
        const movedMiles=previous?haversine(previous.lat,previous.lng,current.lat,current.lng)*0.621371:0;
        const minutesSince=(Date.now()-lastOptimizationRef.current)/60000;
        if(!routePaused&&pendingNow.length>1&&previous&&movedMiles>=1.5&&minutesSince>=5){
          reorderByLocation(jobsRef.current,'gps_deviation');
        }
        lastOptimizationPositionRef.current=current;
      },()=>{}, {enableHighAccuracy:true,timeout:8000,maximumAge:5000});
    };
    sendLoc();locInterval.current=setInterval(sendLoc,10000);
    return()=>{clearInterval(pollInterval);if(locInterval.current)clearInterval(locInterval.current);};
  },[tech.id]);

  // ── markDone — saves job_note, archives to completed_jobs, triggers reorder ──
  const markDone=async(id,payCode,payTotal,jobNote='',photoAudit:any={})=>{
    if(!requireOnlineAction(lang==='es'?'Completar trabajo':'Complete job')) return false;
    try{
    const updData:any={status:'done',pay_code:payCode,pay_total:payTotal};
    if(jobNote)updData.job_note=jobNote;
    if(!SUPABASE_CONFIGURED){
      const {job,nextTechRows,routeDate}=updateLocalTechRouteJob(id,updData);
      showT(`✅ ${payCode}`);
      createAuditLog({ action:'job_completed_local', entity:'route', entityId:id, metadata:{ region:tech.region||job?.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', pay_code:payCode, pay_total:payTotal, summary:`Local job ${job?.job_id||id} completed by tech ${tech.id}` } }).catch(()=>{});
      if(routeDate===today&&nextTechRows.filter((j:any)=>j.status==='pending').length===0) removeTechLocation();
      return true;
    }
    const updateResult=await sb.from('routes').update(updData).eq('id',id);
    if(updateResult.error)throw updateResult.error;
    const job=await findRouteJob(id);
    if(photoAudit?.override){
      createAuditLog({ action:'photo_requirement_override', entity:'route', entityId:id, metadata:{ region:tech.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', before_photos:photoAudit.before||0, after_photos:photoAudit.after||0, result:'done', summary:`Photo requirement override: job ${job?.job_id||id} completed with incomplete photos` } }).catch(()=>{});
    }
    if(job){
      // Keep a single current completed record for this route, even after reopening/editing.
      const delCompleted=await sb.from('completed_jobs').delete().eq('route_id',id);
      if(delCompleted.error)throw delCompleted.error;
      const insertCompleted=await sb.from('completed_jobs').insert({
        route_id:id, tech_id:tech.id, tech_name:tech.name,
        job_id:job.job_id||'', address:job.address||'', city:job.city||'',
        phone:job.phone||'', type:job.type||'', pay_code:payCode,
        pay_total:payTotal, job_note:jobNote||'', zip:job.zip||'',
        date:job.date||today, region:tech.region||job.region||''
      });
      if(insertCompleted.error)throw insertCompleted.error;
      await sb.from('not_done_reports').update({status:'superseded'}).eq('tech_id',tech.id).eq('job_id',job.job_id||'').eq('date',job.date||today);
      await resolveNotDonePool({...job,...updData,region:tech.region||job.region||'miami',date:job.date||today,tech_id:tech.id},'completed',tech.name,'Completed from technician portal').catch(console.warn);
    }
    const routeDate=job?.date||today;
    const{data:freshJobs,error:freshError}=await sb.from('routes').select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at').eq('tech_id',tech.id).eq('date',routeDate).order('order_num');
    if(freshError)throw freshError;
    const updated=freshJobs||[];
    if(routeDate===today)setJobs(updated);
    if(routeDate===today&&updated.filter((j:any)=>j.status==='pending').length===0) removeTechLocation();
    showT(`✅ ${payCode}`);
    notifyWithSound('done', lang==='es'?'Trabajo completado':'Job completed', `#${job?.job_id||''} · ${job?.address||''}`, `job-done-${id}`).catch(()=>{});
    createAuditLog({ action:'job_completed', entity:'route', entityId:id, metadata:{ region:tech.region||job?.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', pay_code:payCode, pay_total:payTotal, before_photos:photoAudit?.before||0, after_photos:photoAudit?.after||0, photo_override:!!photoAudit?.override, queued_close:!!photoAudit?.queuedClose, summary:`Job ${job?.job_id||id} completed by tech ${tech.id}` } }).catch(()=>{});
    // Auto-reorder remaining pending jobs
    if(routeDate===today)reorderByLocation(updated,'job_closed',true);
    loadPhotos();
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(updated));}catch(e){}
    return true;
    }catch(error:any){
      console.error('[TechPortal] markDone failed:', error);
      showT('❌ '+(error?.message || (lang==='es'?'No se pudo completar el trabajo':'Unable to complete job')));
      return false;
    }
  };

  const customerRecoveryInput=(job:any, reasonOverride?:string)=>({
    routeId:String(job.id),
    jobId:String(job.job_id||''),
    techId:String(tech.id),
    techName:tech.name,
    region:tech.region||'miami',
    phone:job.phone,
    address:job.address,
    reason:reasonOverride||job.reason||'Customer Not Home',
    language:lang==='es'?'es' as const:'en' as const,
  });

  const notifyCustomerRecovery=async(job:any, reasonOverride?:string, openComposer=true)=>{
    if(!job?.phone){showT(lang==='es'?'⚠️ Este trabajo no tiene teléfono':'⚠️ This job has no phone number');return;}
    try{
      const input=customerRecoveryInput(job,reasonOverride);
      const result=await queueCustomerRecovery(input);
      if(result.row?.status==='opted_out'){
        showT(lang==='es'?'🚫 El cliente solicitó no recibir más mensajes':'🚫 Customer opted out of further messages');
        return result;
      }
      if(!openComposer){
        showT(lang==='es'?'📲 Recuperación creada. El SMS manual está listo.':'📲 Recovery created. Manual SMS is ready.');
        return result;
      }

      await markManualDraftOpened({
        outreachId:String(result.row?.id||job.id),region:input.region,phone:job.phone,language:input.language,
        actorName:tech.name,actorRole:'technician',jobId:input.jobId,techId:String(tech.id),
      });
      openCustomerSms(job.phone,input.language);
      showT(lang==='es'?'📱 Se abrió el SMS. Regresa y marca “SMS enviado”.':'📱 SMS opened. Return and mark “SMS sent”.');
      return result;
    }catch(error:any){
      showT(`❌ ${error?.message||'Customer notification failed'}`);
    }
  };

  const markCustomerSmsSent=async(job:any)=>{
    if(!job?.phone)return;
    try{
      const input=customerRecoveryInput(job,job.reason);
      const result=await queueCustomerRecovery(input);
      if(result.row?.status==='opted_out'){showT(lang==='es'?'🚫 Cliente con opt-out':'🚫 Customer opted out');return;}
      await markManualSmsSent({
        outreachId:String(result.row?.id||job.id),region:input.region,phone:job.phone,language:input.language,
        actorName:tech.name,actorRole:'technician',jobId:input.jobId,techId:String(tech.id),
      });
      showT(lang==='es'?'✅ SMS marcado como enviado por el técnico':'✅ SMS marked sent by technician');
    }catch(error:any){showT(`❌ ${error?.message||'Unable to mark SMS sent'}`);}
  };

  const recordCustomerReply=async(job:any)=>{
    const reply=window.prompt(lang==='es'?'Copia o escribe la respuesta del cliente:':'Paste or type the customer reply:');
    if(!reply?.trim())return;
    try{
      const input=customerRecoveryInput(job,job.reason);
      const result=await queueCustomerRecovery(input);
      const parsed=await recordManualCustomerReply({
        outreachId:String(result.row?.id||job.id),region:input.region,reply:reply.trim(),
        actorName:tech.name,actorRole:'technician',jobId:input.jobId,techId:String(tech.id),
      });
      showT(parsed.status==='appointment_requested'
        ? (lang==='es'?'📅 Solicitud de cita registrada':'📅 Appointment request recorded')
        : parsed.status==='opted_out'
          ? (lang==='es'?'🚫 Opt-out registrado':'🚫 Opt-out recorded')
          : (lang==='es'?'💬 Respuesta registrada':'💬 Reply recorded'));
    }catch(error:any){showT(`❌ ${error?.message||'Unable to record reply'}`);}
  };

  // ── markNotDone — saves job_note, triggers reorder ──
  const markNotDone=async(id,reason,jobNote='',photoAudit:any={})=>{
    if(!requireOnlineAction(lang==='es'?'Marcar Not Done':'Mark Not Done')) return false;
    try{
    const job=await findRouteJob(id);
    if(!SUPABASE_CONFIGURED){
      const updData:any={status:'notdone',reason,pay_code:null,pay_total:0};
      if(jobNote)updData.job_note=jobNote;
      const {nextTechRows,routeDate}=updateLocalTechRouteJob(id,updData);
      showT('❌ '+reason);
      createAuditLog({ action:'job_not_completed_local', entity:'route', entityId:id, metadata:{ region:tech.region||job?.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', reason, summary:`Local job ${job?.job_id||id} marked Not Done by tech ${tech.id}` } }).catch(()=>{});
      if(routeDate===today&&nextTechRows.filter((j:any)=>j.status==='pending').length===0) removeTechLocation();
      return true;
    }
    if(photoAudit?.override){
      createAuditLog({ action:'photo_requirement_override', entity:'route', entityId:id, metadata:{ region:tech.region||job?.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', total_photos:photoAudit.total||0, result:'notdone', summary:`Photo requirement override: job ${job?.job_id||id} marked Not Done with no photos` } }).catch(()=>{});
    }
    const updData:any={status:'notdone',reason};
    if(jobNote)updData.job_note=jobNote;
    const updateResult=await sb.from('routes').update({...updData,pay_code:null,pay_total:0}).eq('id',id);
    if(updateResult.error)throw updateResult.error;
    const delCompleted=await sb.from('completed_jobs').delete().eq('route_id',id);
    if(delCompleted.error)throw delCompleted.error;
    if(job){
      await sb.from('not_done_reports').update({status:'superseded'}).eq('tech_id',tech.id).eq('job_id',job.job_id||'').eq('date',job.date||today);
      const insertReport=await sb.from('not_done_reports').insert({date:job.date||today,tech_id:tech.id,tech_name:tech.name,job_id:job.job_id||'',address:job.address||'',reason,notes:jobNote||'',zone:job.zip||'',status:'pending',region:tech.region||job.region||'miami'});
      if(insertReport.error)throw insertReport.error;
      await addOrRefreshNotDonePool({...job,status:'notdone',reason,job_note:jobNote,region:tech.region||job.region||'miami',date:job.date||today,tech_id:tech.id},tech.name).catch(console.warn);
    }
    const routeDate=job?.date||today;
    const{data:freshJobs,error:freshError}=await sb.from('routes').select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at').eq('tech_id',tech.id).eq('date',routeDate).order('order_num');
    if(freshError)throw freshError;
    const updated=freshJobs||[];
    if(routeDate===today)setJobs(updated);
    if(routeDate===today&&updated.filter((j:any)=>j.status==='pending').length===0) removeTechLocation();
    showT('❌ '+reason);
    notifyWithSound('notdone', lang==='es'?'Trabajo no completado':'Job not completed', `#${job?.job_id||''} · ${reason}`, `job-notdone-${id}`).catch(()=>{});
    createAuditLog({ action:'job_not_completed', entity:'route', entityId:id, metadata:{ region:tech.region||job?.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:job?.job_id||'', reason, before_photos:photoAudit?.before||0, after_photos:photoAudit?.after||0, photo_total:photoAudit?.total||0, photo_override:!!photoAudit?.override, queued_close:!!photoAudit?.queuedClose, summary:`Job ${job?.job_id||id} reported not completed by tech ${tech.id}` } }).catch(()=>{});
    if(job && isRecoverableReason(reason)) notifyCustomerRecovery({...job,reason}, reason, false);
    if(routeDate===today)reorderByLocation(updated,'job_closed',true);
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(updated));}catch(e){}
    return true;
    }catch(error:any){
      console.error('[TechPortal] markNotDone failed:', error);
      showT('❌ '+(error?.message || (lang==='es'?'No se pudo marcar Not Done':'Unable to mark Not Done')));
      return false;
    }
  };


  const getRemoteRouteSnapshotForClose=async(routeId:string)=>{
    const {data,error}=await sb.from('routes')
      .select('id,date,tech_id,job_id,address,city,zip,type,status,pay_code,pay_total,reason,job_note,order_num,phone,region,is_duplicate,created_at,updated_at')
      .eq('id',routeId)
      .maybeSingle();
    if(error)throw error;
    return data||null;
  };

  const hasQueuedCloseConflict=(item:any,remote:any)=>{
    const clientUpdated=String(item?.client_updated_at||'');
    const remoteUpdated=String(remote?.updated_at||'');
    return !!clientUpdated&&!!remoteUpdated&&clientUpdated!==remoteUpdated;
  };


  const processPendingCloses=useCallback(async()=>{
    if(!navigator.onLine || pendingCloseSyncing) return;
    setPendingCloseSyncing(true);
    try{
      await syncPhotoUploadQueue();
      await refreshPhotoQueueCount();
      const items=await getPendingCloseQueueForTech(String(tech.id));
      let completed=0;
      for(const item of items){
        if(item.status==='conflict') continue;
        const photoSummary=await getPhotoQueueSummaryForJob({id:item.route_id,job_id:item.job_id});
        if(photoSummary.total>0) continue;
        let processing=item;
        try{
          const remote=await getRemoteRouteSnapshotForClose(item.route_id);
          if(remote&&hasQueuedCloseConflict(item,remote)){
            await markPendingCloseConflict(item,remote,lang==='es'?'El trabajo cambió en oficina antes de sincronizar el cierre.':'The office changed this job before the queued close synced.');
            continue;
          }
          processing=await markPendingCloseProcessing(item);
          const closeOk = processing.action==='done'
            ? await markDone(processing.route_id, processing.pay_code||'', Number(processing.pay_total||0), processing.job_note||'', {queuedClose:true})
            : await markNotDone(processing.route_id, processing.reason||'Not Done', processing.job_note||'', {queuedClose:true});
          if(!closeOk)throw new Error(lang==='es'?'El cierre automático no confirmó éxito. Se mantiene en Pending Close.':'Auto close did not confirm success. It remains in Pending Close.');
          await deletePendingCloseQueueItem(processing.id);
          completed+=1;
          createAuditLog({ action:'job_close_queue_success', entity:'route', entityId:processing.route_id, metadata:{ region:processing.region||tech.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:processing.job_id, result:processing.action, summary:`Pending Close synced for job ${processing.job_id}` } }).catch(()=>{});
        }catch(error){
          await markPendingCloseFailed(processing,error);
        }
      }
      if(completed>0){
        await loadJobs(); await loadPhotos(); await refreshPendingCloseCount();
        showT(lang==='es'?`✅ ${completed} Pending Close sincronizado(s)`:`✅ ${completed} Pending Close item(s) synced`);
      }else{
        await refreshPendingCloseCount();
      }
    }finally{
      setPendingCloseSyncing(false);
    }
  },[pendingCloseSyncing,tech.id,tech.name,tech.region,lang,refreshPhotoQueueCount,refreshPendingCloseCount]);

  useEffect(()=>{
    const run=()=>{ void processPendingCloses(); };
    const timer=setTimeout(run,1800);
    const cleanup=onPendingCloseQueueChange(run);
    return()=>{clearTimeout(timer);cleanup();};
  },[processPendingCloses]);

  const keepMyPendingCloseConflict=async()=>{
    const item=pendingCloseConflict;
    if(!item)return;
    if(!navigator.onLine){showT(lang==='es'?'📶 Sin conexión. Resuelve el conflicto cuando vuelva el internet.':'📶 Offline. Resolve the conflict when internet is back.');return;}
    setPendingCloseSyncing(true);
    try{
      await syncPhotoUploadQueue();
      await refreshPhotoQueueCount();
      const photoSummary=await getPhotoQueueSummaryForJob({id:item.route_id,job_id:item.job_id});
      if(photoSummary.total>0){showT(lang==='es'?'📷 Todavía hay fotos pendientes. Sincroniza fotos antes de resolver el conflicto.':'📷 Photos are still pending. Sync photos before resolving the conflict.');return;}
      const processing=await markPendingCloseProcessing({...item,status:'pending',lastError:''});
      const closeOk = processing.action==='done'
        ? await markDone(processing.route_id, processing.pay_code||'', Number(processing.pay_total||0), processing.job_note||'', {queuedClose:true, conflictResolved:'keep_mine'})
        : await markNotDone(processing.route_id, processing.reason||'Not Done', processing.job_note||'', {queuedClose:true, conflictResolved:'keep_mine'});
      if(!closeOk)throw new Error(lang==='es'?'No se pudo aplicar mi cierre. Se mantiene en conflicto.':'Unable to apply my close. It stays in conflict.');
      await deletePendingCloseQueueItem(processing.id);
      createAuditLog({ action:'job_close_conflict_resolved_keep_mine', entity:'route', entityId:processing.route_id, metadata:{ region:processing.region||tech.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:processing.job_id, result:processing.action, client_updated_at:processing.client_updated_at||'', remote_updated_at:processing.remote_updated_at||'', summary:`Technician kept queued close for job ${processing.job_id}` } }).catch(()=>{});
      await loadJobs(); await loadPhotos(); await refreshPendingCloseCount();
      showT(lang==='es'?'✅ Se aplicó tu cierre y se resolvió el conflicto.':'✅ Your close was applied and the conflict was resolved.');
    }catch(error:any){
      await markPendingCloseFailed(item,error);
      showT('❌ '+(error?.message||String(error)));
    }finally{
      setPendingCloseSyncing(false);
    }
  };

  const keepOfficePendingCloseConflict=async()=>{
    const item=pendingCloseConflict;
    if(!item)return;
    await deletePendingCloseQueueItem(item.id);
    createAuditLog({ action:'job_close_conflict_resolved_keep_office', entity:'route', entityId:item.route_id, metadata:{ region:item.region||tech.region||'miami', actorRole:'technician', actorName:tech.name, tech_id:tech.id, job_id:item.job_id, result:item.action, client_updated_at:item.client_updated_at||'', remote_updated_at:item.remote_updated_at||'', summary:`Technician discarded queued close and kept office version for job ${item.job_id}` } }).catch(()=>{});
    await loadJobs(); await loadPhotos(); await refreshPendingCloseCount();
    showT(lang==='es'?'✅ Se conservó la versión de oficina.':'✅ Office version kept.');
  };

  const retryQueuedWorkNow=useCallback(async()=>{
    if(!navigator.onLine){
      showT(lang==='es'?'📶 Sin conexión. Reintentará cuando vuelva el internet.':'📶 Offline. It will retry when internet is back.');
      return;
    }
    if(photoQueueSyncing||pendingCloseSyncing)return;
    if(pendingCloseCount>0){
      await processPendingCloses();
      return;
    }
    if(photoQueueCount>0){
      await syncQueuedPhotosNow();
      return;
    }
    showT(lang==='es'?'✅ No hay cargas pendientes.':'✅ Nothing pending to sync.');
  },[lang,photoQueueCount,pendingCloseCount,photoQueueSyncing,pendingCloseSyncing,processPendingCloses]);


  // ── Reopen an assigned job so the technician can correct a previous outcome ──
  const reopenJob=async(id)=>{
    if(!requireOnlineAction(lang==='es'?'Reabrir trabajo':'Reopen job')) return;
    const job=jobs.find(j=>j.id===id);
    if(!job)return;
    const before={...job};
    if(!SUPABASE_CONFIGURED){
      updateLocalTechRouteJob(id,{status:'pending',pay_code:null,pay_total:0,reason:null,job_note:job.job_note||''});
      createAuditLog({
        action:'job_reopened_by_technician_local', entity:'route', entityId:id,
        metadata:{region:tech.region||'miami',actorRole:'technician',actorName:tech.name,tech_id:tech.id,job_id:job.job_id,before,after:{...job,status:'pending',pay_code:null,pay_total:0,reason:null},summary:`Local job ${job.job_id} reopened by tech ${tech.id}`}
      }).catch(()=>{});
      showT(lang==='es'?'↩️ Trabajo reabierto. Ya puedes corregirlo.':'↩️ Job reopened. You can correct it now.');
      return;
    }
    const {error}=await sb.from('routes').update({
      status:'pending', pay_code:null, pay_total:0, reason:null,
      job_note:job.job_note||''
    }).eq('id',id).eq('tech_id',tech.id);
    if(error){showT('❌ '+error.message);return;}
    await sb.from('completed_jobs').delete().eq('route_id',id);
    await sb.from('not_done_reports').update({status:'reopened'}).eq('tech_id',tech.id).eq('job_id',job.job_id||'').eq('date',job.date||today);
    createAuditLog({
      action:'job_reopened_by_technician', entity:'route', entityId:id,
      metadata:{region:tech.region||'miami',actorRole:'technician',actorName:tech.name,tech_id:tech.id,job_id:job.job_id,before,after:{...job,status:'pending',pay_code:null,pay_total:0,reason:null},summary:`Job ${job.job_id} reopened by tech ${tech.id}`}
    }).catch(()=>{});
    await loadJobs();
    showT(lang==='es'?'↩️ Trabajo reabierto. Ya puedes corregirlo.':'↩️ Job reopened. You can correct it now.');
  };

  // ── Bulk SMS — combined message ──
  const sendBulkSms=()=>{
    const phones=jobs.filter(j=>j.phone).map(j=>j.phone.replace(/\D/g,''));
    if(phones.length===0){showT(t.smsNoPhones);return;}
    phones.forEach((ph,i)=>{
      setTimeout(()=>{window.open(`sms:${ph}?body=${encodeURIComponent(SMS_MSG)}`, '_blank');},i*400);
    });
    showT(`${t.smsSentCount} ${phones.length}`);
    setShowBulkSms(false);
  };

  const sendTechNote=async()=>{
    if(!techNoteText.trim()){return;}
    if(!requireOnlineAction(lang==='es'?'Enviar nota':'Send note')) return;
    setTechNoteSending(true);
    const{error}=await sb.from('tech_notes').insert({tech_id:tech.id,tech_name:tech.name,content:techNoteText.trim(),date:todayISO,region:tech.region||'miami'});
    setTechNoteSending(false);
    if(error){showT('❌ '+error.message);return;}
    setTechNoteText('');showT(t.techNoteSent);loadTechNotes();
  };

  const submitReport=async()=>{
    if(!reportForm.job||!reportForm.address||!reportForm.reason){showT('⚠️ '+(lang==='es'?'Completa todos los campos requeridos':'Fill all required fields'));return;}
    if(!requireOnlineAction(lang==='es'?'Enviar reporte':'Send report')) return;
    await sb.from('not_done_reports').insert({date:todayISO,tech_id:tech.id,tech_name:tech.name,job_id:reportForm.job,address:reportForm.address,reason:reportForm.reason,notes:reportForm.notes,status:'pending',region:tech.region||'miami'});
    setReportSubmitted(true);
  };

  const EOD_QUEUE_KEY='gfs_eod_queue_v1';
  const sendEOD=async()=>{
    const done=jobs.filter(j=>j.status==='done');
    const earned=done.reduce((s,j)=>s+(j.pay_total||0),0);
    const payload={date:todayISO,tech_id:tech.id,tech_name:tech.name,job_id:'EOD-REPORT',address:'End of Day Summary',reason:JSON.stringify({done:done.length,not_done:jobs.filter(j=>j.status==='notdone').length,earned}),notes:`Jobs: ${jobs.length}`,status:'eod',region:tech.region||'miami'};
    try{
      const result=await sb.from('not_done_reports').insert(payload);
      if(result.error)throw result.error;
    }catch(e:any){
      // FIX V25.3: never fail silently. Queue the report locally so it sends
      // on the next login, and tell the technician exactly what happened.
      console.error('EOD insert error:',e);
      try{
        const queue=JSON.parse(localStorage.getItem(EOD_QUEUE_KEY)||'[]');
        queue.push(payload);
        localStorage.setItem(EOD_QUEUE_KEY,JSON.stringify(queue));
      }catch{}
      window.alert(lang==='es'
        ?`No se pudo enviar el reporte al supervisor (${e?.message||'sin conexión'}). Quedó guardado en el teléfono y se enviará automáticamente la próxima vez que abras la app con señal.`
        :`Could not send the report to the supervisor (${e?.message||'no connection'}). It was saved on this phone and will send automatically next time you open the app with signal.`);
    }
    onLogout();
  };
  // Flush any EOD reports that failed to send on a previous day-close.
  useEffect(()=>{(async()=>{
    try{
      const queue=JSON.parse(localStorage.getItem(EOD_QUEUE_KEY)||'[]');
      if(!Array.isArray(queue)||!queue.length)return;
      const remaining=[] as any[];
      for(const item of queue){
        const result=await sb.from('not_done_reports').insert(item);
        if(result.error)remaining.push(item);
      }
      localStorage.setItem(EOD_QUEUE_KEY,JSON.stringify(remaining));
    }catch{}
  })();},[]);

  const done=jobs.filter(j=>j.status==='done');
  const notDone=jobs.filter(j=>j.status==='notdone');
  const pending=jobs.filter(j=>j.status==='pending');
  const donePhotoIssues=done.filter(j=>{const p=getPhotoCounts(j);return p.before===0||p.after===0;});
  const notDonePhotoIssues=notDone.filter(j=>getPhotoCounts(j).total===0);
  const pendingNoPhotos=pending.filter(j=>getPhotoCounts(j).total===0);
  const photoIssues=[...donePhotoIssues,...notDonePhotoIssues];
  const firstPending=pending[0]||null;
  const routeQuery=routeSearch.trim().toLowerCase();
  const visibleJobs=useMemo(()=>{
    const filtered=jobs.filter(job=>{
      const counts=getPhotoCounts(job);
      if(routeStatusFilter==='pending'&&job.status!=='pending')return false;
      if(routeStatusFilter==='done'&&job.status!=='done')return false;
      if(routeStatusFilter==='notdone'&&job.status!=='notdone')return false;
      if(routeStatusFilter==='photos'&&counts.total>0)return false;
      if(routeStatusFilter==='pendingClose')return false;
      if(routeQuery){
        const hay=[job.job_id,job.address,job.city,job.zip,job.phone,job.type,job.reason].filter(Boolean).join(' ').toLowerCase();
        if(!hay.includes(routeQuery))return false;
      }
      return true;
    });
    if(routeStatusFilter==='all'){
      const order={pending:0,done:1,notdone:2};
      return[...filtered].sort((a,b)=>(order[a.status]??3)-(order[b.status]??3)||(a.order_num||0)-(b.order_num||0));
    }
    return filtered;
  },[jobs,routeStatusFilter,routeQuery,techPhotos]);
  const quickFilters=[
    {id:'pending',label:lang==='es'?'Pendientes':'Pending',count:pending.length,color:'#ffbe00'},
    {id:'all',label:lang==='es'?'Todos':'All',count:jobs.length,color:C.accent},
    {id:'done',label:lang==='es'?'Completados':'Done',count:done.length,color:C.green},
    {id:'notdone',label:'Not Done',count:notDone.length,color:C.red},
    {id:'photos',label:lang==='es'?'Sin fotos':'No photos',count:pendingNoPhotos.length,color:'#ffbe00'},
  ];

  // ── BLOQUEO OBLIGATORIO — el técnico no ve nada de su ruta hasta que
  // las notificaciones queden en 'granted'. Sin botón para saltarlo. ──
  if(pushPermission!=='granted'&&isPushSupported()){
    return <PushGate lang={lang} techId={tech.id} onGranted={()=>setPushPermission('granted')}/>;
  }

  return(
    <div className="tech-portal tech-portal-v226" style={{minHeight:"100vh",background:C.bg,fontFamily:"'Barlow',sans-serif",paddingBottom:40}}>
      {showGpsConsent && (
        <GpsConsentModal
          lang={lang}
          onAccept={async () => {
            await saveGpsConsent(tech.id);
            setShowGpsConsent(false);
          }}
        />
      )}
      {showEOD&&<EndOfDayReport tech={tech} jobs={jobs} photos={techPhotos} onClose={()=>setShowEOD(false)} onConfirm={sendEOD} t={t} lang={lang}/>}
      {toast&&<Toast msg={toast} onClose={()=>setToast(null)}/>}
      {sessWarn&&<SessionWarning secondsLeft={sessLeft} lang={lang}/>}
      <AppErrorBoundary compact label={lang==='es'?'Recordatorios':'Reminders'}>
        <PendingJobReminder jobs={jobs} tech={tech} lang={lang} onOpenRoute={()=>setActiveSection('route')}/>
      </AppErrorBoundary>
      {/* Header */}
      <div className="tech-header" style={{background:C.surface,borderBottom:"1px solid #162e58",padding:"10px 14px",display:"flex",alignItems:"center",gap:8,position:"sticky",top:0,zIndex:50,boxShadow:"0 2px 12px #00000050"}}>
        <button onClick={()=>jobs.length>0?setShowEOD(true):onLogout()} style={{background:"#0e1e3a",border:"1px solid #1e3560",borderRadius:10,padding:"7px 12px",color:C.dim,cursor:"pointer",fontSize:14,flexShrink:0,display:"flex",alignItems:"center",gap:5,fontWeight:700}}>←</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:900,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>👷 {tech.name}</div>
          <div style={{fontSize:10,color:C.dim}}>#{tech.id} · {today}</div>
        </div>
        {reordering&&<div style={{fontSize:10,color:"#ffbe00",fontWeight:700,flexShrink:0}}>📍 Reordenando...</div>}
        <div style={{background:isOnline?"#00dc8518":"#ff334818",border:`1px solid ${isOnline?"#00dc8544":"#ff334844"}`,borderRadius:20,padding:"2px 8px",fontSize:10,color:isOnline?"#00dc85":"#ff3348",fontWeight:700,flexShrink:0}}>{isOnline?'● LIVE':'● OFFLINE'}</div>
        {photoQueueCount>0&&<button onClick={syncQueuedPhotosNow} disabled={photoQueueSyncing||!isOnline} style={{background:'#ffbe0022',border:'1px solid #ffbe0066',borderRadius:20,padding:'2px 8px',fontSize:10,color:'#ffbe00',fontWeight:900,flexShrink:0,cursor:isOnline?'pointer':'not-allowed'}}>📷 ⏳ {photoQueueCount}</button>}
        {pendingCloseCount>0&&<button onClick={processPendingCloses} disabled={pendingCloseSyncing||!isOnline} style={{background:'#00b8f522',border:'1px solid #00b8f566',borderRadius:20,padding:'2px 8px',fontSize:10,color:'#00b8f5',fontWeight:900,flexShrink:0,cursor:isOnline?'pointer':'not-allowed'}}>⏱ {pendingCloseCount}</button>}
        <button onClick={()=>{setShowPinChange(true);setPinForm({current:'',next:'',confirm:''});setPinError('');setPinSuccess('');}} style={{background:'#0e1e3a',border:'1px solid #1e3560',borderRadius:8,padding:'6px 10px',color:'#9be8ff',cursor:'pointer',fontSize:11,fontWeight:700,flexShrink:0,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:4}}>🔐 PIN</button>
        <LangToggle lang={lang} setLang={setLang}/>
        <button className="tech-close-day-button" onClick={()=>jobs.length>0?setShowEOD(true):onLogout()} style={{position:"relative",zIndex:9000,background:"#ff334818",border:"1px solid #ff334444",borderRadius:8,padding:"6px 10px",color:"#ff3348",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>⏹ {t.closeDay}</button>
      </div>
      {/* Tabs */}
      <div className="tech-tabs" style={{display:"flex",background:C.surface,borderBottom:"1px solid #162e58"}}>
        {[{id:'route',label:t.myRouteTab},{id:'report',label:t.reportTab},{id:'notes',label:t.techNotesTab},{id:'history',label:lang==='es'?'📊 Historial':'📊 History'}].map(s=>(
          <button className={activeSection===s.id?'is-active':''} key={s.id} onClick={()=>setActiveSection(s.id)} style={{flex:1,background:"none",border:"none",borderBottom:activeSection===s.id?`2px solid ${C.accent}`:"2px solid transparent",padding:"12px 8px",color:activeSection===s.id?C.accent:C.dim,fontWeight:600,cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:13}}>{s.label}</button>
        ))}
      </div>
      <div className={`tech-content tech-section-${activeSection}`} style={{maxWidth:'min(680px, 100%)',margin:"0 auto",padding:"16px"}}>{/* TECH_WORKBENCH_LAYOUT_FINAL */}
        <AppErrorBoundary compact label={lang==='es'?'Clima':'Weather'}>
          <WeatherLivePanel lang={lang} region={tech.region||'miami'} compact/>
        </AppErrorBoundary>
        {loadError&&<div style={{background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:10,padding:'10px 12px',color:'#ffcf55',fontSize:11,marginBottom:12}}>⚠ {lang==='es'?'No se pudo cargar la ruta en vivo. Si hay caché, se muestra localmente.':'Live route could not load. Cached route is shown when available.'} <span style={{opacity:.75}}>{loadError}</span><button onClick={loadJobs} style={{float:'right',background:'#ffbe0022',border:'1px solid #ffbe0055',borderRadius:7,color:'#ffcf55',fontSize:10,fontWeight:900,padding:'3px 7px',cursor:'pointer'}}>{lang==='es'?'Reintentar':'Retry'}</button></div>}
        {(photoQueueCount>0||pendingCloseCount>0)&&<div style={{background:'#0f2444',border:'1px solid #2a5790',borderRadius:12,padding:'11px 12px',color:'#dcecff',fontSize:11,marginBottom:12,boxShadow:'0 8px 22px #0003'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1,lineHeight:1.45}}>
              <div style={{fontWeight:900,color:'#9be8ff',marginBottom:3}}>🔄 {lang==='es'?'Estado de sincronización':'Sync status'}</div>
              <div>📷 {lang==='es'?'Fotos pendientes':'Pending photos'}: <b>{photoQueueSummary.total}</b>{photoQueueSummary.failed>0?` · ${photoQueueSummary.failed} failed`:''}</div>
              <div>⏱ {lang==='es'?'Cierres pendientes':'Pending closes'}: <b>{pendingCloseSummary.total}</b>{pendingCloseSummary.failed>0?` · ${pendingCloseSummary.failed} failed`:''}{pendingCloseSummary.conflict>0?` · ${pendingCloseSummary.conflict} conflict`:''}</div>
              <div style={{color:'#89a8ce',fontSize:10,marginTop:3}}>{pendingCloseConflict?(lang==='es'?'Hay un cierre que cambió en oficina antes de sincronizar. Elige qué versión conservar.':'A close changed in the office before syncing. Choose which version to keep.'):(lang==='es'?'Cola offline local con reintento seguro.':'Local offline queue with safe retry.')}</div>
            </div>
            <button onClick={retryQueuedWorkNow} disabled={photoQueueSyncing||pendingCloseSyncing||!isOnline||!!pendingCloseConflict} style={{background:isOnline&&!pendingCloseConflict?'#00b8f5':'#162e58',border:'none',borderRadius:9,color:isOnline&&!pendingCloseConflict?'#04091c':'#8da4c9',fontSize:10,fontWeight:950,padding:'8px 10px',cursor:isOnline&&!pendingCloseConflict?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
              {photoQueueSyncing||pendingCloseSyncing?(lang==='es'?'Reintentando...':'Retrying...'):(lang==='es'?'Reintentar ahora':'Retry now')}
            </button>
          </div>
          {pendingCloseConflict&&<div style={{marginTop:9,background:'#ffbe0012',border:'1px solid #ffbe0055',borderRadius:10,padding:'9px 10px'}}>
            <div style={{fontWeight:950,color:'#ffcf55',marginBottom:4}}>⚠ {lang==='es'?'Cambió en oficina':'Changed in office'}</div>
            <div style={{color:'#dcecff',lineHeight:1.45}}>
              Job <b>{pendingCloseConflict.job_id||pendingCloseConflict.route_id}</b> · {lang==='es'?'Tu cierre':'Your close'}: <b>{pendingCloseConflict.action==='done'?(lang==='es'?'Completado':'Done'):'Not Done'}</b> · {lang==='es'?'Oficina ahora':'Office now'}: <b>{pendingCloseConflict.remote_snapshot?.status||'changed'}</b>
            </div>
            <div style={{color:'#89a8ce',fontSize:10,marginTop:3}}>{lang==='es'?'No se sobrescribió nada. Decide si aplicar tu cierre o conservar lo que cambió la oficina.':'Nothing was overwritten. Decide whether to apply your close or keep the office change.'}</div>
            <div style={{display:'flex',gap:7,marginTop:8}}>
              <button onClick={keepMyPendingCloseConflict} disabled={pendingCloseSyncing||!isOnline} style={{flex:1,background:isOnline?'#00dc85':'#162e58',border:'none',borderRadius:8,color:isOnline?'#041018':'#8da4c9',fontWeight:950,fontSize:10,padding:'8px 7px',cursor:isOnline?'pointer':'not-allowed'}}>{lang==='es'?'Mantener lo mío':'Keep mine'}</button>
              <button onClick={keepOfficePendingCloseConflict} disabled={pendingCloseSyncing} style={{flex:1,background:'#ffbe0022',border:'1px solid #ffbe0066',borderRadius:8,color:'#ffcf55',fontWeight:950,fontSize:10,padding:'8px 7px',cursor:'pointer'}}>{lang==='es'?'Usar oficina':'Use office'}</button>
            </div>
          </div>}
        </div>}
        {activeSection==='route'&&(
          <>
            {/* Progress card — NO monetary value shown */}
            <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"16px",marginBottom:14}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>{t.dayProgress} — {today}</div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {[{v:done.length,l:t.doneLabel,c:"#00dc85",e:"✅"},{v:notDone.length,l:t.notDoneLabel,c:"#ff3348",e:"❌"},{v:pending.length,l:t.pendingLabel,c:"#ffbe00",e:"⏳"}].map(s=>(
                  <div key={s.l} style={{flex:1,background:`${s.c}18`,border:`1px solid ${s.c}44`,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:26,fontWeight:900,color:s.c}}>{s.v}</div>
                    <div style={{fontSize:10,color:C.dim,textTransform:"uppercase"}}>{s.e} {s.l}</div>
                  </div>
                ))}
              </div>
              {jobs.length>0&&<div style={{height:5,background:"#2e4470",borderRadius:99,overflow:"hidden",marginTop:4}}>
                <div style={{height:"100%",width:`${Math.round(((done.length+notDone.length)/jobs.length)*100)}%`,background:"linear-gradient(90deg,#00b8f5,#00dc85)",borderRadius:99,transition:"width .8s ease"}}/>
              </div>}
              {jobs.length>0&&<div style={{display:"flex",gap:8,marginTop:12}}>
                <button onClick={()=>{generateEODPDF(tech,jobs,techPhotos,lang,null);}} style={{flex:1,background:"#ff5a1f22",border:"1px solid #ff5a1f44",borderRadius:8,padding:"9px 6px",color:"#ff5a1f",fontWeight:700,cursor:"pointer",fontSize:12}}>📄 PDF</button>
                <button onClick={()=>generateRouteExcel(jobs,techPhotos,lang,tech.id)} style={{flex:1,background:"#00b8f522",border:"1px solid #00b8f544",borderRadius:8,padding:"9px 6px",color:"#00b8f5",fontWeight:700,cursor:"pointer",fontSize:12}}>📥 Excel</button>
              </div>}
              {firstPending&&<div style={{marginTop:10,background:'#ffbe0012',border:'1px solid #ffbe0044',borderRadius:10,padding:'10px 11px',display:'flex',gap:10,alignItems:'center'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:10,color:'#ffcf55',fontWeight:900,textTransform:'uppercase',letterSpacing:1}}>{lang==='es'?'Próximo trabajo':'Next job'}</div>
                  <div style={{fontSize:13,color:C.text,fontWeight:900,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>#{firstPending.job_id||'—'} · {firstPending.address}</div>
                  <div style={{fontSize:10,color:C.dim}}>{firstPending.city||''} {firstPending.zip||''}</div>
                </div>
                <button onClick={()=>setRouteSearch(String(firstPending.job_id||''))} style={{background:'#ffbe00',border:'none',borderRadius:8,color:'#04091c',fontSize:10,fontWeight:900,padding:'8px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>{lang==='es'?'Enfocar':'Focus'}</button>
              </div>}
              {pending.length>1&&<div style={{display:'flex',gap:8,marginTop:8}}>
                <button onClick={()=>reorderByLocation(jobs,'manual',true)} disabled={reordering||routePaused} style={{flex:1,background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'9px 6px',color:routePaused?C.dim:'#00b8f5',fontWeight:800,cursor:routePaused?'default':'pointer',fontSize:11}}>📍 {lang==='es'?'Recalcular ruta':'Recalculate route'}</button>
                <button onClick={toggleLunchBreak} style={{flex:1,background:routePaused?'#00dc8522':'#ffbe0022',border:`1px solid ${routePaused?'#00dc85':'#ffbe00'}`,borderRadius:8,padding:'9px 6px',color:routePaused?'#00dc85':'#ffbe00',fontWeight:800,cursor:'pointer',fontSize:11}}>{routePaused?(lang==='es'?'▶️ Reanudar ruta':'▶️ Resume route'):(lang==='es'?'🍽 Pausa / Almuerzo':'🍽 Lunch break')}</button>
              </div>}
              {/* Bulk SMS — combined message, no language selector */}
              {jobs.length>0&&(
                <div style={{marginTop:10}}>
                  <button onClick={()=>setShowBulkSms(v=>!v)}
                    style={{width:"100%",background:showBulkSms?"#005a9f":"#00b8f514",border:`1.5px solid ${showBulkSms?"#00b8f5":"#00b8f533"}`,borderRadius:10,padding:"11px 14px",color:showBulkSms?"#fff":"#00b8f5",fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                    <span>📱</span><span>{t.sendAllSmsBtn}</span>
                  </button>
                  {showBulkSms&&(
                    <div style={{marginTop:8,background:C.card2,border:"1px solid #162e58",borderRadius:12,padding:"14px",display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{fontSize:11,color:C.dim,lineHeight:1.5}}>{t.sendAllSmsDesc}</div>
                      <div style={{background:"#071525",border:"1px solid #162e58",borderRadius:8,padding:"10px 12px",fontSize:11,color:C.text,lineHeight:1.6,fontStyle:"italic"}}>
                        {SMS_MSG}
                      </div>
                      <div style={{fontSize:10,color:C.dim}}>{jobs.filter(j=>j.phone).length} {lang==='es'?'cliente(s) con teléfono':'client(s) with phone'}</div>
                      <button onClick={sendBulkSms}
                        style={{background:"linear-gradient(135deg,#004a9f,#00b8f5)",border:"none",borderRadius:10,padding:"13px",color:"#fff",fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:900,cursor:"pointer",letterSpacing:0.5}}>
                        📤 {lang==='es'?`Enviar a ${jobs.filter(j=>j.phone).length} cliente(s)`:`Send to ${jobs.filter(j=>j.phone).length} client(s)`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {(photoIssues.length>0||pendingNoPhotos.length>0)&&(<div style={{background:C.card,border:`1px solid ${photoIssues.length?'#ff334866':'#ffbe0044'}`,borderRadius:14,padding:'13px 14px',marginBottom:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:900,color:photoIssues.length?'#ff6677':'#ffbe00'}}>📷 {lang==='es'?'Chequeo de fotos':'Photo check'}</div>
                <div style={{fontSize:10,color:C.dim}}>{photoIssues.length} {lang==='es'?'cerrados con falta':'closed gaps'} · {pendingNoPhotos.length} {lang==='es'?'pendientes sin foto':'pending no photo'}</div>
              </div>
              <div style={{fontSize:11,color:C.dim,lineHeight:1.45,marginBottom:8}}>
                {lang==='es'?'Antes de publicar o cerrar el día, revisa los trabajos cerrados sin Before/After y los pendientes sin fotos.':'Before publishing or closing the day, review closed jobs missing Before/After and pending jobs with no photos.'}
              </div>
              {[...photoIssues,...pendingNoPhotos].slice(0,5).map(j=>{const p=getPhotoCounts(j);return <div key={`photo-gap-${j.id}`} style={{display:'flex',justifyContent:'space-between',gap:8,borderTop:'1px solid #162e5844',padding:'6px 0',fontSize:10}}>
                <span style={{color:C.text,fontWeight:800}}>#{j.job_id||'—'} · {String(j.status||'pending').toUpperCase()}</span>
                <span style={{color:(p.before&&p.after)||j.status==='pending'?'#ffbe00':'#ff6677'}}>B{p.before} / A{p.after}</span>
              </div>})}
              {[...photoIssues,...pendingNoPhotos].length>5&&<div style={{fontSize:10,color:C.dim,marginTop:5}}>+{[...photoIssues,...pendingNoPhotos].length-5} {lang==='es'?'más':'more'}</div>}
            </div>)}
            {/* Supervisor notes */}
            {notes.filter(n=>!n.tech_id||n.tech_id===tech.id).length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{t.supNotesTitle}</div>
                {notes.filter(n=>!n.tech_id||n.tech_id===tech.id).map(n=>{
                  const nt=NOTE_TYPES[n.type]||NOTE_TYPES.recommendation;
                  return(
                    <div key={n.id} style={{background:nt.bg,border:`1px solid ${nt.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",gap:10}}>
                      <span style={{fontSize:20,flexShrink:0}}>{nt.icon}</span>
                      <div><div style={{fontSize:10,color:nt.color,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{nt.label}</div><div style={{fontSize:13,color:C.text}}>{n.content}</div></div>
                    </div>
                  );
                })}
              </div>
            )}
            {jobs.length>0&&<div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:'12px',marginBottom:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:9}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:900,color:C.text}}>⚡ {lang==='es'?'Modo de trabajo':'Work mode'}</div>
                <button onClick={()=>setShowRouteTools(v=>!v)} style={{background:'#0e1e3a',border:'1px solid #1e3560',borderRadius:8,color:C.dim,fontSize:10,fontWeight:800,padding:'6px 8px',cursor:'pointer'}}>{showRouteTools?(lang==='es'?'Ocultar':'Hide'):(lang==='es'?'Filtros':'Filters')}</button>
              </div>
              <div className="tech-filter-pills" style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:3}}>
                {quickFilters.map(f=><button key={f.id} onClick={()=>setRouteStatusFilter(f.id)} style={{background:routeStatusFilter===f.id?`${f.color}22`:'#0e1e3a',border:`1px solid ${routeStatusFilter===f.id?f.color:'#1e3560'}`,borderRadius:999,color:routeStatusFilter===f.id?f.color:C.dim,fontSize:10,fontWeight:900,padding:'7px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>{f.label} · {f.count}</button>)}
              </div>
              {(showRouteTools||routeSearch)&&<div style={{display:'flex',gap:7,marginTop:9}}>
                <input value={routeSearch} onChange={e=>setRouteSearch(e.target.value)} placeholder={lang==='es'?'Buscar job, dirección, teléfono...':'Search job, address, phone...'} style={{flex:1,minWidth:0,background:'#0e1e3a',border:'1px solid #1e3560',borderRadius:9,padding:'10px 11px',color:C.text,fontSize:13,outline:'none'}}/>
                {routeSearch&&<button onClick={()=>setRouteSearch('')} style={{background:'#0e1e3a',border:'1px solid #1e3560',borderRadius:9,color:C.dim,fontSize:12,fontWeight:900,padding:'0 10px',cursor:'pointer'}}>✕</button>}
              </div>}
              <div style={{fontSize:10,color:C.dim,marginTop:8}}>{lang==='es'?`Mostrando ${visibleJobs.length} de ${jobs.length} trabajos`:`Showing ${visibleJobs.length} of ${jobs.length} jobs`}</div>
            </div>}
            {loading?(<div style={{textAlign:"center",padding:"40px",color:C.dim}}>{t.loadingLabel}</div>)
             :jobs.length===0?(<div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"40px 20px",textAlign:"center",color:C.dim}}>{t.noJobs}</div>)
             :visibleJobs.length===0?(<div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"28px 18px",textAlign:"center",color:C.dim}}>{lang==='es'?'No hay trabajos con este filtro.':'No jobs match this filter.'}<br/><button onClick={()=>{setRouteStatusFilter('all');setRouteSearch('');}} style={{marginTop:10,background:'#00b8f522',border:'1px solid #00b8f5',borderRadius:8,padding:'8px 12px',color:'#00b8f5',fontWeight:900,cursor:'pointer'}}>{lang==='es'?'Ver todos':'Show all'}</button></div>)
             :(<div className="tech-job-list">{visibleJobs.map((job,i)=><TechJobCard key={job.id} job={job} notes={notes.filter(n=>!n.tech_id||n.tech_id===tech.id)} onMarkDone={markDone} onMarkNotDone={markNotDone} onReopen={reopenJob} onNotifyCustomer={notifyCustomerRecovery} onMarkCustomerSmsSent={markCustomerSmsSent} onRecordCustomerReply={recordCustomerReply} index={i+1} techId={tech.id} t={t} lang={lang} allPhotos={techPhotos}/>)}</div>)}
          </>
        )}
        {activeSection==='report'&&(
          reportSubmitted?(
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:64}}>✅</div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:26,fontWeight:900,color:"#00dc85",marginTop:16}}>{t.sentTitle}</div>
              <div style={{fontSize:13,color:C.dim,marginTop:8,marginBottom:20}}>{t.sentDesc}</div>
              <button onClick={()=>{setReportForm({job:'',address:'',reason:'',notes:''});setReportSubmitted(false);}} style={{background:"#00b8f5",color:"#04091c",border:"none",borderRadius:10,padding:"12px 28px",fontWeight:700,cursor:"pointer",fontSize:15}}>{t.newReportBtn}</button>
            </div>
          ):(
            <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"16px",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:700,color:C.text}}>{t.reportFormTitle}</div>
              <div>
                <label style={{fontSize:12,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6,display:"block"}}>{t.jobNumLabel}</label>
                <input style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:10,padding:"12px 14px",color:C.text,fontSize:14,width:"100%",boxSizing:"border-box",fontFamily:"'Barlow',sans-serif",outline:"none"}} placeholder="JOB-XXXXX" value={reportForm.job} onChange={e=>setReportForm(f=>({...f,job:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:12,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6,display:"block"}}>{t.addrLabel}</label>
                <input style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:10,padding:"12px 14px",color:C.text,fontSize:14,width:"100%",boxSizing:"border-box",fontFamily:"'Barlow',sans-serif",outline:"none"}} placeholder={t.addrPH} value={reportForm.address} onChange={e=>setReportForm(f=>({...f,address:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:12,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6,display:"block"}}>{t.reasonRequired}</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {REASONS_LIST.map(r=>(
                    <button key={r.id} onClick={()=>setReportForm(f=>({...f,reason:r.label}))}
                      style={{background:reportForm.reason===r.label?`${r.color}28`:"#0e1e3a",border:`1.5px solid ${reportForm.reason===r.label?r.color:"#162e58"}`,borderRadius:8,padding:"8px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:14}}>{r.emoji}</span>
                      <span style={{fontSize:11,color:reportForm.reason===r.label?r.color:C.text,fontWeight:reportForm.reason===r.label?700:400,lineHeight:1.2}}>{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:12,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6,display:"block"}}>{t.notesLabel}</label>
                <textarea style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:10,padding:"12px 14px",color:C.text,fontSize:14,width:"100%",boxSizing:"border-box",fontFamily:"'Barlow',sans-serif",outline:"none",minHeight:80,resize:"vertical"}} placeholder={t.notesPH} value={reportForm.notes} onChange={e=>setReportForm(f=>({...f,notes:e.target.value}))}/>
              </div>
              <button onClick={submitReport} style={{background:"linear-gradient(135deg,#0040c0,#00b8f5)",border:"none",borderRadius:12,padding:"16px",color:"#fff",fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:800,cursor:"pointer"}}>{t.submitBtn}</button>
            </div>
          )
        )}
        {activeSection==='notes'&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"16px"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:800,color:C.text,marginBottom:12}}>✉️ {t.techNoteTitle}</div>
              <textarea value={techNoteText} onChange={e=>setTechNoteText(e.target.value)} placeholder={t.techNotePH}
                style={{width:"100%",boxSizing:"border-box",background:"#0e1e3a",border:"1px solid #162e58",borderRadius:10,padding:"12px 14px",color:C.text,fontSize:14,fontFamily:"'Barlow',sans-serif",outline:"none",minHeight:100,resize:"vertical",marginBottom:12}}/>
              <button onClick={sendTechNote} disabled={techNoteSending||!techNoteText.trim()}
                style={{width:"100%",background:techNoteText.trim()?"linear-gradient(135deg,#0040c0,#00b8f5)":C.muted,border:"none",borderRadius:12,padding:"16px",color:techNoteText.trim()?"#fff":C.dim,fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:800,cursor:techNoteText.trim()?"pointer":"default",opacity:techNoteSending?0.7:1}}>
                {techNoteSending?(lang==='es'?'Enviando...':'Sending...'):t.techNoteSendBtn}
              </button>
            </div>
            <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"16px"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🕐 {t.techNoteHistory}</div>
              {techNotesSent.length===0?(
                <div style={{textAlign:"center",padding:"20px 0",color:C.dim,fontSize:13}}>{t.techNoteEmpty}</div>
              ):(
                techNotesSent.map(n=>(
                  <div key={n.id} style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:10,padding:"10px 14px",marginBottom:8}}>
                    <div style={{fontSize:13,color:C.text,lineHeight:1.5}}>{n.content}</div>
                    <div style={{fontSize:11,color:C.dim,marginTop:6}}>{new Date(n.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {activeSection==='history'&&(<TechHistorySearch tech={tech} lang={lang} t={t} onReopenFromHistory={()=>{loadJobs();loadPhotos();setActiveSection('route');showT(lang==='es'?'↩️ Trabajo reabierto en la ruta de hoy':'↩️ Job reopened into today route');}}/>)}
      </div>
      {showPinChange&&(
        <div style={{position:'fixed',inset:0,background:'#00000099',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setShowPinChange(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:'1px solid #2a5790',borderRadius:16,padding:24,maxWidth:380,width:'100%',boxShadow:'0 20px 60px #0008'}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:C.text,marginBottom:4}}>🔐 {lang==='es'?'Cambiar mi PIN':'Change my PIN'}</div>
            <div style={{fontSize:11,color:C.dim,marginBottom:18}}>{lang==='es'?'Tu PIN es privado. Nadie más puede verlo.':'Your PIN is private. Nobody else can see it.'}</div>
            {pinSuccess?(
              <div style={{textAlign:'center',padding:'20px 0'}}>
                <div style={{fontSize:14,color:'#00dc85',fontWeight:700,marginBottom:16}}>{pinSuccess}</div>
                <button onClick={()=>setShowPinChange(false)} style={{background:'#00dc85',border:'none',borderRadius:10,padding:'12px 24px',color:'#041018',fontWeight:800,fontSize:14,cursor:'pointer'}}>{lang==='es'?'Cerrar':'Close'}</button>
              </div>
            ):(
              <>
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:11,color:C.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6,display:'block'}}>{lang==='es'?'PIN actual':'Current PIN'}</label>
                  <input type="password" inputMode="numeric" pattern="\d*" value={pinForm.current} onChange={e=>setPinForm(f=>({...f,current:e.target.value.replace(/\D/g,'').slice(0,8)}))} style={{width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:10,padding:'12px 14px',color:C.text,fontSize:18,letterSpacing:8,fontFamily:'monospace',outline:'none',textAlign:'center'}} placeholder="••••"/>
                </div>
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:11,color:C.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6,display:'block'}}>{lang==='es'?'Nuevo PIN':'New PIN'}</label>
                  <input type="password" inputMode="numeric" pattern="\d*" value={pinForm.next} onChange={e=>setPinForm(f=>({...f,next:e.target.value.replace(/\D/g,'').slice(0,8)}))} style={{width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:10,padding:'12px 14px',color:C.text,fontSize:18,letterSpacing:8,fontFamily:'monospace',outline:'none',textAlign:'center'}} placeholder="••••"/>
                </div>
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:11,color:C.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6,display:'block'}}>{lang==='es'?'Confirmar nuevo PIN':'Confirm new PIN'}</label>
                  <input type="password" inputMode="numeric" pattern="\d*" value={pinForm.confirm} onChange={e=>setPinForm(f=>({...f,confirm:e.target.value.replace(/\D/g,'').slice(0,8)}))} style={{width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:10,padding:'12px 14px',color:C.text,fontSize:18,letterSpacing:8,fontFamily:'monospace',outline:'none',textAlign:'center'}} placeholder="••••"/>
                </div>
                {pinError&&<div style={{background:'#ff334818',border:'1px solid #ff334844',borderRadius:8,padding:'8px 10px',color:'#ff3348',fontSize:11,marginBottom:12}}>{pinError}</div>}
                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>setShowPinChange(false)} style={{flex:1,background:'#162e58',border:'1px solid #2a5790',borderRadius:10,padding:'12px',color:C.dim,fontWeight:700,fontSize:14,cursor:'pointer'}}>{lang==='es'?'Cancelar':'Cancel'}</button>
                  <button onClick={async()=>{setPinError('');if(!pinForm.current||!pinForm.next||!pinForm.confirm){setPinError(lang==='es'?'Completa todos los campos':'Fill all fields');return;}if(pinForm.next.length<4){setPinError(lang==='es'?'El PIN debe tener al menos 4 dígitos':'PIN must be at least 4 digits');return;}if(pinForm.next!==pinForm.confirm){setPinError(lang==='es'?'Los PINs nuevos no coinciden':'New PINs do not match');return;}setPinChanging(true);try{await changeOwnTechnicianPin(tech.id,pinForm.current,pinForm.next);setPinSuccess(lang==='es'?'PIN cambiado correctamente. Usa tu nuevo PIN la próxima vez.':'PIN changed successfully. Use your new PIN next time.');createAuditLog({action:'technician_pin_changed',entity:'auth',metadata:{tech_id:tech.id,summary:'Technician changed own PIN'}}).catch(()=>{});}catch(e:any){setPinError(e?.message||'Failed to change PIN');}finally{setPinChanging(false);}}} disabled={pinChanging} style={{flex:1,background:pinChanging?'#162e58':'#00dc85',border:'none',borderRadius:10,padding:'12px',color:pinChanging?C.dim:'#041018',fontWeight:800,fontSize:14,cursor:pinChanging?'not-allowed':'pointer'}}>{pinChanging?(lang==='es'?'Guardando...':'Saving...'):(lang==='es'?'Guardar':'Save')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TechPortal;
