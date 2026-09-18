import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { transcriptionService, type MeetingCaption, type TranscriptionStatus } from '../services/transcriptionService';

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

const cleanText = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 1200);

const selectMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  const values = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return values.find((value) => MediaRecorder.isTypeSupported(value)) || '';
};

const captionMatchesRoom = (caption: MeetingCaption, breakoutRoomId: string | null) =>
  breakoutRoomId ? caption.breakoutRoomId === breakoutRoomId : !caption.breakoutRoomId;

export function useMeetingCaptions({
  meetingId,
  enabled,
  audioStream,
  breakoutRoomId = null,
  language,
  onNotice,
}: {
  meetingId: number;
  enabled: boolean;
  audioStream: MediaStream | null;
  breakoutRoomId?: string | null;
  language?: string;
  onNotice?: (message: string) => void;
}) {
  const [captions, setCaptions] = useState<MeetingCaption[]>([]);
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [active, setActive] = useState(false);
  const [serverUnavailable, setServerUnavailable] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldRunRef = useRef(false);
  const webSpeechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const mimeType = useMemo(selectMimeType, []);

  const serverMode = Boolean(
    enabled
    && status?.configured
    && !serverUnavailable
    && mimeType
    && audioStream?.getAudioTracks().some((track) => track.readyState === 'live'),
  );
  const browserMode = Boolean(enabled && !serverMode && webSpeechSupported);
  const mode: 'server' | 'browser' | 'unavailable' = serverMode ? 'server' : browserMode ? 'browser' : 'unavailable';

  useEffect(() => {
    if (!meetingId) return undefined;
    let cancelled = false;
    void transcriptionService.getStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, model: '', chunkSeconds: 10 });
      });
    void transcriptionService.getCaptions(meetingId)
      .then((items) => {
        if (cancelled) return;
        setCaptions(items.filter((caption) => captionMatchesRoom(caption, breakoutRoomId)).slice(-4));
      })
      .catch(() => undefined);

    const onCaption = (caption: MeetingCaption) => {
      if (Number(caption.meetingId) !== meetingId || !caption.text || !captionMatchesRoom(caption, breakoutRoomId)) return;
      setCaptions((current) => [...current.filter((item) => item.id !== caption.id), caption].slice(-4));
    };
    socket.on('meeting:caption', onCaption);
    return () => {
      cancelled = true;
      socket.off('meeting:caption', onCaption);
    };
  }, [breakoutRoomId, meetingId]);

  useEffect(() => {
    setServerUnavailable(false);
  }, [meetingId, breakoutRoomId]);

  useEffect(() => {
    if (!serverMode || !meetingId || !audioStream) return undefined;
    const audioTracks = audioStream.getAudioTracks().filter((track) => track.readyState === 'live');
    if (!audioTracks.length) return undefined;

    let disposed = false;
    shouldRunRef.current = true;
    setActive(true);
    const source = new MediaStream(audioTracks);
    const chunkMs = Math.max(5, Math.min(30, Number(status?.chunkSeconds || 10))) * 1000;
    const languageCode = String(language || navigator.language || 'fr').split('-')[0].toLowerCase().slice(0, 8);

    const startSegment = () => {
      if (disposed || !shouldRunRef.current) return;
      const chunks: Blob[] = [];
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(source, { mimeType }) : new MediaRecorder(source);
      } catch {
        setServerUnavailable(true);
        setActive(false);
        onNotice?.('La capture audio pour les sous-titres serveur est indisponible. Passage au mode navigateur.');
        return;
      }
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!disposed) {
          setServerUnavailable(true);
          setActive(false);
          onNotice?.('La transcription serveur a été interrompue. Passage au mode navigateur.');
        }
      };
      recorder.onstop = () => {
        if (segmentTimerRef.current) {
          clearTimeout(segmentTimerRef.current);
          segmentTimerRef.current = null;
        }
        if (disposed || !shouldRunRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        if (blob.size < 256) {
          window.setTimeout(startSegment, 50);
          return;
        }
        void transcriptionService.transcribeAudio(meetingId, blob, {
          language: languageCode,
          breakoutRoomId,
        }).then(() => {
          if (!disposed && shouldRunRef.current) window.setTimeout(startSegment, 60);
        }).catch((cause) => {
          if (disposed) return;
          setServerUnavailable(true);
          setActive(false);
          onNotice?.((cause instanceof Error ? cause.message : 'Transcription serveur indisponible.') + ' Passage au mode navigateur.');
        });
      };
      recorder.start();
      segmentTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, chunkMs);
    };

    startSegment();
    return () => {
      disposed = true;
      shouldRunRef.current = false;
      setActive(false);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    };
  }, [audioStream, breakoutRoomId, language, meetingId, mimeType, onNotice, serverMode, status?.chunkSeconds]);

  useEffect(() => {
    if (!browserMode || !meetingId) return undefined;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return undefined;

    let disposed = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    shouldRunRef.current = true;
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
        const text = cleanText(result[0]?.transcript || '');
        if (!text) continue;
        void transcriptionService.publishBrowserCaption(meetingId, text, {
          language: recognition.lang,
          breakoutRoomId,
        }).catch(() => onNotice?.('Un sous-titre navigateur n’a pas pu être enregistré.'));
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
        } catch { /* browser is still closing the previous session */ }
      }, 350);
    };

    try {
      recognition.start();
      setActive(true);
    } catch {
      setActive(false);
      onNotice?.('Impossible de démarrer les sous-titres navigateur.');
    }

    return () => {
      disposed = true;
      shouldRunRef.current = false;
      if (restartTimer) clearTimeout(restartTimer);
      recognitionRef.current = null;
      try { recognition.abort(); } catch { /* already stopped */ }
      setActive(false);
    };
  }, [breakoutRoomId, browserMode, language, meetingId, onNotice]);

  useEffect(() => {
    if (enabled) return;
    shouldRunRef.current = false;
    setActive(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { recognition.abort(); } catch { /* already stopped */ }
    }
  }, [enabled]);

  return {
    active,
    captions,
    mode,
    supported: Boolean(status?.configured ? mimeType && audioStream?.getAudioTracks().length : webSpeechSupported),
    serverConfigured: Boolean(status?.configured),
    clearCaptions: () => setCaptions([]),
  };
}
