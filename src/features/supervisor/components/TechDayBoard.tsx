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

/* ── TECH DAY BOARD — Tablero visual supervisor ── */
function TechDayBoard({routes, lang, onSelectJob}:{routes:any[], lang:string, onSelectJob:(job:any)=>void}) {
  const es = lang === 'es';
  const [expandedTech, setExpandedTech] = useState<string|null>(null);

  // Any tech_id that is not exactly 4 digits is garbage from old imports
  // (notes/addresses leaked into the column) — group it under Unassigned
  // instead of rendering fake technician rows.
  const TECH_ID_OK = /^\d{4}$/;
  const UNASSIGNED = '__unassigned__';
  const techGroups = routes.reduce((acc:any, job:any) => {
    const key = TECH_ID_OK.test(String(job.tech_id||'')) ? job.tech_id : UNASSIGNED;
    if (!acc[key]) acc[key] = [];
    acc[key].push(job);
    return acc;
  }, {});

  const techList = Object.entries(techGroups)
    .map(([techId, jobs]:any) => ({techId, jobs}))
    .sort((a:any, b:any) => {
      if (a.techId === UNASSIGNED) return 1;
      if (b.techId === UNASSIGNED) return -1;
      const pctA = a.jobs.length > 0 ? (a.jobs.filter((j:any)=>j.status==='done').length / a.jobs.length) : 0;
      const pctB = b.jobs.length > 0 ? (b.jobs.filter((j:any)=>j.status==='done').length / b.jobs.length) : 0;
      return pctB - pctA;
    });

  if (techList.length === 0) return null;

  return (
    <div style={{background:C.card, border:"1px solid #162e58", borderRadius:14, overflow:"hidden", marginBottom:16}}>
      <div style={{padding:"12px 16px", borderBottom:"1px solid #162e58", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:15, fontWeight:900, color:C.text}}>
          👷 {es ? "Tablero de Técnicos" : "Tech Board"} — {new Date().toLocaleDateString('en-CA')}
        </div>
        <div style={{fontSize:11, color:C.dim}}>{techList.length} {es?"técnicos":"techs"}</div>
      </div>

      {techList.map(({techId, jobs}:any) => {
        const done    = jobs.filter((j:any)=>j.status==='done');
        const notDone = jobs.filter((j:any)=>j.status==='notdone');
        const pending = jobs.filter((j:any)=>j.status==='pending');
        const pctDone = jobs.length > 0 ? (done.length/jobs.length)*100 : 0;
        const pctND   = jobs.length > 0 ? (notDone.length/jobs.length)*100 : 0;
        const pct     = jobs.length > 0 ? Math.round(((done.length+notDone.length)/jobs.length)*100) : 0;
        const isOpen  = expandedTech === techId;
        const barColor = pct >= 80 ? '#00dc85' : pct >= 40 ? '#ffbe00' : '#00b8f5';

        return (
          <div key={techId} style={{borderBottom:"1px solid #162e5820"}}>
            <div
              onClick={()=>setExpandedTech(isOpen ? null : techId)}
              style={{padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12, transition:"background .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#0e1e3a"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >
              <div style={{width:38, height:38, borderRadius:"50%", background:techId===UNASSIGNED?"linear-gradient(135deg,#5a3a00,#ffbe00)":"linear-gradient(135deg,#0040a8,#00b8f5)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, color:"#fff", fontSize:11, flexShrink:0, overflow:"hidden"}}>
                {techId===UNASSIGNED?'⚠':techId}
              </div>
              <div style={{flex:1, minWidth:0, overflow:"hidden"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:800, color:techId===UNASSIGNED?'#ffbe00':C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                  {techId===UNASSIGNED?(es?'Sin técnico asignado':'Unassigned technician'):getTechName(techId)}
                </div>
                <div style={{height:6, background:"#162e58", borderRadius:99, overflow:"hidden", marginTop:5, display:"flex"}}>
                  <div style={{width:`${pctDone}%`, background:"#00dc85", transition:"width .5s"}}/>
                  <div style={{width:`${pctND}%`,   background:"#ff3348", transition:"width .5s"}}/>
                </div>
              </div>
              <div style={{display:"flex", gap:5, flexShrink:0, alignItems:"center"}}>
                <span style={{background:"#00dc8522", borderRadius:20, padding:"2px 8px", fontSize:11, color:"#00dc85", fontWeight:700}}>✅{done.length}</span>
                {notDone.length > 0 && <span style={{background:"#ff334822", borderRadius:20, padding:"2px 8px", fontSize:11, color:"#ff3348", fontWeight:700}}>❌{notDone.length}</span>}
                <span style={{background:"#ffbe0022", borderRadius:20, padding:"2px 8px", fontSize:11, color:"#ffbe00", fontWeight:700}}>⏳{pending.length}</span>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:15, fontWeight:900, color:barColor, minWidth:36, textAlign:"right"}}>{pct}%</span>
              </div>
              <div style={{color:C.dim, fontSize:14, transform:isOpen?"rotate(90deg)":"rotate(0)", transition:"transform .2s"}}>›</div>
            </div>

            {isOpen && (
              <div style={{background:"#070f24", padding:"8px 12px 12px", display:"flex", flexDirection:"column", gap:5}}>
                <div style={{display:"flex", gap:10, marginBottom:6, fontSize:10, color:C.dim}}>
                  <span>🟢 {es?"Hecho":"Done"}</span>
                  <span>🔴 {es?"No hecho":"Not done"}</span>
                  <span>🟡 {es?"Pendiente":"Pending"}</span>
                </div>
                {jobs.map((job:any) => {
                  const isDone    = job.status === 'done';
                  const isNotDone = job.status === 'notdone';
                  const sc = isDone ? '#00dc85' : isNotDone ? '#ff3348' : '#ffbe00';
                  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address+(job.city?', '+job.city:''))}`;
                  return (
                    <div key={job.id} style={{background:C.card, border:`1px solid ${sc}33`, borderRadius:9, padding:"9px 12px", display:"flex", alignItems:"center", gap:10}}>
                      <div style={{width:8, height:8, borderRadius:"50%", background:sc, flexShrink:0}}/>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{display:"flex", gap:7, alignItems:"center", flexWrap:"wrap"}}>
                          <button onClick={e=>{e.stopPropagation(); onSelectJob(job);}}
                            style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:900, color:sc, textDecoration:"none", display:"flex", alignItems:"center", gap:3, background:'none', border:'none', padding:0, cursor:'pointer'}}>
                            #{job.job_id} <span style={{fontSize:10, opacity:0.7}}>📋</span>
                          </button>
                          {isDone && <span style={{background:`${sc}22`, borderRadius:20, padding:"1px 7px", fontSize:10, color:sc, fontWeight:700}}>{job.pay_code} ${job.pay_total}</span>}
                          {isNotDone && <span style={{background:"#ff334822", borderRadius:20, padding:"1px 7px", fontSize:10, color:"#ff3348", fontWeight:700}}>{job.reason?.substring(0,20)}</span>}
                          <span style={{background:"#00b8f518", borderRadius:20, padding:"1px 7px", fontSize:10, color:"#00b8f5"}}>{job.type?.includes('FIBER')?'FIBER':'COAX'}</span>
                        </div>
                        <div style={{fontSize:11, color:C.text, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                          {job.address}{job.city?`, ${job.city}`:''}
                        </div>
                        {job.job_note && <div style={{fontSize:10, color:"#00b8f5", marginTop:1}}>📝 {job.job_note}</div>}
                      </div>
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                        style={{background:'#00b8f518', border:'1px solid #00b8f544', borderRadius:7, padding:"5px 8px", color:'#00b8f5', fontSize:10, fontWeight:700, cursor:"pointer", flexShrink:0, whiteSpace:"nowrap", textDecoration:'none'}}>
                        🗺️
                      </a>
                      <button onClick={e=>{e.stopPropagation(); onSelectJob(job);}}
                        style={{background:`${sc}18`, border:`1px solid ${sc}44`, borderRadius:7, padding:"5px 9px", color:sc, fontSize:10, fontWeight:700, cursor:"pointer", flexShrink:0, whiteSpace:"nowrap"}}>
                        {es?"Ver trabajo":"View job"} →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { TechDayBoard };
