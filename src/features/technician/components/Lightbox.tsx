// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG } from '../../../config/constants';
import { JOB_NOTES_ES, JOB_NOTES_EN } from '../../../config/regions';
import { NOTE_TYPES, PAY_CODES, REASONS_LIST, getTechName } from '../../../legacy/data';
import { compressImage, downloadPhotosZip } from '../../../services/photos.service';
import { generateEODPDF, generateJobPDF } from '../../../legacy/reporting';

/* ── LIGHTBOX ── */
function Lightbox({photos, startIndex=0, onClose}){
  const[idx,setIdx]=useState(startIndex);
  const photo=photos[idx];
  useEffect(()=>{
    const handler=(e)=>{
      if(e.key==='Escape')onClose();
      if(e.key==='ArrowRight')setIdx(i=>Math.min(i+1,photos.length-1));
      if(e.key==='ArrowLeft')setIdx(i=>Math.max(i-1,0));
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[onClose,photos.length]);
  if(!photo)return null;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.96)",zIndex:999,display:"flex",flexDirection:"column",touchAction:"none"}} onClick={onClose}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:"rgba(4,9,28,0.9)",flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,color:"#fff"}}>
          📷 {idx+1} / {photos.length}
          {photo.photo_type&&<span style={{background:(photo.photo_type==='evidence'||photo.photo_type==='before')?"#ffbe0033":"#00dc8533",borderRadius:20,padding:"1px 8px",fontSize:10,color:(photo.photo_type==='evidence'||photo.photo_type==='before')?"#ffbe00":"#00dc85",fontWeight:700,marginLeft:8}}>{(photo.photo_type==='evidence'||photo.photo_type==='before')?'ANTES':'DESPUÉS'}</span>}
          {photo.note&&<span style={{color:"#00b8f5",marginLeft:10,fontWeight:400}}>— {photo.note}</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href={photo.photo_url} download target="_blank" rel="noreferrer"
            style={{background:"#00dc8522",border:"1px solid #00dc8544",borderRadius:8,padding:"6px 12px",color:"#00dc85",fontSize:12,fontWeight:700,textDecoration:"none",cursor:"pointer"}}
            onClick={e=>e.stopPropagation()}>⬇ Descargar</a>
          <button onClick={onClose} style={{background:"#ff334822",border:"1px solid #ff334844",borderRadius:8,padding:"6px 12px",color:"#ff3348",fontSize:14,fontWeight:700,cursor:"pointer"}}>✕</button>
        </div>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        {photos.length>1&&idx>0&&(
          <button onClick={()=>setIdx(i=>i-1)} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",background:"rgba(4,9,28,0.8)",border:"1px solid #162e58",borderRadius:"50%",width:44,height:44,color:"#fff",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>‹</button>
        )}
        <img src={photo.photo_url} alt={photo.note||'photo'} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:4,userSelect:"none"}} onClick={e=>e.stopPropagation()}/>
        {photos.length>1&&idx<photos.length-1&&(
          <button onClick={()=>setIdx(i=>i+1)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"rgba(4,9,28,0.8)",border:"1px solid #162e58",borderRadius:"50%",width:44,height:44,color:"#fff",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>›</button>
        )}
      </div>
      {photos.length>1&&(
        <div style={{display:"flex",gap:6,padding:"10px 12px",background:"rgba(4,9,28,0.9)",overflowX:"auto",flexShrink:0}} onClick={e=>e.stopPropagation()}>
          {photos.map((p,i)=>(
            <div key={p.id||i} onClick={()=>setIdx(i)} style={{position:"relative",flexShrink:0}}>
              <img src={p.photo_url} alt="" style={{width:56,height:56,objectFit:"cover",borderRadius:6,cursor:"pointer",border:i===idx?"2px solid #00b8f5":"2px solid transparent",opacity:i===idx?1:0.55,transition:"all .15s"}}/>
              <div style={{position:"absolute",top:2,left:2,background:(p.photo_type==='pht'||p.photo_type==='after')?"#00dc85":"#ffbe00",borderRadius:3,padding:"1px 4px",fontSize:8,fontWeight:700,color:"#04091c"}}>{(p.photo_type==='pht'||p.photo_type==='after')?'D':'A'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { Lightbox };
