import * as XLSX from 'xlsx';
import type { Route, NotDoneReport } from '../types/job';
import type { JobPhoto } from '../types/photo';
import { getTechName } from '../config/regions';
import { fmtDate, safeName } from './pdf.service';

export function generateNotDoneExcel(reports: NotDoneReport[], lang: string) {
  const es = lang === 'es';
  const date = fmtDate();
  const filename = es ? `NoCompletados_${date}` : `NotDone_${date}`;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['Fecha', 'Tech #', 'Técnico', 'Job Number', 'Dirección', 'Razón', 'Notas', 'Estado', 'Hora']
    : ['Date', 'Tech #', 'Technician', 'Job Number', 'Address', 'Reason', 'Notes', 'Status', 'Time'];
  const rows = reports
    .filter(r => r.status !== 'eod')
    .map(r => [
      r.date, r.tech_id, r.tech_name, r.job_id, r.address, r.reason, r.notes || '',
      es ? (r.status === 'pending' ? 'Pendiente' : 'Reagendado') : (r.status === 'pending' ? 'Pending' : 'Rescheduled'),
      r.created_at ? new Date(r.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
    ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, es ? 'No Completados' : 'Not Completed');
  XLSX.writeFile(wb, filename + '.xlsx');
}

export function generateRouteExcel(routes: Route[], photos: JobPhoto[], lang: string, techId?: string) {
  const es = lang === 'es';
  const date = fmtDate();
  const techLabel = techId ? safeName(getTechName(techId)) : es ? 'TodosTecnicos' : 'AllTechs';
  const filename = es ? `RutaCompletada_${techLabel}_${date}` : `CompletedRoute_${techLabel}_${date}`;
  const filtered = techId ? routes.filter(r => r.tech_id === techId) : routes;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['#', 'Tech #', 'Técnico', 'Job Number', 'Dirección', 'Ciudad', 'Tipo', 'Estado', 'Código Pago', 'Total $', 'Razón', 'Nota Técnico', 'Fotos']
    : ['#', 'Tech #', 'Technician', 'Job Number', 'Address', 'City', 'Type', 'Status', 'Pay Code', 'Total $', 'Reason', 'Tech Note', 'Photos'];
  const rows = filtered.map((r, i) => [
    i + 1, r.tech_id, getTechName(r.tech_id), r.job_id, r.address, r.city || '', r.type || '',
    es ? (r.status === 'done' ? 'Completado' : r.status === 'notdone' ? 'No Hecho' : 'Pendiente')
      : (r.status === 'done' ? 'Completed' : r.status === 'notdone' ? 'Not Done' : 'Pending'),
    r.pay_code || '', r.pay_total || 0, r.reason || '', r.job_note || '',
    (photos || []).filter(p => p.route_id === r.id).length,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 4 }, { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 20 }, { wch: 6 }];
  XLSX.utils.book_append_sheet(wb, ws, es ? 'Ruta del Día' : 'Daily Route');
  XLSX.writeFile(wb, filename + '.xlsx');
}

export function generateJobExcel(job: Route, photos: JobPhoto[], lang: string) {
  const es = lang === 'es';
  const techName = safeName(getTechName(job.tech_id));
  const filename = es
    ? `ReporteTrabajo_${job.job_id}_${techName}_${fmtDate()}`
    : `JobReport_${job.job_id}_${techName}_${fmtDate()}`;
  const wb = XLSX.utils.book_new();
  const headers = es
    ? ['Job Number', 'Técnico', 'Dirección', 'Ciudad', 'Tipo', 'Estado', 'Código Pago', 'Total $', 'Razón', 'Nota Técnico', 'Fotos', 'Fecha']
    : ['Job Number', 'Technician', 'Address', 'City', 'Type', 'Status', 'Pay Code', 'Total $', 'Reason', 'Tech Note', 'Photos', 'Date'];
  const rows = [[
    job.job_id, getTechName(job.tech_id), job.address, job.city || '', job.type || '',
    es ? (job.status === 'done' ? 'Completado' : job.status === 'notdone' ? 'No Hecho' : 'Pendiente')
      : (job.status === 'done' ? 'Completed' : job.status === 'notdone' ? 'Not Done' : 'Pending'),
    job.pay_code || '', job.pay_total || 0, job.reason || '', job.job_note || '', photos.length, fmtDate(),
  ]];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, es ? 'Trabajo' : 'Job');
  if (photos.length > 0) {
    const ph = XLSX.utils.aoa_to_sheet([
      [es ? 'Foto #' : 'Photo #', es ? 'Tipo' : 'Type', 'URL', es ? 'Nota' : 'Note'],
      ...photos.map((p, i) => [i + 1, p.photo_type || 'evidence', p.photo_url, p.note || '']),
    ]);
    XLSX.utils.book_append_sheet(wb, ph, es ? 'Fotos' : 'Photos');
  }
  XLSX.writeFile(wb, filename + '.xlsx');
}
