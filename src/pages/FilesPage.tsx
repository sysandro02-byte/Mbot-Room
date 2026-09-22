import { useEffect, useMemo, useState } from 'react';
import { CirclePlay, FileText, FolderOpen, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appDataService, type Recording, type Whiteboard } from '../services/appDataService';
import './FilesPage.css';

export default function FilesPage() {
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      appDataService.getRecordings().catch(() => []),
      appDataService.getWhiteboards().catch(() => []),
    ]).then(([recordingRows, whiteboardRows]) => {
      if (!active) return;
      setRecordings(Array.isArray(recordingRows) ? recordingRows : []);
      setWhiteboards(Array.isArray(whiteboardRows) ? whiteboardRows : []);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Fichiers indisponibles.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const normalized = query.trim().toLowerCase();
  const visibleRecordings = useMemo(() => recordings.filter((item) => !normalized || item.title.toLowerCase().includes(normalized)), [recordings, normalized]);
  const visibleWhiteboards = useMemo(() => whiteboards.filter((item) => !normalized || item.title.toLowerCase().includes(normalized)), [whiteboards, normalized]);

  return <main className="files-page">
    <header className="files-page-head">
      <div><span><FolderOpen size={20}/></span><div><h1>Fichiers</h1><p>Retrouvez les contenus réellement enregistrés dans votre espace MBotéRoom.</p></div></div>
      <label><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un fichier..."/></label>
    </header>

    {error ? <div className="utility-error">{error}</div> : null}
    {loading ? <div className="files-skeleton-grid">{Array.from({length:4}).map((_,index)=><span key={index}/>)}</div> : null}

    {!loading ? <div className="files-grid">
      <section className="files-card">
        <div className="files-card-title"><CirclePlay size={20}/><div><h2>Enregistrements</h2><small>{visibleRecordings.length}</small></div></div>
        {visibleRecordings.length ? visibleRecordings.map((recording) => <article key={recording.id}>
          <span><CirclePlay size={18}/></span>
          <div><strong>{recording.title}</strong><small>{Math.max(0, Math.round(recording.duration_seconds / 60))} min · {Math.round(recording.size_bytes / 1024 / 1024)} Mo</small></div>
          {recording.storage_url ? <a href={recording.storage_url} target="_blank" rel="noreferrer">Ouvrir</a> : <button type="button" onClick={() => navigate('/app/recordings')}>Voir</button>}
        </article>) : <p className="files-empty">Aucun enregistrement correspondant.</p>}
      </section>

      <section className="files-card">
        <div className="files-card-title"><Sparkles size={20}/><div><h2>Tableaux blancs</h2><small>{visibleWhiteboards.length}</small></div></div>
        {visibleWhiteboards.length ? visibleWhiteboards.map((board) => <article key={board.id}>
          <span><FileText size={18}/></span>
          <div><strong>{board.title}</strong><small>Tableau collaboratif</small></div>
          <button type="button" onClick={() => navigate('/app/whiteboard')}>Ouvrir</button>
        </article>) : <p className="files-empty">Aucun tableau correspondant.</p>}
      </section>
    </div> : null}
  </main>;
}
