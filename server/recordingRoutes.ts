import crypto from 'node:crypto';
import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  hasMeetingAccess,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';

type EgressInfo = Record<string, any>;

const protectedApi: express.RequestHandler[] = [requireDatabase, authenticateToken];

const liveKitConfig = () => ({
  url: String(process.env.LIVEKIT_URL || '').trim().replace(/\/+$/, ''),
  apiKey: String(process.env.LIVEKIT_API_KEY || '').trim(),
  apiSecret: String(process.env.LIVEKIT_API_SECRET || '').trim(),
});

const egressConfig = () => ({
  enabled: String(process.env.LIVEKIT_EGRESS_ENABLED || '').trim().toLowerCase() === 'true',
  useServerDefaultStorage: String(process.env.LIVEKIT_EGRESS_USE_SERVER_DEFAULT_STORAGE || '').trim().toLowerCase() === 'true',
  bucket: String(process.env.LIVEKIT_EGRESS_S3_BUCKET || '').trim(),
  region: String(process.env.LIVEKIT_EGRESS_S3_REGION || '').trim(),
  endpoint: String(process.env.LIVEKIT_EGRESS_S3_ENDPOINT || '').trim(),
  accessKey: String(process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY || '').trim(),
  secretKey: String(process.env.LIVEKIT_EGRESS_S3_SECRET_KEY || '').trim(),
  forcePathStyle: String(process.env.LIVEKIT_EGRESS_S3_FORCE_PATH_STYLE || '').trim().toLowerCase() === 'true',
});

