import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Bell, CalendarDays, CalendarSync, ChevronLeft, ChevronRight, Clock3, Link2,
  Plus, RefreshCw, Repeat2, ShieldCheck, Trash2, Unlink, UsersRound, Video,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { appDataService, type CalendarEvent } from '../services/appDataService';
import { meetingService, type Meeting } from '../services/meetingService';
import { workspaceService, type GoogleCalendarStatus } from '../services/workspaceService';
import { readCachedPreferences } from '../lib/userPreferences';
import { showAppMessage } from '../lib/appMessage';
import './CalendarPage.css';

type CalendarView='month'|'week'|'day';
type EventKind='meeting'|'event';
type Recurrence='none'|'daily'|'weekly'|'monthly';

type CalendarForm={
  title:string;
  description:string;
  startDate:string;
  startTime:string;
  endDate:string;
  endTime:string;
  eventType:EventKind;
  participants:string;
  reminder:boolean;
  reminderMinutes:number;
  waitingRoom:boolean;
  recurrence:Recurrence;
};

type CalendarItem={
  id:string;
  calendarId?:string;
  meetingId?:number;
  title:string;
  description:string;
  start:Date;
  end:Date;
  source:'mboteroom'|'google'|'meeting';
  participants:number;
  metadata:Record<string,unknown>;
};

const pad=(value:number)=>String(value).padStart(2,'0');
const dateInput=(date:Date)=>date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
const timeInput=(date:Date)=>pad(date.getHours())+':'+pad(date.getMinutes());
const startOfDay=(date:Date)=>new Date(date.getFullYear(),date.getMonth(),date.getDate());
const sameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const sameMonth=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth();
const mondayStart=(date:Date)=>{
  const copy=startOfDay(date);
  const day=(copy.getDay()+6)%7;
  copy.setDate(copy.getDate()-day);
  return copy;
};
const formatTime=(date:Date)=>new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(date);
const formatDate=(date:Date)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(date);

const makeInitialForm=():CalendarForm=>{
  const start=new Date(Date.now()+60*60_000);
  start.setMinutes(Math.ceil(start.getMinutes()/15)*15,0,0);
  const end=new Date(start.getTime()+60*60_000);
  const preferences=readCachedPreferences();
  return{
    title:'',
    description:'',
    startDate:dateInput(start),
    startTime:timeInput(start),
    endDate:dateInput(end),
    endTime:timeInput(end),
    eventType:'meeting',
    participants:'',
    reminder:true,
    reminderMinutes:15,
    waitingRoom:preferences.waitingRoomDefault!==false,
    recurrence:'none',
  };
};

const eventColor=(item:CalendarItem)=>{
  if(item.source==='google')return 'violet';
  if(item.meetingId)return 'blue';
  const seed=item.title.split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)%4;
  return ['green','orange','coral','teal'][seed];
};

