import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Mail, Search, UserRound, Video } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appDataService, type Contact } from '../services/appDataService';
import { getMeetingAccessCode, type Meeting, meetingService } from '../services/meetingService';
import './UtilityPages.css';

export default function GlobalSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(searchParams.get('q') || '');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = (searchParams.get('q') || '').trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([meetingService.getMeetings(), appDataService.getContacts()])
      .then(([meetingRows, contactRows]) => {
        if (cancelled) return;
        setMeetings(Array.isArray(meetingRows) ? meetingRows : []);
        setContacts(Array.isArray(contactRows) ? contactRows : []);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    setSearchParams(next ? { q: next } : {});
  };

  return <main className="utility-page">
    <header className="utility-page-head">
      <button type="button" onClick={() => navigate('/app')}><ArrowLeft size={18}/> Accueil</button>
      <div><h1>Recherche MBotéRoom</h1><p>Réunions et contacts provenant du serveur.</p></div>
    </header>

    <form className="utility-search" onSubmit={submit}>
      <Search size={19}/>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Réunion, hôte, ID, contact ou e-mail…" autoFocus/>
      <button type="submit">Rechercher</button>
    </form>

    {error ? <div className="utility-error">{error}</div> : null}
    {loading ? <div className="utility-empty">Chargement des données…</div> : null}
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
    </div> : null}
  </main>;
}
