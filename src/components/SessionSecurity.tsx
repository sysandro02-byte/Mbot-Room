import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock3, ShieldCheck } from 'lucide-react';
import { authService } from '../services/authService';
import { sanitizeInternalPath, routeContainsSensitiveData } from '../lib/navigationSecurity';
import { PREFERENCES_EVENT, readCachedPreferences } from '../lib/userPreferences';
import type { Preferences } from '../services/appDataService';
import './SessionSecurity.css';

const DEFAULT_IDLE_MINUTES = 5;
const WARNING_MS = 30 * 1000;
const ALLOWED_IDLE_MINUTES = [0,5,15,30,60,240] as const;

const resolveIdleMinutes = (preferences: Preferences) => {
  const minutes = Number(preferences.automaticLogoutMinutes);
  return ALLOWED_IDLE_MINUTES.includes(minutes as (typeof ALLOWED_IDLE_MINUTES)[number])
    ? minutes
    : DEFAULT_IDLE_MINUTES;
};

const formatIdleDuration = (minutes: number) => {
  if (minutes === 60) return '1 heure';
  if (minutes === 240) return '4 heures';
  return `${minutes} minutes`;
};
const LAST_ACTIVITY_KEY = 'mboteroom-last-activity-at';
const LAST_ROUTE_KEY = 'mboteroom-last-safe-route';
const RESUME_DONE_KEY = 'mboteroom-pwa-resume-done';

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches
  || Boolean((navigator as Navigator & {standalone?:boolean}).standalone);

const nowActivity = () => Number(localStorage.getItem(LAST_ACTIVITY_KEY) || Date.now());

export default function SessionSecurity(){
  const location=useLocation();
  const navigate=useNavigate();
  const [secondsLeft,setSecondsLeft]=useState<number|null>(null);
  const [authenticated,setAuthenticated]=useState(authService.isAuthenticated());
  const [idleMinutes,setIdleMinutes]=useState(()=>resolveIdleMinutes(readCachedPreferences()));
  const inActiveMeeting=/^\/reunions\/[^/]+(?:\/luna)?\/?$/.test(location.pathname);
  const lastPingRef=useRef(0);
  const loggingOutRef=useRef(false);

  useEffect(()=>{
    const syncAuth=()=>{
      const next=authService.isAuthenticated();
      setAuthenticated(next);
      if(next)loggingOutRef.current=false;
    };
    window.addEventListener('mbote-room-auth-changed',syncAuth);
    window.addEventListener('storage',syncAuth);
    return()=>{window.removeEventListener('mbote-room-auth-changed',syncAuth);window.removeEventListener('storage',syncAuth);};
  },[]);

  useEffect(()=>{
    const syncPreferences=(event?:Event)=>{
      const detail=(event as CustomEvent<Preferences> | undefined)?.detail;
      setIdleMinutes(resolveIdleMinutes(detail || readCachedPreferences()));
    };
    const syncStorage=(event:StorageEvent)=>{
      if(!event.key||event.key==='mboteroom-preferences-cache')syncPreferences();
    };
    window.addEventListener(PREFERENCES_EVENT,syncPreferences as EventListener);
    window.addEventListener('storage',syncStorage);
    return()=>{
      window.removeEventListener(PREFERENCES_EVENT,syncPreferences as EventListener);
      window.removeEventListener('storage',syncStorage);
    };
  },[]);

  useEffect(()=>{
    if(!authenticated)return;
    if(isStandalone()&&sessionStorage.getItem(RESUME_DONE_KEY)!=='1'&&(location.pathname==='/'||location.pathname==='/app'))return;
    const candidate=location.pathname+location.search;
    if(!routeContainsSensitiveData(candidate) && !authService.getCurrentUser()?.isGuest){
      localStorage.setItem(LAST_ROUTE_KEY,sanitizeInternalPath(candidate));
    }
  },[authenticated,location.pathname,location.search]);

  useEffect(()=>{
    if(!authenticated||!isStandalone())return;
    if(sessionStorage.getItem(RESUME_DONE_KEY)==='1')return;
    sessionStorage.setItem(RESUME_DONE_KEY,'1');
    const current=sanitizeInternalPath(location.pathname+location.search);
    const saved=sanitizeInternalPath(localStorage.getItem(LAST_ROUTE_KEY)||'/app');
    if((current==='/'||current==='/app')&&saved!==current)navigate(saved,{replace:true});
  },[authenticated,location.pathname,location.search,navigate]);

  useEffect(()=>{
    if(!authenticated)return;
    if(!localStorage.getItem(LAST_ACTIVITY_KEY))localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));

    const touch=()=>{
      const locallyAvailable=navigator.onLine?authService.isAuthenticated():Boolean(authService.getCurrentUser());
      if(!locallyAvailable)return;
      const now=Date.now();
      localStorage.setItem(LAST_ACTIVITY_KEY,String(now));
      setSecondsLeft(null);
      if(now-lastPingRef.current>30_000&&navigator.onLine){
        lastPingRef.current=now;
        void authService.touchActivity().catch(async()=>{
          if(authService.isAuthenticated()||loggingOutRef.current)return;
          loggingOutRef.current=true;
          sessionStorage.setItem('mboteroom-auth-notice','Votre session a expiré pour cause d’inactivité.');
          await authService.logout(false);
          navigate('/login',{replace:true});
        });
      }
    };

    const events=['pointerdown','keydown','touchstart','scroll'] as const;
    events.forEach((name)=>window.addEventListener(name,touch,{passive:true}));
    const visibility=()=>{if(document.visibilityState==='visible')touch();};
    document.addEventListener('visibilitychange',visibility);

    const timer=window.setInterval(async()=>{
      if(inActiveMeeting){
        localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));
        setSecondsLeft(null);
        return;
      }
      if(!navigator.onLine){
        setSecondsLeft(null);
        return;
      }
      if(!authService.isAuthenticated())return;
      if(idleMinutes===0){
        setSecondsLeft(null);
        return;
      }
      const elapsed=Date.now()-nowActivity();
      const idleMs=idleMinutes*60*1000;
      const remain=idleMs-elapsed;
      if(remain<=0&&!loggingOutRef.current){
        loggingOutRef.current=true;
        sessionStorage.setItem('mboteroom-auth-notice',`Vous avez été déconnecté après ${formatIdleDuration(idleMinutes)} d’inactivité.`);
        await authService.logout(true);
        navigate('/login',{replace:true});
        return;
      }
      setSecondsLeft(remain<=WARNING_MS?Math.max(0,Math.ceil(remain/1000)):null);
    },1000);

    return()=>{
      events.forEach((name)=>window.removeEventListener(name,touch));
      document.removeEventListener('visibilitychange',visibility);
      window.clearInterval(timer);
    };
  },[authenticated,idleMinutes,inActiveMeeting,navigate]);

  if(secondsLeft===null||inActiveMeeting)return null;
  return <aside className="session-idle-warning" role="alertdialog" aria-live="assertive" aria-label="Session bientôt expirée">
    <span><Clock3 size={19}/></span>
    <div><strong>Session bientôt verrouillée</strong><small>Déconnexion automatique dans {secondsLeft}s sans activité.</small></div>
    <button type="button" onClick={()=>{
      localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));
      setSecondsLeft(null);
      void authService.touchActivity();
    }}><ShieldCheck size={15}/> Rester connecté</button>
  </aside>;
}
