// @ts-nocheck
import { useEffect, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { getTechName } from '../../../legacy/data';
import { buildHash, parseHash } from '../../../legacy/routing';
import { downloadPhotosZip } from '../../../services/photos.service';
import { generateJobPDF } from '../../../legacy/reporting';
import { Lightbox } from '../../technician/components/Lightbox';

/* ── COMPLETED JOBS TAB (handles anchor scroll) ── */
function CompletedJobsTab({doneJobs, lang, supPhotos, onBack}:{doneJobs:any[], lang:string, supPhotos:any[], onBack:()=>void}) {
  useEffect(() => {
    const jobId = parseHash().sub;
    if (!jobId) return;
    const el = document.getElementById(`job-${jobId}`);
    if (el) { setTimeout(() => el.scrollIntoView({behavior:'smooth', block:'center'}), 120); }
  }, [doneJobs]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4,flexWrap:'wrap'}}>
        <button onClick={onBack} style={{background:"#0e1e3a",border:"1px solid #162e58",borderRadius:8,padding:"6px 12px",color:C.dim,cursor:"pointer",fontSize:13}}>← {lang==='es'?'Dashboard':'Dashboard'}</button>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:900,color:"#00dc85"}}>✅ {lang==='es'?`Trabajos Completados (${doneJobs.length})`:`Completed Jobs (${doneJobs.length})`}</div>
      </div>
      {doneJobs.length===0?(
        <div style={{background:C.card,border:"1px solid #162e58",borderRadius:14,padding:"40px",textAlign:"center",color:C.dim}}>{lang==='es'?'No hay trabajos completados aún':'No completed jobs yet'}</div>
      ):doneJobs.map((job)=>(<CompletedJobCard key={job.id} job={job} lang={lang} supPhotos={supPhotos}/>))}
    </div>
  );
}

