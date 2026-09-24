import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileText, X } from 'lucide-react';
import { legalService, type LegalDocument } from '../services/legalService';
import './TermsConsent.css';

type Props={
  accepted:boolean;
  version:string;
  onAccepted:(accepted:boolean,version:string)=>void;
  compact?:boolean;
  autoOpen?:boolean;
};

export default function TermsConsent({accepted,version,onAccepted,compact=false,autoOpen=false}:Props){
  const [open,setOpen]=useState(false);
  const [document,setDocument]=useState<LegalDocument|null>(null);
  const [loading,setLoading]=useState(false);
  const [readToEnd,setReadToEnd]=useState(false);
  const [checked,setChecked]=useState(false);
  const scrollRef=useRef<HTMLDivElement|null>(null);
  const autoOpenedRef=useRef(false);

  const load=async()=>{
    if(document)return document;
    setLoading(true);
    try{
      const next=await legalService.getTerms();
      setDocument(next);
      return next;
    }finally{setLoading(false);}
  };

  const openTerms=async()=>{
    setReadToEnd(false);setChecked(false);setOpen(true);
    await load().catch(()=>undefined);
  };

  useEffect(()=>{
    if(!autoOpen||accepted||autoOpenedRef.current)return;
    autoOpenedRef.current=true;
    void openTerms();
  },[accepted,autoOpen]);

  useEffect(()=>{
    if(!open)return;
    const node=scrollRef.current;
    if(node&&node.scrollHeight<=node.clientHeight+6)setReadToEnd(true);
  },[document,open]);

  const onScroll=()=>{
    const node=scrollRef.current;
    if(!node)return;
    if(node.scrollTop+node.clientHeight>=node.scrollHeight-18)setReadToEnd(true);
  };

  const confirm=()=>{
    if(!document||!readToEnd||!checked)return;
    onAccepted(true,document.version);
    setOpen(false);
  };

  return <>
    <div className={compact?'terms-consent is-compact':'terms-consent'}>
      <button type="button" className={accepted?'terms-consent-button is-accepted':'terms-consent-button'} onClick={()=>void openTerms()}>
        {accepted?<CheckCircle2 size={16}/>:<FileText size={16}/>}
        {accepted?'Conditions d’utilisation acceptées':'Lire et accepter les conditions d’utilisation'}
      </button>
    </div>

    {open?<div className="terms-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setOpen(false);}}>
      <section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
        <header><div><FileText size={22}/><div><h2 id="terms-modal-title">{document?.title||'Conditions d’utilisation'}</h2><small>{document?.version?'Version '+document.version:'Chargement…'}</small></div></div><button type="button" aria-label="Fermer" onClick={()=>setOpen(false)}><X size={19}/></button></header>
        <div className="terms-modal-body" ref={scrollRef} onScroll={onScroll}>
          {loading?<p>Chargement des conditions…</p>:document?.body.split(/\n{2,}/).map((paragraph,index)=><p key={index}>{paragraph}</p>)}
        </div>
        <div className="terms-modal-footer">
          <label className={!readToEnd?'is-disabled':''}><input type="checkbox" checked={checked} disabled={!readToEnd} onChange={(event)=>setChecked(event.target.checked)}/><span>J’ai lu ces conditions jusqu’à la fin et je les accepte.</span></label>
          {!readToEnd?<small>Faites défiler le texte jusqu’en bas pour pouvoir accepter.</small>:null}
          <div><button type="button" onClick={()=>setOpen(false)}>Annuler</button><button className="primary" type="button" disabled={!document||!readToEnd||!checked} onClick={confirm}>Accepter les conditions</button></div>
        </div>
      </section>
    </div>:null}
  </>;
}
