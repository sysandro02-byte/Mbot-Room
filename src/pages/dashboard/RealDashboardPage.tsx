import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, CheckCheck, Clock3, Plus, UsersRound, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { Meeting, meetingService } from '../../services/meetingService';
import { notificationService, RoomNotification } from '../../services/notificationService';
import './RealDashboardPage.css';

const formatDate=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export default function RealDashboardPage(){
  const navigate=useNavigate();
  const user=authService.getCurrentUser();
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [notifications,setNotifications]=useState<RoomNotification[]>([]);
  const [tips,setTips]=useState<Array<{id:string;title:string;body:string;actionLabel:string;actionPath:string}>>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=async()=>{setLoading(true);setError('');try{const [meetingRows,notificationRows,tipRows]=await Promise.all([meetingService.getMeetings(),notificationService.list().catch(()=>[]),meetingService.getDashboardTips().catch(()=>[])]);setMeetings(Array.isArray(meetingRows)?meetingRows:[]);setNotifications(notificationRows);setTips(tipRows);}catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger le tableau de bord.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);

  const upcoming=useMemo(()=>meetings.filter((meeting)=>new Date(meeting.start_time).getTime()+meeting.duration*60000>=Date.now()).sort((a,b)=>new Date(a.start_time).getTime()-new Date(b.start_time).getTime()).slice(0,6),[meetings]);
  const live=useMemo(()=>meetings.filter((meeting)=>meeting.is_active),[meetings]);
  const hosted=useMemo(()=>meetings.filter((meeting)=>Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)),[meetings,user?.id]);
  const unread=notifications.filter((notification)=>!notification.readAt).length;

  const openMeeting=async(meeting:Meeting)=>{const host=Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)||user?.role==='admin';if(host&&!meeting.is_active){try{const result=await meetingService.startMeetingAndNotify(meeting.id);navigate(`/reunions/${meeting.id}`,{state:{meeting:result.meeting||meeting}});return;}catch(cause){setError(cause instanceof Error?cause.message:'Démarrage impossible.');return;}}try{const numericUserId=Number(user?.id);const access=await meetingService.requestJoin(meeting.id,Number.isFinite(numericUserId)?numericUserId:undefined);if(access.status==='requested'){navigate(`/reunions/${meeting.id}/salle-attente`,{state:{meeting}});return;}navigate(`/reunions/${meeting.id}`,{state:{meeting}});}catch(cause){setError(cause instanceof Error?cause.message:'Accès impossible.');}};

  return <main className="real-dashboard">
    <header className="real-dashboard-head"><div><p>Bonjour {user?.name||user?.username||'Utilisateur'},</p><h1>Votre espace MBotéRoom</h1><span>Données chargées depuis le serveur, sans compteurs de démonstration.</span></div><div><button className="secondary" onClick={()=>navigate('/join')}><Video size={17}/> Rejoindre</button><button onClick={()=>navigate('/app/meetings')}><Plus size={17}/> Nouvelle réunion</button></div></header>
    {error?<div className="real-dashboard-error">{error}</div>:null}
    <section className="real-dashboard-stats"><article><span><CalendarDays/></span><div><strong>{meetings.length}</strong><small>Réunions accessibles</small></div></article><article><span><Video/></span><div><strong>{live.length}</strong><small>En direct</small></div></article><article><span><UsersRound/></span><div><strong>{hosted.length}</strong><small>Organisées par vous</small></div></article><article><span><Bell/></span><div><strong>{unread}</strong><small>Notifications non lues</small></div></article></section>
    {loading?<div className="real-dashboard-loading">Chargement…</div>:null}
    {!loading?<section className="real-dashboard-columns"><article className="real-dashboard-card"><div className="real-dashboard-card-title"><h2>Prochaines réunions</h2><button onClick={()=>navigate('/app/meetings')}>Tout voir</button></div>{upcoming.length?upcoming.map((meeting)=><button className="real-dashboard-meeting" key={meeting.id} onClick={()=>void openMeeting(meeting)}><span className={meeting.is_active?'live':''}><Video size={18}/></span><div><strong>{meeting.title}</strong><small><Clock3 size={13}/>{formatDate(meeting.start_time)} · {meeting.duration} min</small></div><b>{meeting.is_active?'Rejoindre':'Ouvrir'}</b></button>):<p className="real-dashboard-empty">Aucune réunion programmée.</p>}</article><article className="real-dashboard-card"><div className="real-dashboard-card-title"><h2>Notifications</h2>{unread?<button onClick={()=>void notificationService.markAllRead().then(()=>setNotifications((current)=>current.map((item)=>({...item,readAt:item.readAt||new Date().toISOString()}))))}><CheckCheck size={15}/> Tout lire</button>:null}</div>{notifications.length?notifications.slice(0,8).map((notification)=><button className={`real-dashboard-notification ${notification.readAt?'':'unread'}`} key={notification.id} onClick={()=>void notificationService.markRead(notification.id).then((updated)=>setNotifications((current)=>current.map((item)=>item.id===updated.id?updated:item)))}><span><Bell size={16}/></span><div><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatDate(notification.createdAt)}</small></div></button>):<p className="real-dashboard-empty">Aucune notification serveur.</p>}</article></section>:null}
    {tips.length?<section className="real-dashboard-tips">{tips.map((tip)=><article key={tip.id}><strong>{tip.title}</strong><p>{tip.body}</p>{tip.actionLabel&&tip.actionPath?<button onClick={()=>navigate(tip.actionPath)}>{tip.actionLabel}</button>:null}</article>)}</section>:null}
  </main>;
}
