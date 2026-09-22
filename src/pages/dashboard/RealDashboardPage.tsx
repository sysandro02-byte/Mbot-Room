import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  CheckCheck,
  Clock3,
  ContactRound,
  MessageCircle,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Video,
} from 'lucide-react';
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

  const load=async()=>{
    setLoading(true);
    setError('');
    try{
      const [meetingRows,notificationRows,tipRows]=await Promise.all([
        meetingService.getMeetings(),
        notificationService.list().catch(()=>[]),
        meetingService.getDashboardTips().catch(()=>[]),
      ]);
      setMeetings(Array.isArray(meetingRows)?meetingRows:[]);
      setNotifications(notificationRows);
      setTips(tipRows);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Impossible de charger le tableau de bord.');
    }finally{
      setLoading(false);
    }
  };
  useEffect(()=>{void load();},[]);

  const upcoming=useMemo(()=>meetings
    .filter((meeting)=>meeting.status!=='ended'&&meeting.status!=='cancelled'&&(meeting.is_active||new Date(meeting.start_time).getTime()+meeting.duration*60000>=Date.now()))
    .sort((a,b)=>new Date(a.start_time).getTime()-new Date(b.start_time).getTime())
    .slice(0,6),[meetings]);
  const live=useMemo(()=>meetings.filter((meeting)=>meeting.is_active),[meetings]);
  const hosted=useMemo(()=>meetings.filter((meeting)=>Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)),[meetings,user?.id]);
  const completed=useMemo(()=>meetings.filter((meeting)=>meeting.status==='ended'),[meetings]);
  const unread=notifications.filter((notification)=>!notification.readAt).length;
  const initials=(user?.name||user?.username||'MB').split(/s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('');

  const openMeeting=async(meeting:Meeting)=>{
    if(meeting.status==='ended'||meeting.status==='cancelled'){
      navigate('/reunions/'+meeting.meeting_link+'/terminee',{state:{meeting}});
      return;
    }
    const moderator=Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)||user?.role==='admin';
    if(moderator&&!meeting.is_active){
      try{
        const result=await meetingService.startMeetingAndNotify(meeting.id);
        navigate('/reunions/'+meeting.meeting_link,{state:{meeting:result.meeting||meeting}});
        return;
      }catch(cause){
        setError(cause instanceof Error?cause.message:'Démarrage impossible.');
        return;
      }
    }
    try{
      const numericUserId=Number(user?.id);
      const access=await meetingService.requestJoin(meeting.id,Number.isFinite(numericUserId)?numericUserId:undefined);
      if(access.status==='requested'){
        navigate('/reunions/'+meeting.meeting_link+'/salle-attente',{state:{meeting}});
        return;
      }
      navigate('/reunions/'+meeting.meeting_link,{state:{meeting}});
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Accès impossible.');
    }
  };

  const quickActions=[
    {label:'Nouvelle réunion',description:'Programmer ou démarrer',icon:Plus,path:'/app/meetings',primary:true},
    {label:'Rejoindre',description:'ID ou lien de réunion',icon:Video,path:'/join'},
    {label:'Calendrier',description:'Voir votre agenda',icon:CalendarDays,path:'/app/calendar'},
    {label:'Messages',description:'Conversations de réunion',icon:MessageCircle,path:'/app/messages'},
    {label:'Contacts',description:'Participants rencontrés',icon:ContactRound,path:'/app/contacts'},
    {label:'Recherche',description:'Trouver une réunion',icon:Search,path:'/app/search'},
  ];

  return <main className="real-dashboard">
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <span className="dashboard-eyebrow"><Sparkles size={14}/> Espace personnel MBotéRoom</span>
        <h1>Bonjour {user?.name||user?.username||'Utilisateur'}</h1>
        <p>Organisez vos réunions, retrouvez vos échanges et pilotez votre collaboration depuis un seul espace.</p>
        <div className="dashboard-hero-actions">
          <button onClick={()=>navigate('/app/meetings')}><Plus size={18}/> Créer une réunion</button>
          <button className="secondary" onClick={()=>navigate('/join')}><Video size={18}/> Rejoindre</button>
        </div>
      </div>
      <aside className="dashboard-profile-card">
        <div className="dashboard-avatar">{user?.avatar?<img src={user.avatar} alt=""/>:<span>{initials}</span>}</div>
        <div>
          <strong>{user?.name||user?.username}</strong>
          <small>{user?.email}</small>
          <span className="dashboard-role">{user?.role==='admin'?'Administrateur':user?.role==='guest'?'Invité':'Membre MBotéRoom'}</span>
        </div>
        <button onClick={()=>navigate('/app/profile')} aria-label="Ouvrir mon profil"><UserRound size={18}/></button>
      </aside>
    </section>

    {error?<div className="real-dashboard-error">{error}</div>:null}

    <section className="dashboard-quick-actions" aria-label="Actions rapides">
      {quickActions.map((action)=>{
        const Icon=action.icon;
        return <button key={action.label} className={action.primary?'is-primary':''} onClick={()=>navigate(action.path)}>
          <span><Icon size={20}/></span>
          <div><strong>{action.label}</strong><small>{action.description}</small></div>
        </button>;
      })}
    </section>

    <section className="real-dashboard-stats">
      <article><span><CalendarDays/></span><div><strong>{meetings.length}</strong><small>Réunions accessibles</small></div></article>
      <article><span><Video/></span><div><strong>{live.length}</strong><small>En direct</small></div></article>
      <article><span><UsersRound/></span><div><strong>{hosted.length}</strong><small>Organisées ou co-hébergées</small></div></article>
      <article><span><CheckCheck/></span><div><strong>{completed.length}</strong><small>Réunions terminées</small></div></article>
    </section>

    <section className="dashboard-security-card">
      <div className="dashboard-security-icon"><ShieldCheck/></div>
      <div>
        <strong>Connexion renforcée</strong>
        <p>À chaque connexion avec votre mot de passe, MBotéRoom envoie un code de sécurité à votre adresse e-mail.</p>
      </div>
      <button onClick={()=>navigate('/app/settings')}><Settings size={16}/> Paramètres</button>
    </section>

    {loading?<div className="real-dashboard-loading">Chargement de votre espace…</div>:null}

    {!loading?<section className="real-dashboard-columns">
      <article className="real-dashboard-card dashboard-upcoming-card">
        <div className="real-dashboard-card-title">
          <div><span>Agenda</span><h2>Prochaines réunions</h2></div>
          <button onClick={()=>navigate('/app/meetings')}>Tout voir</button>
        </div>
        {upcoming.length?upcoming.map((meeting)=><button className="real-dashboard-meeting" key={meeting.id} onClick={()=>void openMeeting(meeting)}>
          <span className={meeting.is_active?'live':''}><Video size={18}/></span>
          <div><strong>{meeting.title}</strong><small><Clock3 size={13}/>{formatDate(meeting.start_time)} · {meeting.duration} min</small></div>
          <b>{meeting.is_active?'Rejoindre':'Ouvrir'}</b>
        </button>):<p className="real-dashboard-empty">Aucune réunion programmée. Créez votre prochaine réunion en quelques secondes.</p>}
      </article>

      <article className="real-dashboard-card dashboard-notifications-card">
        <div className="real-dashboard-card-title">
          <div><span>Activité</span><h2>Notifications {unread?('· '+unread):''}</h2></div>
          {unread?<button onClick={()=>void notificationService.markAllRead().then(()=>setNotifications((current)=>current.map((item)=>({...item,readAt:item.readAt||new Date().toISOString()}))))}><CheckCheck size={15}/> Tout lire</button>:null}
        </div>
        {notifications.length?notifications.slice(0,8).map((notification)=><button className={'real-dashboard-notification '+(notification.readAt?'':'unread')} key={notification.id} onClick={()=>void notificationService.markRead(notification.id).then((updated)=>setNotifications((current)=>current.map((item)=>item.id===updated.id?updated:item)))}>
          <span><Bell size={16}/></span>
          <div><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatDate(notification.createdAt)}</small></div>
        </button>):<p className="real-dashboard-empty">Aucune notification pour le moment.</p>}
        <button className="dashboard-all-notifications" onClick={()=>navigate('/app/notifications')}>Voir toutes les notifications</button>
      </article>
    </section>:null}

    {tips.length?<section className="real-dashboard-tips">{tips.map((tip)=><article key={tip.id}><span><Sparkles size={16}/></span><div><strong>{tip.title}</strong><p>{tip.body}</p>{tip.actionLabel&&tip.actionPath?<button onClick={()=>navigate(tip.actionPath)}>{tip.actionLabel}</button>:null}</div></article>)}</section>:null}
  </main>;
}
