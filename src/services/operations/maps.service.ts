import { sb } from '../../config/supabase';

export async function getOperationalMarkers() {
  return sb.from('map_markers').select('*').order('updated_at', { ascending: false });
}

export async function upsertJobMarker(input: any) {
  return sb.from('map_markers').upsert(input).select().single();
}

export async function getTechnicianMarkers() {
  return sb.from('map_markers').select('*').eq('marker_type', 'Technician');
}
