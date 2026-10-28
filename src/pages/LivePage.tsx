import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, CalendarDays, Camera, ChevronLeft, Eye, Gamepad2, Gift, Heart, LoaderCircle, Mic, Plus,
  MicOff, MonitorUp, MoreVertical, Music2, Radio, Search, Send, Share2, Sparkles, Square, UserPlus,
  UsersRound, Video, VideoOff, X,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import AppLoader from '../components/AppLoader';
import { authService } from '../services/authService';
import { collaborationService } from '../services/collaborationService';
import { mediaTransportService } from '../services/mediaTransportService';
import { liveCategoryLabel, liveMediaUrl, liveService, type LiveCategory, type LiveComment, type LiveParticipationRequest, type LiveSession, type LiveVisibility } from '../services/liveService';
import { socket } from '../lib/socket';
import { useMeetingLiveKit } from '../hooks/useMeetingLiveKit';
import { requestDisplayCapture } from './MeetingRoomV2';
import { cameraVideoConstraints, cameraResolutionLabel, type CameraQuality } from '../lib/videoQuality';
import './LivePage.css';

const categories:Array<{value:string;label:string;icon?:typeof Radio}>=[
  {value:'',label:'En direct',icon:Radio},{value:'trending',label:'Tendance'},{value:'business',label:'Business'},{value:'music',label:'Musique',icon:Music2},
  {value:'games',label:'Jeux',icon:Gamepad2},{value:'events',label:'Événements'},{value:'wellness',label:'Bien-être'},
  {value:'education',label:'Éducation'},{value:'tech',label:'Tech'},{value:'community',label:'Communauté'},
];

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'MB';
const fmtCount=(value:number)=>value>=1_000_000?(value/1_000_000).toFixed(1).replace('.0','')+'M':value>=1_000?(value/1_000).toFixed(1).replace('.0','')+'K':String(value||0);
const liveDuration=(startedAt:string|null)=>{
  if(!startedAt)return '';
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(startedAt).getTime())/1000));
  const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);const s=seconds%60;
  return [h,m,s].map((value)=>String(value).padStart(2,'0')).join(':');
};
const absoluteUrl=(path:string)=>path.startsWith('http')?path:window.location.origin+path;
type VideoQuality='auto'|'data-saver'|'standard'|'high'|'full-hd';
type NetworkInformationLike=EventTarget&{effectiveType?:string;saveData?:boolean;downlink?:number};
const networkInformation=()=>((navigator as Navigator&{connection?:NetworkInformationLike;mozConnection?:NetworkInformationLike;webkitConnection?:NetworkInformationLike}).connection||(navigator as Navigator&{mozConnection?:NetworkInformationLike}).mozConnection||(navigator as Navigator&{webkitConnection?:NetworkInformationLike}).webkitConnection);
const automaticQuality=():Exclude<VideoQuality,'auto'>=>{
  const connection=networkInformation();
  if(connection?.saveData||connection?.effectiveType==='slow-2g'||connection?.effectiveType==='2g'||(connection?.downlink||Infinity)<1.5)return 'data-saver';
  if(connection?.effectiveType==='3g'||(connection?.downlink||Infinity)<4)return 'standard';
  return 'high';
};
const videoConstraints=(quality:VideoQuality):MediaTrackConstraints=>{
  const resolved=quality==='auto'?automaticQuality():quality;
  const mapped:CameraQuality=resolved==='data-saver'?'economy':resolved==='high'?'hd':resolved==='full-hd'?'full-hd':'standard';
  return cameraVideoConstraints(mapped);
};

const validateCoverDimensions=(file:File)=>new Promise<void>((resolve,reject)=>{
  const image=new Image();
  const objectUrl=URL.createObjectURL(file);
  const cleanup=()=>URL.revokeObjectURL(objectUrl);
  image.onload=()=>{
    const valid=image.naturalWidth>=1280&&image.naturalHeight>=720;
    cleanup();
    valid?resolve():reject(new Error('Choisissez une image d’au moins 1280 × 720 px pour une couverture nette.'));
  };
  image.onerror=()=>{cleanup();reject(new Error('Cette image ne peut pas être lue.'));};
  image.src=objectUrl;
});

function Avatar({name,src,className=''}:{name:string;src?:string;className?:string}){
  return <span className={`live-avatar ${className}`}>{src?<img src={src} alt=""/>:initials(name)}</span>;
}

