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

/* ════════════════════════════════════════════════════
   EARNINGS VIEW — Ganancias por técnico con filtros
   ════════════════════════════════════════════════════ */
function EarningsView({routes, lang, onBack, region}: {routes:any[], lang:string, onBack:()=>void, region:string}) {
  const es = lang === 'es';
  const [period, setPeriod] = useState<string>('day');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [allRoutes, setAllRoutes] = useState<any[]>(routes);

  // Load historical routes for week/month/year
  useEffect(() => {
    if (period === 'day') { setAllRoutes(routes); return; }
    setLoadingHistory(true);
    const now = new Date();
    const cutoff = new Date();
    if (period === 'week')  cutoff.setDate(now.getDate() - 7);
    if (period === 'month') cutoff.setDate(now.getDate() - 30);
    if (period === 'year')  cutoff.setDate(now.getDate() - 365);
    sb.from('routes').select('id,date,tech_id,job_id,address,pay_code,pay_total,status')
      .eq('region', region)
      .eq('status', 'done')
      .gte('date', cutoff.toLocaleDateString('en-CA'))
      .then(({data}) => { setAllRoutes(data||[]); setLoadingHistory(false); });
  }, [period, region]);

  const today = new Date().toLocaleDateString('en-CA');
  const filtered = allRoutes.filter(r =>
    r.status === 'done' && (r.pay_total||0) > 0 &&
    (period === 'day' ? r.date === today : true)
  );

  // Group by tech
  const byTech: {[k:string]: {jobs:any[], total:number, codes:{[c:string]:number}}} = {};
  filtered.forEach(r => {
    if (!byTech[r.tech_id]) byTech[r.tech_id] = {jobs:[], total:0, codes:{}};
    byTech[r.tech_id].jobs.push(r);
    byTech[r.tech_id].total += (r.pay_total||0);
    const c = r.pay_code||'?';
    byTech[r.tech_id].codes[c] = (byTech[r.tech_id].codes[c]||0) + 1;
  });

  const techList = Object.entries(byTech).sort((a,b) => b[1].total - a[1].total);
  const grandTotal = techList.reduce((s,[,v]) => s + v.total, 0);
  const grandJobs = filtered.length;

  const periodLabels = {
    day:   es?'Hoy':'Today',
    week:  es?'Últimos 7 días':'Last 7 days',
    month: es?'Último mes':'Last 30 days',
    year:  es?'Último año':'Last year',
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={onBack} style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:8,padding:"6px 12px",color:C.dim,cursor:"pointer",fontSize:13}}>← Dashboard</button>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:900,color:"#00b8f5"}}>💰 {es?'Ganancias':'Earnings'}</div>
      </div>

      {/* Period selector */}
      <div style={{background:C.card,border:"1px solid #162e58",borderRadius:12,padding:"12px"}}>
        <div style={{fontSize:11,color:C.dim,marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>{es?'Período':'Period'}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(['day','week','month','year'] as string[]).map(p=>(
            <button key={p} onClick={()=>setPeriod(p as any)}
              style={{background:period===p?"#00b8f5":"#0e1e3a",border:`1px solid ${period===p?"#00b8f5":"#162e58"}`,borderRadius:8,padding:"8px 16px",color:period===p?"#04091c":C.text,fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,cursor:"pointer"}}>
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Summary totals */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{background:C.card,border:"1px solid #00b8f544",borderRadius:12,padding:"14px",textAlign:"center"}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color:"#00b8f5"}}>${grandTotal.toLocaleString()}</div>
          <div style={{fontSize:11,color:C.dim,textTransform:"uppercase"}}>{es?'Total generado':'Total earned'}</div>
        </div>
        <div style={{background:C.card,border:"1px solid #00dc8544",borderRadius:12,padding:"14px",textAlign:"center"}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color:"#00dc85"}}>{grandJobs}</div>
          <div style={{fontSize:11,color:C.dim,textTransform:"uppercase"}}>{es?'Trabajos completados':'Jobs completed'}</div>
        </div>
      </div>

      {/* Download buttons */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {(['day','week','month','year'] as const).map(p=>(
          <button key={p} onClick={()=>generateEarningsExcel(allRoutes,p as any,lang)}
            style={{flex:1,minWidth:80,background:"#00dc8518",border:"1px solid #00dc8544",borderRadius:8,padding:"9px 8px",color:"#00dc85",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
            <span>📥</span><span>{periodLabels[p]}</span>
          </button>
        ))}
      </div>

      {/* Per-tech breakdown */}
      {loadingHistory?(
        <div style={{textAlign:"center",padding:"30px",color:C.dim}}>⏳ {es?'Cargando datos...':'Loading data...'}</div>
      ):techList.length===0?(
        <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"30px",textAlign:"center",color:C.dim}}>{es?'Sin datos para este período':'No data for this period'}</div>
      ):techList.map(([techId, data])=>(
        <div key={techId} style={{background:C.card,border:"1px solid #162e58",borderRadius:12,padding:"14px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#0040a8,#00b8f5)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:"#fff",fontSize:12,flexShrink:0}}>{techId}</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:800,color:C.text}}>{getTechName(techId)}</div>
              <div style={{fontSize:11,color:C.dim}}>{data.jobs.length} {es?'trabajos':'jobs'}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:"#00b8f5"}}>${data.total.toLocaleString()}</div>
              <div style={{fontSize:10,color:C.dim}}>{data.jobs.length>0?`$${Math.round(data.total/data.jobs.length)} ${es?'prom':'avg'}`:''}</div>
            </div>
          </div>
          {/* Billing codes */}
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {Object.entries(data.codes).sort((a,b)=>b[1]-a[1]).map(([code,count])=>(
              <span key={code} style={{background:"#00b8f515",border:"1px solid #00b8f530",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#00b8f5",fontWeight:700}}>
                {code} ×{count}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export { EarningsView };
