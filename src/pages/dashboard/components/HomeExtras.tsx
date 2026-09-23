import { CalendarDays, ChevronRight, FileText, FolderOpen, Headphones, Languages, ListChecks, MessageCircle, MonitorUp, PanelsTopLeft, Sparkles, UsersRound, Video, WandSparkles } from 'lucide-react';
import type { Meeting } from '../../../services/meetingService';
import { getStoredLanguage, persistAppLanguage, type AppLanguage } from '../../../lib/appLanguage';

type LunaProps = {
  targetMeeting: Meeting | null;
  onOpenMeeting: (meeting: Meeting) => void;
  onAllMeetings: () => void;
};

export function LunaAssistantCard({ targetMeeting, onOpenMeeting, onAllMeetings }: LunaProps) {
  const openTarget = () => targetMeeting ? onOpenMeeting(targetMeeting) : onAllMeetings();
  return (
    <section className="home-card home-luna-card">
      <div className="home-luna-head">
        <span><Sparkles size={28}/></span>
        <div><h2>Assistant Luna IA</h2><p>Votre assistant de réunion intelligent</p></div>
        <button type="button" aria-label="Voir Luna IA" onClick={openTarget}><ChevronRight/></button>
      </div>
      <div className="home-luna-actions">
        <button type="button" onClick={openTarget}><FileText/><span><strong>Résumer vos réunions</strong><small>Retrouvez les points clés automatiquement</small></span></button>
        <button type="button" onClick={openTarget}><ListChecks/><span><strong>Extraire les actions</strong><small>Listez les décisions et tâches</small></span></button>
        <button type="button" onClick={openTarget}><Languages/><span><strong>Traduire en temps réel</strong><small>Ouvrez une réunion pour les sous-titres</small></span></button>
        <button type="button" onClick={openTarget}><WandSparkles/><span><strong>Générer des comptes rendus</strong><small>Utilisez les données réelles de la réunion</small></span></button>
      </div>
    </section>
  );
}

type QuickProps = {
  onMessages: () => void;
  onContacts: () => void;
  onCalendar: () => void;
  onFiles: () => void;
  onPolls: () => void;
  onWhiteboard: () => void;
};

export function HomeQuickAccess({ onMessages, onContacts, onCalendar, onFiles, onPolls, onWhiteboard }: QuickProps) {
  return <section className="home-card home-quick-access">
    <div className="home-section-head"><h2>Accès rapide</h2></div>
    <div>
      <button type="button" onClick={onMessages}><MessageCircle/><span>Messages</span></button>
      <button type="button" onClick={onContacts}><UsersRound/><span>Contacts</span></button>
      <button type="button" onClick={onCalendar}><CalendarDays/><span>Calendrier</span></button>
      <button type="button" onClick={onFiles}><FolderOpen/><span>Fichiers</span></button>
      <button type="button" onClick={onPolls}><ListChecks/><span>Sondages</span></button>
      <button type="button" onClick={onWhiteboard}><PanelsTopLeft/><span>Tableau blanc</span></button>
    </div>
  </section>;
}

export function HomeFeatureBanner({ imageUrl, onDiscover }: { imageUrl?: string; onDiscover: () => void }) {
  return <section className="home-feature-banner">
    <div className="home-feature-image"><img src={imageUrl || '/images/meeting-black-team.svg'} alt="" loading="lazy"/></div>
    <div className="home-feature-copy">
      <h2>Des réunions plus humaines avec MBotéRoom</h2>
      <p>Collaborez, partagez, créez, où que vous soyez.</p>
      <div className="home-feature-points">
        <span><Headphones aria-hidden="true"/><small>Audio HD</small></span>
        <span><Video aria-hidden="true"/><small>Vidéo HD</small></span>
        <span><MessageCircle aria-hidden="true"/><small>Messagerie</small></span>
        <span><MonitorUp aria-hidden="true"/><small>Partage d’écran</small></span>
      </div>
      <button type="button" onClick={onDiscover}>Découvrir toutes les fonctionnalités <ChevronRight/></button>
    </div>
    <span className="home-feature-slogan">La collaboration<br/>autrement !</span>
  </section>;
}

export function HomeFooter({ onPrivacy, onTerms, onHelp }: { onPrivacy: () => void; onTerms: () => void; onHelp: () => void }) {
  const language = getStoredLanguage();
  return <footer className="home-footer">
    <div className="home-footer-brand"><img src="/icons/mboteroom-symbol.png" alt=""/><strong>MBotéRoom</strong><span>© 2026 · Une solution <b>LoukaTech</b>.</span></div>
    <nav><button type="button" onClick={onPrivacy}>Confidentialité</button><button type="button" onClick={onTerms}>Conditions</button><button type="button" onClick={onHelp}>Aide</button></nav>
    <label><span aria-hidden="true">🌐</span><select aria-label="Langue" value={language} onChange={(event) => persistAppLanguage(event.target.value as AppLanguage)}><option value="fr">FR</option><option value="en">EN</option><option value="ln">LN</option><option value="ar">AR</option></select></label>
  </footer>;
}
