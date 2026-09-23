
import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronRight, CircleHelp, Clock3, Eye, EyeOff, Laptop, Link2, LockKeyhole,
  Mail, Mic, MicOff, QrCode, ShieldCheck, UsersRound, Video, VideoOff, X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { readCachedPreferences } from '../lib/userPreferences';
import { Meeting, meetingService } from '../services/meetingService';
import { showAppMessage } from '../lib/appMessage';
import './RealJoinPage.css';

type BarcodeDetectorInstance={detect:(source:CanvasImageSource)=>Promise<Array<{rawValue:string}>>};
type BarcodeDetectorConstructor=new(options:{formats:string[]})=>BarcodeDetectorInstance;

export default function RealJoinPage(){
  const navigate=useNavigate();
  const {meetingLink}=useParams();
  const user=authService.getCurrentUser();
  const inputRef=useRef<HTMLInputElement|null>(null);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const [value,setValue]=useState(meetingLink||'');
  const [password,setPassword]=useState('');
  const [passwordVisible,setPasswordVisible]=useState(false);
  const [meeting,setMeeting]=useState<Meeting|null>(null);
  const initialPreferences=readCachedPreferences();
  const [mic,setMic]=useState(initialPreferences.defaultMic!==false);
  const [camera,setCamera]=useState(initialPreferences.defaultCamera!==false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [qrOpen,setQrOpen]=useState(false);
  const isMeetingModerator=Boolean(meeting&&(Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)||user?.role==='admin'));
  const micAllowed=Boolean(meeting&&(isMeetingModerator||meeting.settings?.participantAudio!==false));
  const cameraAllowed=Boolean(meeting&&(isMeetingModerator||meeting.settings?.participantVideo!==false));

  useEffect(()=>{
    if(!meetingLink)return;
    setLoading(true);
    meetingService.getMeetingByLink(meetingLink)
      .then(setMeeting)
      .catch((cause)=>setError(cause instanceof Error?cause.message:'Réunion introuvable.'))
      .finally(()=>setLoading(false));
  },[meetingLink]);

  useEffect(()=>{if(!meeting)return;if(!micAllowed)setMic(false);if(!cameraAllowed)setCamera(false);},[cameraAllowed,meeting,micAllowed]);

  useEffect(()=>{
    if(!qrOpen)return;
    const Detector=(window as typeof window & {BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector;
    if(!Detector){
      setQrOpen(false);
      showAppMessage('Le scan QR n’est pas pris en charge par ce navigateur. Utilisez Chrome/Edge récent ou collez le lien de la réunion.',{tone:'warning'});
      return;
    }
    let cancelled=false;
    let stream:MediaStream|null=null;
    let frame=0;
    const start=async()=>{
      try{
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if(cancelled){stream.getTracks().forEach((track)=>track.stop());return;}
        const video=videoRef.current;
        if(!video)return;
        video.srcObject=stream;
        await video.play();
        const detector=new Detector({formats:['qr_code']});
        const scan=async()=>{
          if(cancelled)return;
          try{
            if(video.readyState>=2){
              const result=await detector.detect(video);
              const raw=String(result[0]?.rawValue||'').trim();
              if(raw){
                setValue(raw);
                setQrOpen(false);
                showAppMessage('Code QR détecté. Vérifiez puis continuez.',{tone:'success'});
                return;
              }
            }
          }catch{/* continue scanning */}
          frame=window.requestAnimationFrame(()=>void scan());
        };
        void scan();
      }catch(cause){
        setQrOpen(false);
        showAppMessage(cause instanceof Error?cause.message:'Impossible d’ouvrir la caméra.',{tone:'error'});
      }
    };
    void start();
    return()=>{cancelled=true;if(frame)cancelAnimationFrame(frame);stream?.getTracks().forEach((track)=>track.stop());};
  },[qrOpen]);

  const lookup=async(event:FormEvent)=>{
    event.preventDefault();
    if(!value.trim())return;
    setLoading(true);setError('');
    try{setMeeting(await meetingService.lookupMeetingAccess(value.trim(),password));}
    catch(cause){setMeeting(null);setError(cause instanceof Error?cause.message:'Réunion introuvable.');}
    finally{setLoading(false);}
  };

  const join=async()=>{
    if(!meeting)return;
    if(meeting.status==='ended'||meeting.status==='cancelled'){setError('Cette réunion est terminée ou annulée.');return;}
    setLoading(true);setError('');
    try{
      const host=isMeetingModerator;
      if(host){
        if(!meeting.is_active){
          const result=await meetingService.startMeetingAndNotify(meeting.id);
          const live=result.meeting||{...meeting,is_active:true};
          navigate('/reunions/'+meeting.meeting_link,{state:{meeting:live,joinOptions:{mic,camera}}});
          return;
        }
        navigate('/reunions/'+meeting.meeting_link,{state:{meeting,joinOptions:{mic,camera}}});
        return;
      }
      const numericUserId=Number(user?.id);
      const result=await meetingService.requestJoin(meeting.id,Number.isFinite(numericUserId)?numericUserId:undefined,password);
      if(result.status==='requested'){
        navigate('/reunions/'+meeting.meeting_link+'/salle-attente',{state:{meeting,joinOptions:{mic,camera}}});
        return;
      }
      navigate('/reunions/'+meeting.meeting_link,{state:{meeting,joinOptions:{mic,camera}}});
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de rejoindre la réunion.');}
    finally{setLoading(false);}
  };

  const pasteInvitation=async()=>{
    try{
      const text=(await navigator.clipboard.readText()).trim();
      if(!text)throw new Error('Le presse-papiers est vide.');
      setValue(text);
      inputRef.current?.focus();
      showAppMessage('Invitation collée.',{tone:'success'});
    }catch{
      inputRef.current?.focus();
      showAppMessage('Collez le lien ou le code reçu dans le champ de réunion.',{tone:'info'});
    }
  };

  const openQr=()=>{
    const Detector=(window as typeof window & {BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector;
    if(!Detector){
      showAppMessage('Le scan QR n’est pas disponible sur ce navigateur. Vous pouvez saisir ou coller le code.',{tone:'warning'});
      inputRef.current?.focus();
      return;
    }
    setQrOpen(true);
  };

  return <main className="real-join-shell">
    <section className="real-join-stage">
      <aside className="real-join-intro">
        <span className="real-join-eyebrow"><i/> Des réunions sans frontières</span>
        <h1>Rejoignez<br/>en quelques clics</h1>
        <p>Connectez-vous à vos équipes, vos partenaires et vos proches, où qu’ils soient.</p>
        <div className="real-join-benefits">
          <article><span><UsersRound/></span><div><strong>Simple et rapide</strong><small>Rejoignez une réunion en toute simplicité.</small></div></article>
          <article><span><ShieldCheck/></span><div><strong>Fiable et sécurisé</strong><small>Vos échanges et vos accès sont protégés.</small></div></article>
          <article><span><Laptop/></span><div><strong>Partout avec vous</strong><small>Sur ordinateur, mobile et tablette.</small></div></article>
        </div>
      </aside>

      <section className="real-join-card">
        <button className="real-join-back" onClick={()=>navigate('/app/meetings')}><ArrowLeft size={18}/> Réunions</button>
        <div className="real-join-brand"><img src="/icons/mboteroom-symbol.png" alt=""/><div><strong>MBotéRoom</strong><small>Accès sécurisé à la réunion</small></div></div>
        {!meeting?<form onSubmit={lookup}>
          <h2>Rejoindre une réunion</h2>
          <p>Saisissez l’ID, le code ou le lien de la réunion.</p>
          <label>Code ou lien
            <div className="real-join-input"><Link2/><input ref={inputRef} value={value} onChange={(event)=>setValue(event.target.value)} placeholder="ID, code ou lien de réunion" required/>{value?<button type="button" onClick={()=>setValue('')} aria-label="Effacer"><X/></button>:null}</div>
          </label>
          <label>Mot de passe, si demandé
            <div className="real-join-password"><LockKeyhole/><input type={passwordVisible?'text':'password'} value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="Mot de passe"/><button type="button" onClick={()=>setPasswordVisible((current)=>!current)} aria-label={passwordVisible?'Masquer le mot de passe':'Afficher le mot de passe'}>{passwordVisible?<EyeOff/>:<Eye/>}</button></div>
          </label>
          {error?<div className="real-join-error">{error}</div>:null}
          <button className="real-join-primary" disabled={loading}>{loading?'Vérification…':<>Continuer <ChevronRight/></>}</button>
          <div className="real-join-secure"><ShieldCheck/><div><strong>Connexion protégée et chiffrée</strong><small>Vos données restent dans l’environnement sécurisé MBotéRoom.</small></div></div>
        </form>:<div className="real-join-preview">
          <span className="real-join-preview-kicker">Réunion trouvée</span>
          <h2>{meeting.title}</h2><p>{meeting.description||'Réunion MBotéRoom'}</p>
          <dl>
            <div><dt>Hôte</dt><dd>{meeting.host_name}</dd></div>
            <div><dt>Début</dt><dd>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(meeting.start_time))}</dd></div>
            <div><dt>Salle d’attente</dt><dd>{meeting.settings?.waitingRoom===false?'Non':'Oui'}</dd></div>
          </dl>
          <div className="real-join-media">
            <button className={mic?'on':''} onClick={()=>setMic((current)=>!current)} disabled={!micAllowed}>{mic?<Mic/>:<MicOff/>}<span>{!micAllowed?'Micro désactivé':mic?'Micro actif':'Micro coupé'}</span></button>
            <button className={camera?'on':''} onClick={()=>setCamera((current)=>!current)} disabled={!cameraAllowed}>{camera?<Video/>:<VideoOff/>}<span>{!cameraAllowed?'Caméra désactivée':camera?'Caméra active':'Caméra coupée'}</span></button>
          </div>
          {error?<div className="real-join-error">{error}</div>:null}
          <div className="real-join-actions"><button className="secondary" onClick={()=>setMeeting(null)}>Changer</button><button className="real-join-primary" onClick={()=>void join()} disabled={loading||meeting.status==='ended'||meeting.status==='cancelled'}>{loading?'Connexion…':meeting.status==='ended'||meeting.status==='cancelled'?'Réunion terminée':'Rejoindre maintenant'}</button></div>
        </div>}
      </section>

      <aside className="real-join-art" aria-hidden="true">
        <div className="real-join-art-badge"><Video/><span>Se réunir.<br/><strong>Avancer. Ensemble.</strong></span></div>
        <img src="/images/mboteroom-home-hero.svg" alt=""/>
      </aside>
    </section>

    <section className="real-join-shortcuts">
      <button onClick={openQr}><span><QrCode/></span><div><strong>Scanner un QR code</strong><small>Rejoignez une réunion avec la caméra.</small></div><ChevronRight/></button>
      <button onClick={()=>navigate('/app/meetings')}><span><Clock3/></span><div><strong>Mes réunions récentes</strong><small>Accédez rapidement à vos réunions.</small></div><ChevronRight/></button>
      <button onClick={()=>void pasteInvitation()}><span><Mail/></span><div><strong>Rejoindre avec une invitation</strong><small>Collez directement le lien reçu.</small></div><ChevronRight/></button>
      <button onClick={()=>navigate('/aide')}><span><CircleHelp/></span><div><strong>Aide de connexion</strong><small>Obtenez de l’aide en cas de problème.</small></div><ChevronRight/></button>
    </section>

    <footer className="real-join-trust"><ShieldCheck/><div><strong>Une plateforme de confiance</strong><small>MBotéRoom respecte votre vie privée et protège les accès aux réunions.</small></div><button onClick={()=>navigate('/confidentialite')}>En savoir plus <ChevronRight/></button></footer>

    {qrOpen?<div className="real-join-qr-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setQrOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-label="Scanner un QR code">
        <header><div><QrCode/><span><strong>Scanner le QR de la réunion</strong><small>Placez le code dans le cadre.</small></span></div><button onClick={()=>setQrOpen(false)}><X/></button></header>
        <div className="real-join-qr-camera"><video ref={videoRef} playsInline muted/><i/><b/></div>
        <p>La caméra sert uniquement à lire le code QR. Elle est arrêtée dès que vous fermez cette fenêtre.</p>
      </section>
    </div>:null}
  </main>;
}
