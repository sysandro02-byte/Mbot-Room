import type express from 'express';
import { getRawSessionTokenFromRequest } from './core.js';

export type RecordingStorageSignerPayload =
  | { action: 'upload'; meetingId: number; mimeType: string; sizeBytes: number }
  | { action: 'download'; recordingId: string; download?: boolean };

export type RecordingUploadTicket = {
  bucket: string;
  path: string;
  token: string;
  signedUrl?: string;
  tusEndpoint: string;
  expiresInSeconds: number;
};

export type RecordingDownloadTicket = {
  bucket: string;
  path: string;
  url: string;
  expiresInSeconds: number;
};

const signerUrl = () => String(process.env.MBOTE_SUPABASE_RECORDING_SIGNER_URL || '').trim();
export const recordingStorageBucket = () => String(process.env.MBOTE_SUPABASE_RECORDING_BUCKET || 'mboteroom-recordings').trim();

export const isSupabaseRecordingStorageReady = () => Boolean(signerUrl() && recordingStorageBucket());

export const requestSupabaseRecordingSigner = async <T extends RecordingUploadTicket | RecordingDownloadTicket>(
  request: express.Request,
  payload: RecordingStorageSignerPayload,
): Promise<T> => {
  const url = signerUrl();
  if (!url) throw new Error('Le stockage Supabase des enregistrements n’est pas configuré.');

  const token = getRawSessionTokenFromRequest(request);
  if (!token) throw new Error('Session MBotéRoom introuvable.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-MBote-Room-Session-Mode': 'bearer',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.error || 'Supabase Storage est momentanément indisponible.'));
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const toSupabaseRecordingMarker = (bucket: string, path: string) =>
  `supabase://${bucket}/${path.replace(/^\/+/, '')}`;

export const parseSupabaseRecordingMarker = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw.startsWith('supabase://')) return null;
  const rest = raw.slice('supabase://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  return bucket && path ? { bucket, path } : null;
};
