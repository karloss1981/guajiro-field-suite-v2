import { useEffect, useRef, useState } from 'react';

function useFont(){
  useEffect(()=>{
    const l=document.createElement("link");
    l.href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;800;900&family=Barlow:wght@400;500;600&display=swap";
    l.rel="stylesheet";document.head.appendChild(l);
    return()=>{try{document.head.removeChild(l);}catch{}};
  },[]);
}

// ════════════════════════════════════════════════════════
// ⏱️ SESIÓN — Logout por inactividad (5 min) con cuenta regresiva robusta
// ════════════════════════════════════════════════════════
const SESSION_TIMEOUT = 5 * 60;
const SESSION_WARN    = 60;

function useInactivityTimer(onLogout: () => void) {
  const [secondsLeft, setSecondsLeft] = useState(SESSION_TIMEOUT);
  const onLogoutRef = useRef(onLogout);
  const lastActivityRef = useRef(Date.now());
  const expiredRef = useRef(false);

  useEffect(() => { onLogoutRef.current = onLogout; });

  useEffect(() => {
    const timeoutMs = SESSION_TIMEOUT * 1000;

    const reset = () => {
      if (expiredRef.current) return;
      lastActivityRef.current = Date.now();
      setSecondsLeft(SESSION_TIMEOUT);
    };

    const check = () => {
      if (expiredRef.current) return;
      const elapsedMs = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((timeoutMs - elapsedMs) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        expiredRef.current = true;
        try { sessionStorage.setItem('gfs_session_expired_at', new Date().toISOString()); } catch {}
        onLogoutRef.current();
      }
    };

    reset();
    const events = ['mousemove','mousedown','keydown','touchstart','pointerdown','wheel','scroll','click','focus'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 1000);

    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(interval);
    };
  }, []);

  return { secondsLeft, isWarning: secondsLeft <= SESSION_WARN && secondsLeft > 0 };
}

export { useFont, SESSION_TIMEOUT, SESSION_WARN, useInactivityTimer };