export default function CalendarPage(){
  const [events,setEvents]=useState<CalendarEvent[]>([]);
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [google,setGoogle]=useState<GoogleCalendarStatus>({configured:false,connected:false,scope:''});
  const [googleBusy,setGoogleBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [view,setView]=useState<CalendarView>('month');
  const [cursor,setCursor]=useState(()=>new Date());
  const [selectedDate,setSelectedDate]=useState(()=>new Date());
  const [form,setForm]=useState<CalendarForm>(makeInitialForm);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [eventRows,meetingRows,status]=await Promise.all([
        appDataService.getCalendar(),
        meetingService.getMeetings().catch(()=>[]),
        workspaceService.getGoogleCalendarStatus().catch(()=>({configured:false,connected:false,scope:''})),
      ]);
      setEvents(Array.isArray(eventRows)?eventRows:[]);
      setMeetings(Array.isArray(meetingRows)?meetingRows:[]);
      setGoogle(status);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Impossible de charger le calendrier.');
    }finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  useEffect(()=>{
    const status=new URLSearchParams(window.location.search).get('google');
    if(status==='connected'){
      showAppMessage('Google Calendar est maintenant connecté à MBotéRoom.',{tone:'success',title:'Google Calendar connecté'});
      window.history.replaceState({},'',window.location.pathname);
      setGoogleBusy(true);
      void workspaceService.syncGoogleCalendar()
        .then(()=>load())
        .catch((cause)=>showAppMessage(cause instanceof Error?cause.message:'Synchronisation Google Calendar impossible.',{tone:'error'}))
        .finally(()=>setGoogleBusy(false));
    }else if(status==='failed'){
      showAppMessage('La connexion à Google Calendar n’a pas abouti. Réessayez.',{tone:'error',title:'Connexion Google Calendar'});
      window.history.replaceState({},'',window.location.pathname);
    }
  },[]);

  const items=useMemo<CalendarItem[]>(()=>{
    const byMeeting=new Set(events.map((event)=>Number(event.meeting_id||0)).filter(Boolean));
    const fromEvents=events.map((event)=>{
      const meeting=event.meeting_id?meetings.find((item)=>item.id===Number(event.meeting_id)):undefined;
      const metadataParticipants=Array.isArray(event.metadata?.participants)?event.metadata.participants:[];
      const participants=meeting?.participant_count ?? metadataParticipants.length;
      return{
        id:'event-'+event.id,
        calendarId:event.id,
        meetingId:event.meeting_id?Number(event.meeting_id):undefined,
        title:event.title,
        description:event.description||'',
        start:new Date(event.starts_at),
        end:new Date(event.ends_at),
        source:event.source==='google'?'google':'mboteroom',
        participants:Number(participants||0),
        metadata:event.metadata||{},
      } as CalendarItem;
    });
    const meetingItems=meetings
      .filter((meeting)=>!byMeeting.has(meeting.id))
      .map((meeting)=>({
        id:'meeting-'+meeting.id,
        meetingId:meeting.id,
        title:meeting.title,
        description:meeting.description||'',
        start:new Date(meeting.start_time),
        end:new Date(new Date(meeting.start_time).getTime()+(meeting.duration||60)*60_000),
        source:'meeting' as const,
        participants:Number(meeting.participant_count||meeting.settings?.participants?.length||0),
        metadata:{waitingRoom:meeting.settings?.waitingRoom!==false},
      }));
    return [...fromEvents,...meetingItems].sort((a,b)=>a.start.getTime()-b.start.getTime());
  },[events,meetings]);

  const monthMeetings=useMemo(()=>meetings.filter((meeting)=>sameMonth(new Date(meeting.start_time),new Date())).length,[meetings]);
  const upcoming=useMemo(()=>items.filter((item)=>item.end.getTime()>=Date.now()).slice(0,8),[items]);
  const monthEvents=useMemo(()=>items.filter((item)=>sameMonth(item.start,cursor)),[items]);

  const monthCells=useMemo(()=>{
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);
    const start=mondayStart(first);
    return Array.from({length:42},(_,index)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+index));
  },[cursor]);

  const selectedRangeItems=useMemo(()=>{
    if(view==='month')return monthEvents;
    if(view==='day')return items.filter((item)=>sameDay(item.start,selectedDate));
    const start=mondayStart(selectedDate);
    const end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+7);
    return items.filter((item)=>item.start>=start&&item.start<end);
  },[items,monthEvents,selectedDate,view]);

  const connectGoogle=async()=>{
    setGoogleBusy(true);
    try{
      const result=await workspaceService.connectGoogleCalendar('/app/calendar');
      window.location.assign(result.url);
    }catch(cause){
      setGoogleBusy(false);
      showAppMessage(cause instanceof Error?cause.message:'Connexion Google Calendar impossible.',{tone:'error'});
    }
  };

  const syncGoogle=async()=>{
    setGoogleBusy(true);
    try{
      const result=await workspaceService.syncGoogleCalendar();
      await load();
      showAppMessage('Synchronisation terminée : '+result.imported+' importé(s), '+result.pushed+' envoyé(s).',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Synchronisation Google Calendar impossible.',{tone:'error'});
    }finally{setGoogleBusy(false);}
  };

  const disconnectGoogle=async()=>{
    setGoogleBusy(true);
    try{
      await workspaceService.disconnectGoogleCalendar();
      setGoogle({configured:true,connected:false,scope:''});
      showAppMessage('Google Calendar a été déconnecté.',{tone:'success'});
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Déconnexion impossible.',{tone:'error'});}
    finally{setGoogleBusy(false);}
  };

  const createEvent=async(event:FormEvent)=>{
    event.preventDefault();
    if(!form.title.trim())return;
    const startsAt=new Date(form.startDate+'T'+form.startTime);
    const endsAt=new Date(form.endDate+'T'+form.endTime);
    if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt){
      setError('Choisissez une date de début et de fin valides.');
      return;
    }
    setSaving(true);setError('');
    try{
      const participants=form.participants.split(/[;,\n]+/).map((value)=>value.trim().toLowerCase()).filter(Boolean);
      let meeting:Meeting|undefined;
      if(form.eventType==='meeting'){
        const duration=Math.max(15,Math.round((endsAt.getTime()-startsAt.getTime())/60_000));
        meeting=await meetingService.scheduleMeeting({
          title:form.title.trim(),
          description:form.description.trim(),
          startTime:startsAt.toISOString(),
          duration,
          participants,
          settings:{
            participants,
            waitingRoom:form.waitingRoom,
            participantAudio:true,
            participantVideo:true,
            screenShare:true,
            chat:true,
            reactions:true,
            lunaSummary:true,
            encryption:true,
            linkSharing:true,
            externalAccess:true,
            visibility:'private',
            isPublic:false,
          },
        });
        setMeetings((current)=>[...current,meeting!]);
      }
      const created=await appDataService.createCalendarEvent({
        title:form.title.trim(),
        description:form.description.trim(),
        startsAt:startsAt.toISOString(),
        endsAt:endsAt.toISOString(),
        meetingId:meeting?.id,
        metadata:{
          eventType:form.eventType,
          participants,
          reminderEnabled:form.reminder,
          reminderMinutes:form.reminder?form.reminderMinutes:0,
          waitingRoom:form.waitingRoom,
          recurrence:form.recurrence,
        },
      });
      setEvents((current)=>[...current,created].sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()));
      setSelectedDate(startsAt);
      setCursor(startsAt);
      setForm(makeInitialForm());
      showAppMessage(form.eventType==='meeting'?'Réunion planifiée et ajoutée au calendrier.':'Événement enregistré.',{tone:'success'});
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Création impossible.');
    }finally{setSaving(false);}
  };

  const deleteEvent=async(item:CalendarItem)=>{
    if(!item.calendarId)return;
    try{
      await appDataService.deleteCalendarEvent(item.calendarId);
      setEvents((current)=>current.filter((event)=>event.id!==item.calendarId));
      showAppMessage('Événement supprimé du calendrier.',{tone:'success'});
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Suppression impossible.',{tone:'error'});}
  };

  const shiftCursor=(direction:number)=>{
    if(view==='month')setCursor((current)=>new Date(current.getFullYear(),current.getMonth()+direction,1));
    else if(view==='week')setSelectedDate((current)=>new Date(current.getFullYear(),current.getMonth(),current.getDate()+direction*7));
    else setSelectedDate((current)=>new Date(current.getFullYear(),current.getMonth(),current.getDate()+direction));
  };

  const goToday=()=>{const today=new Date();setCursor(today);setSelectedDate(today);};

  return <AppShell title="Calendrier">
    <main className="calendar-pro-page">
      <section className="calendar-pro-hero">
        <div className="calendar-pro-title"><span><CalendarDays/></span><div><h1>Calendrier</h1><p>Organisez vos réunions, événements et synchronisations MBotéRoom.</p></div></div>
        <div className="calendar-pro-hero-stats">
          <article><span><UsersRound/></span><strong>{monthMeetings}</strong><small>Réunions ce mois</small></article>
          <article><span><CalendarDays/></span><strong>{upcoming.length}</strong><small>Événements à venir</small></article>
          <article><span><RefreshCw/></span><strong>{google.connected?1:0}</strong><small>Synchronisation active</small><b>{google.connected?'Connectée':'Non connectée'}</b></article>
        </div>
      </section>

      <section className="calendar-google-card">
        <span className="calendar-google-icon"><CalendarSync/></span>
        <div><small>Synchronisation externe</small><h2>Google Calendar</h2><p>{!google.configured?'La connexion Google Calendar doit être configurée par l’administrateur de MBotéRoom.':google.connected?'Votre agenda Google est connecté et peut être synchronisé avec MBotéRoom.':'Synchronisez vos événements pour les retrouver dans MBotéRoom et ne rien manquer.'}</p></div>
        <span className={google.connected?'calendar-google-status connected':'calendar-google-status'}><i/>{google.connected?'Connecté':'Non connecté'}</span>
        <div className="calendar-google-actions">
          {!google.connected?<button disabled={googleBusy||!google.configured} onClick={()=>void connectGoogle()}><Link2/>{googleBusy?'Connexion…':'Connecter Google Calendar'}</button>:<>
            <button disabled={googleBusy} onClick={()=>void syncGoogle()}><RefreshCw className={googleBusy?'spin':''}/>{googleBusy?'Synchronisation…':'Synchroniser'}</button>
            <button className="secondary" disabled={googleBusy} onClick={()=>void disconnectGoogle()}><Unlink/> Déconnecter</button>
          </>}
        </div>
      </section>

      {error?<div className="calendar-pro-error">{error}</div>:null}

      <div className="calendar-pro-grid">
        <section className="calendar-create-card">
          <header><span><Plus/></span><div><h2>Créer un événement</h2><p>Planifiez une réunion ou un événement pour vous et votre équipe.</p></div></header>
          <form onSubmit={createEvent}>
            <label>Titre *<input value={form.title} onChange={(event)=>setForm((current)=>({...current,title:event.target.value}))} placeholder="Ex. Réunion d’équipe, Formation, etc." required/></label>
            <label>Description<textarea value={form.description} onChange={(event)=>setForm((current)=>({...current,description:event.target.value}))} placeholder="Ajoutez une description (ordre du jour, objectifs…)"/></label>
            <div className="calendar-form-dates">
              <fieldset><legend>Début *</legend><input type="date" value={form.startDate} onChange={(event)=>setForm((current)=>({...current,startDate:event.target.value}))}/><input type="time" value={form.startTime} onChange={(event)=>setForm((current)=>({...current,startTime:event.target.value}))}/></fieldset>
              <fieldset><legend>Fin *</legend><input type="date" value={form.endDate} onChange={(event)=>setForm((current)=>({...current,endDate:event.target.value}))}/><input type="time" value={form.endTime} onChange={(event)=>setForm((current)=>({...current,endTime:event.target.value}))}/></fieldset>
            </div>
            <div className="calendar-form-row">
              <label>Type<select value={form.eventType} onChange={(event)=>setForm((current)=>({...current,eventType:event.target.value as EventKind}))}><option value="meeting">Réunion MBotéRoom</option><option value="event">Événement personnel</option></select></label>
              <label>Participants<input value={form.participants} onChange={(event)=>setForm((current)=>({...current,participants:event.target.value}))} placeholder="Emails séparés par ;"/></label>
            </div>
            <div className="calendar-advanced-title"><ShieldCheck/> Options avancées</div>
            <div className="calendar-advanced-grid">
              <article><div><Bell/><span><strong>Rappel</strong><small>{form.reminder?form.reminderMinutes+' minutes avant':'Désactivé'}</small></span><button type="button" className={form.reminder?'switch on':'switch'} onClick={()=>setForm((current)=>({...current,reminder:!current.reminder}))}><i/></button></div>{form.reminder?<select value={form.reminderMinutes} onChange={(event)=>setForm((current)=>({...current,reminderMinutes:Number(event.target.value)}))}><option value={5}>5 minutes avant</option><option value={15}>15 minutes avant</option><option value={30}>30 minutes avant</option><option value={60}>1 heure avant</option></select>:null}</article>
              <article><div><ShieldCheck/><span><strong>Salle d’attente</strong><small>Les participants attendent votre admission.</small></span><button type="button" className={form.waitingRoom?'switch on':'switch'} onClick={()=>setForm((current)=>({...current,waitingRoom:!current.waitingRoom}))}><i/></button></div></article>
              <article><div><Repeat2/><span><strong>Répétition</strong><small>{form.recurrence==='none'?'Aucune répétition':form.recurrence==='daily'?'Chaque jour':form.recurrence==='weekly'?'Chaque semaine':'Chaque mois'}</small></span></div><select value={form.recurrence} onChange={(event)=>setForm((current)=>({...current,recurrence:event.target.value as Recurrence}))}><option value="none">Aucune répétition</option><option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option></select></article>
            </div>
            <button className="calendar-create-submit" disabled={saving}>{saving?<><RefreshCw className="spin"/> Enregistrement…</>:<><CalendarDays/> Enregistrer l’événement</>}</button>
          </form>
        </section>

        <div className="calendar-pro-right">
          <section className="calendar-board">
            <header>
              <div className="calendar-board-nav"><button onClick={()=>shiftCursor(-1)}><ChevronLeft/></button><h2>{view==='month'?new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(cursor):view==='week'?'Semaine du '+formatDate(mondayStart(selectedDate)):formatDate(selectedDate)}</h2><button onClick={()=>shiftCursor(1)}><ChevronRight/></button></div>
              <div className="calendar-board-controls"><div>{(['month','week','day'] as CalendarView[]).map((item)=><button key={item} className={view===item?'active':''} onClick={()=>setView(item)}>{item==='month'?'Mois':item==='week'?'Semaine':'Jour'}</button>)}</div><button onClick={goToday}>Aujourd’hui</button></div>
            </header>

            {view==='month'?<>
              <div className="calendar-weekdays">{['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((day)=><span key={day}>{day}</span>)}</div>
              <div className="calendar-month-grid">{monthCells.map((day)=>{
                const dayItems=items.filter((item)=>sameDay(item.start,day)).slice(0,3);
                return <button key={day.toISOString()} className={(sameMonth(day,cursor)?'':'outside ') +(sameDay(day,new Date())?'today ':'') +(sameDay(day,selectedDate)?'selected':'')} onClick={()=>setSelectedDate(day)}>
                  <b>{day.getDate()}</b>
                  <span>{dayItems.map((item)=><i key={item.id} className={eventColor(item)}><em>{formatTime(item.start)}</em> {item.title}</i>)}</span>
                  {items.filter((item)=>sameDay(item.start,day)).length>3?<small>+{items.filter((item)=>sameDay(item.start,day)).length-3}</small>:null}
                </button>;
              })}</div>
            </>:<div className="calendar-agenda-view">
              {selectedRangeItems.length?selectedRangeItems.map((item)=><article key={item.id}><time>{formatDate(item.start)}<b>{formatTime(item.start)} – {formatTime(item.end)}</b></time><span className={eventColor(item)}><i/></span><div><strong>{item.title}</strong><small>{item.description||'Événement MBotéRoom'}</small></div>{item.participants?<b><UsersRound/>{item.participants}</b>:null}</article>):<div className="calendar-view-empty">Aucun événement pour cette période.</div>}
            </div>}
          </section>

          <section className="calendar-upcoming-card">
            <header><span><CalendarDays/></span><h2>Prochains événements</h2><button onClick={()=>setView('day')}>Voir tout <ChevronRight/></button></header>
            {upcoming.length?<div>{upcoming.slice(0,5).map((item)=><article key={item.id}>
              <time><strong>{pad(item.start.getDate())}</strong><small>{new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(item.start).replace('.','')}</small></time>
              <div><strong>{item.title}</strong><small><Clock3/>{formatTime(item.start)} – {formatTime(item.end)}</small></div>
              <span>{item.participants?<><UsersRound/>{item.participants} participant{item.participants>1?'s':''}</>:item.source==='google'?'Google Calendar':'MBotéRoom'}</span>
              <b className={item.start.getTime()>Date.now()?'upcoming':'active'}>{item.start.getTime()>Date.now()?'À venir':'En cours'}</b>
              {item.calendarId?<button aria-label="Supprimer" onClick={()=>void deleteEvent(item)}><Trash2/></button>:null}
            </article>)}</div>:<p className="calendar-upcoming-empty">Aucun événement à venir.</p>}
          </section>
        </div>
      </div>
      {loading?<div className="calendar-loading">Chargement du calendrier…</div>:null}
    </main>
  </AppShell>;
}
