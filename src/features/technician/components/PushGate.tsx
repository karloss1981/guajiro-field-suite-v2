// @ts-nocheck
// PushGate — pantalla obligatoria. El técnico no ve su ruta hasta que
// las notificaciones queden en 'granted'. Sin botón para saltarla.
import { useState } from 'react';
import { getNotificationPermission, isIOS, isStandalonePWA, subscribeToPush } from '../../../services/push.service';

export function PushGate({ lang, techId, onGranted }: { lang: string; techId: string; onGranted: () => void }) {
  const es = lang === 'es';
  const [checking, setChecking] = useState(false);
  const ios = isIOS();
  const standalone = isStandalonePWA();
  const currentPermission = getNotificationPermission();

  const handleActivate = async () => {
    setChecking(true);
    const ok = await subscribeToPush(String(techId));
    setChecking(false);
    if (ok) onGranted();
  };
  const recheck = () => {
    if (getNotificationPermission() === 'granted') onGranted();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04091c', zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 52, marginBottom: 18 }}>🔔</div>

      {ios && !standalone && (
        <>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 12 }}>
            {es ? 'Un paso más antes de entrar' : 'One more step before you enter'}
          </div>
          <div style={{ fontSize: 13, color: '#c8d8f4', maxWidth: 340, lineHeight: 1.6 }}>
            {es
              ? <>Toca <b>Compartir</b> ⬆️ abajo en Safari → <b>"Agregar a inicio"</b>. Luego cierra Safari y abre la app desde el ícono nuevo en tu pantalla de inicio.</>
              : <>Tap <b>Share</b> ⬆️ in Safari → <b>"Add to Home Screen"</b>. Then close Safari and open the app from the new icon on your home screen.</>}
          </div>
        </>
      )}

      {(!ios || standalone) && currentPermission === 'default' && (
        <>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 12 }}>
            {es ? 'Activa los recordatorios para continuar' : 'Turn on reminders to continue'}
          </div>
          <div style={{ fontSize: 13, color: '#c8d8f4', maxWidth: 340, lineHeight: 1.6, marginBottom: 22 }}>
            {es ? 'Es obligatorio para poder usar la app. Así te avisamos si te quedan trabajos sin cerrar.' : 'This is required to use the app. It lets us alert you about jobs you haven\'t closed yet.'}
          </div>
          <button onClick={handleActivate} disabled={checking} style={{ background: '#00b8f5', border: 'none', borderRadius: 12, padding: '15px 30px', color: '#04091c', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            {checking ? (es ? 'Activando...' : 'Activating...') : (es ? '🔔 Activar notificaciones' : '🔔 Turn on notifications')}
          </button>
        </>
      )}

      {currentPermission === 'denied' && (
        <>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 12 }}>
            {es ? 'Las notificaciones están bloqueadas' : 'Notifications are blocked'}
          </div>
          <div style={{ fontSize: 13, color: '#c8d8f4', maxWidth: 340, lineHeight: 1.6, marginBottom: 22 }}>
            {es
              ? <>Ve a <b>Ajustes del iPhone</b> → busca esta app en la lista → <b>Notificaciones</b> → actívalas. Luego regresa aquí.</>
              : <>Go to <b>iPhone Settings</b> → find this app in the list → <b>Notifications</b> → turn them on. Then come back here.</>}
          </div>
          <button onClick={recheck} style={{ background: '#162e58', border: '1px solid #2a4a80', borderRadius: 12, padding: '13px 26px', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {es ? 'Ya las activé, continuar' : 'I turned them on, continue'}
          </button>
        </>
      )}
    </div>
  );
}
