import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  CalendarDays,
  FileImage,
  FileText,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  Smile,
  Star,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/authService';
import {
  conversationService,
  type Conversation,
  type ConversationMessage,
  type DirectoryContact,
} from '../services/conversationService';
import { meetingService } from '../services/meetingService';
import { workspaceService, type WorkGroup } from '../services/workspaceService';
import { socket } from '../lib/socket';
import { isNativeAndroidApp } from '../lib/nativePlatform';
import { showAppMessage } from '../lib/appMessage';
import './MessagesPage.css';
import AppLoader from '../components/AppLoader';

type ConversationFilter='all'|'groups'|'contacts'|'unread';

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'MB';
const formatTime=(value:string)=>new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const formatShortDate=(value:string)=>{
  const date=new Date(value);
  const today=new Date();
  if(date.toDateString()===today.toDateString())return formatTime(value);
  const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
  if(date.toDateString()===yesterday.toDateString())return 'Hier';
  return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short'}).format(date);
};
const dateLabel=(value:string)=>{
  const date=new Date(value);
  const today=new Date();
  if(date.toDateString()===today.toDateString())return 'Aujourd’hui';
  const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
  if(date.toDateString()===yesterday.toDateString())return 'Hier';
  return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(date);
};
const localDateValue=(date=new Date(Date.now()+3600_000))=>new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);

