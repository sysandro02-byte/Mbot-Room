import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, CheckCircle2, ChevronRight, CirclePlay, Clock3, Copy, CopyPlus, Database, ExternalLink, Link2, Lock, MoreVertical, Pencil, Play, Plus, RefreshCw, Search, Share2, Trash2, UserPlus, UsersRound, Video, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { appDataService, type Preferences, type RecordingStats } from '../services/appDataService';
import { readCachedPreferences } from '../lib/userPreferences';
import { getMeetingAccessCode, getMeetingJoinUrl, Meeting, type MeetingSettings, meetingService } from '../services/meetingService';
import { getAppLocale } from '../lib/appLanguage';
import './RealMeetingList.css';

type MeetingForm = {
  title:string;description:string;startTime:string;duration:number;password:string;participants:string;
  waitingRoom:boolean;joinBeforeHost:boolean;participantAudio:boolean;participantVideo:boolean;screenShare:boolean;chat:boolean;reactions:boolean;lunaSummary:boolean;isPublic:boolean;
};

const defaultForm=(preferences:Preferences=readCachedPreferences()):MeetingForm=>{
  const start=new Date(Date.now()+30*60_000);start.setSeconds(0,0);
  return{
    title:'',description:'',startTime:new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16),
    duration:60,password:'',participants:'',
    waitingRoom:preferences.waitingRoomDefault!==false,
    joinBeforeHost:false,
    participantAudio:preferences.participantAudioAllowed!==false,
    participantVideo:preferences.participantVideoAllowed!==false,
    screenShare:preferences.screenShareAllowed!==false,
    chat:true,reactions:true,
    lunaSummary:preferences.lunaAutoSummary!==false,
    isPublic:false,
  };
};
const formatDate=(value:string)=>new Intl.DateTimeFormat(getAppLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const formatTime=(value:Date)=>new Intl.DateTimeFormat(getAppLocale(),{hour:'2-digit',minute:'2-digit'}).format(value);
const pad=(value:number)=>String(value).padStart(2,'0');

export default function RealMeetingList(){
  const navigate=useNavigate();
  const [searchParams,setSearchParams]=useSearchParams();
  const user=authService.getCurrentUser();
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [preferences,setPreferences]=useState<Preferences>(()=>readCachedPreferences());
  const [recordingStats,setRecordingStats]=useState<RecordingStats|null>(null);
  const [viewFilter,setViewFilter]=useState<'upcoming'|'live'|'ended'|'mine'|'invitations'>('upcoming');
  const [searchQuery,setSearchQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [showCreate,setShowCreate]=useState(false);
  const [editingMeeting,setEditingMeeting]=useState<Meeting|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<Meeting|null>(null);
  const [openMenuId,setOpenMenuId]=useState<number|null>(null);
  const [form,setForm]=useState<MeetingForm>(()=>defaultForm(readCachedPreferences()));
  const [busyId,setBusyId]=useState<number|null>(null);

  const load=async()=>{setLoading(true);setError('');try{
    const [rows,prefs,recordingRows]=await Promise.all([
      meetingService.getMeetings(),
      appDataService.getPreferences().catch(()=>readCachedPreferences()),
      appDataService.getRecordingStats().catch(()=>null),
    ]);
    setMeetings(Array.isArray(rows)?rows:[]);
    setPreferences(prefs||{});
    setRecordingStats(recordingRows);
    if(!showCreate&&!editingMeeting)setForm(defaultForm(prefs||{}));
  }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les réunions.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);

  const closeMeetingForm=()=>{
    setShowCreate(false);
    setEditingMeeting(null);
    setForm(defaultForm(preferences));
    const next=new URLSearchParams(searchParams);
    next.delete('new');next.delete('mode');next.delete('intent');next.delete('edit');
    setSearchParams(next,{replace:true});
  };
  useEffect(()=>{
    const closeMenus=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpenMenuId(null);setDeleteTarget(null);}};
    document.addEventListener('keydown',closeMenus);
    return()=>document.removeEventListener('keydown',closeMenus);
  },[]);

  const sorted=useMemo(()=>[...meetings].sort((a,b)=>new Date(a.start_time).getTime()-new Date(b.start_time).getTime()),[meetings]);
  const isActualHost=(meeting:Meeting)=>Boolean(user&&Number(meeting.host_id)===Number(user.id));
  const isAdmin=()=>user?.role==='admin';
  const canManageAsPrimary=(meeting:Meeting)=>isActualHost(meeting)||isAdmin();
  const isCoHost=(meeting:Meeting)=>Boolean(user&&Number(meeting.co_host_id||0)===Number(user.id));
  const canModerate=(meeting:Meeting)=>canManageAsPrimary(meeting)||isCoHost(meeting);
  const meetingPhase=(meeting:Meeting):'upcoming'|'live'|'ended'=> {
    const startAt=new Date(meeting.start_time).getTime();
    const cancelled=meeting.status==='cancelled';
    const ended=meeting.status==='ended'||cancelled||(startAt+(meeting.duration||60)*60_000<Date.now()&&!meeting.is_active&&meeting.status!=='scheduled');
    if(ended)return 'ended';
    if(meeting.is_active||meeting.status==='live')return 'live';
    return 'upcoming';
  };
  const upcomingMeetings=sorted.filter((meeting)=>meetingPhase(meeting)==='upcoming');
  const liveMeetings=sorted.filter((meeting)=>meetingPhase(meeting)==='live');
  const endedMeetings=[...sorted].filter((meeting)=>meetingPhase(meeting)==='ended').sort((a,b)=>new Date(b.start_time).getTime()-new Date(a.start_time).getTime());
  const mineMeetings=sorted.filter((meeting)=>isActualHost(meeting)||isCoHost(meeting)||isAdmin());
  const invitationMeetings=sorted.filter((meeting)=>!isActualHost(meeting)&&!isCoHost(meeting)&&!isAdmin());
  const selectedCollection=viewFilter==='upcoming'?upcomingMeetings:viewFilter==='live'?liveMeetings:viewFilter==='ended'?endedMeetings:viewFilter==='mine'?mineMeetings:invitationMeetings;
  const normalizedQuery=searchQuery.trim().toLowerCase();
  const visibleMeetings=selectedCollection.filter((meeting)=>!normalizedQuery||[meeting.title,meeting.description,meeting.host_name,String(meeting.settings?.meetingAccessId||getMeetingAccessCode(meeting))].join(' ').toLowerCase().includes(normalizedQuery));
  const nextMeeting=upcomingMeetings[0]||liveMeetings[0]||null;
  const monthNow=new Date();
  const monthlyMinutes=meetings.filter((meeting)=>{const date=new Date(meeting.start_time);return date.getFullYear()===monthNow.getFullYear()&&date.getMonth()===monthNow.getMonth();}).reduce((total,meeting)=>total+Number(meeting.duration||0),0);
  const monthlyHours=monthlyMinutes<60?monthlyMinutes+' min':Math.round(monthlyMinutes/6)/10+' h';
  const storageRatio=recordingStats?.quotaBytes?Math.min(100,Math.round((Number(recordingStats.sizeBytes||0)/Number(recordingStats.quotaBytes))*100)):0;
  const formatBytes=(value:number)=>{
    if(!Number.isFinite(value)||value<=0)return '0 Mo';
    const units=['o','Ko','Mo','Go'];
    let amount=value,index=0;
    while(amount>=1024&&index<units.length-1){amount/=1024;index+=1;}
    return (index===3&&amount<10?amount.toFixed(1):Math.round(amount))+' '+units[index];
  };
  const timeUntil=(meeting:Meeting)=>{
    const diff=new Date(meeting.start_time).getTime()-Date.now();
    if(diff<=0)return meeting.is_active?'En cours':'Maintenant';
    const minutes=Math.ceil(diff/60_000);
    if(minutes<60)return 'Dans '+minutes+' min';
    const hours=Math.ceil(minutes/60);
    if(hours<24)return 'Dans '+hours+' h';
    return 'Dans '+Math.ceil(hours/24)+' j';
  };
  const participantLabels=(meeting:Meeting)=>{
    const emails=Array.isArray(meeting.settings?.participants)?meeting.settings!.participants!:[];
    return emails.slice(0,5).map((email)=>String(email).split('@')[0].split(/[._-]/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'P');
  };

  const createMeeting=async(event:FormEvent)=>{
    event.preventDefault();setError('');
    try{
      const participants=form.participants.split(/[;,\n]+/).map((value)=>value.trim().toLowerCase()).filter(Boolean);
      const meeting=await meetingService.scheduleMeeting({
        title:form.title.trim(),description:form.description.trim(),startTime:new Date(form.startTime).toISOString(),duration:Number(form.duration),participants,
        settings:{password:form.password,participants,waitingRoom:form.waitingRoom,joinBeforeHost:form.joinBeforeHost,participantAudio:form.participantAudio,participantVideo:form.participantVideo,screenShare:form.screenShare,chat:form.chat,reactions:form.reactions,lunaSummary:form.lunaSummary,locked:preferences.meetingLockDefault===true,linkSharing:true,externalAccess:true,isPublic:form.isPublic,visibility:form.isPublic?'public':'private',encryption:true},
      });
      setMeetings((current)=>[...current,meeting]);closeMeetingForm();setNotice('Réunion créée. Les invitations sont en cours d’envoi.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Création impossible.');}
  };

  const openEdit=(meeting:Meeting)=>{
    const localStart=new Date(meeting.start_time);
    setEditingMeeting(meeting);
    setForm({
      title:meeting.title,
      description:meeting.description||'',
      startTime:new Date(localStart.getTime()-localStart.getTimezoneOffset()*60000).toISOString().slice(0,16),
      duration:meeting.duration||60,
      password:'',
      participants:Array.isArray(meeting.settings?.participants)?meeting.settings!.participants!.join('; '):'',
      waitingRoom:meeting.settings?.waitingRoom!==false,
      joinBeforeHost:meeting.settings?.joinBeforeHost===true,
      participantAudio:meeting.settings?.participantAudio!==false,
      participantVideo:meeting.settings?.participantVideo!==false,
      screenShare:meeting.settings?.screenShare!==false,
      chat:meeting.settings?.chat!==false,
      reactions:meeting.settings?.reactions!==false,
      lunaSummary:meeting.settings?.lunaSummary!==false,
      isPublic:meeting.settings?.isPublic===true||meeting.settings?.visibility==='public',
    });
    setOpenMenuId(null);
    setShowCreate(true);
  };
  useEffect(()=>{
    const createRequested=searchParams.get('new')==='1';
    const editId=Number(searchParams.get('edit')||0);
    if(createRequested){
      setEditingMeeting(null);
      setForm(defaultForm(preferences));
      setShowCreate(true);
      if(searchParams.get('intent')==='screen-share')setNotice('Créez la réunion, puis utilisez « Partager l’écran » une fois dans la salle.');
      setSearchParams({}, { replace:true });
      return;
    }
    if(editId&&meetings.length){
      const meeting=meetings.find((item)=>item.id===editId);
      if(meeting&&canManageAsPrimary(meeting)&&!meeting.is_active&&meeting.status!=='ended'&&meeting.status!=='cancelled')openEdit(meeting);
      else if(meeting)setNotice('Cette réunion ne peut pas être modifiée dans son état actuel.');
      setSearchParams({}, { replace:true });
    }
  },[meetings,searchParams,setSearchParams]);



  const submitMeeting=async(event:FormEvent)=>{
    if(!editingMeeting){await createMeeting(event);return;}
    event.preventDefault();setError('');setBusyId(editingMeeting.id);
    try{
      const participants=form.participants.split(/[;,\n]+/).map((value)=>value.trim().toLowerCase()).filter(Boolean);
      const settings: MeetingSettings & { password?: string } = {
        participants,
        waitingRoom:form.waitingRoom,
        joinBeforeHost:form.joinBeforeHost,
        participantAudio:form.participantAudio,
        participantVideo:form.participantVideo,
        screenShare:form.screenShare,
        chat:form.chat,
        reactions:form.reactions,
        lunaSummary:form.lunaSummary,
        linkSharing:true,
        externalAccess:true,
        isPublic:form.isPublic,
        visibility:form.isPublic?'public':'private',
        encryption:true,
      };
      if(form.password.trim())settings.password=form.password.trim();
      const updated=await meetingService.updateMeeting(editingMeeting.id,{
        title:form.title.trim(),
        description:form.description.trim(),
        startTime:new Date(form.startTime).toISOString(),
        duration:Number(form.duration),
        participants,
        settings,
      });
      setMeetings((current)=>current.map((item)=>item.id===updated.id?updated:item));
      closeMeetingForm();setNotice('Réunion mise à jour.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Modification impossible.');}
    finally{setBusyId(null);}
  };

  const duplicate=async(meeting:Meeting)=>{
    setOpenMenuId(null);setBusyId(meeting.id);
    try{
      const nextStart=new Date(Date.now()+30*60_000);
      const clone=await meetingService.scheduleMeeting({
        title:`Copie de ${meeting.title}`,
        description:meeting.description||'',
        startTime:nextStart.toISOString(),
        duration:meeting.duration||60,
        settings:{
          waitingRoom:meeting.settings?.waitingRoom!==false,
          joinBeforeHost:meeting.settings?.joinBeforeHost===true,
          participantAudio:meeting.settings?.participantAudio!==false,
          participantVideo:meeting.settings?.participantVideo!==false,
          screenShare:meeting.settings?.screenShare!==false,
          chat:meeting.settings?.chat!==false,
          reactions:meeting.settings?.reactions!==false,
          lunaSummary:meeting.settings?.lunaSummary!==false,
          linkSharing:true,
          externalAccess:true,
          isPublic:meeting.settings?.isPublic===true,
          visibility:meeting.settings?.visibility||'private',
          encryption:true,
        },
      });
      setMeetings((current)=>[...current,clone]);
      setNotice('Une copie de la réunion a été créée.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Duplication impossible.');}
    finally{setBusyId(null);}
  };

  const copyId=async(meeting:Meeting)=>{
    setOpenMenuId(null);
    try{await navigator.clipboard.writeText(String(meeting.settings?.meetingAccessId||getMeetingAccessCode(meeting)));setNotice('ID de réunion copié.');}
    catch{setError('Impossible de copier l’ID.');}
  };

  const shareMeeting=async(meeting:Meeting)=>{
    setOpenMenuId(null);
    const url=getMeetingJoinUrl(meeting);
    try{
      if(navigator.share){await navigator.share({title:meeting.title,text:`Rejoignez « ${meeting.title} » sur MBotéRoom`,url});setNotice('Invitation prête à être partagée.');return;}
      await navigator.clipboard.writeText(url);setNotice('Lien de réunion copié pour le partage.');
    }catch(cause){
      if(cause instanceof DOMException&&cause.name==='AbortError')return;
      setError('Partage impossible.');
    }
  };

  const start=async(meeting:Meeting)=>{setBusyId(meeting.id);try{const result=await meetingService.startMeetingAndNotify(meeting.id);const live=result.meeting||{...meeting,is_active:true};setMeetings((current)=>current.map((item)=>item.id===meeting.id?live:item));navigate(`/reunions/${meeting.meeting_link}`,{state:{meeting:live}});}catch(cause){setError(cause instanceof Error?cause.message:'Démarrage impossible.');}finally{setBusyId(null);}};
  const join=async(meeting:Meeting)=>{setBusyId(meeting.id);try{if(meeting.status==='ended'||meeting.status==='cancelled'){navigate(`/reunions/${meeting.meeting_link}/terminee`,{state:{meeting}});return;}if(!canModerate(meeting)){const result=await meetingService.requestJoin(meeting.id);if(result.status==='requested'){navigate(`/reunions/${meeting.meeting_link}/salle-attente`,{state:{meeting}});return;}}navigate(`/reunions/${meeting.meeting_link}`,{state:{meeting}});}catch(cause){setError(cause instanceof Error?cause.message:'Accès impossible.');}finally{setBusyId(null);}};
  const remove=async(meeting:Meeting)=>{setBusyId(meeting.id);try{await meetingService.deleteMeeting(meeting.id);setMeetings((current)=>current.filter((item)=>item.id!==meeting.id));setDeleteTarget(null);setOpenMenuId(null);setNotice('Réunion supprimée de votre liste.');}catch(cause){setError(cause instanceof Error?cause.message:'Suppression impossible.');}finally{setBusyId(null);}};
  const copy=async(meeting:Meeting)=>{setOpenMenuId(null);try{await navigator.clipboard.writeText(getMeetingJoinUrl(meeting));setNotice('Lien de réunion copié.');}catch{setError('Impossible de copier le lien.');}};

  return <section className="real-meeting-page meeting-pro-page" onMouseDown={(event)=>{if(openMenuId&&!(event.target as HTMLElement).closest('.real-meeting-menu-wrap'))setOpenMenuId(null);}}>
    <header className="meeting-pro-hero">
      <div className="meeting-pro-title">
        <span><Video/></span>
        <div><h1>Réunions</h1><p>Planifiez, organisez et rejoignez vos réunions depuis cet espace.</p></div>
      </div>
      <button className="meeting-pro-new" onClick={()=>{setEditingMeeting(null);setForm(defaultForm(preferences));setShowCreate(true);}}><Plus/> Nouvelle réunion</button>
    </header>

    <section className="meeting-pro-shortcuts" aria-label="Actions rapides">
      <button className="blue" onClick={()=>{setEditingMeeting(null);setForm(defaultForm(preferences));setShowCreate(true);}}><span><CalendarPlus/></span><div><strong>Planifier<br/>une réunion</strong><small>Programmez et invitez des participants</small></div><ChevronRight/></button>
      <button className="green" onClick={()=>navigate('/app/groups?new=1')}><span><UsersRound/></span><div><strong>Créer un groupe</strong><small>Collaborez facilement avec votre équipe</small></div><ChevronRight/></button>
      <button className="purple" onClick={()=>navigate('/join')}><span><Link2/></span><div><strong>Rejoindre une réunion</strong><small>Avec un ID, un code ou un lien</small></div><ChevronRight/></button>
      <button className="orange" onClick={()=>navigate('/app/calendar')}><span><CalendarDays/></span><div><strong>Voir le calendrier</strong><small>Toutes vos réunions à venir</small></div><ChevronRight/></button>
    </section>

    <section className="meeting-pro-stats">
      <article><span className="blue"><CalendarDays/></span><div><strong>{upcomingMeetings.length}</strong><small>Réunions à venir</small></div></article>
      <article><span className="green"><CirclePlay/></span><div><strong>{liveMeetings.length}</strong><small>Réunions en cours</small></div></article>
      <article><span className="teal"><CheckCircle2/></span><div><strong>{endedMeetings.length}</strong><small>Réunions terminées</small></div></article>
      <article><span className="orange"><Clock3/></span><div><strong>{monthlyHours}</strong><small>Durée totale ce mois</small></div></article>
    </section>

    {notice?<div className="real-meeting-notice">{notice}</div>:null}{error?<div className="real-meeting-error">{error}</div>:null}

    <div className="meeting-pro-layout">
      <section className="meeting-pro-main">
        <div className="meeting-pro-toolbar">
          <div className="meeting-pro-tabs">
            <button className={viewFilter==='upcoming'?'active':''} onClick={()=>setViewFilter('upcoming')}><CalendarDays/> À venir <b>{upcomingMeetings.length}</b></button>
            <button className={viewFilter==='live'?'active':''} onClick={()=>setViewFilter('live')}><CirclePlay/> En cours <b>{liveMeetings.length}</b></button>
            <button className={viewFilter==='ended'?'active':''} onClick={()=>setViewFilter('ended')}><CheckCircle2/> Terminées</button>
            <button className={viewFilter==='mine'?'active':''} onClick={()=>setViewFilter('mine')}><UsersRound/> Mes réunions</button>
            <button className={viewFilter==='invitations'?'active':''} onClick={()=>setViewFilter('invitations')}><UserPlus/> Invitations {invitationMeetings.length?<b className="coral">{invitationMeetings.length}</b>:null}</button>
          </div>
          <label className="meeting-pro-search"><Search/><input value={searchQuery} onChange={(event)=>setSearchQuery(event.target.value)} placeholder="Rechercher une réunion…"/></label>
        </div>

        {loading?<div className="real-meeting-empty">Chargement des réunions…</div>:null}
        {!loading&&!visibleMeetings.length?<div className="real-meeting-empty"><Video size={42}/><h2>Aucune réunion</h2><p>{searchQuery?'Aucun résultat ne correspond à votre recherche.':'Aucune réunion dans cette catégorie.'}</p><button onClick={()=>{setEditingMeeting(null);setForm(defaultForm(preferences));setShowCreate(true);}}><CalendarPlus size={17}/> Planifier une réunion</button></div>:null}

        <div className="meeting-pro-list">
          {visibleMeetings.map((meeting)=>{
            const phase=meetingPhase(meeting);
            const actualHost=isActualHost(meeting);
            const primaryManager=canManageAsPrimary(meeting);
            const coHost=isCoHost(meeting);
            const moderator=canModerate(meeting);
            const ended=phase==='ended';
            const startAt=new Date(meeting.start_time);
            const labels=participantLabels(meeting);
            const participantCount=Math.max(1,Number(meeting.participant_count||meeting.settings?.participants?.length||1));
            const statusLabel=phase==='live'?'En direct':phase==='ended'?(meeting.status==='cancelled'?'Annulée':'Terminée'):timeUntil(meeting);
            return <article key={meeting.id} className={'meeting-pro-row '+phase}>
              <time className="meeting-pro-date"><strong>{pad(startAt.getDate())}</strong><span>{new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(startAt).replace('.','')}</span><small>{startAt.getFullYear()}</small></time>
              <div className="meeting-pro-info">
                <div className="meeting-pro-info-top"><h2>{meeting.title}</h2><b className={phase}>{statusLabel}</b></div>
                <small><Clock3/> {formatTime(startAt)} – {formatTime(new Date(startAt.getTime()+(meeting.duration||60)*60_000))} ({meeting.duration||60} min)</small>
                <small><Lock/> {meeting.settings?.waitingRoom===false?'Entrée directe':'Salle d’attente activée'}</small>
                <small><Link2/> ID : {meeting.settings?.meetingAccessId||getMeetingAccessCode(meeting)}</small>
              </div>
              <div className="meeting-pro-participants">
                <div>{labels.map((label,index)=><span key={label+index}>{label}</span>)}{participantCount>labels.length?<span>+{participantCount-labels.length}</span>:null}</div>
                <small>{participantCount} participant{participantCount>1?'s':''}</small>
              </div>
              <div className="meeting-pro-row-actions">
                {ended
                  ?<button className="primary" onClick={()=>void join(meeting)} disabled={busyId===meeting.id}><Video/> Résumé</button>
                  :moderator&&!meeting.is_active
                    ?<button className="primary" onClick={()=>void start(meeting)} disabled={busyId===meeting.id}><Play/> Démarrer</button>
                    :<button className="primary" onClick={()=>void join(meeting)} disabled={busyId===meeting.id}><Play/> Rejoindre</button>}
                <button className="secondary" onClick={()=>void copyId(meeting)}><Copy/> Copier l’ID</button>
                <button className="secondary" onClick={()=>void shareMeeting(meeting)}><UserPlus/> Inviter</button>
                <div className="real-meeting-menu-wrap">
                  <button className="real-meeting-menu-trigger" type="button" aria-label={'Options pour '+meeting.title} aria-expanded={openMenuId===meeting.id} onClick={()=>setOpenMenuId((current)=>current===meeting.id?null:meeting.id)}><MoreVertical/></button>
                  {openMenuId===meeting.id?<div className="real-meeting-menu" role="menu">
                    <button type="button" role="menuitem" onClick={()=>{setOpenMenuId(null);void join(meeting);}}><ExternalLink/><span>{ended?'Voir le résumé':'Ouvrir la réunion'}</span></button>
                    <button type="button" role="menuitem" onClick={()=>void copy(meeting)}><Link2/><span>Copier le lien</span></button>
                    <button type="button" role="menuitem" onClick={()=>void copyId(meeting)}><Copy/><span>Copier l’ID</span></button>
                    <button type="button" role="menuitem" onClick={()=>void shareMeeting(meeting)}><Share2/><span>Partager</span></button>
                    {primaryManager&&!meeting.is_active&&!ended?<button type="button" role="menuitem" onClick={()=>openEdit(meeting)}><Pencil/><span>Modifier</span></button>:null}
                    {primaryManager?<button type="button" role="menuitem" onClick={()=>void duplicate(meeting)}><CopyPlus/><span>Dupliquer</span></button>:null}
                    {moderator&&!meeting.is_active&&!ended?<button type="button" role="menuitem" onClick={()=>{setOpenMenuId(null);void start(meeting);}}><Play/><span>Démarrer</span></button>:null}
                    {primaryManager&&!meeting.is_active?<><div className="real-meeting-menu-separator"/><button type="button" role="menuitem" className="is-danger" onClick={()=>{setOpenMenuId(null);setDeleteTarget(meeting);}}><Trash2/><span>Supprimer</span></button></>:null}
                  </div>:null}
                </div>
              </div>
            </article>;
          })}
        </div>
      </section>

      <aside className="meeting-pro-side">
        <section className="meeting-pro-next">
          <header><CalendarDays/><strong>Prochaine réunion</strong></header>
          {nextMeeting?<div>
            <h2>{nextMeeting.title}</h2>
            <p>{formatDate(nextMeeting.start_time)}</p>
            <div className="meeting-pro-side-participants">{participantLabels(nextMeeting).map((label,index)=><span key={label+index}>{label}</span>)}<small>{Math.max(1,Number(nextMeeting.participant_count||nextMeeting.settings?.participants?.length||1))} participant(s)</small></div>
            <button onClick={()=>void (canModerate(nextMeeting)&&!nextMeeting.is_active?start(nextMeeting):join(nextMeeting))}><Play/> {nextMeeting.is_active?'Rejoindre maintenant':canModerate(nextMeeting)?'Démarrer maintenant':'Rejoindre maintenant'}</button>
            <button className="link" onClick={()=>setSearchQuery(nextMeeting.title)}>Voir les détails <ChevronRight/></button>
          </div>:<div className="meeting-pro-side-empty">Aucune réunion à venir.</div>}
        </section>

        <section className="meeting-pro-links">
          <header><Link2/><strong>Liens rapides</strong></header>
          <button onClick={()=>{setEditingMeeting(null);setForm(defaultForm(preferences));setShowCreate(true);}}><span className="green"><CalendarPlus/></span><div><strong>Nouvelle réunion</strong><small>Planifier une réunion</small></div><ChevronRight/></button>
          <button onClick={()=>navigate('/app/groups?new=1')}><span className="blue"><UsersRound/></span><div><strong>Créer un groupe</strong><small>Collaborer avec votre équipe</small></div><ChevronRight/></button>
          <button onClick={()=>navigate('/join')}><span className="purple"><Link2/></span><div><strong>Rejoindre une réunion</strong><small>Avec un ID ou un lien</small></div><ChevronRight/></button>
          <button onClick={()=>navigate('/app/calendar')}><span className="orange"><CalendarDays/></span><div><strong>Calendrier</strong><small>Voir toutes vos réunions</small></div><ChevronRight/></button>
        </section>

        <section className="meeting-pro-storage">
          <header><Database/><strong>Stockage & données</strong></header>
          <div><i><b style={{width:storageRatio+'%'}}/></i><span>{formatBytes(Number(recordingStats?.sizeBytes||0))} utilisés sur {formatBytes(Number(recordingStats?.quotaBytes||0))}</span><strong>{storageRatio}%</strong></div>
          <button onClick={()=>navigate('/app/settings#storage-data')}>Gérer le stockage <ChevronRight/></button>
        </section>
      </aside>
    </div>

    {showCreate?<div className="real-meeting-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget){closeMeetingForm();}}}><form className="real-meeting-form" onSubmit={submitMeeting}><header><div><h2>{editingMeeting?'Modifier la réunion':'Planifier une réunion'}</h2><p>{editingMeeting?'Mettez à jour les informations et réglages de cette réunion.':'Le lien de réunion est créé automatiquement.'}</p></div><button type="button" onClick={()=>{closeMeetingForm();}}><X/></button></header><label>Titre<input required maxLength={160} value={form.title} onChange={(event)=>setForm((current)=>({...current,title:event.target.value}))}/></label><label>Description<textarea maxLength={1500} value={form.description} onChange={(event)=>setForm((current)=>({...current,description:event.target.value}))}/></label><div className="real-meeting-form-row"><label>Début<input required type="datetime-local" value={form.startTime} onChange={(event)=>setForm((current)=>({...current,startTime:event.target.value}))}/></label><label>Durée<select value={form.duration} onChange={(event)=>setForm((current)=>({...current,duration:Number(event.target.value)}))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 heure</option><option value={90}>1 h 30</option><option value={120}>2 heures</option></select></label></div><label>Invités (emails)<textarea placeholder="amina@example.com; paul@example.com" value={form.participants} onChange={(event)=>setForm((current)=>({...current,participants:event.target.value}))}/></label><label>Mot de passe facultatif<input type="password" value={form.password} onChange={(event)=>setForm((current)=>({...current,password:event.target.value}))}/></label><div className="real-meeting-options"><Check label="Salle d’attente" value={form.waitingRoom} set={(value)=>setForm((current)=>({...current,waitingRoom:value}))}/><Check label="Autoriser avant l’hôte" value={form.joinBeforeHost} set={(value)=>setForm((current)=>({...current,joinBeforeHost:value}))}/><Check label="Micro participants" value={form.participantAudio} set={(value)=>setForm((current)=>({...current,participantAudio:value}))}/><Check label="Caméra participants" value={form.participantVideo} set={(value)=>setForm((current)=>({...current,participantVideo:value}))}/><Check label="Partage d’écran" value={form.screenShare} set={(value)=>setForm((current)=>({...current,screenShare:value}))}/><Check label="Chat" value={form.chat} set={(value)=>setForm((current)=>({...current,chat:value}))}/><Check label="Réactions" value={form.reactions} set={(value)=>setForm((current)=>({...current,reactions:value}))}/><Check label="Résumé Luna" value={form.lunaSummary} set={(value)=>setForm((current)=>({...current,lunaSummary:value}))}/><Check label="Réunion publique" value={form.isPublic} set={(value)=>setForm((current)=>({...current,isPublic:value}))}/></div><footer><button type="button" className="secondary" onClick={()=>{closeMeetingForm();}}>Annuler</button><button type="submit" disabled={Boolean(editingMeeting&&busyId===editingMeeting.id)}><CalendarPlus size={17}/> {editingMeeting?'Enregistrer les modifications':'Créer la réunion'}</button></footer></form></div>:null}

    {deleteTarget?<div className="real-meeting-confirm-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDeleteTarget(null);}}>
      <section className="real-meeting-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-meeting-title">
        <span className="real-meeting-confirm-icon"><Trash2 size={25}/></span>
        <h2 id="delete-meeting-title">Supprimer cette réunion ?</h2>
        <p>« {deleteTarget.title} » sera retirée de votre liste et ne pourra plus être rejointe avec son lien.</p>
        <div><button type="button" className="secondary" onClick={()=>setDeleteTarget(null)}>Annuler</button><button type="button" className="danger" disabled={busyId===deleteTarget.id} onClick={()=>void remove(deleteTarget)}><Trash2 size={16}/>{busyId===deleteTarget.id?'Suppression…':'Supprimer'}</button></div>
      </section>
    </div>:null}
  </section>;
}

function Check({label,value,set}:{label:string;value:boolean;set:(value:boolean)=>void}){return <label className="real-meeting-check"><input type="checkbox" checked={value} onChange={(event)=>set(event.target.checked)}/><span>{label}</span></label>;}
