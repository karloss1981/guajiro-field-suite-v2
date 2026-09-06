// @ts-nocheck
import * as XLSX from 'xlsx';
import { getTechName } from './data';
import { APP_VERSION } from '../config/constants';

const fmtDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const safeName = (s) => String(s||'').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_-]/g,'');

function showPDF(html, filename) {
  const existing = document.getElementById('mfs-pdf-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mfs-pdf-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;background:#04091c';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0d1b3e;border-bottom:1px solid #162e58;flex-shrink:0;gap:8px;flex-wrap:wrap';
  bar.innerHTML = `<span style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#c8d8f4">📡 ${filename||'Reporte'}</span><div style="display:flex;gap:6px"><button id="mfs-btn-print" style="background:#005c28;border:none;border-radius:8px;padding:8px 14px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🖨️ Imprimir / PDF</button><button id="mfs-btn-dl" style="background:#00b8f5;border:none;border-radius:8px;padding:8px 12px;color:#04091c;font-size:12px;font-weight:700;cursor:pointer">⬇ Descargar</button><button id="mfs-btn-close" style="background:none;border:1px solid #ff334888;border-radius:8px;padding:8px 12px;color:#ff3348;font-size:13px;font-weight:700;cursor:pointer">✕ Cerrar</button></div>`;
  const iframe = document.createElement('iframe');
  iframe.id = 'mfs-iframe';
  iframe.style.cssText = 'flex:1;border:none;background:#fff;width:100%';
  iframe.srcdoc = html;
  overlay.appendChild(bar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  document.getElementById('mfs-btn-close').onclick = () => overlay.remove();
  document.getElementById('mfs-btn-print').onclick = () => iframe.contentWindow?.print();
  document.getElementById('mfs-btn-dl').onclick = () => {
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filename||'marlins-report').replace(/\s+/g,'_')+'.html';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  };
}

function openReportWindow() { return {_stub:true}; }

function fillReportWindow(_w, html, filename) { showPDF(html, filename); }

function buildPDFHTML(title, techLine, sections) {
  const css = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px 24px 80px}.hdr{background:#0d1b3e;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start}.hdr-left h1{font-size:18px;font-weight:900;letter-spacing:1px}.hdr-left p{font-size:11px;opacity:.65;margin-top:3px}.hdr-right{text-align:right}.badge{background:#ff5a1f;color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;display:inline-block}.date{font-size:10px;opacity:.6;margin-top:4px}.section{border:1px solid #dde3ef;border-radius:8px;margin-bottom:18px;overflow:hidden;page-break-inside:avoid}.sec-title{background:#f0f4fb;padding:9px 14px;font-size:13px;font-weight:700;color:#0d1b3e;border-bottom:1px solid #dde3ef}.sec-body{padding:14px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.info-item{background:#f8faff;border-radius:6px;padding:8px 10px}.info-label{font-size:9px;color:#5a7aaa;text-transform:uppercase;letter-spacing:1.2px}.info-value{font-size:13px;font-weight:600;color:#0d1b3e;margin-top:2px}.status-done{color:#005c28;font-weight:700}.status-nd{color:#b30000;font-weight:700}.status-pend{color:#7a5c00;font-weight:700}.photo-grid{display:flex;flex-direction:column;gap:18px;margin-top:12px}.photo-item{border:1px solid #dde3ef;border-radius:8px;overflow:hidden;background:#f8faff;page-break-inside:avoid}.photo-type-badge{background:#0d1b3e;color:#fff;padding:4px 12px;font-size:10px;font-weight:700;letter-spacing:1px}.photo-item img{width:100%;max-height:480px;object-fit:contain;display:block;background:#f0f4fb}.photo-note{background:#f0f4fb;padding:6px 10px;font-size:11px;color:#5a7aaa;border-top:1px solid #dde3ef}.no-photos{color:#5a7aaa;font-size:12px;font-style:italic;padding:6px 0}.job-card{border:1px solid #dde3ef;border-radius:8px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid}.job-card-hdr{background:#0d1b3e;color:#fff;padding:9px 14px;display:flex;justify-content:space-between;align-items:center}.job-num{font-size:15px;font-weight:900}.job-type{font-size:10px;opacity:.6;margin-left:8px}.job-body{padding:12px 14px}.job-addr{font-size:13px;color:#0d1b3e;margin-bottom:3px}.job-phone{font-size:11px;color:#5a7aaa}.job-reason{font-size:11px;color:#b30000;margin-top:4px}.stat-row{display:flex;gap:10px;margin-bottom:16px}.stat-box{flex:1;background:#f0f4fb;border-radius:8px;padding:12px;text-align:center}.stat-val{font-size:28px;font-weight:900}.stat-lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#5a7aaa;margin-top:3px}.earned-val{color:#005c28}.footer{text-align:center;margin-top:24px;font-size:9px;color:#aaa;border-top:1px solid #eef0f5;padding-top:12px}.printbar{position:fixed;bottom:0;left:0;right:0;background:#0d1b3e;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;z-index:999;box-shadow:0 -4px 20px rgba(0,0,0,.5)}.printbtn{background:#ff5a1f;color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:15px;font-weight:700;cursor:pointer}.printbtn:disabled{background:#333;color:#666;cursor:not-allowed}.imgcount{color:#aac;font-size:12px}@media print{.printbar{display:none}body{padding:8px}}`;
  const body = sections.map(s=>`<div class="section"><div class="sec-title">${s.title}</div><div class="sec-body">${s.content}</div></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${css}</style></head><body><div class="hdr"><div class="hdr-left"><h1>📡 Guajiro & Sons</h1><p>ITG · Guajiro & Sons · Miami-Dade & Broward</p><p>${techLine}</p></div><div class="hdr-right"><div class="badge">${title}</div><div class="date">${fmtDate()}</div></div></div>${body}<div class="footer">Guajiro & Sons Field Suite v${APP_VERSION} · ${fmtDate()} · Confidential</div><div class="printbar"><span class="imgcount" id="ic">⏳ Cargando fotos...</span><button class="printbtn" id="pb" onclick="window.print()" disabled>🖨️ Print / Save PDF</button></div><script>(function(){function ok(){var b=document.getElementById('pb');var c=document.getElementById('ic');if(b){b.disabled=false;b.style.background='#005c28';}if(c){c.textContent='✅ Reporte listo — Click Print';}}var imgs=Array.from(document.querySelectorAll('img'));if(!imgs.length){ok();return;}var n=0,t=imgs.length,c=document.getElementById('ic');imgs.forEach(function(i){function d(){n++;if(c)c.textContent='⏳ '+n+'/'+t+' fotos...';if(n>=t)ok();}if(i.complete&&i.naturalWidth>0){d();}else{i.onload=d;i.onerror=d;}});setTimeout(ok,10000);})();</script></body></html>`;
}

function generateJobPDF(job, photos, techName, lang, preOpenedWin) {
  const w = preOpenedWin || openReportWindow();
  if (!w) return;
  const es = lang==='es';
  const sc = job.status==='done'?'status-done':job.status==='notdone'?'status-nd':'status-pend';
  const sl = job.status==='done'?(es?'✅ Completado':'✅ Completed'):job.status==='notdone'?(es?'❌ No Hecho':'❌ Not Done'):(es?'⏳ Pendiente':'⏳ Pending');
  const beforePhotos = photos.filter(p=>p.photo_type==='evidence'||p.photo_type==='before'||!p.photo_type);
  const afterPhotos = photos.filter(p=>p.photo_type==='pht'||p.photo_type==='after');
  const mkGrid = (ps, typeLabel) => ps.length>0 ? `<div class="photo-grid">${ps.map((p,i)=>`<div class="photo-item"><div class="photo-type-badge">${typeLabel} #${i+1}</div><img src="${p.photo_url}" loading="eager"/>${p.note?`<div class="photo-note">📝 ${p.note}</div>`:''}</div>`).join('')}</div>` : `<p class="no-photos">${es?'Sin fotos.':'No photos.'}</p>`;
  fillReportWindow(w, buildPDFHTML(
    `${es?'Reporte Trabajo':'Job Report'} #${job.job_id}`,
    `${es?'Técnico':'Technician'}: ${techName} — Tech #${job.tech_id}`,
    [
      {title:es?'Información del Trabajo':'Job Information',content:`<div class="info-grid">
        <div class="info-item"><div class="info-label">Job Number</div><div class="info-value">${job.job_id}</div></div>
        <div class="info-item"><div class="info-label">${es?'Estado':'Status'}</div><div class="info-value ${sc}">${sl}</div></div>
        <div class="info-item"><div class="info-label">${es?'Dirección':'Address'}</div><div class="info-value">${job.address}${job.city?', '+job.city:''}</div></div>
        <div class="info-item"><div class="info-label">${es?'Tipo':'Type'}</div><div class="info-value">${job.type||'COAX'}</div></div>
        ${job.pay_code?`<div class="info-item"><div class="info-label">${es?'Código Pago':'Pay Code'}</div><div class="info-value status-done">${job.pay_code}</div></div>`:''}
        ${job.phone?`<div class="info-item"><div class="info-label">Tel</div><div class="info-value">${job.phone}</div></div>`:''}
        ${job.reason?`<div class="info-item"><div class="info-label">${es?'Razón':'Reason'}</div><div class="info-value status-nd">${job.reason}</div></div>`:''}
        ${job.job_note?`<div class="info-item" style="grid-column:1/-1"><div class="info-label">${es?'Nota del Técnico':'Tech Note'}</div><div class="info-value">${job.job_note}</div></div>`:''}
        <div class="info-item"><div class="info-label">${es?'Técnico':'Tech'}</div><div class="info-value">${techName}</div></div>
        <div class="info-item"><div class="info-label">${es?'Fecha':'Date'}</div><div class="info-value">${fmtDate()}</div></div>
      </div>`},
      {title:`📷 ${es?'Fotos ANTES':'BEFORE Photos'} (${beforePhotos.length})`,content:mkGrid(beforePhotos, es?'ANTES':'BEFORE')},
      {title:`📷 ${es?'Fotos DESPUÉS':'AFTER Photos'} (${afterPhotos.length})`,content:mkGrid(afterPhotos, es?'DESPUÉS':'AFTER')},
    ]
  ), `Job_${job.job_id}`);
}

function generateEODPDF(tech, jobs, photos, lang, preOpenedWin) {
  const w = preOpenedWin || openReportWindow();
  if (!w) return;
  const es = lang==='es';
  const done=jobs.filter(j=>j.status==='done');
  const notDone=jobs.filter(j=>j.status==='notdone');
  const pending=jobs.filter(j=>j.status==='pending');
  const earned=done.reduce((s,j)=>s+(j.pay_total||0),0);
  const allPhotos=photos||[];
  const jobCards=jobs.map((job,idx)=>{
    const jp=allPhotos.filter(p=>p.route_id===job.id);
    const sc=job.status==='done'?'status-done':job.status==='notdone'?'status-nd':'status-pend';
    const sl=job.status==='done'?(es?'✅ Completado':'✅ Done'):job.status==='notdone'?(es?'❌ No Hecho':'❌ Not Done'):(es?'⏳ Pendiente':'⏳ Pending');
    const ph=jp.length>0?`<div class="photo-grid">${jp.map(p=>`<div class="photo-item"><img src="${p.photo_url}" loading="eager"/>${p.note?`<div class="photo-note">📝 ${p.note}</div>`:''}</div>`).join('')}</div>`:'';
    return `<div class="job-card"><div class="job-card-hdr"><span><span class="job-num">${idx+1}. #${job.job_id}</span><span class="job-type">${job.type?.includes('FIBER')?'FIBER':'COAX'}</span></span><span class="${sc}">${sl}${job.pay_code?` · ${job.pay_code}`:''}</span></div><div class="job-body"><div class="job-addr">${job.address}${job.city?', '+job.city:''}</div>${job.phone?`<div class="job-phone">📞 ${job.phone}</div>`:''} ${job.reason?`<div class="job-reason">❌ ${job.reason}</div>`:''} ${job.job_note?`<div class="job-reason" style="color:#00b8f5">📝 ${job.job_note}</div>`:''} ${ph}</div></div>`;
  }).join('');
  fillReportWindow(w, buildPDFHTML(
    es?'Reporte de Fin de Día':'End of Day Report',
    `${tech.name} — Tech #${tech.id}`,
    [
      {title:es?'Resumen del Día':'Day Summary',content:`<div class="stat-row"><div class="stat-box"><div class="stat-val" style="color:#005c28">${done.length}</div><div class="stat-lbl">${es?'Completados':'Done'}</div></div><div class="stat-box"><div class="stat-val" style="color:#b30000">${notDone.length}</div><div class="stat-lbl">${es?'No Completados':'Not Done'}</div></div><div class="stat-box"><div class="stat-val" style="color:#7a5c00">${pending.length}</div><div class="stat-lbl">${es?'Pendientes':'Pending'}</div></div></div>`},
      {title:`📋 ${es?`Trabajos (${jobs.length})`:`Jobs (${jobs.length})`}`,content:jobCards},
    ]
  ), `EOD_${tech.id}_${fmtDate()}`);
}

function generateRoutePDF(routes, photos, techName, techId, lang, preOpenedWin) {
  const w = preOpenedWin || openReportWindow();
  if (!w) return;
  const es=lang==='es';
  const done=routes.filter(r=>r.status==='done'&&(techId?r.tech_id===techId:true));
  const nameStr=techId?getTechName(techId):(es?'Todos los Técnicos':'All Technicians');
  const allPhotos=photos||[];
  const jobCards=done.map((job,idx)=>{
    const jp=allPhotos.filter(p=>p.route_id===job.id);
    const ph=jp.length>0?`<div class="photo-grid">${jp.map(p=>`<div class="photo-item"><img src="${p.photo_url}" loading="eager"/>${p.note?`<div class="photo-note">📝 ${p.note}</div>`:''}</div>`).join('')}</div>`:`<p class="no-photos">${es?'Sin fotos.':'No photos.'}</p>`;
    return `<div class="job-card"><div class="job-card-hdr"><span><span class="job-num">${idx+1}. #${job.job_id}</span><span class="job-type">${job.type?.includes('FIBER')?'FIBER':'COAX'}</span></span><span class="status-done">✅ ${job.pay_code}</span></div><div class="job-body"><div class="job-addr">${job.address}${job.city?', '+job.city:''}</div>${job.phone?`<div class="job-phone">📞 ${job.phone}</div>`:''} ${ph}</div></div>`;
  }).join('')||`<p class="no-photos">${es?'No hay trabajos completados.':'No completed jobs.'}</p>`;
  const earned=done.reduce((s,j)=>s+(j.pay_total||0),0);
  fillReportWindow(w, buildPDFHTML(
    es?'Reporte de Ruta Completada':'Completed Route Report',
    `${nameStr}${techId?' — Tech #'+techId:''}`,
    [
      {title:es?'Resumen':'Summary',content:`<div class="stat-row"><div class="stat-box"><div class="stat-val" style="color:#005c28">${done.length}</div><div class="stat-lbl">${es?'Completados':'Done'}</div></div><div class="stat-box"><div class="stat-val earned-val">$${earned.toLocaleString()}</div><div class="stat-lbl">${es?'Total Ganado':'Earned'}</div></div></div>`},
      {title:`📋 ${es?`Trabajos Completados (${done.length})`:`Completed Jobs (${done.length})`}`,content:jobCards},
    ]
  ), `Ruta_${safeName(nameStr)}_${fmtDate()}`);
}

function generateNotDoneExcel(reports, lang) {
  const es = lang==='es';
  const date = fmtDate();
  const filename = es ? `NoCompletados_${date}` : `NotDone_${date}`;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['Fecha','Tech #','Técnico','Job Number','Dirección','Razón','Notas','Estado','Hora']
    : ['Date','Tech #','Technician','Job Number','Address','Reason','Notes','Status','Time'];
  const rows = reports.filter(r=>r.status!=='eod').map(r=>[
    r.date, r.tech_id, r.tech_name, r.job_id, r.address, r.reason, r.notes||'',
    es?(r.status==='pending'?'Pendiente':'Reagendado'):(r.status==='pending'?'Pending':'Rescheduled'),
    new Date(r.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws['!cols'] = [{wch:12},{wch:8},{wch:22},{wch:14},{wch:30},{wch:24},{wch:20},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws,es?'No Completados':'Not Completed');
  XLSX.writeFile(wb, filename+'.xlsx');
}

function generateRouteExcel(routes, photos, lang, techId) {
  const es = lang==='es';
  const date = fmtDate();
  const techLabel = techId ? safeName(getTechName(techId)) : (es?'TodosTecnicos':'AllTechs');
  const filename = es ? `RutaCompletada_${techLabel}_${date}` : `CompletedRoute_${techLabel}_${date}`;
  const filtered = techId ? routes.filter(r=>r.tech_id===techId) : routes;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['#','Tech #','Técnico','Job Number','Dirección','Ciudad','Tipo','Estado','Código Pago','Total $','Razón','Nota Técnico','Fotos']
    : ['#','Tech #','Technician','Job Number','Address','City','Type','Status','Pay Code','Total $','Reason','Tech Note','Photos'];
  const rows = filtered.map((r,i)=>[
    i+1, r.tech_id, getTechName(r.tech_id), r.job_id, r.address, r.city||'', r.type||'',
    es?(r.status==='done'?'Completado':r.status==='notdone'?'No Hecho':'Pendiente')
       :(r.status==='done'?'Completed':r.status==='notdone'?'Not Done':'Pending'),
    r.pay_code||'', r.pay_total||0, r.reason||'', r.job_note||'',
    (photos||[]).filter(p=>p.route_id===r.id).length
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws['!cols'] = [{wch:4},{wch:8},{wch:22},{wch:14},{wch:30},{wch:14},{wch:16},{wch:12},{wch:10},{wch:8},{wch:24},{wch:20},{wch:6}];
  XLSX.utils.book_append_sheet(wb,ws,es?'Ruta del Día':'Daily Route');
  XLSX.writeFile(wb, filename+'.xlsx');
}

function generateJobExcel(job, photos, lang) {
  const es = lang==='es';
  const techName = safeName(getTechName(job.tech_id));
  const filename = es
    ? `ReporteTrabajo_${job.job_id}_${techName}_${fmtDate()}`
    : `JobReport_${job.job_id}_${techName}_${fmtDate()}`;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['Job Number','Técnico','Dirección','Ciudad','Tipo','Estado','Código Pago','Total $','Razón','Nota Técnico','Fotos','Fecha']
    : ['Job Number','Technician','Address','City','Type','Status','Pay Code','Total $','Reason','Tech Note','Photos','Date'];
  const rows = [[
    job.job_id, getTechName(job.tech_id), job.address, job.city||'', job.type||'',
    es?(job.status==='done'?'Completado':job.status==='notdone'?'No Hecho':'Pendiente')
       :(job.status==='done'?'Completed':job.status==='notdone'?'Not Done':'Pending'),
    job.pay_code||'', job.pay_total||0, job.reason||'', job.job_note||'', photos.length, fmtDate()
  ]];
  const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
  XLSX.utils.book_append_sheet(wb,ws,es?'Trabajo':'Job');
  if(photos.length>0){
    const ph = XLSX.utils.aoa_to_sheet([
      [es?'Foto #':'Photo #', es?'Tipo':'Type', 'URL', es?'Nota':'Note'],
      ...photos.map((p,i)=>[i+1,p.photo_type||'before',p.photo_url,p.note||''])
    ]);
    XLSX.utils.book_append_sheet(wb,ph,es?'Fotos':'Photos');
  }
  XLSX.writeFile(wb, filename+'.xlsx');
}

function generateExcel(reports,routes,lang){ generateNotDoneExcel(reports,lang); }

/* ════════════════════════════════════════════════════
   GANANCIAS — Excel por período (día/semana/mes/año)
   ════════════════════════════════════════════════════ */
function generateEarningsExcel(allRoutes: any[], period: 'day'|'week'|'month'|'year', lang: string) {
  const es = lang === 'es';
  const now = new Date();
  const today = now.toLocaleDateString('en-CA');

  const cutoff = new Date();
  if (period === 'week')  cutoff.setDate(now.getDate() - 7);
  if (period === 'month') cutoff.setDate(now.getDate() - 30);
  if (period === 'year')  cutoff.setDate(now.getDate() - 365);
  const cutoffStr = cutoff.toLocaleDateString('en-CA');

  const routes = allRoutes.filter(r =>
    r.status === 'done' && r.pay_total > 0 &&
    (period === 'day' ? r.date === today : r.date >= cutoffStr)
  );

  // Group by tech
  const byTech: {[k:string]: any[]} = {};
  routes.forEach(r => { if (!byTech[r.tech_id]) byTech[r.tech_id] = []; byTech[r.tech_id].push(r); });

  const wb = XLSX.utils.book_new();
  const periodLabel = period === 'day' ? (es?'Hoy':'Today') : period === 'week' ? (es?'Semana':'Week') : period === 'month' ? (es?'Mes':'Month') : (es?'Año':'Year');

  // ── Sheet 1: Summary by tech ──
  const summaryHeaders = es
    ? ['Tech #', 'Técnico', 'Trabajos', 'Total $', 'Promedio $']
    : ['Tech #', 'Technician', 'Jobs', 'Total $', 'Avg $'];
  const summaryRows: any[] = [];
  let grandTotal = 0;

  Object.entries(byTech).forEach(([techId, jobs]) => {
    const total = jobs.reduce((s,j) => s + (j.pay_total||0), 0);
    const avg = Math.round(total / jobs.length);
    grandTotal += total;
    summaryRows.push([techId, getTechName(techId), jobs.length, total, avg]);
  });
  summaryRows.sort((a,b) => b[3]-a[3]);
  summaryRows.push(['','', es?'TOTAL':'TOTAL', grandTotal, '']);

  const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
  ws1['!cols'] = [{wch:8},{wch:24},{wch:8},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws1, es?'Resumen':'Summary');

  // ── Sheet 2: Detail by job ──
  const detailHeaders = es
    ? ['Fecha','Tech #','Técnico','Job #','Dirección','Código Pago','Total $']
    : ['Date','Tech #','Technician','Job #','Address','Pay Code','Total $'];
  const detailRows = routes
    .sort((a,b) => a.date.localeCompare(b.date) || a.tech_id.localeCompare(b.tech_id))
    .map(r => [r.date, r.tech_id, getTechName(r.tech_id), r.job_id, r.address, r.pay_code||'', r.pay_total||0]);

  const ws2 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
  ws2['!cols'] = [{wch:12},{wch:8},{wch:24},{wch:14},{wch:30},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws2, es?'Detalle':'Detail');

  // ── Sheet 3: By pay code ──
  const codeMap: {[k:string]:number} = {};
  routes.forEach(r => { codeMap[r.pay_code||'?'] = (codeMap[r.pay_code||'?']||0) + (r.pay_total||0); });
  const codeHeaders = es ? ['Código Pago','Total $'] : ['Pay Code','Total $'];
  const codeRows = Object.entries(codeMap).sort((a,b)=>b[1]-a[1]).map(([c,t])=>[c,t]);
  const ws3 = XLSX.utils.aoa_to_sheet([codeHeaders,...codeRows]);
  ws3['!cols'] = [{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, es?'Por Código':'By Code');

  XLSX.writeFile(wb, `Ganancias_${periodLabel}_${today}.xlsx`);
}

export { fmtDate, safeName, showPDF, openReportWindow, fillReportWindow, buildPDFHTML, generateJobPDF, generateEODPDF, generateRoutePDF, generateNotDoneExcel, generateRouteExcel, generateJobExcel, generateExcel, generateEarningsExcel };
