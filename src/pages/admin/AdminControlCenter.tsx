import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, FileText, Flag, LockKeyhole, LogOut, MailPlus, MapPin, RefreshCw, Save, Search, Settings2, ShieldAlert, ShieldCheck, Trash2, UserCog, UsersRound } from 'lucide-react';
import {
  AdminInvite,
  AdminLegalDocument,
  AdminManagedUser,
  AdminPlatformSettings,
  AdminReport,
  adminDashboardService,
} from '../../services/adminDashboardService';
import { authService } from '../../services/authService';
import './AdminControlCenter.css';

const generalLabels: Array<{key:keyof AdminPlatformSettings;title:string;description:string}>=[
  {key:'registrationEnabled',title:'Création de comptes',description:'Autoriser ou fermer les nouvelles inscriptions.'},
  {key:'guestAccessEnabled',title:'Accès sans compte',description:'Autoriser les invités à rejoindre une réunion.'},
  {key:'meetingCreationEnabled',title:'Création de réunions',description:'Autoriser les utilisateurs à créer de nouvelles réunions.'},
  {key:'publicMeetingsEnabled',title:'Réunions publiques',description:'Afficher ou masquer les réunions accessibles publiquement.'},
  {key:'lunaEnabled',title:'Luna',description:'Autoriser l’assistance Luna dans les réunions.'},
  {key:'recordingEnabled',title:'Enregistrement',description:'Autoriser les utilisateurs autorisés à enregistrer une réunion.'},
  {key:'premiumPaymentEnabled',title:'Paiement Premium',description:'Activer uniquement lorsque le système de paiement Premium est réellement raccordé.'},
];

const guestLabels: Array<{key:keyof AdminPlatformSettings;title:string;description:string}>=[
  {key:'guestRaiseHandEnabled',title:'Invités · Lever la main',description:'Autoriser les invités sans compte à lever ou baisser la main.'},
  {key:'guestRecordingEnabled',title:'Invités · Enregistrement',description:'Autoriser les invités sans compte à utiliser l’enregistrement lorsque la réunion le permet.'},
  {key:'guestScreenShareEnabled',title:'Invités · Partage d’écran',description:'Autoriser les invités sans compte à partager leur écran.'},
  {key:'guestLunaEnabled',title:'Invités · Luna IA',description:'Autoriser les invités sans compte à ouvrir et utiliser Luna IA.'},
  {key:'guestTranscriptionEnabled',title:'Invités · Transcription',description:'Autoriser les invités sans compte à utiliser les sous-titres et la transcription.'},
  {key:'guestChatEnabled',title:'Invités · Messages',description:'Autoriser les invités sans compte à envoyer des messages pendant la réunion.'},
];

const emptySettings:AdminPlatformSettings={
  registrationEnabled:true,guestAccessEnabled:true,meetingCreationEnabled:true,
  lunaEnabled:true,recordingEnabled:true,publicMeetingsEnabled:true,premiumPaymentEnabled:false,
  guestRaiseHandEnabled:false,guestRecordingEnabled:false,guestScreenShareEnabled:false,
  guestLunaEnabled:false,guestTranscriptionEnabled:false,guestChatEnabled:false,
};

const restrictionOptions=[
  {id:'meetings',label:'Création de réunions'},
  {id:'messages',label:'Messagerie'},
  {id:'groups',label:'Création de groupes'},
  {id:'files',label:'Envoi de fichiers'},
  {id:'recording',label:'Enregistrement'},
  {id:'luna',label:'Luna IA'},
  {id:'screenShare',label:'Partage d’écran'},
] as const;

const emptyTerms:AdminLegalDocument={key:'terms',title:'Conditions d’utilisation MBotéRoom',body:'',version:'',updatedAt:''};

