import type { ReactNode } from 'react';
import type { AppRole } from '../../types/roles';

type RoleGuardProps = {
  userRoles?: AppRole[];
  allowedRoles: AppRole[];
  fallback?: ReactNode;
  children: ReactNode;
};

export function RoleGuard({ userRoles = [], allowedRoles, fallback = null, children }: RoleGuardProps) {
  const allowed = allowedRoles.some((role) => userRoles.includes(role));
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
