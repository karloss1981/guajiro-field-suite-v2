// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '../../config/theme';
import { fetchLiveWeather, fetchSevereWeatherAlerts, isStormWeatherCode } from '../../services/weather.service';
import { notifyWithSound, playNotificationSound, requestNotificationPermission } from '../../services/notification.service';

const REGION_FALLBACKS: Record<string, {lat:number;lng:number;label:string}> = {
  miami: {lat:25.7617,lng:-80.1918,label:'Miami'},
  swfl: {lat:26.6406,lng:-81.8723,label:'SW Florida'},
};

const WEATHER_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function shouldShowWeatherAlert(alert:any){
  if(typeof localStorage==='undefined') return true;
  const key=`gfs_weather_alert_seen_${String(alert.id||alert.event).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  try{
    const raw=localStorage.getItem(key);
    const last=raw?Number(raw):0;
    if(last && Date.now()-last < WEATHER_ALERT_COOLDOWN_MS) return false;
    localStorage.setItem(key,String(Date.now()));
  }catch{}
  return true;
}

export function WeatherLivePanel({lang='en',region='miami',compact=false}:{lang?:string;region?:string;compact?:boolean}){
  const es=lang==='es';
  const[weather,setWeather]=useState<any>(null);
  const[alerts,setAlerts]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[popup,setPopup]=useState<any|null>(null);
  const[permission,setPermission]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
  const fallback=REGION_FALLBACKS[region]||REGION_FALLBACKS.miami;

  const getCoords=()=>new Promise<{lat:number;lng:number;label:string}>(resolve=>{
    if(!navigator.geolocation){resolve(fallback);return;}
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude,label:es?'Ubicación actual':'Current location'}),
      ()=>resolve(fallback),
      {enableHighAccuracy:false,timeout:6000,maximumAge:300000}
    );
  });

  const load=useCallback(async()=>{
    setLoading(true); setError('');
    try{
      const coords=await getCoords();
      const [live,severe]=await Promise.all([
        fetchLiveWeather(coords.lat,coords.lng),
        fetchSevereWeatherAlerts(coords.lat,coords.lng).catch(()=>[]),
      ]);
      setWeather({...live,locationLabel:coords.label});
      setAlerts(severe);
      const alert=severe.find((a:any)=>['Extreme','Severe'].includes(String(a.severity))) || severe[0];
      if(alert && shouldShowWeatherAlert(alert)){
        setPopup(alert);
        notifyWithSound('weather',alert.event,alert.headline||alert.description,`weather-alert-${alert.id}`,{tab:'dashboard'}).catch(()=>{});
      }
    }catch(err){
      console.error(err); setError(es?'No se pudo cargar el tiempo':'Weather unavailable');
    }
    setLoading(false);
  },[lang,region]);

  useEffect(()=>{load(); const id=setInterval(load,10*60*1000); return()=>clearInterval(id);},[load]);

  const label=useMemo(()=>weather?(es?weather.labelEs:weather.labelEn):'',[weather,es]);
  const enableAlerts=async()=>{
    const result=await requestNotificationPermission();
    setPermission(result as any);
    if(result==='granted') playNotificationSound('info');
  };

  return <>
    {popup&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.82)',zIndex:990,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:'100%',maxWidth:470,background:'#160b0b',border:'2px solid #ff5a1f',borderRadius:18,padding:'22px',boxShadow:'0 22px 80px rgba(255,90,31,.25)'}}>
        <div style={{fontSize:12,fontWeight:900,color:'#ffbe00',letterSpacing:1.5,textTransform:'uppercase'}}>⚠ {es?'ALERTA CLIMÁTICA REAL':'ACTIVE WEATHER ALERT'}</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:27,fontWeight:900,color:'#fff',margin:'7px 0'}}>{popup.event}</div>
        <div style={{fontSize:14,color:'#ffd7c8',lineHeight:1.5}}>{popup.headline||popup.description}</div>
        {popup.instruction&&<div style={{marginTop:12,background:'#ff5a1f18',border:'1px solid #ff5a1f55',borderRadius:10,padding:'10px 12px',fontSize:12,color:'#fff'}}>{popup.instruction}</div>}
        {popup.expires&&<div style={{fontSize:10,color:'#ffcfbd',marginTop:10}}>{es?'Expira':'Expires'}: {new Date(popup.expires).toLocaleString()}</div>}
        <button onClick={()=>setPopup(null)} style={{marginTop:16,width:'100%',background:'#ff5a1f',border:'none',borderRadius:10,padding:'12px',color:'#fff',fontWeight:900,cursor:'pointer'}}>{es?'Entendido':'Acknowledge'}</button>
      </div>
    </div>}
    <div style={{background:C.card,border:`1px solid ${alerts.length?'#ff5a1f88':'#162e58'}`,borderRadius:compact?10:14,padding:compact?'9px 11px':'12px 14px',display:'flex',alignItems:'center',gap:10,marginBottom:compact?8:12}}>
      <div style={{fontSize:compact?22:28}}>{alerts.length||weather&&isStormWeatherCode(weather.weatherCode)?'⛈️':weather?.weatherCode===0?'☀️':'🌦️'}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:compact?14:17,fontWeight:900,color:alerts.length?'#ff8c62':C.text}}>{loading?(es?'Cargando clima...':'Loading weather...'):error||`${Math.round(weather?.temperatureF||0)}°F · ${label}`}</span>
          {alerts.length>0&&<span style={{background:'#ff5a1f22',border:'1px solid #ff5a1f66',borderRadius:20,padding:'1px 7px',fontSize:10,color:'#ff8c62',fontWeight:800}}>{alerts.length} {es?'alerta real':'active alert'}</span>}
        </div>
        {weather&&<div style={{fontSize:10,color:C.dim,marginTop:2}}>💨 {Math.round(weather.windMph)} mph · 🌧 {weather.precipitationIn.toFixed(2)} in · {weather.locationLabel}</div>}
        {!alerts.length&&weather&&isStormWeatherCode(weather.weatherCode)&&<div style={{fontSize:10,color:'#ffbe00',marginTop:2}}>{es?'Tormenta detectada por clima actual. No se notificará salvo alerta oficial severa.':'Storm conditions detected. No alert is sent unless an official severe alert is active.'}</div>}
      </div>
      <div style={{display:'flex',gap:6,flexShrink:0}}>
        {permission!=='granted'&&<button onClick={enableAlerts} style={{background:'#ffbe0018',border:'1px solid #ffbe0055',borderRadius:8,padding:'6px 8px',color:'#ffbe00',fontSize:10,fontWeight:800,cursor:'pointer'}}>{es?'Activar avisos':'Enable alerts'}</button>}
        <button onClick={load} style={{background:'#00b8f518',border:'1px solid #00b8f544',borderRadius:8,padding:'6px 8px',color:'#00b8f5',fontSize:11,cursor:'pointer'}}>↻</button>
      </div>
    </div>
  </>;
}
