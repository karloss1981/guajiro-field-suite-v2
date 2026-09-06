import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function InstallPWAButton() {
  const [promptEvent,setPromptEvent]=useState<InstallPromptEvent|null>(null);
  const [installed,setInstalled]=useState(false);

  useEffect(()=>{
    const standalone=window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone===true;
    setInstalled(Boolean(standalone));
    const beforeInstall=(event:Event)=>{event.preventDefault();setPromptEvent(event as InstallPromptEvent);};
    const appInstalled=()=>{setInstalled(true);setPromptEvent(null);};
    window.addEventListener('beforeinstallprompt',beforeInstall);
    window.addEventListener('appinstalled',appInstalled);
    return()=>{window.removeEventListener('beforeinstallprompt',beforeInstall);window.removeEventListener('appinstalled',appInstalled);};
  },[]);

  if(installed||!promptEvent)return null;
  const install=async()=>{await promptEvent.prompt();const choice=await promptEvent.userChoice;if(choice.outcome==='accepted')setPromptEvent(null);};
  return <button onClick={install} aria-label="Install Field Operations Suite" style={{position:'fixed',right:16,bottom:16,zIndex:1200,background:'linear-gradient(135deg,#0040c0,#00b8f5)',border:'none',borderRadius:999,padding:'10px 15px',color:'#fff',fontWeight:900,boxShadow:'0 8px 25px rgba(0,0,0,.35)',cursor:'pointer'}}>⬇ Install App</button>;
}