export function LiveFeedPage(){
  const navigate=useNavigate();
  const [items,setItems]=useState<LiveSession[]>([]);
  const [upcoming,setUpcoming]=useState<LiveSession[]>([]);
  const [q,setQ]=useState('');
  const [category,setCategory]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=async(quiet=false)=>{
    if(!quiet){setLoading(true);setError('');}
    try{
      const selectedCategory=category==='trending'?'':category;
      const [liveItems,allItems]=await Promise.all([
        liveService.getFeed({q,category:selectedCategory,mode:category==='trending'?'trending':'live'}),
        liveService.getFeed({q,category:selectedCategory,mode:'all'}),
      ]);
      setItems(liveItems.filter((item)=>item.status==='live'&&item.broadcastActive&&Boolean(item.startedAt)&&!item.endedAt));
      setUpcoming(allItems.filter((item)=>item.status==='scheduled'));
    }
    catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les Lives.');}
    finally{if(!quiet)setLoading(false);}
  };
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(),q?300:0);
    const refresh=window.setInterval(()=>void load(true),25_000);
    const onStatus=(payload:{liveId:string;status:string;broadcastActive?:boolean})=>{
      if(payload.status==='ended'||payload.broadcastActive===false){
        setItems((current)=>current.filter((item)=>item.id!==payload.liveId));
      }
      void load(true);
    };
    if(!socket.connected)socket.connect();
    socket.on('live:status',onStatus);
    return()=>{window.clearTimeout(timer);window.clearInterval(refresh);socket.off('live:status',onStatus);};
  },[q,category]);

  const featured=items[0]||null;
  const otherLive=items.slice(1);
  return <AppShell title="Live">
    <main className="live-feed-page">
      <header className="live-feed-hero">
        <div><span><Radio/></span><div><h1>Live</h1><p>Découvrez des directs, des idées et des expériences en temps réel.</p></div></div>
        <button onClick={()=>navigate('/app/live/new')}><Video/> Créer un live</button>
      </header>

      <section className="live-feed-search">
        <Search/>
        <input value={q} onChange={(event)=>setQ(event.target.value)} placeholder="Rechercher un live, un créateur, un sujet…"/>
      </section>

      <nav className="live-feed-categories" aria-label="Catégories Live">
        {categories.map((item)=>{
          const Icon=item.icon;
          return <button key={item.value||'all'} className={category===item.value?'active':''} onClick={()=>setCategory(item.value)}>
            {Icon?<Icon/>:null}{item.label}
          </button>;
        })}
      </nav>

      {error?<div className="live-error">{error}</div>:null}
      {!loading&&items.length===0?<section className="live-empty" data-testid="no-live-state"><Radio/><h2>Aucun direct en cours</h2><p>Un Live apparaît ici dès que l’animateur diffuse réellement sa vidéo. Les programmations restent dans la rubrique À venir.</p>{upcoming.length===0?<button onClick={()=>navigate('/app/live/new')}>Créer un Live</button>:null}</section>:null}
      {featured?<button className="live-featured-card" type="button" onClick={()=>navigate('/app/live/'+featured.id)}>
        <div className="live-featured-cover">
          {featured.coverUrl?<img src={liveMediaUrl(featured.coverUrl)} loading="lazy" decoding="async" alt=""/>:<span className="live-featured-fallback"><Radio size={42}/></span>}
          <span className="live-badge">EN DIRECT</span>
          <span className="live-viewers"><Eye size={15}/>{fmtCount(featured.viewerCount)}</span>
          <span className="live-featured-caption"><strong>{featured.title}</strong>
            <small>{featured.hostName} · {liveCategoryLabel(featured.category)}</small></span>
          <span className="live-featured-watch">▶ Regarder</span>
        </div>
      </button>:null}
      {otherLive.length?<header className="live-collection-heading"><h2>Lives en cours</h2><span>{otherLive.length} autre(s) direct(s)</span></header>:null}
      <section className="live-feed-grid">
        {otherLive.map((item)=><article key={item.id} className="live-feed-card" onClick={()=>navigate('/app/live/'+item.id)}>
          <div className="live-feed-cover">
            {item.coverUrl?<img src={liveMediaUrl(item.coverUrl)} alt="" loading="lazy" decoding="async"/>:<div className="live-cover-fallback"><Avatar name={item.hostName} src={item.hostAvatar}/><Radio/></div>}
            <span className={item.status==='live'?'live-badge':'live-badge scheduled'}>{item.status==='live'?'EN DIRECT':'PROGRAMMÉ'}</span>
            {item.status==='live'?<span className="live-viewers"><Eye/> {fmtCount(item.viewerCount)}</span>:<span className="live-scheduled-date"><CalendarDays/> {item.scheduledFor?new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(item.scheduledFor)):''}</span>}
          </div>
          <div className="live-feed-card-body">
            <div className="live-feed-host"><Avatar name={item.hostName} src={item.hostAvatar}/><div><strong>{item.hostName}</strong><small>{liveCategoryLabel(item.category)}</small></div></div>
            <h2>{item.title}</h2>
            <p>{item.description||'Rejoignez ce Live MBotéRoom.'}</p>
            <div className="live-feed-meta"><span><Heart/> {fmtCount(item.likeCount)}</span><span>{item.visibility==='public'?'Public':item.visibility==='followers'?'Abonnés':'Privé'}</span></div>
          </div>
        </article>)}
      </section>
      {upcoming.length?<section className="live-upcoming"><header className="live-collection-heading"><h2>À venir</h2><span>{upcoming.length} diffusion(s)</span></header>
        {upcoming.map((item)=><button key={item.id} type="button" className="live-upcoming-row" onClick={()=>navigate('/app/live/'+item.id)}>
          <span className="live-upcoming-date">{item.scheduledFor?new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short'}).format(new Date(item.scheduledFor)):'Bientôt'}</span>
          <span><strong>{item.title}</strong><small>{item.scheduledFor?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.scheduledFor)):'Date à confirmer'} · {item.hostName}</small></span>
          <CalendarDays size={19}/>
        </button>)}
      </section>:null}
      <button className="live-create-fab" type="button" onClick={()=>navigate('/app/live/new')} aria-label="Créer un live"><Plus size={23}/><span>Créer un live</span></button>
      {loading?<AppLoader label="Chargement des Lives…"/>:null}
    </main>
  </AppShell>;
}

