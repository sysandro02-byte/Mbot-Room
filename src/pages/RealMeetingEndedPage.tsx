import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, CheckCircle2, Clock3, Download, FileText, Play, UsersRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { collaborationService, MeetingMessage } from '../services/collaborationService';
import { EndedMeetingPayload, meetingService } from '../services/meetingService';
import './RealMeetingEndedPage.css';

const downloadText=(name:string,content:string,type='text/plain;charset=utf-8')=>{const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export default function RealMeetingEndedPage(){
  const navigate=useNavigate();
  const {meetingId}=useParams();
  const [payload,setPayload]=useState<EndedMeetingPayload|null>(null);
  const [messages,setMessages]=useState<MeetingMessage[]>([]);
  const [loading,setLoading]=useState(Boolean(meetingId));
  const [error,setError]=useState('');
  const [summaryBusy,setSummaryBusy]=useState(false);

  const load=async()=>{if(!meetingId){setLoading(false);return;}setLoading(true);setError('');try{const value=await meetingService.getEndedMeeting(meetingId);setPayload(value);setMessages(await collaborationService.getMessages(value.meeting.id).catch(()=>[]));}catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger le compte rendu.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[meetingId]);
  const summaryReady=payload?.summary.processingStatus==='ready';
  const summaryText=useMemo(()=>payload?[`Compte rendu — ${payload.meeting.title}`,`Durée: ${payload.durationMinutes} min`,`Participants: ${payload.participants.length}`,'','Résumé',...payload.summary.bullets.map((item)=>`- ${item}`),'','Décisions',...payload.summary.decisions.map((item)=>`- ${item}`),'','Actions',...payload.summary.actions.map((item)=>`- ${item}`),payload.summary.nextMeeting?`\nProchaine réunion: ${payload.summary.nextMeeting}`:''].join('\n'):'',[payload]);
  const chatText=useMemo(()=>messages.map((message)=>`[${new Date(message.time).toLocaleString('fr-FR')}] ${message.sender}: ${message.text}`).join('\n'),[messages]);
  const generateSummary=async()=>{if(!payload)return;setSummaryBusy(true);setError('');try{await collaborationService.generateSummary(payload.meeting.id);await load();}catch(cause){setError(cause instanceof Error?cause.message:'Résumé indisponible.');}finally{setSummaryBusy(false);}};

  if(loading)return <main className="real-ended-state">Chargement du compte rendu…</main>;
  if(!meetingId)return <main className="real-ended-state"><FileText size={40}/><h1>Aucune réunion sélectionnée</h1><button onClick={()=>navigate('/app')}>Retour au tableau de bord</button></main>;
  if(error&&!payload)return <main className="real-ended-state"><FileText size={40}/><h1>Compte rendu indisponible</h1><p>{error}</p><button onClick={()=>navigate('/app')}>Retour</button></main>;
  if(!payload)return null;

  return <main className="real-ended-page"><header><button className="back" onClick={()=>navigate('/app')}><ArrowLeft size={18}/> Tableau de bord</button><div><CheckCircle2 size={38}/><h1>Réunion terminée</h1><p>{payload.meeting.title}</p></div></header>{error?<div className="real-ended-error">{error}</div>:null}<section className="real-ended-stats"><article><Clock3/><div><strong>{payload.durationMinutes} min</strong><small>Durée réelle</small></div></article><article><UsersRound/><div><strong>{payload.participants.length}</strong><small>Participants enregistrés</small></div></article><article><FileText/><div><strong>{messages.length}</strong><small>Messages persistés</small></div></article></section><div className="real-ended-grid"><section className="real-ended-card"><div className="real-ended-title"><h2><Bot size={19}/> Résumé Luna</h2>{summaryReady?<button onClick={()=>downloadText(`resume-mboteroom-${payload.meeting.id}.txt`,summaryText)}><Download size={16}/> Télécharger</button>:null}</div>{summaryReady?<><h3>Points clés</h3>{payload.summary.bullets.length?<ul>{payload.summary.bullets.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucun point clé enregistré.</p>}<h3>Décisions</h3>{payload.summary.decisions.length?<ul>{payload.summary.decisions.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucune décision identifiée.</p>}<h3>Actions</h3>{payload.summary.actions.length?<ul>{payload.summary.actions.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucune action identifiée.</p>}</>:<div className="real-ended-empty"><p>Aucun résumé n’est encore disponible. Luna génère uniquement un résumé à partir du chat persistant réellement disponible.</p><button disabled={summaryBusy} onClick={()=>void generateSummary()}><Bot size={16}/>{summaryBusy?'Génération…':'Générer maintenant'}</button></div>}</section><section className="real-ended-card"><div className="real-ended-title"><h2><UsersRound size={19}/> Participants</h2></div><div className="real-ended-people">{payload.participants.map((participant)=><article key={participant.id}><span>{participant.avatar?<img src={participant.avatar} alt=""/>:participant.name.slice(0,2).toUpperCase()}</span><div><strong>{participant.name}</strong><small>{participant.role}</small></div></article>)}</div></section></div><section className="real-ended-card"><div className="real-ended-title"><h2><FileText size={19}/> Discussion</h2>{messages.length?<button onClick={()=>downloadText(`chat-mboteroom-${payload.meeting.id}.txt`,chatText)}><Download size={16}/> Exporter</button>:null}</div>{messages.length?<div className="real-ended-chat">{messages.map((message)=><article key={message.id}><strong>{message.sender}</strong><time>{new Date(message.time).toLocaleString('fr-FR')}</time><p>{message.text}</p></article>)}</div>:<p>Aucun message n’a été enregistré pendant cette réunion.</p>}</section>{payload.recording.available&&payload.recording.url?<section className="real-ended-recording"><div><Play size={22}/><div><strong>Enregistrement serveur disponible</strong><small>Fichier déclaré dans le stockage MBotéRoom.</small></div></div><a href={payload.recording.url} target="_blank" rel="noreferrer"><Play size={16}/> Ouvrir</a></section>:null}</main>;
}
