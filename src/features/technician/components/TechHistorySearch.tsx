// @ts-nocheck
import { useMemo, useState } from 'react';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { APP_FIRST_DATE } from '../../../config/constants';
import { createAuditLog } from '../../../services/audit.service';

const normalize = (value:any) => String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
const todayISO = () => new Date().toLocaleDateString('en-CA');

function dateDaysAgo(days:number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
}

function statusLabel(status:string, es:boolean) {
  const s = normalize(status);
  if (s === 'done') return es ? 'Completado' : 'Done';
  if (s === 'notdone') return es ? 'No realizado' : 'Not done';
  if (s === 'pending') return es ? 'Pendiente' : 'Pending';
  if (s === 'reopened') return es ? 'Reabierto' : 'Reopened';
  return String(status || 'pending').toUpperCase();
}

function TechHistorySearch({tech, lang, onReopenFromHistory}:{tech:any, lang:string, onReopenFromHistory?:()=>void}) {
  const es = lang === 'es';
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState(APP_FIRST_DATE);
  const [dateTo, setDateTo] = useState(todayISO());
  const [status, setStatus] = useState('all');
  const [results, setResults] = useState<any[]>([]);
  const [photoIndex, setPhotoIndex] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [usedCache, setUsedCache] = useState(false);
  const [reopeningKey, setReopeningKey] = useState('');

  const CACHE_KEY = `gfs_tech_history_${tech.id}`;

  const matches = (job:any, q:string) => {
    if (!q) return true;
    return [job.job_id, job.address, job.city, job.zip, job.phone, job.type, job.status,
      job.pay_code, job.reason, job.job_note, job.notes, job.date, job._source]
      .map(normalize).join(' | ').includes(q);
  };

  const buildPhotoIndex = (photos:any[]) => {
    const idx:any = {};
    (photos || []).forEach((p:any) => {
      const key = String(p.job_id || '').trim();
      if (!key) return;
      if (!idx[key]) idx[key] = { total:0, before:0, after:0 };
      idx[key].total += 1;
      if (p.photo_type === 'pht' || p.photo_type === 'after') idx[key].after += 1;
      else idx[key].before += 1;
    });
    return idx;
  };

  const safe = async (label:string, queryPromise:any) => {
    try {
      const res = await queryPromise;
      if (res?.error) return { label, data: [], error: res.error };
      return { label, data: res?.data || [], error: null };
    } catch (error:any) {
      return { label, data: [], error };
    }
  };

  const setQuickRange = (range:'today'|'7'|'30'|'all') => {
    const to = todayISO();
    setDateTo(to);
    if (range === 'today') setDateFrom(to);
    if (range === '7') setDateFrom(dateDaysAgo(7));
    if (range === '30') setDateFrom(dateDaysAgo(30));
    if (range === 'all') setDateFrom(APP_FIRST_DATE);
  };

  const search = async () => {
    setLoading(true); setSearched(true); setError(''); setSourceErrors([]); setUsedCache(false);
    try {
      const [routesRes, completedRes, reportsRes, snapshotsRes, photosRes] = await Promise.all([
        safe('routes', sb.from('routes').select('*').eq('tech_id', tech.id).gte('date', dateFrom).lte('date', dateTo).order('date',{ascending:false}).limit(700)),
        safe('completed_jobs', sb.from('completed_jobs').select('*').eq('tech_id', tech.id).gte('date', dateFrom).lte('date', dateTo).order('date',{ascending:false}).limit(700)),
        safe('not_done_reports', sb.from('not_done_reports').select('*').eq('tech_id', tech.id).gte('date', dateFrom).lte('date', dateTo).order('date',{ascending:false}).limit(700)),
        safe('daily_route_snapshots', sb.from('daily_route_snapshots').select('id,date,region,snapshot').gte('date', dateFrom).lte('date', dateTo).order('date',{ascending:false}).limit(240)),
        safe('job_photos', sb.from('job_photos').select('id,tech_id,job_id,photo_type,created_at').eq('tech_id', tech.id).order('created_at',{ascending:false}).limit(1200)),
      ]);

      const errors = [routesRes, completedRes, reportsRes, snapshotsRes, photosRes]
        .filter((r:any)=>r.error)
        .map((r:any)=>`${r.label}: ${r.error?.message || 'failed'}`);
      setSourceErrors(errors);

      if ([routesRes, completedRes, reportsRes, snapshotsRes].every((r:any)=>r.error)) {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached?.results) {
          setResults(cached.results);
          setPhotoIndex(cached.photoIndex || {});
          setUsedCache(true);
          setError(es ? 'Sin conexión o Supabase no respondió. Mostrando último historial guardado en este dispositivo.' : 'Offline or Supabase did not respond. Showing last saved history on this device.');
          setLoading(false);
          return;
        }
        throw new Error(es ? 'No se pudo cargar ninguna fuente del historial.' : 'No history source could be loaded.');
      }

      const rows:any[]=[];
      (routesRes.data||[]).forEach((r:any)=>rows.push({...r,_source:'active/history route',_canReopen:true}));
      (completedRes.data||[]).forEach((r:any)=>rows.push({...r,status:'done',_source:'completed archive',_canReopen:true}));
      (reportsRes.data||[]).filter((r:any)=>r.status!=='eod').forEach((r:any)=>rows.push({
        ...r,
        status:r.status === 'reopened' ? 'reopened' : 'notdone',
        job_note:r.notes||'',
        _source:'not-done report',
        _canReopen:true,
      }));
      (snapshotsRes.data||[]).forEach((snap:any)=>{
        (snap.snapshot||[])
          .filter((j:any)=>String(j.tech_id)===String(tech.id))
          .forEach((j:any,idx:number)=>rows.push({
            ...j,
            id:j.id||`${snap.id}-${idx}`,
            date:j.date||snap.date,
            _source:'route snapshot',
            _snapshot_id:snap.id,
            _canReopen:true,
          }));
      });

      const dedupe = new Map<string, any>();
      rows.forEach((job:any)=>{
        const key=[job.route_id||job.id||'', job.job_id||'', job.date||'', job.status||'', job.pay_code||'', job.reason||''].join('|');
        if(!dedupe.has(key)) dedupe.set(key,job);
      });

      const q=normalize(query);
      const finalRows=[...dedupe.values()]
        .filter((job:any)=>status==='all'||normalize(job.status)===normalize(status))
        .filter((job:any)=>matches(job,q))
        .sort((a:any,b:any)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.created_at||'').localeCompare(String(a.created_at||'')))
        .slice(0,800);
      const pIndex = buildPhotoIndex(photosRes.data || []);
      setPhotoIndex(pIndex);
      setResults(finalRows);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt:new Date().toISOString(), results: finalRows.slice(0,400), photoIndex:pIndex })); } catch {}
    } catch (e:any) {
      console.error(e);
      setError(e?.message || (es?'No se pudo cargar el historial.':'History could not be loaded.'));
      setResults([]);
    }
    setLoading(false);
  };

  const reopenFromHistory = async (job:any) => {
    const jobId = String(job.job_id || '').trim();
    if (!jobId) return;
    const ok = window.confirm(es
      ? `¿Reabrir el trabajo ${jobId} en tu ruta de hoy para poder completarlo o corregirlo?`
      : `Reopen job ${jobId} into today's route so you can complete or correct it?`);
    if (!ok) return;
    const key = `${job._source}-${job.id}-${jobId}`;
    setReopeningKey(key);
    try {
      const today = todayISO();
      const existing = await sb.from('routes')
        .select('id')
        .eq('tech_id', tech.id)
        .eq('job_id', jobId)
        .eq('date', today)
        .maybeSingle();
      if (existing?.error && existing.error.code !== 'PGRST116') throw existing.error;

      let routeId = existing?.data?.id;
      if (routeId) {
        const upd = await sb.from('routes').update({
          status:'pending', pay_code:null, pay_total:0, reason:null,
          job_note: job.job_note || job.notes || 'Reopened from technician history',
        }).eq('id', routeId).eq('tech_id', tech.id);
        if (upd?.error) throw upd.error;
      } else {
        const orderRes = await sb.from('routes')
          .select('order_num')
          .eq('tech_id', tech.id)
          .eq('date', today)
          .order('order_num', { ascending:false })
          .limit(1);
        const nextOrder = Number(orderRes?.data?.[0]?.order_num || 0) + 1;
        const insert = await sb.from('routes').insert({
          date: today,
          tech_id: String(tech.id),
          job_id: jobId,
          address: job.address || '',
          city: job.city || '',
          zip: job.zip || job.zone || '',
          phone: job.phone || '',
          type: job.type || '',
          status: 'pending',
          pay_code: null,
          pay_total: 0,
          reason: null,
          job_note: job.job_note || job.notes || `Reopened from ${job._source || 'history'} (${job.date || 'no date'})`,
          order_num: nextOrder,
          region: tech.region || job.region || 'miami',
        }).select('id').maybeSingle();
        if (insert?.error) throw insert.error;
        routeId = insert?.data?.id;
      }

      await sb.from('completed_jobs').delete().eq('tech_id', tech.id).eq('job_id', jobId).eq('date', job.date || today).catch(()=>({error:null}));
      await sb.from('not_done_reports').update({status:'reopened'}).eq('tech_id', tech.id).eq('job_id', jobId).catch(()=>({error:null}));
      await createAuditLog({
        action:'history_job_reopened_by_technician', entity:'route', entityId:routeId || job.id,
        metadata:{region:tech.region||job.region||'miami',actorRole:'technician',actorName:tech.name,tech_id:tech.id,job_id:jobId,source:job._source,source_date:job.date,summary:`History job ${jobId} reopened by tech ${tech.id}`}
      }).catch(()=>{});
      if (onReopenFromHistory) onReopenFromHistory();
      setError('');
      window.setTimeout(()=>search(), 350);
    } catch (e:any) {
      console.error('[TechHistorySearch] reopen failed', e);
      setError(`❌ ${e?.message || (es?'No se pudo reabrir el trabajo.':'Could not reopen job.')}`);
    }
    setReopeningKey('');
  };

  const doneN=results.filter(r=>normalize(r.status)==='done').length;
  const notDoneN=results.filter(r=>normalize(r.status)==='notdone').length;
  const pendingN=results.filter(r=>normalize(r.status)==='pending').length;
  const earned=results.filter(r=>normalize(r.status)==='done').reduce((s,r)=>s+(Number(r.pay_total)||0),0);
  const statusColor=(s:string)=>normalize(s)==='done'?'#00dc85':normalize(s)==='notdone'?'#ff3348':normalize(s)==='reopened'?'#9d5fff':'#ffbe00';

  const photoIssues = useMemo(() => results.filter((job:any) => {
    const p = photoIndex[String(job.job_id || '')] || { total:0, before:0, after:0 };
    if (normalize(job.status) === 'done') return p.before === 0 || p.after === 0;
    if (normalize(job.status) === 'notdone') return p.total === 0;
    return false;
  }).length, [results, photoIndex]);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:16}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:900,color:C.text,marginBottom:4}}>🕘 {es?'Mis trabajos anteriores':'My Previous Jobs'}</div>
        <div style={{fontSize:12,color:C.dim,marginBottom:14}}>{es?'Solo muestra trabajos asignados a tu número de técnico. Ahora puedes reabrir Customer Absent u otros trabajos desde el historial.':'Only jobs assigned to your technician number are shown. You can now reopen Customer Absent or other jobs from history.'}</div>
        <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}
          placeholder={es?'Job #, dirección, ciudad, teléfono, billing code...':'Job #, address, city, phone, billing code...'}
          style={{width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:10,padding:'12px 14px',color:C.text,fontSize:14,outline:'none',marginBottom:10}}/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:10}}>
          {[
            ['today',es?'Hoy':'Today'],['7',es?'7 días':'7 days'],['30',es?'30 días':'30 days'],['all',es?'Todo':'All']
          ].map(([id,label])=><button key={id} onClick={()=>setQuickRange(id as any)} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px 5px',color:C.dim,fontSize:10,fontWeight:800,cursor:'pointer'}}>{label}</button>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,marginBottom:10}}>
          <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:4}}>{es?'Desde':'From'}</label><input type='date' value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:8,color:C.text}}/></div>
          <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:4}}>{es?'Hasta':'To'}</label><input type='date' value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:8,color:C.text}}/></div>
          <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:4}}>{es?'Estado':'Status'}</label><select value={status} onChange={e=>setStatus(e.target.value)} style={{width:'100%',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:8,color:C.text}}><option value='all'>{es?'Todos':'All'}</option><option value='done'>{es?'Completados':'Done'}</option><option value='notdone'>{es?'No realizados':'Not completed'}</option><option value='pending'>{es?'Pendientes':'Pending'}</option><option value='reopened'>{es?'Reabiertos':'Reopened'}</option></select></div>
        </div>
        <button onClick={search} disabled={loading} style={{width:'100%',background:'linear-gradient(135deg,#0040c0,#00b8f5)',border:'none',borderRadius:10,padding:12,color:'#fff',fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:900,cursor:'pointer',opacity:loading ? 0.7 : 1}}>{loading?(es?'Buscando...':'Searching...'):(es?'Buscar mis trabajos':'Search my jobs')}</button>
        {usedCache&&<div style={{marginTop:10,color:'#ffbe00',fontSize:11}}>📦 {es?'Resultado cargado desde caché local.':'Loaded from local cache.'}</div>}
        {sourceErrors.length>0&&<div style={{marginTop:10,background:'#ffbe0012',border:'1px solid #ffbe0044',borderRadius:8,padding:'8px 10px',color:'#ffcf55',fontSize:10,lineHeight:1.4}}>⚠️ {es?'Algunas fuentes no respondieron, pero se muestran los datos disponibles.':'Some sources did not respond, but available data is shown.'}<br/>{sourceErrors.slice(0,3).join(' · ')}</div>}
        {error&&<div style={{marginTop:10,color:error.startsWith('❌')?'#ff6677':'#ffbe00',fontSize:12}}>⚠️ {error}</div>}
      </div>

      {searched&&results.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
        {[{l:'Done',v:doneN,c:'#00dc85'},{l:es?'No realizados':'Not done',v:notDoneN,c:'#ff3348'},{l:es?'Pendientes':'Pending',v:pendingN,c:'#ffbe00'},{l:es?'Fotos incompletas':'Photo gaps',v:photoIssues,c:'#9d5fff'},{l:es?'Generado':'Earned',v:`$${earned.toLocaleString()}`,c:'#00b8f5'}].map(s=><div key={s.l} style={{background:C.card,border:`1px solid ${s.c}44`,borderRadius:10,padding:9,textAlign:'center'}}><div style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:8,color:C.dim}}>{s.l}</div></div>)}
      </div>}

      {searched&&<div style={{fontSize:12,color:C.dim}}>{results.length} {es?'resultados':'results'}</div>}
      {searched&&results.length===0&&<div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:30,textAlign:'center',color:C.dim}}>{es?'No se encontraron trabajos en ese período.':'No jobs found for that period.'}</div>}
      {results.map((job:any)=>{
        const color=statusColor(job.status);
        const p = photoIndex[String(job.job_id || '')] || { total:0, before:0, after:0 };
        const key = `${job._source}-${job.id}-${job.job_id}`;
        const canReopen = job._canReopen && normalize(job.status) !== 'pending';
        return <div key={key} style={{background:C.card,border:`1px solid ${color}33`,borderRadius:12,padding:'12px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((job.address||'')+(job.city?', '+job.city:''))}`} target='_blank' rel='noopener noreferrer' style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:900,color:'#00b8f5',textDecoration:'none'}}>#{job.job_id||'—'} ↗</a>
                <span style={{background:`${color}22`,border:`1px solid ${color}55`,borderRadius:20,padding:'1px 8px',fontSize:10,color,fontWeight:800}}>{statusLabel(job.status, es)}</span>
                <span style={{fontSize:10,color:C.dim}}>{job.date||'—'}</span>
              </div>
              <div style={{fontSize:12,color:C.text,fontWeight:600}}>{job.address||'—'}{job.city?`, ${job.city}`:''}</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                {job.pay_code&&<span style={{fontSize:10,color:'#00dc85'}}>💳 {job.pay_code}</span>}
                {job.phone&&<span style={{fontSize:10,color:C.dim}}>📞 {job.phone}</span>}
                <span style={{fontSize:10,color:'#9d5fff'}}>🗃️ {job._source}</span>
                <span style={{fontSize:10,color:p.total?'#00dc85':'#ff6677'}}>📷 B{p.before} / A{p.after}</span>
              </div>
              {(job.reason||job.job_note||job.notes)&&<div style={{fontSize:10,color:C.dim,marginTop:6,background:'#0e1e3a',borderRadius:7,padding:'5px 8px'}}>{job.reason||job.job_note||job.notes}</div>}
              {canReopen&&<button disabled={reopeningKey===key} onClick={()=>reopenFromHistory(job)} style={{width:'100%',marginTop:8,background:'#ffbe0022',border:'1px solid #ffbe00',borderRadius:8,padding:'9px 8px',color:'#ffbe00',fontWeight:900,cursor:reopeningKey===key?'default':'pointer',fontSize:11}}>
                {reopeningKey===key?(es?'Reabriendo...':'Reopening...'):`↩️ ${es?'Reabrir en ruta de hoy':'Reopen into today route'}`}
              </button>}
            </div>
            {Number(job.pay_total)>0&&<div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:'#00dc85'}}>${Number(job.pay_total).toFixed(0)}</div>}
          </div>
        </div>;
      })}
    </div>
  );
}

export { TechHistorySearch };
