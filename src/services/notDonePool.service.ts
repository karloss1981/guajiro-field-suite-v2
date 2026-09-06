import { sb } from '../config/supabase';
import {
  isMissingRelationError,
  localAddPoolEvent,
  localFindPool,
  localListPool,
  localUpdatePool,
  localUpsertPool,
  markLocalRitMode,
  markRemoteRitMode,
} from './localRitStore.service';

type JobLike = Record<string, any>;

const clean = (value: unknown) => String(value ?? '').trim();
const normalizedAddress = (job: JobLike) => `${clean(job.address).toLowerCase()}|${clean(job.city).toLowerCase()}`;

function poolSignalText(row: JobLike) {
  return [row.current_status, row.resolution_type, row.latest_reason, row.original_reason, row.latest_notes, row.notes, row.job_note, row.status]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .join(' | ');
}

function inferPoolStatus(row: JobLike) {
  const explicit = clean(row.current_status).toLowerCase();
  if (explicit === 'resolved' || explicit === 'completed') return 'resolved';
  if (explicit === 'cancelled' || explicit === 'canceled') return 'cancelled';
  if (explicit === 'scheduled') return 'scheduled';
  const text = poolSignalText(row)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/(cancel|cancelado|cancelled|canceled|cliente cancelo|customer cancel|cx cancel|no quiere|refused)/.test(text)) return 'cancelled';
  if (/(resolved|resuelto|completed|complete|done|cerrado|fixed)/.test(text)) return 'resolved';
  return 'open';
}

function inferPoolCategory(row: JobLike) {
  const text = poolSignalText(row)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (inferPoolStatus(row) === 'cancelled') return 'Cancelled';
  if (/(811|locate|ticket|utility|utilities)/.test(text)) return '811';
  // V25.2: 'Materials' category removed by request — not used in this operation.
  if (/(access|gate|gated|dog|hoa|no access|customer absent|cliente ausente|not home|no home|locked|cerrado)/.test(text)) return 'Access / Customer';
  if (/(missile|bore|boring|underground|trench)/.test(text)) return 'Missile / Bore';
  return 'Needs follow-up';
}

function normalizePoolRow<T extends JobLike>(row: T): T {
  const current_status = inferPoolStatus(row);
  return {
    ...row,
    current_status,
    inferred_category: (row.inferred_category === 'Materials' ? '' : row.inferred_category) || inferPoolCategory({ ...row, current_status }),
  };
}

function filterPoolRows(rows: JobLike[], statuses?: string[]) {
  const normalized = rows.map(row => normalizePoolRow(row));
  if (!statuses?.length) return normalized;
  return normalized.filter(row => statuses.includes(clean(row.current_status).toLowerCase()));
}

