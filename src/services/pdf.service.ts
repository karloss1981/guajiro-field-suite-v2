import type { Route } from '../types/job';
import type { JobPhoto } from '../types/photo';
import type { Technician } from '../types/technician';
import { getTechName } from '../config/regions';
import { APP_VERSION } from '../config/constants';

export function fmtDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function safeName(s: unknown): string {
  return String(s || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
}

function showPDF(html: string, filename: string) {
  const existing = document.getElementById('mfs-pdf-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mfs-pdf-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;background:#04091c';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0d1b3e;border-bottom:1px solid #162e58;flex-shrink:0;gap:8px;flex-wrap:wrap';
  bar.innerHTML = `<span style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#c8d8f4">📡 ${filename || 'Reporte'}</span><div style="display:flex;gap:6px"><button id="mfs-btn-print" style="background:#005c28;border:none;border-radius:8px;padding:8px 14px;color:#fff;font-size:12px;font-weight:700;cursor:pointer">🖨️ Imprimir / PDF</button><button id="mfs-btn-dl" style="background:#00b8f5;border:none;border-radius:8px;padding:8px 12px;color:#04091c;font-size:12px;font-weight:700;cursor:pointer">⬇ Descargar</button><button id="mfs-btn-close" style="background:none;border:1px solid #ff334888;border-radius:8px;padding:8px 12px;color:#ff3348;font-size:13px;font-weight:700;cursor:pointer">✕ Cerrar</button></div>`;
  const iframe = document.createElement('iframe');
  iframe.id = 'mfs-iframe';
  iframe.style.cssText = 'flex:1;border:none;background:#fff;width:100%';
  iframe.srcdoc = html;
  overlay.appendChild(bar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  (document.getElementById('mfs-btn-close') as HTMLButtonElement).onclick = () => overlay.remove();
  (document.getElementById('mfs-btn-print') as HTMLButtonElement).onclick = () => (iframe.contentWindow as Window)?.print();
  (document.getElementById('mfs-btn-dl') as HTMLButtonElement).onclick = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filename || 'report').replace(/\s+/g, '_') + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

const PDF_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px 24px 80px}.hdr{background:#0d1b3e;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start}.hdr-left h1{font-size:18px;font-weight:900;letter-spacing:1px}.hdr-left p{font-size:11px;opacity:.65;margin-top:3px}.hdr-right{text-align:right}.badge{background:#ff5a1f;color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;display:inline-block}.date{font-size:10px;opacity:.6;margin-top:4px}.section{border:1px solid #dde3ef;border-radius:8px;margin-bottom:18px;overflow:hidden;page-break-inside:avoid}.sec-title{background:#f0f4fb;padding:9px 14px;font-size:13px;font-weight:700;color:#0d1b3e;border-bottom:1px solid #dde3ef}.sec-body{padding:14px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.info-item{background:#f8faff;border-radius:6px;padding:8px 10px}.info-label{font-size:9px;color:#5a7aaa;text-transform:uppercase;letter-spacing:1.2px}.info-value{font-size:13px;font-weight:600;color:#0d1b3e;margin-top:2px}.status-done{color:#005c28;font-weight:700}.status-nd{color:#b30000;font-weight:700}.status-pend{color:#7a5c00;font-weight:700}.photo-grid{display:flex;flex-direction:column;gap:18px;margin-top:12px}.photo-item{border:1px solid #dde3ef;border-radius:8px;overflow:hidden;background:#f8faff;page-break-inside:avoid}.photo-type-badge{background:#0d1b3e;color:#fff;padding:4px 12px;font-size:10px;font-weight:700;letter-spacing:1px}.photo-item img{width:100%;max-height:480px;object-fit:contain;display:block;background:#f0f4fb}.photo-note{background:#f0f4fb;padding:6px 10px;font-size:11px;color:#5a7aaa;border-top:1px solid #dde3ef}.no-photos{color:#5a7aaa;font-size:12px;font-style:italic;padding:6px 0}.job-card{border:1px solid #dde3ef;border-radius:8px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid}.job-card-hdr{background:#0d1b3e;color:#fff;padding:9px 14px;display:flex;justify-content:space-between;align-items:center}.job-num{font-size:15px;font-weight:900}.job-type{font-size:10px;opacity:.6;margin-left:8px}.job-body{padding:12px 14px}.job-addr{font-size:13px;color:#0d1b3e;margin-bottom:3px}.job-phone{font-size:11px;color:#5a7aaa}.job-reason{font-size:11px;color:#b30000;margin-top:4px}.stat-row{display:flex;gap:10px;margin-bottom:16px}.stat-box{flex:1;background:#f0f4fb;border-radius:8px;padding:12px;text-align:center}.stat-val{font-size:28px;font-weight:900}.stat-lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#5a7aaa;margin-top:3px}.earned-val{color:#005c28}.footer{text-align:center;margin-top:24px;font-size:9px;color:#aaa;border-top:1px solid #eef0f5;padding-top:12px}.printbar{position:fixed;bottom:0;left:0;right:0;background:#0d1b3e;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;z-index:999;box-shadow:0 -4px 20px rgba(0,0,0,.5)}.printbtn{background:#ff5a1f;color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:15px;font-weight:700;cursor:pointer}.printbtn:disabled{background:#333;color:#666;cursor:not-allowed}.imgcount{color:#aac;font-size:12px}@media print{.printbar{display:none}body{padding:8px}}`;

const PDF_PRINT_SCRIPT = `(function(){function ok(){var b=document.getElementById('pb');var c=document.getElementById('ic');if(b){b.disabled=false;b.style.background='#005c28';}if(c){c.textContent='✅ Reporte listo — Click Print';}}var imgs=Array.from(document.querySelectorAll('img'));if(!imgs.length){ok();return;}var n=0,t=imgs.length,c=document.getElementById('ic');imgs.forEach(function(i){function d(){n++;if(c)c.textContent='⏳ '+n+'/'+t+' fotos...';if(n>=t)ok();}if(i.complete&&i.naturalWidth>0){d();}else{i.onload=d;i.onerror=d;}});setTimeout(ok,10000);})();`;

function buildPDFHTML(title: string, techLine: string, sections: { title: string; content: string }[]): string {
  const body = sections.map(s => `<div class="section"><div class="sec-title">${s.title}</div><div class="sec-body">${s.content}</div></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${PDF_CSS}</style></head><body><div class="hdr"><div class="hdr-left"><h1>📡 Guajiro &amp; Sons</h1><p>ITG · Guajiro &amp; Sons · Miami-Dade &amp; Broward</p><p>${techLine}</p></div><div class="hdr-right"><div class="badge">${title}</div><div class="date">${fmtDate()}</div></div></div>${body}<div class="footer">Guajiro &amp; Sons Field Suite v${APP_VERSION} · ${fmtDate()} · Confidential</div><div class="printbar"><span class="imgcount" id="ic">⏳ Cargando fotos...</span><button class="printbtn" id="pb" onclick="window.print()" disabled>🖨️ Print / Save PDF</button></div><script>${PDF_PRINT_SCRIPT}</script></body></html>`;
}

export function generateJobPDF(job: Route, photos: JobPhoto[], techName: string, lang: string) {
  const es = lang === 'es';
  const sc = job.status === 'done' ? 'status-done' : job.status === 'notdone' ? 'status-nd' : 'status-pend';
  const sl = job.status === 'done' ? (es ? '✅ Completado' : '✅ Completed') : job.status === 'notdone' ? (es ? '❌ No Hecho' : '❌ Not Done') : (es ? '⏳ Pendiente' : '⏳ Pending');
  const beforePhotos = photos.filter(p => p.photo_type === 'evidence' || p.photo_type === 'before' || !p.photo_type);
  const afterPhotos = photos.filter(p => p.photo_type === 'pht' || p.photo_type === 'after');
  const mkGrid = (ps: JobPhoto[], typeLabel: string) =>
    ps.length > 0
      ? `<div class="photo-grid">${ps.map((p, i) => `<div class="photo-item"><div class="photo-type-badge">${typeLabel} #${i + 1}</div><img src="${p.photo_url}" loading="eager"/>${p.note ? `<div class="photo-note">📝 ${p.note}</div>` : ''}</div>`).join('')}</div>`
      : `<p class="no-photos">${es ? 'Sin fotos.' : 'No photos.'}</p>`;
  showPDF(
    buildPDFHTML(
      `${es ? 'Reporte Trabajo' : 'Job Report'} #${job.job_id}`,
      `${es ? 'Técnico' : 'Technician'}: ${techName} — Tech #${job.tech_id}`,
      [
        {
          title: es ? 'Información del Trabajo' : 'Job Information',
          content: `<div class="info-grid">
            <div class="info-item"><div class="info-label">Job Number</div><div class="info-value">${job.job_id}</div></div>
            <div class="info-item"><div class="info-label">${es ? 'Estado' : 'Status'}</div><div class="info-value ${sc}">${sl}</div></div>
            <div class="info-item"><div class="info-label">${es ? 'Dirección' : 'Address'}</div><div class="info-value">${job.address}${job.city ? ', ' + job.city : ''}</div></div>
            <div class="info-item"><div class="info-label">${es ? 'Tipo' : 'Type'}</div><div class="info-value">${job.type || 'COAX'}</div></div>
            ${job.pay_code ? `<div class="info-item"><div class="info-label">${es ? 'Código Pago' : 'Pay Code'}</div><div class="info-value status-done">${job.pay_code}</div></div>` : ''}
            ${job.phone ? `<div class="info-item"><div class="info-label">Tel</div><div class="info-value">${job.phone}</div></div>` : ''}
            ${job.reason ? `<div class="info-item"><div class="info-label">${es ? 'Razón' : 'Reason'}</div><div class="info-value status-nd">${job.reason}</div></div>` : ''}
            ${job.job_note ? `<div class="info-item" style="grid-column:1/-1"><div class="info-label">${es ? 'Nota del Técnico' : 'Tech Note'}</div><div class="info-value">${job.job_note}</div></div>` : ''}
            <div class="info-item"><div class="info-label">${es ? 'Técnico' : 'Tech'}</div><div class="info-value">${techName}</div></div>
            <div class="info-item"><div class="info-label">${es ? 'Fecha' : 'Date'}</div><div class="info-value">${fmtDate()}</div></div>
          </div>`,
        },
        { title: `📷 ${es ? 'Fotos ANTES' : 'BEFORE Photos'} (${beforePhotos.length})`, content: mkGrid(beforePhotos, es ? 'ANTES' : 'BEFORE') },
        { title: `📷 ${es ? 'Fotos DESPUÉS' : 'AFTER Photos'} (${afterPhotos.length})`, content: mkGrid(afterPhotos, es ? 'DESPUÉS' : 'AFTER') },
      ]
    ),
    `Job_${job.job_id}`
  );
}

export function generateEODPDF(
  tech: Pick<Technician, 'id' | 'name'>,
  jobs: Route[],
  photos: JobPhoto[],
  lang: string
) {
  const es = lang === 'es';
  const done = jobs.filter(j => j.status === 'done');
  const notDone = jobs.filter(j => j.status === 'notdone');
  const pending = jobs.filter(j => j.status === 'pending');
  const allPhotos = photos || [];
  const jobCards = jobs
    .map((job, idx) => {
      const jp = allPhotos.filter(p => p.route_id === job.id);
      const sc = job.status === 'done' ? 'status-done' : job.status === 'notdone' ? 'status-nd' : 'status-pend';
      const sl = job.status === 'done' ? (es ? '✅ Completado' : '✅ Done') : job.status === 'notdone' ? (es ? '❌ No Hecho' : '❌ Not Done') : (es ? '⏳ Pendiente' : '⏳ Pending');
      const ph = jp.length > 0 ? `<div class="photo-grid">${jp.map(p => `<div class="photo-item"><img src="${p.photo_url}" loading="eager"/>${p.note ? `<div class="photo-note">📝 ${p.note}</div>` : ''}</div>`).join('')}</div>` : '';
      return `<div class="job-card"><div class="job-card-hdr"><span><span class="job-num">${idx + 1}. #${job.job_id}</span><span class="job-type">${job.type?.includes('FIBER') ? 'FIBER' : 'COAX'}</span></span><span class="${sc}">${sl}${job.pay_code ? ` · ${job.pay_code}` : ''}</span></div><div class="job-body"><div class="job-addr">${job.address}${job.city ? ', ' + job.city : ''}</div>${job.phone ? `<div class="job-phone">📞 ${job.phone}</div>` : ''} ${job.reason ? `<div class="job-reason">❌ ${job.reason}</div>` : ''} ${job.job_note ? `<div class="job-reason" style="color:#00b8f5">📝 ${job.job_note}</div>` : ''} ${ph}</div></div>`;
    })
    .join('');
  showPDF(
    buildPDFHTML(
      es ? 'Reporte de Fin de Día' : 'End of Day Report',
      `${tech.name} — Tech #${tech.id}`,
      [
        {
          title: es ? 'Resumen del Día' : 'Day Summary',
          content: `<div class="stat-row"><div class="stat-box"><div class="stat-val" style="color:#005c28">${done.length}</div><div class="stat-lbl">${es ? 'Completados' : 'Done'}</div></div><div class="stat-box"><div class="stat-val" style="color:#b30000">${notDone.length}</div><div class="stat-lbl">${es ? 'No Completados' : 'Not Done'}</div></div><div class="stat-box"><div class="stat-val" style="color:#7a5c00">${pending.length}</div><div class="stat-lbl">${es ? 'Pendientes' : 'Pending'}</div></div></div>`,
        },
        { title: `📋 ${es ? `Trabajos (${jobs.length})` : `Jobs (${jobs.length})`}`, content: jobCards },
      ]
    ),
    `EOD_${tech.id}_${fmtDate()}`
  );
}

export function generateRoutePDF(
  routes: Route[],
  photos: JobPhoto[],
  techId: string | null,
  lang: string
) {
  const es = lang === 'es';
  const done = routes.filter(r => r.status === 'done' && (techId ? r.tech_id === techId : true));
  const nameStr = techId ? getTechName(techId) : es ? 'Todos los Técnicos' : 'All Technicians';
  const allPhotos = photos || [];
  const earned = done.reduce((s, j) => s + (j.pay_total || 0), 0);
  const jobCards =
    done
      .map((job, idx) => {
        const jp = allPhotos.filter(p => p.route_id === job.id);
        const ph = jp.length > 0 ? `<div class="photo-grid">${jp.map(p => `<div class="photo-item"><img src="${p.photo_url}" loading="eager"/>${p.note ? `<div class="photo-note">📝 ${p.note}</div>` : ''}</div>`).join('')}</div>` : `<p class="no-photos">${es ? 'Sin fotos.' : 'No photos.'}</p>`;
        return `<div class="job-card"><div class="job-card-hdr"><span><span class="job-num">${idx + 1}. #${job.job_id}</span><span class="job-type">${job.type?.includes('FIBER') ? 'FIBER' : 'COAX'}</span></span><span class="status-done">✅ ${job.pay_code}</span></div><div class="job-body"><div class="job-addr">${job.address}${job.city ? ', ' + job.city : ''}</div>${job.phone ? `<div class="job-phone">📞 ${job.phone}</div>` : ''} ${ph}</div></div>`;
      })
      .join('') || `<p class="no-photos">${es ? 'No hay trabajos completados.' : 'No completed jobs.'}</p>`;
  showPDF(
    buildPDFHTML(
      es ? 'Reporte de Ruta Completada' : 'Completed Route Report',
      `${nameStr}${techId ? ' — Tech #' + techId : ''}`,
      [
        {
          title: es ? 'Resumen' : 'Summary',
          content: `<div class="stat-row"><div class="stat-box"><div class="stat-val" style="color:#005c28">${done.length}</div><div class="stat-lbl">${es ? 'Completados' : 'Done'}</div></div><div class="stat-box"><div class="stat-val" style="color:#005c28">$${earned.toLocaleString()}</div><div class="stat-lbl">${es ? 'Total Ganado' : 'Earned'}</div></div></div>`,
        },
        { title: `📋 ${es ? `Trabajos Completados (${done.length})` : `Completed Jobs (${done.length})`}`, content: jobCards },
      ]
    ),
    `Ruta_${safeName(nameStr)}_${fmtDate()}`
  );
}
