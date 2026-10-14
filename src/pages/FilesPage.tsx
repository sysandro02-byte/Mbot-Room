import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CirclePlay, Cloud, Eye, FileImage, FileText, FolderOpen, Grid2X2, Image, List, LoaderCircle, Music, Search, Sparkles, Trash2, Upload, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appDataService, type Preferences, type Recording, type Whiteboard } from '../services/appDataService';
import { authService } from '../services/authService';
import { workspaceService, type WorkspaceFile } from '../services/workspaceService';
import { showAppMessage } from '../lib/appMessage';
import './FilesPage.css';

const formatBytes=(value:number)=>{
  if(value<1024)return `${value} o`;
  if(value<1024*1024)return `${(value/1024).toFixed(1)} Ko`;
  if(value<1024*1024*1024)return `${(value/1024/1024).toFixed(1)} Mo`;
  return `${(value/1024/1024/1024).toFixed(1)} Go`;
};

export default function FilesPage() {
  const navigate = useNavigate();
  const currentUser=authService.getCurrentUser();
  const inputRef=useRef<HTMLInputElement|null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [uploadedFiles,setUploadedFiles]=useState<WorkspaceFile[]>([]);
  const [preferences,setPreferences]=useState<Preferences>({});
  const [query, setQuery] = useState('');
  const [fileCategory, setFileCategory] = useState<'all'|'documents'|'images'|'videos'|'audio'>('all');
  const [sortBy,setSortBy]=useState<'recent'|'name'|'size'>('recent');
  const [viewMode,setViewMode]=useState<'list'|'grid'>('list');
  const [loading, setLoading] = useState(true);
  const [uploading,setUploading]=useState(false);
  const [error, setError] = useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [recordingRows,whiteboardRows,fileRows,prefs]=await Promise.all([
        appDataService.getRecordings().catch(()=>[]),
        appDataService.getWhiteboards().catch(()=>[]),
        workspaceService.getFiles().catch(()=>[]),
        appDataService.getPreferences().catch(()=>({} as Preferences)),
      ]);
      setRecordings(Array.isArray(recordingRows)?recordingRows:[]);
      setWhiteboards(Array.isArray(whiteboardRows)?whiteboardRows:[]);
      setUploadedFiles(Array.isArray(fileRows)?fileRows:[]);
      setPreferences(prefs||{});
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Fichiers indisponibles.');
    }finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(!['application/pdf','image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){
      showAppMessage('Seuls les fichiers PDF, JPG, PNG, WEBP et GIF sont autorisés.',{tone:'warning',title:'Format non autorisé'});
      return;
    }
    if(file.size>10*1024*1024){
      showAppMessage('Le fichier dépasse la limite de 10 Mo.',{tone:'warning',title:'Fichier trop volumineux'});
      return;
    }
    setUploading(true);
    try{
      const saved=await workspaceService.uploadFile(file);
      setUploadedFiles((current)=>[saved,...current.filter((item)=>item.id!==saved.id)]);
      showAppMessage('Le fichier a été envoyé dans votre espace MBotéRoom.',{tone:'success',title:'Fichier envoyé'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Envoi du fichier impossible.',{tone:'error'});
    }finally{setUploading(false);}
  };

  const remove=async(file:WorkspaceFile)=>{
    try{
      await workspaceService.deleteFile(file.id);
      setUploadedFiles((current)=>current.filter((item)=>item.id!==file.id));
      showAppMessage('Le fichier a été supprimé.',{tone:'success'});
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Suppression impossible.',{tone:'error'});
    }
  };

  const openRecording=async(recording:Recording)=>{
    try{
      const access=await appDataService.getRecordingAccess(recording.id);
      const link=document.createElement('a');
      link.href=access.url;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.click();
    }catch(cause){
      showAppMessage(cause instanceof Error?cause.message:'Accès à l’enregistrement impossible.',{tone:'error'});
    }
  };

  const shouldDownloadMedia=()=>{
    if(preferences.mediaDownload==='always')return true;
    if(preferences.mediaDownload==='never')return false;
    const connection=(navigator as Navigator & {connection?:{type?:string;effectiveType?:string}}).connection;
    return connection?.type==='wifi';
  };

  const normalized = query.trim().toLowerCase();
  const visibleRecordings = useMemo(() => recordings.filter((item) => !normalized || item.title.toLowerCase().includes(normalized))
    .sort((a,b)=>sortBy==='name'?a.title.localeCompare(b.title):sortBy==='size'?b.size_bytes-a.size_bytes:new Date(b.created_at).getTime()-new Date(a.created_at).getTime()), [recordings, normalized, sortBy]);
  const visibleWhiteboards = useMemo(() => whiteboards.filter((item) => !normalized || item.title.toLowerCase().includes(normalized))
    .sort((a,b)=>sortBy==='name'?a.title.localeCompare(b.title):new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime()), [whiteboards, normalized, sortBy]);
  const visibleFiles=useMemo(()=>uploadedFiles.filter((item)=>
    (!normalized||item.name.toLowerCase().includes(normalized)) &&
    (fileCategory==='all'||fileCategory==='documents'&&item.mimeType==='application/pdf'||fileCategory==='images'&&item.mimeType.startsWith('image/')))
    .sort((a,b)=>sortBy==='name'?a.name.localeCompare(b.name):sortBy==='size'?b.sizeBytes-a.sizeBytes:new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),[uploadedFiles,normalized,fileCategory,sortBy]);
  const storedBytes=uploadedFiles.reduce((sum,file)=>sum+Math.max(0,file.sizeBytes),0)+recordings.reduce((sum,rec)=>sum+Math.max(0,rec.size_bytes),0);
  const categories=[
    {id:'all',label:'Tous',icon:FolderOpen},{id:'documents',label:'Documents',icon:FileText},
    {id:'images',label:'Images',icon:Image},{id:'videos',label:'Vidéos',icon:Video},{id:'audio',label:'Audio',icon:Music},
  ] as const;

  return <main className="files-page">
    <header className="files-page-head">
      <div><span><FolderOpen size={20}/></span><div><h1>Fichiers</h1><p>Envoyez et retrouvez vos PDF, images, enregistrements et tableaux MBotéRoom.</p></div></div>
      <div className="files-page-head-actions">
        <label><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un fichier..."/></label>
        <button className="files-upload-button" type="button" disabled={uploading} onClick={()=>inputRef.current?.click()}>
          {uploading?<LoaderCircle className="is-spinning" size={17}/>:<Upload size={17}/>}
          {uploading?'Envoi...':'Envoyer un fichier'}
        </button>
        <input ref={inputRef} className="files-hidden-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={upload}/>
      </div>
    </header>

    <section className="files-storage-summary" aria-label="Espace occupé par vos fichiers">
      <span><Cloud size={24}/></span><div><strong>Espace de stockage</strong>
      <small>{formatBytes(storedBytes)} de documents et enregistrements répertoriés</small></div>
      <button type="button" onClick={()=>navigate('/app/settings#storage-data')}>Gérer</button>
    </section>
    <nav className="files-category-tabs" aria-label="Catégories des fichiers">
      {categories.map(({id,label,icon:Icon})=><button key={id} type="button" aria-pressed={fileCategory===id}
        className={fileCategory===id?'active':''} onClick={()=>setFileCategory(id)}><Icon size={19}/>{label}</button>)}
    </nav>
    <div className="files-tools">
      <strong>{fileCategory==='all'?'Récents':categories.find((c)=>c.id===fileCategory)?.label}</strong>
      <label>Trier par <select aria-label="Trier les fichiers" value={sortBy} onChange={(event)=>setSortBy(event.target.value as typeof sortBy)}>
        <option value="recent">Date</option><option value="name">Nom</option><option value="size">Taille</option>
      </select></label>
      <div role="group" aria-label="Affichage des fichiers">
        <button type="button" aria-label="Vue liste" aria-pressed={viewMode==='list'} onClick={()=>setViewMode('list')}><List size={20}/></button>
        <button type="button" aria-label="Vue grille" aria-pressed={viewMode==='grid'} onClick={()=>setViewMode('grid')}><Grid2X2 size={20}/></button>
      </div>
    </div>
    {error ? <div className="utility-error">{error}</div> : null}
    {loading ? <div className="files-skeleton-grid">{Array.from({length:4}).map((_,index)=><span key={index}/>)}</div> : null}

    {!loading ? <div className={`files-grid ${viewMode==='grid'?'is-grid-view':''}`}>
      {fileCategory==='audio'?<section className="files-card files-uploaded-card"><p className="files-empty">Aucun fichier audio. L’import audio n’est pas encore disponible dans cet espace.</p></section>:null}
      {(fileCategory==='all'||fileCategory==='documents'||fileCategory==='images')?<section className="files-card files-uploaded-card">
        <div className="files-card-title"><Upload size={20}/><div><h2>{fileCategory==='images'?'Images':fileCategory==='documents'?'Documents':'PDF et images'}</h2><small>{visibleFiles.length}</small></div></div>
        {visibleFiles.length?visibleFiles.map((file)=><article key={file.id}>
          <span>{file.mimeType==='application/pdf'?<FileText size={18}/>:<FileImage size={18}/>}</span>
          <div><strong>{file.name}</strong><small>{file.mimeType==='application/pdf'?'PDF':'Image'} · {formatBytes(file.sizeBytes)}</small></div>
          <div className="files-row-actions">
            <button type="button" onClick={()=>void workspaceService.openFile(file.id,shouldDownloadMedia()?file.name:undefined)}><Eye size={15}/>{shouldDownloadMedia()?'Télécharger':'Ouvrir'}</button>
            {Number(file.ownerId)===Number(currentUser?.id)?<button className="is-danger" type="button" aria-label={`Supprimer ${file.name}`} onClick={()=>void remove(file)}><Trash2 size={15}/></button>:null}
          </div>
        </article>):<p className="files-empty">Aucun fichier correspondant.</p>}
      </section>:null}
      {(fileCategory==='all'||fileCategory==='videos')?<section className="files-card">
        <div className="files-card-title"><CirclePlay size={20}/><div><h2>Enregistrements</h2><small>{visibleRecordings.length}</small></div></div>
        {visibleRecordings.length ? visibleRecordings.map((recording) => <article key={recording.id}>
          <span><CirclePlay size={18}/></span>
          <div><strong>{recording.title}</strong><small>{Math.max(0, Math.round(recording.duration_seconds / 60))} min · {Math.round(recording.size_bytes / 1024 / 1024)} Mo</small></div>
          <button type="button" onClick={() => void openRecording(recording)}>Ouvrir</button>
        </article>) : <p className="files-empty">Aucun enregistrement correspondant.</p>}
      </section>:null}

      {(fileCategory==='all'||fileCategory==='documents')?<section className="files-card">
        <div className="files-card-title"><Sparkles size={20}/><div><h2>Tableaux blancs</h2><small>{visibleWhiteboards.length}</small></div></div>
        {visibleWhiteboards.length ? visibleWhiteboards.map((board) => <article key={board.id}>
          <span><FileText size={18}/></span>
          <div><strong>{board.title}</strong><small>Tableau collaboratif</small></div>
          <button type="button" onClick={() => navigate('/app/whiteboard')}>Ouvrir</button>
        </article>) : <p className="files-empty">Aucun tableau correspondant.</p>}
      </section>:null}
    </div> : null}
  </main>;
}
