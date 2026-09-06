// @ts-nocheck
import { useEffect } from 'react';
import { C } from '../config/theme';
import { SESSION_WARN } from './hooks';

function LangToggle({lang,setLang}){
  return(
    <div style={{display:"flex",gap:3,background:"#0e1e3a",borderRadius:20,padding:3,border:"1px solid #162e58"}}>
      {[["es","🇪🇸"],["en","🇺🇸"]].map(([l,f])=>(
        <button key={l} onClick={()=>setLang(l)}
          style={{background:lang===l?"#00b8f5":"none",border:"none",borderRadius:16,padding:"3px 9px",cursor:"pointer",fontSize:17,lineHeight:1,opacity:lang===l?1:0.4,transition:"all .2s"}}>
          {f}
        </button>
      ))}
    </div>
  );
}

function Toast({msg,onClose}){
  useEffect(()=>{const x=setTimeout(onClose,3500);return()=>clearTimeout(x);},[]);
  return(
    <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"#00dc85",color:"#04091c",padding:"12px 24px",borderRadius:12,fontWeight:700,fontSize:14,zIndex:9999,boxShadow:"0 4px 24px #00dc8560",fontFamily:"'Barlow',sans-serif",whiteSpace:"nowrap",maxWidth:"90vw"}}>
      {msg}
    </div>
  );
}

function Stat({label,value,color,emoji,sub}){
  return(
    <div style={{background:C.card,border:"1px solid #162e58",borderRadius:12,padding:"14px 16px",flex:1,minWidth:90}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
        <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color:color,lineHeight:1}}>{value}</span>
        <span style={{fontSize:18}}>{emoji}</span>
      </div>
      <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1.5}}>{label}</div>
      {sub&&<div style={{fontSize:11,color:C.muted,marginTop:3}}>{sub}</div>}
    </div>
  );
}

function ReportLangModal({t,onSelect,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#0b1830",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,border:"1px solid #162e58",textAlign:"center"}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:C.text,marginBottom:6}}>{t.reportLangTitle}</div>
        <div style={{display:"flex",gap:12,marginBottom:16,marginTop:16}}>
          {[["es","🇪🇸","Español"],["en","🇺🇸","English"]].map(([l,f,name])=>(
            <button key={l} onClick={()=>onSelect(l)}
              style={{flex:1,background:"linear-gradient(135deg,#0e1e3a,#0b2d5a)",border:"2px solid #00b8f5",borderRadius:14,padding:"18px 10px",cursor:"pointer"}}>
              <div style={{fontSize:36}}>{f}</div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:800,color:C.text,marginTop:6}}>{name}</div>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{background:"none",border:"1px solid #162e58",borderRadius:10,padding:"10px 24px",color:C.dim,cursor:"pointer",fontSize:13}}>{t.cancelLang}</button>
      </div>
    </div>
  );
}

function SessionWarning({ secondsLeft, lang }: { secondsLeft: number; lang: string }) {
  const es = lang === 'es';
  const m = Math.floor(secondsLeft / 60);
  const s = String(secondsLeft % 60).padStart(2, '0');
  const pct = Math.min((secondsLeft / SESSION_WARN) * 100, 100);
  const color = secondsLeft <= 20 ? '#ff3348' : '#ffbe00';
  return (
    <div style={{position:'fixed',bottom:20,right:16,zIndex:9998,background:'#0b1830',border:`2px solid ${color}`,borderRadius:14,padding:'12px 16px',minWidth:200,boxShadow:`0 0 20px ${color}44`}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <span style={{fontSize:18}}>⏱️</span>
        <div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,color,textTransform:'uppercase',letterSpacing:1}}>
            {es?'Sesión expira en':'Session expires in'}
          </div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color,lineHeight:1}}>
            {m}:{s}
          </div>
        </div>
      </div>
      <div style={{height:4,background:'#162e58',borderRadius:99,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:color,borderRadius:99,transition:'width 1s linear'}}/>
      </div>
      <div style={{fontSize:10,color:C.dim,marginTop:6}}>
        {es?'Mueve el mouse para mantener la sesión':'Move mouse to keep session active'}
      </div>
    </div>
  );
}

function LoggedOutScreen({lang, onDismiss}:{lang:string, onDismiss:()=>void}) {
  const es = lang === 'es';
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:"'Barlow',sans-serif"}}>
      <div style={{maxWidth:380,width:'100%',textAlign:'center'}}>
        <div style={{width:72,height:72,background:'#00dc8518',border:'2px solid #00dc8555',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 24px',fontSize:32}}>
          ✓
        </div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:900,color:C.text,marginBottom:8,letterSpacing:0.5}}>
          {es?'Sesión Cerrada':'Session Ended'}
        </div>
        <div style={{fontSize:14,color:C.dim,lineHeight:1.6,marginBottom:28}}>
          {es
            ? 'Tu sesión fue cerrada por inactividad. Todos tus datos están seguros.'
            : 'Your session was closed due to inactivity. All your data is safe.'}
        </div>
        <div style={{background:C.card,border:'1px solid #162e58',borderRadius:12,padding:'14px 18px',marginBottom:24}}>
          <div style={{fontSize:11,color:C.dim,textTransform:'uppercase',letterSpacing:1.5,marginBottom:4}}>
            {es?'Motivo':'Reason'}
          </div>
          <div style={{fontSize:13,color:'#ffbe00',fontWeight:600}}>
            {es?'5 minutos sin actividad detectada':'5 minutes of inactivity detected'}
          </div>
        </div>
        <button onClick={onDismiss}
          style={{background:'linear-gradient(135deg,#0040c0,#00b8f5)',border:'none',borderRadius:12,padding:'14px 32px',color:'#fff',fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,fontWeight:800,cursor:'pointer',letterSpacing:0.5,width:'100%'}}>
          {es?'INICIAR NUEVA SESIÓN':'START NEW SESSION'}
        </button>
        <div style={{fontSize:11,color:C.dim,marginTop:12}}>
          {es?'Redirigiendo automáticamente en 6 segundos...':'Redirecting automatically in 6 seconds...'}
        </div>
      </div>
    </div>
  );
}

export { LangToggle, Toast, Stat, ReportLangModal, SessionWarning, LoggedOutScreen };
