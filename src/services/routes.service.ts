import { sb } from '../config/supabase';
import { normalizePagination, type PaginationOptions } from './pagination';
import type { Route } from '../types/job';

export async function fetchTechRoutes(techId: string, date: string): Promise<Route[]> {
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .eq('tech_id', techId)
    .eq('date', date)
    .order('order_num');
  if (error) throw error;
  return (data as Route[]) || [];
}

export async function fetchRegionRoutes(region: string, date: string): Promise<Route[]> {
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .eq('date', date)
    .eq('region', region)
    .order('tech_id')
    .order('order_num');
  if (error) throw error;
  return (data as Route[]) || [];
}

export async function fetchRoutesByDateRange(
  region: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<Route[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .eq('region', region)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .order('order_num')
    .range(from, to);
  if (error) throw error;
  return (data as Route[]) || [];
}

export async function fetchDoneRoutesSince(region: string, cutoff: string): Promise<Route[]> {
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .eq('region', region)
    .eq('status', 'done')
    .gte('date', cutoff);
  if (error) throw error;
  return (data as Route[]) || [];
}

export async function fetchTechDoneRoutes(
  techId: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<Route[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .eq('tech_id', techId)
    .eq('status', 'done')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as Route[]) || [];
}

export async function fetchRouteDateStatuses(region: string, from: string): Promise<{ date: string; status: string }[]> {
  const { data, error } = await sb
    .from('routes')
    .select('date,status')
    .gte('date', from)
    .eq('region', region);
  if (error) throw error;
  return (data as { date: string; status: string }[]) || [];
}

export async function updateRouteStatus(
  id: string,
  update: Partial<Route>
): Promise<void> {
  const { error } = await sb.from('routes').update(update).eq('id', id);
  if (error) throw error;
}

export async function updateRouteOrder(id: string, orderNum: number): Promise<void> {
  const { error } = await sb.from('routes').update({ order_num: orderNum }).eq('id', id);
  if (error) throw error;
}

export async function reassignRoute(id: string, techId: string): Promise<void> {
  const { error } = await sb.from('routes').update({ tech_id: techId }).eq('id', id);
  if (error) throw error;
}

export async function insertRoutes(routes: Partial<Route>[]): Promise<void> {
  for (let c = 0; c < routes.length; c += 50) {
    const { error } = await sb.from('routes').insert(routes.slice(c, c + 50));
    if (error) throw error;
  }
}

export async function insertRoute(route: Partial<Route>): Promise<void> {
  const { error } = await sb.from('routes').insert(route);
  if (error) throw error;
}

// V25.2 note: deleteRegionRoutes() was removed here. It performed an
// unguarded whole-route delete, had ZERO callers, and whole-route deletion
// must now go exclusively through routeDelete.service.ts (Super Admin RPC).

export async function searchRoutes(
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions | number = {},
): Promise<Route[]> {
  const { from, to } = normalizePagination(
    typeof pagination === 'number' ? { pageSize: pagination } : pagination,
  );
  const { data, error } = await sb
    .from('routes')
    .select('*')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as Route[]) || [];
}
