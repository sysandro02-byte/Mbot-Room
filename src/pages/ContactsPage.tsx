import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Clock3,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Star,
  UserPlus,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { conversationService, type DirectoryContact } from '../services/conversationService';
import { meetingService, type Meeting } from '../services/meetingService';
import { workspaceService, type WorkGroup } from '../services/workspaceService';
import { showAppMessage } from '../lib/appMessage';
import './ContactsPage.css';

type FilterKey='all'|'recent'|'team'|'saved'|'favorites';

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'MB';
const localDateValue=(date=new Date(Date.now()+3600_000))=>new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);

export default function ContactsPage(){
  const navigate=useNavigate();
  const [contacts,setContacts]=useState<DirectoryContact[]>([]);
  const [groups,setGroups]=useState<WorkGroup[]>([]);
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [filter,setFilter]=useState<FilterKey>('all');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [addOpen,setAddOpen]=useState(false);
  const [directorySearch,setDirectorySearch]=useState('');
  const [directoryResults,setDirectoryResults]=useState<DirectoryContact[]>([]);
  const [directoryBusy,setDirectoryBusy]=useState(false);
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [scheduleContact,setScheduleContact]=useState<DirectoryContact|null>(null);
  const [callBusy,setCallBusy]=useState<number|null>(null);

  const load=async()=>{
    setLoading(true);
    setError('');
    try{
      const [contactRows,groupRows,meetingRows]=await Promise.all([
        conversationService.getContacts(),
        workspaceService.getWorkGroups().catch(()=>[]),
        meetingService.getMeetings().catch(()=>[]),
      ]);
      setContacts(contactRows);
      setGroups(groupRows);
      setMeetings(meetingRows);
      setSelectedId((current)=>current&&contactRows.some((contact)=>contact.id===current)?current:(contactRows[0]?.id||null));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Impossible de charger vos contacts.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void load();},[]);

  useEffect(()=>{
    if(!addOpen||directorySearch.trim().length<2){
      setDirectoryResults([]);
      return;
    }
    const timer=window.setTimeout(()=>{
      setDirectoryBusy(true);
      void conversationService.searchAccounts(directorySearch)
        .then(setDirectoryResults)
        .catch(()=>setDirectoryResults([]))
        .finally(()=>setDirectoryBusy(false));
    },250);
    return()=>window.clearTimeout(timer);
  },[addOpen,directorySearch]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return contacts.filter((contact)=>{
      if(q&&![
        contact.name,contact.email,contact.username,contact.organization,contact.jobTitle,contact.city,
      ].some((value)=>String(value||'').toLowerCase().includes(q)))return false;
      if(filter==='recent')return contact.online;
      if(filter==='team')return contact.sharedGroup;
      if(filter==='saved')return contact.saved;
      if(filter==='favorites')return contact.favorite;
      return true;
    });
  },[contacts,filter,search]);

  useEffect(()=>{
    if(selectedId&&!filtered.some((contact)=>contact.id===selectedId)&&filtered.length)setSelectedId(filtered[0].id);
  },[filtered,selectedId]);

  const selected=contacts.find((contact)=>contact.id===selectedId)||null;
  const recentMeetings=useMemo(()=>{
    if(!selected)return [];
    const email=selected.email.toLowerCase();
    return meetings.filter((meeting)=>
      meeting.settings?.participants?.some((value)=>String(value).toLowerCase()===email)
    ).sort((a,b)=>new Date(b.start_time).getTime()-new Date(a.start_time).getTime()).slice(0,3);
  },[meetings,selected]);

  const groupMembership=useMemo(()=>{
    if(!selected)return [];
    return groups.filter((group)=>group.ownerId===selected.id||group.members.some((member)=>member.userId===selected.id));
  },[groups,selected]);

  const toggleFavorite=async(contact:DirectoryContact)=>{
    try{
      const next=!contact.favorite;
      await conversationService.setFavorite(contact.id,next);
      setContacts((current)=>current.map((item)=>item.id===contact.id?{...item,favorite:next,saved:true}:item));
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible de modifier le favori.',{tone:'error'});
    }
  };

  const saveContact=async(contact:DirectoryContact)=>{
    try{
      await conversationService.saveContact(contact.id);
      setContacts((current)=>{
        const exists=current.some((item)=>item.id===contact.id);
        if(exists)return current.map((item)=>item.id===contact.id?{...item,saved:true}:item);
        return [...current,{...contact,saved:true}].sort((a,b)=>a.name.localeCompare(b.name));
      });
      setSelectedId(contact.id);
      setAddOpen(false);
      setDirectorySearch('');
      showAppMessage('Contact ajouté à MBotéRoom.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible d’ajouter ce contact.',{tone:'error'});
    }
  };

  const startConversation=async(contact:DirectoryContact)=>{
    try{
      const conversation=await conversationService.createDirect(contact.id);
      navigate('/app/messages?conversation='+encodeURIComponent(conversation.id));
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible d’ouvrir la conversation.',{tone:'error'});
    }
  };

  const startCall=async(contact:DirectoryContact,callType:'audio'|'video')=>{
    setCallBusy(contact.id);
    try{
      const meeting=await meetingService.scheduleMeeting({
        title:`${callType==='video'?'Visioconférence':'Appel'} avec ${contact.name}`,
        description:'Appel démarré depuis les contacts MBotéRoom.',
        startTime:new Date().toISOString(),
        duration:60,
        participants:[contact.email],
        settings:{
          callType,
          waitingRoom:false,
          participantAudio:true,
          participantVideo:callType==='video',
          screenShare:true,
          chat:true,
          reactions:true,
          lunaSummary:true,
          isPublic:false,
          linkSharing:false,
          externalAccess:false,
        },
      });
      const started=await meetingService.startMeetingAndNotify(meeting.id);
      navigate('/reunions/'+meeting.meeting_link,{state:{meeting:started.meeting||meeting}});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible de démarrer l’appel.',{tone:'error'});
    }finally{
      setCallBusy(null);
    }
  };

  const openSchedule=(contact:DirectoryContact)=>{
    setScheduleContact(contact);
    setScheduleOpen(true);
  };

  const scheduleMeeting=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!scheduleContact)return;
    const form=new FormData(event.currentTarget);
    try{
      await meetingService.scheduleMeeting({
        title:String(form.get('title')||`Réunion avec ${scheduleContact.name}`).trim(),
        startTime:new Date(String(form.get('start')||'')).toISOString(),
        duration:Math.max(15,Math.min(480,Number(form.get('duration')||60))),
        participants:[scheduleContact.email],
        settings:{
          callType:form.get('callType')==='audio'?'audio':'video',
          waitingRoom:true,
          participantAudio:true,
          participantVideo:true,
          screenShare:true,
          chat:true,
          reactions:true,
          lunaSummary:true,
          isPublic:false,
          externalAccess:false,
        },
      });
      setScheduleOpen(false);
      showAppMessage('Réunion planifiée et invitation enregistrée.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Planification impossible.',{tone:'error'});
    }
  };

  const stats={
    all:contacts.length,
    online:contacts.filter((contact)=>contact.online).length,
    team:contacts.filter((contact)=>contact.sharedGroup).length,
    saved:contacts.filter((contact)=>contact.saved).length,
  };

  return <section className="contacts-pro-page">
    <header className="contacts-pro-hero">
      <div className="contacts-pro-hero-icon"><UsersRound/></div>
      <div className="contacts-pro-hero-copy">
        <h1>Contacts</h1>
        <p>Retrouvez les membres de vos groupes de travail et les comptes MBotéRoom que vous avez enregistrés.</p>
      </div>
      <button className="contacts-pro-add" type="button" onClick={()=>setAddOpen(true)}><UserPlus size={17}/> Ajouter un contact</button>
      <div className="contacts-pro-illustration"><UsersRound/><span>Des connexions<br/>pour aller plus loin</span></div>
    </header>

    <section className="contacts-pro-stats">
      <article><span><UsersRound/></span><div><strong>{stats.all}</strong><small>Contacts actifs</small></div></article>
      <article><span className="is-green"><i/></span><div><strong>{stats.online}</strong><small>En ligne maintenant</small></div></article>
      <article><span><UsersRound/></span><div><strong>{stats.team}</strong><small>Équipe MBotéRoom</small></div></article>
      <article><span className="is-violet"><UserPlus/></span><div><strong>{stats.saved}</strong><small>Enregistrés</small></div></article>
    </section>

    {error?<div className="contacts-pro-error">{error}</div>:null}

    <div className="contacts-pro-layout">
      <aside className="contacts-pro-filters">
        <div className="contacts-pro-filter-title">Filtres</div>
        {([
          ['all','Tous',stats.all],
          ['recent','En ligne',stats.online],
          ['team','Équipe',stats.team],
          ['saved','Enregistrés',stats.saved],
          ['favorites','Favoris',contacts.filter((contact)=>contact.favorite).length],
        ] as Array<[FilterKey,string,number]>).map(([key,label,count])=>
          <button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>
            <span>{key==='favorites'?<Star size={16}/>:key==='saved'?<UserPlus size={16}/>:<UsersRound size={16}/>} {label}</span><b>{count}</b>
          </button>
        )}
        <div className="contacts-pro-groups-head"><strong>Groupes</strong><button onClick={()=>navigate('/app/groups')}><Plus size={16}/></button></div>
        <div className="contacts-pro-groups">
          {groups.slice(0,8).map((group)=><button key={group.id} onClick={()=>navigate('/app/messages?group='+encodeURIComponent(group.id))}><i/><span>{group.name}</span><b>{group.members.length}</b></button>)}
          {!groups.length?<p>Aucun groupe de travail.</p>:null}
        </div>
      </aside>

      <main className="contacts-pro-main">
        <div className="contacts-pro-toolbar">
          <label><Search size={17}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Rechercher un contact…"/></label>
          <span>{filtered.length} résultat{filtered.length>1?'s':''}</span>
        </div>

        {loading?<div className="contacts-pro-empty">Chargement des contacts…</div>:(
          filtered.length?<div className="contacts-pro-grid">
            {filtered.map((contact)=><article key={contact.id} className={selectedId===contact.id?'selected':''} onClick={()=>setSelectedId(contact.id)}>
              <div className="contacts-pro-card-top">
                <span className="contacts-pro-avatar">{contact.avatar?<img src={contact.avatar} alt=""/>:initials(contact.name)}{contact.online?<i/>:null}</span>
                <div><strong>{contact.name}</strong><small>{contact.online?'En ligne':'Hors ligne'}</small></div>
                <button type="button" className={contact.favorite?'favorite':''} onClick={(event)=>{event.stopPropagation();void toggleFavorite(contact);}} aria-label="Favori"><Star size={17} fill={contact.favorite?'currentColor':'none'}/></button>
              </div>
              <p>{contact.jobTitle||'Membre MBotéRoom'}</p>
              <p>{contact.organization||'MBotéRoom'}</p>
              <small className="contacts-pro-email">{contact.email}</small>
              <div className="contacts-pro-tags">{contact.sharedGroup?<span>Équipe</span>:null}{contact.saved?<span className="saved">Enregistré</span>:null}</div>
              <div className="contacts-pro-card-actions">
                <button onClick={(event)=>{event.stopPropagation();void startConversation(contact);}} title="Message"><MessageCircle size={16}/></button>
                <button disabled={callBusy===contact.id} onClick={(event)=>{event.stopPropagation();void startCall(contact,'audio');}} title="Appel audio"><Phone size={16}/></button>
                <button disabled={callBusy===contact.id} onClick={(event)=>{event.stopPropagation();void startCall(contact,'video');}} title="Visioconférence"><Video size={16}/></button>
                <button onClick={(event)=>{event.stopPropagation();openSchedule(contact);}} title="Planifier"><MoreHorizontal size={16}/></button>
              </div>
            </article>)}
          </div>:<div className="contacts-pro-empty"><UsersRound size={32}/><strong>Aucun contact</strong><p>Ajoutez un compte MBotéRoom ou rejoignez un groupe de travail commun.</p></div>
        )}
      </main>

      <aside className="contacts-pro-detail">
        {selected?<>
          <button className="contacts-pro-detail-close" type="button" onClick={()=>setSelectedId(null)}><X size={17}/></button>
          <div className="contacts-pro-detail-profile">
            <span>{selected.avatar?<img src={selected.avatar} alt=""/>:initials(selected.name)}{selected.online?<i/>:null}</span>
            <div><h2>{selected.name}</h2><p>{selected.jobTitle||'Membre MBotéRoom'}</p><small>{selected.organization||'MBotéRoom'}</small></div>
          </div>
          <div className="contacts-pro-detail-tags">{selected.sharedGroup?<span>Équipe</span>:null}{selected.favorite?<span className="fav"><Star size={12}/> Favori</span>:null}</div>
          <button className="contacts-pro-primary" onClick={()=>void startConversation(selected)}><MessageCircle size={17}/> Envoyer un message</button>
          <div className="contacts-pro-detail-actions">
            <button disabled={callBusy===selected.id} onClick={()=>void startCall(selected,'audio')}><Phone size={16}/> Appeler</button>
            <button disabled={callBusy===selected.id} onClick={()=>void startCall(selected,'video')}><Video size={16}/> Visioconférence</button>
          </div>
          <button className="contacts-pro-invite" onClick={()=>openSchedule(selected)}><CalendarDays size={16}/> Inviter à une réunion</button>

          <section>
            <h3>Informations de contact</h3>
            <p><Mail size={15}/><span>{selected.email}</span></p>
            <p><Building2 size={15}/><span>{selected.organization||'MBotéRoom'}</span></p>
            <p><MapPin size={15}/><span>{selected.city||'Ville non renseignée'}</span></p>
            <p><Clock3 size={15}/><span>{selected.online?'En ligne maintenant':'Hors ligne'}</span></p>
          </section>

          <section>
            <h3>Groupes communs ({groupMembership.length})</h3>
            {groupMembership.slice(0,4).map((group)=><button className="contacts-pro-detail-row" key={group.id} onClick={()=>navigate('/app/messages?group='+encodeURIComponent(group.id))}><UsersRound size={16}/><span>{group.name}</span></button>)}
            {!groupMembership.length?<small>Aucun groupe commun.</small>:null}
          </section>

          <section>
            <h3>Réunions récentes ({recentMeetings.length})</h3>
            {recentMeetings.map((meeting)=><button className="contacts-pro-detail-row" key={meeting.id} onClick={()=>navigate('/app/meetings')}><CalendarDays size={16}/><span><strong>{meeting.title}</strong><small>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(meeting.start_time))}</small></span></button>)}
            {!recentMeetings.length?<small>Aucune réunion récente commune.</small>:null}
          </section>
        </>:<div className="contacts-pro-empty detail"><UsersRound size={30}/><p>Sélectionnez un contact pour afficher ses informations.</p></div>}
      </aside>
    </div>

    {addOpen?<div className="contacts-pro-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setAddOpen(false);}}>
      <section role="dialog" aria-modal="true">
        <header><div><h2>Ajouter un contact MBotéRoom</h2><p>Recherchez uniquement un compte MBotéRoom enregistré.</p></div><button onClick={()=>setAddOpen(false)}><X/></button></header>
        <label className="contacts-pro-directory-search"><Search size={17}/><input autoFocus value={directorySearch} onChange={(event)=>setDirectorySearch(event.target.value)} placeholder="Nom, e-mail ou identifiant MBotéRoom"/></label>
        <div className="contacts-pro-directory-results">
          {directoryBusy?<p>Recherche…</p>:directoryResults.map((contact)=><article key={contact.id}><span>{contact.avatar?<img src={contact.avatar} alt=""/>:initials(contact.name)}</span><div><strong>{contact.name}</strong><small>{contact.email}</small></div><button disabled={contact.saved} onClick={()=>void saveContact(contact)}>{contact.saved?'Déjà ajouté':'Ajouter'}</button></article>)}
          {!directoryBusy&&directorySearch.trim().length>=2&&!directoryResults.length?<p>Aucun compte MBotéRoom correspondant.</p>:null}
          {directorySearch.trim().length<2?<p>Saisissez au moins 2 caractères.</p>:null}
        </div>
      </section>
    </div>:null}

    {scheduleOpen&&scheduleContact?<div className="contacts-pro-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setScheduleOpen(false);}}>
      <section role="dialog" aria-modal="true">
        <header><div><h2>Planifier avec {scheduleContact.name}</h2><p>L’invitation sera reliée à son compte MBotéRoom.</p></div><button onClick={()=>setScheduleOpen(false)}><X/></button></header>
        <form className="contacts-pro-schedule" onSubmit={scheduleMeeting}>
          <label>Titre<input name="title" defaultValue={'Réunion avec '+scheduleContact.name} required/></label>
          <label>Date et heure<input type="datetime-local" name="start" defaultValue={localDateValue()} required/></label>
          <label>Durée (minutes)<input type="number" name="duration" min="15" max="480" defaultValue="60" required/></label>
          <label>Type<select name="callType" defaultValue="video"><option value="video">Visioconférence</option><option value="audio">Audio</option></select></label>
          <button className="contacts-pro-primary" type="submit"><CalendarDays size={17}/> Planifier la réunion</button>
        </form>
      </section>
    </div>:null}
  </section>;
}
