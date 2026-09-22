import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import type { AppMessageDetail, AppMessageTone } from '../lib/appMessage';
import './AppMessageModal.css';

const feedbackSelector = [
  '.auth-error',
  '.auth-success',
  '.admin-auth-error',
  '.admin-auth-message',
  '.admin-control-error',
  '.admin-control-message',
  '.admin-toast',
  '.real-dashboard-error',
  '.real-feature-error',
  '.real-join-error',
  '.utility-error',
  '.guest-global-error',
  '.waiting-error',
  '.video-error',
  '.admin-inline-error',
  '[data-global-message="true"]',
].join(',');

const toneFromElement = (element: Element): AppMessageTone => {
  const classes = element.className?.toString() || '';
  const role = element.getAttribute('role') || '';
  if (classes.includes('success') || classes.includes('message')) return 'success';
  if (classes.includes('warning')) return 'warning';
  if (classes.includes('error') || role === 'alert') return 'error';
  return 'info';
};

const titleForTone = (tone: AppMessageTone) => ({
  info: 'Information',
  success: 'Opération réussie',
  warning: 'Attention',
  error: 'Une action est nécessaire',
}[tone]);

export default function AppMessageModal() {
  const [message, setMessage] = useState<AppMessageDetail | null>(null);
  const lastMessageRef = useRef('');

  useEffect(() => {
    const openMessage = (detail: AppMessageDetail) => {
      const text = String(detail.message || '').replace(/\s+/g, ' ').trim();
      if (!text || text === lastMessageRef.current) return;
      lastMessageRef.current = text;
      setMessage({
        message: text,
        tone: detail.tone || 'info',
        title: detail.title || titleForTone(detail.tone || 'info'),
      });
    };

    const onMessage = (event: Event) => {
      const detail = (event as CustomEvent<AppMessageDetail>).detail;
      if (detail) openMessage(detail);
    };

    const capture = (root: ParentNode) => {
      const nodes: Element[] = [];
      if (root instanceof Element && root.matches(feedbackSelector)) nodes.push(root);
      root.querySelectorAll?.(feedbackSelector).forEach((node) => nodes.push(node));
      nodes.forEach((node) => {
        if (node.closest('[data-app-message-modal="true"]')) return;
        const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!text || text.toLowerCase().includes('chargement')) return;
        node.setAttribute('data-app-message-captured', 'true');
        const tone = toneFromElement(node);
        openMessage({ message: text, tone, title: titleForTone(tone) });
      });
    };

    window.addEventListener('mboteroom:message', onMessage);
    if (document.body) capture(document.body);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData' && mutation.target.parentElement) capture(mutation.target.parentElement);
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) capture(node);
        });
      });
    });
    if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });

    return () => {
      window.removeEventListener('mboteroom:message', onMessage);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMessage(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [message]);

  if (!message) return null;
  const tone = message.tone || 'info';
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : tone === 'error' ? XCircle : Info;

  return (
    <div className="app-message-backdrop" data-app-message-modal="true" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setMessage(null);
    }}>
      <section className={`app-message-modal is-${tone}`} role="dialog" aria-modal="true" aria-labelledby="app-message-title" aria-describedby="app-message-text">
        <button className="app-message-close" type="button" aria-label="Fermer" onClick={() => setMessage(null)}><X size={19}/></button>
        <span className="app-message-icon"><Icon size={29}/></span>
        <div className="app-message-copy">
          <span className="app-message-kicker">MBotéRoom</span>
          <h2 id="app-message-title">{message.title || titleForTone(tone)}</h2>
          <p id="app-message-text">{message.message}</p>
        </div>
        <button className="app-message-confirm" type="button" onClick={() => setMessage(null)} autoFocus>Compris</button>
      </section>
    </div>
  );
}
