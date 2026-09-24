import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Captions,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  MessageCircle,
  Play,
  RefreshCw,
  Sparkles,
  Star,
  UsersRound,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { collaborationService, type MeetingMessage } from '../services/collaborationService';
import { type EndedMeetingPayload, meetingService } from '../services/meetingService';
import './RealMeetingEndedPage.css';

const downloadText=(name:string,content:string,type='text/plain;charset=utf-8')=>{
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

const formatMeetingDate=(value:string)=>{
  try{
    return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  }catch{
    return '';
  }
};

export default function RealMeetingEndedPage(){
  const navigate=useNavigate();
  const {meetingId}=useParams();
  const [payload,setPayload]=useState<EndedMeetingPayload|null>(null);
  const [messages,setMessages]=useState<MeetingMessage[]>([]);
  const [loading,setLoading]=useState(Boolean(meetingId));
  const [error,setError]=useState('');
  const [summaryError,setSummaryError]=useState('');
  const [summaryBusy,setSummaryBusy]=useState(false);
  const [restartBusy,setRestartBusy]=useState(false);
  const [restartError,setRestartError]=useState('');
  const [feedbackRating,setFeedbackRating]=useState(0);
  const [feedbackComment,setFeedbackComment]=useState('');
  const [feedbackBusy,setFeedbackBusy]=useState(false);
  const [feedbackError,setFeedbackError]=useState('');

  const load=async()=>{
    if(!meetingId){setLoading(false);return;}
    setLoading(true);
    setError('');
    try{
      const value=await meetingService.getEndedMeeting(meetingId);
      setPayload(value);
      setFeedbackRating(value.feedback.rating||0);
      setFeedbackComment(value.feedback.comment||'');
      setMessages(await collaborationService.getMessages(value.meeting.id).catch(()=>[]));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Impossible de charger le compte rendu.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void load();},[meetingId]);

  const summaryReady=payload?.summary.processingStatus==='ready';
  const sourceCounts=payload?.summary.sourceCounts||{chat:messages.length,captions:0};
  const totalSources=sourceCounts.chat+sourceCounts.captions;

  const summaryText=useMemo(()=>payload?[
    `Compte rendu — ${payload.meeting.title}`,
    `Durée : ${payload.durationMinutes} min`,
    `Participants : ${payload.participants.length}`,
    `Extraits audio : ${payload.summary.sourceCounts?.captions||0}`,
    `Messages : ${payload.summary.sourceCounts?.chat||messages.length}`,
    '',
    'Points clés',
    ...payload.summary.bullets.map((item)=>`- ${item}`),
    '',
    'Décisions',
    ...payload.summary.decisions.map((item)=>`- ${item}`),
    '',
    'Actions',
    ...payload.summary.actions.map((item)=>`- ${item}`),
    payload.summary.nextMeeting?`\nProchaine réunion : ${payload.summary.nextMeeting}`:'',
  ].join('\n'):'',[messages.length,payload]);

  const chatText=useMemo(
    ()=>messages.map((message)=>`[${new Date(message.time).toLocaleString('fr-FR')}] ${message.sender}: ${message.text}`).join('\n'),
    [messages],
  );

  const submitFeedback=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!payload||feedbackBusy)return;
    if(feedbackRating<1||feedbackRating>5){setFeedbackError('Sélectionnez une note entre 1 et 5 étoiles.');return;}
    const comment=feedbackComment.trim();
    if(comment.length<3){setFeedbackError('Ajoutez un commentaire sur votre expérience.');return;}
    setFeedbackBusy(true);
    setFeedbackError('');
    try{
      await meetingService.submitFeedback(payload.meeting.id,feedbackRating,comment);
      await load();
    }catch(cause){
      setFeedbackError(cause instanceof Error?cause.message:'Impossible d’envoyer votre avis.');
    }finally{
      setFeedbackBusy(false);
    }
  };

  const restartMeeting=async()=>{
    if(!payload||restartBusy)return;
    setRestartBusy(true);
    setRestartError('');
    try{
      const result=await meetingService.restartMeeting(payload.meeting.id);
      navigate('/reunions/'+encodeURIComponent(result.meeting.meeting_link),{replace:true,state:{meeting:result.meeting}});
    }catch(cause){
      setRestartError(cause instanceof Error?cause.message:'Impossible de relancer cette réunion.');
    }finally{
      setRestartBusy(false);
    }
  };

  const generateSummary=async()=>{
    if(!payload||totalSources===0||!payload.summary.lunaConfigured)return;
    setSummaryBusy(true);
    setSummaryError('');
    try{
      await collaborationService.generateSummary(payload.meeting.id);
      await load();
    }catch(cause){
      setSummaryError(cause instanceof Error?cause.message:'Luna n’a pas pu générer le résumé pour le moment.');
    }finally{
      setSummaryBusy(false);
    }
  };

  if(loading)return <main className="real-ended-state"><span className="real-ended-state-spinner"/><strong>Préparation du compte rendu…</strong></main>;

  if(!meetingId)return (
    <main className="real-ended-state">
      <FileText size={42}/>
      <h1>Aucune réunion sélectionnée</h1>
      <button onClick={()=>navigate('/app')}>Retour au tableau de bord</button>
    </main>
  );

  if(error&&!payload)return (
    <main className="real-ended-state">
      <FileText size={42}/>
      <h1>Compte rendu indisponible</h1>
      <p>{error}</p>
      <button onClick={()=>navigate('/app')}>Retour au tableau de bord</button>
    </main>
  );

  if(!payload)return null;

  if(payload.permissions.canRate&&!payload.feedback.submitted)return (
    <main className="real-ended-feedback-stage">
      <div className="real-ended-feedback-backdrop">
        <form className="real-ended-feedback-modal" onSubmit={submitFeedback} aria-labelledby="meeting-feedback-title">
          <span className="real-ended-feedback-icon"><CheckCircle2 size={30}/></span>
          <span className="real-ended-feedback-eyebrow">Réunion terminée</span>
          <h1 id="meeting-feedback-title">Comment s’est passée cette réunion ?</h1>
          <p>Votre avis aide MBotéRoom à améliorer l’expérience. Le résumé de <strong>{payload.meeting.title}</strong> sera affiché juste après l’envoi.</p>

          <fieldset className="real-ended-feedback-rating">
            <legend>Votre note</legend>
            <div className="real-ended-feedback-stars" role="radiogroup" aria-label="Note de la réunion">
              {[1,2,3,4,5].map((value)=>(
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={feedbackRating===value}
                  aria-label={`${value} étoile${value>1?'s':''}`}
                  className={feedbackRating>=value?'is-active':''}
                  onClick={()=>{setFeedbackRating(value);setFeedbackError('');}}
                >
                  <Star size={32} fill={feedbackRating>=value?'currentColor':'none'}/>
                </button>
              ))}
            </div>
            <strong>{feedbackRating?`${feedbackRating}/5`:'Sélectionnez une note'}</strong>
          </fieldset>

          <label className="real-ended-feedback-comment">
            Votre commentaire
            <textarea
              value={feedbackComment}
              onChange={(event)=>{setFeedbackComment(event.target.value.slice(0,1000));setFeedbackError('');}}
              rows={5}
              minLength={3}
              maxLength={1000}
              placeholder="Dites-nous ce qui a bien fonctionné et ce qui peut être amélioré."
              required
            />
            <small>{feedbackComment.length}/1000</small>
          </label>

          {feedbackError?<div className="real-ended-feedback-error" role="alert">{feedbackError}</div>:null}
          <button className="real-ended-feedback-submit" type="submit" disabled={feedbackBusy||feedbackRating<1||feedbackComment.trim().length<3}>
            {feedbackBusy?<RefreshCw className="is-spinning" size={17}/>:<Star size={17}/>}
            {feedbackBusy?'Envoi de votre avis…':'Envoyer mon avis et voir le résumé'}
          </button>
          <small className="real-ended-feedback-note">Un seul avis est enregistré par participant et par réunion.</small>
        </form>
      </div>
    </main>
  );

  const summaryState=payload.summary.processingStatus;

  return (
    <main className="real-ended-page">
      <header className="real-ended-header">
        <button className="back" onClick={()=>navigate('/app')}><ArrowLeft size={18}/> Tableau de bord</button>
        <div className="real-ended-hero">
          <span className="real-ended-hero-icon"><CheckCircle2 size={30}/></span>
          <div className="real-ended-hero-copy">
            <span className="real-ended-eyebrow">Compte rendu de réunion</span>
            <h1>Réunion terminée</h1>
            <p>{payload.meeting.title}</p>
            <small>{formatMeetingDate(payload.endedAt)}</small>
          </div>
          <span className="real-ended-status-badge"><CheckCircle2 size={14}/> Terminée</span>
        </div>
        {payload.userRole==='host'||payload.userRole==='cohost'?<div className="real-ended-restart-wrap">
          <button className="real-ended-restart" type="button" disabled={restartBusy} onClick={()=>void restartMeeting()}>
            <RefreshCw className={restartBusy?'is-spinning':''} size={17}/>
            {restartBusy?'Relance en cours…':'Relancer cette réunion'}
          </button>
          <small>Une nouvelle session sera créée avec le même sujet, les mêmes participants et le même ID de réunion.</small>
          {restartError?<p className="real-ended-restart-error">{restartError}</p>:null}
        </div>:null}
      </header>

      <section className="real-ended-stats" aria-label="Statistiques de la réunion">
        <article>
          <span><Clock3/></span>
          <div><strong>{payload.durationMinutes} min</strong><small>Durée</small></div>
        </article>
        <article>
          <span><UsersRound/></span>
          <div><strong>{payload.participants.length}</strong><small>Participant{payload.participants.length>1?'s':''}</small></div>
        </article>
        <article>
          <span><Captions/></span>
          <div><strong>{sourceCounts.captions}</strong><small>Extrait{sourceCounts.captions>1?'s':''} audio</small></div>
        </article>
        <article>
          <span><MessageCircle/></span>
          <div><strong>{messages.length}</strong><small>Message{messages.length>1?'s':''}</small></div>
        </article>
      </section>

      <div className="real-ended-grid">
        <section className="real-ended-card real-ended-summary-card">
          <div className="real-ended-title">
            <div>
              <span className="real-ended-title-icon"><Bot size={19}/></span>
              <div><h2>Résumé Luna</h2><small>Compte rendu basé uniquement sur le contenu réellement enregistré</small></div>
            </div>
            {summaryReady&&payload.permissions.canDownloadSummary?(
              <button onClick={()=>downloadText(`resume-mboteroom-${payload.meeting.id}.txt`,summaryText)}>
                <Download size={16}/> Télécharger
              </button>
            ):null}
          </div>

          {summaryReady?(
            <div className="real-ended-summary-content">
              <section>
                <h3><Sparkles size={15}/> Points clés</h3>
                {payload.summary.bullets.length ? <ul>{payload.summary.bullets.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucun point clé identifié.</p>}
              </section>
              <section>
                <h3>Décisions</h3>
                {payload.summary.decisions.length ? <ul>{payload.summary.decisions.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucune décision identifiée.</p>}
              </section>
              <section>
                <h3>Actions</h3>
                {payload.summary.actions.length ? <ul>{payload.summary.actions.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Aucune action identifiée.</p>}
              </section>
              {payload.summary.nextMeeting?<section><h3>Prochaine réunion</h3><p>{payload.summary.nextMeeting}</p></section>:null}
              <div className="real-ended-source-note">
                <Captions size={14}/> {sourceCounts.captions} extrait{sourceCounts.captions>1?'s':''} audio
                <span>·</span>
                <MessageCircle size={14}/> {sourceCounts.chat} message{sourceCounts.chat>1?'s':''}
              </div>
            </div>
          ):summaryState==='empty'?(
            <div className="real-ended-empty real-ended-empty-neutral">
              <span><Bot size={26}/></span>
              <strong>Aucun contenu à résumer</strong>
              <p>Aucune transcription audio ni aucun message n’a été enregistré pendant cette réunion. Il n’y a donc pas assez de contenu fiable pour créer un résumé.</p>
              <small>Pour les prochaines réunions, MBotéRoom conservera automatiquement la transcription nécessaire lorsque le résumé Luna est activé.</small>
            </div>
          ):summaryState==='unavailable'?(
            <div className="real-ended-empty real-ended-empty-warning">
              <span><Bot size={26}/></span>
              <strong>Luna est momentanément indisponible</strong>
              <p>Le contenu de la réunion est conservé, mais le service de résumé n’est pas disponible pour le moment.</p>
            </div>
          ):(
            <div className="real-ended-empty real-ended-empty-ready">
              <span><Sparkles size={26}/></span>
              <strong>Le contenu est prêt pour Luna</strong>
              <p>{sourceCounts.captions} extrait{sourceCounts.captions>1?'s':''} audio et {sourceCounts.chat} message{sourceCounts.chat>1?'s':''} peuvent être utilisés pour créer le compte rendu.</p>
              <button disabled={summaryBusy} onClick={()=>void generateSummary()}>
                {summaryBusy?<RefreshCw className="is-spinning" size={16}/>:<Bot size={16}/>}
                {summaryBusy?'Génération en cours…':'Générer le résumé'}
              </button>
              {summaryError?<div className="real-ended-summary-error" role="status">{summaryError}</div>:null}
            </div>
          )}
        </section>

        <section className="real-ended-card real-ended-participants-card">
          <div className="real-ended-title">
            <div>
              <span className="real-ended-title-icon"><UsersRound size={19}/></span>
              <div><h2>Participants</h2><small>{payload.participants.length} personne{payload.participants.length>1?'s':''}</small></div>
            </div>
          </div>
          {payload.participants.length?(
            <div className="real-ended-people">
              {payload.participants.map((participant)=>(
                <article key={participant.id}>
                  <span>{participant.avatar?<img src={participant.avatar} alt=""/>:participant.name.slice(0,2).toUpperCase()}</span>
                  <div><strong>{participant.name}</strong><small>{participant.role}</small></div>
                </article>
              ))}
            </div>
          ):<div className="real-ended-mini-empty">Aucun participant enregistré.</div>}
        </section>
      </div>

      <section className="real-ended-card real-ended-discussion-card">
        <div className="real-ended-title">
          <div>
            <span className="real-ended-title-icon"><MessageCircle size={19}/></span>
            <div><h2>Discussion</h2><small>{messages.length?`${messages.length} message${messages.length>1?'s':''}`:'Aucun message'}</small></div>
          </div>
          {messages.length&&payload.permissions.canExportChat?(
            <button onClick={()=>downloadText(`discussion-mboteroom-${payload.meeting.id}.txt`,chatText)}>
              <Download size={16}/> Exporter
            </button>
          ):null}
        </div>
        {messages.length?(
          <div className="real-ended-chat">
            {messages.map((message)=>(
              <article key={message.id}>
                <div><strong>{message.sender}</strong><time>{new Date(message.time).toLocaleString('fr-FR')}</time></div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        ):(
          <div className="real-ended-discussion-empty">
            <MessageCircle size={22}/>
            <span>Aucun message n’a été échangé pendant cette réunion.</span>
          </div>
        )}
      </section>

      {payload.recording.available&&payload.recording.url?(
        <section className="real-ended-recording">
          <div><span><Play size={20}/></span><div><strong>Enregistrement disponible</strong><small>Revoyez l’enregistrement de cette réunion.</small></div></div>
          <a href={payload.recording.url} target="_blank" rel="noreferrer"><Play size={16}/> Ouvrir</a>
        </section>
      ):null}
    </main>
  );
}
