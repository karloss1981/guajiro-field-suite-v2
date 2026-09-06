export type AppRole = 'super_admin' | 'admin' | 'supervisor' | 'dispatcher' | 'technician' | 'viewer';

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  supervisor: 'Supervisor',
  dispatcher: 'Dispatcher',
  technician: 'Technician',
  viewer: 'Viewer',
};
