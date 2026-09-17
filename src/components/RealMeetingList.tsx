import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Clock3, Copy, Link2, Lock, Play, Plus, RefreshCw, Trash2, UsersRound, Video, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { getMeetingAccessCode, getMeetingJoinUrl, Meeting, meetingService } from '../services/meetingService';
import './RealMeetingList.css';

type MeetingForm = {
  title:string;description:string;startTime:string;duration:number;password:string;participants:string;
  waitingRoom:boolean;joinBeforeHost:boolean;participantAudio:boolean;participantVideo:boolean;screenShare:boolean;chat:boolean;reactions:boolean;lunaSummary:boolean;isPublic:boolean;
};

const defaultForm=():MeetingForm=>{
  const start=new Date(Date.now()+30*60_000);start.setSeconds(0,0);
  return{title:'',description:'',startTime:new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16),duration:60,password:'',participants:'',waitingRoom:true,joinBeforeHost:false,participantAudio:true,participantVideo:true,screenShare:true,chat:true,reactions:true,lunaSummary:true,isPublic:false};
};
const formatDate=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export default function RealMeetingList(){
  const navigate=useNavigate();
  const user=authService.getCurrentUser();
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [showCreate,setShowCreate]=useState(false);
  const [form,setForm]=useState<MeetingForm>(defaultForm);
  const [busyId,setBusyId]=useState<number|null>(null);

  const load=async()=>{setLoading(true);setError('');try{const rows=await meetingService.getMeetings();setMeetings(Array.isArray(rows)?rows:[]);}catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les réunions.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);

  const sorted=useMemo(()=>[...meetings].sort((a,b)=>new Date(a.start_time).getTime()-new Date(b.start_time).getTime()),[meetings]);
  const isHost=(meeting:Meeting)=>Boolean(user&&(Number(meeting.host_id)===Number(user.id)||Number(meeting.co_host_id||0)===Number(user.id)||user.role==='admin'));

  const createMeeting=async(event:FormEvent)=>{
    event.preventDefault();setError('');
    try{
      const participants=form.participants.split(/[;,\n]+/).map((value)=>value.trim().toLowerCase()).filter(Boolean);
      const meeting=await meetingService.scheduleMeeting({
        title:form.title.trim(),description:form.description.trim(),startTime:new Date(form.startTime).toISOString(),duration:Number(form.duration),participants,
        settings:{password:form.password,participants,waitingRoom:form.waitingRoom,joinBeforeHost:form.joinBeforeHost,participantAudio:form.participantAudio,participantVideo:form.participantVideo,screenShare:form.screenShare,chat:form.chat,reactions:form.reactions,lunaSummary:form.lunaSummary,linkSharing:true,externalAccess:true,isPublic:form.isPublic,visibility:form.isPublic?'public':'private',encryption:true},
      });
      setMeetings((current)=>[...current,meeting]);setShowCreate(false);setForm(defaultForm());setNotice('Réunion créée sur le serveur. Les invitations sont envoyées si Resend est configuré.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Création impossible.');}
  };

  const start=async(meeting:Meeting)=>{setBusyId(meeting.id);try{const result=await meetingService.startMeetingAndNotify(meeting.id);const live=result.meeting||{...meeting,is_active:true};setMeetings((current)=>current.map((item)=>item.id===meeting.id?live:item));navigate(`/reunions/${meeting.id}`,{state:{meeting:live}});}catch(cause){setError(cause instanceof Error?cause.message:'Démarrage impossible.');}finally{setBusyId(null);}};
  const join=async(meeting:Meeting)=>{setBusyId(meeting.id);try{if(!isHost(meeting)){const result=await meetingService.requestJoin(meeting.id);if(result.status==='requested'){navigate(`/reunions/${meeting.id}/salle-attente`,{state:{meeting}});return;}}navigate(`/reunions/${meeting.id}`,{state:{meeting}});}catch(cause){setError(cause instanceof Error?cause.message:'Accès impossible.');}finally{setBusyId(null);}};
  const remove=async(meeting:Meeting)=>{if(!window.confirm(`Annuler « ${meeting.title} » ?`))return;setBusyId(meeting.id);try{await meetingService.deleteMeeting(meeting.id);setMeetings((current)=>current.filter((item)=>item.id!==meeting.id));setNotice('Réunion annulée sur le serveur.');}catch(cause){setError(cause instanceof Error?cause.message:'Suppression impossible.');}finally{setBusyId(null);}};
  const copy=async(meeting:Meeting)=>{try{await navigator.clipboard.writeText(getMeetingJoinUrl(meeting));setNotice('Lien de réunion copié.');}catch{setError('Impossible de copier le lien.');}};

  return <section className="real-meeting-page">
    <header className="real-meeting-head"><div><h1>Réunions</h1><p>Planification et accès synchronisés avec PostgreSQL.</p></div><div><button className="secondary" onClick={()=>void load()}><RefreshCw size={17}/> Actualiser</button><button onClick={()=>setShowCreate(true)}><Plus size={17}/> Nouvelle réunion</button></div></header>
    {notice?<div className="real-meeting-notice">{notice}</div>:null}{error?<div className="real-meeting-error">{error}</div>:null}
    {loading?<div className="real-meeting-empty">Chargement des réunions…</div>:null}
    {!loading&&!sorted.length?<div className="real-meeting-empty"><Video size={42}/><h2>Aucune réunion</h2><p>Créez votre première réunion. Aucun contenu de démonstration n’est injecté.</p><button onClick={()=>setShowCreate(true)}><CalendarPlus size={17}/> Planifier</button></div>:null}
    <div className="real-meeting-grid">{sorted.map((meeting)=>{
      const host=isHost(meeting);const startAt=new Date(meeting.start_time);const ended=startAt.getTime()+meeting.duration*60000<Date.now()&&!meeting.is_active;
      return <article key={meeting.id} className="real-meeting-card"><div className="real-meeting-card-top"><span className={meeting.is_active?'live':''}>{meeting.is_active?'EN DIRECT':ended?'TERMINÉE':'PROGRAMMÉE'}</span>{host?<small>Vous êtes hôte</small>:<small>{meeting.host_name}</small>}</div><h2>{meeting.title}</h2>{meeting.description?<p>{meeting.description}</p>:null}<dl><div><dt><Clock3 size={15}/> Horaire</dt><dd>{formatDate(meeting.start_time)} · {meeting.duration} min</dd></div><div><dt><UsersRound size={15}/> Participants</dt><dd>{Math.max(1,meeting.participant_count||1)} · capacité {meeting.settings?.participantCapacity||'non limitée'}</dd></div><div><dt><Lock size={15}/> ID</dt><dd>{meeting.settings?.meetingAccessId||getMeetingAccessCode(meeting)}</dd></div><div><dt><Link2 size={15}/> Accès</dt><dd>{meeting.settings?.waitingRoom===false?'Entrée directe':'Salle d’attente'} · {meeting.settings?.chat===false?'chat coupé':'chat actif'}</dd></div></dl><div className="real-meeting-actions"><button className="secondary" onClick={()=>void copy(meeting)}><Copy size={16}/> Copier</button>{host&&!meeting.is_active&&!ended?<button onClick={()=>void start(meeting)} disabled={busyId===meeting.id}><Play size={16}/> Démarrer</button>:<button onClick={()=>void join(meeting)} disabled={busyId===meeting.id}><Video size={16}/> Rejoindre</button>}{host?<button className="danger" onClick={()=>void remove(meeting)} disabled={busyId===meeting.id}><Trash2 size={16}/></button>:null}</div></article>})}</div>

    {showCreate?<div className="real-meeting-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setShowCreate(false);}}><form className="real-meeting-form" onSubmit={createMeeting}><header><div><h2>Planifier une réunion</h2><p>Les identifiants et liens sécurisés sont générés côté serveur.</p></div><button type="button" onClick={()=>setShowCreate(false)}><X/></button></header><label>Titre<input required maxLength={160} value={form.title} onChange={(event)=>setForm((current)=>({...current,title:event.target.value}))}/></label><label>Description<textarea maxLength={1500} value={form.description} onChange={(event)=>setForm((current)=>({...current,description:event.target.value}))}/></label><div className="real-meeting-form-row"><label>Début<input required type="datetime-local" value={form.startTime} onChange={(event)=>setForm((current)=>({...current,startTime:event.target.value}))}/></label><label>Durée<select value={form.duration} onChange={(event)=>setForm((current)=>({...current,duration:Number(event.target.value)}))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 heure</option><option value={90}>1 h 30</option><option value={120}>2 heures</option></select></label></div><label>Invités (emails)<textarea placeholder="amina@example.com; paul@example.com" value={form.participants} onChange={(event)=>setForm((current)=>({...current,participants:event.target.value}))}/></label><label>Mot de passe facultatif<input type="password" value={form.password} onChange={(event)=>setForm((current)=>({...current,password:event.target.value}))}/></label><div className="real-meeting-options"><Check label="Salle d’attente" value={form.waitingRoom} set={(value)=>setForm((current)=>({...current,waitingRoom:value}))}/><Check label="Autoriser avant l’hôte" value={form.joinBeforeHost} set={(value)=>setForm((current)=>({...current,joinBeforeHost:value}))}/><Check label="Micro participants" value={form.participantAudio} set={(value)=>setForm((current)=>({...current,participantAudio:value}))}/><Check label="Caméra participants" value={form.participantVideo} set={(value)=>setForm((current)=>({...current,participantVideo:value}))}/><Check label="Partage d’écran" value={form.screenShare} set={(value)=>setForm((current)=>({...current,screenShare:value}))}/><Check label="Chat" value={form.chat} set={(value)=>setForm((current)=>({...current,chat:value}))}/><Check label="Réactions" value={form.reactions} set={(value)=>setForm((current)=>({...current,reactions:value}))}/><Check label="Résumé Luna" value={form.lunaSummary} set={(value)=>setForm((current)=>({...current,lunaSummary:value}))}/><Check label="Réunion publique" value={form.isPublic} set={(value)=>setForm((current)=>({...current,isPublic:value}))}/></div><footer><button type="button" className="secondary" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit"><CalendarPlus size={17}/> Créer sur le serveur</button></footer></form></div>:null}
  </section>;
}

function Check({label,value,set}:{label:string;value:boolean;set:(value:boolean)=>void}){return <label className="real-meeting-check"><input type="checkbox" checked={value} onChange={(event)=>set(event.target.checked)}/><span>{label}</span></label>;}
