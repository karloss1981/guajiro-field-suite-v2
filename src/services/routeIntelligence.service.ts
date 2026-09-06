import * as XLSX from 'xlsx';
import { sb } from '../config/supabase';
import { getTechName, getTechsByRegion } from '../config/regions';
import { addNotDonePoolEvent, listNotDonePool, updateNotDonePoolRecord } from './notDonePool.service';
import { isMissingRelationError, localListDrafts, localSaveDraft, localUpdateDraft, markLocalRitMode, markRemoteRitMode } from './localRitStore.service';

export type RitSourceKind =
  | 'new_route'
  | 'matched_past_pending'
  | 'carryover_pending'
  | 'resolved_reference'
  | 'cancelled_reference'
  | 'existing_route';

export type RitPoolJob = Record<string, any> & {
  key: string;
  pool_id?: string | null;
  source_kind: RitSourceKind;
  include: boolean;
  priority_score: number;
  priority_band: 'critical' | 'high' | 'medium' | 'normal';
  assigned_tech_id: string;
  original_tech_id?: string;
  manual_locked: boolean;
  route_order: number;
  rit_flag: string;
  rit_note: string;
};

export type RitImportAnalysis = {
  filename: string;
  sheetName: string;
  routeDate: string;
  region: string;
  headers: string[];
  importedCount: number;
  sourceRowCount: number;
  duplicateCount: number;
  invalidPhoneCount: number;
  jobs: RitPoolJob[];
  excluded: RitPoolJob[];
  warnings: string[];
  summary: {
    newJobs: number;
    matchedPastPending: number;
    carryoverPending: number;
    resolvedExcluded: number;
    cancelledExcluded: number;
    preassigned: number;
  };
};

const clean = (value: unknown) => String(value ?? '').trim();
const normalizeJobId = (value: unknown) => clean(value).replace(/\.0$/, '').replace(/\s+/g, '');
const normalizeHeader = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9áéíóúñ#]+/gi, ' ').replace(/\s+/g, ' ').trim();
const normalizePhone = (value: unknown) => clean(value).replace(/\D/g, '').slice(-10);
const normalizeDate = (value: unknown) => clean(value).slice(0, 10);
const ageDays = (date: string | null | undefined) => date
  ? Math.max(0, Math.floor((Date.now() - new Date(`${normalizeDate(date)}T12:00:00`).getTime()) / 86400000))
  : 0;

function makeKey(source: RitSourceKind, jobId: string, index = 0) {
  return `${source}:${jobId}:${index}`;
}

function readColumn(row: Record<string, unknown>, aliases: string[]) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const wanted = normalizeHeader(alias);
    const exact = keys.find((key) => normalizeHeader(key) === wanted);
    if (exact && clean(row[exact])) return clean(row[exact]);
  }
  for (const alias of aliases) {
    const wanted = normalizeHeader(alias);
    const partial = keys.find((key) => {
      const candidate = normalizeHeader(key);
      return candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (partial && clean(row[partial])) return clean(row[partial]);
  }
  return '';
}

function parseWorkbookRows(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const direct = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    if (direct.length && Object.keys(direct[0] || {}).length >= 2) return { rows: direct, sheetName };

    const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { defval: '', raw: false, header: 1 });
    for (let headerRow = 0; headerRow <= 8; headerRow += 1) {
      const headers = (raw[headerRow] || []).map((value) => clean(value));
      if (headers.filter(Boolean).length < 2) continue;
      const rows = raw
        .slice(headerRow + 1)
        .map((values) => {
          const row: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            row[header || `Column ${index + 1}`] = values?.[index] ?? '';
          });
          return row;
        })
        .filter((row) => Object.values(row).some((value) => clean(value)));
      if (rows.length) return { rows, sheetName };
    }
  }
  throw new Error('The Excel file is empty or has no readable route data.');
}


const HOUSE_NUMBER_ALIASES = [
  'House #', 'House#', 'House Number', 'House No', 'House No.', 'Hse #', 'Hse#',
  'Street #', 'Street Number', 'Street No', 'Civic #', 'Address #', 'Address Number', 'Addr #',
  'Service #', 'Service Number', 'Premise #', 'Premise Number', 'Num', 'Number', '#', 'Nro', 'No', 'Nº'
];
const STREET_NAME_ALIASES = ['Street', 'Street Name', 'StreetName', 'St Name', 'Road', 'Road Name', 'Avenue', 'Ave', 'Calle', 'Via', 'Thoroughfare'];
function buildFullAddress(row: Record<string, unknown>, currentAddress = '') {
  const house = clean(readColumn(row, HOUSE_NUMBER_ALIASES)).replace(/\.0$/, '').replace(/\s+/g, ' ');
  const street = clean(readColumn(row, STREET_NAME_ALIASES)).replace(/\.0$/, '').replace(/\s+/g, ' ');
  const address = clean(currentAddress).replace(/\.0$/, '').replace(/\s+/g, ' ');
  if (house && street) return `${house} ${street}`.trim();
  if (house && address && !/^\d+[a-z]?\b/i.test(address)) return `${house} ${address}`.trim();
  if (!address && (house || street)) return `${house} ${street}`.trim();
  return address;
}

