import { useEffect, useMemo, useState } from 'react';
import {
  Bot, Check, Cloud, Crown, Database, Download, FileVideo, Gauge, HardDrive,
  Languages, LocateFixed, RefreshCw, ShieldCheck, Sparkles,
  Star, Trash2, UsersRound, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appDataService, type Preferences, type RecordingStats } from '../../../services/appDataService';
import { workspaceService, type WorkspaceFile } from '../../../services/workspaceService';
import { showAppMessage } from '../../../lib/appMessage';
import AppLoader from '../../../components/AppLoader';

const formatBytes=(value:number)=>{
  if(!Number.isFinite(value)||value<=0)return '0 Mo';
  const units=['o','Ko','Mo','Go','To'];
  let amount=value;
  let index=0;
  while(amount>=1024&&index<units.length-1){amount/=1024;index+=1;}
  const precision=index>=3&&amount<10?1:0;
  return amount.toFixed(precision)+' '+units[index];
};

const ratio=(used:number,total:number)=>total>0?Math.min(100,Math.max(0,(used/total)*100)):0;

const useEscapeClose=(open:boolean,onClose:()=>void)=>{
  useEffect(()=>{
    if(!open)return;
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('keydown',onKeyDown);
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previous;};
  },[open,onClose]);
};

const premiumFeatures=[
  {icon:<Bot/>,title:'Luna IA avancée',description:'Des outils IA enrichis pour résumer, traduire et organiser vos réunions.'},
  {icon:<Cloud/>,title:'Stockage étendu',description:'Davantage d’espace pour conserver vos fichiers et vos contenus de réunion.'},
  {icon:<FileVideo/>,title:'Enregistrements avancés',description:'Plus de possibilités pour conserver et retrouver vos enregistrements.'},
  {icon:<Languages/>,title:'Traduction enrichie',description:'Des outils de traduction et de compréhension pour vos réunions internationales.'},
  {icon:<LocateFixed/>,title:'Localiser mes appareils',description:'Des fonctions Premium supplémentaires pour retrouver et sécuriser vos appareils.'},
  {icon:<UsersRound/>,title:'Collaboration étendue',description:'Des options supplémentaires pour les groupes, équipes et réunions importantes.'},
  {icon:<ShieldCheck/>,title:'Protection renforcée',description:'Des contrôles avancés pour vos réunions et vos données.'},
  {icon:<Star/>,title:'Expérience prioritaire',description:'Des fonctionnalités Premium qui évolueront avec MBotéRoom.'},
];

export function PremiumModal({
  open,
  paymentReady,
  checkoutUrl,
  onClose,
}:{
  open:boolean;
  paymentReady:boolean;
  checkoutUrl:string;
  onClose:()=>void;
}){
  useEscapeClose(open,onClose);
  if(!open)return null;

  const unlock=()=>{
    if(!paymentReady||!checkoutUrl)return;
    if(checkoutUrl.startsWith('/'))window.location.assign(checkoutUrl);
    else window.location.href=checkoutUrl;
  };

  return <div className="home-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="home-modal home-premium-modal" role="dialog" aria-modal="true" aria-labelledby="home-premium-title">
      <header className="home-modal-head premium">
        <div className="home-modal-head-icon"><Crown/></div>
        <div>
          <span>MBotéRoom Premium</span>
          <h2 id="home-premium-title">Passez à une expérience plus complète</h2>
          <p>Découvrez les fonctionnalités Premium prévues pour renforcer vos réunions et votre collaboration.</p>
        </div>
        <button type="button" aria-label="Fermer" onClick={onClose}><X/></button>
      </header>

      <div className="home-premium-feature-grid">
        {premiumFeatures.map((feature)=><article key={feature.title}>
          <span>{feature.icon}</span>
          <div><strong>{feature.title}</strong><p>{feature.description}</p></div>
          <Check/>
        </article>)}
      </div>

      <div className={paymentReady?'home-premium-status ready':'home-premium-status'}>
        <span>{paymentReady?<Sparkles/>:<ShieldCheck/>}</span>
        <div>
          <strong>{paymentReady?'Paiement Premium disponible':'Paiement Premium pas encore disponible'}</strong>
          <p>{paymentReady
            ?'Le système de paiement est raccordé. Vous pouvez poursuivre vers le déverrouillage.'
            :'Le bouton sera automatiquement disponible lorsque l’administrateur aura raccordé et activé le système de paiement.'}</p>
        </div>
      </div>

      <footer className="home-modal-footer premium">
        <button className="secondary" type="button" onClick={onClose}>Plus tard</button>
        <button className="home-premium-unlock" type="button" disabled={!paymentReady||!checkoutUrl} onClick={unlock}>
          <Crown/> {paymentReady?'Déverrouiller Premium':'Déverrouillage bientôt disponible'}
        </button>
      </footer>
    </section>
  </div>;
}

