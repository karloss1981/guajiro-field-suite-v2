import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './shared/components/AppErrorBoundary';
import { APP_VERSION } from './config/constants';
console.info('[GUAJIRO FIELD SUITE] v' + APP_VERSION);
import './index.css';
import { registerPWA } from './pwa/registerPWA';
import { bootOfflineSync } from './offline/syncService';
import { bootPhotoUploadQueueSync } from './offline/photoUploadQueue';

try { registerPWA(); } catch (error) { console.warn('[PWA] register failed', error); }
try { bootOfflineSync(); } catch (error) { console.warn('[Offline] boot failed', error); }
try { bootPhotoUploadQueueSync(); } catch (error) { console.warn('[Photos] queue boot failed', error); }

void import('./features/charlie/charlieMount').catch((error) => {
  console.warn('[Charlie] mount failed', error);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary label="Guajiro Field Operations Suite">
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