const TECH_ALIASES = ['Tech', 'Technician', 'Tech ID', 'Tech #', 'Employee', 'Employee ID', 'Op #', 'Operario', 'Técnico'];
const JOB_ALIASES = ['Job ID', 'Job #', 'Job Number', 'Work Order', 'WO #', 'Service Order', 'Order #', 'Ticket', 'Folio'];
const ADDRESS_ALIASES = ['Address', 'Service Address', 'Full Address', 'Street Address', 'Location', 'Dirección', 'Domicilio'];
const CITY_ALIASES = ['City', 'Municipality', 'Town', 'Ciudad', 'Municipio'];
const ZIP_ALIASES = ['ZIP', 'Zip Code', 'Postal', 'Zipcode', 'Código Postal', 'CP'];
const TYPE_ALIASES = ['Type', 'Job Type', 'Work Type', 'Appointment Type', 'Appt Type', 'Tipo'];
const PHONE_ALIASES = ['Phone', 'Home', 'Mobile', 'Cell', 'Contact Phone', 'Customer Phone', 'Business', 'Teléfono', 'Telefono'];
const NOTE_ALIASES = ['Notes', 'Comments', 'Remarks', 'Special Instructions', 'Nota', 'Notas'];

export async function parseRitComcastWorkbook(file: File, region: string, routeDate: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: 'array' });
  const { rows, sheetName } = parseWorkbookRows(workbook);
  const headers = Object.keys(rows[0] || {});
  const roster = new Set(getTechsByRegion(region).map((tech) => tech.id));
  const jobs: Record<string, any>[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let invalidPhoneCount = 0;

  rows.forEach((row, index) => {
    const jobId = normalizeJobId(readColumn(row, JOB_ALIASES));
    let address = readColumn(row, ADDRESS_ALIASES);
    address = buildFullAddress(row, address);
    if (!jobId || !address) return;
    if (seen.has(jobId)) {
      duplicateCount += 1;
      return;
    }
    seen.add(jobId);

    const rawTech = normalizeJobId(readColumn(row, TECH_ALIASES));
    const techId = roster.has(rawTech) ? rawTech : '';
    const rawPhone = readColumn(row, PHONE_ALIASES);
    const phone = normalizePhone(rawPhone);
    if (rawPhone && phone.length !== 10) invalidPhoneCount += 1;

    jobs.push({
      key: makeKey('new_route', jobId, index),
      region,
      date: routeDate,
      job_id: jobId,
      address,
      city: readColumn(row, CITY_ALIASES),
      zip: readColumn(row, ZIP_ALIASES).replace(/\.0$/, '').slice(0, 10),
      phone,
      work_type: readColumn(row, TYPE_ALIASES) || 'JS:BURY COAX',
      imported_note: readColumn(row, NOTE_ALIASES),
      original_tech_id: techId,
      assigned_tech_id: techId,
      manual_locked: false,
      source_row: index + 2,
      raw_source: row,
    });
  });

  if (!jobs.length) {
    throw new Error(`No valid jobs were detected. Headers found: ${headers.join(', ')}`);
  }

  return {
    filename: file.name,
    sheetName,
    headers,
    jobs,
    sourceRowCount: rows.length,
    duplicateCount,
    invalidPhoneCount,
  };
}

export function scorePastPending(row: Record<string, any>): RitPoolJob {
  const reason = clean(row.latest_reason || row.original_reason).toLowerCase();
  const age = ageDays(row.first_not_done_date);
  const attempts = Number(row.occurrence_count || 1);
  let score = Math.min(45, age * 3) + Math.min(25, attempts * 7);
  if (/customer|not home|absent|no access|appointment|gate|unavailable/.test(reason)) score += 18;
  if (row.current_status === 'scheduled') score += 8;
  if (row.phone) score += 4;
  score = Math.min(100, score);
  return {
    ...row,
    key: row.key || makeKey(row.source_kind || 'carryover_pending', clean(row.job_id), Number(row.route_order || 0)),
    pool_id: row.pool_id || row.id || null,
    source_kind: row.source_kind || 'carryover_pending',
    include: row.include !== false,
    priority_score: score,
    priority_band: score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 25 ? 'medium' : 'normal',
    assigned_tech_id: clean(row.assigned_tech_id || row.latest_technician_id || row.tech_id),
    original_tech_id: clean(row.original_tech_id || row.latest_technician_id || row.tech_id),
    manual_locked: Boolean(row.manual_locked),
    route_order: Number(row.route_order || 0),
    rit_flag: clean(row.rit_flag) || '⚠ PAST PENDING',
    rit_note: clean(row.rit_note) || clean(row.latest_reason || row.original_reason || 'Past pending'),
  };
}

