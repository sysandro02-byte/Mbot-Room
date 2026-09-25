import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Eye,
  ImageIcon,
  LoaderCircle,
  Megaphone,
  MousePointerClick,
  Pencil,
  PlayCircle,
  Save,
  Trash2,
  UsersRound,
  XCircle,
} from 'lucide-react';
import {
  type AdminAdCampaign,
  type AdminAdCampaignDraft,
  type AdminAudienceFilters,
  type AdminAudienceOptions,
  adminDashboardService,
} from '../../services/adminDashboardService';
import './AdminAdCampaignCenter.css';

const localDateTime = (value?: string | null) => {
  const date=value?new Date(value):new Date();
  if(!Number.isFinite(date.getTime()))return '';
  return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
};

const emptyOptions:AdminAudienceOptions={
  countries:[],
  organizations:[],
  jobTitles:[],
  totals:{total:0,users:0,admins:0,active:0},
};

const emptyDraft=()=>({
  title:'',
  body:'',
  imageUrl:'',
  actionLabel:'En savoir plus',
  actionUrl:'',
  role:'user' as const,
  accountStatus:'active' as const,
  country:'',
  city:'',
  organization:'',
  jobTitle:'',
  isActive:false,
  startsAt:localDateTime(),
  endsAt:'',
  maxImpressionsPerUser:1,
  cooldownHours:24,
  dismissible:true,
  priority:0,
});

