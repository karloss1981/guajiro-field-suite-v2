import { sb } from '../../config/supabase';
import { isMissingRelationError, operationsSetupMessage } from './schema.service';

type RouteAnalyticsRow = {
  tech_id?: string | null;
  date?: string | null;
  job_id?: string | null;
  address?: string | null;
  status?: string | null;
  pay_total?: number | string | null;
  _priority?: number;
};

function normalizeStatus(status: unknown) {
  return String(status || '').trim().toLowerCase();
}

function isDone(status: unknown) {
  return ['done', 'completed'].includes(normalizeStatus(status));
}

function isNotDone(status: unknown) {
  return ['notdone', 'not_done', 'not_completed', 'cancelled'].includes(normalizeStatus(status));
}

function flattenSnapshot(snapshot: unknown, defaultDate: unknown, priority: number): RouteAnalyticsRow[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((job: any) => ({
    tech_id: job?.tech_id,
    date: job?.date || defaultDate,
    job_id: job?.job_id,
    address: job?.address,
    status: job?.status,
    pay_total: job?.pay_total,
    _priority: priority,
  }));
}

async function loadOptionalArchiveRows(
  relation: 'daily_route_snapshots' | 'archived_routes',
  dateColumn: 'date' | 'route_date',
  priority: number,
) {
  const result = await sb.from(relation).select(`snapshot,${dateColumn}`);
  if (result.error) {
    if (isMissingRelationError(result.error, relation)) return { rows: [] as RouteAnalyticsRow[], warning: operationsSetupMessage(result.error, relation) };
    throw result.error;
  }
  const rows = (result.data || []).flatMap((record: any) => flattenSnapshot(record.snapshot, record[dateColumn], priority));
  return { rows, warning: '' };
}

async function loadJobFacts() {
  const live = await sb.from('routes').select('tech_id,date,job_id,address,status,pay_total');
  if (live.error) throw live.error;

  const [daily, permanent] = await Promise.all([
    loadOptionalArchiveRows('daily_route_snapshots', 'date', 2),
    loadOptionalArchiveRows('archived_routes', 'route_date', 1),
  ]);

  const candidates: RouteAnalyticsRow[] = [
    ...(live.data || []).map((row: any) => ({ ...row, _priority: 3 })),
    ...daily.rows,
    ...permanent.rows,
  ].sort((a, b) => Number(b._priority || 0) - Number(a._priority || 0));

  // Active route rows win over auto-snapshots, and daily snapshots win over
  // permanent archive copies. This prevents the same job from being counted twice.
  const deduped = new Map<string, RouteAnalyticsRow>();
  candidates.forEach((row, index) => {
    const key = [
      String(row.tech_id || 'unassigned'),
      String(row.date || 'unknown'),
      String(row.job_id || row.address || `row-${index}`),
    ].join('|').toLowerCase();
    if (!deduped.has(key)) deduped.set(key, row);
  });

  return {
    rows: [...deduped.values()],
    warnings: [daily.warning, permanent.warning].filter(Boolean),
  };
}

