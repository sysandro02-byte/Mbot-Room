import { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { flushOfflineQueue, getOfflineQueueCount } from '../lib/offline';
import './OfflineModeSettings.css';

export default function OfflineModeSettings(){
  const [online,setOnline]=useState(navigator.onLine);
  const [pending,setPending]=useState(getOfflineQueueCount());
  const [syncing,setSyncing]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    const onOnline=()=>setOnline(true);
    const onOffline=()=>setOnline(false);
    const onQueue=(event:Event)=>setPending(Number((event as CustomEvent<{pending:number}>).detail?.pending||getOfflineQueueCount()));
    const onSynced=(event:Event)=>{
      const detail=(event as CustomEvent<{pending:number;synced:number}>).detail;
      setPending(Number(detail?.pending||0));
      if(detail?.synced)setMessage(String(detail.synced)+' modification'+(detail.synced>1?'s':'')+' synchronisée'+(detail.synced>1?'s':'')+'.');
    };
    window.addEventListener('online',onOnline);
    window.addEventListener('offline',onOffline);
    window.addEventListener('mbote-room-offline-queue-changed',onQueue);
    window.addEventListener('mbote-room-offline-synced',onSynced);
    return()=>{
      window.removeEventListener('online',onOnline);
      window.removeEventListener('offline',onOffline);
      window.removeEventListener('mbote-room-offline-queue-changed',onQueue);
      window.removeEventListener('mbote-room-offline-synced',onSynced);
    };
  },[]);

  const sync=async()=>{
    setSyncing(true);setMessage('');
    try{
      const result=await flushOfflineQueue();
      setPending(result.pending);
      setMessage(result.synced
        ? String(result.synced)+' modification'+(result.synced>1?'s':'')+' synchronisée'+(result.synced>1?'s':'')+'.'
        : 'Tout est déjà synchronisé.');
    }finally{setSyncing(false);}
  };

  return <section className="offline-settings-card" aria-labelledby="offline-mode-title">
    <div className={online?'offline-settings-icon online':'offline-settings-icon'}>{online?<Wifi size={24}/>:<WifiOff size={24}/>}</div>
    <div className="offline-settings-body">
      <div className="offline-settings-head">
        <div><span>Continuité de service</span><h3 id="offline-mode-title">Mode hors ligne robuste</h3></div>
        <span className={online?'offline-state online':'offline-state'}>{online?<CheckCircle2 size={14}/>:<CloudOff size={14}/>} {online?'Connecté':'Hors connexion'}</span>
      </div>
      <p>MBotéRoom garde certaines informations utiles sur votre appareil afin de rester pratique lorsque la connexion est faible ou absente.</p>
      <div className="offline-capabilities">
        <span><ShieldCheck size={15}/><b>Données privées</b><small>Les informations conservées sur l’appareil restent séparées pour chaque compte et sont supprimées à la déconnexion.</small></span>
        <span><RefreshCw size={15}/><b>Synchronisation automatique</b><small>Vos modifications sont envoyées automatiquement dès que la connexion revient.</small></span>
        <span><CloudOff size={15}/><b>Consultation hors connexion</b><small>Les pages déjà chargées restent consultables jusqu’à 7 jours. Les appels et réunions vidéo nécessitent Internet.</small></span>
      </div>
      <div className="offline-settings-footer">
        <span>{pending ? String(pending)+' modification'+(pending>1?'s':'')+' en attente de synchronisation' : 'Aucune modification en attente'}</span>
        <button type="button" onClick={()=>void sync()} disabled={!online||syncing||!pending}><RefreshCw size={15} className={syncing?'spin':''}/>{syncing?'Synchronisation…':'Synchroniser maintenant'}</button>
      </div>
      {message?<small className="offline-settings-message">{message}</small>:null}
    </div>
  </section>;
}
