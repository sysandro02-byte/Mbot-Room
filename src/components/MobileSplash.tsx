import { useEffect, useState } from 'react';
import './MobileSplash.css';

const shouldShowSplash=()=>{
  const compact=window.matchMedia('(max-width: 1024px)').matches;
  const touch=navigator.maxTouchPoints>1;
  return compact||touch;
};

export default function MobileSplash(){
  const [visible,setVisible]=useState(()=>shouldShowSplash()&&sessionStorage.getItem('mboteroom-mobile-splash-shown')!=='1');
  const [leaving,setLeaving]=useState(false);

  useEffect(()=>{
    if(!visible)return;
    sessionStorage.setItem('mboteroom-mobile-splash-shown','1');
    document.documentElement.classList.add('mboteroom-splash-active');
    const leaveTimer=window.setTimeout(()=>setLeaving(true),1450);
    const hideTimer=window.setTimeout(()=>setVisible(false),1850);
    return()=>{
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hideTimer);
      document.documentElement.classList.remove('mboteroom-splash-active');
    };
  },[visible]);

  useEffect(()=>{
    if(!visible)document.documentElement.classList.remove('mboteroom-splash-active');
  },[visible]);

  if(!visible)return null;
  return <div className={`mobile-splash ${leaving?'is-leaving':''}`} role="status" aria-live="polite" aria-label="Ouverture de MBotéRoom">
    <div className="mobile-splash-orb one"/>
    <div className="mobile-splash-orb two"/>
    <section className="mobile-splash-content">
      <div className="mobile-splash-logo-wrap">
        <img src="/icons/mboteroom-192.png" alt="" className="mobile-splash-logo"/>
        <span className="mobile-splash-ring"/>
      </div>
      <div className="mobile-splash-brand">
        <h1>MBoté<span>Room</span></h1>
        <p>Réunions intelligentes, simples et sécurisées.</p>
      </div>
      <div className="mobile-splash-progress" aria-hidden="true"><span/></div>
      <small>Une application créée par <strong>LoukaTech</strong></small>
    </section>
  </div>;
}
