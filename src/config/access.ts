export type AccessRole = "tech" | "viewer" | "supervisor" | "admin";

export const ACCESS_ROLE_LABELS: Record<Exclude<AccessRole, "tech">, { en: string; es: string; accent: string; descriptionEn: string; descriptionEs: string }> = {
  viewer: {
    en: 'Viewer',
    es: 'Viewer',
    accent: '#8ca3c7',
    descriptionEn: 'Read-only access to monitor routes, history and performance.',
    descriptionEs: 'Acceso de solo lectura para monitorear rutas, historial y rendimiento.',
  },
  supervisor: {
    en: 'Supervisor',
    es: 'Supervisor',
    accent: '#2b7fff',
    descriptionEn: 'Operations control, reports and field supervision.',
    descriptionEs: 'Control operativo, reportes y supervisión de campo.',
  },
  admin: {
    en: 'Admin',
    es: 'Admin',
    accent: '#ff6a1a',
    descriptionEn: 'Full operational control, security actions and route administration.',
    descriptionEs: 'Control total operativo, acciones de seguridad y administración de rutas.',
  },
};

export function getAccessPin(role: Exclude<AccessRole, "tech">, region: string, supervisorPin: string) {
  const env = import.meta.env as any;
  const suffix = region === 'swfl' ? 'SWFL' : 'MIAMI';
  if (role === 'admin') return ''; // Admin access is email/Supabase Auth only in secure builds.
  if (role === 'supervisor') return '0101'; // Stabilization mode: one local supervisor PIN.
  if (role === 'viewer') return env[`VITE_VIEWER_PIN_${suffix}`] || supervisorPin || '';
  return supervisorPin || '';
}

export function isReadOnlyRole(role?: string) {
  return role === 'viewer';
}

export function isAdminRole(role?: string) {
  return role === 'admin';
}

export const SECURITY_PHRASES = {
  clear: 'DELETE ROUTE',
  import: 'IMPORT ROUTE',
};
