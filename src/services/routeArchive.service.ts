import { sb } from '../config/supabase';
import { isMissingRelationError, operationsSetupMessage } from './operations/schema.service';

export type RouteArchiveSummary = {
  region: string;
  date: string;
  snapshot: any[];
  job_count: number;
  done_count: number;
  notdone_count: number;
  total_earned: number;
  saved_at: string;
};

function isDone(status: unknown) {
  return ['done', 'completed'].includes(String(status || '').toLowerCase());
}

function isNotDone(status: unknown) {
  return ['notdone', 'not_done', 'not_completed', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function summarizeRouteArchive(region: string, date: string, routes: any[]): RouteArchiveSummary {
  const done = routes.filter((route) => isDone(route.status));
  const notDone = routes.filter((route) => isNotDone(route.status));
  return {
    region,
    date,
    snapshot: routes,
    job_count: routes.length,
    done_count: done.length,
    notdone_count: notDone.length,
    total_earned: done.reduce((sum, route) => sum + Number(route.pay_total || 0), 0),
    saved_at: new Date().toISOString(),
  };
}

export async function saveDailyRouteSnapshot(region: string, date: string, routes: any[]) {
  const summary = summarizeRouteArchive(region, date, routes);
  const { error } = await sb.from('daily_route_snapshots').upsert({
    region: summary.region,
    date: summary.date,
    snapshot: summary.snapshot,
    job_count: summary.job_count,
    done_count: summary.done_count,
    total_earned: summary.total_earned,
    saved_at: summary.saved_at,
  }, { onConflict: 'region,date' });
  if (error) throw new Error(operationsSetupMessage(error, 'Route Archive'));

  const verification = await sb.from('daily_route_snapshots').select('id,job_count,saved_at').eq('region', region).eq('date', date).maybeSingle();
  if (verification.error) throw new Error(operationsSetupMessage(verification.error, 'Route Archive verification'));
  if (!verification.data || Number(verification.data.job_count || 0) !== routes.length) {
    throw new Error('Route Archive verification failed. The active route was not cleared to protect the route data.');
  }
  return { summary, record: verification.data };
}

export async function savePermanentRouteArchive(region: string, date: string, routes: any[]) {
  const summary = summarizeRouteArchive(region, date, routes);
  const result = await sb.from('archived_routes').insert({
    region,
    route_date: date,
    job_count: summary.job_count,
    done_count: summary.done_count,
    notdone_count: summary.notdone_count,
    total_earned: summary.total_earned,
    snapshot: routes,
    archived_at: summary.saved_at,
  }).select('id').single();

  if (result.error && isMissingRelationError(result.error, 'archived_routes')) {
    return { data: null, warning: operationsSetupMessage(result.error, 'Permanent route archive') };
  }
  if (result.error) throw new Error(operationsSetupMessage(result.error, 'Permanent route archive'));
  return { data: result.data, warning: '' };
}