async function queryByIds(table: string, select: string, region: string, ids: string[]) {
  const rows: any[] = [];
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    let query = sb.from(table).select(select).in('job_id', chunk);
    if (region) query = query.eq('region', region);
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) continue;
      throw error;
    }
    rows.push(...(data || []));
  }
  return rows;
}

function latestByJob(rows: Record<string, any>[], dateFields: string[]) {
  const map = new Map<string, Record<string, any>>();
  rows.forEach((row) => {
    const id = normalizeJobId(row.job_id);
    if (!id) return;
    const candidateTime = dateFields.map((field) => new Date(row[field] || 0).getTime()).find((value) => Number.isFinite(value) && value > 0) || 0;
    const previous = map.get(id);
    const previousTime = previous
      ? dateFields.map((field) => new Date(previous[field] || 0).getTime()).find((value) => Number.isFinite(value) && value > 0) || 0
      : -1;
    if (!previous || candidateTime >= previousTime) map.set(id, row);
  });
  return map;
}

export async function reconcilePoolAgainstHistory(region: string, actor = 'rit-system') {
  const poolRows = await listNotDonePool(region, ['open', 'scheduled']);
  if (!poolRows.length) return { resolved: 0, cancelled: 0 };

  const ids = poolRows.map((row: any) => normalizeJobId(row.job_id));
  const [completedRows, cancelledRows] = await Promise.all([
    queryByIds('completed_jobs', 'job_id,date,tech_id,tech_name,address,city,zip,completed_at', region, ids),
    queryByIds('cancelled_jobs', 'job_id,status,reason,notes,tech_id,source_route_date,cancelled_at', region, ids),
  ]);
  const completed = latestByJob(completedRows, ['completed_at', 'date']);
  const cancelled = latestByJob(cancelledRows, ['cancelled_at', 'source_route_date']);
  let resolvedCount = 0;
  let cancelledCount = 0;

  for (const pool of poolRows as any[]) {
    const id = normalizeJobId(pool.job_id);
    const completedMatch = completed.get(id);
    const cancelledMatch = cancelled.get(id);
    const poolTime = new Date(`${normalizeDate(pool.last_not_done_date)}T00:00:00`).getTime();
    const completedTime = completedMatch ? new Date(completedMatch.completed_at || `${completedMatch.date}T23:59:59`).getTime() : 0;
    const cancelledTime = cancelledMatch ? new Date(cancelledMatch.cancelled_at || `${cancelledMatch.source_route_date}T23:59:59`).getTime() : 0;

    if (completedMatch && completedTime >= poolTime) {
      await updateNotDonePoolRecord(pool.id, {
        current_status: 'resolved',
        resolution_type: 'completed',
        resolution_notes: 'Automatically reconciled by RIT against completed_jobs.',
        resolved_job_date: completedMatch.date || normalizeDate(completedMatch.completed_at),
        resolved_by: actor,
        resolved_at: completedMatch.completed_at || new Date().toISOString(),
        latest_technician_id: completedMatch.tech_id || pool.latest_technician_id,
        updated_at: new Date().toISOString(),
      });
      await addNotDonePoolEvent({
        pool_id: pool.id,
        region,
        job_id: id,
        event_type: 'rit_auto_resolved_completed',
        event_date: completedMatch.date || normalizeDate(completedMatch.completed_at),
        technician_id: completedMatch.tech_id || null,
        metadata: { completed_job: completedMatch },
        created_by: actor,
      });
      resolvedCount += 1;
      continue;
    }

    if (cancelledMatch && cancelledTime >= poolTime) {
      await updateNotDonePoolRecord(pool.id, {
        current_status: 'cancelled',
        resolution_type: 'cancelled',
        resolution_notes: cancelledMatch.reason || cancelledMatch.notes || 'Automatically reconciled by RIT against cancelled_jobs.',
        resolved_job_date: cancelledMatch.source_route_date || normalizeDate(cancelledMatch.cancelled_at),
        resolved_by: actor,
        resolved_at: cancelledMatch.cancelled_at || new Date().toISOString(),
        latest_technician_id: cancelledMatch.tech_id || pool.latest_technician_id,
        updated_at: new Date().toISOString(),
      });
      await addNotDonePoolEvent({
        pool_id: pool.id,
        region,
        job_id: id,
        event_type: 'rit_auto_resolved_cancelled',
        event_date: cancelledMatch.source_route_date || normalizeDate(cancelledMatch.cancelled_at),
        technician_id: cancelledMatch.tech_id || null,
        reason: cancelledMatch.reason || null,
        notes: cancelledMatch.notes || null,
        metadata: { cancelled_job: cancelledMatch },
        created_by: actor,
      });
      cancelledCount += 1;
    }
  }

  return { resolved: resolvedCount, cancelled: cancelledCount };
}

