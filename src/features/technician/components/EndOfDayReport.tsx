// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG } from '../../../config/constants';
import { JOB_NOTES_ES, JOB_NOTES_EN } from '../../../config/regions';
import { NOTE_TYPES, PAY_CODES, REASONS_LIST, getTechName } from '../../../legacy/data';
import { compressImage, downloadPhotosZip } from '../../../services/photos.service';
import { generateEODPDF, generateJobPDF } from '../../../legacy/reporting';

/* ── END OF DAY REPORT ── */
function EndOfDayReport({tech,jobs,onClose,onConfirm,t,photos,lang}){
  const done=jobs.filter(j=>j.status==='done');
  const notDone=jobs.filter(j=>j.status==='notdone');
  const pending=jobs.filter(j=>j.status==='pending');
  const earned=done.reduce((s,j)=>s+(j.pay_total||0),0);
  return(
    <div style={{position:"fixed",inset:0,background:"#000d",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#0b1830",borderRadius:20,padding:"24px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",border:"1px solid #162e58"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:48}}>📊</div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:26,fontWeight:900,color:C.text,marginTop:8}}>{t.eodTitle}</div>
          <div style={{fontSize:12,color:C.dim,marginTop:4}}>{tech.name} · #{tech.id}</div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[{v:done.length,l:t.doneLabel,c:"#00dc85",e:"✅"},{v:notDone.length,l:t.notDoneLabel,c:"#ff3348",e:"❌"},{v:pending.length,l:t.pendingLabel,c:"#ffbe00",e:"⏳"}].map(s=>(
            <div key={s.l} style={{flex:1,background:`${s.c}18`,border:`1px solid ${s.c}44`,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color:s.c}}>{s.v}</div>
              <div style={{fontSize:10,color:C.dim,textTransform:"uppercase"}}>{s.e} {s.l}</div>
            </div>
          ))}
        </div>
        {done.length>0&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,color:"#00dc85",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{t.eodDoneSection}</div>
            {done.map(j=>(
              <div key={j.id} style={{background:"#00dc8512",border:"1px solid #00dc8533",borderRadius:8,padding:"8px 12px",marginBottom:6}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:800,color:"#00dc85"}}>#{j.job_id}</div>
                <div style={{fontSize:12,color:C.text}}>{j.address}</div>
                {j.job_note&&<div style={{fontSize:11,color:"#00b8f5",marginTop:2}}>📝 {j.job_note}</div>}
              </div>
            ))}
          </div>
        )}
        {notDone.length>0&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,color:"#ff3348",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{t.eodNotDoneSection}</div>
            {notDone.map(j=>(
              <div key={j.id} style={{background:"#ff334812",border:"1px solid #ff334833",borderRadius:8,padding:"8px 12px",marginBottom:6}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:800,color:"#ff3348"}}>#{j.job_id}</div>
                <div style={{fontSize:12,color:C.text}}>{j.address}</div>
                <div style={{fontSize:11,color:"#ff3348",marginTop:2}}>{j.reason}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>{generateEODPDF(tech,jobs,photos||[],lang||'es',null);}} style={{background:C.card2,border:"1px solid #162e58",borderRadius:10,padding:"12px",color:C.text,cursor:"pointer",fontWeight:600,fontSize:13}}>📄 PDF</button>
          <button onClick={onClose} style={{flex:1,background:"none",border:"1px solid #162e58",borderRadius:12,padding:"14px",color:C.dim,cursor:"pointer",fontWeight:600}}>{t.cancelBtn}</button>
          <button onClick={onConfirm} style={{flex:2,background:"linear-gradient(135deg,#006620,#00dc85)",border:"none",borderRadius:12,padding:"14px",color:"#04091c",fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,fontWeight:800,cursor:"pointer"}}>{t.eodSendBtn}</button>
        </div>
      </div>
    </div>
  );
}

export { EndOfDayReport };
