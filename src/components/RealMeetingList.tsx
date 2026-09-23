import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Clock3, Copy, CopyPlus, ExternalLink, Link2, Lock, MoreVertical, Pencil, Play, Plus, RefreshCw, Share2, Trash2, UsersRound, Video, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { getMeetingAccessCode, getMeetingJoinUrl, Meeting, type MeetingSettings, meetingService } from '../services/meetingService';
import { getAppLocale } from '../lib/appLanguage';
import './RealMeetingList.css';

type MeetingForm = {
  title:string;description:string;startTime:string;duration:number;password:string;participants:string;
  waitingRoom:boolean;joinBeforeHost:boolean;participantAudio:boolean;participantVideo:boolean;screenShare:boolean;chat:boolean;reactions:boolean;lunaSummary:boolean;isPublic:boolean;
};

const defaultForm=():MeetingForm=>{
  const start=new Date(Date.now()+30*60_000);start.setSeconds(0,0);
  return{title:'',description:'',startTime:new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16),duration:60,password:'',participants:'',waitingRoom:true,joinBeforeHost:false,participantAudio:true,participantVideo:true,screenShare:true,chat:true,reactions:true,lunaSummary:true,isPublic:false};
};
const formatDate=(value:string)=>new Intl.DateTimeFormat(getAppLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export default function RealMeetingList(){
  const navigate=useNavigate();
  const [searchParams,setSearchParams]=useSearchParams();
  const [searchParams,setSearchParams]=useSearchParams();
  const user=authService.getCurrentUser();
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [showCreate,setShowCreate]=useState(false);
  const [editingMeeting,setEditingMeeting]=useState<Meeting|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<Meeting|null>(null);
  const [openMenuId,setOpenMenuId]=useState<number|null>(null);
  const [form,setForm]=useState<MeetingForm>(defaultForm);
  const [busyId,setBusyId]=useState<number|null>(null);

  const load=async()=>{setLoading(true);setError('');try{const rows=await meetingService.getMeetings();setMeetings(Array.isArray(rows)?rows:[]);}catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les réunions.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);

  useEffect(()=>{
    const createRequested=searchParams.get('new')==='1';
    const editId=Number(searchParams.get('edit')||0);
    if(createRequested){
      setEditingMeeting(null);
      setForm(defaultForm());
      setShowCreate(true);
      return;
    }
    if(editId&&meetings.length){
      const meeting=meetings.find((item)=>Number(item.id)===editId);
      if(meeting&&canManageAsPrimary(meeting)&&!meeting.is_active){
        openEdit(meeting);
      }
    }
  },[searchParams,meetings.length]);

  const closeMeetingForm=()=>{
    setShowCreate(false);
    setEditingMeeting(null);
    setForm(defaultForm());
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

  const createMeeting=async(event:FormEvent)=>{
    event.preventDefault();setError('');
    try{
      const participants=form.participants.split(/[;,\n]+/).map((value)=>value.trim().toLowerCase()).filter(Boolean);
      const meeting=await meetingService.scheduleMeeting({
        title:form.title.trim(),description:form.description.trim(),startTime:new Date(form.startTime).toISOString(),duration:Number(form.duration),participants,
        settings:{password:form.password,participants,waitingRoom:form.waitingRoom,joinBeforeHost:form.joinBeforeHost,participantAudio:form.participantAudio,participantVideo:form.participantVideo,screenShare:form.screenShare,chat:form.chat,reactions:form.reactions,lunaSummary:form.lunaSummary,linkSharing:true,externalAccess:true,isPublic:form.isPublic,visibility:form.isPublic?'public':'private',encryption:true},
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
      setForm(defaultForm());
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

  return <section className="real-meeting-page" onMouseDown={(event)=>{if(openMenuId&&!(event.target as HTMLElement).closest('.real-meeting-menu-wrap'))setOpenMenuId(null);}}>
    <header className="real-meeting-head"><div><h1>Réunions</h1><p>Planifiez, organisez et rejoignez vos réunions depuis cet espace.</p></div><div><button className="secondary" onClick={()=>void load()}><RefreshCw size={17}/> Actualiser</button><button onClick={()=>{setEditingMeeting(null);setForm(defaultForm());setShowCreate(true);}}><Plus size={17}/> Nouvelle réunion</button></div></header>
    {notice?<div className="real-meeting-notice">{notice}</div>:null}{error?<div className="real-meeting-error">{error}</div>:null}
    {loading?<div className="real-meeting-empty">Chargement des réunions…</div>:null}
    {!loading&&!sorted.length?<div className="real-meeting-empty"><Video size={42}/><h2>Aucune réunion</h2><p>Créez votre première réunion pour commencer.</p><button onClick={()=>{setEditingMeeting(null);setForm(defaultForm());setShowCreate(true);}}><CalendarPlus size={17}/> Planifier</button></div>:null}
    <div className="real-meeting-grid">{sorted.map((meeting)=>{
      const actualHost=isActualHost(meeting);const primaryManager=canManageAsPrimary(meeting);const coHost=isCoHost(meeting);const moderator=canModerate(meeting);const startAt=new Date(meeting.start_time);const cancelled=meeting.status==='cancelled';const ended=meeting.status==='ended'||cancelled||(startAt.getTime()+meeting.duration*60000<Date.now()&&!meeting.is_active&&meeting.status!=='scheduled');const roleLabel=actualHost?'Vous êtes hôte':coHost?'Vous êtes co-hôte':isAdmin()?'Administration':meeting.host_name;const statusLabel=meeting.is_active?'EN DIRECT':cancelled?'ANNULÉE':ended?'TERMINÉE':'PROGRAMMÉE';
      return <article key={meeting.id} className="real-meeting-card">
        <div className="real-meeting-card-top">
          <span className={meeting.is_active?'live':''}>{statusLabel}</span>
          <div className="real-meeting-card-meta"><small>{roleLabel}</small><div className="real-meeting-menu-wrap">
            <button className="real-meeting-menu-trigger" type="button" aria-label={`Options pour ${meeting.title}`} aria-expanded={openMenuId===meeting.id} onClick={()=>setOpenMenuId((current)=>current===meeting.id?null:meeting.id)}><MoreVertical size={19}/></button>
            {openMenuId===meeting.id?<div className="real-meeting-menu" role="menu">
              <button type="button" role="menuitem" onClick={()=>{setOpenMenuId(null);void join(meeting);}}><ExternalLink size={16}/><span>{ended?'Voir le résumé':'Ouvrir la réunion'}</span></button>
              <button type="button" role="menuitem" onClick={()=>void copy(meeting)}><Link2 size={16}/><span>Copier le lien</span></button>
              <button type="button" role="menuitem" onClick={()=>void copyId(meeting)}><Copy size={16}/><span>Copier l’ID</span></button>
              <button type="button" role="menuitem" onClick={()=>void shareMeeting(meeting)}><Share2 size={16}/><span>Partager</span></button>
              {primaryManager&&!meeting.is_active&&!ended?<button type="button" role="menuitem" onClick={()=>openEdit(meeting)}><Pencil size={16}/><span>Modifier</span></button>:null}
              {primaryManager?<button type="button" role="menuitem" onClick={()=>void duplicate(meeting)}><CopyPlus size={16}/><span>Dupliquer</span></button>:null}
              {moderator&&!meeting.is_active&&!ended?<button type="button" role="menuitem" onClick={()=>{setOpenMenuId(null);void start(meeting);}}><Play size={16}/><span>Démarrer</span></button>:null}
              {primaryManager&&!meeting.is_active?<><div className="real-meeting-menu-separator"/><button type="button" role="menuitem" className="is-danger" onClick={()=>{setOpenMenuId(null);setDeleteTarget(meeting);}}><Trash2 size={16}/><span>Supprimer</span></button></>:null}
            </div>:null}
          </div></div>
        </div>
        <h2>{meeting.title}</h2>{meeting.description?<p>{meeting.description}</p>:null}
        <dl><div><dt><Clock3 size={15}/> Horaire</dt><dd>{formatDate(meeting.start_time)} · {meeting.duration} min</dd></div><div><dt><UsersRound size={15}/> Participants</dt><dd>{Math.max(1,meeting.participant_count||1)} · capacité {meeting.settings?.participantCapacity||'non limitée'}</dd></div><div><dt><Lock size={15}/> ID</dt><dd>{meeting.settings?.meetingAccessId||getMeetingAccessCode(meeting)}</dd></div><div><dt><Link2 size={15}/> Accès</dt><dd>{meeting.settings?.waitingRoom===false?'Entrée directe':'Salle d’attente'} · {meeting.settings?.chat===false?'chat coupé':'chat actif'}</dd></div></dl>
        <div className="real-meeting-actions"><button className="secondary" onClick={()=>void copy(meeting)}><Copy size={16}/> Copier</button>{ended?<button onClick={()=>void join(meeting)} disabled={busyId===meeting.id}><Video size={16}/> Résumé</button>:moderator&&!meeting.is_active?<button onClick={()=>void start(meeting)} disabled={busyId===meeting.id}><Play size={16}/> Démarrer</button>:<button onClick={()=>void join(meeting)} disabled={busyId===meeting.id}><Video size={16}/> Rejoindre</button>}</div>
      </article>})}</div>

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
