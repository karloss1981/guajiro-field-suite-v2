// Web Push subscription — recordatorios de trabajos pendientes que llegan
// aunque el técnico tenga la app cerrada o haya hecho logout.
// La llave pública VAPID no es secreta (así funciona el protocolo Web Push);
// la privada vive solo en Supabase (app_settings), nunca en el cliente.
import { sb } from '../config/supabase';

const VAPID_PUBLIC_KEY = 'BI84JVA0xZBbImMZ8FLLD7hBscxoDSvpLInTsZYdRqW1dHbq4m5172q3NuK7J9l1QHpbv1oHSA7T3wJOQEzBR1k';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && typeof Notification !== 'undefined';
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

export function isStandalonePWA(): boolean {
  return (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export function getNotificationPermission(): string {
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

// Registra el Service Worker existente (public/sw.js, que ya sabe manejar
// 'push' y 'notificationclick') y suscribe al técnico. Debe llamarse desde
// un gesto del usuario (botón) porque iOS Safari exige eso para el permiso.
export async function subscribeToPush(techId: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
      });
    }
    const json = subscription.toJSON();
    await sb.from('push_subscriptions').upsert({
      tech_id: techId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    }, { onConflict: 'endpoint' });
    return true;
  } catch (error) {
    console.error('[push.service] subscribeToPush failed:', error);
    return false;
  }
}
