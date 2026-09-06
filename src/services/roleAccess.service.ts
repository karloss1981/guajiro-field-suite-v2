// GUAJIRO V25 — Role -> capability mapping.
// Single source of truth for "what can this role do" so pages don't each
// invent their own rules. Kept intentionally small: view / edit / delete /
// manage security / manage roles.
//
// super_admin : full control (view, edit, delete, manage security & roles)
// admin       : edit, no delete
// supervisor  : edit, no delete
// dispatcher  : edit, no delete (kept for backward compatibility with the
//               existing roles table; not part of the V25 spec but must not
//               be broken by it)
// viewer      : read-only
// technician  : PIN portal only, read-only from the ops-role perspective
import type { AppRole } from '../types/roles';
import type { AuthState } from '../types/auth';
import { isSuperAdminSession } from './superAdminAuth.service';

export type Capability = 'view' | 'edit' | 'delete' | 'manage_security' | 'manage_roles';

const ROLE_PRIORITY: AppRole[] = ['super_admin', 'admin', 'supervisor', 'dispatcher', 'viewer', 'technician'];

const ROLE_CAPABILITIES: Record<AppRole, Capability[]> = {
  super_admin: ['view', 'edit', 'delete', 'manage_security', 'manage_roles'],
  admin: ['view', 'edit'],
  supervisor: ['view', 'edit'],
  dispatcher: ['view', 'edit'],
  viewer: ['view'],
  technician: ['view'],
};

/**
 * Resolves the single highest-priority AppRole for an AuthState, working
 * whether the session came from the AppRole system (appRoles[]) or from the
 * legacy AccessRole system (accessRole: tech/viewer/supervisor/admin).
 */
export function resolveAppRole(auth?: AuthState | null): AppRole {
  if (!auth) return 'viewer';
  if (auth.role === 'tech') return 'technician';
  if (Array.isArray(auth.appRoles) && auth.appRoles.length) {
    const match = ROLE_PRIORITY.find((role) => auth.appRoles!.includes(role));
    if (match) return match;
  }
  if (auth.accessRole === 'admin') return 'admin';
  if (auth.accessRole === 'viewer') return 'viewer';
  if (auth.accessRole === 'tech') return 'technician';
  return 'supervisor';
}

export function hasCapability(auth: AuthState | null | undefined, capability: Capability): boolean {
  // Delete and security management always require a true Super Admin
  // session on top of the role check — a misconfigured role row must never
  // be enough on its own to unlock destructive actions.
  if (capability === 'delete' || capability === 'manage_security') {
    return isSuperAdminSession(auth);
  }
  const role = resolveAppRole(auth);
  return (ROLE_CAPABILITIES[role] || []).includes(capability);
}

export function canView(auth?: AuthState | null) {
  return hasCapability(auth, 'view');
}
export function canEdit(auth?: AuthState | null) {
  return hasCapability(auth, 'edit');
}
export function canDelete(auth?: AuthState | null) {
  return hasCapability(auth, 'delete');
}
export function canManageSecurity(auth?: AuthState | null) {
  return hasCapability(auth, 'manage_security');
}
export function canManageRoles(auth?: AuthState | null) {
  return isSuperAdminSession(auth) || hasCapability(auth, 'manage_roles');
}
export function isViewOnly(auth?: AuthState | null) {
  return !canEdit(auth);
}

export const ROLE_ORDER = ROLE_PRIORITY;