async function addEvent(poolId: string, job: JobLike, eventType: string, actor: string, metadata: Record<string, unknown> = {}) {
  const payload = {
    pool_id: poolId,
    region: clean(job.region) || 'miami',
    job_id: clean(job.job_id),
    event_type: eventType,
    event_date: job.date || new Date().toLocaleDateString('en-CA'),
    technician_id: clean(job.tech_id) || null,
    route_date: job.date || null,
    reason: clean(job.reason) || null,
    notes: clean(job.job_note || job.notes) || null,
    metadata,
    created_by: actor,
  };
  const { error } = await sb.from('not_done_pool_events').insert(payload);
  if (!error) { markRemoteRitMode(); return; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  await localAddPoolEvent(payload);
}

async function findPool(region: string, jobId: string) {
  const { data, error } = await sb.from('not_done_pool').select('*').eq('region', region).eq('job_id', jobId).maybeSingle();
  if (!error) { markRemoteRitMode(); return data; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  return localFindPool(region, jobId);
}

async function upsertPool(payload: JobLike) {
  const { data, error } = await sb.from('not_done_pool').upsert(payload, { onConflict: 'region,job_id' }).select('*').single();
  if (!error) { markRemoteRitMode(); return data; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  return localUpsertPool(payload);
}

async function updatePool(id: string, patch: JobLike) {
  const { data, error } = await sb.from('not_done_pool').update(patch).eq('id', id).select('*').single();
  if (!error) { markRemoteRitMode(); return data; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  return localUpdatePool(id, patch);
}

export async function listNotDonePool(region: string, statuses?: string[]) {
  const { data, error } = await sb.from('not_done_pool').select('*').eq('region', region).order('updated_at', { ascending: false }).limit(3000);
  if (!error) { markRemoteRitMode(); return filterPoolRows(data || [], statuses); }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  let localRows = await localListPool(region, undefined);
  if (!localRows.length) {
    const { data: legacyRows, error: legacyError } = await sb.from('not_done_reports').select('*').eq('region', region).limit(5000);
    if (!legacyError && legacyRows?.length) {
      const grouped = new Map<string, any[]>();
      legacyRows.forEach((row: any) => {
        const id = clean(row.job_id);
        if (!id || id === 'EOD-REPORT') return;
        grouped.set(id, [...(grouped.get(id) || []), row]);
      });
      for (const [jobId, history] of grouped) {
        const sorted = [...history].sort((a, b) => String(a.created_at || a.date || '').localeCompare(String(b.created_at || b.date || '')));
        const first = sorted[0] || {};
        const last = sorted[sorted.length - 1] || {};
        const basePayload = {
          region,
          job_id: jobId,
          address: clean(last.address || first.address) || null,
          city: clean(last.city || first.city) || null,
          zip: clean(last.zip || last.zone || first.zip || first.zone) || null,
          phone: clean(last.phone || first.phone) || null,
          work_type: clean(last.type || first.type) || null,
          original_reason: clean(first.reason) || 'Not completed',
          latest_reason: clean(last.reason) || 'Not completed',
          latest_notes: clean(last.notes || last.job_note) || null,
          first_not_done_date: clean(first.date || first.created_at).slice(0, 10) || new Date().toLocaleDateString('en-CA'),
          last_not_done_date: clean(last.date || last.created_at).slice(0, 10) || new Date().toLocaleDateString('en-CA'),
          last_seen_route_date: clean(last.date).slice(0, 10) || null,
          source_technician_id: clean(first.tech_id) || null,
          latest_technician_id: clean(last.tech_id) || null,
          occurrence_count: history.length,
          updated_at: new Date().toISOString(),
        };
        await localUpsertPool(normalizePoolRow({ ...basePayload, current_status: 'open' }));
      }
      localRows = await localListPool(region, undefined);
    }
  }
  return filterPoolRows(localRows, statuses);
}

export async function updateNotDonePoolRecord(id: string, patch: JobLike) {
  return updatePool(id, patch);
}

export async function addNotDonePoolEvent(payload: JobLike) {
  const { error } = await sb.from('not_done_pool_events').insert(payload);
  if (!error) { markRemoteRitMode(); return; }
  if (!isMissingRelationError(error)) throw error;
  markLocalRitMode();
  await localAddPoolEvent(payload);
}

export async function addOrRefreshNotDonePool(job: JobLike, actor = 'system') {
  const region = clean(job.region) || 'miami';
  const jobId = clean(job.job_id);
  if (!jobId || jobId === 'EOD-REPORT') return null;
  const date = job.date || new Date().toLocaleDateString('en-CA');
  const existing = await findPool(region, jobId);
  const payload = {
    region,
    job_id: jobId,
    address: clean(job.address) || null,
    city: clean(job.city) || null,
    zip: clean(job.zip || job.zone) || null,
    phone: clean(job.phone) || null,
    work_type: clean(job.type) || null,
    original_reason: existing?.original_reason || clean(job.reason) || 'Not completed',
    latest_reason: clean(job.reason) || existing?.latest_reason || 'Not completed',
    latest_notes: clean(job.job_note || job.notes) || existing?.latest_notes || null,
    first_not_done_date: existing?.first_not_done_date || date,
    last_not_done_date: date,
    last_seen_route_date: date,
    source_technician_id: existing?.source_technician_id || clean(job.tech_id) || null,
    latest_technician_id: clean(job.tech_id) || existing?.latest_technician_id || null,
    occurrence_count: Number(existing?.occurrence_count || 0) + 1,
    current_status: inferPoolStatus(job),
    inferred_category: inferPoolCategory(job),
    resolution_type: null,
    resolution_notes: null,
    resolved_job_date: null,
    resolved_by: null,
    resolved_at: null,
    updated_at: new Date().toISOString(),
  };
  const data = await upsertPool(payload);
  await addEvent(data.id, { ...job, region, date }, existing ? 'not_done_repeated' : 'not_done_added', actor, { previous_status: existing?.current_status || null });
  return data;
}

export async function resolveNotDonePool(job: JobLike, resolutionType: 'completed'|'cancelled'|'admin_resolved', actor = 'system', notes = '') {
  const region = clean(job.region) || 'miami';
  const jobId = clean(job.job_id);
  if (!jobId) return null;
  const existing = await findPool(region, jobId);
  if (!existing) return null;
  const status = resolutionType === 'cancelled' ? 'cancelled' : 'resolved';
  const data = await updatePool(existing.id, {
    current_status: status,
    resolution_type: resolutionType,
    resolution_notes: notes || clean(job.job_note || job.notes) || null,
    resolved_job_date: job.date || new Date().toLocaleDateString('en-CA'),
    resolved_by: actor,
    resolved_at: new Date().toISOString(),
    latest_technician_id: clean(job.tech_id) || existing.latest_technician_id,
    updated_at: new Date().toISOString(),
  });
  await addEvent(existing.id, { ...job, region }, resolutionType === 'completed' ? 'resolved_completed' : resolutionType === 'cancelled' ? 'resolved_cancelled' : 'resolved_manual', actor, { notes });
  return data;
}

export async function reconcileNotDonePoolWithRoute(region: string, routeDate: string, jobs: JobLike[], actor = 'system') {
  const poolRows = await listNotDonePool(region, ['open', 'scheduled']);
  const byJob = new Map(jobs.map(job => [clean(job.job_id), job]));
  const byAddress = new Map(jobs.map(job => [normalizedAddress(job), job]));
  let scheduled = 0;
  let resolved = 0;
  for (const row of poolRows || []) {
    const match = byJob.get(clean(row.job_id)) || byAddress.get(`${clean(row.address).toLowerCase()}|${clean(row.city).toLowerCase()}`);
    if (!match) continue;
    if (String(match.status || '').toLowerCase() === 'done') {
      await resolveNotDonePool({ ...match, region, date: routeDate }, 'completed', actor, 'Matched as completed during route reconciliation');
      resolved += 1;
      continue;
    }
    await updatePool(row.id, {
      current_status: 'scheduled',
      scheduled_route_date: routeDate,
      last_seen_route_date: routeDate,
      latest_technician_id: clean(match.tech_id) || row.latest_technician_id,
      updated_at: new Date().toISOString(),
    });
    await addEvent(row.id, { ...match, region, date: routeDate }, 'matched_new_route', actor, { route_date: routeDate });
    scheduled += 1;
  }
  return { scheduled, resolved };
}
