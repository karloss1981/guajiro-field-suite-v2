import { sb } from '../config/supabase';
import type { AppRole } from '../types/roles';

export type ManagedUser = {
  user_id: string;
  display_name: string | null;
  region: 'miami' | 'swfl' | null;
  technician_id: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  roles: AppRole[];
};

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const { data: profiles, error: profileError } = await sb
    .from('user_profiles')
    .select('user_id,display_name,region,technician_id,active,created_at,updated_at')
    .order('display_name', { ascending: true });
  if (profileError) throw profileError;

  const userIds = (profiles || []).map((profile: any) => profile.user_id);
  let roleRows: any[] = [];
  if (userIds.length) {
    const { data, error } = await sb
      .from('user_roles')
      .select('user_id,roles(name)')
      .in('user_id', userIds);
    if (error) throw error;
    roleRows = data || [];
  }

  const rolesByUser = new Map<string, AppRole[]>();
  for (const row of roleRows) {
    const role = row.roles?.name as AppRole | undefined;
    if (!role) continue;
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), role]);
  }

  return (profiles || []).map((profile: any) => ({
    ...profile,
    roles: rolesByUser.get(profile.user_id) || [],
  }));
}

export async function bootstrapFirstSuperAdmin() {
  const { data, error } = await sb.rpc('bootstrap_first_super_admin');
  if (error) throw error;
  return data === true;
}

export async function replaceUserRole(userId: string, role: AppRole) {
  const { data, error } = await sb.rpc('replace_user_role', {
    target_user_id: userId,
    target_role: role,
  });
  if (error) throw error;
  return data === true;
}

export async function updateManagedUserProfile(input: {
  userId: string;
  displayName: string;
  region: 'miami' | 'swfl';
  technicianId?: string | null;
  active: boolean;
}) {
  const { data, error } = await sb.rpc('upsert_user_profile', {
    target_user_id: input.userId,
    target_display_name: input.displayName,
    target_region: input.region,
    target_technician_id: input.technicianId || null,
    target_active: input.active,
  });
  if (error) throw error;
  return data === true;
}

export async function getLegacyAccessEnabled() {
  const { data, error } = await sb.rpc('is_legacy_access_enabled');
  if (error) throw error;
  return data === true;
}

export async function getAdminEmailRequired() {
  const { data, error } = await sb.rpc('is_admin_email_required');
  if (error) throw error;
  return data !== false;
}

export async function getTechnicianPinAccessEnabled() {
  const { data, error } = await sb.rpc('is_technician_pin_access_enabled');
  if (error) throw error;
  return data !== false;
}

export async function setLegacyAccessEnabled(enabled: boolean) {
  const { data, error } = await sb.rpc('set_legacy_access_enabled', { enabled });
  if (error) throw error;
  return data === enabled;
}

export async function createSecureUserAccount(input: {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
  region: 'miami' | 'swfl';
  technicianId?: string | null;
}) {
  const { data, error } = await sb.functions.invoke('admin-create-user', {
    body: {
      email: input.email.trim(),
      password: input.password,
      display_name: input.displayName.trim(),
      role: input.role,
      region: input.region,
      technician_id: input.technicianId || null,
    },
  });
  if (error) throw error;
  if (!data?.user_id) throw new Error(data?.error || 'The account service did not return a user ID.');
  return data as { user_id: string; email: string };
}
