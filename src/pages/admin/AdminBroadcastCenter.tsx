import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  BrainCircuit,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  MapPin,
  Search,
  Send,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react';
import {
  AdminAiInsights,
  AdminAudienceFilters,
  AdminAudienceOptions,
  AdminAudiencePreview,
  AdminBroadcast,
  AdminManagedUser,
  adminDashboardService,
} from '../../services/adminDashboardService';
import './AdminBroadcastCenter.css';

const emptyOptions:AdminAudienceOptions={
  countries:[],
  organizations:[],
  jobTitles:[],
  totals:{total:0,users:0,admins:0,active:0},
};

export default function AdminBroadcastCenter(){
  const [options,setOptions]=useState<AdminAudienceOptions>(emptyOptions);
  const [audience,setAudience]=useState<AdminAudienceFilters>({role:'user',accountStatus:'active'});
  const [preview,setPreview]=useState<AdminAudiencePreview|null>(null);
  const [history,setHistory]=useState<AdminBroadcast[]>([]);
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [actionPath,setActionPath]=useState('/app/notifications');
  const [pushEnabled,setPushEnabled]=useState(true);
  const [aiAssisted,setAiAssisted]=useState(false);
  const [aiIntent,setAiIntent]=useState('');
  const [aiTone,setAiTone]=useState('professionnel');
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [userQuery,setUserQuery]=useState('');
  const [userMatches,setUserMatches]=useState<AdminManagedUser[]>([]);
  const [insights,setInsights]=useState<AdminAiInsights|null>(null);

  const load=async()=>{
    const [nextOptions,nextHistory]=await Promise.all([
      adminDashboardService.getAudienceOptions(),
      adminDashboardService.getBroadcasts(),
    ]);
    setOptions(nextOptions);
    setHistory(nextHistory);
  };

  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:'Console de diffusion indisponible.'));},[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      void adminDashboardService.previewAudience(audience)
        .then(setPreview)
        .catch((error)=>setMessage(error instanceof Error?error.message:'Aperçu de l’audience indisponible.'));
    },250);
    return()=>window.clearTimeout(timer);
  },[audience]);

  useEffect(()=>{
    if(userQuery.trim().length<2){setUserMatches([]);return undefined;}
    const timer=window.setTimeout(()=>{
      void adminDashboardService.getUsers(userQuery.trim()).then((rows)=>setUserMatches(rows.slice(0,12))).catch(()=>setUserMatches([]));
    },300);
    return()=>window.clearTimeout(timer);
  },[userQuery]);

  const cities=useMemo(()=>{
    if(!audience.country)return [];
    return options.countries.find((item)=>item.name===audience.country)?.cities||[];
  },[audience.country,options.countries]);

  const selectedIds=new Set<number>(audience.userIds||[]);

  const patchAudience=(patch:Partial<AdminAudienceFilters>)=>{
    setAudience((current)=>({...current,...patch}));
    setMessage('');
  };

  const toggleUser=(userId:number)=>{
    const next=new Set<number>(audience.userIds||[]);
    if(next.has(userId))next.delete(userId);else next.add(userId);
    patchAudience({userIds:[...next]});
  };

  const allActive=()=>setAudience({role:'user',accountStatus:'active',userIds:[]});
  const allAccounts=()=>setAudience({role:'all',accountStatus:'all',userIds:[]});
  const quarantined=()=>setAudience({role:'user',accountStatus:'quarantined',userIds:[]});

  const composeWithAi=async()=>{
    if(!aiIntent.trim()&&!body.trim()){setMessage('Décrivez le message à préparer avec Luna IA.');return;}
    setBusy('ai');setMessage('');
    try{
      const result=await adminDashboardService.composeBroadcastWithAi({intent:aiIntent,title,body,tone:aiTone});
      setTitle(result.title);
      setBody(result.body);
      setAiAssisted(true);
      setMessage('Luna IA a préparé le message. Relisez-le avant l’envoi.');
    }catch(error){setMessage(error instanceof Error?error.message:'Luna IA est indisponible.');}
    finally{setBusy('');}
  };

  const sendBroadcast=async(event:FormEvent)=>{
    event.preventDefault();
    if(!title.trim()||!body.trim()){setMessage('Ajoutez un titre et un message.');return;}
    if(!preview?.count){setMessage('Aucun destinataire ne correspond à cette audience.');return;}
    setBusy('send');setMessage('');
    try{
      const result=await adminDashboardService.sendBroadcast({
        title:title.trim(),
        body:body.trim(),
        actionPath,
        audience,
        push:pushEnabled,
        aiAssisted,
      });
      setMessage(`Message envoyé à ${result.recipientCount} compte${result.recipientCount>1?'s':''}. Push livrés : ${result.pushSent}.`);
      setTitle('');setBody('');setAiIntent('');setAiAssisted(false);
      await load();
      setPreview(await adminDashboardService.previewAudience(audience));
    }catch(error){setMessage(error instanceof Error?error.message:'Envoi impossible.');}
    finally{setBusy('');}
  };

  const loadInsights=async()=>{
    setBusy('insights');setMessage('');
    try{setInsights(await adminDashboardService.getAiInsights());}
    catch(error){setMessage(error instanceof Error?error.message:'Analyse IA indisponible.');}
    finally{setBusy('');}
  };

  return <section className="admin-broadcast-suite" id="admin-broadcasts">
    <header className="admin-broadcast-heading">
      <div><span><BellRing/></span><div><h2>Communication & audience</h2><p>Envoyez des messages ciblés à de vrais comptes MBotéRoom, avec notification temps réel et push.</p></div></div>
      <strong>{options.totals.users||0} users</strong>
    </header>

    {message?<div className="admin-broadcast-message" role="status">{message}</div>:null}

    <div className="admin-broadcast-grid">
      <form className="admin-broadcast-composer" onSubmit={sendBroadcast}>
        <div className="admin-broadcast-section-title"><Send size={17}/><div><strong>Nouveau message</strong><small>Notification persistée + temps réel + push</small></div></div>

        <div className="admin-ai-compose">
          <label>Instruction pour Luna IA<textarea rows={2} value={aiIntent} onChange={(event)=>setAiIntent(event.target.value)} placeholder="Ex. Informer les utilisateurs de Brazzaville d’une maintenance ce soir à 22 h."/></label>
          <div><select value={aiTone} onChange={(event)=>setAiTone(event.target.value)}><option value="professionnel">Professionnel</option><option value="chaleureux">Chaleureux</option><option value="court et direct">Court et direct</option><option value="institutionnel">Institutionnel</option></select><button type="button" onClick={()=>void composeWithAi()} disabled={busy==='ai'}>{busy==='ai'?<LoaderCircle className="spin"/>:<Sparkles/>} Améliorer avec Luna IA</button></div>
        </div>

        <label>Titre<input value={title} onChange={(event)=>setTitle(event.target.value)} maxLength={160} placeholder="Titre de la notification" required/></label>
        <label>Message<textarea rows={5} value={body} onChange={(event)=>setBody(event.target.value)} maxLength={1800} placeholder="Votre message…" required/></label>
        <label>Destination au clic<input value={actionPath} onChange={(event)=>setActionPath(event.target.value)} placeholder="/app/notifications"/></label>

        <div className="admin-broadcast-section-title"><Target size={17}/><div><strong>Audience</strong><small>Affinez par profil ou sélectionnez des comptes précis.</small></div></div>
        <div className="admin-audience-presets">
          <button type="button" onClick={allActive}>Tous les users actifs</button>
          <button type="button" onClick={allAccounts}>Tous les comptes</button>
          <button type="button" onClick={quarantined}>En quarantaine</button>
        </div>
        <div className="admin-audience-filters">
          <label>Rôle<select value={audience.role||'user'} onChange={(event)=>patchAudience({role:event.target.value as AdminAudienceFilters['role']})}><option value="user">Users</option><option value="admin">Admins</option><option value="all">Tous</option></select></label>
          <label>Statut<select value={audience.accountStatus||'active'} onChange={(event)=>patchAudience({accountStatus:event.target.value as AdminAudienceFilters['accountStatus']})}><option value="active">Actifs</option><option value="quarantined">Quarantaine</option><option value="banned">Bannis</option><option value="all">Tous statuts</option></select></label>
          <label>Pays<select value={audience.country||''} onChange={(event)=>patchAudience({country:event.target.value,city:''})}><option value="">Tous les pays</option>{options.countries.map((item)=><option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
          <label>Ville<select value={audience.city||''} onChange={(event)=>patchAudience({city:event.target.value})} disabled={!audience.country}><option value="">Toutes les villes</option>{cities.map((item)=><option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
          <label>Organisation<input value={audience.organization||''} onChange={(event)=>patchAudience({organization:event.target.value})} placeholder="Ex. LoukaTech"/></label>
          <label>Fonction<input value={audience.jobTitle||''} onChange={(event)=>patchAudience({jobTitle:event.target.value})} placeholder="Ex. Directeur"/></label>
        </div>

        <div className="admin-user-picker">
          <label><Search size={15}/><input value={userQuery} onChange={(event)=>setUserQuery(event.target.value)} placeholder="Ajouter des comptes précis par nom ou e-mail…"/></label>
          {userMatches.length?<div className="admin-user-picker-results">{userMatches.map((user)=><button type="button" key={user.id} className={selectedIds.has(user.id)?'selected':''} onClick={()=>toggleUser(user.id)}><span>{selectedIds.has(user.id)?<CheckCircle2/>:<UsersRound/>}</span><div><strong>{user.name}</strong><small>{user.email} · {[user.city,user.country].filter(Boolean).join(', ')||'Localisation non renseignée'}</small></div></button>)}</div>:null}
          {selectedIds.size?<small>{selectedIds.size} compte{selectedIds.size>1?'s':''} sélectionné{selectedIds.size>1?'s':''} manuellement. Les autres filtres restent appliqués.</small>:null}
        </div>

        <div className="admin-audience-preview">
          <div><span><UsersRound/></span><div><strong>{preview?.count??'…'} destinataire{preview?.count===1?'':'s'}</strong><small>{preview?.tooLarge?'Audience trop large : affinez les filtres.':'Aperçu calculé directement depuis PostgreSQL.'}</small></div></div>
          {preview?.sample?.length?<div className="admin-audience-sample">{preview.sample.slice(0,6).map((user)=><span key={user.id}>{user.name}</span>)}</div>:null}
        </div>

        <label className="admin-push-toggle"><input type="checkbox" checked={pushEnabled} onChange={(event)=>setPushEnabled(event.target.checked)}/><span><strong>Push activé</strong><small>Les abonnements Web Push actifs recevront aussi le message hors écran.</small></span></label>

        <button className="admin-broadcast-send" type="submit" disabled={busy==='send'||!preview?.count||Boolean(preview?.tooLarge)}>{busy==='send'?<LoaderCircle className="spin"/>:<Send/>} Envoyer à {preview?.count||0} compte{preview?.count===1?'':'s'}</button>
      </form>

      <aside className="admin-intelligence-card">
        <div className="admin-broadcast-section-title"><BrainCircuit size={18}/><div><strong>Luna Admin Intelligence</strong><small>Analyse agrégée, sans exposer les données personnelles.</small></div></div>
        <div className="admin-intelligence-metrics">
          <article><strong>{options.totals.total||0}</strong><span>Comptes</span></article>
          <article><strong>{options.totals.active||0}</strong><span>Actifs</span></article>
          <article><strong>{options.countries.length}</strong><span>Pays</span></article>
        </div>
        <button type="button" onClick={()=>void loadInsights()} disabled={busy==='insights'}>{busy==='insights'?<LoaderCircle className="spin"/>:<Sparkles/>} Analyser la plateforme</button>
        {insights?<div className="admin-intelligence-result"><div><Globe2 size={16}/><strong>{insights.provider==='groq'?'Analyse Luna IA':'Métriques locales'}</strong></div><p>{insights.summary}</p>{insights.metrics.topCountries?.length?<ul>{insights.metrics.topCountries.map((item)=><li key={item.country}><MapPin size={13}/>{item.country} <strong>{item.count}</strong></li>)}</ul>:null}</div>:null}

        <div className="admin-broadcast-history">
          <header><strong>Dernières diffusions</strong><small>{history.length} enregistrée{history.length>1?'s':''}</small></header>
          {history.slice(0,8).map((item)=><article key={item.id}><div><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString('fr-FR')}</small></div><span>{item.recipientCount} reçus · {item.pushSent} push</span></article>)}
          {!history.length?<p>Aucune diffusion administrateur pour le moment.</p>:null}
        </div>
      </aside>
    </div>
  </section>;
}