export function StorageDataModal({open,onClose}:{open:boolean;onClose:()=>void}){
  const navigate=useNavigate();
  const [loading,setLoading]=useState(false);
  const [browserUsage,setBrowserUsage]=useState(0);
  const [browserQuota,setBrowserQuota]=useState(0);
  const [recordingStats,setRecordingStats]=useState<RecordingStats|null>(null);
  const [files,setFiles]=useState<WorkspaceFile[]>([]);
  const [preferences,setPreferences]=useState<Preferences>({});
  const [cleaning,setCleaning]=useState(false);

  useEscapeClose(open,onClose);

  const refresh=async()=>{
    setLoading(true);
    try{
      const storageEstimate=navigator.storage?.estimate
        ? navigator.storage.estimate().catch(()=>({usage:0,quota:0}))
        : Promise.resolve({usage:0,quota:0});
      const [recordings,fileRows,prefs,estimate]=await Promise.all([
        appDataService.getRecordingStats().catch(()=>null),
        workspaceService.getFiles().catch(()=>[]),
        appDataService.getPreferences().catch(()=>({} as Preferences)),
        storageEstimate,
      ]);
      setRecordingStats(recordings);
      setFiles(Array.isArray(fileRows)?fileRows:[]);
      setPreferences(prefs||{});
      setBrowserUsage(Number(estimate?.usage||0));
      setBrowserQuota(Number(estimate?.quota||0));
    }finally{setLoading(false);}
  };

  useEffect(()=>{if(open)void refresh();},[open]);

  const filesBytes=useMemo(()=>files.reduce((sum,file)=>sum+Math.max(0,Number(file.sizeBytes||0)),0),[files]);
  const recordingsBytes=Number(recordingStats?.sizeBytes||0);

  const clearCache=async()=>{
    setCleaning(true);
    try{
      if('caches'in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter((key)=>/mbote/i.test(key)).map((key)=>caches.delete(key)));
      }
      await refresh();
      showAppMessage('Cache MBotéRoom nettoyé.',{tone:'success'});
    }catch{
      showAppMessage('Le cache n’a pas pu être nettoyé.',{tone:'error'});
    }finally{setCleaning(false);}
  };

  const exportPreferences=()=>{
    const blob=new Blob([JSON.stringify({
      application:'MBotéRoom',
      exportedAt:new Date().toISOString(),
      preferences,
    },null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='mboteroom-donnees-'+new Date().toISOString().slice(0,10)+'.json';
    anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  if(!open)return null;

  return <div className="home-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="home-modal home-storage-modal" role="dialog" aria-modal="true" aria-labelledby="home-storage-title">
      <header className="home-modal-head storage">
        <div className="home-modal-head-icon"><Database/></div>
        <div>
          <span>Stockage & données</span>
          <h2 id="home-storage-title">Gérez votre espace MBotéRoom</h2>
          <p>Consultez l’utilisation réelle de vos données et contrôlez ce qui est conservé sur cet appareil.</p>
        </div>
        <button type="button" aria-label="Fermer" onClick={onClose}><X/></button>
      </header>

      {loading?<AppLoader label="Mise à jour des informations…" />:<>
        <div className="home-storage-overview">
          <article>
            <span><HardDrive/></span>
            <div><small>Données locales</small><strong>{formatBytes(browserUsage)}</strong><p>sur {browserQuota?formatBytes(browserQuota):'quota non communiqué'}</p></div>
            <b>{Math.round(ratio(browserUsage,browserQuota))}%</b>
          </article>
          <article>
            <span><FileVideo/></span>
            <div><small>Enregistrements</small><strong>{formatBytes(recordingsBytes)}</strong><p>{recordingStats?.count||0} enregistrement{Number(recordingStats?.count||0)>1?'s':''}</p></div>
          </article>
          <article>
            <span><Cloud/></span>
            <div><small>Fichiers</small><strong>{formatBytes(filesBytes)}</strong><p>{files.length} fichier{files.length>1?'s':''}</p></div>
          </article>
        </div>

        <section className="home-storage-meter">
          <div><strong>Espace local utilisé</strong><span>{formatBytes(browserUsage)} {browserQuota?'sur '+formatBytes(browserQuota):''}</span></div>
          <i><b style={{width:ratio(browserUsage,browserQuota)+'%'}}/></i>
        </section>

        <div className="home-storage-settings">
          <article><span><Gauge/></span><div><strong>Économie de données</strong><small>{preferences.dataSaver?'Activée':'Désactivée'}</small></div><b className={preferences.dataSaver?'on':''}>{preferences.dataSaver?'Activée':'Standard'}</b></article>
          <article><span><Download/></span><div><strong>Téléchargement média</strong><small>Politique actuelle</small></div><b>{preferences.mediaDownload==='always'?'Toujours':preferences.mediaDownload==='never'?'Jamais':'Wi-Fi uniquement'}</b></article>
        </div>
      </>}

      <div className="home-storage-actions">
        <button type="button" onClick={()=>void refresh()} disabled={loading}><RefreshCw/> Actualiser</button>
        <button type="button" onClick={()=>void clearCache()} disabled={cleaning}><Trash2/> {cleaning?'Nettoyage…':'Nettoyer le cache'}</button>
        <button type="button" onClick={exportPreferences}><Download/> Sauvegarder mes préférences</button>
      </div>

      <footer className="home-modal-footer">
        <button className="secondary" type="button" onClick={onClose}>Fermer</button>
        <button className="primary" type="button" onClick={()=>{onClose();navigate('/app/settings#storage-data');}}><Database/> Paramètres complets</button>
      </footer>
    </section>
  </div>;
}
