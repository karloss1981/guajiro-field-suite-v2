import { useEffect, useRef, useCallback } from 'react';
import { SESSION_TIMEOUT, SESSION_WARN } from '../config/constants';

interface Options {
  onWarn: () => void;
  onExpire: () => void;
}

export function useInactivityTimer({ onWarn, onExpire }: Options) {
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (warnRef.current) clearTimeout(warnRef.current);
    if (expireRef.current) clearTimeout(expireRef.current);
    warnRef.current = setTimeout(onWarn, (SESSION_TIMEOUT - SESSION_WARN) * 1000);
    expireRef.current = setTimeout(onExpire, SESSION_TIMEOUT * 1000);
  }, [onWarn, onExpire]);

  useEffect(() => {
    reset();
    const events = ['mousemove', 'keydown', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => {
      if (warnRef.current) clearTimeout(warnRef.current);
      if (expireRef.current) clearTimeout(expireRef.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [reset]);
}
