// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { SMS_MSG } from '../../../config/constants';
import { JOB_NOTES_ES, JOB_NOTES_EN } from '../../../config/regions';
import { NOTE_TYPES, PAY_CODES, REASONS_LIST, getTechName } from '../../../legacy/data';
import { compressImage, downloadPhotosZip } from '../../../services/photos.service';
import { generateEODPDF, generateJobPDF } from '../../../legacy/reporting';

function GpsConsentModal({ lang, onAccept }: { lang: string; onAccept: () => void }) {
  const es = lang === 'es';
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(4,9,28,0.97)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'#0b1830',border:'2px solid #00b8f5',borderRadius:20,padding:'28px 24px',width:'100%',maxWidth:420}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:'#fff',marginBottom:12}}>📍 {es ? 'Aviso de Ubicación GPS' : 'GPS Location Notice'}</div>
        <div style={{background:'#070f24',border:'1px solid #162e58',borderRadius:12,padding:14,marginBottom:18,fontSize:13,color:'#c8d8f4',lineHeight:1.7}}>
          {es ? 'Esta aplicación registra tu ubicación mientras la usas activamente para rutas y reportes operacionales.' : 'This app records your location while actively in use for routing and operational reporting.'}
        </div>
        <button onClick={onAccept} style={{width:'100%',background:'linear-gradient(135deg,#005c28,#00dc85)',border:'none',borderRadius:12,padding:16,color:'#04091c',fontWeight:900,cursor:'pointer'}}>
          {es ? '✅ Entiendo y Acepto — Continuar' : '✅ I Agree & Continue'}
        </button>
      </div>
    </div>
  );
}

export { GpsConsentModal };
