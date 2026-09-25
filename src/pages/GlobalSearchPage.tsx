import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CirclePlay, FolderOpen, Mail, Search, Sparkles, UserRound, Video } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appDataService, type Contact, type Recording, type Whiteboard } from '../services/appDataService';
import { getMeetingAccessCode, type Meeting, meetingService } from '../services/meetingService';
import './UtilityPages.css';
import AppLoader from '../components/AppLoader';

export default function GlobalSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(searchParams.get('q') || '');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = (searchParams.get('q') || '').trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      meetingService.getMeetings(),
      appDataService.getContacts(),
      appDataService.getRecordings().catch(() => []),
      appDataService.getWhiteboards().catch(() => []),
    ])
      .then(([meetingRows, contactRows, recordingRows, whiteboardRows]) => {
        if (cancelled) return;
        setMeetings(Array.isArray(meetingRows) ? meetingRows : []);
        setContacts(Array.isArray(contactRows) ? contactRows : []);
        setRecordings(Array.isArray(recordingRows) ? recordingRows : []);
        setWhiteboards(Array.isArray(whiteboardRows) ? whiteboardRows : []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Recherche impossible.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredMeetings = useMemo(() => {
    if (!query) return [];
    const compact = query.replace(/\s+/g, '');
    return meetings.filter((meeting) => [
      meeting.title,
      meeting.description,
      meeting.host_name,
      String(meeting.id),
      getMeetingAccessCode(meeting),
      meeting.meeting_link,
    ].some((value) => String(value || '').toLowerCase().replace(/\s+/g, '').includes(compact))).slice(0, 30);
  }, [meetings, query]);

  const filteredContacts = useMemo(() => {
    if (!query) return [];
    return contacts.filter((contact) => [
      contact.name,
      contact.username,
      contact.email,
    ].some((value) => String(value || '').toLowerCase().includes(query))).slice(0, 30);
  }, [contacts, query]);

  const filteredRecordings = useMemo(() => {
    if (!query) return [];
    return recordings.filter((recording) => String(recording.title || '').toLowerCase().includes(query)).slice(0, 20);
  }, [recordings, query]);

  const filteredWhiteboards = useMemo(() => {
    if (!query) return [];
    return whiteboards.filter((board) => String(board.title || '').toLowerCase().includes(query)).slice(0, 20);
  }, [whiteboards, query]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    setSearchParams(next ? { q: next } : {});
  };

  return <main className="utility-page">
    <header className="utility-page-head">
      <button type="button" onClick={() => navigate('/app')}><ArrowLeft size={18}/> Accueil</button>
      <div><h1>Recherche MBotéRoom</h1><p>Retrouvez rapidement vos réunions, contacts et fichiers.</p></div>
    </header>

    <form className="utility-search" onSubmit={submit}>
      <Search size={19}/>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Réunion, hôte, ID, contact ou fichier…" autoFocus/>
      <button type="submit">Rechercher</button>
    </form>

    {error ? <div className="utility-error">{error}</div> : null}
    {loading ? <AppLoader label="Chargement des données…" compact /> : null}
    {!loading && !query ? <div className="utility-empty">Saisissez un terme pour lancer la recherche.</div> : null}

    {!loading && query ? <div className="utility-grid">
      <section className="utility-card">
        <h2><CalendarDays size={19}/> Réunions <span>{filteredMeetings.length}</span></h2>
        {filteredMeetings.length ? filteredMeetings.map((meeting) => <article key={meeting.id} className="utility-result">
          <div>
            <strong>{meeting.title}</strong>
            <small>{meeting.host_name} · ID {meeting.settings?.meetingAccessId || getMeetingAccessCode(meeting)}</small>
            {meeting.description ? <p>{meeting.description}</p> : null}
          </div>
          <button type="button" onClick={() => navigate('/join/' + encodeURIComponent(meeting.meeting_link))}><Video size={16}/> Ouvrir</button>
        </article>) : <p className="utility-muted">Aucune réunion correspondante.</p>}
      </section>

      <section className="utility-card">
        <h2><UserRound size={19}/> Contacts <span>{filteredContacts.length}</span></h2>
        {filteredContacts.length ? filteredContacts.map((contact) => <article key={contact.id} className="utility-result">
          <div>
            <strong>{contact.name || contact.username}</strong>
            <small>@{contact.username || 'utilisateur'}</small>
            <p><Mail size={13}/> {contact.email}</p>
          </div>
          <button type="button" onClick={() => navigate('/app/contacts')}><UserRound size={16}/> Contacts</button>
        </article>) : <p className="utility-muted">Aucun contact correspondant.</p>}
      </section>

      <section className="utility-card">
        <h2><FolderOpen size={19}/> Fichiers <span>{filteredRecordings.length + filteredWhiteboards.length}</span></h2>
        {filteredRecordings.map((recording) => <article key={'rec-' + recording.id} className="utility-result">
          <div>
            <strong>{recording.title}</strong>
            <small><CirclePlay size={13}/> Enregistrement</small>
          </div>
          {recording.storage_url ? <a href={recording.storage_url} target="_blank" rel="noreferrer"><CirclePlay size={16}/> Ouvrir</a> : <button type="button" onClick={() => navigate('/app/recordings')}><CirclePlay size={16}/> Voir</button>}
        </article>)}
        {filteredWhiteboards.map((board) => <article key={'board-' + board.id} className="utility-result">
          <div>
            <strong>{board.title}</strong>
            <small><Sparkles size={13}/> Tableau blanc</small>
          </div>
          <button type="button" onClick={() => navigate('/app/whiteboard')}><Sparkles size={16}/> Ouvrir</button>
        </article>)}
        {!filteredRecordings.length && !filteredWhiteboards.length ? <p className="utility-muted">Aucun fichier correspondant.</p> : null}
      </section>
    </div> : null}
  </main>;
}