const toHttpUrl = (value: string) => value
  .replace(/^wss:/i, 'https:')
  .replace(/^ws:/i, 'http:')
  .replace(/\/+$/, '');

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const signRoomRecordToken = () => {
  const config = liveKitConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({
    iss: config.apiKey,
    sub: 'mboteroom-egress',
    nbf: now - 5,
    exp: now + 300,
    video: { roomRecord: true },
  }));
  const signature = crypto.createHmac('sha256', config.apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const isLiveKitReady = () => {
  const config = liveKitConfig();
  return Boolean(config.url && config.apiKey && config.apiSecret);
};

const isStorageReady = () => {
  const config = egressConfig();
  if (config.useServerDefaultStorage) return true;
  return Boolean(config.bucket && config.accessKey && config.secretKey && (config.endpoint || config.region));
};

export const isServerRecordingReady = () => isLiveKitReady() && egressConfig().enabled && isStorageReady();

const buildStorage = () => {
  const config = egressConfig();
  if (config.useServerDefaultStorage) return undefined;
  return {
    s3: {
      access_key: config.accessKey,
      secret: config.secretKey,
      region: config.region,
      endpoint: config.endpoint,
      bucket: config.bucket,
      force_path_style: config.forcePathStyle,
      content_disposition: 'attachment',
    },
  };
};

const liveKitRequest = async (method: 'StartEgress' | 'ListEgress' | 'StopEgress', body: Record<string, unknown>) => {
  if (!isLiveKitReady()) throw new Error('LiveKit n’est pas configuré.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${toHttpUrl(liveKitConfig().url)}/twirp/livekit.Egress/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signRoomRecordToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = String(data?.msg || data?.message || data?.error || `LiveKit Egress HTTP ${response.status}`);
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeEgressStatus = (value: unknown) => {
  const numeric: Record<number, string> = {
    0: 'starting',
    1: 'active',
    2: 'ending',
    3: 'complete',
    4: 'failed',
    5: 'aborted',
    6: 'limit_reached',
  };
  if (typeof value === 'number') return numeric[value] || 'unknown';
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) return numeric[Number(raw)] || 'unknown';
  return raw.replace(/^EGRESS_/i, '').toLowerCase() || 'unknown';
};

const nanosToDate = (value: unknown) => {
  if (value === undefined || value === null || value === '' || value === '0' || value === 0) return null;
  try {
    return new Date(Number(BigInt(String(value)) / 1_000_000n)).toISOString();
  } catch {
    return null;
  }
};

const nanosToSeconds = (value: unknown) => {
  if (value === undefined || value === null || value === '') return 0;
  try {
    return Number(BigInt(String(value)) / 1_000_000_000n);
  } catch {
    return 0;
  }
};

const firstFileInfo = (info: EgressInfo) => {
  const results = info.file_results || info.fileResults || [];
  return Array.isArray(results) ? results[0] || null : null;
};

const getEgressId = (info: EgressInfo) => String(info.egress_id || info.egressId || '').trim();

const getEgressStatus = (info: EgressInfo) => normalizeEgressStatus(info.status);

const buildRecordingPatch = (info: EgressInfo) => {
  const file = firstFileInfo(info);
  const storageUrl = String(file?.location || '').trim();
  const sizeBytes = Math.max(0, Number(file?.size || 0));
  const durationSeconds = Math.max(0, nanosToSeconds(file?.duration));
  const status = getEgressStatus(info);
  const startedAt = nanosToDate(info.started_at ?? info.startedAt);
  const endedAt = nanosToDate(info.ended_at ?? info.endedAt);
  return {
    storageUrl,
    sizeBytes,
    durationSeconds,
    status,
    startedAt,
    endedAt,
    metadata: {
      roomName: String(info.room_name || info.roomName || ''),
      details: String(info.details || ''),
      error: String(info.error || ''),
      fileName: String(file?.filename || ''),
      manifestLocation: String(info.manifest_location || info.manifestLocation || ''),
    },
  };
};

const canModerate = async (meetingId: number, userId: number, role: string) => {
  if (role === 'admin') return true;
  const result = await query('SELECT host_id,co_host_id FROM room_meetings WHERE id=$1 LIMIT 1', [meetingId]);
  const row = result.rows[0];
  return Boolean(row && (Number(row.host_id) === userId || Number(row.co_host_id || 0) === userId));
};

const roomNameForRecording = async (meetingId: number, breakoutRoomId = '') => {
  if (!breakoutRoomId) return `mboteroom-${meetingId}`;
  const room = await query('SELECT id FROM room_breakout_rooms WHERE id=$1 AND meeting_id=$2 LIMIT 1', [breakoutRoomId, meetingId]);
  if (!room.rows[0]) throw new Error('Sous-salle introuvable.');
  return `mboteroom-${meetingId}-breakout-${breakoutRoomId}`;
};

const persistEgressInfo = async (recordingId: string, info: EgressInfo) => {
  const patch = buildRecordingPatch(info);
  const result = await query(
    `UPDATE room_recordings
       SET storage_url=CASE WHEN $2<>'' THEN $2 ELSE storage_url END,
           size_bytes=$3,
           duration_seconds=$4,
           status=$5,
           started_at=COALESCE($6::timestamptz,started_at),
           ended_at=COALESCE($7::timestamptz,ended_at),
           metadata=COALESCE(metadata,'{}'::jsonb) || $8::jsonb
     WHERE id=$1
     RETURNING *`,
    [
      recordingId,
      patch.storageUrl,
      patch.sizeBytes,
      patch.durationSeconds,
      patch.status,
      patch.startedAt,
      patch.endedAt,
      JSON.stringify(patch.metadata),
    ],
  );
  return result.rows[0] || null;
};

const refreshRecording = async (row: any) => {
  if (row.provider !== 'livekit' || !row.provider_recording_id) return row;
  const response = await liveKitRequest('ListEgress', { egress_id: row.provider_recording_id });
  const items = response.items || response.egress || [];
  const info = Array.isArray(items) ? items[0] : null;
  if (!info) return row;
  return persistEgressInfo(String(row.id), info);
};

export const registerRecordingRoutes = (app: express.Express, io: Server) => {
  app.get('/api/recording/status', (_request, response) => {
    const storage = egressConfig();
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      ready: isServerRecordingReady(),
      livekitReady: isLiveKitReady(),
      egressEnabled: storage.enabled,
      storageReady: isStorageReady(),
      storageMode: storage.useServerDefaultStorage ? 'server-default' : storage.bucket ? 's3' : 'none',
    });
  });

  app.post('/api/meetings/:meetingId/recordings/start', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!meetingId || !(await canModerate(meetingId, request.user!.id, request.user!.role))) {
        return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut démarrer un enregistrement serveur.');
      }
      if (!isServerRecordingReady()) {
        return sendApiError(response, 503, 'SERVER_RECORDING_NOT_CONFIGURED', 'L’enregistrement serveur LiveKit Egress n’est pas encore configuré.');
      }

      const active = await query(
        `SELECT * FROM room_recordings
          WHERE meeting_id=$1 AND provider='livekit' AND status IN ('starting','active','ending')
          ORDER BY created_at DESC LIMIT 1`,
        [meetingId],
      );
      if (active.rows[0]) {
        return sendApiError(response, 409, 'RECORDING_ALREADY_ACTIVE', 'Un enregistrement serveur est déjà en cours.', {
          recordingId: active.rows[0].id,
        });
      }

      const breakoutRoomId = String(request.body?.breakoutRoomId || '').trim();
      const roomName = await roomNameForRecording(meetingId, breakoutRoomId);
      const layout = ['grid', 'speaker', 'single-speaker'].includes(String(request.body?.layout || ''))
        ? String(request.body.layout)
        : 'grid';
      const filepath = `mboteroom/${meetingId}/${breakoutRoomId ? `breakout-${breakoutRoomId}/` : ''}{time}.mp4`;
      const storage = buildStorage();

      const startPayload: Record<string, unknown> = {
        room_name: roomName,
        template: { layout },
        preset: 'H264_720P_30',
        outputs: [{ file: { file_type: 'MP4', filepath } }],
        ...(storage ? { storage } : {}),
      };

      const info = await liveKitRequest('StartEgress', startPayload);
      const providerRecordingId = getEgressId(info);
      if (!providerRecordingId) throw new Error('LiveKit n’a pas retourné d’identifiant Egress.');

      const patch = buildRecordingPatch(info);
      const recordingId = createId();
      const result = await query(
        `INSERT INTO room_recordings
          (id,meeting_id,created_by,storage_url,mime_type,size_bytes,duration_seconds,provider,provider_recording_id,status,started_at,ended_at,metadata)
         VALUES ($1,$2,$3,$4,'video/mp4',$5,$6,'livekit',$7,$8,$9,$10,$11::jsonb)
         RETURNING *`,
        [
          recordingId,
          meetingId,
          request.user!.id,
          patch.storageUrl,
          patch.sizeBytes,
          patch.durationSeconds,
          providerRecordingId,
          patch.status,
          patch.startedAt,
          patch.endedAt,
          JSON.stringify({ ...patch.metadata, layout, breakoutRoomId, filepath }),
        ],
      );
      io.to(`meeting:${meetingId}`).emit('meeting:recording-status', { meetingId, recording: result.rows[0] });
      response.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/meetings/:meetingId/recordings/:recordingId/status', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!(await hasMeetingAccess(meetingId, request.user!))) {
        return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
      }
      const result = await query('SELECT * FROM room_recordings WHERE id=$1 AND meeting_id=$2 LIMIT 1', [request.params.recordingId, meetingId]);
      if (!result.rows[0]) return sendApiError(response, 404, 'RECORDING_NOT_FOUND', 'Enregistrement introuvable.');
      const recording = await refreshRecording(result.rows[0]);
      response.json(recording);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/meetings/:meetingId/recordings/:recordingId/stop', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!(await canModerate(meetingId, request.user!.id, request.user!.role))) {
        return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut arrêter l’enregistrement serveur.');
      }
      const result = await query('SELECT * FROM room_recordings WHERE id=$1 AND meeting_id=$2 LIMIT 1', [request.params.recordingId, meetingId]);
      const row = result.rows[0];
      if (!row) return sendApiError(response, 404, 'RECORDING_NOT_FOUND', 'Enregistrement introuvable.');
      if (row.provider !== 'livekit' || !row.provider_recording_id) {
        return sendApiError(response, 409, 'RECORDING_NOT_LIVEKIT', 'Cet enregistrement n’est pas géré par LiveKit Egress.');
      }

      const info = await liveKitRequest('StopEgress', { egress_id: row.provider_recording_id });
      const recording = await persistEgressInfo(String(row.id), info);
      io.to(`meeting:${meetingId}`).emit('meeting:recording-status', { meetingId, recording });
      response.json(recording);
    } catch (error) {
      next(error);
    }
  });
};
