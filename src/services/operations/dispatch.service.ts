import { sb } from '../../config/supabase';
import { getTechsByRegion } from '../../config/regions';
import { isMissingColumnError, isMissingRelationError, operationsSetupMessage } from './schema.service';

export type DispatchCandidate = {
  id: string;
  name?: string;
  region?: string;
  active_jobs?: number;
  specialties?: string[];
};

export async function getDispatchRules(region?: string, serviceType?: string) {
  let query = sb.from('dispatch_rules').select('*').eq('active', true).order('priority');
  if (region) query = query.eq('region', region);
  if (serviceType) query = query.eq('service_type', serviceType);
  const result = await query;
  if (result.error && isMissingRelationError(result.error, 'dispatch_rules')) {
    return { ...result, data: [], error: null, warning: operationsSetupMessage(result.error, 'Dispatch rules') } as typeof result & { warning?: string };
  }
  return result as typeof result & { warning?: string };
}

export async function createDispatchRule(input: {
  region: string;
  service_type?: string;
  technician_id?: string;
  specialty?: string;
  priority?: number;
}) {
  return sb.from('dispatch_rules').insert({ ...input, active: true }).select().single();
}

export async function deactivateDispatchRule(id: string) {
  return sb.from('dispatch_rules').update({ active: false }).eq('id', id);
}

export async function getDispatchBoard(region: string, date: string) {
  const jobsResult = await sb
    .from('routes')
    .select('id,date,tech_id,job_id,address,city,zip,type,status,order_num,phone,region')
    .eq('region', region)
    .eq('date', date)
    .order('tech_id')
    .order('order_num');
  if (jobsResult.error) throw jobsResult.error;

  let techResult = await sb.from('technicians').select('id,name,region,active,specialties').eq('region', region).eq('active', true).order('id');
  let specialtiesUnavailable = false;
  if (techResult.error && isMissingColumnError(techResult.error, 'specialties')) {
    specialtiesUnavailable = true;
    techResult = await sb.from('technicians').select('id,name,region,active').eq('region', region).eq('active', true).order('id') as typeof techResult;
  }
  if (techResult.error) throw techResult.error;
  const jobs = jobsResult.data;
  const configuredTechs = getTechsByRegion(region);
  const dbTechs = (techResult.data || []) as any[];
  const dbTechById = new Map(dbTechs.map((tech: any) => [String(tech.id), tech]));
  const technicians = configuredTechs.length
    ? configuredTechs.map((tech) => {
      const dbTech = dbTechById.get(String(tech.id)) || {};
      return {
        ...dbTech,
        id: tech.id,
        name: tech.name,
        region: tech.region,
        active: dbTech.active ?? true,
        specialties: dbTech.specialties || [],
      };
    })
    : dbTechs;
  const load = new Map<string, number>();
  (jobs || []).forEach((job: any) => {
    if (['pending', 'assigned', 'en_route', 'arrived', 'in_progress'].includes(String(job.status))) {
      load.set(String(job.tech_id || ''), (load.get(String(job.tech_id || '')) || 0) + 1);
    }
  });
  return {
    jobs: jobs || [],
    technicians: (technicians || []).map((tech: any) => ({ ...tech, specialties: tech.specialties || [], active_jobs: load.get(String(tech.id)) || 0 })),
    warnings: specialtiesUnavailable ? ['Technician specialties are unavailable until the operations migration is applied. Dispatch assignment remains available.'] : [],
  };
}

export async function findBestTechnician(job: any): Promise<DispatchCandidate | null> {
  const region = job.region || job.market || null;
  const serviceType = job.service_type || job.type || null;

  const { data: rules } = await getDispatchRules(region, serviceType);
  if (rules?.length && rules[0].technician_id) {
    const { data: tech } = await sb.from('technicians').select('*').eq('id', rules[0].technician_id).maybeSingle();
    return tech as DispatchCandidate | null;
  }

  let techQuery = sb.from('technicians').select('*').eq('active', true);
  if (region) techQuery = techQuery.eq('region', region);
  const { data: techs } = await techQuery;
  const configuredTechs = region ? getTechsByRegion(region) : [];
  const configuredById = new Map(configuredTechs.map((tech) => [String(tech.id), tech]));
  const eligibleTechs = configuredTechs.length
    ? (techs || [])
      .filter((tech: any) => configuredById.has(String(tech.id)))
      .map((tech: any) => ({ ...tech, name: configuredById.get(String(tech.id))?.name || tech.name }))
    : (techs || []);
  if (!eligibleTechs.length) return null;

  const { data: routes } = await sb.from('routes').select('tech_id,status').in('status', ['pending', 'assigned', 'en_route', 'arrived', 'in_progress']);
  const loadMap = new Map<string, number>();
  (routes || []).forEach((r: any) => loadMap.set(String(r.tech_id), (loadMap.get(String(r.tech_id)) || 0) + 1));

  return [...eligibleTechs]
    .map((t: any) => ({ ...t, active_jobs: loadMap.get(String(t.id)) || 0 }))
    .sort((a: any, b: any) => (a.active_jobs || 0) - (b.active_jobs || 0))[0] as DispatchCandidate;
}

export async function assignJob(routeId: string, technicianId: string) {
  // Reassignment must not move the job into an unsupported status. The technician
  // portal treats pending as the actionable state and preserves in-progress states.
  return sb.from('routes').update({ tech_id: technicianId }).eq('id', routeId).select().single();
}

export async function autoAssignJob(routeId: string) {
  const { data: job, error } = await sb.from('routes').select('*').eq('id', routeId).single();
  if (error) throw error;
  const tech = await findBestTechnician(job);
  if (!tech) throw new Error('No technician available for auto assignment');
  const { error: assignError } = await assignJob(job.id, tech.id);
  if (assignError) throw assignError;
  return { job, technician: tech };
}
