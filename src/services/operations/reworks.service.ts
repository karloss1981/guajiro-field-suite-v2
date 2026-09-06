import { sb } from '../../config/supabase';

export async function createRework(input: {
  original_job_id?: string;
  route_id?: string;
  reason: string;
  assigned_to?: string;
}) {
  return sb.from('reworks').insert(input).select().single();
}

export async function resolveRework(id: string, resolution_notes?: string) {
  return sb.from('reworks').update({ resolved: true, resolved_at: new Date().toISOString(), resolution_notes }).eq('id', id).select().single();
}

export async function reopenRework(id: string) {
  return sb.from('reworks').update({ resolved: false, resolved_at: null }).eq('id', id).select().single();
}

export async function getReworks(showResolved = false) {
  let query = sb.from('reworks').select('*').order('created_at', { ascending: false });
  if (!showResolved) query = query.eq('resolved', false);
  return query;
}

export async function getOpenReworks() {
  return getReworks(false);
}

export async function getReworkDashboard() {
  return sb.from('rework_dashboard').select('*').single();
}
