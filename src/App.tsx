import LegacyApp from './LegacyApp';
import { AppShell } from './app/AppShell';

export default function App() {
  return (
    <AppShell>
      <LegacyApp />
    </AppShell>
  );
}

