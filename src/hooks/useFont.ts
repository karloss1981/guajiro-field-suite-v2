import { useEffect } from 'react';

export function useFont() {
  useEffect(() => {
    const l = document.createElement('link');
    l.href =
      'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;800;900&family=Barlow:wght@400;500;600&display=swap';
    l.rel = 'stylesheet';
    document.head.appendChild(l);
    return () => {
      try { document.head.removeChild(l); } catch {}
    };
  }, []);
}
