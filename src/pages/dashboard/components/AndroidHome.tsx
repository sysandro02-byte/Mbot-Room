import { useEffect, useState } from 'react';
import { Bell, CalendarDays, ChevronRight, FolderOpen, MessageCircle, Search, UsersRound, Video } from 'lucide-react';
import type { HomeSlide, Meeting } from '../../../services/meetingService';
import { getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';
import './AndroidHome.css';

type Props = {
  firstName: string;
  avatar?: string;
  meetings: Meeting[];
  recentMeetings: Meeting[];
  slides: HomeSlide[];
  loading: boolean;
  unreadNotifications: number;
  onCreate: () => void;
  onJoin: () => void;
  onOpen: (meeting: Meeting) => void;
  onAll: () => void;
  onNotifications: () => void;
  onPremium: () => void;
  onCalendar: () => void;
  onMessages: () => void;
  onContacts: () => void;
  onFiles: () => void;
  onProfile: () => void;
  onSearch: () => void;
  onSlideAction: (path: string) => void;
};

const meetingTime = (value: string) => new Intl.DateTimeFormat(getAppLocale(), {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const meetingDateLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Aujourd’hui';
  return new Intl.DateTimeFormat(getAppLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
};

export default function AndroidHome({
  firstName,
  avatar,
  meetings,
  slides,
  loading,
  unreadNotifications,
  onCreate,
  onJoin,
  onOpen,
  onAll,
  onNotifications,
  onPremium,
  onCalendar,
  onMessages,
  onContacts,
  onFiles,
  onProfile,
  onSearch,
  onSlideAction,
}: Props) {
  const [activeSlide, setActiveSlide] = useState(0);
  const availableSlides = slides
    .filter((slide) => slide.slot >= 1 && slide.slot <= 3 && slide.isActive !== false)
    .sort((a, b) => a.slot - b.slot);
  const fallbackSlides = availableSlides.length ? availableSlides : slides.filter((slide) => slide.isActive !== false).slice(0, 1);
  const hero = fallbackSlides[activeSlide % Math.max(fallbackSlides.length, 1)] || null;
  useEffect(() => {
    if (fallbackSlides.length < 2) return;
    const timer = window.setInterval(() => setActiveSlide((index) => (index + 1) % fallbackSlides.length), 7000);
    return () => window.clearInterval(timer);
  }, [fallbackSlides.length]);
  const nextMeeting = meetings[0] || null;
  const isLive = Boolean(nextMeeting && getMeetingPhase(nextMeeting) === 'live');

  return <main className="android-home android-home-redesign" aria-busy={loading}>
    <header className="android-home-topbar">
      <div className="android-home-brand">
        <span>MBoté</span><strong>Room</strong>
        <small>Réunions vidéo sécurisées</small>
      </div>
      <div className="android-home-top-actions">
        <button type="button" className="android-home-avatar" onClick={onProfile} aria-label="Mon profil">
          {avatar ? <img src={avatar} alt="" /> : <span>{firstName.slice(0, 1).toUpperCase()}</span>}
        </button>
        <button type="button" className="android-home-round" onClick={onSearch} aria-label="Recherche"><Search/></button>
        <button type="button" className="android-home-round" onClick={onNotifications} aria-label="Notifications">
          <Bell/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}
        </button>
      </div>
    </header>

    <section className="android-home-welcome">
      <h1>Bonjour, {firstName}</h1>
      <p>Ravi{firstName.toLowerCase().endsWith('a') ? 'e' : ''} de vous revoir !</p>
      <small>Organisez ou rejoignez votre prochaine réunion.</small>
    </section>

    <section className="android-home-main-actions">
      <button type="button" className="android-home-start" onClick={onCreate}>
        <span className="android-home-start-icon"><Video/></span>
        <span className="android-home-action-copy"><strong>Démarrer une réunion</strong><small>Lancez une réunion vidéo en un clic</small></span>
        <ChevronRight/>
      </button>
      <button type="button" className="android-home-join" onClick={onJoin}>
        <span className="android-home-join-icon"><UsersRound/></span>
        <span className="android-home-action-copy"><strong>Rejoindre avec un code</strong><small>Entrez un code de réunion pour nous rejoindre</small></span>
        <ChevronRight/>
      </button>
    </section>

    <section className="android-home-highlights" aria-label="À découvrir">
      <button
        type="button"
        className="android-home-banner"
        onClick={() => hero?.actionPath ? onSlideAction(hero.actionPath) : onCreate()}
        aria-label={(hero?.actionLabel || 'Découvrir') + ' : ' + (hero?.title || 'Organisez vos échanges simplement')}
      >
        <span className="android-home-banner-copy">
          <strong>{hero?.title || 'Organisez vos échanges simplement'}</strong>
          <small>{hero?.body || 'Créez et rejoignez vos réunions en quelques instants.'}</small>
          <span className="android-home-banner-link">{hero?.actionLabel || 'Créer une réunion'} <ChevronRight size={14}/></span>
        </span>
        <img src={hero?.imageUrl || '/images/mboteroom-home-banner.svg'} alt="" loading="lazy" />
      </button>
      {fallbackSlides.length > 1 && <div className="android-home-dots" role="group" aria-label="Choisir une annonce">
        {fallbackSlides.map((slide, index) => (
          <button
            key={slide.slot}
            type="button"
            className={index === activeSlide % fallbackSlides.length ? 'active' : ''}
            aria-label={'Annonce ' + (index + 1) + ' sur ' + fallbackSlides.length}
            aria-current={index === activeSlide % fallbackSlides.length ? 'true' : undefined}
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>}
    </section>

    <section className="android-home-section">
      <div className="android-home-section-title">
        <h2>Prochaine réunion</h2>
        <button type="button" onClick={onAll}>Voir tout <ChevronRight/></button>
      </div>
      {nextMeeting ? <button type="button" className="android-home-next" onClick={() => onOpen(nextMeeting)}>
        <span className="android-home-next-icon"><CalendarDays/></span>
        <span className="android-home-next-copy">
          <strong>{nextMeeting.title}</strong>
          <span>{meetingDateLabel(nextMeeting.start_time)}, {meetingTime(nextMeeting.start_time)}</span>
          <small><Video/> {isLive ? 'En direct' : 'En ligne'}</small>
        </span>
        <span className="android-home-next-arrow"><ChevronRight/></span>
      </button> : <button type="button" className="android-home-next android-home-next-empty" onClick={onCreate}>
        <span className="android-home-next-icon"><CalendarDays/></span>
        <span className="android-home-next-copy"><strong>Aucune réunion programmée</strong><span>Créez votre prochaine réunion MBotéRoom.</span></span>
        <span className="android-home-next-arrow"><ChevronRight/></span>
      </button>}
    </section>

    <section className="android-home-section">
      <h2>Accès rapide</h2>
      <div className="android-home-quick">
        <button type="button" onClick={onMessages}><span className="teal"><MessageCircle/></span><small>Messages</small></button>
        <button type="button" onClick={onContacts}><span className="blue"><UsersRound/></span><small>Contacts</small></button>
        <button type="button" onClick={onCalendar}><span className="indigo"><CalendarDays/></span><small>Calendrier</small></button>
        <button type="button" onClick={onFiles}><span className="gold"><FolderOpen/></span><small>Fichiers</small></button>
      </div>
    </section>

    <button type="button" className="android-home-premium" onClick={onPremium}>
      <span className="android-home-premium-mark">♛</span>
      <span><strong>Passez à MBotéRoom Premium</strong><small>Plus de fonctionnalités pour vos réunions</small></span>
      <ChevronRight/>
    </button>
  </main>;
}
