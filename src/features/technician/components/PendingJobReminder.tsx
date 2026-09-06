// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { C } from '../../../config/theme';
import { notifyWithSound, requestNotificationPermission } from '../../../services/notification.service';
import { getFieldAlertSettings, subscribeFieldAlertSettings } from '../../../services/fieldAlertRules.service';

type ReminderRecord = {
  enteredAt?: number;
  leftAt?: number;
  nextAlertAt?: number;
  snoozeUntil?: number;
};

const MINUTE = 60 * 1000;
const ENTER_RADIUS_KM = 0.22;
const LEAVE_RADIUS_KM = 0.5;

function haversine(lat1:number,lng1:number,lat2:number,lng2:number){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.pow(Math.sin(dLat/2),2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.pow(Math.sin(dLng/2),2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

export function PendingJobReminder({jobs,tech,lang='en',onOpenRoute}:{jobs:any[];tech:any;lang?:string;onOpenRoute?:()=>void}){
  const es=lang==='es';
  const today=new Date().toLocaleDateString('en-CA');
  const storageKey=`gfs_pending_reminders_${tech.id}_${today}`;
  const coordsCache=useRef<Record<string,{lat:number;lng:number}>>({});
  const[popup,setPopup]=useState<any|null>(null);
  const popupRef=useRef<any|null>(null);
  useEffect(()=>{popupRef.current=popup;},[popup]);
  const[permission,setPermission]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
  const[alertSettings,setAlertSettings]=useState(()=>getFieldAlertSettings());
  const recordsRef=useRef<Record<string,ReminderRecord>>({});

  useEffect(()=>{
    try{recordsRef.current=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{recordsRef.current={};}
  },[storageKey]);

  useEffect(()=>subscribeFieldAlertSettings(()=>setAlertSettings(getFieldAlertSettings())),[]);

  const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(recordsRef.current));}catch{}};

  const geocode=async(job:any)=>{
    const key=`${job.address}|${job.city||''}`;
    if(coordsCache.current[key])return coordsCache.current[key];
    try{
      const q=encodeURIComponent(`${job.address}${job.city?', '+job.city:''}, FL, USA`);
      const response=await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,{headers:{'User-Agent':'GuajiroAndSons-FieldSuite/6.0'}});
      const data=await response.json();
      if(data?.[0]){
        const coords={lat:Number(data[0].lat),lng:Number(data[0].lon)};
        coordsCache.current[key]=coords;
        return coords;
      }
    }catch(error){console.warn('Reminder geocode failed',error);}
    return null;
  };

  const alertJobs=async(triggerJobs:any[],reason:'left'|'sevenpm')=>{
    if(!triggerJobs.length)return;
    const title=reason==='sevenpm'
      ? (es?'Trabajos pendientes después de las 7 PM':'Pending jobs after 7 PM')
      : (es?'Trabajo pendiente sin cerrar':'Pending job not closed');
    const body=triggerJobs.length===1
      ? `#${triggerJobs[0].job_id} · ${triggerJobs[0].address}`
      : `${triggerJobs.length} ${es?'trabajos aún pendientes':'jobs still pending'}`;
    setPopup({jobs:triggerJobs,reason,title,body});
    await notifyWithSound('pending',title,body,reason==='sevenpm'?'pending-after-7pm':'pending-left-job');
  };

  const evaluate=async()=>{
    if(!alertSettings.technicianEnabled)return;
    const pending=(jobs||[]).filter((job:any)=>job.status==='pending');
    const now=Date.now();
    const activeIds=new Set(pending.map((j:any)=>String(j.id)));
    // FIX V25.3: never delete internal '__' records (e.g. __after7__).
    // Deleting them wiped snooze/nextAlertAt on every tick, so the closeout
    // popup re-fired constantly instead of respecting the 15-min repeat.
    Object.keys(recordsRef.current).forEach(id=>{if(!id.startsWith('__')&&!activeIds.has(id))delete recordsRef.current[id];});
    // Never stack/re-fire while a popup is already on screen.
    if(popupRef.current)return;

    const due:any[]=[];
    const afterSeven=Date.now()>=new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate(),alertSettings.closeoutHour,alertSettings.closeoutMinute,0,0).getTime();

    let position:any=null;
    try{
      position=await new Promise((resolve,reject)=>{
        if(!navigator.geolocation){reject(new Error('No geolocation'));return;}
        navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:7000,maximumAge:60000});
      });
    }catch{}

    for(const job of pending){
      const id=String(job.id);
      const record=recordsRef.current[id]||{};
      recordsRef.current[id]=record;

      if(position){
        const coords=await geocode(job);
        if(coords){
          const distance=haversine(position.coords.latitude,position.coords.longitude,coords.lat,coords.lng);
          if(distance<=ENTER_RADIUS_KM){
            record.enteredAt=record.enteredAt||now;
            record.leftAt=undefined;
            record.nextAlertAt=undefined;
            record.snoozeUntil=undefined;
          }else if(record.enteredAt && distance>=LEAVE_RADIUS_KM && !record.leftAt){
            record.leftAt=now;
            record.nextAlertAt=now+alertSettings.leftJobMinutes*MINUTE;
          }
        }
      }

      const snoozedUntil=record.snoozeUntil||0;
      if(now<snoozedUntil)continue;
      if(record.nextAlertAt && now>=record.nextAlertAt){
        due.push(job);
        record.nextAlertAt=now+alertSettings.leftJobMinutes*MINUTE;
      }
    }

    if(alertSettings.technicianEnabled && afterSeven && pending.length){
      const key='__after7__';
      const rec=recordsRef.current[key]||{};
      recordsRef.current[key]=rec;
      if(now>=(rec.snoozeUntil||0) && now>=(rec.nextAlertAt||0)){
        rec.nextAlertAt=now+alertSettings.repeatMinutes*MINUTE;
        persist();
        await alertJobs(pending,'sevenpm');
        return;
      }
    }

    persist();
    if(due.length)await alertJobs(due,'left');
  };

  useEffect(()=>{
    evaluate();
    const id=setInterval(evaluate,60*1000);
    return()=>clearInterval(id);
  },[jobs,tech.id,lang]);

  const snooze=()=>{
    const now=Date.now();
    const ids=(popup?.jobs||[]).map((job:any)=>String(job.id));
    ids.forEach((id:string)=>{
      recordsRef.current[id]=recordsRef.current[id]||{};
      recordsRef.current[id].snoozeUntil=now+alertSettings.snoozeMinutes*MINUTE;
      recordsRef.current[id].nextAlertAt=now+alertSettings.snoozeMinutes*MINUTE;
    });
    recordsRef.current.__after7__=recordsRef.current.__after7__||{};
    recordsRef.current.__after7__.snoozeUntil=now+alertSettings.snoozeMinutes*MINUTE;
    recordsRef.current.__after7__.nextAlertAt=now+alertSettings.snoozeMinutes*MINUTE;
    persist();
    setPopup(null);
  };

  const enable=async()=>{
    const result=await requestNotificationPermission();
    setPermission(result as any);
  };

  return <>
    {alertSettings.technicianEnabled&&<div style={{background:'#00b8f50d',border:'1px solid #00b8f533',borderRadius:10,padding:'7px 10px',display:'flex',gap:8,alignItems:'center',marginBottom:8,fontSize:10,color:C.dim}}><span>⏰</span><span>{es?`Recordatorios: cierre ${String(alertSettings.closeoutHour).padStart(2,'0')}:${String(alertSettings.closeoutMinute).padStart(2,'0')} · salir de dirección ${alertSettings.leftJobMinutes} min · snooze ${alertSettings.snoozeMinutes} min`:`Reminders: closeout ${String(alertSettings.closeoutHour).padStart(2,'0')}:${String(alertSettings.closeoutMinute).padStart(2,'0')} · left address ${alertSettings.leftJobMinutes} min · snooze ${alertSettings.snoozeMinutes} min`}</span></div>}
    {popup&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.84)',zIndex:980,display:'flex',alignItems:'center',justifyContent:'center',padding:18}}>
      <div style={{width:'100%',maxWidth:430,background:'#0b1830',border:'2px solid #ffbe00',borderRadius:18,padding:'22px',boxShadow:'0 24px 80px rgba(255,190,0,.18)'}}>
        <div style={{fontSize:11,fontWeight:900,color:'#ffbe00',letterSpacing:1.5,textTransform:'uppercase'}}>⏰ {es?'RECORDATORIO DE CIERRE':'CLOSEOUT REMINDER'}</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:25,fontWeight:900,color:'#fff',margin:'7px 0'}}>{popup.title}</div>
        <div style={{fontSize:13,color:'#c8d8f4',lineHeight:1.5,marginBottom:12}}>{es?'Debes marcar cada trabajo como completado o no realizado. La alerta se repetirá cada 15 minutos hasta cerrarlo.':'Mark every job as completed or not done. This alert repeats every 15 minutes until the job is closed.'}</div>
        <div style={{maxHeight:190,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
          {popup.jobs.map((job:any)=><div key={job.id} style={{background:'#071327',border:'1px solid #162e58',borderRadius:9,padding:'9px 11px'}}><div style={{fontWeight:900,color:'#00b8f5'}}>#{job.job_id}</div><div style={{fontSize:11,color:C.text}}>{job.address}{job.city?`, ${job.city}`:''}</div></div>)}
        </div>
        <div style={{display:'flex',gap:9,marginTop:15}}>
          <button onClick={snooze} style={{flex:1,background:'#ffbe0018',border:'1px solid #ffbe00',borderRadius:10,padding:'11px',color:'#ffbe00',fontWeight:900,cursor:'pointer'}}>{es?`Snooze ${alertSettings.snoozeMinutes} min`:`Snooze ${alertSettings.snoozeMinutes} min`}</button>
          <button onClick={()=>{setPopup(null);onOpenRoute?.();}} style={{flex:1,background:'linear-gradient(135deg,#0040c0,#00b8f5)',border:'none',borderRadius:10,padding:'11px',color:'#fff',fontWeight:900,cursor:'pointer'}}>{es?'Abrir ruta':'Open route'}</button>
        </div>
      </div>
    </div>}
    {permission!=='granted'&&<div style={{background:'#ffbe0010',border:'1px solid #ffbe0033',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8,marginBottom:10}}><div style={{flex:1,fontSize:10,color:'#d5bd79'}}>{es?'Activa notificaciones para recibir recordatorios fuera de la vista activa.':'Enable notifications for closeout reminders outside the active view.'}</div><button onClick={enable} style={{background:'#ffbe0022',border:'1px solid #ffbe0055',borderRadius:8,padding:'5px 8px',color:'#ffbe00',fontSize:10,fontWeight:800,cursor:'pointer'}}>{es?'Activar':'Enable'}</button></div>}
  </>;
}
