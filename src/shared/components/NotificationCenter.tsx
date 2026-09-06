import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearAppNotifications,
  getAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
  subscribeAppNotifications,
  type AppNotificationKind,
  type AppNotificationRecord,
} from '../../services/notification.service';
import { parseHash, buildHash } from '../../legacy/routing';

const COLORS: Record<AppNotificationKind, string> = {done:'#00dc85',notdone:'#ff6677',weather:'#ff8c62',pending:'#ffbe00',info:'#00b8f5'};
const ICONS: Record<AppNotificationKind, string> = {done:'✅',notdone:'❌',weather:'⛈️',pending:'⏰',info:'ℹ️'};

function defaultTarget(record: AppNotificationRecord): {tab?:string;sub?:string;hash?:string}{
  if(record.kind==='done') return {tab:'completed_jobs'};
  if(record.kind==='notdone') return {tab:'notdone_pool'};
  if(record.kind==='pending') return {tab:'pending_jobs'};
  if(record.kind==='weather') return {tab:'dashboard'};
  return {tab:'dashboard'};
}

function navigateToNotification(record: AppNotificationRecord){
  markAppNotificationRead(record.id);
  if(record.target?.hash){
    window.location.hash=record.target.hash.replace(/^#/,'');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  const parsed=parseHash();
  const target=record.target||defaultTarget(record);
  if(parsed.role==='supervisor'&&parsed.id){
    window.location.hash=buildHash('supervisor',parsed.id,target.tab||'dashboard',target.sub);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if(parsed.role==='tech'&&parsed.id){
    const techTab=record.kind==='pending'?'route':record.kind==='done'||record.kind==='notdone'?'history':'route';
    window.location.hash=buildHash('tech',parsed.id,target.tab||techTab,target.sub);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export function NotificationCenter() {
  const [open,setOpen]=useState(false);
  const [records,setRecords]=useState(()=>getAppNotifications());
  const [preview,setPreview]=useState(()=>null as AppNotificationRecord|null);
  const latestIdRef=useRef(records[0]?.id||'');
  const previewTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>subscribeAppNotifications(()=>{const next=getAppNotifications();const latest=next[0];setRecords(next);if(latest?.id&&latest.id!==latestIdRef.current){latestIdRef.current=latest.id;setPreview(latest);if(previewTimerRef.current)clearTimeout(previewTimerRef.current);previewTimerRef.current=setTimeout(()=>setPreview(null),7000);}}),[]);
  useEffect(()=>()=>{if(previewTimerRef.current)clearTimeout(previewTimerRef.current);},[]);
  const unread=useMemo(()=>records.filter(r=>!r.read).length,[records]);
  const openCenter=()=>{setOpen(true);};
  const activate=(record:AppNotificationRecord)=>{navigateToNotification(record);setRecords(getAppNotifications());setOpen(false);setPreview(null);};

  return <>
    {preview&&!open&&<button type="button" onClick={()=>activate(preview)} style={{position:'fixed',right:14,bottom:132,zIndex:1039,width:'min(390px,calc(100vw - 28px))',textAlign:'left',background:'#0e2344',border:`1px solid ${COLORS[preview.kind]}88`,borderRadius:13,padding:'11px 13px',boxShadow:'0 14px 40px rgba(0,0,0,.45)',cursor:'pointer',animation:'gfsNotificationIn .2s ease-out'}}>
      <div style={{display:'flex',gap:10,alignItems:'flex-start'}}><span style={{fontSize:21}}>{ICONS[preview.kind]}</span><span style={{flex:1,minWidth:0}}><span style={{display:'block',fontSize:12,fontWeight:900,color:COLORS[preview.kind]}}>{preview.title}</span><span style={{display:'block',fontSize:11,lineHeight:1.4,color:'#e8f1ff',marginTop:3,whiteSpace:'pre-wrap'}}>{preview.body}</span><span style={{display:'block',fontSize:9,color:'#8da4c9',marginTop:5}}>Tap to open the related page</span></span><span onClick={e=>{e.stopPropagation();setPreview(null);}} style={{color:'#8da4c9',fontSize:15,padding:'0 2px'}}>✕</span></div>
    </button>}
    <button type="button" aria-label="Open notification center" onClick={openCenter} style={{position:'fixed',right:14,bottom:74,zIndex:1040,width:48,height:48,borderRadius:15,border:'1px solid #00b8f577',background:'#071327ee',color:'#fff',boxShadow:'0 12px 34px rgba(0,0,0,.38)',cursor:'pointer',fontSize:21}}>🔔{unread>0&&<span style={{position:'absolute',right:-5,top:-5,minWidth:20,height:20,borderRadius:20,display:'grid',placeItems:'center',background:'#ff3348',border:'2px solid #04091c',fontSize:10,fontWeight:900,padding:'0 4px'}}>{unread>99?'99+':unread}</span>}</button>
    {open&&<div onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,zIndex:1060,background:'rgba(0,0,0,.55)',display:'flex',justifyContent:'flex-end'}}>
      <aside onClick={e=>e.stopPropagation()} style={{width:'min(430px,100%)',height:'100%',background:'#071327',borderLeft:'1px solid #162e58',boxShadow:'-18px 0 55px rgba(0,0,0,.38)',display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'17px 18px',borderBottom:'1px solid #162e58'}}><div><div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:900,color:'#e8f1ff'}}>🔔 Notifications</div><div style={{fontSize:10,color:'#8da4c9',marginTop:2}}>Tap an item to open the related section</div></div><button onClick={()=>setOpen(false)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:9,color:'#c8d8f4',padding:'7px 10px',cursor:'pointer'}}>✕</button></div>
        <div style={{display:'flex',gap:7,padding:'10px 14px',borderBottom:'1px solid #162e58'}}><button onClick={()=>{markAllAppNotificationsRead();setRecords(getAppNotifications());}} style={{background:'#00b8f518',border:'1px solid #00b8f555',borderRadius:8,color:'#00b8f5',padding:'6px 9px',fontSize:10,fontWeight:800,cursor:'pointer'}}>Mark all read</button><button onClick={()=>{clearAppNotifications();setRecords([]);}} style={{background:'#ff334818',border:'1px solid #ff334855',borderRadius:8,color:'#ff6677',padding:'6px 9px',fontSize:10,fontWeight:800,cursor:'pointer'}}>Clear history</button></div>
        <div style={{flex:1,overflowY:'auto',padding:12,display:'flex',flexDirection:'column',gap:8}}>{records.length===0?<div style={{margin:'auto',color:'#8da4c9',textAlign:'center',fontSize:12}}>No notifications yet.</div>:records.map(record=>{const color=COLORS[record.kind];return <button key={record.id} onClick={()=>activate(record)} style={{textAlign:'left',background:record.read?'#0b1830':'#0e2344',border:`1px solid ${color}55`,borderRadius:12,padding:'11px 12px',cursor:'pointer'}}><div style={{display:'flex',alignItems:'flex-start',gap:9}}><div style={{fontSize:20}}>{ICONS[record.kind]}</div><div style={{flex:1,minWidth:0}}><div style={{fontWeight:900,color,fontSize:12}}>{record.title}</div><div style={{color:'#e8f1ff',fontSize:11,lineHeight:1.45,marginTop:3,whiteSpace:'pre-wrap'}}>{record.body}</div><div style={{color:'#8da4c9',fontSize:9,marginTop:6}}>{new Date(record.createdAt).toLocaleString()} · Open related page →</div></div>{!record.read&&<span style={{width:8,height:8,borderRadius:99,background:color,marginTop:4}}/>}</div></button>;})}</div>
      </aside>
    </div>}
  </>;
}
