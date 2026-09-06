// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { MIAMI_DADE_ZIPS, BROWARD_ZIPS } from '../../../config/regions';
import { FL_ZIP_GEOJSON_URL, GEO_CACHE_KEY, NOMINATIM_URL } from '../../../config/constants';
import { getTechName } from '../../../legacy/data';
import { buildHash, parseHash } from '../../../legacy/routing';
import { downloadPhotosZip } from '../../../services/photos.service';
import { generateJobExcel, generateJobPDF, generateEarningsExcel } from '../../../legacy/reporting';
import { Lightbox } from '../../technician/components/Lightbox';

/* ── TECH ACTIVITY VIEW — muestra todos los técnicos con trabajos hoy ── */
function TechActivityView({techLocations,routes,lang}){
  const es=lang==='es';
  const now=Date.now();

  const timeAgo=(ts)=>{
    if(!ts)return null;
    const diff=Math.floor((now-new Date(ts).getTime())/1000);
    if(diff<60)return `${diff}s`;
    if(diff<3600)return `${Math.floor(diff/60)}m`;
    return `${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m`;
  };

  // Agrupa rutas por técnico
  const techGroups=routes.reduce((acc,job)=>{
    const k=job.tech_id;
    if(!acc[k])acc[k]={techId:k,jobs:[]};
    acc[k].jobs.push(job);
    return acc;
  },{});

  const techList=Object.values(techGroups) as any[];

  if(techList.length===0){
    return(
      <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"40px 20px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>👷</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:700,color:C.dim}}>
          {es?'No hay rutas importadas para hoy':'No routes imported for today'}
        </div>
        <div style={{fontSize:12,color:C.muted,marginTop:6}}>
          {es?'Importa el Excel de ruta para ver a los técnicos aquí':'Import the route Excel to see technicians here'}
        </div>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {techList.sort((a,b)=>{
        // Sort: techs with pending jobs first, then by done count desc
        const aPend=a.jobs.filter(j=>j.status==='pending').length;
        const bPend=b.jobs.filter(j=>j.status==='pending').length;
        if(aPend!==bPend)return bPend-aPend;
        return b.jobs.filter(j=>j.status==='done').length - a.jobs.filter(j=>j.status==='done').length;
      }).map(({techId:tid,jobs:tjobs})=>{
        const done=tjobs.filter(j=>j.status==='done');
        const nd=tjobs.filter(j=>j.status==='notdone');
        const pend=tjobs.filter(j=>j.status==='pending');
        const pct=tjobs.length>0?Math.round(((done.length+nd.length)/tjobs.length)*100):0;

        // GPS data (optional)
        const gpsData=techLocations.find(l=>l.tech_id===tid);
        const lastSeen=gpsData?timeAgo(gpsData.updated_at):null;
        const isStale=gpsData&&(now-new Date(gpsData.updated_at).getTime())>2*3600*1000;
        const hasGps=!!gpsData&&!isStale;

        // Current job
        const currentJob=pend.length>0?pend[0]:done.length>0?done[done.length-1]:null;

        return(
          <div key={tid} style={{background:C.card,border:`1px solid ${pend.length>0?"#162e58":"#00dc8533"}`,borderRadius:14,padding:"14px 16px",transition:"all .2s"}}>
            {/* Header row */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              {/* Avatar */}
              <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#0040a8,#00b8f5)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:"#fff",fontSize:12,flexShrink:0,position:"relative"}}>
                {tid}
                <div style={{position:"absolute",bottom:-2,right:-2,width:12,height:12,borderRadius:"50%",background:hasGps?"#00dc85":pend.length>0?"#ffbe00":"#5a7aaa",border:"2px solid #0b1830"}}/>
              </div>
              {/* Name + GPS */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:800,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {getTechName(tid)}
                </div>
                <div style={{fontSize:10,color:C.dim,display:"flex",gap:6,marginTop:2,flexWrap:"wrap"}}>
                  {hasGps&&<span style={{color:"#00dc85"}}>📍 GPS {lastSeen} ago</span>}
                  {isStale&&<span style={{color:"#ff3348"}}>⚠️ GPS inactivo</span>}
                  {!gpsData&&<span style={{color:"#5a7aaa"}}>📍 {es?'Sin GPS':'No GPS'}</span>}
                </div>
              </div>
              {/* Progress % */}
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:pct===100?"#00dc85":pct>50?"#ffbe00":"#00b8f5"}}>{pct}%</div>
                <div style={{fontSize:9,color:C.dim}}>{es?'completado':'done'}</div>
              </div>
            </div>

            {/* Job stats badges */}
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
              {done.length>0&&<span style={{background:"#00dc8522",border:"1px solid #00dc8544",borderRadius:20,padding:"3px 10px",fontSize:11,color:"#00dc85",fontWeight:700}}>✅ {done.length} {es?'Hechos':'Done'}</span>}
              {nd.length>0&&<span style={{background:"#ff334822",border:"1px solid #ff334444",borderRadius:20,padding:"3px 10px",fontSize:11,color:"#ff3348",fontWeight:700}}>❌ {nd.length} {es?'No Hecho':'Not Done'}</span>}
              {pend.length>0&&<span style={{background:"#ffbe0022",border:"1px solid #ffbe0044",borderRadius:20,padding:"3px 10px",fontSize:11,color:"#ffbe00",fontWeight:700}}>⏳ {pend.length} {es?'Pendientes':'Pending'}</span>}
              <span style={{background:"#00b8f518",border:"1px solid #00b8f533",borderRadius:20,padding:"3px 10px",fontSize:11,color:"#00b8f5",fontWeight:700}}>📋 {tjobs.length} total</span>
            </div>

            {/* Progress bar */}
            <div style={{height:6,background:"#162e58",borderRadius:99,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",display:"flex"}}>
                <div style={{width:`${tjobs.length>0?(done.length/tjobs.length)*100:0}%`,background:"#00dc85",transition:"width .5s"}}/>
                <div style={{width:`${tjobs.length>0?(nd.length/tjobs.length)*100:0}%`,background:"#ff3348",transition:"width .5s"}}/>
              </div>
            </div>

            {/* Current / next job */}
            {currentJob&&(
              <div style={{background:"#070f24",borderRadius:8,padding:"8px 12px",border:`1px solid ${pend.length>0?"#ffbe0033":"#00dc8533"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,fontWeight:700,color:pend.length>0?"#ffbe00":"#00dc85"}}>
                    {pend.length>0?(es?'⏳ PRÓXIMO':'⏳ NEXT'):(es?'✅ ÚLTIMO':'✅ LAST')}
                  </span>
                  <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:800,color:C.accent}}>#{currentJob.job_id}</span>
                </div>
                <div style={{fontSize:11,color:C.text,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentJob.address}{currentJob.city?`, ${currentJob.city}`:''}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { TechActivityView };