export default function MessagesPage(){
  const navigate=useNavigate();
  const [params,setParams]=useSearchParams();
  const currentUser=authService.getCurrentUser();
  const currentUserId=Number(currentUser?.id||0);
  const fileInputRef=useRef<HTMLInputElement|null>(null);
  const listEndRef=useRef<HTMLDivElement|null>(null);
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [messages,setMessages]=useState<ConversationMessage[]>([]);
  const [contacts,setContacts]=useState<DirectoryContact[]>([]);
  const [groups,setGroups]=useState<WorkGroup[]>([]);
  const [loading,setLoading]=useState(true);
  const [messagesLoading,setMessagesLoading]=useState(false);
  const [error,setError]=useState('');
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [filter,setFilter]=useState<ConversationFilter>('all');
  const [search,setSearch]=useState('');
  const [newOpen,setNewOpen]=useState(false);
  const [directorySearch,setDirectorySearch]=useState('');
  const [directoryResults,setDirectoryResults]=useState<DirectoryContact[]>([]);
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [callBusy,setCallBusy]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setLoading(true);setError('');
      try{
        const [rows,contactRows,groupRows]=await Promise.all([
          conversationService.getConversations(),
          conversationService.getContacts(),
          workspaceService.getWorkGroups().catch(()=>[]),
        ]);
        if(cancelled)return;
        setConversations(rows);
        setContacts(contactRows);
        setGroups(groupRows);

        const requestedConversation=params.get('conversation');
        const requestedUser=Number(params.get('user')||0);
        const requestedGroup=params.get('group')||'';
        if(requestedConversation&&rows.some((item)=>item.id===requestedConversation)){
          setSelectedId(requestedConversation);
        }else if(requestedUser){
          const conversation=await conversationService.createDirect(requestedUser);
          if(cancelled)return;
          setConversations((current)=>[conversation,...current.filter((item)=>item.id!==conversation.id)]);
          setSelectedId(conversation.id);
          setParams({conversation:conversation.id},{replace:true});
        }else if(requestedGroup){
          const conversation=await conversationService.openWorkGroup(requestedGroup);
          if(cancelled)return;
          setConversations((current)=>[conversation,...current.filter((item)=>item.id!==conversation.id)]);
          setSelectedId(conversation.id);
          setParams({conversation:conversation.id},{replace:true});
        }else{
          setSelectedId(isNativeAndroidApp()?null:(rows.find((item)=>!item.archived)?.id||rows[0]?.id||null));
        }
      }catch(cause){
        if(!cancelled)setError(cause instanceof Error?cause.message:'Chargement impossible.');
      }finally{
        if(!cancelled)setLoading(false);
      }
    };
    void load();
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    if(!selectedId){
      setMessages([]);
      return;
    }
    let cancelled=false;
    setMessagesLoading(true);
    void conversationService.getMessages(selectedId)
      .then((rows)=>{
        if(cancelled)return;
        setMessages(rows);
        void conversationService.markRead(selectedId).catch(()=>undefined);
        setConversations((current)=>current.map((item)=>item.id===selectedId?{...item,unreadCount:0}:item));
      })
      .catch((cause)=>{if(!cancelled)setError(cause instanceof Error?cause.message:'Messages indisponibles.');})
      .finally(()=>{if(!cancelled)setMessagesLoading(false);});
    return()=>{cancelled=true;};
  },[selectedId]);

  useEffect(()=>{listEndRef.current?.scrollIntoView({behavior:'smooth',block:'end'});},[messages]);

  useEffect(()=>{
    const onMessage=(message:ConversationMessage)=>{
      setConversations((current)=>current.map((conversation)=>{
        if(conversation.id!==message.conversationId)return conversation;
        const isOpen=conversation.id===selectedId;
        return{
          ...conversation,
          lastMessage:message,
          updatedAt:message.createdAt,
          unreadCount:isOpen?0:conversation.unreadCount+1,
        };
      }).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()));
      if(message.conversationId===selectedId){
        setMessages((current)=>current.some((item)=>item.id===message.id)?current:[...current,message]);
        void conversationService.markRead(message.conversationId).catch(()=>undefined);
      }
    };
    if(!socket.connected)socket.connect();
    socket.on('conversation:message',onMessage);
    return()=>{socket.off('conversation:message',onMessage);};
  },[selectedId]);

  useEffect(()=>{
    if(!newOpen||directorySearch.trim().length<2){
      setDirectoryResults([]);
      return;
    }
    const timer=window.setTimeout(()=>{
      void conversationService.searchAccounts(directorySearch).then(setDirectoryResults).catch(()=>setDirectoryResults([]));
    },250);
    return()=>window.clearTimeout(timer);
  },[directorySearch,newOpen]);

  const selected=conversations.find((conversation)=>conversation.id===selectedId)||null;
  const filteredConversations=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return conversations.filter((conversation)=>{
      if(conversation.archived)return false;
      if(filter==='groups'&&conversation.kind!=='work_group')return false;
      if(filter==='contacts'&&conversation.kind!=='direct')return false;
      if(filter==='unread'&&conversation.unreadCount<1)return false;
      if(q&&![
        conversation.title,
        conversation.lastMessage?.text||'',
        ...conversation.participants.map((participant)=>participant.name+' '+participant.email),
      ].some((value)=>value.toLowerCase().includes(q)))return false;
      return true;
    });
  },[conversations,filter,search]);

  const sendMessage=async(event:FormEvent)=>{
    event.preventDefault();
    if(!selected||!draft.trim()||sending)return;
    setSending(true);setError('');
    const text=draft.trim();
    try{
      const message=await conversationService.sendMessage(selected.id,{text});
      setMessages((current)=>current.some((item)=>item.id===message.id)?current:[...current,message]);
      setDraft('');
      setConversations((current)=>current.map((item)=>item.id===selected.id?{...item,lastMessage:message,updatedAt:message.createdAt}:item));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Message non envoyé.');
    }finally{
      setSending(false);
    }
  };

  const attachFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.currentTarget.value='';
    if(!file||!selected)return;
    if(!['application/pdf','image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){
      showAppMessage('Seuls les fichiers PDF et les images sont autorisés.',{tone:'error'});
      return;
    }
    setUploading(true);
    try{
      const uploaded=await workspaceService.uploadFile(file,selected.workGroupId||undefined);
      const message=await conversationService.sendMessage(selected.id,{fileId:uploaded.id,text:''});
      setMessages((current)=>[...current,message]);
      setConversations((current)=>current.map((item)=>item.id===selected.id?{
        ...item,lastMessage:message,updatedAt:message.createdAt,files:[message.file!,...item.files.filter((entry)=>entry.id!==message.file?.id)],
      }:item));
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Envoi du fichier impossible.',{tone:'error'});
    }finally{
      setUploading(false);
    }
  };

  const updateConversationSettings=async(patch:{pinned?:boolean;archived?:boolean;notificationsEnabled?:boolean})=>{
    if(!selected)return;
    try{
      const saved=await conversationService.updateSettings(selected.id,patch);
      setConversations((current)=>current.map((item)=>item.id===selected.id?{
        ...item,pinned:saved.pinned,archived:saved.archived,notificationsEnabled:saved.notificationsEnabled,
      }:item));
      if(saved.archived){
        const next=conversations.find((item)=>item.id!==selected.id&&!item.archived);
        setSelectedId(next?.id||null);
        setParams({});
      }
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Modification impossible.',{tone:'error'});
    }
  };

  const openDirect=async(contact:DirectoryContact)=>{
    try{
      const conversation=await conversationService.createDirect(contact.id);
      setConversations((current)=>[conversation,...current.filter((item)=>item.id!==conversation.id)]);
      setSelectedId(conversation.id);
      setParams({conversation:conversation.id},{replace:true});
      setNewOpen(false);setDirectorySearch('');
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible de créer la conversation.',{tone:'error'});
    }
  };

  const openGroup=async(group:WorkGroup)=>{
    try{
      const conversation=await conversationService.openWorkGroup(group.id);
      setConversations((current)=>[conversation,...current.filter((item)=>item.id!==conversation.id)]);
      setSelectedId(conversation.id);
      setParams({conversation:conversation.id},{replace:true});
      setNewOpen(false);
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible d’ouvrir le groupe.',{tone:'error'});
    }
  };

  const conversationEmails=(conversation:Conversation)=>conversation.participants
    .filter((participant)=>participant.id!==currentUserId)
    .map((participant)=>participant.email)
    .filter(Boolean);

  const startCall=async(callType:'audio'|'video')=>{
    if(!selected||callBusy)return;
    const emails=conversationEmails(selected);
    if(!emails.length){
      showAppMessage('Aucun autre compte MBotéRoom n’est disponible dans cette conversation.',{tone:'error'});
      return;
    }
    setCallBusy(true);
    try{
      const meeting=await meetingService.scheduleMeeting({
        title:`${callType==='video'?'Visioconférence':'Appel'} · ${selected.title}`,
        description:'Appel démarré depuis Messages MBotéRoom.',
        startTime:new Date().toISOString(),
        duration:60,
        participants:emails,
        settings:{
          callType,waitingRoom:false,participantAudio:true,participantVideo:callType==='video',screenShare:true,
          chat:true,reactions:true,lunaSummary:true,isPublic:false,linkSharing:false,externalAccess:false,
        },
      });
      if(selected.workGroupId)await workspaceService.attachGroupCall(selected.workGroupId,{meetingId:meeting.id,callType}).catch(()=>undefined);
      const started=await meetingService.startMeetingAndNotify(meeting.id);
      navigate('/reunions/'+meeting.meeting_link,{state:{meeting:started.meeting||meeting}});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Impossible de démarrer l’appel.',{tone:'error'});
    }finally{
      setCallBusy(false);
    }
  };

  const scheduleMeeting=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!selected)return;
    const form=new FormData(event.currentTarget);
    try{
      const meeting=await meetingService.scheduleMeeting({
        title:String(form.get('title')||selected.title).trim(),
        startTime:new Date(String(form.get('start')||'')).toISOString(),
        duration:Math.max(15,Math.min(480,Number(form.get('duration')||60))),
        participants:conversationEmails(selected),
        settings:{
          callType:form.get('callType')==='audio'?'audio':'video',
          waitingRoom:true,participantAudio:true,participantVideo:true,screenShare:true,chat:true,reactions:true,
          lunaSummary:true,isPublic:false,externalAccess:false,
        },
      });
      if(selected.workGroupId)await workspaceService.attachGroupCall(selected.workGroupId,{
        meetingId:meeting.id,callType:form.get('callType')==='audio'?'audio':'video',
      }).catch(()=>undefined);
      setScheduleOpen(false);
      showAppMessage('Réunion planifiée pour cette conversation.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Planification impossible.',{tone:'error'});
    }
  };

  const unreadTotal=conversations.reduce((sum,item)=>sum+item.unreadCount,0);

  return <section className={`messages-pro-page${isNativeAndroidApp()?` messages-native-android${selectedId?' messages-native-chat':' messages-native-list'}`:''}`}>
    <header className="messages-pro-heading">
      <div className="messages-pro-heading-icon"><MessageCircle/></div>
      <div><h1>Messages</h1><p>Échangez avec vos contacts MBotéRoom et vos groupes de travail.</p></div>
      <button onClick={()=>setNewOpen(true)}><Plus size={17}/> Nouvelle conversation</button>
    </header>

    {error?<div className="messages-pro-error">{error}</div>:null}

    <div className="messages-pro-layout">
      <aside className="messages-pro-list">
        <label className="messages-pro-search"><Search size={17}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Rechercher une conversation…"/></label>
        <div className="messages-pro-tabs">
          <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Toutes</button>
          <button className={filter==='groups'?'active':''} onClick={()=>setFilter('groups')}>Groupes</button>
          <button className={filter==='contacts'?'active':''} onClick={()=>setFilter('contacts')}>Contacts</button>
          <button className={filter==='unread'?'active':''} onClick={()=>setFilter('unread')}>Non lus {unreadTotal?<b>{unreadTotal}</b>:null}</button>
        </div>
        <div className="messages-pro-conversations">
          {loading?<AppLoader label="Chargement des conversations…" compact />:filteredConversations.map((conversation)=>{
            const other=conversation.participants.find((participant)=>participant.id!==currentUserId);
            const online=conversation.kind==='direct'&&Boolean(other?.online);
            return <button key={conversation.id} className={selectedId===conversation.id?'active':''} onClick={()=>{setSelectedId(conversation.id);setParams({conversation:conversation.id},{replace:true});}}>
              <span className="messages-pro-list-avatar">{conversation.avatar?<img src={conversation.avatar} alt=""/>:conversation.kind==='work_group'?<UsersRound/>:initials(conversation.title)}{online?<i/>:null}</span>
              <div><strong>{conversation.title}</strong><small>{conversation.lastMessage?(`${conversation.lastMessage.userId===currentUserId?'Vous : ':''}${conversation.lastMessage.text||conversation.lastMessage.file?.name||'Pièce jointe'}`):conversation.kind==='work_group'?conversation.participants.length+' membres':'Nouvelle conversation'}</small></div>
              <span className="messages-pro-list-meta"><time>{formatShortDate(conversation.updatedAt)}</time>{conversation.unreadCount?<b>{conversation.unreadCount}</b>:conversation.pinned?<Pin size={12}/>:null}</span>
            </button>;
          })}
          {!loading&&!filteredConversations.length?<p className="messages-pro-empty-small">Aucune conversation.</p>:null}
        </div>
      </aside>

      <main className="messages-pro-chat">
        {selected?<>
          <header className="messages-pro-chat-head">
            {isNativeAndroidApp()?<button type="button" className="messages-pro-chat-back" onClick={()=>{setSelectedId(null);const next=new URLSearchParams(params);next.delete('conversation');setParams(next,{replace:true});}} aria-label="Retour aux conversations"><ArrowLeft size={20}/></button>:null}
            <span className="messages-pro-chat-avatar">{selected.avatar?<img src={selected.avatar} alt=""/>:selected.kind==='work_group'?<UsersRound/>:initials(selected.title)}</span>
            <div><h2>{selected.title}{selected.pinned?<Star size={15} fill="currentColor"/>:null}</h2><p>{selected.kind==='work_group'?`${selected.participants.length} participants`:selected.participants.find((participant)=>participant.id!==currentUserId)?.online?'En ligne':'Compte MBotéRoom'}</p></div>
            <div className="messages-pro-chat-actions">
              <button disabled={callBusy} onClick={()=>void startCall('audio')} title="Appel audio"><Phone size={18}/></button>
              <button disabled={callBusy} onClick={()=>void startCall('video')} title="Visioconférence"><Video size={18}/></button>
              <button onClick={()=>setScheduleOpen(true)} title="Planifier"><CalendarDays size={18}/></button>
              <button onClick={()=>void updateConversationSettings({pinned:!selected.pinned})} title="Épingler"><MoreVertical size={18}/></button>
            </div>
          </header>

          <div className="messages-pro-thread">
            {messagesLoading?<AppLoader label="Chargement des messages…" compact />:messages.map((message,index)=>{
              const own=message.userId===currentUserId;
              const previous=messages[index-1];
              const showDate=!previous||new Date(previous.createdAt).toDateString()!==new Date(message.createdAt).toDateString();
              return <div key={message.id}>
                {showDate?<div className="messages-pro-date">{dateLabel(message.createdAt)}</div>:null}
                <article className={own?'own':''}>
                  {!own?<span className="messages-pro-message-avatar">{message.senderAvatar?<img src={message.senderAvatar} alt=""/>:initials(message.sender)}</span>:null}
                  <div className="messages-pro-bubble">
                    {!own?<strong>{message.sender}</strong>:null}
                    {message.text?<p>{message.text}</p>:null}
                    {message.file?<button className="messages-pro-file" onClick={()=>void workspaceService.openFile(message.file!.id,message.file!.name)}>
                      {message.file.mimeType==='application/pdf'?<FileText/>:<FileImage/>}
                      <span><strong>{message.file.name}</strong><small>{Math.max(1,Math.round(message.file.sizeBytes/1024))} Ko</small></span>
                    </button>:null}
                    <time>{formatTime(message.createdAt)}</time>
                  </div>
                </article>
              </div>;
            })}
            {!messagesLoading&&!messages.length?<div className="messages-pro-thread-empty"><MessageCircle size={34}/><strong>Démarrez la conversation</strong><p>Les messages seront enregistrés sur le serveur MBotéRoom.</p></div>:null}
            <div ref={listEndRef}/>
          </div>

          <form className="messages-pro-composer" onSubmit={sendMessage}>
            <input ref={fileInputRef} hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={attachFile}/>
            <button type="button" disabled={uploading} onClick={()=>fileInputRef.current?.click()} title="Joindre un fichier"><Paperclip size={19}/></button>
            <button type="button" title="Emoji" onClick={()=>setDraft((value)=>value+' 🙂')}><Smile size={19}/></button>
            <textarea value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder={uploading?'Envoi du fichier…':'Écrire un message…'} rows={1}/>
            <button className="send" type="submit" disabled={sending||!draft.trim()}><Send size={17}/><span>{sending?'Envoi…':'Envoyer'}</span></button>
          </form>
        </>:<div className="messages-pro-thread-empty full"><MessageCircle size={42}/><strong>Aucune conversation sélectionnée</strong><p>Choisissez un contact ou un groupe de travail.</p><button onClick={()=>setNewOpen(true)}><Plus size={16}/> Nouvelle conversation</button></div>}
      </main>

      <aside className="messages-pro-detail">
        {selected?<>
          <div className="messages-pro-detail-cover"><UsersRound/></div>
          <section className="messages-pro-detail-title"><div><h2>{selected.title}</h2><p>{selected.kind==='work_group'?'Groupe de travail MBotéRoom':'Conversation directe'}</p></div></section>
          <div className="messages-pro-detail-actions">
            <button disabled={callBusy} onClick={()=>void startCall('video')}><Video/><span>Démarrer</span></button>
            <button disabled={callBusy} onClick={()=>void startCall('audio')}><Phone/><span>Appeler</span></button>
            <button onClick={()=>setScheduleOpen(true)}><CalendarDays/><span>Planifier</span></button>
            <button onClick={()=>void updateConversationSettings({pinned:!selected.pinned})}><MoreVertical/><span>Plus</span></button>
          </div>

          <section className="messages-pro-detail-section">
            <header><strong>Participants ({selected.participants.length})</strong></header>
            <div className="messages-pro-participants">{selected.participants.slice(0,6).map((participant)=><button key={participant.id} onClick={()=>participant.id!==currentUserId&&navigate('/app/contacts')}><span>{participant.avatar?<img src={participant.avatar} alt=""/>:initials(participant.name)}{participant.online?<i/>:null}</span><small>{participant.id===currentUserId?'Vous':participant.name.split(' ')[0]}</small></button>)}</div>
          </section>

          <section className="messages-pro-detail-section">
            <header><strong>Fichiers partagés ({selected.files.length})</strong><button onClick={()=>navigate('/app/files')}>Voir tout</button></header>
            <div className="messages-pro-shared-files">
              {selected.files.slice(0,4).map((file)=><button key={file.id} onClick={()=>void workspaceService.openFile(file.id,file.name)}>
                <span className={file.mimeType==='application/pdf'?'pdf':'image'}>{file.mimeType==='application/pdf'?<FileText/>:<FileImage/>}</span>
                <div><strong>{file.name}</strong><small>{Math.max(1,Math.round(file.sizeBytes/1024))} Ko · {formatShortDate(file.createdAt)}</small></div>
                <MoreVertical size={15}/>
              </button>)}
              {!selected.files.length?<p>Aucun fichier partagé.</p>:null}
            </div>
          </section>

          <section className="messages-pro-detail-section settings">
            <h3>Paramètres de la conversation</h3>
            <button onClick={()=>void updateConversationSettings({notificationsEnabled:!selected.notificationsEnabled})}>{selected.notificationsEnabled?<Bell/>:<BellOff/>}<span><strong>Notifications</strong><small>{selected.notificationsEnabled?'Activées':'Désactivées'}</small></span><i className={selected.notificationsEnabled?'on':''}/></button>
            <button onClick={()=>void updateConversationSettings({pinned:!selected.pinned})}><Pin/><span><strong>Conversation épinglée</strong><small>{selected.pinned?'Oui':'Non'}</small></span><i className={selected.pinned?'on':''}/></button>
            <button onClick={()=>void updateConversationSettings({archived:true})}><Archive/><span><strong>Archiver la conversation</strong><small>Elle restera disponible sur le serveur</small></span></button>
          </section>
        </>:null}
      </aside>
    </div>

    {newOpen?<div className="messages-pro-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setNewOpen(false);}}>
      <section role="dialog" aria-modal="true">
        <header><div><h2>Nouvelle conversation</h2><p>Choisissez un contact enregistré, un compte MBotéRoom ou un groupe de travail.</p></div><button onClick={()=>setNewOpen(false)}><X/></button></header>
        <label className="messages-pro-directory-search"><Search size={17}/><input autoFocus value={directorySearch} onChange={(event)=>setDirectorySearch(event.target.value)} placeholder="Rechercher un compte MBotéRoom…"/></label>
        <div className="messages-pro-new-section"><h3>Contacts</h3>{contacts.slice(0,10).map((contact)=><button key={contact.id} onClick={()=>void openDirect(contact)}><span>{contact.avatar?<img src={contact.avatar} alt=""/>:initials(contact.name)}</span><div><strong>{contact.name}</strong><small>{contact.email}</small></div><MessageCircle/></button>)}</div>
        {directoryResults.length?<div className="messages-pro-new-section"><h3>Comptes MBotéRoom</h3>{directoryResults.filter((item)=>!contacts.some((contact)=>contact.id===item.id)).map((contact)=><button key={contact.id} onClick={()=>void openDirect(contact)}><span>{contact.avatar?<img src={contact.avatar} alt=""/>:initials(contact.name)}</span><div><strong>{contact.name}</strong><small>{contact.email}</small></div><Plus/></button>)}</div>:null}
        <div className="messages-pro-new-section"><h3>Groupes de travail</h3>{groups.map((group)=><button key={group.id} onClick={()=>void openGroup(group)}><span><UsersRound/></span><div><strong>{group.name}</strong><small>{group.members.length} membre{group.members.length>1?'s':''}</small></div><MessageCircle/></button>)}</div>
      </section>
    </div>:null}

    {scheduleOpen&&selected?<div className="messages-pro-modal" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setScheduleOpen(false);}}>
      <section role="dialog" aria-modal="true">
        <header><div><h2>Planifier une réunion</h2><p>Les membres de « {selected.title} » seront invités automatiquement.</p></div><button onClick={()=>setScheduleOpen(false)}><X/></button></header>
        <form className="messages-pro-schedule" onSubmit={scheduleMeeting}>
          <label>Titre<input name="title" defaultValue={'Réunion · '+selected.title} required/></label>
          <label>Date et heure<input type="datetime-local" name="start" defaultValue={localDateValue()} required/></label>
          <label>Durée<input type="number" name="duration" min="15" max="480" defaultValue="60" required/></label>
          <label>Type<select name="callType" defaultValue="video"><option value="video">Visioconférence</option><option value="audio">Audio</option></select></label>
          <button type="submit"><CalendarDays size={17}/> Planifier</button>
        </form>
      </section>
    </div>:null}
  </section>;
}
