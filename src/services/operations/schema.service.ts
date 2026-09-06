import { sb } from '../../config/supabase';

export type OperationsModuleId = 'dispatch' | 'qa' | 'reworks' | 'customers' | 'documents' | 'vehicles' | 'training' | 'communications' | 'analytics' | 'archive';

export type OperationsModuleHealth = {
  id: OperationsModuleId;
  ready: boolean;
  message?: string;
  missing?: string[];
};

type RelationCheck = { relation: string; select: string; label: string };

const CHECKS: Record<OperationsModuleId, RelationCheck[]> = {
  dispatch: [
    { relation: 'technicians', select: 'id,specialties', label: 'technicians.specialties' },
    { relation: 'dispatch_rules', select: 'id', label: 'dispatch_rules' },
  ],
  qa: [
    { relation: 'qa_reviews', select: 'id', label: 'qa_reviews' },
    { relation: 'qa_dashboard', select: 'total_reviews', label: 'qa_dashboard' },
  ],
  reworks: [
    { relation: 'reworks', select: 'id', label: 'reworks' },
    { relation: 'rework_dashboard', select: 'total_reworks', label: 'rework_dashboard' },
  ],
  customers: [
    { relation: 'customers', select: 'id,updated_at', label: 'customers' },
    { relation: 'routes', select: 'id,customer_id', label: 'routes.customer_id' },
  ],
  documents: [{ relation: 'documents', select: 'id', label: 'documents' }],
  vehicles: [
    { relation: 'vehicles', select: 'id', label: 'vehicles' },
    { relation: 'vehicle_inspections', select: 'id', label: 'vehicle_inspections' },
  ],
  training: [
    { relation: 'training_courses', select: 'id', label: 'training_courses' },
    { relation: 'training_progress', select: 'id', label: 'training_progress' },
  ],
  communications: [{ relation: 'announcements', select: 'id', label: 'announcements' }],
  analytics: [
    { relation: 'daily_production', select: 'technician_id', label: 'daily_production' },
    { relation: 'technician_productivity', select: 'technician_id', label: 'technician_productivity' },
    { relation: 'qa_dashboard', select: 'total_reviews', label: 'qa_dashboard' },
    { relation: 'rework_dashboard', select: 'total_reworks', label: 'rework_dashboard' },
  ],
  archive: [
    { relation: 'daily_route_snapshots', select: 'id', label: 'daily_route_snapshots' },
    { relation: 'archived_routes', select: 'id', label: 'archived_routes' },
    { relation: 'cancelled_jobs', select: 'id', label: 'cancelled_jobs' },
  ],
};

export function isMissingRelationError(error: any, relation?: string) {
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '');
  const missing = code === '42P01' || code === 'PGRST205' || message.includes('does not exist') || message.includes('could not find the table') || message.includes('could not find the view') || message.includes('schema cache');
  return missing && (!relation || message.includes(relation.toLowerCase()));
}

export function isMissingColumnError(error: any, column?: string) {
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '');
  const missing = code === '42703' || code === 'PGRST204' || (message.includes('column') && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')));
  return missing && (!column || message.includes(column.toLowerCase()));
}

export function operationsSetupMessage(error: any, moduleName?: string) {
  const raw = String(error?.message || error || 'Unknown database error');
  if (isMissingRelationError(error) || isMissingColumnError(error)) {
    return `${moduleName ? `${moduleName}: ` : ''}the connected Supabase project is missing a required table, view, or column. Apply SUPABASE_OPERATIONS_REPAIR.sql (migration 202606150009) and refresh the PostgREST schema cache.`;
  }
  if (String(error?.code || '') === '42501' || raw.toLowerCase().includes('row-level security')) {
    return `${moduleName ? `${moduleName}: ` : ''}Supabase rejected the request through RLS. Verify the deployed policies and the current authenticated session.`;
  }
  return raw;
}

export async function checkOperationsModule(id: OperationsModuleId): Promise<OperationsModuleHealth> {
  const missing: string[] = [];
  const rawMessages: string[] = [];

  for (const target of CHECKS[id]) {
    const { error } = await sb.from(target.relation).select(target.select).limit(1);
    if (!error) continue;
    missing.push(target.label);
    rawMessages.push(operationsSetupMessage(error, target.label));
  }

  if (!missing.length) return { id, ready: true, missing: [] };
  return {
    id,
    ready: false,
    missing,
    message: `${missing.join(', ')} unavailable. ${rawMessages[0]}`,
  };
}

export async function checkOperationsHealth(ids: OperationsModuleId[]) {
  return Promise.all(ids.map(checkOperationsModule));
}
