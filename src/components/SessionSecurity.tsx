import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock3, ShieldCheck } from 'lucide-react';
import { authService } from '../services/authService';
import { sanitizeInternalPath, routeContainsSensitiveData } from '../lib/navigationSecurity';
import './SessionSecurity.css';

const IDLE_MS = 5 * 60 * 1000;
const WARNING_MS = 30 * 1000;
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
  const lastPingRef=useRef(0);
  const loggingOutRef=useRef(false);

  useEffect(()=>{
    if(!authService.isAuthenticated())return;
    const candidate=location.pathname+location.search;
    if(!routeContainsSensitiveData(candidate) && !authService.getCurrentUser()?.isGuest){
      localStorage.setItem(LAST_ROUTE_KEY,sanitizeInternalPath(candidate));
    }
  },[location.pathname,location.search]);

  useEffect(()=>{
    if(!authService.isAuthenticated()||!isStandalone())return;
    if(sessionStorage.getItem(RESUME_DONE_KEY)==='1')return;
    sessionStorage.setItem(RESUME_DONE_KEY,'1');
    const current=sanitizeInternalPath(location.pathname+location.search);
    const saved=sanitizeInternalPath(localStorage.getItem(LAST_ROUTE_KEY)||'/app');
    if((current==='/'||current==='/app')&&saved!==current)navigate(saved,{replace:true});
  },[location.pathname,location.search,navigate]);

  useEffect(()=>{
    if(!authService.isAuthenticated())return;
    if(!localStorage.getItem(LAST_ACTIVITY_KEY))localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));

    const touch=()=>{
      if(!authService.isAuthenticated())return;
      const now=Date.now();
      localStorage.setItem(LAST_ACTIVITY_KEY,String(now));
      setSecondsLeft(null);
      if(now-lastPingRef.current>30_000){
        lastPingRef.current=now;
        void authService.touchActivity().catch(async()=>{
          if(loggingOutRef.current)return;
          loggingOutRef.current=true;
          sessionStorage.setItem('mboteroom-auth-notice','Votre session a expiré après 5 minutes d’inactivité.');
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
      if(!authService.isAuthenticated())return;
      const elapsed=Date.now()-nowActivity();
      const remain=IDLE_MS-elapsed;
      if(remain<=0&&!loggingOutRef.current){
        loggingOutRef.current=true;
        sessionStorage.setItem('mboteroom-auth-notice','Vous avez été déconnecté après 5 minutes d’inactivité.');
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
  },[navigate]);

  if(secondsLeft===null)return null;
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