/* ── COMPLETED JOB CARD ── */
function CompletedJobCard({job, lang, supPhotos}:{job:any, lang:string, supPhotos:any[]}) {
  const es = lang === 'es';
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadedPhotos, setLoadedPhotos] = useState<any[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number|null>(null);

  const preloadedPhotos = supPhotos.filter((p:any) => String(p.route_id||'') === String(job.id||'') || String(p.job_id||'') === String(job.job_id||''));
  const jobPhotos = loadedPhotos.length ? loadedPhotos : preloadedPhotos;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address+(job.city?', '+job.city:''))}`;

  const copyJobLink = () => {
    const parsed = parseHash();
    const region = parsed.id || 'miami';
    const url = `${window.location.origin}${window.location.pathname}${buildHash('supervisor', region, 'completed_jobs', job.id)}`;
    navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  };

  const fetchPhotos = async () => {
    if (loadedPhotos.length) return loadedPhotos;
    setLoadingDetails(true);
    try {
      let query = sb.from('job_photos').select('id,route_id,tech_id,job_id,photo_url,thumb_url,photo_type,note,created_at');
      const { data, error } = await query.or(`route_id.eq.${job.id},job_id.eq.${job.job_id}`).order('created_at',{ascending:true});
      if (error) {
        const fallback = await sb.from('job_photos').select('*').eq('route_id', job.id).order('created_at',{ascending:true});
        setLoadedPhotos(fallback.data || []);
        return fallback.data || [];
      }
      setLoadedPhotos(data || []);
      return data || [];
    } catch (e) {
      console.warn('Could not load job photos', e);
      return [];
    } finally {
      setLoadingDetails(false);
    }
  };

  const openJobDetails = async () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    if (next) await fetchPhotos();
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const photos = (await fetchPhotos()) || [];
      if (!photos.length) { alert(es?'No hay fotos para este trabajo.':'No photos for this job.'); return; }
      await downloadPhotosZip(photos, job, lang);
    } catch(e) { console.error(e); }
    setDownloading(false);
  };

  const techName = getTechName(job.tech_id);
  const addressText = `${job.address||''}${job.city?`, ${job.city}`:''}`.trim();

  return (
    <div id={`job-${job.id}`} style={{background:C.card, border:"1px solid #00dc8533", borderRadius:12, padding:"14px 16px", scrollMarginTop:80}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, flexWrap:"wrap"}}>
        <div style={{minWidth:0, flex:1}}>
          <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap"}}>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:17, fontWeight:900, color:"#00dc85", display:"flex", alignItems:"center", gap:4}}>
              #{job.job_id}
            </span>
            <span style={{background:"#00dc8522", borderRadius:20, padding:"2px 8px", fontSize:11, color:"#00dc85", fontWeight:700}}>{job.pay_code}</span>
            <button onClick={copyJobLink} title={es?"Copiar enlace":"Copy link"}
              style={{background:copied?"#00dc8522":"#162e58", border:`1px solid ${copied?"#00dc8555":"#2e4470"}`, borderRadius:20, padding:"2px 8px", color:copied?"#00dc85":C.dim, fontSize:10, fontWeight:700, cursor:"pointer", transition:"all .2s"}}>
              {copied?(es?"¡Copiado!":"Copied!"):"🔗 link"}
            </button>
          </div>
          <div style={{fontSize:15, color:'#ffffff', fontWeight:900, letterSpacing:0.1, marginBottom:4}}>{addressText || (es?'Sin dirección':'No address')}</div>
          <div style={{fontSize:12, color:'#ffffff', fontWeight:800, marginTop:3}}>👷 {techName} · Tech #{job.tech_id}</div>
        </div>
        <div style={{textAlign:"right", flexShrink:0}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif", fontSize:20, fontWeight:900, color:"#00dc85"}}>${job.pay_total}</div>
          <div style={{fontSize:10, color:C.dim}}>{job.date}</div>
        </div>
      </div>

      {job.job_note && <div style={{fontSize:11, color:"#00b8f5", marginTop:8, background:"#00b8f511", borderRadius:6, padding:"5px 8px"}}>📝 {job.job_note}</div>}

      <div style={{display:"flex", gap:6, marginTop:10, flexWrap:'wrap'}}>
        <button onClick={openJobDetails}
          style={{flex:1, minWidth:160, background:detailsOpen?"#00b8f533":"#00b8f518", border:"1px solid #00b8f5", borderRadius:8, padding:"8px 6px", color:"#ffffff", fontSize:11, fontWeight:800, textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:4, cursor:'pointer'}}>
          📋 {detailsOpen?(es?'Ocultar Trabajo':'Hide Job'):(es?'Ver Trabajo y Fotos':'View Job & Photos')}
        </button>
        <button onClick={handleDownload} disabled={downloading}
          style={{flex:1, minWidth:150, background:downloading?"#162e58":"#00dc8518", border:"1px solid #00dc8544", borderRadius:8, padding:"8px 6px", color:"#00dc85", fontSize:11, fontWeight:700, cursor:downloading?"wait":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4, opacity:downloading?0.6:1}}>
          {downloading?(es?"⏳ Preparando...":"⏳ Preparing..."):`📥 ${es?`Descargar Fotos${jobPhotos.length>0?` (${jobPhotos.length})`:''}`:`Download Photos${jobPhotos.length>0?` (${jobPhotos.length})`:''}`}`}
        </button>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          style={{background:"#0e1e3a", border:"1px solid #2e4470", borderRadius:8, padding:"8px 10px", color:"#9bb4e6", fontSize:12, fontWeight:700, textDecoration:'none', display:'flex', alignItems:'center', gap:4}}>
          🗺️ Maps
        </a>
        <button onClick={async()=>{const photos=await fetchPhotos();generateJobPDF(job,photos||[],techName,lang,null)}}
          style={{background:"#ff5a1f22", border:"1px solid #ff5a1f66", borderRadius:8, padding:"8px 10px", color:C.orange, fontSize:12, fontWeight:700, cursor:"pointer"}}>
          ⎙
        </button>
      </div>

      {detailsOpen && (
        <div style={{marginTop:12, background:'#07162c', border:'1px solid #162e58', borderRadius:10, padding:12}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8,marginBottom:10}}>
            <Info label={es?'Job ID':'Job ID'} value={`#${job.job_id || '—'}`}/>
            <Info label={es?'Técnico':'Technician'} value={`${techName} · #${job.tech_id || '—'}`}/>
            <Info label={es?'Dirección':'Address'} value={addressText || '—'}/>
            <Info label={es?'Fecha':'Date'} value={job.date || '—'}/>
            <Info label={es?'Pago':'Pay'} value={`$${job.pay_total ?? 0}`}/>
            <Info label={es?'Código':'Code'} value={job.pay_code || '—'}/>
          </div>
          {job.job_note && <div style={{fontSize:12,color:'#dceaff',background:'#00b8f511',border:'1px solid #00b8f522',borderRadius:8,padding:'8px 10px',marginBottom:10}}>📝 {job.job_note}</div>}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:8,flexWrap:'wrap'}}>
            <div style={{fontSize:13,fontWeight:900,color:'#fff'}}>📷 {es?'Fotos del trabajo':'Job photos'} {loadingDetails?' · loading…':`(${jobPhotos.length})`}</div>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#00b8f5',textDecoration:'none',fontWeight:700}}>🗺️ {es?'Abrir dirección en Maps':'Open address in Maps'}</a>
          </div>
          {jobPhotos.length === 0 ? (
            <div style={{fontSize:12,color:C.dim,padding:'12px',border:'1px dashed #2e4470',borderRadius:8,textAlign:'center'}}>{es?'No hay fotos guardadas para este trabajo.':'No photos saved for this job.'}</div>
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(88px,1fr))',gap:8}}>
              {jobPhotos.map((p:any,idx:number)=>(
                <button key={p.id||idx} onClick={()=>setLightboxIdx(idx)} style={{background:'#0e1e3a',border:'1px solid #2e4470',borderRadius:8,padding:4,cursor:'pointer',position:'relative',overflow:'hidden'}}>
                  <img src={p.thumb_url||p.photo_url} alt={p.note||''} style={{width:'100%',height:82,objectFit:'cover',borderRadius:6,display:'block'}}/>
                  <div style={{position:'absolute',left:6,bottom:6,background:((p.photo_type==='pht'||p.photo_type==='after')?'#00dc85':'#ffbe00'),color:'#04111f',fontWeight:900,fontSize:9,borderRadius:4,padding:'2px 5px'}}>{String(p.photo_type||'photo').toUpperCase()}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {lightboxIdx!==null && <Lightbox photos={jobPhotos} startIndex={lightboxIdx} onClose={()=>setLightboxIdx(null)}/>} 
    </div>
  );
}

function Info({label,value}:{label:string,value:any}){
  return (
    <div style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px 10px'}}>
      <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:0.6,color:C.dim,fontWeight:800}}>{label}</div>
      <div style={{fontSize:12,color:'#fff',fontWeight:800,marginTop:3,wordBreak:'break-word'}}>{String(value ?? '—')}</div>
    </div>
  );
}

export { CompletedJobsTab, CompletedJobCard };
