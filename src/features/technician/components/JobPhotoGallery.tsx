// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG } from '../../../config/constants';
import { JOB_NOTES_ES, JOB_NOTES_EN } from '../../../config/regions';
import { NOTE_TYPES, PAY_CODES, REASONS_LIST, getTechName } from '../../../legacy/data';
import { compressImage, downloadPhotosZip } from '../../../services/photos.service';
import { generateEODPDF, generateJobPDF } from '../../../legacy/reporting';
import { Lightbox } from './Lightbox';

/* ── JOB PHOTO GALLERY — supervisor view with ZIP download ── */
function JobPhotoGallery({photos, job, lang}){
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const es = lang === 'es';

  if (!photos || photos.length === 0) {
    return (
      <div style={{background:"#0a1428",border:"1px dashed #162e58",borderRadius:10,padding:"18px",textAlign:"center",color:"#5a7aaa",fontSize:12}}>
        {es ? 'Sin fotos para este trabajo' : 'No photos for this job'}
      </div>
    );
  }

  const before = photos.filter(p => p.photo_type === 'evidence' || p.photo_type === 'before' || !p.photo_type);
  const after = photos.filter(p => p.photo_type === 'pht' || p.photo_type === 'after');

  const handleDownloadZip = async () => {
    setDownloading(true);
    try { await downloadPhotosZip(photos, job, lang); }
    catch(e) { console.error('ZIP error:', e); }
    setDownloading(false);
  };

  const renderGrid = (ps, label, color) => ps.length > 0 && (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{label} ({ps.length})</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
        {ps.map((p, i) => (
          <div key={p.id||i} onClick={()=>setLightboxIdx(photos.indexOf(p))}
            style={{position:"relative",borderRadius:8,overflow:"hidden",border:`1px solid ${color}44`,cursor:"pointer",aspectRatio:"1",background:"#0a1428"}}>
            <img src={p.photo_url} alt={p.note||''} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
              onMouseEnter={e=>e.target.style.opacity=".8"} onMouseLeave={e=>e.target.style.opacity="1"}
              onError={e=>{e.target.style.display="none";}}/>
            {p.note&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,0.85))",padding:"16px 5px 5px",fontSize:10,color:"#e0e8ff",lineHeight:1.2}}>{p.note}</div>}
            <div style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.6)",borderRadius:4,padding:"1px 5px",fontSize:10,color:"#fff"}}>{i+1}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {lightboxIdx!==null&&<Lightbox photos={photos} startIndex={lightboxIdx} onClose={()=>setLightboxIdx(null)}/>}
      <div style={{marginTop:8}}>
        {renderGrid(before, es?"📷 ANTES":"📷 BEFORE","#ffbe00")}
        {renderGrid(after, es?"📷 DESPUÉS":"📷 AFTER","#00dc85")}
        <div style={{display:"flex",gap:6,marginTop:6}}>
          <button onClick={()=>setLightboxIdx(0)}
            style={{flex:1,background:"#9d5fff22",border:"1px solid #9d5fff44",borderRadius:6,padding:"7px",color:"#9d5fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>
            🔍 {es?`Ver todas (${photos.length})`:`View all (${photos.length})`}
          </button>
          <button onClick={handleDownloadZip} disabled={downloading}
            style={{flex:1,background:downloading?"#162e58":"#00dc8518",border:"1px solid #00dc8544",borderRadius:6,padding:"7px",color:"#00dc85",fontSize:11,fontWeight:700,cursor:downloading?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
            {downloading?(es?"⏳ Preparando...":"⏳ Preparing..."):`⬇ ${es?"Descargar ZIP":"Download ZIP"}`}
          </button>
        </div>
      </div>
    </>
  );
}

export { JobPhotoGallery };
