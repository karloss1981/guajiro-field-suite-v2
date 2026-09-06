import { sb } from '../config/supabase';
import { normalizePagination, type PaginationOptions } from './pagination';
import type { TechNote, SupervisorNote } from '../types/note';

export async function fetchTechNotes(techId: string, date: string): Promise<TechNote[]> {
  const { data, error } = await sb
    .from('tech_notes')
    .select('*')
    .eq('tech_id', techId)
    .eq('date', date)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as TechNote[]) || [];
}

export async function fetchRegionTechNotes(region: string, date: string): Promise<TechNote[]> {
  const { data, error } = await sb
    .from('tech_notes')
    .select('*')
    .eq('date', date)
    .eq('region', region)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as TechNote[]) || [];
}

export async function fetchTechNotesByDateRange(
  region: string,
  dateFrom: string,
  dateTo: string,
  pagination: PaginationOptions = {},
): Promise<TechNote[]> {
  const { from, to } = normalizePagination(pagination);
  const { data, error } = await sb
    .from('tech_notes')
    .select('*')
    .eq('region', region)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data as TechNote[]) || [];
}

export async function insertTechNote(note: Omit<TechNote, 'id' | 'created_at'>): Promise<void> {
  const { error } = await sb.from('tech_notes').insert(note);
  if (error) throw error;
}

export async function fetchSupervisorNotes(region: string, date: string): Promise<SupervisorNote[]> {
  const { data, error } = await sb
    .from('supervisor_notes')
    .select('*')
    .eq('date', date)
    .eq('region', region)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SupervisorNote[]) || [];
}

export async function insertSupervisorNote(note: Omit<SupervisorNote, 'id' | 'created_at'>): Promise<void> {
  const { error } = await sb.from('supervisor_notes').insert(note);
  if (error) throw error;
}
