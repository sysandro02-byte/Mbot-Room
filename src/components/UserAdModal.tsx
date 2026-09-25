import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { adService, type UserAdCampaign } from '../services/adService';
import { socket } from '../lib/socket';
import './UserAdModal.css';

const activeMeetingPath = /^\/reunions\/(?!recentes(?:\/|$)|terminee(?:\/|$))[^/]+(?:\/luna)?$/;

export default function UserAdModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<UserAdCampaign | null>(null);
  const [closing, setClosing] = useState(false);
  const impressed = useRef(new Set<string>());

  const canDisplay = () => {
    const user = authService.getCurrentUser();
    if (!user || user.isGuest || user.role === 'guest') return false;
    if (location.pathname.startsWith('/admin')) return false;
    if (activeMeetingPath.test(location.pathname)) return false;
    return authService.isAuthenticated();
  };

  const refresh = async () => {
    if (!canDisplay()) {
      setCampaign(null);
      return;
    }
    try {
      const next = await adService.getActive();
      setCampaign(next);
    } catch {
      // Advertising must never block the application if the campaign API is unavailable.
    }
  };

  useEffect(() => {
    void refresh();
  }, [location.pathname]);

  useEffect(() => {
    const onCampaignUpdated = () => void refresh();
    const onAuthChanged = () => void refresh();
    if (authService.isAuthenticated() && !socket.connected) socket.connect();
    socket.on('ad:campaign-updated', onCampaignUpdated);
    window.addEventListener('mbote-room-auth-changed', onAuthChanged);
    return () => {
      socket.off('ad:campaign-updated', onCampaignUpdated);
      window.removeEventListener('mbote-room-auth-changed', onAuthChanged);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!campaign || impressed.current.has(campaign.id)) return;
    impressed.current.add(campaign.id);
    void adService.markImpression(campaign.id);
  }, [campaign?.id]);

  const dismiss = async () => {
    if (!campaign?.dismissible || closing) return;
    setClosing(true);
    try {
      await adService.dismiss(campaign.id);
    } catch {
      // A temporary metrics failure should not trap the user behind the modal.
    } finally {
      setCampaign(null);
      setClosing(false);
    }
  };

  const openAction = async () => {
    if (!campaign?.actionUrl) return;
    void adService.click(campaign.id).catch(() => undefined);
    const target = campaign.actionUrl;
    if (target.startsWith('/') && !target.startsWith('//')) {
      setCampaign(null);
      navigate(target);
      return;
    }
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'https:') {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
        setCampaign(null);
      }
    } catch {
      // Invalid action targets are ignored defensively.
    }
  };

  if (!campaign) return null;

  return (
    <div className="user-ad-backdrop" role="presentation">
      <section
        className="user-ad-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-ad-title"
        aria-describedby="user-ad-body"
      >
        {campaign.dismissible ? (
          <button
            className="user-ad-close"
            type="button"
            onClick={() => void dismiss()}
            disabled={closing}
            aria-label="Fermer la publicité"
          >
            <X size={19} />
          </button>
        ) : null}

        <div className="user-ad-label">Publicité</div>

        {campaign.imageUrl ? (
          <div className="user-ad-image-wrap">
            <img src={campaign.imageUrl} alt="" className="user-ad-image" />
          </div>
        ) : null}

        <div className="user-ad-content">
          <h2 id="user-ad-title">{campaign.title}</h2>
          <p id="user-ad-body">{campaign.body}</p>

          {campaign.actionLabel && campaign.actionUrl ? (
            <button className="user-ad-action" type="button" onClick={() => void openAction()}>
              <span>{campaign.actionLabel}</span>
              {!campaign.actionUrl.startsWith('/') ? <ExternalLink size={16} /> : null}
            </button>
          ) : null}

          {!campaign.dismissible ? (
            <small className="user-ad-required">Cette annonce a été configurée comme non fermable.</small>
          ) : null}
        </div>
      </section>
    </div>
  );
}
