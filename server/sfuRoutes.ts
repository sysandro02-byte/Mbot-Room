import crypto from 'node:crypto';
import type express from 'express';
import { isServerRecordingReady } from './recordingRoutes.js';
import { isPlatformFeatureEnabled } from './platformSettings.js';
import { isSupabaseRecordingStorageReady } from './supabaseRecordingStorage.js';
import {
  AuthedRequest,
  authenticateToken,
  canModerateMeeting,
  canUseAccountFeature,
  hasMeetingAccess,
  mapMeeting,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const signLiveKitToken = ({
  apiKey,
  apiSecret,
  identity,
  room,
  userId,
  displayName,
  avatar,
  ttlSeconds,
  canPublishSources,
}: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  userId: number;
  displayName: string;
  avatar: string;
  ttlSeconds: number;
  canPublishSources: string[];
}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: apiKey,
    sub: identity,
    nbf: now - 5,
    exp: now + ttlSeconds,
    name: displayName,
    metadata: JSON.stringify({ mboteRoomUserId: userId, displayName, avatar }),
    video: {
      room,
      roomJoin: true,
      canPublish: canPublishSources.length > 0,
      canPublishSources,
      canSubscribe: true,
      canPublishData: true,
    },
  }));
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const configuredMode = () => {
  const mode = String(process.env.MEDIA_TRANSPORT || 'auto').trim().toLowerCase();
  return mode === 'livekit' || mode === 'mesh' ? mode : 'auto';
};

const liveKitConfig = () => ({
  serverUrl: String(process.env.LIVEKIT_URL || '').trim().replace(/\/+$/, ''),
  apiKey: String(process.env.LIVEKIT_API_KEY || '').trim(),
  apiSecret: String(process.env.LIVEKIT_API_SECRET || '').trim(),
});

export const registerSfuRoutes = (app: express.Express) => {
  app.get('/api/media/status', (_request, response) => {
    const mode = configuredMode();
    const config = liveKitConfig();
    const livekitReady = Boolean(config.serverUrl && config.apiKey && config.apiSecret);
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      configuredMode: mode,
      preferredMode: mode === 'mesh' ? 'mesh' : livekitReady ? 'livekit' : 'mesh',
      browserTransport: 'mesh',
      livekitReady,
      turnConfigured: Boolean(
        (String(process.env.TURN_URLS || '').trim() && String(process.env.TURN_SHARED_SECRET || '').trim())
        || (String(process.env.MBOTEROOM_TURN_URL || '').trim()
          && String(process.env.MBOTEROOM_TURN_USERNAME || '').trim()
          && String(process.env.MBOTEROOM_TURN_CREDENTIAL || '').trim())
      ),
      serverRecordingReady: isServerRecordingReady(),
      recordingStorageReady: isSupabaseRecordingStorageReady(),
    });
  });

  app.get('/api/meetings/:meetingId/media-session', requireDatabase, authenticateToken, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      const user = request.user!;
      if (!meetingId || !(await hasMeetingAccess(meetingId, user))) {
        sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès à la réunion refusé.');
        return;
      }

      const meetingResult = await query('SELECT * FROM room_meetings WHERE id=$1 LIMIT 1', [meetingId]);
      if (!meetingResult.rows[0]) {
        sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
        return;
      }
      const meeting = mapMeeting(meetingResult.rows[0]);
      if (meeting.status === 'ended' || meeting.status === 'cancelled') {
        sendApiError(response, 410, 'MEETING_ENDED', 'Cette réunion est terminée ou annulée.');
        return;
      }
      const moderator = canModerateMeeting(meeting, user);
      const guestScreenAllowed = moderator || !user.isGuest || await isPlatformFeatureEnabled('guestScreenShareEnabled');
      const accountScreenAllowed = canUseAccountFeature(user, 'screenShare');
      const canPublishSources = moderator
        ? [
            'camera',
            'microphone',
            ...(guestScreenAllowed && accountScreenAllowed ? ['screen_share', 'screen_share_audio'] : []),
          ]
        : [
            ...(meeting.settings.participantVideo !== false ? ['camera'] : []),
            ...(meeting.settings.participantAudio !== false ? ['microphone'] : []),
            ...(accountScreenAllowed && guestScreenAllowed && meeting.settings.screenShare !== false ? ['screen_share', 'screen_share_audio'] : []),
          ];

      const mode = configuredMode();
      const config = liveKitConfig();
      const livekitReady = Boolean(config.serverUrl && config.apiKey && config.apiSecret);
      const acceptedCountResult = await query(
        "SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'",
        [meetingId],
      );
      const acceptedCount = Number(acceptedCountResult.rows[0]?.count || 0);
      const requiresSfu = acceptedCount > 12;
      if (requiresSfu && (mode === 'mesh' || !livekitReady)) {
        sendApiError(
          response,
          503,
          'MEDIA_SFU_REQUIRED',
          'Cette réunion compte trop de participants pour le mode direct. Le serveur média doit être disponible pour préserver la qualité audio et vidéo.',
          { acceptedCount, threshold: 12 },
        );
        return;
      }

      if (mode === 'mesh' || (mode === 'auto' && !livekitReady)) {
        response.setHeader('Cache-Control', 'no-store');
        response.json({ mode: 'mesh', reason: livekitReady ? 'mesh_forced' : 'sfu_not_configured' });
        return;
      }

      if (!livekitReady) {
        sendApiError(response, 503, 'MEDIA_SFU_NOT_CONFIGURED', 'Le transport SFU n’est pas encore configuré.');
        return;
      }

      const breakoutRoomId = String(request.query.breakoutRoomId || '').trim();
      let roomName = `mboteroom-${meetingId}`;

      if (breakoutRoomId) {
        const roomResult = await query(
          'SELECT id FROM room_breakout_rooms WHERE id=$1 AND meeting_id=$2 LIMIT 1',
          [breakoutRoomId, meetingId],
        );
        if (!roomResult.rows[0]) {
          sendApiError(response, 404, 'BREAKOUT_NOT_FOUND', 'Sous-salle introuvable.');
          return;
        }

        if (!moderator) {
          const assignment = await query(
            'SELECT 1 FROM room_breakout_members WHERE breakout_room_id=$1 AND user_id=$2 LIMIT 1',
            [breakoutRoomId, user.id],
          );
          if (!assignment.rows[0]) {
            sendApiError(response, 403, 'BREAKOUT_ACCESS_DENIED', 'Vous n’êtes pas affecté à cette sous-salle.');
            return;
          }
        }

        roomName = `mboteroom-${meetingId}-breakout-${breakoutRoomId}`;
      }

      const ttlSeconds = Math.max(300, Math.min(3600, Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 900)));
      const identity = `mboteroom-user-${user.id}`;
      const participantToken = signLiveKitToken({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        identity,
        room: roomName,
        userId: user.id,
        displayName: user.name || user.username || 'Participant',
        avatar: user.avatar || '',
        ttlSeconds,
        canPublishSources,
      });

      response.setHeader('Cache-Control', 'no-store');
      response.json({
        mode: 'livekit',
        serverUrl: config.serverUrl,
        participantToken,
        roomName,
        identity,
        permissions: { canPublishSources },
        expiresAt: new Date((Math.floor(Date.now() / 1000) + ttlSeconds) * 1000).toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });
};
