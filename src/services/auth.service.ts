import type { Session } from '@supabase/supabase-js';
import { sb, SUPABASE_CONFIGURED } from '../config/supabase';
import type { AuthState } from '../types/auth';
import type { AppRole } from '../types/roles';

const ROLE_PRIORITY: AppRole[] = [
  'super_admin',
  'admin',
  'supervisor',
  'dispatcher',
  'viewer',
  'technician',
];

export type AuthModeSetting = 'supabase' | 'hybrid' | 'legacy';

export function getConfiguredAuthMode(): AuthModeSetting {
  if (!SUPABASE_CONFIGURED) return 'legacy';
  const value = String(import.meta.env.VITE_AUTH_MODE || 'hybrid').toLowerCase();
  if (value === 'supabase' || value === 'legacy') return value;
  return 'hybrid';
}

function normalizeRegion(value: unknown): 'miami' | 'swfl' {
  return value === 'swfl' ? 'swfl' : 'miami';
}

function mapPortalAccessRole(role: AppRole): AuthState['accessRole'] {
  if (role === 'super_admin' || role === 'admin') return 'admin';
  if (role === 'viewer') return 'viewer';
  if (role === 'technician') return 'tech';
  return 'supervisor';
}

export async function buildAuthContextFromSession(session?: Session | null): Promise<AuthState | null> {
  const activeSession = session ?? (await sb.auth.getSession()).data.session;
  if (!activeSession?.user) return null;

  const userId = activeSession.user.id;

  // v21.5: Admin email login must not fail just because nested role reads or
  // older RLS policies are not perfectly aligned. Read profile first, then use
  // user_roles/RPC as supporting sources. This keeps technicians on PIN while
  // allowing Admin/Super Admin to enter with Supabase Auth.
  const { data: profile, error: profileError } = await sb
    .from('user_profiles')
    .select('user_id,email,display_name,role,region,technician_id,tech_number,active')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError && profileError.code !== '42P01') {
    throw profileError;
  }

  if (profile && profile.active === false) {
    await sb.auth.signOut();
    throw new Error('This account is inactive. Contact an administrator.');
  }

  const rolesFromProfile = [profile?.role]
    .filter((role: unknown): role is AppRole => typeof role === 'string' && ROLE_PRIORITY.includes(role as AppRole));

  let rolesFromJoin: AppRole[] = [];
  let roleReadError: string | null = null;
  try {
    const { data: roleRows, error } = await sb
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId);
    if (error) throw error;
    rolesFromJoin = (roleRows || [])
      .map((row: any) => row.roles?.name)
      .filter((role: unknown): role is AppRole => typeof role === 'string' && ROLE_PRIORITY.includes(role as AppRole));
  } catch (err: any) {
    roleReadError = err?.message || 'Unable to read user_roles.';
  }

  let roleFromRpc: AppRole | null = null;
  try {
    const { data, error } = await sb.rpc('current_app_role');
    if (error) throw error;
    if (typeof data === 'string' && ROLE_PRIORITY.includes(data as AppRole)) {
      roleFromRpc = data as AppRole;
    }
  } catch {
    // Optional diagnostic only. Profile role is enough for admin login in v21.5.
  }

  const mergedRoles = Array.from(new Set([
    ...rolesFromJoin,
    ...(roleFromRpc ? [roleFromRpc] : []),
    ...rolesFromProfile,
  ]));

  const primaryRole = ROLE_PRIORITY.find((role) => mergedRoles.includes(role));
  if (!primaryRole) {
    const details = roleReadError ? ` Role read error: ${roleReadError}` : '';
    throw new Error(`This account does not have an application role assigned. Check user_profiles.role and user_roles.${details}`);
  }

  const appRoles = mergedRoles.length ? mergedRoles : [primaryRole];

  const metadata = activeSession.user.user_metadata || {};
  const region = normalizeRegion(profile?.region || metadata.region);
  const displayName =
    profile?.display_name ||
    metadata.full_name ||
    metadata.name ||
    activeSession.user.email ||
    'Field Suite User';

  if (primaryRole === 'technician') {
    const technicianId = profile?.technician_id || metadata.technician_id;
    if (!technicianId) {
      throw new Error('The technician account is not linked to a technician number.');
    }
    const { data: technician, error } = await sb
      .from('technicians')
      .select('id,name,region,active,gps_consent')
      .eq('id', technicianId)
      .maybeSingle();
    if (error) throw error;
    if (!technician || technician.active === false) {
      throw new Error('The linked technician record is missing or inactive.');
    }
    return {
      role: 'tech',
      accessRole: 'tech',
      appRoles,
      authMode: 'supabase',
      sessionUserId: userId,
      region: normalizeRegion(technician.region || region),
      user: { id: userId, name: displayName, email: activeSession.user.email, region },
      tech: {
        id: String(technician.id),
        name: technician.name || displayName,
        region: normalizeRegion(technician.region || region),
        active: technician.active,
        gps_consent: technician.gps_consent,
      },
    };
  }

  return {
    role: 'supervisor',
    accessRole: mapPortalAccessRole(primaryRole),
    appRoles,
    authMode: 'supabase',
    sessionUserId: userId,
    region,
    user: { id: userId, name: displayName, email: activeSession.user.email, region },
  };
}

export async function signInWithPassword(email: string, password: string): Promise<AuthState> {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  const context = await buildAuthContextFromSession(data.session);
  if (!context) throw new Error('Unable to create an authenticated application session.');
  return context;
}

export async function restoreAuthenticatedContext() {
  return buildAuthContextFromSession();
}

export async function signOutCurrentUser() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}
