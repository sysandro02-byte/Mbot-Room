import { CalendarDays, ChevronRight, Clock3, MessageCircle, MonitorUp, Plus, Video } from 'lucide-react';

type Props = {
  onNewMeeting: () => void;
  onJoin: () => void;
  onPlan: () => void;
  onShareScreen: () => void;
  onCalendar: () => void;
  onMessages: () => void;
};

export function HomeQuickActions({ onNewMeeting, onJoin, onPlan, onShareScreen, onCalendar, onMessages }: Props) {
  return (
    <>
      <section className="home-quick-actions home-quick-actions-desktop" aria-label="Actions rapides">
        <button className="is-teal" type="button" onClick={onNewMeeting}><span><Video/></span><div><strong>Nouvelle réunion</strong><small>Démarrer maintenant</small></div><ChevronRight/></button>
        <button className="is-blue" type="button" onClick={onJoin}><span><Plus/></span><div><strong>Rejoindre</strong><small>Avec un code ou un lien</small></div><ChevronRight/></button>
        <button className="is-purple" type="button" onClick={onPlan}><span><CalendarDays/></span><div><strong>Planifier</strong><small>Programmer plus tard</small></div><ChevronRight/></button>
        <button className="is-coral" type="button" onClick={onShareScreen}><span><MonitorUp/></span><div><strong>Partager un écran</strong><small>Présenter et collaborer</small></div><ChevronRight/></button>
      </section>
      <section className="home-quick-actions home-quick-actions-mobile" aria-label="Actions rapides">
        <button className="is-teal" type="button" onClick={onNewMeeting}><span><Video/></span><div><strong>Nouvelle réunion</strong><small>Démarrer maintenant</small></div><ChevronRight/></button>
        <button className="is-purple" type="button" onClick={onPlan}><span><CalendarDays/></span><div><strong>Planifier</strong><small>Programmer plus tard</small></div><ChevronRight/></button>
        <button className="is-coral" type="button" onClick={onCalendar}><span><Clock3/></span><div><strong>Calendrier</strong><small>Voir mes réunions</small></div><ChevronRight/></button>
        <button className="is-blue" type="button" onClick={onMessages}><span><MessageCircle/></span><div><strong>Messages</strong><small>Échanger avec mon équipe</small></div><ChevronRight/></button>
      </section>
    </>
  );
}

export type HomeStatsData = {
  upcomingMeetings: number;
  contacts: number;
  recordings: number;
  monthlyMinutes: number;
};

export function HomeStats({ data }: { data: HomeStatsData }) {
  const hours = data.monthlyMinutes < 60
    ? `${data.monthlyMinutes} min`
    : `${Math.round((data.monthlyMinutes / 60) * 10) / 10} h`;
  return (
    <section className="home-stats-card">
      <div className="home-section-head"><h2>Mes statistiques</h2></div>
      <div className="home-stats-grid">
        <article><span className="is-blue"><CalendarDays/></span><strong>{data.upcomingMeetings}</strong><small>Réunions à venir</small></article>
        <article><span className="is-teal"><MessageCircle/></span><strong>{data.contacts}</strong><small>Contacts</small></article>
        <article><span className="is-coral"><Video/></span><strong>{data.recordings}</strong><small>Enregistrements</small></article>
        <article><span className="is-blue"><Clock3/></span><strong>{hours}</strong><small>Temps de réunion ce mois-ci</small></article>
      </div>
    </section>
  );
}
