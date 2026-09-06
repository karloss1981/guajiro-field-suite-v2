import { useCallback, useEffect, useState } from 'react';

/* ── Hash routing helpers ──
   Scheme:
     #/                              → login
     #/sup/<region>/<tab>            → supervisor portal
     #/sup/<region>/completed_jobs/<jobId>  → supervisor, completed jobs, anchor to job
     #/tech/<techId>/<section>       → tech portal
*/
function parseHash(): {role:string|null, id:string|null, tab:string|null, sub:string|null} {
  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (!parts.length) return {role:null, id:null, tab:null, sub:null};
  if (parts[0] === 'sup')   return {role:'supervisor', id:parts[1]||null, tab:parts[2]||'dashboard', sub:parts[3]||null};
  if (parts[0] === 'tech')  return {role:'tech',       id:parts[1]||null, tab:parts[2]||'route',     sub:parts[3]||null};
  return {role:null, id:null, tab:null, sub:null};
}

function buildHash(role:string, id:string, tab:string, sub?:string): string {
  if (role === 'supervisor') return `#/sup/${id}/${tab}${sub?'/'+sub:''}`;
  if (role === 'tech')       return `#/tech/${id}/${tab}${sub?'/'+sub:''}`;
  return '#/';
}

function useHashTab(role:string, id:string, defaultTab:string): [string,(t:string,sub?:string)=>void, string|null] {
  const initial = () => {
    const parsed = parseHash();
    if (parsed.role === role && parsed.id === id && parsed.tab) return parsed.tab;
    return defaultTab;
  };
  const initialSub = () => {
    const parsed = parseHash();
    if (parsed.role === role && parsed.id === id) return parsed.sub;
    return null;
  };
  const [tab, setTabState] = useState<string>(initial);
  const [sub, setSubState] = useState<string|null>(initialSub);
  const setTab = useCallback((t:string, s?:string) => {
    setTabState(t);
    setSubState(s||null);
    window.history.replaceState(null, '', buildHash(role, id, t, s));
  }, [role, id]);
  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      if (parsed.role === role && parsed.id === id && parsed.tab) {
        setTabState(parsed.tab);
        setSubState(parsed.sub);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [role, id]);
  return [tab, setTab, sub];
}

export { parseHash, buildHash, useHashTab };
