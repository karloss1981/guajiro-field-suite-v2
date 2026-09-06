import type { Region } from './common';
import type { AppRole } from './roles';

export type PortalRole = 'supervisor' | 'tech';
export type AuthMode = 'supabase' | 'legacy';

export interface AuthUserSummary {
  id?: string;
  name: string;
  email?: string;
  region?: Region;
}

export interface AuthTechnicianSummary {
  id: string;
  name: string;
  region: Region;
  active?: boolean;
  gps_consent?: boolean;
}

export interface AuthState {
  role: PortalRole;
  accessRole: 'tech' | 'viewer' | 'supervisor' | 'admin';
  appRoles?: AppRole[];
  authMode: AuthMode;
  sessionUserId?: string;
  region: Region;
  user: AuthUserSummary;
  tech?: AuthTechnicianSummary;
}
