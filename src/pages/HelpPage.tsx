import { ArrowLeft, BookOpen, CalendarDays, Captions, CirclePlay, LockKeyhole, MessageCircle, ShieldCheck, UsersRound, Video } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import './UtilityPages.css';

const topics = [
  { icon: Video, title: 'Créer ou rejoindre une réunion', text: 'Créez une réunion depuis Réunions, copiez son lien ou rejoignez-la avec son ID/lien et, si nécessaire, son mot de passe.', to: '/app/meetings' },
  { icon: UsersRound, title: 'Salle d’attente et participants', text: 'L’hôte peut admettre/refuser les demandes, couper des micros, retirer ou bannir un participant et utiliser les sous-salles.', to: '/app/meetings' },
  { icon: Captions, title: 'Sous-titres et Luna IA', text: 'Activez Sous-titres dans la barre de réunion. Lorsque Groq est configuré, la transcription serveur alimente aussi les résumés Luna.', to: '/app/meetings' },
  { icon: CirclePlay, title: 'Enregistrements', text: 'L’enregistrement serveur utilise LiveKit Egress lorsqu’il est configuré. Sinon MBotéRoom conserve le mode local dans le navigateur.', to: '/app/recordings' },
  { icon: CalendarDays, title: 'Calendrier', text: 'Ajoutez vos événements personnels et retrouvez-les dans le calendrier MBotéRoom.', to: '/app/calendar' },
  { icon: MessageCircle, title: 'Messages et sondages', text: 'Les messages et sondages de réunion sont persistés sur le serveur et restent consultables selon vos droits d’accès.', to: '/app/messages' },
];

export default function HelpPage() {
  const navigate = useNavigate();
  return <main className="utility-page">
    <header className="utility-page-head">
      <button type="button" onClick={() => navigate('/app')}><ArrowLeft size={18}/> Accueil</button>
      <div><h1>Centre d’aide MBotéRoom</h1><p>Guides rapides pour tester et utiliser les fonctions principales.</p></div>
    </header>

    <section className="utility-card utility-help-intro">
      <ShieldCheck size={30}/>
      <div>
        <h2>Avant une réunion</h2>
        <p>Autorisez la caméra et le microphone dans le navigateur. Pour un test complet, utilisez idéalement deux appareils ou deux navigateurs afin de vérifier l’audio/vidéo entre participants.</p>
      </div>
    </section>

    <div className="utility-help-grid">
      {topics.map(({ icon: Icon, title, text, to }) => <Link className="utility-help-topic" to={to} key={title}>
        <Icon size={22}/>
        <strong>{title}</strong>
        <p>{text}</p>
      </Link>)}
    </div>

    <section className="utility-card utility-help-security">
      <LockKeyhole size={23}/>
      <div><h2>Sécurité</h2><p>Les sessions web utilisent un cookie HttpOnly. Les réunions peuvent utiliser mot de passe, salle d’attente, verrouillage et contrôle des participants.</p></div>
      <Link to="/securite"><BookOpen size={16}/> Voir la rubrique sécurité</Link>
    </section>
  </main>;
}
