import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import AppErrorBoundary from './shared/components/AppErrorBoundary';
import ExitSecurityDialog from './shared/components/ExitSecurityDialog';
import { createAuditLog } from './services/audit.service';
import { getConfiguredAuthMode, restoreAuthenticatedContext, signOutCurrentUser } from './services/auth.service';
import LoginPage from './features/auth/pages/LoginPage';
import { useFont } from './legacy/hooks';
import { buildHash, parseHash } from './legacy/routing';
import { LoggedOutScreen } from './legacy/ui';
import type { AuthState } from './types/auth';

const lazyWithRetry = <T extends { default: ComponentType<any> }>(factory: () => Promise<T>, key: string) =>
  lazy(async () => {
    try {
      const module = await factory();
      sessionStorage.removeItem(`gfs_lazy_retry_${key}`);
      return module;
    } catch (error) {
      const retryKey = `gfs_lazy_retry_${key}`;
      if (!sessionStorage.getItem(retryKey)) {
        sessionStorage.setItem(retryKey, '1');
        window.location.reload();
        return new Promise<T>(() => {});
      }
      sessionStorage.removeItem(retryKey);
      throw error;
    }
  });

const TechPortal = lazyWithRetry(() => import('./features/technician/pages/TechPortal'), 'tech');
const SupervisorPortal = lazyWithRetry(() => import('./features/supervisor/pages/SupervisorPortal'), 'supervisor');

function PortalLoader({ message = 'Loading secure sessionâ€¦' }: { message?: string }) {
  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#04091c',color:'#c8d8f4',fontFamily:'Barlow, sans-serif'}}>
      {message}
    </div>
  );
}

function loadLegacyAuth(): AuthState | null {
  if (getConfiguredAuthMode() === 'supabase') return null;
  try {
    const raw = localStorage.getItem('gfs_auth');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.authMode === 'supabase' ? null : parsed;
  } catch {
    return null;
  }
}

