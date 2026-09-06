import { sb } from '../config/supabase';
import type { DailyRouteSnapshot, ArchivedRoute } from '../types/technician';

export async function fetchSnapshots(region: string): Promise<DailyRouteSnapshot[]> {
  const { data, error } = await sb
    .from('daily_route_snapshots')
    .select('id,region,date,job_count,done_count,total_earned,saved_at')
    .eq('region', region)
    .order('date', { ascending: false })
    .limit(90);
  if (error) throw error;
  return (data as DailyRouteSnapshot[]) || [];
}

export async function fetchSnapshotData(id: string): Promise<unknown> {
  const { data, error } = await sb
    .from('daily_route_snapshots')
    .select('snapshot')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as { snapshot: unknown } | null)?.snapshot ?? null;
}

export async function upsertSnapshot(snap: Omit<DailyRouteSnapshot, 'id'>): Promise<void> {
  const { error } = await sb
    .from('daily_route_snapshots')
    .upsert(snap, { onConflict: 'region,date' });
  if (error) throw error;
}

export async function insertArchivedRoute(archive: Omit<ArchivedRoute, 'id'>): Promise<void> {
  const { error } = await sb.from('archived_routes').insert(archive);
  if (error) throw error;
}
