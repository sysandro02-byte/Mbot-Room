import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, LockKeyhole, Mic, MicOff, ShieldCheck, Video, VideoOff } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { Meeting, meetingService } from '../services/meetingService';
import './RealJoinPage.css';

export default function RealJoinPage(){
  const navigate=useNavigate();
  const {meetingLink}=useParams();
  const user=authService.getCurrentUser();
  const [value,setValue]=useState(meetingLink||'');
  const [password,setPassword]=useState('');
  const [meeting,setMeeting]=useState<Meeting|null>(null);
  const [mic,setMic]=useState(true);
  const [camera,setCamera]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{if(!meetingLink)return;setLoading(true);meetingService.getMeetingByLink(meetingLink).then(setMeeting).catch((cause)=>setError(cause instanceof Error?cause.message:'Réunion introuvable.')).finally(()=>setLoading(false));},[meetingLink]);

  const lookup=async(event:FormEvent)=>{event.preventDefault();if(!value.trim())return;setLoading(true);setError('');try{setMeeting(await meetingService.lookupMeetingAccess(value.trim(),password));}catch(cause){setMeeting(null);setError(cause instanceof Error?cause.message:'Réunion introuvable.');}finally{setLoading(false);}};
  const join=async()=>{if(!meeting)return;setLoading(true);setError('');try{const host=Number(meeting.host_id)===Number(user?.id)||Number(meeting.co_host_id||0)===Number(user?.id)||user?.role==='admin';if(host){if(!meeting.is_active){const result=await meetingService.startMeetingAndNotify(meeting.id);const live=result.meeting||{...meeting,is_active:true};navigate(`/reunions/${meeting.id}`,{state:{meeting:live,joinOptions:{mic,camera}}});return;}navigate(`/reunions/${meeting.id}`,{state:{meeting,joinOptions:{mic,camera}}});return;}const result=await meetingService.requestJoin(meeting.id,user?.id,password);if(result.status==='requested'){navigate(`/reunions/${meeting.id}/salle-attente`,{state:{meeting,joinOptions:{mic,camera}}});return;}navigate(`/reunions/${meeting.id}`,{state:{meeting,joinOptions:{mic,camera}}});}catch(cause){setError(cause instanceof Error?cause.message:'Impossible de rejoindre la réunion.');}finally{setLoading(false);}};

  return <main className="real-join-shell"><section className="real-join-card"><button className="real-join-back" onClick={()=>navigate('/app/meetings')}><ArrowLeft size={18}/> Réunions</button><div className="real-join-brand"><ShieldCheck size={28}/><div><strong>MBotéRoom</strong><small>Accès sécurisé à la réunion</small></div></div>{!meeting?<form onSubmit={lookup}><h1>Rejoindre une réunion</h1><p>Saisissez l’ID, le code ou le lien réel de la réunion.</p><label>ID ou lien<input value={value} onChange={(event)=>setValue(event.target.value)} placeholder="ID ou room-…" required/></label><label>Mot de passe, si demandé<div className="real-join-password"><LockKeyhole size={17}/><input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="Mot de passe"/></div></label>{error?<div className="real-join-error">{error}</div>:null}<button className="real-join-primary" disabled={loading}>{loading?'Vérification…':'Continuer'}</button></form>:<div className="real-join-preview"><h1>{meeting.title}</h1><p>{meeting.description||'Réunion MBotéRoom'}</p><dl><div><dt>Hôte</dt><dd>{meeting.host_name}</dd></div><div><dt>Début</dt><dd>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(meeting.start_time))}</dd></div><div><dt>Salle d’attente</dt><dd>{meeting.settings?.waitingRoom===false?'Non':'Oui'}</dd></div></dl><div className="real-join-media"><button className={mic?'on':''} onClick={()=>setMic((value)=>!value)}>{mic?<Mic/>:<MicOff/>}<span>{mic?'Micro actif':'Micro coupé'}</span></button><button className={camera?'on':''} onClick={()=>setCamera((value)=>!value)}>{camera?<Video/>:<VideoOff/>}<span>{camera?'Caméra active':'Caméra coupée'}</span></button></div>{error?<div className="real-join-error">{error}</div>:null}<div className="real-join-actions"><button className="secondary" onClick={()=>setMeeting(null)}>Changer</button><button className="real-join-primary" onClick={()=>void join()} disabled={loading}>{loading?'Connexion…':'Rejoindre maintenant'}</button></div></div>}</section></main>;
}
