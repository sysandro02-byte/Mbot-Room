import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bug, CircleHelp, Flag, LogIn, LogOut, Menu, Search, ShieldCheck, UserPlus, UserRound, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authService, type RoomUser } from '../services/authService';
import { legalService } from '../services/legalService';
import { meetingService } from '../services/meetingService';
import { notificationService } from '../services/notificationService';
import { socket } from '../lib/socket';
import './GlobalHeader.css';

type ReportKind='bug'|'meeting';

export default function GlobalHeader(){
  const location=useLocation();
  const navigate=useNavigate();
  const [user,setUser]=useState<RoomUser|null>(()=>authService.getCurrentUser());
  const [unread,setUnread]=useState(0);
  const [profileOpen,setProfileOpen]=useState(false);
  const [reportOpen,setReportOpen]=useState(false);
  const [reportKind,setReportKind]=useState<ReportKind>('bug');
  const [reportTitle,setReportTitle]=useState('');
  const [reportDescription,setReportDescription]=useState('');
  const [reportMeetingId,setReportMeetingId]=useState('');
  const [reportBusy,setReportBusy]=useState(false);
  const [reportMessage,setReportMessage]=useState('');
  const profileRef=useRef<HTMLDivElement|null>(null);
  const authenticated=Boolean(user&&authService.isAuthenticated());
  const guestMode=user?.isGuest===true;
  const isAdmin=user?.role==='admin';

  const initials=useMemo(()=>String(user?.name||user?.email||'MB').split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'MB',[user]);

  useEffect(()=>{
    const sync=()=>setUser(authService.getCurrentUser());
    window.addEventListener('mbote-room-auth-changed',sync);
    window.addEventListener('storage',sync);
    return()=>{window.removeEventListener('mbote-room-auth-changed',sync);window.removeEventListener('storage',sync);};
  },[]);

  useEffect(()=>{
    if(!authenticated||guestMode){setUnread(0);return undefined;}
    const refresh=()=>void notificationService.list().then((rows)=>setUnread(rows.filter((item)=>!item.readAt).length)).catch(()=>undefined);
    const onNotification=()=>refresh();
    const onRestrictionsUpdated=()=>void authService.refreshCurrentUser().then(()=>setUser(authService.getCurrentUser())).catch(()=>undefined);
    refresh();
    if(!socket.connected)socket.connect();
    socket.on('notification:new',onNotification);
    socket.on('account:restrictions-updated',onRestrictionsUpdated);
    window.addEventListener('focus',refresh);
    return()=>{
      socket.off('notification:new',onNotification);
      socket.off('account:restrictions-updated',onRestrictionsUpdated);
      window.removeEventListener('focus',refresh);
    };
  },[authenticated,guestMode]);

  useEffect(()=>{
    const close=(event:MouseEvent)=>{if(profileRef.current&&!profileRef.current.contains(event.target as Node))setProfileOpen(false);};
    document.addEventListener('mousedown',close);
    return()=>document.removeEventListener('mousedown',close);
  },[]);

  const openReport=async()=>{
    setReportMessage('');
    setReportTitle('');
    setReportDescription('');
    const match=location.pathname.match(/^\/reunions\/([^/]+)/);
    const value=match?.[1]||'';
    if(/^\d+$/.test(value)){
      setReportMeetingId(value);setReportKind('meeting');
    }else if(value&&!['terminee','recentes'].includes(value)){
      try{
        const meeting=await meetingService.getMeetingByLink(decodeURIComponent(value));
        setReportMeetingId(String(meeting.id));setReportKind('meeting');
      }catch{
        setReportMeetingId('');setReportKind('bug');
      }
    }else{
      setReportMeetingId('');setReportKind('bug');
    }
    setReportOpen(true);
  };

  const submitReport=async(event:FormEvent)=>{
    event.preventDefault();
    if(reportBusy)return;
    const meetingId=Number(reportMeetingId||0)||null;
    if(reportKind==='meeting'&&!meetingId){setReportMessage('Indiquez l’ID de la réunion à signaler.');return;}
    if(!reportTitle.trim()||reportDescription.trim().length<8){setReportMessage('Ajoutez un titre et une description suffisamment précise.');return;}
    setReportBusy(true);setReportMessage('');
    try{
      await legalService.sendReport({
        type:reportKind,
        title:reportTitle.trim(),
        description:reportDescription.trim(),
        meetingId,
        pageUrl:window.location.href,
      });
      setReportMessage('Signalement envoyé à LoukaTech et aux administrateurs MBotéRoom.');
      setReportTitle('');setReportDescription('');
      window.setTimeout(()=>setReportOpen(false),1400);
    }catch(cause){
      setReportMessage(cause instanceof Error?cause.message:'Signalement impossible pour le moment.');
    }finally{setReportBusy(false);}
  };

  return <>
    <header className="global-app-header">
      <div className="global-header-left">
        {authenticated&&!guestMode?<button className="global-header-menu" type="button" aria-label="Ouvrir ou fermer le menu" onClick={()=>window.dispatchEvent(new CustomEvent('mboteroom-toggle-sidebar'))}><Menu size={21}/></button>:null}
        <Link className="global-header-brand" to={authenticated?'/app':'/connexion'} aria-label="MBotéRoom">
          <img src="/icons/mboteroom-wordmark.png" alt="MBotéRoom"/>
        </Link>
        {isAdmin?<Link className="global-header-admin-badge" to="/admin"><ShieldCheck size={13}/> Administration</Link>:null}
      </div>

      {authenticated?<form className="global-header-search" onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const q=String(form.get('q')||'').trim();if(q)navigate('/app/search?q='+encodeURIComponent(q));}}>
        <Search size={16}/><input name="q" type="search" placeholder="Rechercher…" aria-label="Rechercher dans MBotéRoom"/>
      </form>:<nav className="global-header-public-nav" aria-label="Navigation">
        <Link to="/conditions">Conditions d’utilisation</Link>
      </nav>}

      <div className="global-header-actions">
        {authenticated?<>
          <button type="button" className="global-header-action" onClick={()=>void openReport()} title="Signaler un problème"><Flag size={19}/><span>Signaler</span></button>
          <button type="button" className="global-header-icon" onClick={()=>navigate('/aide')} aria-label="Aide"><CircleHelp size={19}/></button>
          {!guestMode?<button type="button" className="global-header-icon" onClick={()=>navigate('/app/notifications')} aria-label="Notifications"><Bell size={19}/>{unread>0?<b>{Math.min(99,unread)}</b>:null}</button>:null}
          <div className="global-header-profile" ref={profileRef}>
            <button type="button" className="global-header-avatar" onClick={()=>setProfileOpen((value)=>!value)} aria-expanded={profileOpen}>
              <span>{user?.avatar?<img src={user.avatar} alt=""/>:<b>{initials}</b>}</span>
              <strong>{user?.name||'Utilisateur'}</strong>
            </button>
            {profileOpen?<div className="global-header-profile-menu">
              {!guestMode?<button type="button" onClick={()=>{setProfileOpen(false);navigate('/app/profile');}}><UserRound size={16}/> Mon profil</button>:null}
              {isAdmin?<button type="button" onClick={()=>{setProfileOpen(false);navigate('/admin');}}><ShieldCheck size={16}/> Administration</button>:null}
              <button className="danger" type="button" onClick={()=>void authService.logout()}><LogOut size={16}/> Se déconnecter</button>
            </div>:null}
          </div>
        </>:<>
          <Link className="global-header-login" to="/connexion"><LogIn size={16}/> Se connecter</Link>
          <Link className="global-header-register" to="/inscription"><UserPlus size={16}/> Créer un compte</Link>
        </>}
      </div>
    </header>

    {reportOpen?<div className="global-report-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setReportOpen(false);}}>
      <form className="global-report-modal" onSubmit={submitReport}>
        <header><div><span>{reportKind==='bug'?<Bug/>:<Flag/>}</span><div><h2>Signaler à MBotéRoom</h2><p>Votre signalement sera transmis à LoukaTech et visible par les administrateurs.</p></div></div><button type="button" onClick={()=>setReportOpen(false)} aria-label="Fermer"><X/></button></header>
        <div className="global-report-types">
          <button type="button" className={reportKind==='bug'?'active':''} onClick={()=>setReportKind('bug')}><Bug size={16}/> Bug de l’application</button>
          <button type="button" className={reportKind==='meeting'?'active':''} onClick={()=>setReportKind('meeting')}><Flag size={16}/> Réunion</button>
        </div>
        {reportKind==='meeting'?<label>ID de la réunion<input inputMode="numeric" value={reportMeetingId} onChange={(event)=>setReportMeetingId(event.target.value.replace(/\D/g,'').slice(0,12))} placeholder="Ex. 123456"/></label>:null}
        <label>Titre<input value={reportTitle} onChange={(event)=>setReportTitle(event.target.value)} maxLength={180} placeholder={reportKind==='bug'?'Ex. Le bouton caméra ne répond pas':'Ex. Réunion à vérifier'} required/></label>
        <label>Description<textarea value={reportDescription} onChange={(event)=>setReportDescription(event.target.value)} maxLength={5000} rows={6} placeholder="Expliquez ce qui s’est passé, ce que vous attendiez et les étapes utiles pour comprendre le problème." required/></label>
        {reportMessage?<div className="global-report-message" role="status">{reportMessage}</div>:null}
        <footer><button type="button" onClick={()=>setReportOpen(false)}>Annuler</button><button className="primary" type="submit" disabled={reportBusy}>{reportBusy?'Envoi…':'Envoyer le signalement'}</button></footer>
      </form>
    </div>:null}
  </>;
}
