import { ChevronRight, Crown, Database, MonitorUp, UsersRound, CalendarDays, Clock3, MessageCircle, Video } from 'lucide-react';

type Props = {
  onPremium: () => void;
  onCreateGroup: () => void;
  onStorageData: () => void;
  onShareScreen: () => void;
};

export function HomeQuickActions({ onPremium, onCreateGroup, onStorageData, onShareScreen }: Props) {
  return (
    <>
      <section className="home-quick-actions home-quick-actions-desktop" aria-label="Actions rapides">
        <button className="is-premium" type="button" onClick={onPremium}><span><Crown/></span><div><strong>Premium</strong><small>Découvrir les options Premium</small></div><ChevronRight/></button>
        <button className="is-blue" type="button" onClick={onCreateGroup}><span><UsersRound/></span><div><strong>Créer un groupe</strong><small>Collaborer avec votre équipe</small></div><ChevronRight/></button>
        <button className="is-purple" type="button" onClick={onStorageData}><span><Database/></span><div><strong>Stockage & données</strong><small>Gérer l’espace et les données</small></div><ChevronRight/></button>
        <button className="is-coral" type="button" onClick={onShareScreen}><span><MonitorUp/></span><div><strong>Partager un écran</strong><small>Présenter et collaborer</small></div><ChevronRight/></button>
      </section>
      <section className="home-quick-actions home-quick-actions-mobile" aria-label="Actions rapides">
        <button className="is-teal" type="button" onClick={onPremium}><span><Crown/></span><div><strong>Premium</strong><small>Options Premium</small></div><ChevronRight/></button>
        <button className="is-blue" type="button" onClick={onCreateGroup}><span><UsersRound/></span><div><strong>Créer un groupe</strong><small>Votre équipe</small></div><ChevronRight/></button>
        <button className="is-purple" type="button" onClick={onStorageData}><span><Database/></span><div><strong>Stockage & données</strong><small>Gérer vos données</small></div><ChevronRight/></button>
        <button className="is-coral" type="button" onClick={onShareScreen}><span><MonitorUp/></span><div><strong>Partager l’écran</strong><small>Présenter</small></div><ChevronRight/></button>
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