export default function AdminAdCampaignCenter(){
  const [campaigns,setCampaigns]=useState<AdminAdCampaign[]>([]);
  const [options,setOptions]=useState<AdminAudienceOptions>(emptyOptions);
  const [draft,setDraft]=useState(emptyDraft);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const load=async()=>{
    const [rows,audienceOptions]=await Promise.all([
      adminDashboardService.getAdCampaigns(),
      adminDashboardService.getAudienceOptions(),
    ]);
    setCampaigns(rows);
    setOptions(audienceOptions);
  };

  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:'Campagnes indisponibles.'));},[]);

  const cities=useMemo(()=>draft.country
    ? options.countries.find((item)=>item.name===draft.country)?.cities||[]
    : [],[draft.country,options.countries]);

  const reset=()=>{
    setEditingId(null);
    setDraft(emptyDraft());
    setMessage('');
  };

  const edit=(campaign:AdminAdCampaign)=>{
    setEditingId(campaign.id);
    setDraft({
      title:campaign.title,
      body:campaign.body,
      imageUrl:campaign.imageUrl,
      actionLabel:campaign.actionLabel||'En savoir plus',
      actionUrl:campaign.actionUrl,
      role:(campaign.audience.role||'user') as 'user'|'admin'|'all',
      accountStatus:(campaign.audience.accountStatus||'active') as 'active'|'quarantined'|'banned'|'all',
      country:campaign.audience.country||'',
      city:campaign.audience.city||'',
      organization:campaign.audience.organization||'',
      jobTitle:campaign.audience.jobTitle||'',
      isActive:campaign.isActive,
      startsAt:localDateTime(campaign.startsAt),
      endsAt:campaign.endsAt?localDateTime(campaign.endsAt):'',
      maxImpressionsPerUser:campaign.maxImpressionsPerUser,
      cooldownHours:campaign.cooldownHours,
      dismissible:campaign.dismissible,
      priority:campaign.priority,
    });
    document.getElementById('admin-ad-editor')?.scrollIntoView({behavior:'smooth',block:'start'});
  };

  const payload=():AdminAdCampaignDraft=>({
    title:draft.title.trim(),
    body:draft.body.trim(),
    imageUrl:draft.imageUrl.trim(),
    actionLabel:draft.actionLabel.trim(),
    actionUrl:draft.actionUrl.trim(),
    audience:{
      role:draft.role,
      accountStatus:draft.accountStatus,
      country:draft.country||undefined,
      city:draft.city||undefined,
      organization:draft.organization||undefined,
      jobTitle:draft.jobTitle||undefined,
    },
    isActive:draft.isActive,
    startsAt:new Date(draft.startsAt).toISOString(),
    endsAt:draft.endsAt?new Date(draft.endsAt).toISOString():null,
    maxImpressionsPerUser:Number(draft.maxImpressionsPerUser)||1,
    cooldownHours:Number(draft.cooldownHours)||0,
    dismissible:draft.dismissible,
    priority:Number(draft.priority)||0,
  });

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(!draft.title.trim()||!draft.body.trim()){setMessage('Ajoutez un titre et un texte publicitaire.');return;}
    setBusy('save');setMessage('');
    try{
      if(editingId)await adminDashboardService.updateAdCampaign(editingId,payload());
      else await adminDashboardService.createAdCampaign(payload());
      await load();
      setMessage(editingId?'Campagne mise à jour.':'Campagne créée.');
      setEditingId(null);
      setDraft(emptyDraft());
    }catch(error){setMessage(error instanceof Error?error.message:'Enregistrement impossible.');}
    finally{setBusy('');}
  };

  const toggle=async(campaign:AdminAdCampaign)=>{
    setBusy(campaign.id);
    try{
      await adminDashboardService.updateAdCampaign(campaign.id,{isActive:!campaign.isActive});
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Mise à jour impossible.');}
    finally{setBusy('');}
  };

  const remove=async(campaign:AdminAdCampaign)=>{
    if(!window.confirm(`Supprimer définitivement la campagne « ${campaign.title} » ?`))return;
    setBusy(campaign.id);
    try{
      await adminDashboardService.deleteAdCampaign(campaign.id);
      if(editingId===campaign.id)reset();
      await load();
      setMessage('Campagne supprimée.');
    }catch(error){setMessage(error instanceof Error?error.message:'Suppression impossible.');}
    finally{setBusy('');}
  };

  return <section className="admin-ad-center" id="admin-advertising">
    <header className="admin-ad-heading">
      <div><span><Megaphone/></span><div><h2>Affiches publicitaires</h2><p>Créez des campagnes modales ciblées qui s’affichent devant l’interface utilisateur.</p></div></div>
      <strong>{campaigns.filter((item)=>item.isActive).length} active{campaigns.filter((item)=>item.isActive).length>1?'s':''}</strong>
    </header>

    {message?<div className="admin-ad-message" role="status">{message}</div>:null}

    <div className="admin-ad-layout">
      <form className="admin-ad-editor" id="admin-ad-editor" onSubmit={submit}>
        <div className="admin-ad-section-title"><ImageIcon size={17}/><div><strong>{editingId?'Modifier la campagne':'Nouvelle affiche'}</strong><small>Le texte est affiché comme texte sûr, jamais comme HTML exécutable.</small></div></div>

        <label>Titre<input value={draft.title} onChange={(event)=>setDraft((d)=>({...d,title:event.target.value}))} maxLength={160} placeholder="Ex. Découvrez MBoté Premium" required/></label>
        <label>Message<textarea rows={4} value={draft.body} onChange={(event)=>setDraft((d)=>({...d,body:event.target.value}))} maxLength={1600} placeholder="Texte de l’affiche…" required/></label>
        <label>Image<input value={draft.imageUrl} onChange={(event)=>setDraft((d)=>({...d,imageUrl:event.target.value}))} placeholder="https://… ou /images/…"/></label>
        <div className="admin-ad-two">
          <label>Texte du bouton<input value={draft.actionLabel} onChange={(event)=>setDraft((d)=>({...d,actionLabel:event.target.value}))} maxLength={80}/></label>
          <label>Destination<input value={draft.actionUrl} onChange={(event)=>setDraft((d)=>({...d,actionUrl:event.target.value}))} placeholder="/app/… ou https://…"/></label>
        </div>

        <div className="admin-ad-section-title"><UsersRound size={17}/><div><strong>Ciblage</strong><small>L’audience est vérifiée côté serveur avec le profil réel du compte.</small></div></div>
        <div className="admin-ad-grid">
          <label>Rôle<select value={draft.role} onChange={(event)=>setDraft((d)=>({...d,role:event.target.value as typeof d.role}))}><option value="user">Utilisateurs</option><option value="admin">Administrateurs</option><option value="all">Tous</option></select></label>
          <label>Statut<select value={draft.accountStatus} onChange={(event)=>setDraft((d)=>({...d,accountStatus:event.target.value as typeof d.accountStatus}))}><option value="active">Actifs</option><option value="quarantined">Quarantaine</option><option value="banned">Bannis</option><option value="all">Tous</option></select></label>
          <label>Pays<select value={draft.country} onChange={(event)=>setDraft((d)=>({...d,country:event.target.value,city:''}))}><option value="">Tous les pays</option>{options.countries.map((item)=><option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
          <label>Ville<select value={draft.city} onChange={(event)=>setDraft((d)=>({...d,city:event.target.value}))} disabled={!draft.country}><option value="">Toutes les villes</option>{cities.map((item)=><option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
          <label>Organisation<input value={draft.organization} onChange={(event)=>setDraft((d)=>({...d,organization:event.target.value}))} placeholder="Toutes"/></label>
          <label>Fonction<input value={draft.jobTitle} onChange={(event)=>setDraft((d)=>({...d,jobTitle:event.target.value}))} placeholder="Toutes"/></label>
        </div>

        <div className="admin-ad-section-title"><PlayCircle size={17}/><div><strong>Diffusion</strong><small>Programmez la campagne et contrôlez sa fréquence.</small></div></div>
        <div className="admin-ad-grid">
          <label>Début<input type="datetime-local" value={draft.startsAt} onChange={(event)=>setDraft((d)=>({...d,startsAt:event.target.value}))} required/></label>
          <label>Fin facultative<input type="datetime-local" value={draft.endsAt} onChange={(event)=>setDraft((d)=>({...d,endsAt:event.target.value}))}/></label>
          <label>Affichages max / user<input type="number" min={1} max={100} value={draft.maxImpressionsPerUser} onChange={(event)=>setDraft((d)=>({...d,maxImpressionsPerUser:Number(event.target.value)}))}/></label>
          <label>Délai entre affichages (h)<input type="number" min={0} max={8760} value={draft.cooldownHours} onChange={(event)=>setDraft((d)=>({...d,cooldownHours:Number(event.target.value)}))}/></label>
          <label>Priorité<input type="number" min={0} max={1000} value={draft.priority} onChange={(event)=>setDraft((d)=>({...d,priority:Number(event.target.value)}))}/></label>
        </div>

        <div className="admin-ad-toggles">
          <label><input type="checkbox" checked={draft.isActive} onChange={(event)=>setDraft((d)=>({...d,isActive:event.target.checked}))}/><span><strong>Publier</strong><small>La campagne devient disponible pendant sa période.</small></span></label>
          <label><input type="checkbox" checked={draft.dismissible} onChange={(event)=>setDraft((d)=>({...d,dismissible:event.target.checked}))}/><span><strong>Fermeture autorisée</strong><small>Affiche une croix permettant à l’utilisateur de fermer.</small></span></label>
        </div>

        <div className="admin-ad-actions">
          {editingId?<button type="button" onClick={reset}>Annuler</button>:null}
          <button className="primary" type="submit" disabled={busy==='save'}>{busy==='save'?<LoaderCircle className="spin"/>:<Save/>}{editingId?'Enregistrer':'Créer la campagne'}</button>
        </div>
      </form>

      <aside className="admin-ad-list">
        <header><div><BarChart3/><strong>Campagnes</strong></div><small>{campaigns.length} au total</small></header>
        {!campaigns.length?<div className="admin-ad-empty"><Megaphone/><p>Aucune campagne publicitaire pour le moment.</p></div>:campaigns.map((campaign)=><article key={campaign.id} className={campaign.isActive?'is-active':''}>
          {campaign.imageUrl?<img src={campaign.imageUrl} alt=""/>:null}
          <div className="admin-ad-card-body">
            <div className="admin-ad-card-head"><div><strong>{campaign.title}</strong><small>{campaign.isActive?'Active':'Inactive'} · priorité {campaign.priority}</small></div><span>{campaign.isActive?'PUBLIÉE':'BROUILLON'}</span></div>
            <p>{campaign.body}</p>
            <div className="admin-ad-stats">
              <span><Eye/>{campaign.impressions} affichages</span>
              <span><UsersRound/>{campaign.uniqueViewers} users</span>
              <span><MousePointerClick/>{campaign.clicks} clics</span>
              <span><XCircle/>{campaign.dismissals} fermetures</span>
            </div>
            <div className="admin-ad-card-actions">
              <button type="button" onClick={()=>edit(campaign)}><Pencil/> Modifier</button>
              <button type="button" onClick={()=>void toggle(campaign)} disabled={busy===campaign.id}><PlayCircle/> {campaign.isActive?'Désactiver':'Activer'}</button>
              <button className="danger" type="button" onClick={()=>void remove(campaign)} disabled={busy===campaign.id}><Trash2/> Supprimer</button>
            </div>
          </div>
        </article>)}
      </aside>
    </div>
  </section>;
}