export default function LegacyApp(){
  useFont();
  const[lang,setLang]=useState('es');
  const[loggedOut,setLoggedOut]=useState(false);
  const[auth,setAuth]=useState<AuthState|null>(loadLegacyAuth);
  const[checkingSession,setCheckingSession]=useState(getConfiguredAuthMode()!=='legacy');
  const[exitDialog,setExitDialog]=useState<{open:boolean;reason:'logout'|'back'}>({open:false,reason:'logout'});
  const lastSafeUrl=useRef(window.location.href);

  useEffect(()=>{
    let cancelled=false;
    if(getConfiguredAuthMode()==='legacy'){
      setCheckingSession(false);
      return;
    }
    restoreAuthenticatedContext()
      .then(context=>{if(!cancelled&&context)setAuth(context);})
      .catch(error=>console.warn('[Auth] Session restore failed:',error))
      .finally(()=>{if(!cancelled)setCheckingSession(false);});
    return()=>{cancelled=true;};
  },[]);

  const handleLogin=(nextAuth:AuthState)=>{
    setAuth(nextAuth);
    createAuditLog({
      action:'login',entity:'auth',
      metadata:{region:nextAuth.region||null,actorRole:nextAuth.accessRole||nextAuth.role,actorName:nextAuth.user?.name||nextAuth.tech?.name||nextAuth.tech?.id||'unknown',authMode:nextAuth.authMode,summary:`Login: ${nextAuth.accessRole||nextAuth.role}`}
    }).catch(()=>{});
    setLoggedOut(false);
    if(nextAuth.authMode==='legacy'){
      try{localStorage.setItem('gfs_auth',JSON.stringify(nextAuth));sessionStorage.removeItem('gfs_auth');}catch{}
    }else{
      try{localStorage.removeItem('gfs_auth');sessionStorage.setItem('gfs_auth',JSON.stringify({ ...nextAuth, sessionUserId: nextAuth.sessionUserId || null }));}catch{}
    }
    if(nextAuth.role==='supervisor') window.history.replaceState(null,'',buildHash('supervisor',nextAuth.region||'miami','dashboard'));
    else if(nextAuth.role==='tech') window.history.replaceState(null,'',buildHash('tech',String(nextAuth.tech?.id||''),'route'));
  };

  const performLogout=async()=>{
    const previous=auth;
    createAuditLog({
      action:'logout',entity:'auth',
      metadata:{region:previous?.region||null,actorRole:previous?.accessRole||previous?.role,actorName:previous?.user?.name||previous?.tech?.name||previous?.tech?.id||'unknown',authMode:previous?.authMode,summary:`Logout: ${previous?.accessRole||previous?.role||'unknown'}`}
    }).catch(()=>{});
    if(previous?.authMode==='supabase'){
      try{await signOutCurrentUser();}catch(error){console.warn('[Auth] Sign out failed:',error);}
    }
    setAuth(null);
    setLoggedOut(true);
    try{localStorage.removeItem('gfs_auth');sessionStorage.removeItem('gfs_auth');}catch{}
    window.history.replaceState(null,'','#/');
  };

  const requestLogout=(reason:'logout'|'back'='logout')=>{
    setExitDialog({open:true,reason});
  };

  const cancelLogout=()=>{
    setExitDialog(current=>({...current,open:false}));
  };

  const confirmLogout=()=>{
    setExitDialog(current=>({...current,open:false}));
    void performLogout();
  };

  useEffect(()=>{
    if(!auth)return;
    const isAuthenticatedAppHash=()=>{
      const parsed=parseHash();
      if(auth.role==='supervisor') return parsed.role==='supervisor';
      if(auth.role==='tech') return parsed.role==='tech';
      return Boolean(parsed.role);
    };
    lastSafeUrl.current=window.location.href;
    if(!window.history.state?.gfsNavigationGuard){
      window.history.replaceState({...(window.history.state||{}),gfsNavigationGuard:true},'',lastSafeUrl.current);
    }
    const rememberCurrentLocation=()=>{
      if(isAuthenticatedAppHash()) lastSafeUrl.current=window.location.href;
    };
    const handlePopState=()=>{
      // Internal hash changes such as Supervisor â†’ Not Done Pool â†’ Open Job must not
      // open the security dialog. Only warn when the user is actually leaving the suite.
      if(isAuthenticatedAppHash()){
        lastSafeUrl.current=window.location.href;
        return;
      }
      window.history.replaceState({gfsNavigationGuard:true},'',lastSafeUrl.current);
      requestLogout('back');
    };
    window.addEventListener('hashchange',rememberCurrentLocation);
    window.addEventListener('popstate',handlePopState);
    return()=>{
      window.removeEventListener('hashchange',rememberCurrentLocation);
      window.removeEventListener('popstate',handlePopState);
    };
  },[auth]);

  if(checkingSession)return <PortalLoader/>;
  if(loggedOut) return <LoggedOutScreen lang={lang} onDismiss={()=>setLoggedOut(false)}/>;
  if(!auth)return <LoginPage onLogin={handleLogin} lang={lang} setLang={setLang}/>;
  if(auth.role==='tech') return (
    <AppErrorBoundary label="Technician portal">
      <Suspense fallback={<PortalLoader message="Loading technician portalâ€¦"/>}>
        <><ExitSecurityDialog open={exitDialog.open} reason={exitDialog.reason} onCancel={cancelLogout} onConfirm={confirmLogout}/><TechPortal tech={auth.tech} auth={auth} onLogout={()=>requestLogout('logout')} onSessionExpired={()=>void performLogout()} lang={lang} setLang={setLang}/></>
      </Suspense>
    </AppErrorBoundary>
  );
  return (
    <AppErrorBoundary label="Supervisor portal">
      <Suspense fallback={<PortalLoader message="Loading operations portalâ€¦"/>}>
        <><ExitSecurityDialog open={exitDialog.open} reason={exitDialog.reason} onCancel={cancelLogout} onConfirm={confirmLogout}/><SupervisorPortal auth={auth} accessRole={auth.accessRole||auth.role||'supervisor'} region={auth.region||'miami'} onLogout={()=>requestLogout('logout')} onSessionExpired={()=>void performLogout()} lang={lang} setLang={setLang}/></>
      </Suspense>
    </AppErrorBoundary>
  );
}