export async function loadRitCandidates(region: string) {
  await reconcilePoolAgainstHistory(region);
  const data = await listNotDonePool(region, ['open', 'scheduled']);
  return (data || [])
    .map((row: any, index) => scorePastPending({
      ...row,
      source_kind: 'carryover_pending',
      key: makeKey('carryover_pending', normalizeJobId(row.job_id), index),
      pool_id: row.id,
      rit_flag: '⚠ CARRYOVER PENDING',
      rit_note: `${row.latest_reason || row.original_reason || 'Past pending'} · ${row.occurrence_count || 1} attempt(s)`,
      route_order: index + 1,
    }))
    .sort((a, b) => Number(b.priority_score) - Number(a.priority_score));
}

export async function analyzeRitWorkbook(file: File, region: string, routeDate: string): Promise<RitImportAnalysis> {
  await reconcilePoolAgainstHistory(region);
  const parsed = await parseRitComcastWorkbook(file, region, routeDate);
  const poolData = await listNotDonePool(region);

  const importedIds = parsed.jobs.map((job) => normalizeJobId(job.job_id));
  const [completedRows, cancelledRows, existingRows] = await Promise.all([
    queryByIds('completed_jobs', 'job_id,date,tech_id,tech_name,address,city,zip,completed_at', region, importedIds),
    queryByIds('cancelled_jobs', 'job_id,status,reason,notes,tech_id,source_route_date,cancelled_at', region, importedIds),
    queryByIds('routes', 'id,job_id,tech_id,date,status,order_num,address,city,zip', region, importedIds),
  ]);

  const poolMap = new Map((poolData || []).map((row: any) => [normalizeJobId(row.job_id), row]));
  const completedMap = latestByJob(completedRows, ['completed_at', 'date']);
  const cancelledMap = latestByJob(cancelledRows, ['cancelled_at', 'source_route_date']);
  const existingOnDate = new Map(existingRows.filter((row: any) => normalizeDate(row.date) === routeDate).map((row: any) => [normalizeJobId(row.job_id), row]));
  const jobs: RitPoolJob[] = [];
  const excluded: RitPoolJob[] = [];

  parsed.jobs.forEach((source, index) => {
    const id = normalizeJobId(source.job_id);
    const pool = poolMap.get(id) as any;
    const completed = completedMap.get(id);
    const cancelled = cancelledMap.get(id);
    const existing = existingOnDate.get(id) as any;

    if (pool && ['open', 'scheduled'].includes(pool.current_status)) {
      jobs.push(scorePastPending({
        ...pool,
        ...source,
        id: pool.id,
        pool_id: pool.id,
        key: makeKey('matched_past_pending', id, index),
        source_kind: 'matched_past_pending',
        include: true,
        assigned_tech_id: existing?.tech_id || source.assigned_tech_id || pool.latest_technician_id || '',
        original_tech_id: source.original_tech_id || existing?.tech_id || pool.latest_technician_id || '',
        manual_locked: false,
        route_order: existing?.order_num || index + 1,
        rit_flag: '⚠ PAST PENDING — REAPPEARED',
        rit_note: `${pool.latest_reason || pool.original_reason || 'Pending'} · first ${pool.first_not_done_date} · ${pool.occurrence_count || 1} attempt(s)`,
      }));
      return;
    }

    if (existing) {
      jobs.push(scorePastPending({
        ...source,
        key: makeKey('existing_route', id, index),
        source_kind: 'existing_route',
        include: true,
        assigned_tech_id: existing.tech_id || source.assigned_tech_id || '',
        original_tech_id: existing.tech_id || source.original_tech_id || '',
        manual_locked: true,
        route_order: existing.order_num || index + 1,
        priority_score: 0,
        priority_band: 'normal',
        rit_flag: '🔒 ALREADY IN SUITE',
        rit_note: `Existing route assignment · status ${existing.status || 'pending'}`,
      }));
      return;
    }

    if (pool?.current_status === 'cancelled' || cancelled) {
      excluded.push(scorePastPending({
        ...source,
        ...(pool || {}),
        key: makeKey('cancelled_reference', id, index),
        source_kind: 'cancelled_reference',
        include: false,
        assigned_tech_id: '',
        manual_locked: true,
        route_order: index + 1,
        rit_flag: '✕ CANCELLED — REVIEW',
        rit_note: pool?.resolution_notes || cancelled?.reason || cancelled?.notes || 'Previously cancelled',
      }));
      return;
    }

    if (pool?.current_status === 'resolved' || completed) {
      excluded.push(scorePastPending({
        ...source,
        ...(pool || {}),
        key: makeKey('resolved_reference', id, index),
        source_kind: 'resolved_reference',
        include: false,
        assigned_tech_id: '',
        manual_locked: true,
        route_order: index + 1,
        rit_flag: '✓ ALREADY RESOLVED — REVIEW',
        rit_note: pool?.resolution_notes || `Completed ${completed?.date || normalizeDate(completed?.completed_at) || ''}`,
      }));
      return;
    }

    jobs.push(scorePastPending({
      ...source,
      key: makeKey('new_route', id, index),
      source_kind: 'new_route',
      include: true,
      assigned_tech_id: source.assigned_tech_id || '',
      original_tech_id: source.original_tech_id || '',
      manual_locked: false,
      route_order: index + 1,
      priority_score: 0,
      priority_band: 'normal',
      rit_flag: 'NEW',
      rit_note: source.imported_note || 'New Comcast route job',
    }));
  });


  // Important: the daily RIT workspace only contains jobs present in the newly imported Comcast route.
  // Historical pool items are used only to enrich matching Job IDs with visit history and notes.
  // Unmatched historical jobs remain in Past Pending and are not injected into the daily route.


  const preassigned = jobs.filter((job) => clean(job.assigned_tech_id)).length;
  const warnings = [
    parsed.duplicateCount ? `${parsed.duplicateCount} duplicate Job IDs were skipped from the imported workbook.` : '',
    parsed.invalidPhoneCount ? `${parsed.invalidPhoneCount} phone numbers need review.` : '',
    excluded.length ? `${excluded.length} resolved/cancelled Job IDs were separated for review and are not included by default.` : '',
  ].filter(Boolean);

  return {
    filename: parsed.filename,
    sheetName: parsed.sheetName,
    routeDate,
    region,
    headers: parsed.headers,
    importedCount: parsed.jobs.length,
    sourceRowCount: parsed.sourceRowCount,
    duplicateCount: parsed.duplicateCount,
    invalidPhoneCount: parsed.invalidPhoneCount,
    jobs,
    excluded,
    warnings,
    summary: {
      newJobs: jobs.filter((job) => job.source_kind === 'new_route').length,
      matchedPastPending: jobs.filter((job) => job.source_kind === 'matched_past_pending').length,
      carryoverPending: 0,
      resolvedExcluded: excluded.filter((job) => job.source_kind === 'resolved_reference').length,
      cancelledExcluded: excluded.filter((job) => job.source_kind === 'cancelled_reference').length,
      preassigned,
    },
  };
}

