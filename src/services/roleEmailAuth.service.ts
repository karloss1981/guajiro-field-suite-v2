// GUAJIRO V25 — Role-based email login wrapper.
// Wraps the existing Supabase email/password flow (auth.service.ts) and
// classifies every failure into one of five clear, user-facing categories:
//   - wrong_pin            (handled on the technician/PIN screens, not here)
//   - technician_needs_pin (an email account tried to log in as technician)
//   - unauthorized_email   (credentials rejected or no application role)
//   - connection_failed    (Supabase/network unreachable)
//   - session_required     (no active session for a protected action)
// This does not replace auth.service.ts — it is the presentation-facing
// layer LoginPage.tsx should call so every screen reports errors the same
// way instead of raw Supabase error text.
import type { AuthState } from '../types/auth';
import { signInWithPassword, signOutCurrentUser } from './auth.service';

export type RoleEmailLoginErrorCode =
  | 'unauthorized_email'
  | 'connection_failed'
  | 'session_required'
  | 'inactive_account'
  | 'technician_needs_pin'
  | 'unknown';

export type RoleEmailLoginResult =
  | { ok: true; context: AuthState }
  | { ok: false; code: RoleEmailLoginErrorCode; message: string; canBootstrap: boolean };

function isConnectionError(raw: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return /failed to fetch|network ?error|networkrequestfailed|econnrefused|timed? ?out|fetch failed|load failed/.test(raw);
}

function classify(error: any, lang: string): { code: RoleEmailLoginErrorCode; message: string; canBootstrap: boolean } {
  const es = lang === 'es';
  const raw = String(error?.message || error || '').toLowerCase();

  if (isConnectionError(raw)) {
    return {
      code: 'connection_failed',
      message: es
        ? 'Conexión con Supabase fallida. Revisa tu internet e intenta de nuevo.'
        : 'Supabase connection failed. Check your internet connection and try again.',
      canBootstrap: false,
    };
  }
  if (/does not have an application role/.test(raw)) {
    return {
      code: 'unauthorized_email',
      message: es
        ? 'Email no autorizado: esta cuenta no tiene un rol asignado.'
        : 'Email not authorized: this account has no application role assigned.',
      canBootstrap: true,
    };
  }
  if (/inactive/.test(raw)) {
    return {
      code: 'inactive_account',
      message: es
        ? 'Esta cuenta está inactiva. Contacta a un administrador.'
        : 'This account is inactive. Contact an administrator.',
      canBootstrap: false,
    };
  }
  if (/technicians continue using pin/.test(raw)) {
    return {
      code: 'technician_needs_pin',
      message: es
        ? 'Los técnicos continúan entrando con PIN. Usa el portal de técnico.'
        : 'Technicians continue using PIN. Use the technician portal.',
      canBootstrap: false,
    };
  }
  if (/invalid login credentials|invalid email or password|invalid_grant/.test(raw)) {
    return {
      code: 'unauthorized_email',
      message: es
        ? 'Email no autorizado: correo o contraseña incorrectos.'
        : 'Email not authorized: incorrect email or password.',
      canBootstrap: false,
    };
  }
  return {
    code: 'unknown',
    message: error?.message || (es ? 'No se pudo iniciar sesión.' : 'Unable to sign in.'),
    canBootstrap: false,
  };
}

export async function loginWithRoleEmail(email: string, password: string, lang: string = 'en'): Promise<RoleEmailLoginResult> {
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  const es = lang === 'es';

  if (!cleanEmail || !cleanPassword) {
    return {
      ok: false,
      code: 'unauthorized_email',
      message: es ? 'Ingresa tu email y contraseña de cuenta segura.' : 'Enter your secure account email and password.',
      canBootstrap: false,
    };
  }

  try {
    const context = await signInWithPassword(cleanEmail, cleanPassword);
    if (context.role === 'tech') {
      await signOutCurrentUser().catch(() => undefined);
      return {
        ok: false,
        code: 'technician_needs_pin',
        message: es
          ? 'Los técnicos continúan entrando con PIN. Usa el portal de técnico.'
          : 'Technicians continue using PIN. Use the technician portal.',
        canBootstrap: false,
      };
    }
    return { ok: true, context };
  } catch (error: any) {
    const classified = classify(error, lang);
    return { ok: false, ...classified };
  }
}

/**
 * "Session required" is not a login failure — it's what protected actions
 * (like deleting a route) should report when there is no active session at
 * all. Kept here so every screen sources the exact same wording.
 */
export function sessionRequiredMessage(lang: string = 'en'): string {
  return lang === 'es'
    ? 'Sesión requerida. Inicia sesión con tu cuenta segura para continuar.'
    : 'Session required. Sign in with your secure account to continue.';
}
