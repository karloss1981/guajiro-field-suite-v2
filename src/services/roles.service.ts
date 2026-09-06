import { sb } from '../config/supabase';
import type { AppRole } from '../types/roles';

export async function getCurrentUserRoles(): Promise<AppRole[]> {
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  const { data, error } = await sb
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId);

  if (error || !data) return [];

  return data
    .map((row: any) => row.roles?.name)
    .filter(Boolean) as AppRole[];
}

export function hasAnyRole(userRoles: AppRole[], allowedRoles: AppRole[]) {
  return allowedRoles.some((role) => userRoles.includes(role));
}
