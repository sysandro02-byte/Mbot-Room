import { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, LoaderCircle, Send, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { notificationService, PushState } from '../services/notificationService';
import './PushNotificationSettings.css';

export default function PushNotificationSettings({ compact = false }: { compact?: boolean } = {}){
  const [state,setState]=useState<PushState|null>(null);
  const [loading,setLoading]=useState(true);
  const [action,setAction]=useState('');
  const [message,setMessage]=useState('');

  const load=async()=>{
    setLoading(true);
    setMessage('');
    try{setState(await notificationService.getPushState());}
    catch(error){setMessage(error instanceof Error?error.message:'Impossible de vérifier les notifications.');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  const enable=async()=>{
    setAction('enable');setMessage('');
    try{setState(await notificationService.enablePush());setMessage('Notifications activées sur cet appareil.');}
    catch(error){setMessage(error instanceof Error?error.message:'Activation impossible.');}
    finally{setAction('');}
  };
  const disable=async()=>{
    setAction('disable');setMessage('');
    try{setState(await notificationService.disablePush());setMessage('Notifications désactivées sur cet appareil.');}
    catch(error){setMessage(error instanceof Error?error.message:'Désactivation impossible.');}
    finally{setAction('');}
  };
  const test=async()=>{
    setAction('test');setMessage('');
    try{await notificationService.sendPushTest();setMessage('Notification de test envoyée.');}
    catch(error){setMessage(error instanceof Error?error.message:'Impossible d’envoyer la notification de test.');}
    finally{setAction('');}
  };

  const statusLabel=!state?.supported?'Non pris en charge'
    :!state?.configured?'Indisponibles'
    :state.subscribed?'Activées'
    :state.permission==='denied'?'Bloquées par le système':'Désactivées';

  if (compact) {
    const toggleDisabled = loading || Boolean(action) || !state?.supported || !state?.configured;
    return <div className="push-settings-compact" id="system-notifications">
      <div className="push-settings-compact-main">
        <span className="push-settings-compact-icon"><BellRing size={18}/></span>
        <div><strong>Notifications système</strong><small>{loading?'Vérification…':statusLabel}</small></div>
      </div>
      <div className="push-settings-compact-actions">
        <button
          className={state?.subscribed?'push-switch is-on':'push-switch'}
          type="button"
          role="switch"
          aria-checked={Boolean(state?.subscribed)}
          aria-label={state?.subscribed?'Désactiver les notifications système':'Activer les notifications système'}
          disabled={toggleDisabled}
          onClick={()=>void (state?.subscribed?disable():enable())}
        ><span/></button>
        {state?.subscribed?<button className="push-test-button" type="button" onClick={()=>void test()} disabled={Boolean(action)}><Send size={14}/> Test</button>:null}
      </div>
      {message?<div className="push-settings-compact-message" role="status">{message}</div>:null}
    </div>;
  }

  return <section className="push-settings-card" aria-labelledby="push-settings-title">
    <div className="push-settings-icon"><BellRing size={24}/></div>
    <div className="push-settings-copy">
      <div className="push-settings-heading">
        <div>
          <span>Notifications système</span>
          <h3 id="push-settings-title">Notifications</h3>
        </div>
        <span className={state?.subscribed?'push-status active':'push-status'}>{state?.subscribed?<CheckCircle2 size={14}/>:<XCircle size={14}/>} {loading?'Vérification…':statusLabel}</span>
      </div>
      <p>Recevez les admissions en salle d’attente, le démarrage des réunions et les alertes MBotéRoom même quand l’application est fermée.</p>
      {state?.platform==='ios'&&!state.standalone?<div className="push-ios-note"><Smartphone size={17}/><span>Sur iPhone/iPad, installez MBotéRoom sur l’écran d’accueil avant d’activer les notifications.</span></div>:null}
      {message?<div className="push-settings-message" role="status">{message}</div>:null}
      <div className="push-settings-actions">
        {!state?.subscribed?<button type="button" onClick={()=>void enable()} disabled={loading||Boolean(action)||!state?.supported||!state?.configured}>{action==='enable'?<LoaderCircle className="spin" size={16}/>:<ShieldCheck size={16}/>} Activer les notifications</button>
          :<button type="button" className="secondary" onClick={()=>void disable()} disabled={Boolean(action)}>{action==='disable'?<LoaderCircle className="spin" size={16}/>:<XCircle size={16}/>} Désactiver</button>}
        {state?.subscribed?<button type="button" className="secondary" onClick={()=>void test()} disabled={Boolean(action)}>{action==='test'?<LoaderCircle className="spin" size={16}/>:<Send size={16}/>} Envoyer un test</button>:null}
      </div>
    </div>
  </section>;
}
