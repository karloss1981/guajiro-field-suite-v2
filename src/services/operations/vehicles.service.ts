import { sb } from '../../config/supabase';

export async function getVehicles(includeInactive = false) {
  let query = sb.from('vehicles').select('*').order('unit_number');
  if (!includeInactive) query = query.eq('active', true);
  return query;
}

export async function createVehicle(input: {
  unit_number: string;
  make?: string;
  model?: string;
  year?: number | null;
  plate?: string;
  assigned_to?: string;
}) {
  return sb.from('vehicles').upsert({ ...input, active: true }, { onConflict: 'unit_number' }).select().single();
}

export async function deactivateVehicle(id: string) {
  return sb.from('vehicles').update({ active: false }).eq('id', id);
}

export async function createVehicleInspection(input: {
  vehicle_id: string;
  technician_id?: string;
  checklist?: Record<string, unknown>;
  passed?: boolean;
  notes?: string;
}) {
  return sb.from('vehicle_inspections').insert(input).select().single();
}

export async function getVehicleInspections(vehicleId: string) {
  return sb.from('vehicle_inspections').select('*').eq('vehicle_id', vehicleId).order('inspection_date', { ascending: false });
}
