import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';

export type MeetingCaption = {
  id: string;
  meetingId: number;
  userId: number;
  speaker: string;
  text: string;
  breakoutRoomId?: string | null;
  createdAt: string;
};

type SpeechAlternative = { transcript: string; confidence?: number };
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
type SpeechEvent = Event & { resultIndex: number; results: SpeechResultList };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const cleanCaption = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500);

export function useMeetingCaptions({
  meetingId,
  enabled,
  language,
  onNotice,
}: {
  meetingId: number;
  enabled: boolean;
  language?: string;
  onNotice?: (message: string) => void;
}) {
  const [captions, setCaptions] = useState<MeetingCaption[]>([]);
  const [active, setActive] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRunRef = useRef(false);
  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (!meetingId) return undefined;
    const onCaption = (caption: MeetingCaption) => {
      if (Number(caption.meetingId) !== meetingId || !caption.text) return;
      setCaptions((current) => [...current.filter((item) => item.id !== caption.id), caption].slice(-4));
    };
    socket.on('meeting:caption', onCaption);
    return () => {
      socket.off('meeting:caption', onCaption);
    };
  }, [meetingId]);

  useEffect(() => {
    shouldRunRef.current = enabled;
    if (!enabled || !meetingId) {
      setActive(false);
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try { recognition.stop(); } catch { /* already stopped */ }
      }
      return undefined;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setActive(false);
      onNotice?.('Les sous-titres automatiques ne sont pas disponibles dans ce navigateur.');
      return undefined;
    }

    let disposed = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language || navigator.language || 'fr-FR';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const text = cleanCaption(result[0]?.transcript || '');
        if (!text) continue;
        socket.emit('meeting:caption', { meetingId, text });
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        shouldRunRef.current = false;
        setActive(false);
        onNotice?.('Autorisez la reconnaissance vocale pour utiliser les sous-titres.');
      }
    };

    recognition.onend = () => {
      setActive(false);
      if (disposed || !shouldRunRef.current) return;
      restartTimer = setTimeout(() => {
        if (disposed || !shouldRunRef.current) return;
        try {
          recognition.start();
          setActive(true);
        } catch {
          // The browser may still be closing the previous recognition session.
        }
      }, 350);
    };

    try {
      recognition.start();
      setActive(true);
    } catch {
      setActive(false);
      onNotice?.('Impossible de démarrer les sous-titres automatiques.');
    }

    return () => {
      disposed = true;
      shouldRunRef.current = false;
      if (restartTimer) clearTimeout(restartTimer);
      recognitionRef.current = null;
      try { recognition.abort(); } catch { /* already stopped */ }
      setActive(false);
    };
  }, [enabled, language, meetingId, onNotice]);

  return {
    supported,
    active,
    captions,
    clearCaptions: () => setCaptions([]),
  };
}
