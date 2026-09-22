import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, LockKeyhole, LogOut, RefreshCw, Save, Search, Settings2, ShieldCheck, UserCog, UsersRound } from 'lucide-react';
import {
  AdminManagedUser,
  AdminPlatformSettings,
  adminDashboardService,
} from '../../services/adminDashboardService';
import { authService } from '../../services/authService';
import './AdminControlCenter.css';

const labels: Array<{key:keyof AdminPlatformSettings;title:string;description:string;danger?:boolean}>=[
  {key:'registrationEnabled',title:'Création de comptes',description:'Autoriser ou fermer les nouvelles inscriptions.'},
  {key:'guestAccessEnabled',title:'Accès sans compte',description:'Autoriser les invités à rejoindre une réunion.'},
  {key:'meetingCreationEnabled',title:'Création de réunions',description:'Autoriser les utilisateurs à créer de nouvelles réunions.'},
  {key:'publicMeetingsEnabled',title:'Réunions publiques',description:'Afficher ou masquer les réunions accessibles publiquement.'},
  {key:'lunaEnabled',title:'Luna',description:'Autoriser l’assistance Luna dans les réunions.'},
  {key:'recordingEnabled',title:'Enregistrement',description:'Autoriser les utilisateurs à enregistrer une réunion.'},
];

const emptySettings:AdminPlatformSettings={
  registrationEnabled:true,guestAccessEnabled:true,meetingCreationEnabled:true,
  lunaEnabled:true,recordingEnabled:true,publicMeetingsEnabled:true,
};

export default function AdminControlCenter(){
  const current=authService.getCurrentUser();
  const [settings,setSettings]=useState<AdminPlatformSettings>(emptySettings);
  const [users,setUsers]=useState<AdminManagedUser[]>([]);
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [editing,setEditing]=useState<AdminManagedUser|null>(null);
  const [draft,setDraft]=useState({name:'',phoneNumber:'',organization:'',jobTitle:''});

  const load=async()=>{
    setBusy(true);setError('');
    try{
      const [nextSettings,nextUsers]=await Promise.all([
        adminDashboardService.getPlatformSettings(),
        adminDashboardService.getUsers(),
      ]);
      setSettings(nextSettings);setUsers(nextUsers);
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les outils du backoffice.');}
    finally{setBusy(false);}
  };
  useEffect(()=>{void load();},[]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    if(!q)return users;
    return users.filter(user=>[user.name,user.email,user.username,user.organization,user.jobTitle].some(value=>String(value||'').toLowerCase().includes(q)));
  },[search,users]);

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
    setDraft({name:user.name,phoneNumber:user.phoneNumber,organization:user.organization,jobTitle:user.jobTitle});
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

  const revokeSessions=async(user:AdminManagedUser)=>{
    if(!window.confirm(`Déconnecter ${user.name} de tous ses appareils ?`))return;
    setBusy(true);setError('');setMessage('');
    try{await adminDashboardService.revokeUserSessions(user.id);setMessage(`${user.name} a été déconnecté de tous ses appareils.`);}
    catch(cause){setError(cause instanceof Error?cause.message:'Déconnexion impossible.');}
    finally{setBusy(false);}
  };

  return <>
    <section className="admin-control-card" id="admin-controls">
      <header><div><span className="admin-control-icon"><Settings2 size={20}/></span><div><h2>Réglages généraux</h2><p>Activez ou bloquez les fonctions principales pour tous les utilisateurs.</p></div></div><button type="button" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> Actualiser</button></header>
      {error&&<div className="admin-control-error" role="alert">{error}</div>}
      {message&&<div className="admin-control-message" role="status">{message}</div>}
      <div className="admin-control-grid">
        {labels.map(item=><article key={item.key} className={settings[item.key]?'is-enabled':'is-disabled'}>
          <span>{settings[item.key]?<CheckCircle2 size={19}/>:<LockKeyhole size={19}/>}</span>
          <div><strong>{item.title}</strong><small>{item.description}</small></div>
          <button type="button" role="switch" aria-label={item.title} aria-checked={settings[item.key]} onClick={()=>void toggle(item.key)} disabled={busy}><i/></button>
        </article>)}
      </div>
      <div className="admin-control-note"><ShieldCheck size={17}/><span>Ces réglages sont appliqués côté application et côté serveur : ils ne sont pas seulement visuels.</span></div>
    </section>

    <section className="admin-users-card" id="admin-users">
      <header><div><span className="admin-control-icon"><UsersRound size={20}/></span><div><h2>Utilisateurs</h2><p>Consultez, modifiez ou suspendez les comptes.</p></div></div><strong>{users.length} compte(s)</strong></header>
      <label className="admin-users-search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Rechercher un nom, une adresse ou une organisation"/></label>
      <div className="admin-users-table-wrap">
        <table className="admin-users-table"><thead><tr><th>Utilisateur</th><th>Organisation</th><th>Rôle</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map(user=><tr key={user.id}>
            <td><div className="admin-user-identity"><span>{user.name.slice(0,2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></td>
            <td><strong>{user.organization||'—'}</strong><small>{user.jobTitle||''}</small></td>
            <td><span className={'admin-role-badge is-'+user.role}>{user.role==='admin'?'Administrateur':user.isGuest?'Invité':'Utilisateur'}</span></td>
            <td><span className={user.isSuspended?'admin-state-badge is-suspended':'admin-state-badge is-active'}>{user.isSuspended?'Suspendu':'Actif'}</span></td>
            <td><div className="admin-user-actions"><button type="button" onClick={()=>startEdit(user)}><UserCog size={15}/> Modifier</button><button type="button" className={user.isSuspended?'is-restore':'is-danger'} onClick={()=>void toggleSuspension(user)} disabled={busy||String(user.id)===String(current?.id)}>{user.isSuspended?<><CheckCircle2 size={15}/> Réactiver</>:<><Ban size={15}/> Suspendre</>}</button><button type="button" onClick={()=>void revokeSessions(user)} disabled={busy||String(user.id)===String(current?.id)} title="Fermer toutes les sessions de ce compte"><LogOut size={15}/> Déconnecter</button></div></td>
          </tr>)}</tbody></table>
      </div>
      {!filtered.length&&<p className="admin-control-empty">Aucun compte ne correspond à cette recherche.</p>}
    </section>

    {editing&&<div className="admin-edit-backdrop" onMouseDown={()=>setEditing(null)}>
      <form className="admin-edit-user" onSubmit={saveUser} onMouseDown={event=>event.stopPropagation()}>
        <header><span><UserCog size={21}/></span><div><h2>Modifier le compte</h2><p>{editing.email}</p></div></header>
        <label>Nom complet<input value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} required maxLength={120}/></label>
        <label>Téléphone<input value={draft.phoneNumber} onChange={e=>setDraft(v=>({...v,phoneNumber:e.target.value}))} maxLength={40}/></label>
        <label>Organisation<input value={draft.organization} onChange={e=>setDraft(v=>({...v,organization:e.target.value}))} maxLength={120}/></label>
        <label>Fonction<input value={draft.jobTitle} onChange={e=>setDraft(v=>({...v,jobTitle:e.target.value}))} maxLength={120}/></label>
        <div><button type="button" onClick={()=>setEditing(null)}>Annuler</button><button type="submit" className="primary" disabled={busy}><Save size={16}/> Enregistrer</button></div>
      </form>
    </div>}
  </>;
}
