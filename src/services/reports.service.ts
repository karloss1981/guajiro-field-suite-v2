import { sb } from '../config/supabase';
import { normalizePagination, type PaginationOptions } from './pagination';
import type { NotDoneReport, CompletedJob, CancelledJob } from '../types/job';

export async function fetchRegionReports(region: string, date: string): Promise<NotDoneReport[]> {
  const { data, error } = await sb
    .from('not_done_reports')
    .select('*')
    .eq('date', date)
    .eq('region', region)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NotDoneReport[]) || [];
}

export async function fetchReportsByDateRange(
  region: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<NotDoneReport[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('not_done_reports')
    .select('*')
    .eq('region', region)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as NotDoneReport[]) || [];
}

export async function insertNotDoneReport(report: Omit<NotDoneReport, 'id' | 'created_at'>): Promise<void> {
  const { error } = await sb.from('not_done_reports').insert(report);
  if (error) throw error;
}

export async function fetchCompletedJobs(
  region: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<CompletedJob[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('completed_jobs')
    .select('*')
    .eq('region', region)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as CompletedJob[]) || [];
}

export async function fetchTechCompletedJobs(
  techId: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<CompletedJob[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('completed_jobs')
    .select('*')
    .eq('tech_id', techId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as CompletedJob[]) || [];
}

export async function insertCompletedJob(job: Omit<CompletedJob, 'id'>): Promise<void> {
  const { error } = await sb.from('completed_jobs').insert(job);
  if (error) throw error;
}

export async function searchCompletedJobs(
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<CompletedJob[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('completed_jobs')
    .select('*')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as CompletedJob[]) || [];
}

export async function fetchCancelledJobs(
  region: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<CancelledJob[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('cancelled_jobs')
    .select('*')
    .eq('region', region)
    .gte('source_route_date', dateFrom)
    .lte('source_route_date', dateTo)
    .order('cancelled_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as CancelledJob[]) || [];
}

export async function resolveCancelledJob(id: string): Promise<void> {
  const { error } = await sb.from('cancelled_jobs').update({ status: 'resolved' }).eq('id', id);
  if (error) throw error;
}

export async function insertCancelledJobs(jobs: Partial<CancelledJob>[]): Promise<void> {
  for (let c = 0; c < jobs.length; c += 50) {
    const { error } = await sb.from('cancelled_jobs').insert(jobs.slice(c, c + 50));
    if (error) throw error;
  }
}

export async function fetchOpenCancelledAddresses(region: string): Promise<{ address: string; city: string }[]> {
  const { data, error } = await sb
    .from('cancelled_jobs')
    .select('address,city')
    .eq('region', region)
    .eq('status', 'cancelled');
  if (error) throw error;
  return (data as { address: string; city: string }[]) || [];
}

export async function searchCancelledJobs(
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<CancelledJob[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('cancelled_jobs')
    .select('*')
    .gte('source_route_date', dateFrom)
    .lte('source_route_date', dateTo)
    .order('cancelled_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as CancelledJob[]) || [];
}
