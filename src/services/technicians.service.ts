import { sb } from '../config/supabase';
import type { Technician, TechLocation } from '../types/technician';

export async function fetchTechnicianById(id: string): Promise<Technician | null> {
  const { data, error } = await sb
    .from('technicians')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Technician | null;
}

export async function fetchTechniciansByRegion(region: string): Promise<Technician[]> {
  const { data, error } = await sb
    .from('technicians')
    .select('*')
    .eq('region', region)
    .order('id');
  if (error) throw error;
  return (data as Technician[]) || [];
}

export async function upsertTechnician(tech: Partial<Technician>): Promise<void> {
  const { error } = await sb
    .from('technicians')
    .upsert(tech, { onConflict: 'id' });
  if (error) throw error;
}

export async function upsertTechnicians(techs: Partial<Technician>[]): Promise<void> {
  if (!techs.length) return;
  const { error } = await sb
    .from('technicians')
    .upsert(techs, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateTechnicianPin(id: string, pin: string | null): Promise<void> {
  const { error } = pin !== null
    ? await sb.from('technicians').update({ pin }).eq('id', id)
    : await sb.from('technicians').update({ pin: null }).eq('id', id);
  if (error) throw error;
}

export async function fetchExistingTechIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data, error } = await sb
    .from('technicians')
    .select('id')
    .in('id', ids);
  if (error) throw error;
  return ((data as { id: string }[]) || []).map(t => t.id);
}

export async function fetchAllTechLocations(): Promise<TechLocation[]> {
  const { data, error } = await sb
    .from('tech_locations')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as TechLocation[]) || [];
}

export async function upsertTechLocation(location: TechLocation): Promise<void> {
  const { error } = await sb
    .from('tech_locations')
    .upsert(location, { onConflict: 'tech_id' });
  if (error) throw error;
}
