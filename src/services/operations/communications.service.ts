import { sb } from '../../config/supabase';

export async function getActiveAnnouncements(includeInactive = false) {
  let query = sb.from('announcements').select('*').order('created_at', { ascending: false });
  if (!includeInactive) query = query.eq('active', true);
  return query;
}

export async function createAnnouncement(input: { title: string; message: string; severity?: string; created_by?: string }) {
  return sb.from('announcements').insert(input).select().single();
}

export async function deactivateAnnouncement(id: string) {
  return sb.from('announcements').update({ active: false }).eq('id', id);
}
