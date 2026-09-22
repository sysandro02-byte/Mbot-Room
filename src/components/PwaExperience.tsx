import { useEffect, useMemo, useState } from 'react';
import { Download, MoreVertical, Share, Smartphone, WifiOff, X } from 'lucide-react';
import './PwaExperience.css';

type InstallPromptEvent = Event & {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>;
};

const PROMPT_DELAY_MS=3*60*1000;
const DISMISS_COOLDOWN_MS=7*24*60*60*1000;

const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches
  || Boolean((navigator as Navigator & {standalone?:boolean}).standalone);

const platform=()=>{
  const ua=navigator.userAgent.toLowerCase();
  if(/iphone|ipad|ipod/.test(ua)||(/macintosh/.test(ua)&&navigator.maxTouchPoints>1))return 'ios';
  if(/android/.test(ua))return 'android';
  return 'desktop';
};

export default function PwaExperience(){
  const [deferredPrompt,setDeferredPrompt]=useState<InstallPromptEvent|null>(null);
  const [showInstall,setShowInstall]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [offline,setOffline]=useState(!navigator.onLine);
  const device=useMemo(platform,[]);

  useEffect(()=>{
    const standalone=isStandalone();
    document.documentElement.dataset.platform=device;
    document.documentElement.dataset.standalone=standalone?'true':'false';
    const installed=()=>{document.documentElement.dataset.standalone='true';setShowInstall(false);localStorage.setItem('mboteroom-installed','1');};
    const online=()=>setOffline(false);
    const offlineHandler=()=>setOffline(true);
    window.addEventListener('appinstalled',installed);
    window.addEventListener('online',online);
    window.addEventListener('offline',offlineHandler);

    if(!standalone){
      const onBeforeInstall=(event:Event)=>{
        const installEvent=event as InstallPromptEvent;
        installEvent.preventDefault();
        setDeferredPrompt(installEvent);
      };
      window.addEventListener('beforeinstallprompt',onBeforeInstall);

      const dismissedAt=Number(localStorage.getItem('mboteroom-install-dismissed-at')||0);
      const firstSeen=Number(localStorage.getItem('mboteroom-install-first-seen')||Date.now());
      if(!localStorage.getItem('mboteroom-install-first-seen'))localStorage.setItem('mboteroom-install-first-seen',String(firstSeen));
      const cooldownOver=!dismissedAt||Date.now()-dismissedAt>DISMISS_COOLDOWN_MS;
      const remaining=Math.max(0,PROMPT_DELAY_MS-(Date.now()-firstSeen));
      const timer=window.setTimeout(()=>{
        const mobileLike=device!=='desktop'||window.innerWidth<=1024;
        if(cooldownOver&&mobileLike)setShowInstall(true);
      },remaining);
      return()=>{
        window.clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt',onBeforeInstall);
        window.removeEventListener('appinstalled',installed);
        window.removeEventListener('online',online);
        window.removeEventListener('offline',offlineHandler);
      };
    }
    return()=>{
      window.removeEventListener('appinstalled',installed);
      window.removeEventListener('online',online);
      window.removeEventListener('offline',offlineHandler);
    };
  },[device]);

  const dismiss=()=>{
    localStorage.setItem('mboteroom-install-dismissed-at',String(Date.now()));
    setShowInstall(false);setShowHelp(false);
  };

  const install=async()=>{
    if(deferredPrompt){
      await deferredPrompt.prompt();
      const choice=await deferredPrompt.userChoice.catch(()=>({outcome:'dismissed' as const,platform:''}));
      if(choice.outcome==='accepted'){setShowInstall(false);setDeferredPrompt(null);return;}
    }
    setShowHelp(true);
  };

  return <>
    {offline?<div className="pwa-offline-pill" role="status"><WifiOff size={15}/> Mode hors connexion</div>:null}
    {showInstall?<div className="pwa-install-backdrop">
      <section className="pwa-install-sheet" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
        <button className="pwa-install-close" type="button" aria-label="Fermer" onClick={dismiss}><X size={19}/></button>
        <div className="pwa-install-icon"><Smartphone size={30}/></div>
        <span className="pwa-install-kicker">{device==='ios'?'Expérience iPhone / iPad':device==='android'?'Expérience Android':'Application MBotéRoom'}</span>
        <h2 id="pwa-install-title">Installez MBotéRoom</h2>
        <p>Profitez d’une ouverture plein écran, d’une navigation mobile plus fluide, du démarrage depuis l’écran d’accueil et des notifications push.</p>
        {showHelp?<div className="pwa-install-help">
          {device==='ios'?<><strong><Share size={17}/> Sur iPhone/iPad</strong><span>Dans Safari, touchez <b>Partager</b>, puis <b>Sur l’écran d’accueil</b> et confirmez <b>Ajouter</b>.</span></>
          :<><strong><MoreVertical size={17}/> Sur Android</strong><span>Ouvrez le menu du navigateur, puis choisissez <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.</span></>}
        </div>:null}
        <div className="pwa-install-actions">
          <button type="button" className="primary" onClick={()=>void install()}><Download size={18}/>{deferredPrompt?'Installer maintenant':showHelp?'Voir les étapes':'Installer l’application'}</button>
          <button type="button" className="secondary" onClick={dismiss}>Plus tard</button>
        </div>
        <small>MBotéRoom est une application créée par <b>LoukaTech</b>.</small>
      </section>
    </div>:null}
  </>;
}
