// GUAJIRO V25.14 — PWA Auto-Update
// Fixes: technicians opening the installed app were seeing zero routes because
// the old service worker kept serving cached JS pointing at the old Supabase
// project. This registration flow:
//   1. Detects when a new SW is installing (updatefound).
//   2. As soon as it reaches 'installed' with an active controller present
//      (meaning it is an update, not a first install), tells it to skipWaiting.
//   3. Listens for controllerchange -> reloads once to pick up the new JS/CSS.
//   4. Polls registration.update() every 60 s and on tab focus so techs get
//      the newest version without closing/reopening the app.

const LOCAL_CLEANUP_RELOAD_KEY = 'gfs_local_pwa_cleanup_reloaded_v24_1';
const RELOAD_GUARD_KEY = 'gfs_pwa_reloaded_for_update';
const UPDATE_POLL_MS = 60 * 1000;

async function clearLocalPwaState(): Promise<{ removedRegistrations: number; removedCaches: number; hadController: boolean }> {
  let removedRegistrations = 0;
  let removedCaches = 0;
  const hadController = Boolean(navigator.serviceWorker?.controller);
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      removedRegistrations = registrations.length;
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      removedCaches = keys.length;
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn('[PWA] Local cleanup failed:', error);
  }
  return { removedRegistrations, removedCaches, hadController };
}

// Ask the newly installed SW to activate immediately.
function activateNewWorker(registration: ServiceWorkerRegistration) {
  const worker = registration.waiting || registration.installing;
  if (worker) {
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      console.warn('[PWA] Failed to post SKIP_WAITING:', error);
    }
  }
}

// Guarantee a single reload per update event (avoids infinite reload loops).
function reloadOnce() {
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY) === 'yes') return;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, 'yes');
  } catch {
    // If sessionStorage is blocked we still reload (single lifecycle anyway).
  }
  window.location.reload();
}

function attachUpdateHandlers(registration: ServiceWorkerRegistration) {
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        // If there is already a controller, this is an update, not a first install.
        if (navigator.serviceWorker.controller) {
          activateNewWorker(registration);
        }
      }
    });
  });
}

let controllerChangeHooked = false;
function hookControllerChangeReload() {
  if (controllerChangeHooked) return;
  controllerChangeHooked = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadOnce();
  });
}

function schedulePolling(registration: ServiceWorkerRegistration) {
  const poll = () => {
    registration.update().catch(() => {});
  };
  window.setInterval(poll, UPDATE_POLL_MS);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
  window.addEventListener('online', poll);
}

export function registerPWA() {
  if (!('serviceWorker' in navigator)) return;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  // Local development must never be controlled by an old service worker.
  if (isLocalhost) {
    void clearLocalPwaState().then(({ removedRegistrations, removedCaches, hadController }) => {
      const needsReload = hadController || removedRegistrations > 0 || removedCaches > 0;
      let alreadyReloaded = false;
      try {
        alreadyReloaded = window.sessionStorage.getItem(LOCAL_CLEANUP_RELOAD_KEY) === 'yes';
      } catch {
        alreadyReloaded = true;
      }
      if (needsReload && !alreadyReloaded) {
        try { window.sessionStorage.setItem(LOCAL_CLEANUP_RELOAD_KEY, 'yes'); } catch {}
        window.location.reload();
        return;
      }
      if (!needsReload) {
        try { window.sessionStorage.removeItem(LOCAL_CLEANUP_RELOAD_KEY); } catch {}
      }
    });
    return;
  }

  // Clear the reload guard once the page fully loads so future update cycles
  // in the same tab can still trigger a single reload.
  window.addEventListener('load', () => {
    try { window.sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch {}

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        hookControllerChangeReload();
        attachUpdateHandlers(registration);

        // If a new SW is already waiting when we register, activate it now.
        if (registration.waiting && navigator.serviceWorker.controller) {
          activateNewWorker(registration);
        }

        // Kick a first update check + set up polling for future updates.
        registration.update().catch(() => {});
        schedulePolling(registration);
      })
      .catch((error) => {
        console.warn('[PWA] Service worker registration failed:', error);
      });
  });
}