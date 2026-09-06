import type { ReactNode } from 'react';
import { OfflineBanner } from '../shared/components/OfflineBanner';
import { InstallPWAButton } from '../shared/components/InstallPWAButton';
import { NotificationCenter } from '../shared/components/NotificationCenter';

type AppShellProps = {
  children: ReactNode;
};

const ENV_LABEL = String(import.meta.env.VITE_ENV_LABEL || '');

export function AppShell({ children }: AppShellProps) {
  return (
    <>
      {ENV_LABEL === 'staging' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: 'linear-gradient(90deg,#7c2d12,#ea580c)', color: '#fff', textAlign: 'center', fontSize: 11, fontWeight: 900, letterSpacing: 1.5, padding: '3px 0', pointerEvents: 'none' }}>
          ⚠ STAGING — AMBIENTE DE PRUEBAS · NO ES LA OPERACIÓN REAL ⚠
        </div>
      )}
      <OfflineBanner />
      {children}
      <NotificationCenter />
      <InstallPWAButton />
    </>
  );
}