export async function loadRitDrafts(region: string) {
  const { data, error } = await sb
    .from('rit_route_drafts')
    .select('*,rit_route_draft_items(*)')
    .eq('region', region)
    .order('created_at', { ascending: false })
    .limit(30);
  if (!error) { markRemoteRitMode(); return data || []; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  return localListDrafts(region);
}

export function jobsFromDraft(draft: any): RitPoolJob[] {
  return (draft?.rit_route_draft_items || [])
    .map((item: any, index: number) => scorePastPending({
      ...(item.snapshot || {}),
      pool_id: item.pool_id || item.snapshot?.pool_id || null,
      assigned_tech_id: item.technician_id || item.snapshot?.assigned_tech_id || '',
      route_order: item.route_order || index + 1,
      priority_score: item.priority_score || item.snapshot?.priority_score || 0,
      key: item.snapshot?.key || makeKey(item.snapshot?.source_kind || 'new_route', item.job_id, index),
    }))
    .sort((a: RitPoolJob, b: RitPoolJob) => Number(a.route_order) - Number(b.route_order));
}

export async function saveRitDraft(input: {
  region: string;
  routeDate: string;
  name: string;
  actor: string;
  jobs: RitPoolJob[];
  sourceFilename?: string;
  excludedCount?: number;
}) {
  const activeJobs = input.jobs.filter((job) => job.include !== false);
  const summary = {
    new_jobs: activeJobs.filter((job) => job.source_kind === 'new_route').length,
    matched_past_pending: activeJobs.filter((job) => job.source_kind === 'matched_past_pending').length,
    carryover_pending: activeJobs.filter((job) => job.source_kind === 'carryover_pending').length,
    existing_route: activeJobs.filter((job) => job.source_kind === 'existing_route').length,
    preassigned: activeJobs.filter((job) => clean(job.assigned_tech_id)).length,
    locked: activeJobs.filter((job) => job.manual_locked).length,
    unassigned: activeJobs.filter((job) => !clean(job.assigned_tech_id)).length,
    source_filename: input.sourceFilename || null,
    excluded_count: input.excludedCount || 0,
    source: input.sourceFilename ? 'comcast_excel_plus_not_done_pool' : 'not_done_pool',
  };
  const draftPayload = {
    region: input.region,
    route_date: input.routeDate,
    name: input.name,
    status: 'draft',
    job_count: activeJobs.length,
    created_by: input.actor,
    summary,
  };
  const { data: draft, error } = await sb.from('rit_route_drafts').insert(draftPayload).select('*').single();
  if (!error) {
    markRemoteRitMode();
    if (activeJobs.length) {
      const rows = activeJobs.map((job, index) => ({
        draft_id: draft.id,
        pool_id: job.pool_id || null,
        job_id: normalizeJobId(job.job_id),
        technician_id: clean(job.assigned_tech_id) || null,
        route_order: Number(job.route_order || index + 1),
        priority_score: Number(job.priority_score || 0),
        snapshot: { ...job, route_order: Number(job.route_order || index + 1) },
      }));
      const { error: itemError } = await sb.from('rit_route_draft_items').insert(rows);
      if (itemError) throw itemError;
    }
    return draft;
  }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  const localItems = activeJobs.map((job, index) => ({
    pool_id: job.pool_id || null,
    job_id: normalizeJobId(job.job_id),
    technician_id: clean(job.assigned_tech_id) || null,
    route_order: Number(job.route_order || index + 1),
    priority_score: Number(job.priority_score || 0),
    snapshot: { ...job, route_order: Number(job.route_order || index + 1) },
  }));
  return localSaveDraft({ ...draftPayload, rit_route_draft_items: localItems });
}

function routeOrderByTech(jobs: RitPoolJob[]) {
  const counters = new Map<string, number>();
  return jobs.map((job) => {
    const tech = clean(job.assigned_tech_id);
    const order = (counters.get(tech) || 0) + 1;
    counters.set(tech, order);
    return { job, order };
  });
}

export async function publishRitDraft(input: {
  draftId: string;
  region: string;
  routeDate: string;
  actor: string;
  jobs: RitPoolJob[];
}) {
  const activeJobs = input.jobs.filter((job) => job.include !== false);
  const missing = activeJobs.filter((job) => !clean(job.assigned_tech_id));
  if (missing.length) throw new Error(`${missing.length} jobs do not have a technician assigned.`);

  const { data: existingRows, error: existingError } = await sb
    .from('routes')
    .select('id,job_id,status')
    .eq('region', input.region)
    .eq('date', input.routeDate);
  if (existingError) throw existingError;
  const existingMap = new Map((existingRows || []).map((row: any) => [normalizeJobId(row.job_id), row]));
  const ordered = routeOrderByTech([...activeJobs].sort((a, b) => {
    const techCompare = clean(a.assigned_tech_id).localeCompare(clean(b.assigned_tech_id));
    return techCompare || Number(a.route_order || 0) - Number(b.route_order || 0);
  }));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const { job, order } of ordered) {
    const id = normalizeJobId(job.job_id);
    const payload = {
      region: input.region,
      date: input.routeDate,
      tech_id: clean(job.assigned_tech_id),
      job_id: id,
      address: clean(job.address) || null,
      city: clean(job.city) || null,
      zip: clean(job.zip) || null,
      phone: clean(job.phone) || null,
      type: clean(job.work_type || job.type) || 'JS:BURY COAX',
      status: 'pending',
      order_num: order,
      job_note: `[RIT] ${job.rit_flag || 'ROUTE'} · ${job.rit_note || ''}`.slice(0, 1000),
      reason: null,
      pay_total: 0,
      is_duplicate: false,
    };
    const existing = existingMap.get(id);
    if (existing) {
      if (['done', 'notdone', 'completed', 'not_completed'].includes(clean(existing.status).toLowerCase())) {
        skipped += 1;
        continue;
      }
      const { error } = await sb.from('routes').update(payload).eq('id', existing.id);
      if (error) throw error;
      updated += 1;
    } else {
      const { error } = await sb.from('routes').insert(payload);
      if (error) throw error;
      inserted += 1;
    }

    if (job.pool_id) {
      await updateNotDonePoolRecord(job.pool_id, {
        current_status: 'scheduled',
        scheduled_route_date: input.routeDate,
        latest_technician_id: clean(job.assigned_tech_id),
        updated_at: new Date().toISOString(),
      });
      await addNotDonePoolEvent({
        pool_id: job.pool_id,
        region: input.region,
        job_id: id,
        event_type: 'rit_published_to_route',
        event_date: input.routeDate,
        technician_id: clean(job.assigned_tech_id),
        route_date: input.routeDate,
        metadata: {
          draft_id: input.draftId,
          priority_score: job.priority_score,
          source_kind: job.source_kind,
          rit_flag: job.rit_flag,
          manual_locked: job.manual_locked,
        },
        created_by: input.actor,
      });
    }
  }

  const draftPatch = {
    status: 'published',
    published_at: new Date().toISOString(),
    published_by: input.actor,
    job_count: activeJobs.length,
    summary: {
      inserted,
      updated,
      skipped,
      assigned_technicians: new Set(activeJobs.map((job) => clean(job.assigned_tech_id))).size,
      published_source: 'rit_route_builder',
    },
  };
  const { error: draftError } = await sb.from('rit_route_drafts').update(draftPatch).eq('id', input.draftId);
  if (draftError && !isMissingRelationError(draftError)) throw draftError;
  if (draftError) markLocalRitMode(); else markRemoteRitMode();
  await localUpdateDraft(input.draftId, draftPatch);
  return { inserted, updated, skipped };
}

