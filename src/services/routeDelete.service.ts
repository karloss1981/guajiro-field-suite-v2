// GUAJIRO V25.1 — Whole-route deletion service.
// From V25.1 onward this is the ONLY module SupervisorPortal uses to delete
// a whole route. It calls the SECURITY DEFINER RPC super_admin_delete_route,
// which re-validates Super Admin at the database level — so even if every
// frontend check were bypassed, the DB itself refuses non-Super-Admin calls.
//
// TRANSITION FALLBACK (remove in V25.3):
// If the RPC does not exist yet (migration not applied to the live project),
// this service falls back to the legacy direct delete so the app keeps
// working during rollout. The fallback is no WEAKER than V25.0 behavior —
// the direct delete is still governed by routes_delete_scoped RLS — and it
// is flagged in the returned result + audit metadata so it never happens
// silently. Once 202607010001 is applied and verified, plan V25.3 removes
// this fallback and hardens the RLS delete policy.
import { sb } from '../config/supabase';
import { createAuditLog } from './audit.service';

export type RouteDeleteResult = {
  ok: boolean;
  deletedCount: number | null;
  usedRpc: boolean;
  warning?: string;
};

function isMissingRpcError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  // PGRST202: PostgREST "function not found in schema cache".
  // 42883: Postgres "function does not exist".
  return code === 'PGRST202' || code === '42883' || msg.includes('could not find the function') || msg.includes('does not exist');
}

export async function deleteRouteAsSuperAdmin(region: string, routeDate: string): Promise<RouteDeleteResult> {
  const { data, error } = await sb.rpc('super_admin_delete_route', {
    p_region: region,
    p_date: routeDate,
  });

  if (!error) {
    return {
      ok: true,
      deletedCount: typeof data?.deleted_count === 'number' ? data.deleted_count : null,
      usedRpc: true,
    };
  }

  if (!isMissingRpcError(error)) {
    // Real denial or real failure from the RPC — surface it as-is.
    // 'Only a Super Admin can delete a whole route.' comes through here.
    throw new Error(error.message || 'Route deletion was rejected by the database.');
  }

  // --- transition fallback: RPC not deployed yet -------------------------
  const warning =
    'super_admin_delete_route RPC is not deployed on this Supabase project yet. ' +
    'Falling back to direct delete (V25.0 behavior). Apply migration ' +
    '202607010001_v25_1_super_admin_route_delete_rpc.sql to close the DB-level gap.';
  const deletion = await sb.from('routes').delete().eq('date', routeDate).eq('region', region);
  if (deletion.error) throw deletion.error;
  await createAuditLog({
    action: 'route_delete_fallback_direct',
    entity: 'route',
    entityId: `${region}:${routeDate}`,
    metadata: { region, date: routeDate, reason: 'rpc_missing', summary: warning },
  }).catch(() => {});
  return { ok: true, deletedCount: null, usedRpc: false, warning };
}
