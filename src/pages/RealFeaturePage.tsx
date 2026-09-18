import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Eraser, MessageCircle, Plus, Save, Search, Settings, Trash2, UserRound, UsersRound, Vote } from 'lucide-react';
import AppShell from '../components/AppShell';
import { authService } from '../services/authService';
import { appDataService, CalendarEvent, Contact, Preferences, Recording, Whiteboard, WhiteboardStroke } from '../services/appDataService';
import { collaborationService, MeetingMessage, MeetingPoll } from '../services/collaborationService';
import { Meeting, meetingService } from '../services/meetingService';
import './RealFeaturePage.css';

type FeatureKind = 'calendar' | 'recordings' | 'messages' | 'contacts' | 'whiteboard' | 'polls' | 'settings' | 'profile';
type Props = { kind: FeatureKind };

const titles: Record<FeatureKind,string> = {
  calendar:'Calendrier',recordings:'Enregistrements',messages:'Messages',contacts:'Contacts',whiteboard:'Tableau blanc',polls:'Sondages',settings:'Paramètres',profile:'Mon profil',
};
const icons: Record<FeatureKind,JSX.Element> = {
  calendar:<CalendarDays/>,recordings:<Download/>,messages:<MessageCircle/>,contacts:<UsersRound/>,whiteboard:<Eraser/>,polls:<Vote/>,settings:<Settings/>,profile:<UserRound/>,
};
const formatDate = (value:string) => new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const toLocalInput = (date:Date) => new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);