function aggregateDaily(rows: RouteAnalyticsRow[]) {
  const groups = new Map<string, any>();
  rows.forEach((row) => {
    const technicianId = String(row.tech_id || 'unassigned');
    const day = String(row.date || 'unknown');
    const key = `${technicianId}|${day}`;
    const current = groups.get(key) || { technician_id: technicianId, day, jobs_completed: 0, jobs_not_done: 0, total_jobs: 0, total_earned: 0 };
    current.total_jobs += 1;
    if (isDone(row.status)) {
      current.jobs_completed += 1;
      current.total_earned += Number(row.pay_total || 0);
    }
    if (isNotDone(row.status)) current.jobs_not_done += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

function aggregateProductivity(rows: RouteAnalyticsRow[]) {
  const groups = new Map<string, any>();
  rows.forEach((row) => {
    const technicianId = String(row.tech_id || 'unassigned');
    const current = groups.get(technicianId) || { technician_id: technicianId, completed_jobs: 0, not_done_jobs: 0, total_jobs: 0, total_earned: 0 };
    current.total_jobs += 1;
    if (isDone(row.status)) {
      current.completed_jobs += 1;
      current.total_earned += Number(row.pay_total || 0);
    }
    if (isNotDone(row.status)) current.not_done_jobs += 1;
    groups.set(technicianId, current);
  });
  return [...groups.values()].sort((a, b) => b.completed_jobs - a.completed_jobs);
}

export async function getDailyProduction() {
  const result = await sb.from('daily_production').select('*').order('day', { ascending: false });
  if (!result.error) return { data: result.data || [], error: null, fallback: false, warnings: [] as string[] };
  if (!isMissingRelationError(result.error, 'daily_production')) throw result.error;
  const facts = await loadJobFacts();
  return { data: aggregateDaily(facts.rows), error: null, fallback: true, warnings: facts.warnings };
}

export async function getTechnicianProductivity() {
  const result = await sb.from('technician_productivity').select('*').order('completed_jobs', { ascending: false });
  if (!result.error) return { data: result.data || [], error: null, fallback: false, warnings: [] as string[] };
  if (!isMissingRelationError(result.error, 'technician_productivity')) throw result.error;
  const facts = await loadJobFacts();
  return { data: aggregateProductivity(facts.rows), error: null, fallback: true, warnings: facts.warnings };
}

async function loadQADashboard() {
  const view = await sb.from('qa_dashboard').select('*').single();
  if (!view.error) return { data: view.data, warning: '' };
  if (!isMissingRelationError(view.error, 'qa_dashboard')) throw view.error;

  const source = await sb.from('qa_reviews').select('score,passed');
  if (source.error) {
    if (isMissingRelationError(source.error, 'qa_reviews')) return { data: null, warning: operationsSetupMessage(source.error, 'QA analytics') };
    throw source.error;
  }
  const rows = source.data || [];
  const scored = rows.filter((row: any) => Number.isFinite(Number(row.score)));
  return {
    data: {
      total_reviews: rows.length,
      passed_reviews: rows.filter((row: any) => row.passed === true).length,
      failed_reviews: rows.filter((row: any) => row.passed === false).length,
      average_score: scored.length ? Math.round((scored.reduce((sum: number, row: any) => sum + Number(row.score), 0) / scored.length) * 100) / 100 : 0,
    },
    warning: 'QA analytics is using a client-side fallback because qa_dashboard is not deployed.',
  };
}

async function loadReworkDashboard() {
  const view = await sb.from('rework_dashboard').select('*').single();
  if (!view.error) return { data: view.data, warning: '' };
  if (!isMissingRelationError(view.error, 'rework_dashboard')) throw view.error;

  const source = await sb.from('reworks').select('resolved');
  if (source.error) {
    if (isMissingRelationError(source.error, 'reworks')) return { data: null, warning: operationsSetupMessage(source.error, 'Rework analytics') };
    throw source.error;
  }
  const rows = source.data || [];
  return {
    data: {
      total_reworks: rows.length,
      resolved_reworks: rows.filter((row: any) => row.resolved === true).length,
      open_reworks: rows.filter((row: any) => row.resolved !== true).length,
    },
    warning: 'Rework analytics is using a client-side fallback because rework_dashboard is not deployed.',
  };
}

export async function getOperationsDashboard() {
  const [production, productivity, qa, reworks] = await Promise.all([
    getDailyProduction(),
    getTechnicianProductivity(),
    loadQADashboard(),
    loadReworkDashboard(),
  ]);

  const warnings = [
    production.fallback ? 'Daily production is using live routes plus archived snapshots because the analytics view is not deployed.' : '',
    productivity.fallback ? 'Technician productivity is using live routes plus archived snapshots because the analytics view is not deployed.' : '',
    ...(production.warnings || []),
    ...(productivity.warnings || []),
    qa.warning,
    reworks.warning,
  ].filter(Boolean);

  return {
    production: production.data || [],
    productivity: productivity.data || [],
    qa: qa.data,
    reworks: reworks.data,
    warnings: [...new Set(warnings)],
  };
}
