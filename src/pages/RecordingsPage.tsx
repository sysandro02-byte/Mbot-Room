import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CirclePlay, Clock3, Database, Download, Headphones, MoreVertical, Play, Search, Share2, Star, UsersRound, Video } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appDataService, type Recording, type RecordingStats } from '../services/appDataService';
import { showAppMessage } from '../lib/appMessage';
import './RecordingsPage.css';

type Filter='all'|'video'|'audio'|'favorites';
type Sort='recent'|'oldest'|'longest';

const duration=(seconds:number)=>{
  const total=Math.max(0,Math.round(seconds||0));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  return h?String(h)+'h '+String(m).padStart(2,'0')+'min':m?String(m)+'min '+String(s).padStart(2,'0')+'s':String(s)+'s';
};
const bytes=(value:number)=>{
  const size=Math.max(0,Number(value||0));
  if(size>=1073741824)return (size/1073741824).toFixed(1)+' Go';
  if(size>=1048576)return (size/1048576).toFixed(1)+' Mo';
  if(size>=1024)return Math.round(size/1024)+' Ko';
  return size+' o';
};
const date=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const audio=(item:Recording)=>String(item.mime_type||'').startsWith('audio/');

export default function RecordingsPage(){
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const [items,setItems]=useState<Recording[]>([]);
  const [stats,setStats]=useState<RecordingStats>({count:0,durationSeconds:0,sizeBytes:0,latestAt:null,quotaBytes:0});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<Filter>('all');
  const [sort,setSort]=useState<Sort>('recent');
  const [busy,setBusy]=useState('');
  const [menu,setMenu]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const result=await Promise.all([appDataService.getRecordings(),appDataService.getRecordingStats()]);
      setItems(result[0]);setStats(result[1]);
    }catch(cause){setError(cause instanceof Error?cause.message:'Impossible de charger les enregistrements.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const id=params.get('recording');
    if(id&&items.some((item)=>item.id===id))setTimeout(()=>document.getElementById('recording-'+id)?.scrollIntoView({behavior:'smooth',block:'center'}),100);
  },[items,params]);

  const list=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return items.filter((item)=>{
      if(filter==='video'&&audio(item))return false;
      if(filter==='audio'&&!audio(item))return false;
      if(filter==='favorites'&&!item.favorite)return false;
      return !q||(item.title+' '+(item.description||'')+' '+(item.host_name||'')).toLowerCase().includes(q);
    }).sort((a,b)=>{
      if(sort==='oldest')return new Date(a.created_at).getTime()-new Date(b.created_at).getTime();
      if(sort==='longest')return Number(b.duration_seconds||0)-Number(a.duration_seconds||0);
      return new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
    });
  },[filter,items,search,sort]);

  const featured=items.find((item)=>item.favorite)||items[0]||null;
  const storagePercent=stats.quotaBytes>0?Math.min(100,Math.round(stats.sizeBytes/stats.quotaBytes*100)):0;

  const openRecording=async(item:Recording,download=false)=>{
    setBusy(item.id);
    try{
      const access=await appDataService.getRecordingAccess(item.id);
      const link=document.createElement('a');
      link.href=access.url;link.target='_blank';link.rel='noopener noreferrer';
      if(download)link.download='mboteroom-'+item.id;
      document.body.appendChild(link);link.click();link.remove();
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Le fichier n’est pas encore disponible.',{tone:'error'});}
    finally{setBusy('');}
  };

  const favorite=async(item:Recording)=>{
    setBusy(item.id);
    try{
      const next=!Boolean(item.favorite);
      await appDataService.setRecordingFavorite(item.id,next);
      setItems((current)=>current.map((value)=>value.id===item.id?{...value,favorite:next}:value));
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Modification impossible.',{tone:'error'});}
    finally{setBusy('');}
  };

  const share=async(item:Recording)=>{
    const url=window.location.origin+'/app/recordings?recording='+encodeURIComponent(item.id);
    try{
      if(navigator.share)await navigator.share({title:item.title,text:'Enregistrement MBotéRoom',url});
      else{await navigator.clipboard.writeText(url);showAppMessage('Lien sécurisé copié.',{tone:'success'});}
    }catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))showAppMessage('Partage impossible.',{tone:'error'});}
  };

  const hide=async(item:Recording)=>{
    setBusy(item.id);
    try{
      await appDataService.hideRecording(item.id);
      setItems((current)=>current.filter((value)=>value.id!==item.id));
      setStats((current)=>({...current,count:Math.max(0,current.count-1),durationSeconds:Math.max(0,current.durationSeconds-Number(item.duration_seconds||0)),sizeBytes:Math.max(0,current.sizeBytes-Number(item.size_bytes||0))}));
      setMenu('');
      showAppMessage('Enregistrement retiré de votre liste.',{tone:'success'});
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Suppression impossible.',{tone:'error'});}
    finally{setBusy('');}
  };

  return <section className="recordings-pro-page">
    <header className="recordings-pro-hero">
      <span><Download/></span>
      <div><h1>Enregistrements</h1><p>Retrouvez vos enregistrements de réunions, webinaires et appels.</p></div>
      <button onClick={()=>navigate('/app/meetings')}><Video size={17}/> Nouvel enregistrement</button>
    </header>

    <section className="recordings-pro-stats">
      <article><span><CirclePlay/></span><div><strong>{stats.count}</strong><small>Enregistrements</small></div></article>
      <article><span><Clock3/></span><div><strong>{duration(stats.durationSeconds)}</strong><small>Durée totale</small></div></article>
      <article><span><CalendarDays/></span><div><strong>{stats.latestAt?'Dernier ajout':'Aucun ajout'}</strong><small>{stats.latestAt?date(stats.latestAt):'—'}</small></div></article>
      <article><span><Database/></span><div><strong>{bytes(stats.sizeBytes)}</strong><small>Stockage utilisé</small></div></article>
    </section>

    {error?<div className="recordings-pro-error">{error}</div>:null}

    <div className="recordings-pro-layout">
      <main>
        {featured?<section className="recordings-pro-featured">
          <h2><Star size={17} fill="currentColor"/> Enregistrement en vedette</h2>
          <div>
            <button className="recordings-pro-preview" onClick={()=>void openRecording(featured)}><span>{audio(featured)?<Headphones/>:<Play/>}</span><b>{duration(featured.duration_seconds)}</b></button>
            <div className="recordings-pro-featured-copy">
              <h3>{featured.title}</h3>
              <small><CalendarDays/> {date(featured.start_time||featured.created_at)} <UsersRound/> {Number(featured.participant_count||0)} participants</small>
              <p>{featured.description||'Enregistrement MBotéRoom.'}</p>
              <div className="recordings-pro-actions">
                <button className="primary" disabled={busy===featured.id} onClick={()=>void openRecording(featured)}><Play/> Lire maintenant</button>
                <button disabled={busy===featured.id} onClick={()=>void openRecording(featured,true)}><Download/> Télécharger</button>
                <button onClick={()=>void share(featured)}><Share2/> Partager</button>
                <button className={featured.favorite?'active':''} onClick={()=>void favorite(featured)}><Star fill={featured.favorite?'currentColor':'none'}/></button>
              </div>
            </div>
          </div>
        </section>:null}

        <section className="recordings-pro-list">
          <div className="recordings-pro-list-head">
            <h2>Tous les enregistrements ({list.length})</h2>
            <label><Search/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Rechercher un enregistrement…"/></label>
            <div>{(['all','video','audio','favorites'] as Filter[]).map((value)=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{value==='all'?'Tous':value==='video'?'Vidéo':value==='audio'?'Audio':'Favoris'}</button>)}</div>
            <select value={sort} onChange={(event)=>setSort(event.target.value as Sort)}><option value="recent">Plus récents d’abord</option><option value="oldest">Plus anciens</option><option value="longest">Durée la plus longue</option></select>
          </div>

          {loading?<div className="recordings-pro-empty">Chargement…</div>:list.map((item)=><article id={'recording-'+item.id} key={item.id}>
            <button className="recordings-pro-thumb" onClick={()=>void openRecording(item)}>{audio(item)?<Headphones/>:<Play/>}<b>{duration(item.duration_seconds)}</b></button>
            <div className="recordings-pro-copy"><strong>{item.title}</strong><small><CalendarDays/> {date(item.start_time||item.created_at)} <UsersRound/> {Number(item.participant_count||0)} participants</small><span>{audio(item)?'Audio':'Vidéo'} · {bytes(item.size_bytes)}</span></div>
            <button className={item.favorite?'recordings-pro-star active':'recordings-pro-star'} onClick={()=>void favorite(item)}><Star fill={item.favorite?'currentColor':'none'}/></button>
            <button disabled={busy===item.id} onClick={()=>void openRecording(item)}><Play/> Lire</button>
            <button disabled={busy===item.id} onClick={()=>void openRecording(item,true)} aria-label="Télécharger"><Download/></button>
            <button onClick={()=>void share(item)} aria-label="Partager"><Share2/></button>
            <div className="recordings-pro-menu-wrap"><button onClick={()=>setMenu(menu===item.id?'':item.id)}><MoreVertical/></button>{menu===item.id?<div className="recordings-pro-menu"><button onClick={()=>void hide(item)}>Retirer de ma liste</button></div>:null}</div>
          </article>)}
          {!loading&&!list.length?<div className="recordings-pro-empty"><CirclePlay size={34}/><strong>Aucun enregistrement</strong><p>Créez ou ouvrez une réunion pour commencer un enregistrement.</p></div>:null}
        </section>
      </main>

      <aside className="recordings-pro-side">
        <section><h3><Database/> Stockage</h3><strong>{bytes(stats.sizeBytes)}{stats.quotaBytes?' sur '+bytes(stats.quotaBytes):''}</strong>{stats.quotaBytes?<><div className="recordings-pro-storage"><i style={{width:storagePercent+'%'}}/></div><small>{storagePercent}% utilisé</small></>:null}<button onClick={()=>navigate('/app/files')}>Gérer le stockage</button></section>
        <section><h3>Activité récente</h3>{items.slice(0,5).map((item)=><button key={item.id} onClick={()=>void openRecording(item)}><span>{audio(item)?<Headphones/>:<Play/>}</span><div><strong>{item.title}</strong><small>{date(item.created_at)} · {duration(item.duration_seconds)}</small></div></button>)}{!items.length?<p>Aucune activité récente.</p>:null}</section>
        <section className="recordings-pro-tip"><Star/><div><h3>Astuce</h3><p>Les liens partagés conservent les contrôles d’accès MBotéRoom.</p></div></section>
      </aside>
    </div>
  </section>;
}
