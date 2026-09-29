import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  CheckCircle2,
  FileText,
  Globe2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Save,
  Settings,
  Share2,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appDataService, type Preferences, type ProfileStats } from '../services/appDataService';
import { authService, type RoomUser } from '../services/authService';
import { getStoredLanguage, persistAppLanguage, type AppLanguage } from '../lib/appLanguage';
import { showAppMessage } from '../lib/appMessage';
import './ProfilePage.css';
import AppLoader from '../components/AppLoader';

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'MB';
const languages:Record<AppLanguage,string>={fr:'Français (FR)',en:'English (EN)',ln:'Lingala',ar:'العربية'};
const timezones=['Africa/Brazzaville','Africa/Kinshasa','Africa/Lagos','Europe/Paris','UTC'];

const compressAvatar=(file:File)=>new Promise<string>((resolve,reject)=>{
  if(!file.type.startsWith('image/')){reject(new Error('Choisissez une image.'));return;}
  if(file.size>8*1024*1024){reject(new Error('La photo est trop volumineuse.'));return;}
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Lecture de la photo impossible.'));
  reader.onload=()=>{
    const image=new Image();
    image.onerror=()=>reject(new Error('Image invalide.'));
    image.onload=()=>{
      const max=320;
      const ratio=Math.min(1,max/Math.max(image.width,image.height));
      const width=Math.max(1,Math.round(image.width*ratio));
      const height=Math.max(1,Math.round(image.height*ratio));
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');
      if(!context){reject(new Error('Traitement de la photo impossible.'));return;}
      context.drawImage(image,0,0,width,height);
      resolve(canvas.toDataURL('image/jpeg',0.82));
    };
    image.src=String(reader.result||'');
  };
  reader.readAsDataURL(file);
});

