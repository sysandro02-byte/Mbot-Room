import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, FileImage, FileText, LoaderCircle, Mail, Plus, Trash2, Upload, UsersRound, Video, Mic2, PhoneCall, Clock3, Eye, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appDataService } from '../services/appDataService';
import { meetingService } from '../services/meetingService';
import { workspaceService, type WorkGroup, type WorkGroupCall, type WorkspaceFile } from '../services/workspaceService';
import { showAppMessage } from '../lib/appMessage';
import { getAppLocale } from '../lib/appLanguage';
import './WorkGroupsPage.css';

const toLocalInput=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
const parseEmails=(value:string)=>[...new Set(value.split(/[;,\n]+/).map((item)=>item.trim().toLowerCase()).filter(Boolean))];
const formatDate=(value:string)=>new Intl.DateTimeFormat(getAppLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const formatBytes=(value:number)=>value<1024*1024?`${Math.max(1,Math.round(value/1024))} Ko`:`${(value/1024/1024).toFixed(1)} Mo`;

export default function WorkGroupsPage(){
  const navigate=useNavigate();
  const location=useLocation();
  const fileInputRef=useRef<HTMLInputElement|null>(null);
  const [groups,setGroups]=useState<WorkGroup[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [scheduling,setScheduling]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState<WorkGroup|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [groupForm,setGroupForm]=useState({name:'',description:'',emails:''});
  const [callForm,setCallForm]=useState({
    title:'',
    callType:'video' as 'audio'|'video',
    startTime:toLocalInput(new Date(Date.now()+30*60_000)),
    duration:60,
  });

  const load=async(preferredId?:string)=>{
    setLoading(true);
    try{
      const rows=await workspaceService.getWorkGroups();
      setGroups(rows);
      const target=preferredId&&rows.some((item)=>item.id===preferredId)?preferredId:(selectedId&&rows.some((item)=>item.id===selectedId)?selectedId:rows[0]?.id||'');
      setSelectedId(target);
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Groupes indisponibles.',{tone:'error'});
    }finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    if(params.get('new')==='1')setCreateOpen(true);
  },[location.search]);
  const selected=useMemo(()=>groups.find((item)=>item.id===selectedId)||null,[groups,selectedId]);

  const createGroup=async(event:FormEvent)=>{
    event.preventDefault();
    const name=groupForm.name.trim();
    const emails=parseEmails(groupForm.emails);
    if(!name)return;
    setCreating(true);
    try{
      const created=await workspaceService.createWorkGroup({name,description:groupForm.description.trim(),emails});
      setCreateOpen(false);
      setGroupForm({name:'',description:'',emails:''});
      await load(created.id);
      showAppMessage('Le groupe de travail a été créé et les invitations ont été envoyées.',{tone:'success',title:'Groupe créé'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Création du groupe impossible.',{tone:'error'});
    }finally{setCreating(false);}
  };

  const deleteGroup=async()=>{
    if(!deleteTarget)return;
    try{
      await workspaceService.deleteWorkGroup(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedId('');
      await load();
      showAppMessage('Le groupe de travail a été supprimé.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Suppression du groupe impossible.',{tone:'error'});
    }
  };

  const scheduleCall=async(event:FormEvent)=>{
    event.preventDefault();
    if(!selected)return;
    const start=new Date(callForm.startTime);
    if(Number.isNaN(start.getTime())){
      showAppMessage('Choisissez une date et une heure valides.',{tone:'warning'});
      return;
    }
    const title=callForm.title.trim()||`${callForm.callType==='video'?'Appel vidéo':'Appel audio'} · ${selected.name}`;
    const participants=selected.members.filter((member)=>member.role!=='owner').map((member)=>member.email);
    setScheduling(true);
    try{
      const meeting=await meetingService.scheduleMeeting({
        title,
        description:`Appel du groupe « ${selected.name} »`,
        startTime:start.toISOString(),
        duration:Number(callForm.duration),
        participants,
        settings:{
          callType:callForm.callType,
          waitingRoom:true,
          participantAudio:true,
          participantVideo:callForm.callType==='video',
          screenShare:true,
          chat:true,
          reactions:true,
          lunaSummary:true,
          linkSharing:true,
          externalAccess:true,
          isPublic:false,
          visibility:'private',
          encryption:true,
        },
      });
      await workspaceService.attachGroupCall(selected.id,{meetingId:meeting.id,callType:callForm.callType});
      await appDataService.createCalendarEvent({
        title,
        description:`Appel ${callForm.callType==='video'?'vidéo':'audio'} du groupe ${selected.name}`,
        startsAt:start.toISOString(),
        endsAt:new Date(start.getTime()+Number(callForm.duration)*60_000).toISOString(),
        meetingId:meeting.id,
      }).catch(()=>undefined);
      setCallForm({title:'',callType:'video',startTime:toLocalInput(new Date(Date.now()+30*60_000)),duration:60});
      await load(selected.id);
      showAppMessage('L’appel a été programmé. Les membres du groupe ont été invités par e-mail.',{tone:'success',title:'Appel programmé'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Programmation de l’appel impossible.',{tone:'error'});
    }finally{setScheduling(false);}
  };

  const uploadGroupFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file||!selected)return;
    if(!['application/pdf','image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){
      showAppMessage('Seuls les PDF et les images sont autorisés.',{tone:'warning'});
      return;
    }
    if(file.size>10*1024*1024){
      showAppMessage('Le fichier dépasse la limite de 10 Mo.',{tone:'warning'});
      return;
    }
    setUploading(true);
    try{
      await workspaceService.uploadFile(file,selected.id);
      await load(selected.id);
      showAppMessage('Le fichier a été envoyé dans le groupe.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Envoi du fichier impossible.',{tone:'error'});
    }finally{setUploading(false);}
  };

  const openCall=(call:WorkGroupCall)=>{
    if(call.status==='ended')navigate(`/reunions/${call.meetingId}/terminee`);
    else navigate(`/reunions/${call.meetingId}`);
  };

  const openFile=(file:WorkspaceFile)=>void workspaceService.openFile(file.id).catch((cause)=>showAppMessage(cause instanceof Error?cause.message:'Fichier indisponible.',{tone:'error'}));

  return <main className="work-groups-page">
    <header className="work-groups-head">
      <div><span><UsersRound size={22}/></span><div><h1>Groupes de travail</h1><p>Réunissez vos équipes, partagez des fichiers et programmez des appels audio ou vidéo.</p></div></div>
      <button type="button" onClick={()=>setCreateOpen(true)}><Plus size={18}/> Nouveau groupe</button>
    </header>

    {loading?<div className="work-groups-loading"><LoaderCircle className="is-spinning" size={22}/> Chargement des groupes…</div>:null}

    {!loading?<div className="work-groups-layout">
      <aside className="work-groups-list">
        <div className="work-groups-list-title"><strong>Mes groupes</strong><span>{groups.length}</span></div>
        {groups.length?groups.map((group)=><button key={group.id} type="button" className={selectedId===group.id?'is-active':''} onClick={()=>setSelectedId(group.id)}>
          <span>{group.name.slice(0,2).toUpperCase()}</span>
          <div><strong>{group.name}</strong><small>{group.members.length} membre{group.members.length>1?'s':''}</small></div>
        </button>):<div className="work-groups-empty"><UsersRound size={28}/><strong>Aucun groupe</strong><p>Créez votre premier groupe de travail avec les adresses e-mail de votre équipe.</p></div>}
      </aside>

      <section className="work-group-detail">
        {selected?<><header className="work-group-detail-head">
          <div><span>{selected.name.slice(0,2).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.description||'Groupe de travail MBotéRoom'}</p></div></div>
          {selected.isOwner?<button className="is-danger" type="button" onClick={()=>setDeleteTarget(selected)}><Trash2 size={16}/> Supprimer le groupe</button>:null}
        </header>

        <div className="work-group-grid">
          <section className="work-group-card">
            <div className="work-group-card-title"><UsersRound size={19}/><div><h3>Membres</h3><small>{selected.members.length}</small></div></div>
            <div className="work-group-members">{selected.members.map((member)=><article key={member.email}>
              <span>{member.avatar?<img src={member.avatar} alt=""/>:member.name.slice(0,2).toUpperCase()}</span>
              <div><strong>{member.name}</strong><small><Mail size={12}/>{member.email}</small></div>
              <b>{member.role==='owner'?'Propriétaire':'Membre'}</b>
            </article>)}</div>
          </section>

          <section className="work-group-card">
            <div className="work-group-card-title"><CalendarClock size={19}/><div><h3>Programmer un appel</h3><small>Audio ou vidéo</small></div></div>
            <form className="work-group-call-form" onSubmit={scheduleCall}>
              <label>Titre<input value={callForm.title} onChange={(event)=>setCallForm((current)=>({...current,title:event.target.value}))} placeholder={`Appel · ${selected.name}`}/></label>
              <div className="work-group-call-type">
                <button type="button" className={callForm.callType==='video'?'is-active':''} onClick={()=>setCallForm((current)=>({...current,callType:'video'}))}><Video size={18}/> Vidéo</button>
                <button type="button" className={callForm.callType==='audio'?'is-active':''} onClick={()=>setCallForm((current)=>({...current,callType:'audio'}))}><Mic2 size={18}/> Audio</button>
              </div>
              <div className="work-group-call-row">
                <label>Date et heure<input required type="datetime-local" value={callForm.startTime} onChange={(event)=>setCallForm((current)=>({...current,startTime:event.target.value}))}/></label>
                <label>Durée<select value={callForm.duration} onChange={(event)=>setCallForm((current)=>({...current,duration:Number(event.target.value)}))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 heure</option><option value={90}>1 h 30</option><option value={120}>2 heures</option></select></label>
              </div>
              <button className="work-group-primary" type="submit" disabled={scheduling}>{scheduling?<LoaderCircle className="is-spinning" size={17}/>:<PhoneCall size={17}/>} {scheduling?'Programmation…':'Programmer et inviter le groupe'}</button>
            </form>
          </section>
        </div>

        <section className="work-group-card work-group-wide">
          <div className="work-group-card-title work-group-card-title-actions"><div><CalendarClock size={19}/><div><h3>Appels du groupe</h3><small>{selected.calls.length}</small></div></div></div>
          {selected.calls.length?<div className="work-group-calls">{selected.calls.map((call)=><article key={call.id}>
            <span className={call.callType==='video'?'is-video':'is-audio'}>{call.callType==='video'?<Video size={18}/>:<Mic2 size={18}/>}</span>
            <div><strong>{call.title}</strong><small><Clock3 size={12}/>{formatDate(call.startTime)} · {call.duration} min</small></div>
            <b>{call.status==='live'?'En direct':call.status==='ended'?'Terminé':'Programmé'}</b>
            <button type="button" onClick={()=>openCall(call)}>{call.status==='ended'?'Résumé':'Ouvrir'}</button>
          </article>)}</div>:<p className="work-group-empty-text">Aucun appel programmé dans ce groupe.</p>}
        </section>

        <section className="work-group-card work-group-wide">
          <div className="work-group-card-title work-group-card-title-actions">
            <div><Upload size={19}/><div><h3>Fichiers du groupe</h3><small>{selected.files.length}</small></div></div>
            <button type="button" disabled={uploading} onClick={()=>fileInputRef.current?.click()}>{uploading?<LoaderCircle className="is-spinning" size={15}/>:<Upload size={15}/>} {uploading?'Envoi…':'Envoyer PDF ou image'}</button>
            <input ref={fileInputRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={uploadGroupFile}/>
          </div>
          {selected.files.length?<div className="work-group-files">{selected.files.map((file)=><article key={file.id}>
            <span>{file.mimeType==='application/pdf'?<FileText size={18}/>:<FileImage size={18}/>}</span>
            <div><strong>{file.name}</strong><small>{formatBytes(file.sizeBytes)}</small></div>
            <button type="button" onClick={()=>openFile(file)}><Eye size={15}/> Ouvrir</button>
          </article>)}</div>:<p className="work-group-empty-text">Aucun fichier partagé dans ce groupe.</p>}
        </section>
        </>:<div className="work-group-detail-empty"><UsersRound size={42}/><h2>Choisissez un groupe</h2><p>Les membres, appels et fichiers du groupe apparaîtront ici.</p></div>}
      </section>
    </div>:null}

    {createOpen?<div className="work-group-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setCreateOpen(false);}}>
      <form className="work-group-modal" onSubmit={createGroup}>
        <header><div><span><UsersRound size={20}/></span><div><h2>Nouveau groupe de travail</h2><p>Ajoutez les membres à partir de leurs adresses e-mail.</p></div></div><button type="button" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={19}/></button></header>
        <label>Nom du groupe<input required maxLength={120} value={groupForm.name} onChange={(event)=>setGroupForm((current)=>({...current,name:event.target.value}))} placeholder="Ex. Équipe produit"/></label>
        <label>Description<textarea maxLength={600} value={groupForm.description} onChange={(event)=>setGroupForm((current)=>({...current,description:event.target.value}))} placeholder="Objectif du groupe"/></label>
        <label>Adresses e-mail des membres<textarea required value={groupForm.emails} onChange={(event)=>setGroupForm((current)=>({...current,emails:event.target.value}))} placeholder={"amina@exemple.com; paul@exemple.com\nfatou@exemple.com"}/><small>Séparez les adresses par une virgule, un point-virgule ou un retour à la ligne.</small></label>
        <footer><button type="button" className="secondary" onClick={()=>setCreateOpen(false)}>Annuler</button><button type="submit" disabled={creating}>{creating?<LoaderCircle className="is-spinning" size={16}/>:<Plus size={16}/>} Créer le groupe</button></footer>
      </form>
    </div>:null}

    {deleteTarget?<div className="work-group-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDeleteTarget(null);}}>
      <section className="work-group-delete-modal" role="dialog" aria-modal="true">
        <span><Trash2 size={25}/></span><h2>Supprimer le groupe ?</h2><p>Le groupe « {deleteTarget.name} » et ses liens de fichiers seront supprimés. Les réunions déjà créées restent conservées dans l’historique MBotéRoom.</p>
        <div><button type="button" className="secondary" onClick={()=>setDeleteTarget(null)}>Annuler</button><button type="button" className="danger" onClick={()=>void deleteGroup()}><Trash2 size={16}/> Supprimer</button></div>
      </section>
    </div>:null}
  </main>;
}
