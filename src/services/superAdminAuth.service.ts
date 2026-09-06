// GUAJIRO V25 — Super Admin (email) authentication gate.
// A Super Admin session must always be a real Supabase email/password session.
// PIN/legacy sessions are never eligible, regardless of role or PIN value —
// this is what keeps PIN 0101 (or any technician/role PIN) from ever being
// able to perform destructive actions such as deleting a route.
import type { AuthState } from '../types/auth';

// Official Super Admin account for this build. Kept as a hard safety net so
// destructive-action gating never depends solely on the user_roles table
// being correctly synced. The roles table remains the source of truth for
// everything else (dashboards, tab visibility, etc).
export const SUPER_ADMIN_EMAIL = 'karloss1981@gmail.com';

export function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

export function isOfficialSuperAdminEmail(email?: string | null): boolean {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

/**
 * True only when:
 *  - the session was created through Supabase email/password (authMode === 'supabase')
 *  - AND either the account carries the super_admin app role, or the account
 *    email matches the official Super Admin email.
 * PIN-based sessions (authMode === 'legacy') always return false here, even
 * if the accessRole happens to be 'admin' and the PIN matched.
 */
export function isSuperAdminSession(auth?: AuthState | null): boolean {
  if (!auth) return false;
  if (auth.authMode !== 'supabase') return false;
  if (isOfficialSuperAdminEmail(auth.user?.email)) return true;
  return Array.isArray(auth.appRoles) && auth.appRoles.includes('super_admin');
}

export function assertSuperAdminSession(auth?: AuthState | null): void {
  if (!isSuperAdminSession(auth)) {
    throw new Error('Active Super Admin session required for this action.');
  }
}

/**
 * Human-readable explanation of why a session does not qualify as Super Admin.
 * Used by SuperAdminDeleteGate and actionGuard so every denial shows a clear
 * reason instead of a generic "not allowed" message.
 */
export function describeSuperAdminGap(auth?: AuthState | null, lang: string = 'en'): string {
  const es = lang === 'es';
  if (!auth) {
    return es ? 'Sesión requerida. Inicia sesión como Super Admin.' : 'Session required. Sign in as Super Admin.';
  }
  if (auth.authMode !== 'supabase') {
    return es
      ? 'Esta acción requiere sesión Super Admin por correo/contraseña. El acceso por PIN no aplica.'
      : 'This action requires a Super Admin email/password session. PIN access does not qualify.';
  }
  return es
    ? 'Tu cuenta no tiene privilegios de Super Admin.'
    : 'Your account does not have Super Admin privileges.';
}