function sourceLabel(source: RitSourceKind) {
  switch (source) {
    case 'matched_past_pending': return 'PAST PENDING — REAPPEARED';
    case 'carryover_pending': return 'CARRYOVER PENDING';
    case 'resolved_reference': return 'RESOLVED REFERENCE';
    case 'cancelled_reference': return 'CANCELLED REFERENCE';
    case 'existing_route': return 'ALREADY IN SUITE';
    default: return 'NEW COMCAST ROUTE';
  }
}

function applyRowFill(ws: XLSX.WorkSheet, rowIndex: number, columnCount: number, color: string) {
  for (let column = 0; column < columnCount; column += 1) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: column });
    const cell = ws[address];
    if (!cell) continue;
    (cell as any).s = {
      ...(cell as any).s,
      fill: { patternType: 'solid', fgColor: { rgb: color } },
      font: { color: { rgb: '111827' }, bold: column === 9 },
    };
  }
}

function routeSection(job: RitPoolJob) {
  const text = `${clean(job.work_type || job.type)} ${clean(job.imported_note)} ${clean(job.rit_note)}`.toLowerCase();
  return /\b(aerial|mdu|811|cancel(?:led)?|locate|permit|engineering|special)\b/.test(text)
    ? 'SPECIAL / REVIEW'
    : 'DAILY ROUTE';
}