export default function ProfilePage(){
  const navigate=useNavigate();
  const photoInput=useRef<HTMLInputElement|null>(null);
  const formRef=useRef<HTMLFormElement|null>(null);
  const [profile,setProfile]=useState<RoomUser>(authService.getCurrentUser()||{} as RoomUser);
  const [preferences,setPreferences]=useState<Preferences>({});
  const [stats,setStats]=useState<ProfileStats>({meetings:0,participants:0,files:0,meetingMinutes:0});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [photoBusy,setPhotoBusy]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const result=await Promise.all([
        appDataService.getProfile(),
        appDataService.getProfileStats(),
        appDataService.getPreferences().catch(()=>({} as Preferences)),
      ]);
      setProfile(result[0].user);
      setStats(result[1]);
      setPreferences(result[2]);
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger le profil.');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  const update=(patch:Partial<RoomUser>)=>setProfile((current)=>({...current,...patch}));

  const save=async(event:FormEvent)=>{
    event.preventDefault();
    setSaving(true);setError('');
    try{
      const saved=await appDataService.updateProfile({
        name:profile.name,
        username:profile.username,
        avatar:profile.avatar,
        phoneNumber:profile.phoneNumber,
        organization:profile.organization,
        jobTitle:profile.jobTitle,
        country:profile.country,
        city:profile.city,
        address:profile.address,
        bio:profile.bio,
        profileVisible:profile.profileVisible,
        personalMeetingId:profile.personalMeetingId,
      });
      const language=(preferences.language||getStoredLanguage()) as AppLanguage;
      const prefs=await appDataService.updatePreferences({
        language,
        timezone:preferences.timezone||'Africa/Brazzaville',
      });
      persistAppLanguage(language);
      setPreferences((current)=>({...current,...prefs}));
      setProfile(saved.user);
      await authService.refreshCurrentUser();
      window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));
      showAppMessage('Profil mis à jour.',{tone:'success'});
    }catch(cause){
      const message=cause instanceof Error?cause.message:'Profil non enregistré.';
      setError(message);showAppMessage(message,{tone:'error'});
    }finally{setSaving(false);}
  };

  const photoChanged=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.currentTarget.value='';
    if(!file)return;
    setPhotoBusy(true);
    try{
      const avatar=await compressAvatar(file);
      const saved=await appDataService.updateProfile({avatar});
      setProfile(saved.user);
      await authService.refreshCurrentUser();
      window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));
      showAppMessage('Photo de profil mise à jour.',{tone:'success'});
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Photo invalide.',{tone:'error'});}
    finally{setPhotoBusy(false);}
  };

  const shareProfile=async()=>{
    const text=(profile.name||'Utilisateur MBotéRoom')+' · @'+(profile.username||'')+' · '+profile.email;
    try{
      if(navigator.share)await navigator.share({title:'Profil MBotéRoom',text});
      else{await navigator.clipboard.writeText(text);showAppMessage('Informations du profil copiées.',{tone:'success'});}
    }catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))showAppMessage('Partage impossible.',{tone:'error'});}
  };

  const location=[profile.city,profile.country].filter(Boolean).join(', ')||profile.address||'Non renseignée';
  const hours=Math.round(stats.meetingMinutes/60);

  return <section className="profile-pro-page">
    {error?<div className="profile-pro-error">{error}</div>:null}

    <header className="profile-pro-cover">
      <div className="profile-pro-avatar">{profile.avatar?<img src={profile.avatar} alt="Photo de profil"/>:<span>{initials(profile.name||profile.username||'MB')}</span>}<i/></div>
      <div className="profile-pro-identity">
        <h1>{profile.name||'Utilisateur MBotéRoom'}</h1>
        <div><strong>@{profile.username||'utilisateur'}</strong><span><UsersRound size={14}/> {profile.role==='admin'?'Administrateur MBotéRoom':'Membre MBotéRoom'}</span></div>
        <p><Mail/> {profile.email} <b/> <CheckCircle2/> En ligne <b/> <BriefcaseBusiness/> {profile.organization||'Organisation non renseignée'}</p>
      </div>
      <div className="profile-pro-cover-actions">
        <button onClick={()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}><UserRound/> Modifier le profil</button>
        <button onClick={()=>photoInput.current?.click()} disabled={photoBusy}><Camera/> {photoBusy?'Traitement…':'Changer la photo'}</button>
        <button onClick={()=>void shareProfile()}><Share2/> Partager le profil</button>
      </div>
    </header>

    <div className="profile-pro-layout">
      <aside className="profile-pro-side">
        <section className="profile-pro-security">
          <div><span><ShieldCheck/></span><div><strong>Compte protégé</strong><p>La connexion par mot de passe utilise le code de sécurité MBotéRoom.</p></div><b>Sécurisé</b></div>
          <button onClick={()=>navigate('/app/settings')}>Gérer la sécurité</button>
        </section>

        <section><h3><Phone/> Informations de contact</h3><p><Mail/> {profile.email}</p><p><Phone/> {profile.phoneNumber||'Téléphone non renseigné'}</p><p><MapPin/> {location}</p></section>
        <section><h3><BriefcaseBusiness/> Organisation</h3><strong>{profile.organization||'Non renseignée'}</strong></section>
        <section><h3><BriefcaseBusiness/> Fonction</h3><strong>{profile.jobTitle||'Non renseignée'}</strong></section>

        <section className="profile-pro-stats">
          <h3><BarChart3/> Mes statistiques</h3>
          <div><span><strong>{stats.meetings}</strong><small>Réunions</small></span><span><strong>{stats.participants}</strong><small>Participants</small></span><span><strong>{stats.files}</strong><small>Fichiers</small></span><span><strong>{hours} h</strong><small>Temps de réunion</small></span></div>
        </section>
      </aside>

      <main className="profile-pro-main">
        <section className="profile-pro-editor">
          <header>
            <div className="profile-pro-editor-title"><span><UserRound/></span><div><h2>Informations du profil</h2><p>Mettez à jour les informations utilisées dans vos réunions et espaces collaboratifs.</p></div></div>
            <span className={profile.profileVisible===false?'profile-pro-visibility off':'profile-pro-visibility'}><Globe2/> {profile.profileVisible===false?'Profil privé':'Profil visible'}<small>{profile.profileVisible===false?'Seulement vous':'Visible par vos contacts'}</small></span>
          </header>

          {loading?<AppLoader label="Chargement du profil…" />:<form ref={formRef} onSubmit={save}>
            <label>Nom complet<input value={profile.name||''} onChange={(event)=>update({name:event.target.value})} required/></label>
            <label>Nom d’utilisateur<input value={profile.username||''} onChange={(event)=>update({username:event.target.value})} required/></label>
            <label>E-mail<input value={profile.email||''} readOnly/><small>Adresse de connexion</small></label>
            <label>ID personnel de réunion<input inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={profile.personalMeetingId||''} onChange={(event)=>update({personalMeetingId:event.target.value.replace(/\D/g,'').slice(0,12)})} placeholder="Ex. 1234567890"/><small>6 à 12 chiffres. Cet ID sera utilisable pour vos réunions.</small></label>
            <label>Téléphone<input value={profile.phoneNumber||''} onChange={(event)=>update({phoneNumber:event.target.value})} placeholder="+242 ..."/></label>
            <label>Organisation<input value={profile.organization||''} onChange={(event)=>update({organization:event.target.value})}/></label>
            <label>Fonction<input value={profile.jobTitle||''} onChange={(event)=>update({jobTitle:event.target.value})}/></label>
            <label className="wide">Adresse<input value={profile.address||''} onChange={(event)=>update({address:event.target.value})} placeholder="Adresse"/></label>
            <label>Ville<input value={profile.city||''} onChange={(event)=>update({city:event.target.value})}/></label>
            <label>Pays<input value={profile.country||''} onChange={(event)=>update({country:event.target.value})}/></label>
            <label className="wide">Bio courte <span className="profile-pro-counter">{(profile.bio||'').length}/300</span><textarea value={profile.bio||''} maxLength={300} onChange={(event)=>update({bio:event.target.value})} placeholder="Présentez-vous en quelques mots."/></label>
            <label>Langue<select value={preferences.language||getStoredLanguage()} onChange={(event)=>setPreferences((current)=>({...current,language:event.target.value}))}>{Object.entries(languages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
            <label>Fuseau horaire<select value={preferences.timezone||'Africa/Brazzaville'} onChange={(event)=>setPreferences((current)=>({...current,timezone:event.target.value}))}>{timezones.map((zone)=><option key={zone} value={zone}>{zone}</option>)}</select></label>
            <label className="wide profile-pro-photo-url">URL de la photo de profil<div><input value={profile.avatar?.startsWith('data:')?'Photo importée depuis votre appareil':profile.avatar||''} onChange={(event)=>update({avatar:event.target.value})} readOnly={Boolean(profile.avatar?.startsWith('data:'))}/><button type="button" onClick={()=>photoInput.current?.click()}><Camera/> Parcourir</button></div></label>
            <label className="wide profile-pro-visible-toggle"><input type="checkbox" checked={profile.profileVisible!==false} onChange={(event)=>update({profileVisible:event.target.checked})}/><span>Autoriser mes contacts MBotéRoom à voir mon profil.</span></label>
            <button className="wide profile-pro-save" disabled={saving}><Save/> {saving?'Enregistrement…':'Enregistrer les modifications'}</button>
          </form>}
          <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={photoChanged}/>
        </section>

        <section className="profile-pro-quick">
          <header><strong>Accès rapide</strong><span>Accédez rapidement à vos outils MBotéRoom.</span></header>
          <div>
            <button onClick={()=>navigate('/app/calendar')}><CalendarDays/><span><strong>Calendrier</strong><small>Vos rendez-vous</small></span></button>
            <button onClick={()=>navigate('/app/messages')}><MessageCircle/><span><strong>Messages</strong><small>Conversations</small></span></button>
            <button onClick={()=>navigate('/app/contacts')}><UsersRound/><span><strong>Contacts</strong><small>Participants</small></span></button>
            <button onClick={()=>navigate('/app/recordings')}><FileText/><span><strong>Enregistrements</strong><small>Vos contenus</small></span></button>
            <button onClick={()=>navigate('/app/settings')}><Settings/><span><strong>Paramètres</strong><small>Sécurité et préférences</small></span></button>
          </div>
        </section>
      </main>
    </div>
  </section>;
}