export function LiveCreatePage(){
  const navigate=useNavigate();
  const user=authService.getCurrentUser();
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [category,setCategory]=useState<LiveCategory>('business');
  const [visibility,setVisibility]=useState<LiveVisibility>('public');
  const [coverUrl,setCoverUrl]=useState('');
  const [scheduleLater,setScheduleLater]=useState(false);
  const [date,setDate]=useState(()=>new Date(Date.now()+3600_000).toISOString().slice(0,10));
  const [time,setTime]=useState(()=>new Date(Date.now()+3600_000).toTimeString().slice(0,5));
  const [chatEnabled,setChatEnabled]=useState(true);
  const [cohostsEnabled,setCohostsEnabled]=useState(false);
  const [recordingEnabled,setRecordingEnabled]=useState(true);
  const [moderationEnabled,setModerationEnabled]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  const uploadCover=async(file:File|null)=>{
    if(!file)return;
    setBusy('cover');setError('');
    try{
      await validateCoverDimensions(file);
      const uploaded=await liveService.uploadCover(file);
      setCoverUrl(uploaded.url);
    }catch(cause){setError(cause instanceof Error?cause.message:'Téléversement de la couverture impossible.');}
    finally{setBusy('');}
  };

  const submit=async(startNow:boolean,forceSchedule=false)=>{
    if(!title.trim()){setError('Ajoutez un titre au Live.');return;}
    setBusy(startNow?'start':'schedule');setError('');
    try{
      const shouldSchedule=scheduleLater||forceSchedule;
      const scheduleDate=shouldSchedule?new Date(`${date}T${time}`):null;
      if(scheduleDate&&(!Number.isFinite(scheduleDate.getTime())||scheduleDate.getTime()<=Date.now()+60_000)){
        throw new Error('Choisissez une date et une heure futures pour programmer le Live.');
      }
      const scheduledFor=scheduleDate?.toISOString();
      const created=await liveService.createLive({
        title:title.trim(),description:description.trim(),category,visibility,coverUrl:coverUrl.trim(),
        scheduledFor,startNow:startNow&&!shouldSchedule,chatEnabled,cohostsEnabled,recordingEnabled,moderationEnabled,
      });
      navigate(startNow&&!shouldSchedule?'/app/live/'+created.id:'/app/live');
    }catch(cause){setError(cause instanceof Error?cause.message:'Création du Live impossible.');}
    finally{setBusy('');}
  };

  if(user?.isGuest)return <AppShell title="Créer un Live"><main className="live-create-page"><section className="live-empty"><Radio/><h2>Compte requis</h2><p>Créez un compte MBotéRoom pour lancer vos propres Lives.</p></section></main></AppShell>;

  return <AppShell title="Créer un Live">
    <main className="live-create-page">
      <header className="live-create-header"><button onClick={()=>navigate('/app/live')}><ChevronLeft/></button><h1>Créer un live</h1></header>
      <section className="live-create-card">
        <div className="live-cover-editor">
          {coverUrl?<img src={liveMediaUrl(coverUrl)} alt="Couverture du Live" decoding="async"/>:<div><Camera/><strong>Ajouter une couverture du live</strong><small>JPG, PNG ou WebP · au moins 1280 × 720 px · 5 Mo maximum.</small></div>}
          <label className="live-cover-upload">
            {busy==='cover'?<LoaderCircle className="spin"/>:<Camera/>}
            <span>{busy==='cover'?'Téléversement…':coverUrl?'Changer la couverture':'Choisir une couverture'}</span>
            <input aria-label="Choisir une couverture" type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event)=>void uploadCover(event.target.files?.[0]||null)}/>
          </label>
        </div>

        {error?<div className="live-error">{error}</div>:null}
        <label>Titre du live *<input maxLength={100} value={title} onChange={(event)=>setTitle(event.target.value)} placeholder="Ex. Parler de son parcours, astuces, Q&R…"/><small>{title.length}/100</small></label>
        <label>Description<textarea maxLength={500} value={description} onChange={(event)=>setDescription(event.target.value)} placeholder="Décrivez votre live…"/><small>{description.length}/500</small></label>
        <label>Catégorie *<select value={category} onChange={(event)=>setCategory(event.target.value as LiveCategory)}>{categories.filter((item)=>item.value&&item.value!=='trending').map((item)=><option value={item.value} key={item.value}>{item.label}</option>)}</select></label>

        <fieldset className="live-visibility"><legend>Visibilité *</legend>
          {([
            ['public','Public','Tout le monde'],['private','Privé','Sur invitation'],['followers','Abonnés','Mes abonnés'],
          ] as Array<[LiveVisibility,string,string]>).map(([value,label,caption])=><button type="button" key={value} className={visibility===value?'active':''} aria-pressed={visibility===value} onClick={()=>setVisibility(value)}><strong>{label}</strong><small>{caption}</small></button>)}
        </fieldset>

        <div className="live-option schedule"><div><CalendarDays/><span><strong>Programmer pour plus tard</strong><small>Choisissez la date et l’heure du direct.</small></span></div><button className={scheduleLater?'switch on':'switch'} type="button" role="switch" aria-label="Programmer pour plus tard" aria-checked={scheduleLater} onClick={()=>setScheduleLater((value)=>!value)}><i/></button></div>
        {scheduleLater?<div className="live-schedule-fields"><label>Date<input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></label><label>Heure<input type="time" value={time} onChange={(event)=>setTime(event.target.value)}/></label></div>:null}

        <section className="live-options">
          {[
            {label:'Activer le chat',caption:'Commentaires en temps réel',value:chatEnabled,set:setChatEnabled,icon:Send},
            {label:'Inviter des co-animateurs',caption:'Permettre les demandes de participation',value:cohostsEnabled,set:setCohostsEnabled,icon:UsersRound},
            {label:'Enregistrer le live',caption:'Replay via LiveKit + stockage MBotéRoom',value:recordingEnabled,set:setRecordingEnabled,icon:Video},
            {label:'Mode modération',caption:'Outils de suppression et contrôle du chat',value:moderationEnabled,set:setModerationEnabled,icon:Bell},
          ].map((item)=>{const Icon=item.icon;return <div className="live-option" key={item.label}><div><Icon/><span><strong>{item.label}</strong><small>{item.caption}</small></span></div><button className={item.value?'switch on':'switch'} type="button" role="switch" aria-label={item.label} aria-checked={item.value} onClick={()=>item.set(!item.value)}><i/></button></div>;})}
        </section>

        <button className="live-primary-action" disabled={Boolean(busy)} onClick={()=>void submit(true)}>{busy==='start'?<LoaderCircle className="spin"/>:<Radio/>}{scheduleLater?'Créer le Live':'Lancer le live'}</button>
        <button className="live-secondary-action" disabled={Boolean(busy)} onClick={()=>void submit(false,true)}>{busy==='schedule'?<LoaderCircle className="spin"/>:<CalendarDays/>} Programmer</button>
      </section>
    </main>
  </AppShell>;
}