export function exportRitWorkbook(input: {
  jobs: RitPoolJob[];
  excluded: RitPoolJob[];
  region: string;
  routeDate: string;
  routeName: string;
  sourceFilename?: string;
}) {
  const active = input.jobs.filter((job) => job.include !== false);
  const sorted = [...active].sort((a, b) => {
    const sectionCompare = routeSection(a).localeCompare(routeSection(b));
    if (sectionCompare) return sectionCompare;
    const techCompare = clean(a.assigned_tech_id).localeCompare(clean(b.assigned_tech_id));
    if (techCompare) return techCompare;
    return Number(a.route_order || 0) - Number(b.route_order || 0);
  });
  const wb = XLSX.utils.book_new();
  const routeHeaders = [
    '#', 'Route Section', 'Tech #', 'Technician', 'Job Number', 'Address', 'City', 'ZIP', 'Phone', 'Type',
    'RIT FLAG', 'RIT NOTE', 'Source', 'Past Pending Attempts', 'First Not Done', 'Last Not Done',
    'Previous Reason', 'Preassigned / Locked', 'Imported From',
  ];
  const routeRows = sorted.map((job, index) => [
    index + 1,
    routeSection(job),
    clean(job.assigned_tech_id),
    clean(job.assigned_tech_id) ? getTechName(clean(job.assigned_tech_id)) : 'UNASSIGNED',
    normalizeJobId(job.job_id),
    clean(job.address), clean(job.city), clean(job.zip), clean(job.phone), clean(job.work_type || job.type),
    clean(job.rit_flag) || sourceLabel(job.source_kind),
    clean(job.rit_note), sourceLabel(job.source_kind), Number(job.occurrence_count || 0),
    clean(job.first_not_done_date), clean(job.last_not_done_date), clean(job.latest_reason || job.original_reason),
    job.manual_locked ? 'LOCKED' : '', input.sourceFilename || '',
  ]);
  const routeWs = XLSX.utils.aoa_to_sheet([routeHeaders, ...routeRows]);
  routeWs['!cols'] = [5, 18, 9, 25, 16, 34, 18, 10, 14, 18, 29, 48, 28, 18, 15, 15, 30, 20, 28].map((wch) => ({ wch }));
  routeWs['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(routeHeaders.length - 1)}${Math.max(1, routeRows.length + 1)}` };
  sorted.forEach((job, index) => {
    const color = job.source_kind === 'matched_past_pending' ? 'FDE68A'
      : job.source_kind === 'carryover_pending' ? 'FCA5A5'
        : job.source_kind === 'existing_route' ? 'BFDBFE'
          : job.manual_locked ? 'DDD6FE'
            : 'DCFCE7';
    applyRowFill(routeWs, index + 1, routeHeaders.length, color);
  });
  XLSX.utils.book_append_sheet(wb, routeWs, 'Final Route');

  const techSummary = Array.from(new Set(sorted.map((job) => clean(job.assigned_tech_id) || 'UNASSIGNED'))).map((techId) => {
    const techJobs = sorted.filter((job) => (clean(job.assigned_tech_id) || 'UNASSIGNED') === techId);
    return [
      techId,
      techId === 'UNASSIGNED' ? 'UNASSIGNED' : getTechName(techId),
      techJobs.length,
      techJobs.filter((job) => job.source_kind === 'new_route').length,
      techJobs.filter((job) => ['matched_past_pending', 'carryover_pending'].includes(job.source_kind)).length,
      new Set(techJobs.map((job) => clean(job.zip)).filter(Boolean)).size,
      Array.from(new Set(techJobs.map((job) => clean(job.city)).filter(Boolean))).join(', '),
    ];
  });
  const techWs = XLSX.utils.aoa_to_sheet([
    ['Tech #', 'Technician', 'Total Jobs', 'New Jobs', 'Past Pending', 'ZIP Count', 'Cities'],
    ...techSummary,
  ]);
  techWs['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, techWs, 'Technician Summary');

  const zipMap = new Map<string, RitPoolJob[]>();
  sorted.forEach((job) => {
    const key = `${clean(job.city) || 'Unknown City'}|${clean(job.zip) || 'No ZIP'}`;
    zipMap.set(key, [...(zipMap.get(key) || []), job]);
  });
  const zipRows = Array.from(zipMap.entries()).map(([key, cluster]) => {
    const [city, zip] = key.split('|');
    return [
      city, zip, cluster.length,
      cluster.filter((job) => job.source_kind === 'new_route').length,
      cluster.filter((job) => ['matched_past_pending', 'carryover_pending'].includes(job.source_kind)).length,
      cluster.filter((job) => !clean(job.assigned_tech_id)).length,
      Array.from(new Set(cluster.map((job) => clean(job.assigned_tech_id)).filter(Boolean))).join(', '),
    ];
  }).sort((a, b) => Number(b[2]) - Number(a[2]));
  const zipWs = XLSX.utils.aoa_to_sheet([
    ['City', 'ZIP', 'Total Jobs', 'New Jobs', 'Past Pending', 'Unassigned', 'Technicians'],
    ...zipRows,
  ]);
  zipWs['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, zipWs, 'ZIP-City Summary');

  const pending = sorted.filter((job) => ['matched_past_pending', 'carryover_pending'].includes(job.source_kind));
  const pendingWs = XLSX.utils.aoa_to_sheet([
    ['Job Number', 'Address', 'City', 'ZIP', 'Assigned Tech', 'RIT Flag', 'Reason', 'Attempts', 'First Not Done', 'Last Not Done', 'Priority'],
    ...pending.map((job) => [
      normalizeJobId(job.job_id), clean(job.address), clean(job.city), clean(job.zip), clean(job.assigned_tech_id),
      clean(job.rit_flag), clean(job.latest_reason || job.original_reason), Number(job.occurrence_count || 1),
      clean(job.first_not_done_date), clean(job.last_not_done_date), `${job.priority_band} (${job.priority_score})`,
    ]),
  ]);
  pendingWs['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, pendingWs, 'Past Pending Review');

  const specialJobs = sorted.filter((job) => routeSection(job) === 'SPECIAL / REVIEW');
  const specialWs = XLSX.utils.aoa_to_sheet([
    ['Job Number', 'Type', 'Address', 'City', 'ZIP', 'Assigned Tech', 'RIT Flag', 'RIT Note'],
    ...specialJobs.map((job) => [
      normalizeJobId(job.job_id), clean(job.work_type || job.type), clean(job.address), clean(job.city), clean(job.zip),
      clean(job.assigned_tech_id), clean(job.rit_flag), clean(job.rit_note),
    ]),
  ]);
  specialWs['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 34 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 28 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, specialWs, 'Special Categories');

  const excludedWs = XLSX.utils.aoa_to_sheet([
    ['Job Number', 'Address', 'City', 'ZIP', 'RIT Flag', 'Reason / Resolution', 'Reference Status'],
    ...input.excluded.map((job) => [
      normalizeJobId(job.job_id), clean(job.address), clean(job.city), clean(job.zip), clean(job.rit_flag), clean(job.rit_note), sourceLabel(job.source_kind),
    ]),
  ]);
  excludedWs['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 10 }, { wch: 30 }, { wch: 50 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, excludedWs, 'Excluded Reference');

  const safeName = clean(input.routeName || 'RIT Route').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 50);
  const filename = `RIT_${input.region}_${input.routeDate}_${safeName}.xlsx`;
  XLSX.writeFile(wb, filename, { cellStyles: true });
  return filename;
}
