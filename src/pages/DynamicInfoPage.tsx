import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiUrl } from '../lib/api';
import AppLoader from '../components/AppLoader';
import './UtilityPages.css';

type PublicPageKey='security'|'features'|'privacy';
type PublicPage={key:PublicPageKey;title:string;body:string;updatedAt:string};

const icons:Record<PublicPageKey,JSX.Element>={
  security:<ShieldCheck size={30}/>,
  features:<Sparkles size={30}/>,
  privacy:<LockKeyhole size={30}/>,
};

export default function DynamicInfoPage({pageKey}:{pageKey:PublicPageKey}){
  const navigate=useNavigate();
  const [page,setPage]=useState<PublicPage|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const response=await apiFetch(apiUrl('/api/public/pages/'+encodeURIComponent(pageKey)),{cache:'no-store'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(typeof payload?.error==='string'?payload.error:'Page indisponible.');
      setPage(payload as PublicPage);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Page indisponible.');
    }finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[pageKey]);

  const paragraphs=useMemo(()=>String(page?.body||'').split(/\n{2,}/).map((item)=>item.trim()).filter(Boolean),[page?.body]);

  return <main className="utility-page">
    <header className="utility-page-head">
      <button type="button" onClick={()=>window.history.length>1?navigate(-1):navigate('/app')}><ArrowLeft size={18}/> Retour</button>
      <div><h1>{page?.title||'MBotéRoom'}</h1><p>Informations officielles MBotéRoom · LoukaTech</p></div>
    </header>

    <section className="utility-card utility-help-intro">
      {icons[pageKey]}
      <div>
        {loading?<AppLoader label="Chargement…" compact />:null}
        {error?<div className="utility-error"><p>{error}</p><button type="button" onClick={()=>void load()}>Réessayer</button></div>:null}
        {!loading&&!error&&page?<article>
          {paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}
          <small>Mis à jour le {new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(page.updatedAt))}</small>
        </article>:null}
      </div>
    </section>
  </main>;
}