export function LiveRoomPage(){
  const {liveId=''}=useParams();
  const navigate=useNavigate();
  const location=useLocation();
  const inviteToken=new URLSearchParams(location.search).get('invite')||'';
  const user=authService.getCurrentUser();
  const [live,setLive]=useState<LiveSession|null>(null);
  const [comments,setComments]=useState<LiveComment[]>([]);
  const [requests,setRequests]=useState<LiveParticipationRequest[]>([]);
  const [inviteOpen,setInviteOpen]=useState(false);
  const [inviteEmail,setInviteEmail]=useState('');
  const [joinRole,setJoinRole]=useState<'host'|'cohost'|'viewer'>('viewer');
  const [joined,setJoined]=useState(false);
  const [localStream,setLocalStream]=useState<MediaStream|null>(null);
  const [captureResolution,setCaptureResolution]=useState('Résolution automatique');
  const cameraStreamRef=useRef<MediaStream|null>(null);
  // Preserve mute preferences when the capture stream is recreated.
  const cameraPreferencesRef=useRef({audio:true,video:true});
  const screenStreamRef=useRef<MediaStream|null>(null);
  const [media,setMedia]=useState({audio:true,video:true,screen:false});
  const [videoQuality,setVideoQuality]=useState<VideoQuality>('auto');
  const [networkQuality,setNetworkQuality]=useState<Exclude<VideoQuality,'auto'>>(()=>automaticQuality());
  const [commentText,setCommentText]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const [mediaSessionKey,setMediaSessionKey]=useState(0);
  const [duration,setDuration]=useState('');
  const [summary,setSummary]=useState<{bullets:string[];decisions:string[];actions:string[]}|null>(null);
  const [hostPanel,setHostPanel]=useState<'public'|'comments'|'moderation'>('comments');
  const [moreOpen,setMoreOpen]=useState(false);
  const recordingIdRef=useRef('');
  const recordingAttemptRef=useRef(false);
  const sharePendingRef=useRef(false);
  const [sharePending,setSharePending]=useState(false);
  const [recordingError,setRecordingError]=useState('');
  const [recordingSetupRequired,setRecordingSetupRequired]=useState(false);
  const [recordingChecking,setRecordingChecking]=useState(false);
  const [confirmEndOpen,setConfirmEndOpen]=useState(false);
  const mediaRetryAttemptsRef=useRef(0);
  const localVideoRef=useRef<HTMLVideoElement|null>(null);
  const remoteVideoRef=useRef<HTMLVideoElement|null>(null);
  const publisher=joinRole==='host'||joinRole==='cohost';
  const activeVideoQuality=videoQuality==='auto'?networkQuality:videoQuality;

  const liveKit=useMeetingLiveKit({
    meetingId:live?.meetingId||0,
    localStream:publisher?localStream:null,
    screenStream:screenStreamRef.current,
    media:publisher?media:{audio:false,video:false,screen:false},
    enabled:Boolean(joined&&live?.status==='live'&&live?.meetingId),
    sessionKey:mediaSessionKey,
    onFailure:(message)=>setError(message),
    onNotice:(message)=>setNotice(message),
  });

  const hostRemote=useMemo(()=>liveKit.remoteParticipants.find((participant)=>String(participant.userId)===String(live?.hostId))||liveKit.remoteParticipants[0]||null,[liveKit.remoteParticipants,live?.hostId]);

  useEffect(()=>{
    if(liveKit.connected){
      mediaRetryAttemptsRef.current=0;
      return;
    }
    if(!joined||live?.status!=='live'||!liveKit.failed||mediaRetryAttemptsRef.current>=3)return;
    const attempt=mediaRetryAttemptsRef.current+1;
    const timer=window.setTimeout(()=>{
      mediaRetryAttemptsRef.current=attempt;
      setError('');
      setNotice(`Reconnexion au serveur média (${attempt}/3)…`);
      setMediaSessionKey((value)=>value+1);
    },attempt===1?1200:2500);
    return()=>window.clearTimeout(timer);
  },[joined,live?.status,liveKit.connected,liveKit.failed]);

  useEffect(()=>{
    if(!joined||live?.status!=='live')return;
    const retryAfterNetworkReturn=()=>{
      if(!liveKit.failed)return;
      mediaRetryAttemptsRef.current=0;
      setError('');
      setMediaSessionKey((value)=>value+1);
    };
    const onVisibility=()=>{if(document.visibilityState==='visible')retryAfterNetworkReturn();};
    window.addEventListener('online',retryAfterNetworkReturn);
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{
      window.removeEventListener('online',retryAfterNetworkReturn);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[joined,live?.status,liveKit.failed]);

  useEffect(()=>{
    const connection=networkInformation();
    if(!connection)return;
    const update=()=>setNetworkQuality(automaticQuality());
    connection.addEventListener('change',update);
    return()=>connection.removeEventListener('change',update);
  },[]);

  useEffect(()=>{
    if(!localVideoRef.current)return;
    localVideoRef.current.srcObject=localStream;
    void localVideoRef.current.play().catch(()=>undefined);
  },[localStream]);
  useEffect(()=>{
    if(!remoteVideoRef.current)return;
    remoteVideoRef.current.srcObject=hostRemote?.stream||null;
    void remoteVideoRef.current.play().catch(()=>undefined);
  },[hostRemote?.stream]);

  useEffect(()=>{
    let active=true;
    const init=async()=>{
      setError('');
      try{
        const detail=await liveService.getLive(liveId,inviteToken);
        if(!active)return;
        setLive(detail);
        setComments(await liveService.getComments(liveId,inviteToken).catch(()=>[]));
        if(detail.status==='live'){
          const joinedResult=await liveService.join(liveId,inviteToken);
          if(!active)return;
          setJoinRole(joinedResult.role);setJoined(true);
        }
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:'Impossible d’ouvrir ce Live.');}
    };
    void init();
    return()=>{active=false;void liveService.leave(liveId).catch(()=>undefined);};
  },[liveId,inviteToken]);

  useEffect(()=>{
    if(!joined||!live)return;
    const token=authService.getToken();
    socket.auth=token?{token}:{};
    const joinRealtime=()=>socket.emit('live:join',{liveId,inviteToken});
    const onComment=(comment:LiveComment)=>setComments((current)=>current.some((item)=>item.id===comment.id)?current:[...current,comment].slice(-150));
    const onDeleted=(payload:{commentId:string})=>setComments((current)=>current.filter((item)=>item.id!==payload.commentId));
    const onPresence=(payload:{viewerCount:number})=>setLive((current)=>current?{...current,viewerCount:Number(payload.viewerCount||0)}:current);
    const onLikes=(payload:{likeCount:number})=>setLive((current)=>current?{...current,likeCount:Number(payload.likeCount||0)}:current);
    const onStatus=(payload:{status:string;broadcastActive?:boolean;startedAt?:string;endedAt?:string})=>setLive((current)=>current?{...current,status:payload.status,broadcastActive:payload.broadcastActive??current.broadcastActive,startedAt:payload.startedAt||current.startedAt,endedAt:payload.endedAt||current.endedAt}:current);
    const onSettings=(payload:{chatEnabled:boolean;cohostsEnabled:boolean;moderationEnabled:boolean})=>setLive((current)=>current?{...current,...payload}:current);
    const onRequest=()=>{if(live.isHost)void liveService.getParticipationRequests(liveId).then(setRequests).catch(()=>undefined);};
    const onReaction=(payload:{name:string;reaction:string})=>setNotice(`${payload.name} ${payload.reaction}`);
    const onGift=(payload:{name:string;giftType:string;giftCount:number})=>{
      setLive((current)=>current?{...current,giftCount:Number(payload.giftCount||current.giftCount||0)}:current);
      setNotice(`${payload.name} a envoyé un cadeau ✨`);
    };
    const onParticipation=(payload:{status:string})=>{
      if(payload.status==='accepted'){
        setNotice('Votre demande a été acceptée. Activation de votre caméra et micro…');
        setJoinRole('cohost');
        setMediaSessionKey((value)=>value+1);
      }else setNotice('Votre demande de participation n’a pas été retenue.');
    };
    socket.on('connect',joinRealtime).on('live:comment',onComment).on('live:comment-deleted',onDeleted).on('live:presence',onPresence).on('live:likes',onLikes).on('live:status',onStatus).on('live:settings',onSettings).on('live:reaction',onReaction).on('live:gift',onGift).on('live:participation-request',onRequest).on('live:participation-response',onParticipation);
    if(socket.connected)joinRealtime();else socket.connect();
    const heartbeat=window.setInterval(()=>{if(!live.isHost)void liveService.heartbeat(liveId).catch(()=>undefined);},45_000);
    return()=>{
      window.clearInterval(heartbeat);
      socket.emit('live:leave',{liveId});
      socket.off('connect',joinRealtime).off('live:comment',onComment).off('live:comment-deleted',onDeleted).off('live:presence',onPresence).off('live:likes',onLikes).off('live:status',onStatus).off('live:settings',onSettings).off('live:reaction',onReaction).off('live:gift',onGift).off('live:participation-request',onRequest).off('live:participation-response',onParticipation);
    };
  },[joined,live?.isHost,liveId]);

  useEffect(()=>{
    if(!joined||!live?.isHost||live.status!=='live')return undefined;
    const broadcast=()=>void liveService.heartbeat(liveId,{broadcasting:liveKit.videoPublished})
      .then((result)=>setLive((current)=>current?{...current,broadcastActive:result.broadcastActive}:current))
      .catch(()=>undefined);
    broadcast();
    const timer=window.setInterval(broadcast,20_000);
    return()=>{window.clearInterval(timer);if(liveKit.videoPublished)void liveService.heartbeat(liveId,{broadcasting:false}).catch(()=>undefined);};
  },[joined,live?.isHost,live?.status,liveId,liveKit.videoPublished]);

  useEffect(()=>{
    if(!publisher||live?.status!=='live'){
      screenStreamRef.current?.getTracks().forEach((track)=>track.stop());screenStreamRef.current=null;
      cameraStreamRef.current?.getTracks().forEach((track)=>track.stop());cameraStreamRef.current=null;setLocalStream(null);return;
    }
    let cancelled=false;
    let captured:MediaStream|null=null;
    void navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:videoConstraints(videoQuality),
    }).then((stream)=>{
      if(cancelled){stream.getTracks().forEach((track)=>track.stop());return;}
      captured=stream;
      cameraStreamRef.current=stream;
      stream.getAudioTracks().forEach((track)=>{track.enabled=cameraPreferencesRef.current.audio;});
      stream.getVideoTracks().forEach((track)=>{track.enabled=cameraPreferencesRef.current.video;});
      if(!screenStreamRef.current)setLocalStream(stream);
      setCaptureResolution(cameraResolutionLabel(stream.getVideoTracks()[0]));
    }).catch(async(cause)=>{
      if(cancelled)return;
      if(videoQuality==='full-hd'||videoQuality==='high'){
        try{
          const stream=await navigator.mediaDevices.getUserMedia({
            audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
            video:cameraVideoConstraints('standard'),
          });
          if(cancelled){stream.getTracks().forEach((track)=>track.stop());return;}
          captured=stream;cameraStreamRef.current=stream;
          stream.getAudioTracks().forEach((track)=>{track.enabled=cameraPreferencesRef.current.audio;});
          stream.getVideoTracks().forEach((track)=>{track.enabled=cameraPreferencesRef.current.video;});
          if(!screenStreamRef.current)setLocalStream(stream);
          setCaptureResolution(cameraResolutionLabel(stream.getVideoTracks()[0]));
          setNotice('La caméra utilise une résolution compatible avec votre appareil.');
          return;
        }catch{/* Hardware fallback failed; preserve original error. */}
      }
      setError(cause instanceof Error ? `Caméra ou micro indisponible : ${cause.message}` : 'Autorisez la caméra et le microphone pour diffuser.');
    });
    return()=>{cancelled=true;captured?.getTracks().forEach((track)=>track.stop());};
  },[publisher,live?.status,videoQuality,networkQuality]);

  useEffect(()=>{
    if(!live?.startedAt||live.status!=='live')return;
    const tick=()=>setDuration(liveDuration(live.startedAt));
    tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer);
  },[live?.startedAt,live?.status]);

  const startLiveRecording=async(meetingId:number)=>{
    if(recordingIdRef.current||recordingAttemptRef.current)return;
    recordingAttemptRef.current=true;
    setRecordingChecking(true);
    setRecordingError('');
    setRecordingSetupRequired(false);
    try{
      // Egress is a server capability. Avoid repeatedly sending a request
      // that must fail until the operator configures recording and storage.
      const capabilities=await mediaTransportService.getStatus();
      if(!capabilities.serverRecordingReady){
        setRecordingSetupRequired(true);
        setRecordingError('LiveKit Egress et son stockage doivent être configurés sur le serveur. La diffusion reste active sans replay.');
        return;
      }
      const recording=await collaborationService.startServerRecording(meetingId,{layout:'speaker'});
      if(!recording.id)throw new Error('Le serveur n’a pas renvoyé de référence d’enregistrement.');
      recordingIdRef.current=recording.id;
      setNotice('Replay : enregistrement serveur actif.');
    }catch(cause){
      setRecordingError(cause instanceof Error?cause.message:'Le démarrage du replay a échoué.');
    }finally{
      setRecordingChecking(false);
    }
  };

  useEffect(()=>{
    if(!live?.isHost||!live.recordingEnabled||!joined||!liveKit.connected||recordingIdRef.current)return;
    void startLiveRecording(live.meetingId);
  },[joined,live?.isHost,live?.recordingEnabled,live?.meetingId,liveKit.connected]);

  useEffect(()=>()=>{
    screenStreamRef.current?.getTracks().forEach((track)=>track.stop());
    cameraStreamRef.current?.getTracks().forEach((track)=>track.stop());
  },[]);

  const retryMedia=()=>{
    mediaRetryAttemptsRef.current=0;
    setError('');
    setNotice('Nouvelle tentative de connexion au serveur média…');
    setMediaSessionKey((value)=>value+1);
  };
  const startLive=async()=>{
    if(!live)return;setBusy('start');
    try{const updated=await liveService.start(live.id);setLive(updated);const joinedResult=await liveService.join(live.id,inviteToken);setJoinRole(joinedResult.role);setJoined(true);}
    catch(cause){setError(cause instanceof Error?cause.message:'Impossible de lancer le Live.');}
    finally{setBusy('');}
  };
  const endLive=async()=>{
    if(!live||busy==='end')return;
    setConfirmEndOpen(false);
    setBusy('end');
    try{
      if(recordingIdRef.current)await collaborationService.stopServerRecording(live.meetingId,recordingIdRef.current).catch(()=>undefined);
      await liveService.end(live.id);setLive((current)=>current?{...current,status:'ended',viewerCount:0}:current);setJoined(false);
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de terminer le Live.');}
    finally{setBusy('');}
  };
  const toggleMic=()=>{
    const tracks=cameraStreamRef.current?.getAudioTracks()||[];
    if(!tracks.length){setNotice('Le microphone n’est pas encore disponible.');return;}
    const enabled=!cameraPreferencesRef.current.audio;
    cameraPreferencesRef.current.audio=enabled;
    tracks.forEach((track)=>{track.enabled=enabled;});setMedia((current)=>({...current,audio:enabled}));
  };
  const toggleCamera=()=>{
    if(media.screen){setNotice('Arrêtez le partage avant de modifier la caméra.');return;}
    const tracks=cameraStreamRef.current?.getVideoTracks()||[];
    if(!tracks.length){setNotice('La caméra n’est pas encore disponible.');return;}
    const enabled=!cameraPreferencesRef.current.video;
    cameraPreferencesRef.current.video=enabled;
    tracks.forEach((track)=>{track.enabled=enabled;});setMedia((current)=>({...current,video:enabled}));
  };
  const stopLiveScreenShare=()=>{
    const capture=screenStreamRef.current;
    screenStreamRef.current=null;
    // Only stop capture tracks. Microphone belongs to cameraStreamRef and must
    // survive a screen-share toggle.
    capture?.getTracks().forEach((track)=>track.stop());
    try{window.MBoteRoomAndroid?.stopScreenCapture?.();}catch{/* native bridge optional */}
    setLocalStream(cameraStreamRef.current);
    setMedia((current)=>({...current,screen:false,video:Boolean(cameraStreamRef.current?.getVideoTracks().some((track)=>track.enabled))}));
  };
  const shareScreen=async()=>{
    if(sharePendingRef.current)return;
    if(media.screen){stopLiveScreenShare();return;}
    sharePendingRef.current=true;setSharePending(true);
    try{
      // Browser capture permissions require a user gesture. Do not insert an
      // asynchronous dynamic import between the button click and the request.
      const display=await requestDisplayCapture();
      const video=display.getVideoTracks()[0];
      if(!video)throw new Error('Aucun écran sélectionné.');
      const mic=cameraStreamRef.current?.getAudioTracks().filter((track)=>track.readyState==='live')||[];
      const stream=new MediaStream([...display.getTracks(),...mic]);
      screenStreamRef.current=display;
      video.addEventListener('ended',stopLiveScreenShare,{once:true});
      setLocalStream(stream);
      setMedia((current)=>({...current,screen:true,video:true}));
      setNotice('Partage d’écran démarré.');
    }catch(cause){
      const name=cause instanceof DOMException?cause.name:'';
      setNotice(name==='NotAllowedError'||name==='AbortError'
        ? 'Partage d’écran annulé ou non autorisé.'
        : cause instanceof Error?cause.message:'Partage d’écran indisponible sur cet appareil.');
    }finally{sharePendingRef.current=false;setSharePending(false);}
  };
  const sendComment=async(event:FormEvent)=>{
    event.preventDefault();if(!commentText.trim()||!live)return;
    try{await liveService.comment(live.id,commentText.trim(),inviteToken);setCommentText('');}catch(cause){setNotice(cause instanceof Error?cause.message:'Commentaire impossible.');}
  };
  const like=async()=>{if(!live)return;try{const result=await liveService.toggleLike(live.id,inviteToken);setLive((current)=>current?{...current,isLiked:result.liked,likeCount:result.likeCount}:current);}catch(cause){setNotice(cause instanceof Error?cause.message:'Réaction impossible.');}};
  const share=async()=>{
    if(!live)return;
    try{
      const result=await liveService.share(live.id,inviteToken);const url=absoluteUrl(result.url);
      setLive((current)=>current?{...current,shareCount:result.shareCount}:current);
      if(navigator.share)await navigator.share({title:live.title,text:'Rejoignez ce Live MBotéRoom',url});
      else{await navigator.clipboard.writeText(url);setNotice('Lien du Live copié.');}
    }catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))setNotice(cause instanceof Error?cause.message:'Partage impossible.');}
  };
  const follow=async()=>{if(!live)return;try{const result=await liveService.toggleFollow(live.id);setLive((current)=>current?{...current,isFollowing:result.following}:current);}catch(cause){setNotice(cause instanceof Error?cause.message:'Abonnement impossible.');}};
  const sendGift=async()=>{
    if(!live)return;
    try{
      const result=await liveService.sendGift(live.id,'star',inviteToken);
      setLive((current)=>current?{...current,giftCount:result.giftCount}:current);
      setNotice('Cadeau envoyé ✨');
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Cadeau impossible.');}
  };
  const sendInvite=async(event:FormEvent)=>{
    event.preventDefault();
    if(!live||!inviteEmail.trim())return;
    setBusy('invite');
    try{
      const result=await liveService.invite(live.id,inviteEmail.trim());
      setNotice(result.registered?'Invitation envoyée dans MBotéRoom et par e-mail.':'Invitation envoyée par e-mail.');
      setInviteEmail('');setInviteOpen(false);
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Invitation impossible.');}
    finally{setBusy('');}
  };
  const requestParticipation=async()=>{if(!live)return;try{await liveService.requestParticipation(live.id,inviteToken);setNotice('Demande envoyée à l’animateur.');}catch(cause){setNotice(cause instanceof Error?cause.message:'Demande impossible.');}};
  const toggleChat=async()=>{if(!live)return;try{const updated=await liveService.updateSettings(live.id,{chatEnabled:!live.chatEnabled});setLive(updated);setNotice(updated.chatEnabled?'Chat activé.':'Chat mis en sourdine.');}catch(cause){setNotice(cause instanceof Error?cause.message:'Mise à jour du chat impossible.');}};
  const generateSummary=async()=>{if(!live)return;setBusy('summary');try{setSummary(await collaborationService.generateSummary(live.meetingId));}catch(cause){setNotice(cause instanceof Error?cause.message:'Résumé Luna indisponible.');}finally{setBusy('');}};
  const respond=async(request:LiveParticipationRequest,status:'accepted'|'rejected')=>{if(!live)return;try{await liveService.respondParticipation(live.id,request.userId,status);setRequests((current)=>current.map((item)=>item.userId===request.userId?{...item,status}:item));}catch(cause){setNotice(cause instanceof Error?cause.message:'Réponse impossible.');}};
  const deleteComment=async(commentId:string)=>{if(!live)return;try{await liveService.deleteComment(live.id,commentId);setComments((current)=>current.filter((comment)=>comment.id!==commentId));setNotice('Commentaire supprimé.');}catch(cause){setNotice(cause instanceof Error?cause.message:'Suppression impossible.');}};

  if(!live&&!error)return <AppShell title="Live"><AppLoader label="Connexion au Live…"/></AppShell>;
  if(!live)return <AppShell title="Live"><main className="live-room-error"><Radio/><h1>Live indisponible</h1><p>{error}</p><button onClick={()=>navigate('/app/live')}>Retour aux Lives</button></main></AppShell>;

  const mainStream=publisher?localStream:hostRemote?.stream||null;
  const mediaWaitLabel=liveKit.failed
    ? 'Connexion média interrompue'
    : liveKit.connected
      ? (publisher?'Activation de la caméra…':'En attente de la vidéo de l’animateur…')
      : 'Connexion au serveur média…';

  return <main className={publisher?'live-room-page host-mode':'live-room-page viewer-mode'}>
    <header className="live-room-topbar">
      <button onClick={()=>navigate('/app/live')}><ChevronLeft/></button>
      <div className="live-room-host"><Avatar name={live.hostName} src={live.hostAvatar}/><span><strong>{live.hostName}</strong><small>{duration||liveCategoryLabel(live.category)}</small></span></div>
      {live.status==='live'&&live.broadcastActive?<span className="live-badge">EN DIRECT</span>:<span className="live-badge scheduled">{live.status==='ended'?'TERMINÉ':live.status==='scheduled'?'PROGRAMMÉ':'EN PRÉPARATION'}</span>}
      {!live.isHost?<button className={live.isFollowing?'live-follow following':'live-follow'} onClick={()=>void follow()}>{live.isFollowing?'Suivi':'Suivre'}</button>:null}
      <div className="live-more-wrap"><button type="button" aria-label="Plus d’actions" aria-expanded={moreOpen} onClick={()=>setMoreOpen((value)=>!value)}><MoreVertical/></button>{moreOpen?<div className="live-more-menu"><button type="button" onClick={()=>{setMoreOpen(false);void share();}}><Share2/> Partager le Live</button><button type="button" onClick={()=>{setMoreOpen(false);void navigator.clipboard.writeText(window.location.href).then(()=>setNotice('Lien du Live copié.')).catch(()=>setNotice('Copie du lien impossible.'));}}><Send/> Copier le lien</button></div>:null}</div>
    </header>

    {notice?<div className="live-toast" onClick={()=>setNotice('')}>{notice}</div>:null}
    {error?<div className="live-toast error" role="alert" onClick={()=>setError('')}>{error}</div>:null}

    {live.status==='scheduled'?<section className="live-scheduled-panel"><CalendarDays/><h1>{live.title}</h1><p>{live.scheduledFor?new Intl.DateTimeFormat('fr-FR',{dateStyle:'full',timeStyle:'short'}).format(new Date(live.scheduledFor)):''}</p>{live.isHost?<button className="live-primary-action" disabled={busy==='start'} onClick={()=>void startLive()}>{busy==='start'?<LoaderCircle className="spin"/>:<Radio/>} Lancer le Live maintenant</button>:<span>Ce Live n’a pas encore commencé.</span>}</section>:
    live.status==='ended'?<section className="live-scheduled-panel"><Square/><h1>Live terminé</h1><p>{live.title}</p>{live.recordingEnabled?<span>Le replay apparaîtra dans vos enregistrements lorsqu’il sera prêt.</span>:null}<button onClick={()=>navigate('/app/live')}>Découvrir d’autres Lives</button></section>:
    <>
      <section className="live-stage">
        <video ref={publisher?localVideoRef:remoteVideoRef} autoPlay playsInline muted={publisher} className="live-main-video"/>
        {!mainStream?<div className="live-video-wait">
          {liveKit.failed?<><Radio/><strong>{mediaWaitLabel}</strong><span>MBotéRoom va réessayer automatiquement. Vous pouvez aussi relancer maintenant.</span><button type="button" onClick={retryMedia}>Réessayer</button></>:<><LoaderCircle className="spin"/><strong>{mediaWaitLabel}</strong></>}
        </div>:null}
        {!publisher?<div className="live-stage-stats"><span><Eye/> {fmtCount(live.viewerCount)}</span><span><Heart/> {fmtCount(live.likeCount)}</span><span><Send/> {fmtCount(comments.length)}</span></div>:null}

        {!publisher?<aside className="live-viewer-actions">
          <button className={live.isLiked?'liked':''} onClick={()=>void like()}><Heart/><span>{fmtCount(live.likeCount)}</span></button>
          <button onClick={()=>document.querySelector<HTMLInputElement>('.live-comment-form input')?.focus()}><Send/><span>{comments.length}</span></button>
          {live.canShare?<button onClick={()=>void share()}><Share2/><span>{fmtCount(live.shareCount)}</span></button>:null}
          <button onClick={()=>void sendGift()}><Gift/><span>{live.giftCount?fmtCount(live.giftCount):'Cadeau'}</span></button>
        </aside>:null}

        <div className="live-comment-overlay">{comments.slice(-5).map((comment)=><div key={comment.id}><Avatar name={comment.name} src={comment.avatar}/><span><strong>{comment.name}</strong> {comment.text}</span></div>)}</div>
      </section>

      {publisher?<section className="live-host-dashboard" aria-label="Console de diffusion">
        <header className="live-studio-heading"><div><strong>Studio Live</strong><small>{live.title}</small></div><span className={liveKit.connected?'live-studio-online':'live-studio-connecting'}><i/>{liveKit.connected?'Diffusion connectée':'Connexion…'}</span></header>
        {live.isHost&&live.recordingEnabled?<div className={recordingError?'live-recording-state warning':'live-recording-state'} role="status">
          <Video size={18}/>
          <span><strong>{recordingIdRef.current?'Enregistrement en cours':recordingChecking?'Vérification du replay…':recordingSetupRequired?'Replay non configuré':recordingError?'Replay indisponible':'Préparation du replay'}</strong>
            <small>{recordingError?(recordingSetupRequired?'Configuration LiveKit Egress nécessaire':recordingError):recordingIdRef.current?'Le replay sera disponible après le direct.':'Le direct continue normalement.'}</small>
            {recordingSetupRequired?<details><summary>Pourquoi ?</summary>{recordingError}</details>:null}
          </span>
          {recordingError?<button type="button" disabled={recordingChecking} onClick={()=>{recordingAttemptRef.current=false;void startLiveRecording(live.meetingId);}}>{recordingChecking?'Vérification…':recordingSetupRequired?'Vérifier':'Réessayer'}</button>:null}
        </div>:null}
        <div className="live-studio-section-label">Statistiques en direct</div>
        <div className="live-host-stats"><span><Eye/><strong>{fmtCount(live.viewerCount)}</strong><small>spectateurs</small></span><span><Heart/><strong>{fmtCount(live.likeCount)}</strong><small>j’aime</small></span><span><Send/><strong>{comments.length}</strong><small>commentaires</small></span><span><Share2/><strong>{fmtCount(live.shareCount)}</strong><small>partages</small></span></div>
        <div className="live-capture-status" role="status">Qualité caméra réelle : {captureResolution} · diffusion adaptative selon le réseau</div>
        <div className="live-studio-section-label">Commandes de diffusion</div>
        <div className="live-host-controls">
          <button type="button" aria-pressed={media.audio} className={media.audio?'active':''} onClick={toggleMic}>{media.audio?<Mic/>:<MicOff/>}<span>Micro<small>{media.audio?'Activé':'Muet'}</small></span></button>
          <button type="button" aria-pressed={media.video} className={media.video?'active':''} disabled={media.screen} onClick={toggleCamera}>{media.video?<Video/>:<VideoOff/>}<span>Caméra<small>{media.video?'Activée':'Coupée'}</small></span></button>
          <button type="button" aria-pressed={media.screen} className={media.screen?'active':''} disabled={sharePending} onClick={()=>void shareScreen()}><MonitorUp/><span>{sharePending?'Démarrage…':media.screen?'Arrêter':'Partager'}<small>l’écran</small></span></button>
          <label className="live-quality-control"><Video/><span>Qualité<small>{videoQuality==='auto'?`Auto · ${activeVideoQuality==='high'?'HD':activeVideoQuality==='standard'?'standard':'éco'}`:videoQuality==='full-hd'?'Full HD 1080p':videoQuality==='high'?'HD 720p':videoQuality==='standard'?'Standard':'Éco'}</small></span><select aria-label="Qualité vidéo du Live" value={videoQuality} disabled={media.screen} onChange={(event)=>setVideoQuality(event.target.value as VideoQuality)}><option value="auto">Automatique</option><option value="data-saver">Économie</option><option value="standard">Standard</option><option value="high">HD 720p</option><option value="full-hd">Full HD 1080p</option></select></label>
          <button onClick={()=>{setInviteOpen((value)=>!value);void liveService.getParticipationRequests(live.id).then(setRequests).catch(()=>setNotice('Impossible de charger les demandes.'));}}><UserPlus/><span>Inviter<small>un invité</small></span></button>
          <button className={!live.chatEnabled?'active danger':''} onClick={()=>void toggleChat()}><Send/><span>Chat<small>{live.chatEnabled?'Actif':'Muet'}</small></span></button>
        </div>

        {inviteOpen?<section className="live-invite-panel">
          <header><div><UserPlus/><span><strong>Inviter un co-animateur</strong><small>Une notification MBotéRoom et un e-mail seront envoyés.</small></span></div><button onClick={()=>setInviteOpen(false)}><X/></button></header>
          <form onSubmit={sendInvite}><input type="email" value={inviteEmail} onChange={(event)=>setInviteEmail(event.target.value)} placeholder="partenaire@exemple.com" required/><button disabled={busy==='invite'}>{busy==='invite'?<LoaderCircle className="spin"/>:<Send/>} Envoyer l’invitation</button></form>
        </section>:null}

        {requests.some((request)=>request.status==='pending')?<section className="live-requests"><h2>Demandes de participation</h2>{requests.filter((request)=>request.status==='pending').map((request)=><article key={request.userId}><Avatar name={request.name} src={request.avatar}/><strong>{request.name}</strong><button onClick={()=>void respond(request,'accepted')}>Accepter</button><button className="danger" onClick={()=>void respond(request,'rejected')}>Refuser</button></article>)}</section>:null}

        <section className="live-host-comments"><header><button type="button" className={hostPanel==='public'?'active':''} onClick={()=>setHostPanel('public')}>Public</button><button type="button" className={hostPanel==='comments'?'active':''} onClick={()=>setHostPanel('comments')}>Commentaires <b>{comments.length}</b></button><button type="button" className={hostPanel==='moderation'?'active':''} onClick={()=>setHostPanel('moderation')}>Modération</button></header>{hostPanel==='public'?<div className="live-panel-note"><strong>Vue publique</strong><span>Les spectateurs voient actuellement le direct, les réactions et les {live.chatEnabled?'commentaires.':'commentaires sont désactivés.'}</span></div>:comments.slice(-20).reverse().map((comment)=><article key={comment.id}><Avatar name={comment.name} src={comment.avatar}/><div><strong>{comment.name}</strong><p>{comment.text}</p></div>{hostPanel==='moderation'&&live.moderationEnabled?<button type="button" aria-label="Supprimer ce commentaire" onClick={()=>void deleteComment(comment.id)}><X/></button>:null}</article>)}{hostPanel==='moderation'&&!live.moderationEnabled?<div className="live-panel-note"><strong>Mode modération désactivé</strong><span>Activez-le lors de la création du Live pour gérer les commentaires ici.</span></div>:null}</section>

        <section className="live-luna-card"><header><div><Sparkles/><span><strong>Résumé Luna IA</strong><small>Analyse du direct et points importants</small></span></div><button disabled={busy==='summary'} onClick={()=>void generateSummary()}>{busy==='summary'?<LoaderCircle className="spin"/>:<Sparkles/>} Générer</button></header>{summary?<ul>{summary.bullets.slice(0,5).map((item)=><li key={item}>{item}</li>)}</ul>:<p>Luna peut générer les points clés, décisions et actions du Live.</p>}</section>
        <button className="live-end-button" type="button" disabled={busy==='end'} onClick={()=>setConfirmEndOpen(true)}><Square/> {busy==='end'?'Fin du Live…':'Terminer le Live'}</button>
      </section>:<section className="live-viewer-bottom">
        {live.chatEnabled&&live.canComment?<form className="live-comment-form" onSubmit={sendComment}><input value={commentText} onChange={(event)=>setCommentText(event.target.value)} placeholder="Écrire un commentaire…"/><button><Send/></button></form>:<div className="live-chat-disabled">{user?.isGuest?'Créez un compte pour commenter.':'Le chat est désactivé pour ce Live.'}</div>}
        {live.cohostsEnabled&&live.canRequestParticipation?<button className="live-request-button" onClick={()=>void requestParticipation()}><UserPlus/> Demander à participer</button>:null}
      </section>}
    </>}
    {confirmEndOpen&&<div className="live-confirm-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setConfirmEndOpen(false);}}>
      <section className="live-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="live-confirm-title">
        <strong id="live-confirm-title">Terminer le Live pour tous ?</strong>
        <p>Les spectateurs seront déconnectés et le direct ne pourra plus être rejoint.</p>
        <div><button type="button" disabled={busy==='end'} onClick={()=>setConfirmEndOpen(false)}>Annuler</button><button type="button" className="danger" disabled={busy==='end'} onClick={()=>void endLive()}>{busy==='end'?'Fin en cours…':'Terminer pour tous'}</button></div>
      </section>
    </div>}
  </main>;
}
