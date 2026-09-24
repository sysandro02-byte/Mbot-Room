import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { legalService, type LegalDocument } from '../services/legalService';
import './TermsPage.css';
import AppLoader from '../components/AppLoader';

export default function TermsPage(){
  const [document,setDocument]=useState<LegalDocument|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{setDocument(await legalService.getTerms());}
    catch(cause){setError(cause instanceof Error?cause.message:'Conditions indisponibles.');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  return <main className="terms-page">
    <section className="terms-page-card">
      <header><span><FileText/></span><div><p>MBotéRoom · LoukaTech</p><h1>{document?.title||'Conditions d’utilisation'}</h1>{document?.version?<small>Version {document.version}</small>:null}</div></header>
      {loading?<AppLoader label="Chargement des conditions…" compact />:null}
      {error?<div className="terms-page-state is-error"><p>{error}</p><button onClick={()=>void load()}>Réessayer</button></div>:null}
      {document&&!loading?<article>{document.body.split(/\n{2,}/).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</article>:null}
      <footer>Ces conditions sont administrées depuis le backoffice MBotéRoom. Une nouvelle version peut nécessiter une nouvelle acceptation.</footer>
    </section>
  </main>;
}