export default function AdminControlCenter(){
  const current=authService.getCurrentUser();
  const [settings,setSettings]=useState<AdminPlatformSettings>(emptySettings);
  const [users,setUsers]=useState<AdminManagedUser[]>([]);
  const [adminInvites,setAdminInvites]=useState<AdminInvite[]>([]);
  const [terms,setTerms]=useState<AdminLegalDocument>(emptyTerms);
  const [reports,setReports]=useState<AdminReport[]>([]);
  const [termsDraft,setTermsDraft]=useState({title:'',body:''});
  const [countryFilter,setCountryFilter]=useState('');
  const [cityFilter,setCityFilter]=useState('');
  const [organizationFilter,setOrganizationFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [minAge,setMinAge]=useState('');
  const [maxAge,setMaxAge]=useState('');
  const [adminInviteEmail,setAdminInviteEmail]=useState('');
  const [lastInvitePath,setLastInvitePath]=useState('');
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [termsBusy,setTermsBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [editing,setEditing]=useState<AdminManagedUser|null>(null);
  const [revokeTarget,setRevokeTarget]=useState<AdminManagedUser|null>(null);
  const [draft,setDraft]=useState({
    name:'',phoneNumber:'',organization:'',jobTitle:'',country:'',city:'',
    accountStatus:'active' as AdminManagedUser['accountStatus'],
    featureRestrictions:[] as string[],
  });

  const load=async()=>{
    setBusy(true);setError('');
    try{
      const [nextSettings,nextUsers,nextInvites,nextTerms,nextReports]=await Promise.all([
        adminDashboardService.getPlatformSettings(),
        adminDashboardService.getUsers(),
        adminDashboardService.getAdminInvites().catch(()=>[]),
        adminDashboardService.getTerms().catch(()=>emptyTerms),
        adminDashboardService.getReports().catch(()=>[]),
      ]);
      setSettings(nextSettings);setUsers(nextUsers);setAdminInvites(nextInvites);
      setTerms(nextTerms);setTermsDraft({title:nextTerms.title,body:nextTerms.body});setReports(nextReports);
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les outils du backoffice.');}
    finally{setBusy(false);}
  };
  useEffect(()=>{void load();},[]);

  const countries=useMemo<string[]>(()=>Array.from(new Set(users.map(user=>String(user.country||'')).filter(value=>value.length>0))).sort((a,b)=>a.localeCompare(b)),[users]);
  const cities=useMemo<string[]>(()=>Array.from(new Set(users.filter(user=>!countryFilter||user.country===countryFilter).map(user=>String(user.city||'')).filter(value=>value.length>0))).sort((a,b)=>a.localeCompare(b)),[countryFilter,users]);
  const organizations=useMemo<string[]>(()=>Array.from(new Set(users.map(user=>String(user.organization||'')).filter(value=>value.length>0))).sort((a,b)=>a.localeCompare(b)),[users]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    const ageMin=minAge?Number(minAge):null;
    const ageMax=maxAge?Number(maxAge):null;
    return users.filter(user=>{
      if(q&&![user.name,user.email,user.username,user.organization,user.jobTitle,user.country,user.city].some(value=>String(value||'').toLowerCase().includes(q)))return false;
      if(countryFilter&&user.country!==countryFilter)return false;
      if(cityFilter&&user.city!==cityFilter)return false;
      if(organizationFilter&&user.organization!==organizationFilter)return false;
      if(statusFilter==='suspended'&&!user.isSuspended)return false;
      if(statusFilter&&statusFilter!=='suspended'&&user.accountStatus!==statusFilter)return false;
      if(ageMin!==null&&(user.age===null||user.age<ageMin))return false;
      if(ageMax!==null&&(user.age===null||user.age>ageMax))return false;
      return true;
    });
  },[search,users,countryFilter,cityFilter,organizationFilter,statusFilter,minAge,maxAge]);

  const toggle=async(key:keyof AdminPlatformSettings)=>{
    const previous=settings;
    const next={...settings,[key]:!settings[key]};
    setSettings(next);setMessage('');setError('');
    try{
      setSettings(await adminDashboardService.updatePlatformSettings({[key]:next[key]}));
      setMessage('Réglage mis à jour.');
    }catch(cause){setSettings(previous);setError(cause instanceof Error?cause.message:'Modification impossible.');}
  };

  const startEdit=(user:AdminManagedUser)=>{
    setEditing(user);
    setDraft({
      name:user.name,phoneNumber:user.phoneNumber,organization:user.organization,jobTitle:user.jobTitle,
      country:user.country,city:user.city,accountStatus:user.accountStatus,featureRestrictions:[...(user.featureRestrictions||[])],
    });
  };

  const saveUser=async(event:FormEvent)=>{
    event.preventDefault();
    if(!editing)return;
    setBusy(true);setError('');setMessage('');
    try{
      const updated=await adminDashboardService.updateUser(editing.id,draft);
      setUsers(list=>list.map(item=>item.id===updated.id?updated:item));
      setEditing(null);setMessage('Informations utilisateur mises à jour.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Mise à jour impossible.');}
    finally{setBusy(false);}
  };

  const toggleSuspension=async(user:AdminManagedUser)=>{
    if(String(user.id)===String(current?.id)&&!user.isSuspended){setError('Vous ne pouvez pas suspendre votre propre compte.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      const updated=await adminDashboardService.updateUser(user.id,{isSuspended:!user.isSuspended});
      setUsers(list=>list.map(item=>item.id===updated.id?updated:item));
      setMessage(updated.isSuspended?'Compte suspendu.':'Compte réactivé.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Action impossible.');}
    finally{setBusy(false);}
  };

  const setAccountStatus=async(user:AdminManagedUser,status:AdminManagedUser['accountStatus'])=>{
    if(String(user.id)===String(current?.id)&&status!=='active'){setError('Vous ne pouvez pas restreindre votre propre compte administrateur.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      const updated=await adminDashboardService.updateUser(user.id,{accountStatus:status});
      setUsers(list=>list.map(item=>item.id===updated.id?updated:item));
      setMessage(status==='banned'?'Compte banni et sessions fermées.':status==='quarantined'?'Compte placé en quarantaine.':'Compte remis en état actif.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Action impossible.');}
    finally{setBusy(false);}
  };

  const saveTerms=async(event:FormEvent)=>{
    event.preventDefault();
    setTermsBusy(true);setError('');setMessage('');
    try{
      const next=await adminDashboardService.updateTerms({title:termsDraft.title.trim(),body:termsDraft.body.trim()});
      setTerms(next);setTermsDraft({title:next.title,body:next.body});
      setMessage('Conditions d’utilisation publiées. Une nouvelle version est maintenant active.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Publication des conditions impossible.');}
    finally{setTermsBusy(false);}
  };

  const updateReport=async(report:AdminReport,status:AdminReport['status'])=>{
    setBusy(true);setError('');setMessage('');
    try{
      const next=await adminDashboardService.updateReport(report.id,status);
      setReports(rows=>rows.map(item=>item.id===next.id?{...item,...next}:item));
      setMessage('État du signalement mis à jour.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Mise à jour du signalement impossible.');}
    finally{setBusy(false);}
  };

  const revokeSessions=async(user:AdminManagedUser)=>{
    setBusy(true);setError('');setMessage('');
    try{
      await adminDashboardService.revokeUserSessions(user.id);
      setRevokeTarget(null);
      setMessage(`${user.name} a été déconnecté de tous ses appareils.`);
    }catch(cause){setError(cause instanceof Error?cause.message:'Déconnexion impossible.');}
    finally{setBusy(false);}
  };

  const createAdminInvite=async(event:FormEvent)=>{
    event.preventDefault();
    if(!adminInviteEmail.trim())return;
    setBusy(true);setError('');setMessage('');setLastInvitePath('');
    try{
      const invite=await adminDashboardService.createAdminInvite(adminInviteEmail.trim());
      setAdminInvites(list=>[invite,...list.filter(item=>item.id!==invite.id)]);
      setAdminInviteEmail('');
      setLastInvitePath(invite.invitePath||'');
      setMessage('Invitation administrateur créée. Copiez le lien et envoyez-le à la personne concernée.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Création de l’invitation impossible.');}
    finally{setBusy(false);}
  };

  const copyAdminInvite=async(invitePath:string)=>{
    if(!invitePath)return;
    const absolute=new URL(invitePath,window.location.origin).toString();
    try{
      await navigator.clipboard.writeText(absolute);
      setMessage('Lien d’invitation administrateur copié.');
    }catch{
      setMessage(absolute);
    }
  };

  const revokeAdminInvite=async(invite:AdminInvite)=>{
    setBusy(true);setError('');setMessage('');
    try{
      await adminDashboardService.revokeAdminInvite(invite.id);
      setAdminInvites(list=>list.map(item=>item.id===invite.id?{...item,consumedAt:new Date().toISOString()}:item));
      setMessage('Invitation administrateur révoquée.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Révocation impossible.');}
    finally{setBusy(false);}
  };

  return <>
    <section className="admin-control-card" id="admin-controls">
      <header><div><span className="admin-control-icon"><Settings2 size={20}/></span><div><h2>Réglages généraux</h2><p>Activez ou bloquez les fonctions principales pour tous les utilisateurs.</p></div></div><button type="button" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> Actualiser</button></header>
      {error&&<div className="admin-control-error" role="alert">{error}</div>}
      {message&&<div className="admin-control-message" role="status">{message}</div>}
      <div className="admin-control-grid">
        {generalLabels.map(item=><article key={item.key} className={settings[item.key]?'is-enabled':'is-disabled'}>
          <span>{settings[item.key]?<CheckCircle2 size={19}/>:<LockKeyhole size={19}/>}</span>
          <div><strong>{item.title}</strong><small>{item.description}</small></div>
          <button type="button" role="switch" aria-label={item.title} aria-checked={settings[item.key]} onClick={()=>void toggle(item.key)} disabled={busy}><i/></button>
        </article>)}
      </div>

      <div className="admin-control-subsection">
        <div><span className="admin-control-icon guest"><UsersRound size={18}/></span><div><h3>Droits des invités en réunion</h3><p>Par défaut, ces actions sont bloquées pour les personnes qui rejoignent MBotéRoom sans compte. Vous pouvez les autoriser individuellement.</p></div></div>
        <span className="admin-control-default-badge">Par défaut : bloqués</span>
      </div>
      <div className="admin-control-grid admin-control-guest-grid">
        {guestLabels.map(item=><article key={item.key} className={settings[item.key]?'is-enabled':'is-disabled'}>
          <span>{settings[item.key]?<CheckCircle2 size={19}/>:<LockKeyhole size={19}/>}</span>
          <div><strong>{item.title}</strong><small>{item.description}</small></div>
          <button type="button" role="switch" aria-label={item.title} aria-checked={settings[item.key]} onClick={()=>void toggle(item.key)} disabled={busy}><i/></button>
        </article>)}
      </div>
      <div className="admin-control-note"><ShieldCheck size={17}/><span>Ces réglages sont appliqués côté interface, API, temps réel et médias : masquer un bouton ne suffit pas à contourner la restriction.</span></div>
    </section>

    <section className="admin-legal-card" id="admin-legal-terms">
      <header><div><span className="admin-control-icon"><FileText size={20}/></span><div><h2>Conditions d’utilisation</h2><p>Texte obligatoire affiché à l’inscription et aux invités. Chaque publication crée une nouvelle version.</p></div></div><strong>{terms.version?'Version '+terms.version:'Non publiée'}</strong></header>
      <form className="admin-legal-form" onSubmit={saveTerms}>
        <label>Titre<input value={termsDraft.title} onChange={event=>setTermsDraft(value=>({...value,title:event.target.value}))} maxLength={180} required/></label>
        <label>Texte<textarea value={termsDraft.body} onChange={event=>setTermsDraft(value=>({...value,body:event.target.value}))} rows={12} maxLength={30000} required/></label>
        <div><small>{termsDraft.body.length}/30000 caractères</small><button disabled={termsBusy||termsDraft.body.trim().length<80}><Save size={16}/>{termsBusy?'Publication…':'Publier la nouvelle version'}</button></div>
      </form>
    </section>

    <section className="admin-reports-card" id="admin-reports">
      <header><div><span className="admin-control-icon"><Flag size={20}/></span><div><h2>Signalements</h2><p>Bugs et réunions signalés par les utilisateurs. Le support et les administrateurs reçoivent aussi un e-mail ou une notification.</p></div></div><strong>{reports.filter(report=>report.status==='open').length} ouvert(s)</strong></header>
      <div className="admin-reports-list">
        {reports.length?reports.map(report=><article key={report.id}>
          <div className="admin-report-main">
            <span className={report.type==='bug'?'bug':'meeting'}>{report.type==='bug'?'Bug':'Réunion'}</span>
            <div><strong>{report.title}</strong><small>{report.reporterName||report.reporterEmail||'Utilisateur'} · {new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(report.createdAt))}{report.meetingId?' · Réunion #'+report.meetingId:''}</small><p>{report.description}</p></div>
          </div>
          <select value={report.status} onChange={event=>void updateReport(report,event.target.value as AdminReport['status'])} disabled={busy}>
            <option value="open">Ouvert</option><option value="reviewing">En analyse</option><option value="resolved">Résolu</option><option value="dismissed">Classé</option>
          </select>
        </article>):<p className="admin-control-empty">Aucun signalement.</p>}
      </div>
    </section>

    <section className="admin-admin-invites-card" id="admin-admin-invites">
      <header><div><span className="admin-control-icon"><MailPlus size={20}/></span><div><h2>Administrateurs</h2><p>Créez un lien sécurisé pour autoriser un nouveau compte administrateur.</p></div></div><strong>{users.filter(user=>user.role==='admin'&&!user.isSuspended).length} admin(s) actif(s)</strong></header>
      <form className="admin-admin-invite-form" onSubmit={createAdminInvite}>
        <label><span>Adresse e-mail du nouvel administrateur</span><input type="email" value={adminInviteEmail} onChange={event=>setAdminInviteEmail(event.target.value)} placeholder="admin@exemple.com" required/></label>
        <button type="submit" disabled={busy||!adminInviteEmail.trim()}><MailPlus size={16}/> Créer l’invitation</button>
      </form>
      {lastInvitePath&&<div className="admin-admin-invite-created"><div><strong>Invitation prête</strong><small>{new URL(lastInvitePath,window.location.origin).toString()}</small></div><button type="button" onClick={()=>void copyAdminInvite(lastInvitePath)}><Copy size={15}/> Copier le lien</button></div>}
      <div className="admin-admin-invite-list">
        {adminInvites.length?adminInvites.slice(0,8).map(invite=>{
          const expired=new Date(invite.expiresAt).getTime()<=Date.now();
          const inactive=Boolean(invite.consumedAt)||expired;
          return <article key={invite.id} className={inactive?'is-inactive':''}>
            <div><strong>{invite.email}</strong><small>{invite.consumedAt?'Utilisée ou révoquée':expired?'Expirée':'Expire le '+new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(invite.expiresAt))}</small></div>
            {!inactive&&invite.invitePath?<button type="button" onClick={()=>void copyAdminInvite(invite.invitePath||'')}><Copy size={14}/> Copier</button>:null}
            {!inactive?<button type="button" className="is-danger" onClick={()=>void revokeAdminInvite(invite)} disabled={busy}><Trash2 size={14}/> Révoquer</button>:null}
          </article>;
        }):<p className="admin-control-empty">Aucune invitation administrateur récente.</p>}
      </div>
      <div className="admin-control-note"><ShieldCheck size={17}/><span>Un nouvel administrateur ne peut plus s’auto-promouvoir simplement parce qu’un autre compte admin existe. Il doit utiliser ce lien d’invitation et confirmer son adresse avec le code OTP.</span></div>
    </section>

    <section className="admin-users-card" id="admin-users">
      <header><div><span className="admin-control-icon"><UsersRound size={20}/></span><div><h2>Utilisateurs</h2><p>Filtrez les comptes par pays, ville, âge, entreprise et état, puis appliquez des restrictions.</p></div></div><strong>{filtered.length} / {users.length} compte(s)</strong></header>
      <div className="admin-user-filters">
        <label className="admin-users-search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nom, e-mail, entreprise…"/></label>
        <select value={countryFilter} onChange={event=>{setCountryFilter(event.target.value);setCityFilter('');}}><option value="">Tous les pays</option>{countries.map(value=><option key={value}>{value}</option>)}</select>
        <select value={cityFilter} onChange={event=>setCityFilter(event.target.value)}><option value="">Toutes les villes</option>{cities.map(value=><option key={value}>{value}</option>)}</select>
        <select value={organizationFilter} onChange={event=>setOrganizationFilter(event.target.value)}><option value="">Toutes les entreprises</option>{organizations.map(value=><option key={value}>{value}</option>)}</select>
        <select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">Tous les états</option><option value="active">Actifs</option><option value="quarantined">Quarantaine</option><option value="banned">Bannis</option><option value="suspended">Suspendus</option></select>
        <input className="admin-age-filter" type="number" min="0" max="120" placeholder="Âge min." value={minAge} onChange={event=>setMinAge(event.target.value)}/>
        <input className="admin-age-filter" type="number" min="0" max="120" placeholder="Âge max." value={maxAge} onChange={event=>setMaxAge(event.target.value)}/>
      </div>
      <div className="admin-users-table-wrap">
        <table className="admin-users-table"><thead><tr><th>Utilisateur</th><th>Localisation / âge</th><th>Entreprise</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map(user=><tr key={user.id}>
            <td><div className="admin-user-identity"><span>{user.name.slice(0,2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small><small>@{user.username}</small></div></div></td>
            <td><strong className="admin-user-location"><MapPin size={12}/>{[user.city,user.country].filter(Boolean).join(', ')||'—'}</strong><small>{user.age!==null?user.age+' ans':'Âge non renseigné'}</small></td>
            <td><strong>{user.organization||'—'}</strong><small>{user.jobTitle||''}</small></td>
            <td><span className={user.isSuspended?'admin-state-badge is-suspended':'admin-state-badge is-'+user.accountStatus}>{user.isSuspended?'Suspendu':user.accountStatus==='quarantined'?'Quarantaine':user.accountStatus==='banned'?'Banni':'Actif'}</span>{user.featureRestrictions?.length?<small>{user.featureRestrictions.length} fonction(s) bloquée(s)</small>:null}</td>
            <td><div className="admin-user-actions">
              <button type="button" onClick={()=>startEdit(user)}><UserCog size={15}/> Gérer</button>
              {user.accountStatus==='active'?<button type="button" onClick={()=>void setAccountStatus(user,'quarantined')} disabled={busy||String(user.id)===String(current?.id)}><ShieldAlert size={15}/> Quarantaine</button>:<button type="button" className="is-restore" onClick={()=>void setAccountStatus(user,'active')} disabled={busy||String(user.id)===String(current?.id)}><CheckCircle2 size={15}/> Activer</button>}
              {user.accountStatus!=='banned'?<button type="button" className="is-danger" onClick={()=>void setAccountStatus(user,'banned')} disabled={busy||String(user.id)===String(current?.id)}><Ban size={15}/> Bannir</button>:null}
              <button type="button" onClick={()=>setRevokeTarget(user)} disabled={busy||String(user.id)===String(current?.id)} title="Fermer toutes les sessions de ce compte"><LogOut size={15}/> Déconnecter</button>
            </div></td>
          </tr>)}</tbody></table>
      </div>
      {!filtered.length&&<p className="admin-control-empty">Aucun compte ne correspond aux filtres.</p>}
    </section>

    {editing&&<div className="admin-edit-backdrop" onMouseDown={()=>setEditing(null)}>
      <form className="admin-edit-user admin-edit-user-wide" onSubmit={saveUser} onMouseDown={event=>event.stopPropagation()}>
        <header><span><UserCog size={21}/></span><div><h2>Gérer le compte</h2><p>{editing.email}</p></div></header>
        <div className="admin-edit-grid">
          <label>Nom complet<input value={draft.name} onChange={event=>setDraft(value=>({...value,name:event.target.value}))} required maxLength={120}/></label>
          <label>Téléphone<input value={draft.phoneNumber} onChange={event=>setDraft(value=>({...value,phoneNumber:event.target.value}))} maxLength={40}/></label>
          <label>Organisation<input value={draft.organization} onChange={event=>setDraft(value=>({...value,organization:event.target.value}))} maxLength={120}/></label>
          <label>Fonction<input value={draft.jobTitle} onChange={event=>setDraft(value=>({...value,jobTitle:event.target.value}))} maxLength={120}/></label>
          <label>Pays<input value={draft.country} onChange={event=>setDraft(value=>({...value,country:event.target.value}))} maxLength={120}/></label>
          <label>Ville<input value={draft.city} onChange={event=>setDraft(value=>({...value,city:event.target.value}))} maxLength={120}/></label>
          <label className="wide">État du compte<select value={draft.accountStatus} onChange={event=>setDraft(value=>({...value,accountStatus:event.target.value as AdminManagedUser['accountStatus']}))}><option value="active">Actif</option><option value="quarantined">Quarantaine</option><option value="banned">Banni</option></select></label>
        </div>
        <fieldset className="admin-feature-restrictions"><legend>Fonctionnalités bloquées pour ce compte</legend>{restrictionOptions.map(option=><label key={option.id}><input type="checkbox" checked={draft.featureRestrictions.includes(option.id)} onChange={event=>setDraft(value=>({...value,featureRestrictions:event.target.checked?[...value.featureRestrictions,option.id]:value.featureRestrictions.filter(item=>item!==option.id)}))}/><span>{option.label}</span></label>)}</fieldset>
        <div className="admin-edit-actions"><button type="button" onClick={()=>setEditing(null)}>Annuler</button><button type="submit" className="primary" disabled={busy}><Save size={16}/> Enregistrer</button></div>
      </form>
    </div>}

    {revokeTarget&&<div className="admin-edit-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setRevokeTarget(null);}}>
      <section className="admin-revoke-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-revoke-title">
        <span><LogOut size={25}/></span>
        <h2 id="admin-revoke-title">Déconnecter tous les appareils ?</h2>
        <p><strong>{revokeTarget.name}</strong> devra se reconnecter sur chacun de ses appareils.</p>
        <div><button type="button" onClick={()=>setRevokeTarget(null)} disabled={busy}>Annuler</button><button type="button" className="is-danger" onClick={()=>void revokeSessions(revokeTarget)} disabled={busy}><LogOut size={16}/>{busy?'Déconnexion…':'Déconnecter'}</button></div>
      </section>
    </div>}
  </>;
}
