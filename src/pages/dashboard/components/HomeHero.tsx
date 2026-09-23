import { ChevronLeft, ChevronRight, MonitorUp, ShieldCheck, Video } from 'lucide-react';
import type { HomeSlide } from '../../../services/meetingService';

type Props = {
  firstName: string;
  slides: HomeSlide[];
  activeSlide: number;
  onSlideChange: (index: number) => void;
  onCreate: () => void;
  onJoin: () => void;
};

export default function HomeHero({ firstName, slides, activeSlide, onSlideChange, onCreate, onJoin }: Props) {
  const slide = slides[activeSlide] || null;
  const fallbackBody = 'Des réunions simples, sécurisées et productives pour vous, votre équipe et votre organisation.';
  const imageUrl = slide?.imageUrl || '/images/mboteroom-home-hero.svg';

  const move = (direction: 1 | -1) => {
    if (!slides.length) return;
    onSlideChange((activeSlide + direction + slides.length) % slides.length);
  };

  return (
    <section className="home-hero" aria-roledescription="carousel" aria-label="Présentation MBotéRoom">
      <div className="home-hero-copy">
        <span className="home-hero-mobile-greeting">Bonjour <b>{firstName}</b> ! <span aria-hidden="true">👋</span></span>
        <span className="home-hero-kicker">Bienvenue sur</span>
        <h1 aria-label="MBotéRoom"><span className="home-hero-brand"><img src="/icons/mboteroom-wordmark.png" alt="MBotéRoom" /></span></h1>
        <p>{slide?.body || fallbackBody}</p>
        <div className="home-hero-actions">
          <button type="button" onClick={onCreate}><Video size={19}/> Créer une réunion <ChevronRight size={18}/></button>
          <button type="button" className="secondary" onClick={onJoin}><MonitorUp size={19}/> Rejoindre</button>
        </div>
        <div className="home-hero-benefits" aria-label="Avantages MBotéRoom">
          <span><ShieldCheck size={18}/> Sécurisé</span>
          <span><span className="home-benefit-check">✓</span> Sans installation</span>
          <span><MonitorUp size={18}/> Sur tous vos appareils</span>
        </div>
      </div>

      <div className="home-hero-visual">
        <img src={imageUrl} alt="Personnes participant à une réunion vidéo MBotéRoom" loading="eager" decoding="async" />
        {slide?.title ? <span className="home-hero-slide-note">{slide.title}</span> : null}
        <span className="home-hero-slogan">Se réunir<br/>sans limites !</span>
      </div>

      {slides.length > 1 ? <div className="home-hero-slider-controls">
        <button type="button" aria-label="Slide précédent" onClick={() => move(-1)}><ChevronLeft size={18}/></button>
        <div role="tablist" aria-label="Slides de l’accueil">
          {slides.map((item, index) => <button key={item.slot} type="button" className={index === activeSlide ? 'is-active' : ''} aria-label={`Afficher le slide ${index + 1}`} aria-selected={index === activeSlide} onClick={() => onSlideChange(index)} />)}
        </div>
        <button type="button" aria-label="Slide suivant" onClick={() => move(1)}><ChevronRight size={18}/></button>
      </div> : null}
    </section>
  );
}
