import { FormEvent, useEffect, useState } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound, UsersRound, Video } from 'lucide-react';
import { authService } from '../../services/authService';
import './AdminAuthPage.css';

type Mode='login'|'register'|'forgot';

const passwordMessage=(value:string)=>{
  if(value.length<10)return 'Utilisez au moins 10 caractères.';
  if(!/[a-z]/.test(value)||!/[A-Z]/.test(value)||!/[0-9]/.test(value)||!/[^A-Za-z0-9]/.test(value))return 'Ajoutez une majuscule, une minuscule, un chiffre et un caractère spécial.';
  return '';
};

export default function AdminAuthPage({mode='login'}:{mode?:Mode}){
  const navigate=useNavigate();
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [resetToken]=useState(()=>new URLSearchParams(window.location.hash.replace(/^#/,'')).get('reset')||'');
  const [rememberMe,setRememberMe]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [challengeId,setChallengeId]=useState('');
  const [emailHint,setEmailHint]=useState('');
  const [otp,setOtp]=useState('');

  useEffect(()=>{setError('');setMessage('');setChallengeId('');setOtp('');},[mode]);
  useEffect(()=>{if(resetToken)window.history.replaceState(null,'',window.location.pathname);},[resetToken]);

  if(authService.isAuthenticated()&&authService.isAdmin())return <Navigate to="/admin" replace/>;

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      if(mode==='forgot'){
        if(resetToken){
          if(password!==confirmPassword)throw new Error('Les mots de passe ne correspondent pas.');
          const passwordError=passwordMessage(password);
          if(passwordError)throw new Error(passwordError);
          const result=await authService.resetPassword(resetToken,password);
          setPassword('');setConfirmPassword('');
          setMessage(result.message||'Mot de passe modifié. Vous pouvez maintenant vous connecter.');
          return;
        }
        if(!email.trim())throw new Error('Saisissez votre adresse e-mail administrateur.');
        const result=await authService.forgotPassword(email.trim(),true);
        setMessage(result.message||'Si cette adresse correspond à un compte administrateur, un lien vous sera envoyé.');
        return;
      }
      if(mode==='register'){
        if(!name.trim()||!email.trim()||!password)throw new Error('Nom, adresse e-mail et mot de passe sont requis.');
        const passwordError=passwordMessage(password);
        if(passwordError)throw new Error(passwordError);
        const session=await authService.adminRegister({name:name.trim(),email:email.trim(),password});
        if(session.user.role!=='admin'){await authService.logout(true);throw new Error('Ce compte n’a pas les droits administrateur.');}
        navigate('/admin',{replace:true});
        return;
      }
      if(!email.trim()||!password)throw new Error('Adresse e-mail et mot de passe requis.');
      const result=await authService.login({email:email.trim(),password,rememberMe});
      setChallengeId(result.challengeId);setEmailHint(result.emailHint);setPassword('');
    }catch(cause){setError(cause instanceof Error?cause.message:'Action impossible.');}
    finally{setBusy(false);}
  };

  const verifyOtp=async(event:FormEvent)=>{
    event.preventDefault();
    if(otp.length!==6||busy)return;
    setBusy(true);setError('');
    try{
      const session=await authService.verifyLoginOtp(challengeId,otp,rememberMe);
      if(session.user.role!=='admin'){
        await authService.logout(true);
        setChallengeId('');setOtp('');
        throw new Error('Ce compte n’est pas autorisé à accéder au backoffice.');
      }
      navigate('/admin',{replace:true});
    }catch(cause){setError(cause instanceof Error?cause.message:'Code incorrect.');}
    finally{setBusy(false);}
  };

  const title=mode==='register'?'Créer le compte administrateur':mode==='forgot'?(resetToken?'Nouveau mot de passe':'Mot de passe oublié'):'Connexion administrateur';
  const subtitle=mode==='register'?'Réservé aux adresses administrateur autorisées.':mode==='forgot'?(resetToken?'Choisissez un nouveau mot de passe pour votre compte administrateur.':'Recevez un lien sécurisé pour choisir un nouveau mot de passe.'):'Accédez au backoffice sécurisé de MBotéRoom.';

  return <main className="admin-auth-page">
    <section className="admin-auth-visual">
      <Link to="/login" className="admin-auth-back"><ArrowLeft size={17}/> Connexion utilisateur</Link>
      <div className="admin-auth-brand"><span><UsersRound size={30}/><Video size={16}/></span><strong>MBoté<span>Room</span><small>Backoffice</small></strong></div>
      <div className="admin-auth-copy"><span className="admin-auth-kicker"><ShieldCheck size={16}/> Espace réservé</span><h1>Pilotez MBotéRoom depuis un seul espace.</h1><p>Utilisateurs, réunions, contenus, accès et réglages généraux sont regroupés dans le backoffice.</p></div>
      <div className="admin-auth-points"><span>Gestion des utilisateurs</span><span>Contrôle des fonctions</span><span>Supervision des réunions</span><span>Contenus de l’application</span></div>
    </section>

    <section className="admin-auth-panel">
      <div className="admin-auth-card">
        <span className="admin-auth-icon"><LockKeyhole size={26}/></span>
        <h2>{title}</h2><p>{subtitle}</p>
        <form onSubmit={submit}>
          {mode==='register'&&<label><span>Nom complet</span><div><UserRound size={18}/><input value={name} autoComplete="name" onChange={e=>setName(e.target.value)} placeholder="Nom de l’administrateur"/></div></label>}
          {!(mode==='forgot'&&resetToken)&&<label><span>Adresse e-mail</span><div><Mail size={18}/><input value={email} type="email" autoComplete="email" onChange={e=>setEmail(e.target.value)} placeholder="admin@exemple.com"/></div></label>}
          {(mode!=='forgot'||resetToken)&&<label><span>{resetToken?'Nouveau mot de passe':'Mot de passe'}</span><div><KeyRound size={18}/><input value={password} type={showPassword?'text':'password'} autoComplete={mode==='register'||resetToken?'new-password':'current-password'} onChange={e=>setPassword(e.target.value)} placeholder="Votre mot de passe"/><button type="button" className="admin-password-toggle" aria-label={showPassword?'Masquer le mot de passe':'Afficher le mot de passe'} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>}
          {mode==='forgot'&&resetToken&&<label><span>Confirmer le mot de passe</span><div><KeyRound size={18}/><input value={confirmPassword} type={showPassword?'text':'password'} autoComplete="new-password" onChange={e=>setConfirmPassword(e.target.value)} placeholder="Confirmez le mot de passe"/></div></label>}
          {mode==='login'&&<label className="admin-auth-remember"><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)}/><span>Se souvenir de moi</span></label>}
          {error&&<div className="admin-auth-error" role="alert">{error}</div>}
          {message&&<div className="admin-auth-message" role="status">{message}</div>}
          <button className="admin-auth-primary" disabled={busy}>{busy?'Veuillez patienter…':mode==='register'?'Créer le compte admin':mode==='forgot'?(resetToken?'Enregistrer le nouveau mot de passe':'Envoyer le lien'):'Se connecter'}</button>
        </form>
        <div className="admin-auth-links">
          {mode==='login'&&<><Link to="/admin/mot-de-passe-oublie">Mot de passe oublié ?</Link><Link to="/admin/inscription">Créer le compte admin</Link></>}
          {mode!=='login'&&<Link to="/admin/login">Retour à la connexion admin</Link>}
        </div>
      </div>
    </section>

    {challengeId&&<div className="admin-otp-backdrop">
      <form className="admin-otp-card" onSubmit={verifyOtp}>
        <span><KeyRound size={25}/></span><h2>Vérification</h2><p>Entrez le code à 6 chiffres envoyé à <strong>{emailHint}</strong>.</p>
        <input value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" autoFocus/>
        {error&&<div className="admin-auth-error" role="alert">{error}</div>}
        <button className="admin-auth-primary" disabled={busy||otp.length!==6}>{busy?'Vérification…':'Ouvrir le backoffice'}</button>
        <button type="button" className="admin-auth-secondary" onClick={()=>{setChallengeId('');setOtp('');setError('');}}>Changer de compte</button>
      </form>
    </div>}
  </main>;
}