export default function RealFeaturePage({kind}:Props){
  const currentUser=authService.getCurrentUser();
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [selectedMeetingId,setSelectedMeetingId]=useState<number|undefined>();
  const [calendar,setCalendar]=useState<CalendarEvent[]>([]);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [recordings,setRecordings]=useState<Recording[]>([]);
  const [preferences,setPreferences]=useState<Preferences>({});
  const [messages,setMessages]=useState<MeetingMessage[]>([]);
  const [messageDraft,setMessageDraft]=useState('');
  const [polls,setPolls]=useState<MeetingPoll[]>([]);
  const [pollQuestion,setPollQuestion]=useState('');
  const [pollA,setPollA]=useState('');
  const [pollB,setPollB]=useState('');
  const [contactSearch,setContactSearch]=useState('');
  const [whiteboards,setWhiteboards]=useState<Whiteboard[]>([]);
  const [activeWhiteboard,setActiveWhiteboard]=useState<Whiteboard|null>(null);
  const [strokes,setStrokes]=useState<WhiteboardStroke[]>([]);
  const [brushColor,setBrushColor]=useState('#3156eb');
  const [profile,setProfile]=useState({name:currentUser?.name||'',username:currentUser?.username||'',avatar:currentUser?.avatar||'',phoneNumber:currentUser?.phoneNumber||'',organization:currentUser?.organization||'',jobTitle:currentUser?.jobTitle||''});
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const drawingRef=useRef<WhiteboardStroke|null>(null);

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setLoading(true);setError('');
      try{
        const meetingRows=await meetingService.getMeetings();
        if(cancelled)return;
        setMeetings(meetingRows);
        setSelectedMeetingId((current)=>current||meetingRows[0]?.id);
        if(kind==='calendar')setCalendar(await appDataService.getCalendar());
        if(kind==='contacts')setContacts(await appDataService.getContacts());
        if(kind==='recordings')setRecordings(await appDataService.getRecordings());
        if(kind==='settings')setPreferences(await appDataService.getPreferences());
        if(kind==='profile'){
          const result=await appDataService.getProfile();
          setProfile({name:result.user.name,username:result.user.username,avatar:result.user.avatar,phoneNumber:result.user.phoneNumber||'',organization:result.user.organization||'',jobTitle:result.user.jobTitle||''});
        }
        if(kind==='whiteboard'){
          const rows=await appDataService.getWhiteboards();setWhiteboards(rows);setActiveWhiteboard(rows[0]||null);setStrokes(rows[0]?.document?.strokes||[]);
        }
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'Chargement impossible.');}
      finally{if(!cancelled)setLoading(false);}
    };
    void load();return()=>{cancelled=true;};
  },[kind]);

  useEffect(()=>{
    if(!selectedMeetingId||!['messages','polls'].includes(kind))return;
    let cancelled=false;
    const load=async()=>{
      try{
        if(kind==='messages'){const rows=await collaborationService.getMessages(selectedMeetingId);if(!cancelled)setMessages(rows);}
        if(kind==='polls'){const rows=await collaborationService.getPolls(selectedMeetingId);if(!cancelled)setPolls(rows);}
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'Données indisponibles.');}
    };void load();return()=>{cancelled=true;};
  },[kind,selectedMeetingId]);

  useEffect(()=>{
    if(kind!=='whiteboard')return;
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{const rect=canvas.getBoundingClientRect();const scale=Math.max(1,window.devicePixelRatio||1);canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);drawBoard(canvas,strokes);};
    resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[kind,strokes]);

  const filteredContacts=useMemo(()=>{const query=contactSearch.trim().toLowerCase();return contacts.filter((contact)=>!query||contact.name.toLowerCase().includes(query)||contact.email.toLowerCase().includes(query)||contact.username.toLowerCase().includes(query));},[contactSearch,contacts]);

  const submitCalendar=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const form=new FormData(event.currentTarget);const title=String(form.get('title')||'').trim();const start=String(form.get('start')||'');const end=String(form.get('end')||'');if(!title||!start||!end)return;
    try{const created=await appDataService.createCalendarEvent({title,description:String(form.get('description')||''),startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()});setCalendar((current)=>[...current,created].sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()));event.currentTarget.reset();setNotice('Événement enregistré dans PostgreSQL.');}catch(cause){setError(cause instanceof Error?cause.message:'Création impossible.');}
  };

  const sendMessage=async(event:FormEvent)=>{event.preventDefault();if(!selectedMeetingId||!messageDraft.trim())return;try{const message=await collaborationService.sendMessage(selectedMeetingId,messageDraft.trim());setMessages((current)=>current.some((item)=>item.id===message.id)?current:[...current,message]);setMessageDraft('');}catch(cause){setError(cause instanceof Error?cause.message:'Message non envoyé.');}};

  const createPoll=async(event:FormEvent)=>{event.preventDefault();if(!selectedMeetingId||!pollQuestion.trim()||!pollA.trim()||!pollB.trim())return;try{const poll=await collaborationService.createPoll(selectedMeetingId,pollQuestion.trim(),[pollA.trim(),pollB.trim()]);setPolls((current)=>[poll,...current]);setPollQuestion('');setPollA('');setPollB('');}catch(cause){setError(cause instanceof Error?cause.message:'Sondage non créé.');}};

  const savePreferences=async(event:FormEvent)=>{event.preventDefault();try{const saved=await appDataService.updatePreferences(preferences);setPreferences(saved);setNotice('Paramètres enregistrés sur le serveur.');}catch(cause){setError(cause instanceof Error?cause.message:'Enregistrement impossible.');}};

  const saveProfile=async(event:FormEvent)=>{event.preventDefault();try{const result=await appDataService.updateProfile(profile);setProfile({...profile,...result.user});await authService.refreshCurrentUser();window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));setNotice('Profil mis à jour.');}catch(cause){setError(cause instanceof Error?cause.message:'Profil non enregistré.');}};

  const createWhiteboard=async()=>{try{const board=await appDataService.createWhiteboard({title:`Tableau ${whiteboards.length+1}`,document:{strokes:[]}});setWhiteboards((current)=>[board,...current]);setActiveWhiteboard(board);setStrokes([]);}catch(cause){setError(cause instanceof Error?cause.message:'Création impossible.');}};
  const saveWhiteboard=async()=>{try{let board=activeWhiteboard;if(!board){board=await appDataService.createWhiteboard({title:'Tableau blanc',document:{strokes}});}else{board=await appDataService.updateWhiteboard(board.id,{title:board.title,document:{strokes}});}setActiveWhiteboard(board);setWhiteboards((current)=>[board!,...current.filter((item)=>item.id!==board!.id)]);setNotice('Tableau enregistré dans PostgreSQL.');}catch(cause){setError(cause instanceof Error?cause.message:'Sauvegarde impossible.');}};
  const point=(event:ReactPointerEvent<HTMLCanvasElement>)=>{const canvas=canvasRef.current;if(!canvas)return null;const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};};
  const startStroke=(event:ReactPointerEvent<HTMLCanvasElement>)=>{const p=point(event);if(!p)return;event.currentTarget.setPointerCapture(event.pointerId);drawingRef.current={id:crypto.randomUUID(),color:brushColor,width:4,points:[p]};};
  const moveStroke=(event:ReactPointerEvent<HTMLCanvasElement>)=>{if(!drawingRef.current)return;const p=point(event);if(!p)return;drawingRef.current={...drawingRef.current,points:[...drawingRef.current.points,p]};setStrokes((current)=>[...current.filter((item)=>item.id!==drawingRef.current!.id),drawingRef.current!]);};
  const endStroke=(event:ReactPointerEvent<HTMLCanvasElement>)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drawingRef.current=null;};

  return <AppShell title={titles[kind]}>
    <section className="real-feature-page">
      <header className="real-feature-hero"><span>{icons[kind]}</span><div><h1>{titles[kind]}</h1><p>Données synchronisées avec le serveur MBotéRoom.</p></div></header>
      {notice?<div className="real-feature-notice">{notice}</div>:null}{error?<div className="real-feature-error">{error}</div>:null}
      {loading?<p className="real-feature-loading">Chargement…</p>:null}

      {!loading&&kind==='calendar'?<div className="real-feature-grid"><section className="real-card"><h2>Ajouter un événement</h2><form className="real-form" onSubmit={submitCalendar}><input name="title" required placeholder="Titre"/><textarea name="description" placeholder="Description"/><label>Début<input name="start" type="datetime-local" required defaultValue={toLocalInput(new Date(Date.now()+3600000))}/></label><label>Fin<input name="end" type="datetime-local" required defaultValue={toLocalInput(new Date(Date.now()+7200000))}/></label><button><Plus size={17}/> Enregistrer</button></form></section><section className="real-card"><h2>Agenda</h2>{calendar.length?calendar.map((event)=><article className="real-list-row" key={event.id}><div><strong>{event.title}</strong><small>{formatDate(event.starts_at)} → {formatDate(event.ends_at)}</small><p>{event.description}</p></div><button onClick={()=>void appDataService.deleteCalendarEvent(event.id).then(()=>setCalendar((current)=>current.filter((item)=>item.id!==event.id)))} aria-label="Supprimer"><Trash2 size={17}/></button></article>):<p>Aucun événement.</p>}</section></div>:null}

      {!loading&&kind==='recordings'?<section className="real-card"><h2>Enregistrements réellement disponibles</h2>{recordings.length?recordings.map((recording)=><article className="real-list-row" key={recording.id}><div><strong>{recording.title}</strong><small>{formatDate(recording.created_at)} · {Math.round(recording.size_bytes/1024/1024)} Mo · {Math.round(recording.duration_seconds/60)} min</small></div><a href={recording.storage_url} target="_blank" rel="noreferrer"><Download size={17}/> Ouvrir</a></article>):<p>Aucun enregistrement serveur n’a encore été déclaré. Les enregistrements locaux téléchargés dans une réunion restent sur l’appareil.</p>}</section>:null}

      {!loading&&kind==='contacts'?<section className="real-card"><div className="real-search"><Search size={17}/><input value={contactSearch} onChange={(event)=>setContactSearch(event.target.value)} placeholder="Rechercher un participant…"/></div><div className="real-contact-grid">{filteredContacts.map((contact)=><article key={contact.id}><span>{contact.avatar?<img src={contact.avatar} alt=""/>:contact.name.slice(0,2).toUpperCase()}</span><div><strong>{contact.name}</strong><small>@{contact.username} · {contact.email}</small></div></article>)}</div>{!filteredContacts.length?<p>Aucun contact issu de vos réunions.</p>:null}</section>:null}

      {!loading&&kind==='messages'?<section className="real-card"><MeetingSelector meetings={meetings} value={selectedMeetingId} onChange={setSelectedMeetingId}/><div className="real-messages">{messages.map((message)=><article key={message.id}><div><strong>{message.sender}</strong><small>{formatDate(message.time)}</small></div><p>{message.text}</p></article>)}</div><form className="real-message-form" onSubmit={sendMessage}><textarea value={messageDraft} onChange={(event)=>setMessageDraft(event.target.value)} placeholder="Message de réunion"/><button disabled={!selectedMeetingId||!messageDraft.trim()}><MessageCircle size={17}/> Envoyer</button></form></section>:null}

      {!loading&&kind==='polls'?<div className="real-feature-grid"><section className="real-card"><h2>Nouveau sondage</h2><MeetingSelector meetings={meetings} value={selectedMeetingId} onChange={setSelectedMeetingId}/><form className="real-form" onSubmit={createPoll}><input value={pollQuestion} onChange={(event)=>setPollQuestion(event.target.value)} placeholder="Question"/><input value={pollA} onChange={(event)=>setPollA(event.target.value)} placeholder="Option 1"/><input value={pollB} onChange={(event)=>setPollB(event.target.value)} placeholder="Option 2"/><button><Vote size={17}/> Créer</button></form></section><section className="real-card"><h2>Sondages de la réunion</h2>{polls.map((poll)=><article className="real-poll" key={poll.id}><strong>{poll.question}</strong>{poll.options.map((option)=><button key={option.id} disabled={!poll.isOpen} onClick={()=>selectedMeetingId&&void collaborationService.vote(selectedMeetingId,poll.id,option.id).then((updated)=>setPolls((current)=>current.map((item)=>item.id===updated.id?updated:item)))}><span>{option.label}</span><b>{option.votes}</b></button>)}</article>)}{!polls.length?<p>Aucun sondage.</p>:null}</section></div>:null}

      {!loading&&kind==='settings'?<section className="real-card"><h2>Préférences synchronisées</h2><form className="real-form" onSubmit={savePreferences}><label>Langue<select value={preferences.language||'fr'} onChange={(event)=>setPreferences((current)=>({...current,language:event.target.value}))}><option value="fr">Français</option><option value="en">English</option></select></label><label>Thème<select value={preferences.theme||'system'} onChange={(event)=>setPreferences((current)=>({...current,theme:event.target.value}))}><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></label><Toggle label="Micro actif par défaut" checked={preferences.defaultMic!==false} onChange={(value)=>setPreferences((current)=>({...current,defaultMic:value}))}/><Toggle label="Caméra active par défaut" checked={preferences.defaultCamera!==false} onChange={(value)=>setPreferences((current)=>({...current,defaultCamera:value}))}/><Toggle label="Notifications" checked={preferences.notifications!==false} onChange={(value)=>setPreferences((current)=>({...current,notifications:value}))}/><button><Save size={17}/> Enregistrer</button></form></section>:null}

      {!loading&&kind==='profile'?<section className="real-card"><h2>Informations du compte</h2><form className="real-form" onSubmit={saveProfile}><input value={profile.name} onChange={(event)=>setProfile((current)=>({...current,name:event.target.value}))} placeholder="Nom" required/><input value={profile.username} onChange={(event)=>setProfile((current)=>({...current,username:event.target.value}))} placeholder="Nom d’utilisateur" required/><input value={profile.phoneNumber} onChange={(event)=>setProfile((current)=>({...current,phoneNumber:event.target.value}))} placeholder="Téléphone"/><input value={profile.organization} onChange={(event)=>setProfile((current)=>({...current,organization:event.target.value}))} placeholder="Organisation"/><input value={profile.jobTitle} onChange={(event)=>setProfile((current)=>({...current,jobTitle:event.target.value}))} placeholder="Fonction"/><input value={profile.avatar} onChange={(event)=>setProfile((current)=>({...current,avatar:event.target.value}))} placeholder="URL de l’avatar"/><button><Save size={17}/> Mettre à jour</button></form></section>:null}

      {!loading&&kind==='whiteboard'?<section className="real-card real-whiteboard-card"><div className="real-whiteboard-toolbar"><select value={activeWhiteboard?.id||''} onChange={(event)=>{const board=whiteboards.find((item)=>item.id===event.target.value)||null;setActiveWhiteboard(board);setStrokes(board?.document?.strokes||[]);}}><option value="">Nouveau tableau</option>{whiteboards.map((board)=><option key={board.id} value={board.id}>{board.title}</option>)}</select><input type="color" value={brushColor} onChange={(event)=>setBrushColor(event.target.value)}/><button onClick={createWhiteboard}><Plus size={17}/> Nouveau</button><button onClick={()=>setStrokes([])}><Eraser size={17}/> Effacer</button><button onClick={saveWhiteboard}><Save size={17}/> Sauvegarder</button></div><canvas ref={canvasRef} onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke}/></section>:null}
    </section>
  </AppShell>;
}

function MeetingSelector({meetings,value,onChange}:{meetings:Meeting[];value?:number;onChange:(id:number|undefined)=>void}){return <label className="real-meeting-selector">Réunion<select value={value||''} onChange={(event)=>onChange(event.target.value?Number(event.target.value):undefined)}><option value="">Choisir une réunion</option>{meetings.map((meeting)=><option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}</select></label>;}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(value:boolean)=>void}){return <label className="real-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event)=>onChange(event.target.checked)}/></label>;}
function drawBoard(canvas:HTMLCanvasElement,strokes:WhiteboardStroke[]){const context=canvas.getContext('2d');if(!context)return;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.lineCap='round';context.lineJoin='round';for(const stroke of strokes){if(stroke.points.length<1)continue;context.strokeStyle=stroke.color;context.lineWidth=stroke.width*Math.max(1,window.devicePixelRatio||1);context.beginPath();stroke.points.forEach((point,index)=>{const x=point.x*canvas.width;const y=point.y*canvas.height;if(index===0)context.moveTo(x,y);else context.lineTo(x,y);});context.stroke();}}
