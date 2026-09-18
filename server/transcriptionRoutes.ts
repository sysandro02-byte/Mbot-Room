import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  hasMeetingAccess,
  normalizeText,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';

const protectedApi: express.RequestHandler[] = [requireDatabase, authenticateToken];

const allowedAudioTypes = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
]);

const mediaRoomName = (meetingId: number, breakoutRoomId: string | null) =>
  breakoutRoomId ? `meeting:${meetingId}:breakout:${breakoutRoomId}` : `meeting:${meetingId}:main`;

const transcriptionUrl = () =>
  String(process.env.GROQ_TRANSCRIPTION_URL || 'https://api.groq.com/openai/v1/audio/transcriptions').trim();

const transcriptionModel = () =>
  String(process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo').trim();

const resolveBreakout = async (meetingId: number, userId: number, role: string, requested: string) => {
  if (!requested) return null;
  const room = await query(
    'SELECT id FROM room_breakout_rooms WHERE id=$1 AND meeting_id=$2 AND is_open=true LIMIT 1',
    [requested, meetingId],
  );
  if (!room.rows[0]) throw new Error('BREAKOUT_NOT_FOUND');

  if (role !== 'admin') {
    const meeting = await query('SELECT host_id,co_host_id FROM room_meetings WHERE id=$1 LIMIT 1', [meetingId]);
    const moderator = Number(meeting.rows[0]?.host_id || 0) === userId
      || Number(meeting.rows[0]?.co_host_id || 0) === userId;
    if (!moderator) {
      const assignment = await query(
        'SELECT 1 FROM room_breakout_members WHERE breakout_room_id=$1 AND user_id=$2 LIMIT 1',
        [requested, userId],
      );
      if (!assignment.rows[0]) throw new Error('BREAKOUT_ACCESS_DENIED');
    }
  }
  return requested;
};

const transcribeWithGroq = async ({
  bytes,
  mimeType,
  language,
}: {
  bytes: Buffer;
  mimeType: string;
  language: string;
}) => {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return { configured: false as const, text: '', language: '' };

  const form = new FormData();
  form.append('model', transcriptionModel());
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  form.append('file', new Blob([bytes], { type: mimeType }), `mboteroom-caption.${mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('wav') ? 'wav' : 'webm'}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(10_000, Number(process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS || 30_000)));
  try {
    const result = await fetch(transcriptionUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    }).catch(() => null);

    if (!result?.ok) {
      const details = await result?.text().catch(() => '') || '';
      throw new Error(`GROQ_TRANSCRIPTION_FAILED:${result?.status || 0}:${details.slice(0, 200)}`);
    }

    const data = await result.json().catch(() => ({}));
    return {
      configured: true as const,
      text: normalizeText(data?.text).slice(0, 1200),
      language: String(data?.language || language || '').slice(0, 32),
    };
  } finally {
    clearTimeout(timer);
  }
};

export const registerTranscriptionRoutes = (app: express.Express, io: Server) => {
  app.get('/api/transcription/status', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      configured: Boolean(String(process.env.GROQ_API_KEY || '').trim()),
      model: transcriptionModel(),
      chunkSeconds: Math.max(5, Math.min(30, Number(process.env.CAPTION_CHUNK_SECONDS || 10))),
    });
  });

  app.get('/api/meetings/:meetingId/captions', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!meetingId || !(await hasMeetingAccess(meetingId, request.user!))) {
        return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
      }
      const rows = await query(
        `SELECT id,meeting_id,user_id,speaker,text,breakout_room_id,provider,language,created_at
           FROM room_captions
          WHERE meeting_id=$1
          ORDER BY created_at ASC
          LIMIT 2000`,
        [meetingId],
      );
      response.json(rows.rows.map((row) => ({
        id: row.id,
        meetingId: Number(row.meeting_id),
        userId: Number(row.user_id),
        speaker: row.speaker,
        text: row.text,
        breakoutRoomId: row.breakout_room_id || null,
        provider: row.provider,
        language: row.language || '',
        createdAt: new Date(row.created_at).toISOString(),
      })));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/meetings/:meetingId/captions/text', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!meetingId || !(await hasMeetingAccess(meetingId, request.user!))) {
        return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
      }
      const text = normalizeText(request.body?.text).slice(0, 1200);
      if (!text) return sendApiError(response, 400, 'CAPTION_EMPTY', 'Sous-titre vide.');

      const breakoutRoomId = await resolveBreakout(
        meetingId,
        request.user!.id,
        request.user!.role,
        String(request.body?.breakoutRoomId || '').trim(),
      );
      const caption = {
        id: createId(),
        meetingId,
        userId: request.user!.id,
        speaker: request.user!.name || request.user!.email,
        text,
        breakoutRoomId,
        provider: 'browser-speech',
        language: String(request.body?.language || '').trim().toLowerCase().slice(0, 16),
        createdAt: new Date().toISOString(),
      };
      await query(
        `INSERT INTO room_captions
          (id,meeting_id,user_id,speaker,text,breakout_room_id,provider,language,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          caption.id,
          caption.meetingId,
          caption.userId,
          caption.speaker,
          caption.text,
          caption.breakoutRoomId,
          caption.provider,
          caption.language,
          caption.createdAt,
        ],
      );
      io.to(mediaRoomName(meetingId, breakoutRoomId)).emit('meeting:caption', caption);
      response.status(201).json(caption);
    } catch (error) {
      if (error instanceof Error && error.message === 'BREAKOUT_NOT_FOUND') {
        return sendApiError(response, 404, 'BREAKOUT_NOT_FOUND', 'Sous-salle introuvable.');
      }
      if (error instanceof Error && error.message === 'BREAKOUT_ACCESS_DENIED') {
        return sendApiError(response, 403, 'BREAKOUT_ACCESS_DENIED', 'Accès à la sous-salle refusé.');
      }
      next(error);
    }
  });

  app.post(
    '/api/meetings/:meetingId/transcription/chunk',
    ...protectedApi,
    express.raw({ type: [...allowedAudioTypes], limit: '8mb' }),
    async (request: AuthedRequest, response, next) => {
      try {
        const meetingId = Number(request.params.meetingId);
        if (!meetingId || !(await hasMeetingAccess(meetingId, request.user!))) {
          return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
        }

        const mimeType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!allowedAudioTypes.has(mimeType)) {
          return sendApiError(response, 415, 'AUDIO_TYPE_UNSUPPORTED', 'Format audio non pris en charge.');
        }
        const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        if (bytes.length < 256) {
          return sendApiError(response, 400, 'AUDIO_CHUNK_EMPTY', 'Segment audio vide.');
        }

        const breakoutRoomId = await resolveBreakout(
          meetingId,
          request.user!.id,
          request.user!.role,
          String(request.query.breakoutRoomId || '').trim(),
        );
        const requestedLanguage = String(request.query.language || '').trim().toLowerCase().slice(0, 16);
        const transcript = await transcribeWithGroq({ bytes, mimeType, language: requestedLanguage });
        if (!transcript.configured) {
          return sendApiError(response, 503, 'TRANSCRIPTION_NOT_CONFIGURED', 'La transcription serveur n’est pas configurée.');
        }
        if (!transcript.text) {
          response.status(204).end();
          return;
        }

        const caption = {
          id: createId(),
          meetingId,
          userId: request.user!.id,
          speaker: request.user!.name || request.user!.email,
          text: transcript.text,
          breakoutRoomId,
          provider: 'groq-whisper',
          language: transcript.language || requestedLanguage,
          createdAt: new Date().toISOString(),
        };

        await query(
          `INSERT INTO room_captions
            (id,meeting_id,user_id,speaker,text,breakout_room_id,provider,language,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            caption.id,
            caption.meetingId,
            caption.userId,
            caption.speaker,
            caption.text,
            caption.breakoutRoomId,
            caption.provider,
            caption.language,
            caption.createdAt,
          ],
        );

        io.to(mediaRoomName(meetingId, breakoutRoomId)).emit('meeting:caption', caption);
        response.status(201).json(caption);
      } catch (error) {
        if (error instanceof Error && error.message === 'BREAKOUT_NOT_FOUND') {
          return sendApiError(response, 404, 'BREAKOUT_NOT_FOUND', 'Sous-salle introuvable.');
        }
        if (error instanceof Error && error.message === 'BREAKOUT_ACCESS_DENIED') {
          return sendApiError(response, 403, 'BREAKOUT_ACCESS_DENIED', 'Accès à la sous-salle refusé.');
        }
        next(error);
      }
    },
  );
};
