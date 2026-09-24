import type { Server, Socket } from 'socket.io';
import {
  PublicUser,
  canModerateMeeting,
  canUseAccountFeature,
  getRawSessionToken,
  getUserByRawToken,
  hasMeetingAccess,
  query,
  touchSessionActivity,
} from './core.js';
import { getMeetingById, insertChatMessage } from './meetingRoutes.js';
import { isPlatformFeatureEnabled } from './platformSettings.js';

type MediaState = { audio: boolean; video: boolean; screen: boolean };
type LiveParticipant = {
  socketId: string;
  userId: number;
  name: string;
  avatar: string;
  role: string;
  media: MediaState;
  breakoutRoomId: string | null;
};

type Ack = (payload: unknown) => void;

const meetings = new Map<number, Map<string, LiveParticipant>>();
const raisedHands = new Map<number, Map<number, { userId:number; name:string; raisedAt:string }>>();
const cleanMedia = (value: any): MediaState => ({ audio: Boolean(value?.audio), video: Boolean(value?.video), screen: Boolean(value?.screen) });
const fail = (code: string, error: string) => ({ ok: false, code, error });

const warnPersistenceFailure = (operation: string, error: unknown) => {
  console.warn('[MBotéRoom realtime] persistence failed', {
    operation,
    reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
  });
};

const participantForSocket = (meetingId: number, socketId: string) => meetings.get(meetingId)?.get(socketId) || null;
const mediaRoomName = (meetingId: number, breakoutRoomId: string | null) =>
  breakoutRoomId ? `meeting:${meetingId}:breakout:${breakoutRoomId}` : `meeting:${meetingId}:main`;

const rebalanceTemporaryHost = async (io: Server, meetingId: number) => {
  const roomParticipants = meetings.get(meetingId);
  const meeting = await getMeetingById(meetingId);
  if (!meeting || !roomParticipants) return;

  const liveUserIds = new Set([...roomParticipants.values()].map((item) => item.userId));
  const originalHostOnline = liveUserIds.has(meeting.host_id);
  const previousTemporaryHostId = Number(meeting.temporary_host_id || 0) || null;

  if (originalHostOnline) {
    if (previousTemporaryHostId) {
      await query('UPDATE room_meetings SET temporary_host_id=NULL,updated_at=now() WHERE id=$1', [meetingId]);
      await query(
        `UPDATE room_meeting_members
            SET role=CASE WHEN user_id=$2 THEN 'host'
                          WHEN user_id=$3 THEN 'cohost'
                          ELSE role END,
                updated_at=now()
          WHERE meeting_id=$1 AND user_id IN ($2,$3)`,
        [meetingId, meeting.host_id, previousTemporaryHostId],
      ).catch((error) => warnPersistenceFailure('restore-original-host-role', error));
      if (previousTemporaryHostId !== meeting.co_host_id) {
        await query(
          `UPDATE room_meeting_members SET role='participant',updated_at=now()
            WHERE meeting_id=$1 AND user_id=$2 AND user_id<>$3`,
          [meetingId, previousTemporaryHostId, Number(meeting.co_host_id || 0)],
        ).catch((error) => warnPersistenceFailure('demote-temporary-host', error));
      }
      io.in(`user:${previousTemporaryHostId}`).socketsLeave(`meeting:${meetingId}:moderators`);
      if (meeting.co_host_id === previousTemporaryHostId) {
        io.in(`user:${previousTemporaryHostId}`).socketsJoin(`meeting:${meetingId}:moderators`);
      }
      io.in(`user:${meeting.host_id}`).socketsJoin(`meeting:${meetingId}:moderators`);
      io.to(`meeting:${meetingId}`).emit('meeting:host-changed', {
        meetingId,
        hostId: meeting.host_id,
        previousHostId: previousTemporaryHostId,
        temporary: false,
      });
    }
    return;
  }

  if (previousTemporaryHostId && liveUserIds.has(previousTemporaryHostId)) return;
  if (!meeting.is_active && meeting.status !== 'live') return;

  const coHostId = Number(meeting.co_host_id || 0);
  let candidateId = coHostId && liveUserIds.has(coHostId) ? coHostId : 0;

  if (!candidateId) {
    const candidates = [...roomParticipants.values()]
      .filter((item) => item.userId !== meeting.host_id)
      .sort((a, b) => (a.role === 'cohost' ? -1 : 0) - (b.role === 'cohost' ? -1 : 0));
    for (const candidate of candidates) {
      const userResult = await query('SELECT is_guest FROM room_users WHERE id=$1 LIMIT 1', [candidate.userId]);
      if (userResult.rows[0] && userResult.rows[0].is_guest !== true) {
        candidateId = candidate.userId;
        break;
      }
    }
  }

  if (!candidateId) return;

  if (previousTemporaryHostId && previousTemporaryHostId !== candidateId && previousTemporaryHostId !== coHostId) {
    await query(
      `UPDATE room_meeting_members SET role='participant',updated_at=now()
        WHERE meeting_id=$1 AND user_id=$2`,
      [meetingId, previousTemporaryHostId],
    ).catch((error) => warnPersistenceFailure('replace-temporary-host', error));
    io.in(`user:${previousTemporaryHostId}`).socketsLeave(`meeting:${meetingId}:moderators`);
  }

  await query('UPDATE room_meetings SET temporary_host_id=$2,updated_at=now() WHERE id=$1', [meetingId, candidateId]);
  await query(
    `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at)
     VALUES ($1,$2,'host','accepted',now())
     ON CONFLICT (meeting_id,user_id)
     DO UPDATE SET role='host',status='accepted',left_at=NULL,updated_at=now()`,
    [meetingId, candidateId],
  );
  io.in(`user:${candidateId}`).socketsJoin(`meeting:${meetingId}:moderators`);
  io.to(`meeting:${meetingId}`).emit('meeting:host-changed', {
    meetingId,
    hostId: candidateId,
    originalHostId: meeting.host_id,
    previousHostId: previousTemporaryHostId,
    temporary: true,
  });
};

const removeSocketFromMeeting = async (io: Server, socket: Socket) => {
  const meetingId = Number(socket.data.meetingId || 0);
  if (!meetingId) return;
  const participants = meetings.get(meetingId);
  const participant = participants?.get(socket.id);
  participants?.delete(socket.id);
  if (participant) {
    io.to(mediaRoomName(meetingId, participant.breakoutRoomId)).emit('meeting:participant-left', { socketId: socket.id, userId: participant.userId });
    const otherDeviceOnline = [...(participants?.values() || [])].some((item) => item.userId === participant.userId);
    if (!otherDeviceOnline) {
      await query(`UPDATE room_meeting_members SET left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meetingId, participant.userId])
        .catch((error) => warnPersistenceFailure('participant-left', error));
      const meetingHands = raisedHands.get(meetingId);
      if (meetingHands?.delete(participant.userId)) {
        io.to(`meeting:${meetingId}`).emit('meeting:hand-raised', {
          meetingId,
          userId: participant.userId,
          name: participant.name,
          raised: false,
          raisedAt: null,
        });
      }
      if (meetingHands && meetingHands.size === 0) raisedHands.delete(meetingId);
    }
  }
  const remainingParticipants = participants ? [...participants.values()] : [];
  const remainingCount = new Set(remainingParticipants.map((item) => item.userId)).size;
  io.to(`meeting:${meetingId}`).emit('meeting:presence', {
    meetingId,
    count: remainingCount,
    participants: remainingParticipants,
  });
  if (participants && participants.size === 0) meetings.delete(meetingId);
  socket.leave(`meeting:${meetingId}`);
  if (participant) socket.leave(mediaRoomName(meetingId, participant.breakoutRoomId));
  socket.leave(`meeting:${meetingId}:moderators`);
  socket.data.meetingId = null;
};

export const registerRealtime = (io: Server) => {
  io.use(async (socket, next) => {
    try {
      const rawToken = getRawSessionToken(
        socket.handshake.auth?.token,
        socket.request.headers.cookie,
      );
      const user = await getUserByRawToken(rawToken);
      if (!user) {
        const error = new Error('Session invalide.') as Error & { data?: unknown };
        error.data = { code: 'REALTIME_AUTH_REQUIRED', error: 'Session invalide.' };
        next(error);
        return;
      }
      socket.data.user = user;
      socket.data.rawSessionToken = rawToken;
      next();
    } catch (cause) {
      next(cause instanceof Error ? cause : new Error('Authentification temps réel impossible.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as PublicUser;
    const meetingSessionKeepAlive = setInterval(() => {
      const token = String(socket.data.rawSessionToken || '');
      if (socket.data.meetingId && token) {
        void touchSessionActivity(token).catch(() => undefined);
      }
    }, 2 * 60 * 1000);
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admins');

    const realtimeRateBuckets = new Map<string, { count:number; resetAt:number }>();
    socket.use(([rawEvent], next) => {
      const eventName = String(rawEvent || '');
      const now = Date.now();
      const highVolumeSignal = new Set([
        'meeting:offer','meeting:answer','meeting:ice-candidate',
        'meeting:request-ice-restart','meeting:request-renegotiation',
      ]).has(eventName);
      const mediumVolume = new Set([
        'meeting:media-updated','meeting:reaction','meeting:hand-raised',
      ]).has(eventName);
      const limit = highVolumeSignal ? 900 : mediumVolume ? 180 : 90;
      const current = realtimeRateBuckets.get(eventName);
      if (!current || current.resetAt <= now) {
        realtimeRateBuckets.set(eventName, { count:1, resetAt:now + 60_000 });
        next();
        return;
      }
      current.count += 1;
      if (current.count > limit) {
        socket.emit('meeting:rate-limited', {
          event: eventName,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        });
        next(new Error('Trop d’actions en temps réel. Réessayez dans quelques instants.'));
        return;
      }
      next();
    });

    socket.on('meeting:join', async (payload: any, callback?: Ack) => {
      try {
        const meetingId = Number(payload?.meetingId);
        const meeting = await getMeetingById(meetingId);
        if (!meeting) return callback?.(fail('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
        if (meeting.status === 'ended' || meeting.status === 'cancelled') {
          return callback?.(fail('REALTIME_MEETING_ENDED', 'Cette réunion est terminée ou annulée.'));
        }
        const banned = await query('SELECT 1 FROM room_meeting_bans WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meetingId, user.id]);
        if (banned.rows[0]) return callback?.(fail('REALTIME_MEETING_BANNED', 'Vous avez été exclu de cette réunion.'));
        if (!(await hasMeetingAccess(meetingId, user))) return callback?.(fail('REALTIME_MEETING_ACCESS_DENIED', 'Accès non autorisé à cette réunion.'));
        const moderator = canModerateMeeting(meeting, user);
        if (!moderator && meeting.status !== 'live' && meeting.settings.joinBeforeHost !== true) {
          return callback?.(fail('REALTIME_MEETING_NOT_STARTED', 'La réunion n’a pas encore commencé.'));
        }

        if (socket.data.meetingId && Number(socket.data.meetingId) !== meetingId) await removeSocketFromMeeting(io, socket);

        const roleResult = await query(`SELECT role FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1`, [meetingId, user.id]);
        const role = moderator
          ? ((meeting.host_id === user.id || meeting.temporary_host_id === user.id) ? 'host' : 'cohost')
          : String(roleResult.rows[0]?.role || 'participant');
        const requestedBreakoutId = payload?.breakoutRoomId ? String(payload.breakoutRoomId) : null;
        let breakoutRoomId: string | null = null;
        if (requestedBreakoutId) {
          const assignment = await query(
            `SELECT br.id FROM room_breakout_rooms br
              LEFT JOIN room_breakout_members bm ON bm.breakout_room_id=br.id AND bm.user_id=$3
             WHERE br.id=$1 AND br.meeting_id=$2 AND br.is_open=true
               AND ($4::boolean=true OR bm.user_id IS NOT NULL)
             LIMIT 1`,
            [requestedBreakoutId, meetingId, user.id, moderator],
          );
          if (!assignment.rows[0]) return callback?.(fail('REALTIME_BREAKOUT_ACCESS_DENIED', 'Accès non autorisé à cette sous-salle.'));
          breakoutRoomId = requestedBreakoutId;
        }
        const requestedMedia = cleanMedia(payload?.media);
        const guestScreenAllowed = !user.isGuest || await isPlatformFeatureEnabled('guestScreenShareEnabled');
        const accountScreenAllowed = canUseAccountFeature(user, 'screenShare');
        const allowedMedia: MediaState = {
          audio: (moderator || meeting.settings.participantAudio !== false) ? requestedMedia.audio : false,
          video: (moderator || meeting.settings.participantVideo !== false) ? requestedMedia.video : false,
          screen: accountScreenAllowed && guestScreenAllowed && (moderator || meeting.settings.screenShare !== false) ? requestedMedia.screen : false,
        };
        const participant: LiveParticipant = {
          socketId: socket.id,
          userId: user.id,
          name: user.name || user.email,
          avatar: user.avatar,
          role,
          media: allowedMedia,
          breakoutRoomId,
        };
        const roomParticipants = meetings.get(meetingId) || new Map<string, LiveParticipant>();
        const existing = [...roomParticipants.values()].filter((item) => item.breakoutRoomId === breakoutRoomId);
        await query(
          `UPDATE room_meeting_members
              SET status='accepted',joined_at=COALESCE(joined_at,now()),left_at=NULL,updated_at=now()
            WHERE meeting_id=$1 AND user_id=$2`,
          [meetingId, user.id],
        );
        socket.data.meetingId = meetingId;
        socket.join(`meeting:${meetingId}`);
        socket.join(mediaRoomName(meetingId, breakoutRoomId));
        if (moderator) socket.join(`meeting:${meetingId}:moderators`);
        roomParticipants.set(socket.id, participant);
        meetings.set(meetingId, roomParticipants);
        const count = new Set([...roomParticipants.values()].map((item) => item.userId)).size;
        await query('UPDATE room_meetings SET participant_count=GREATEST(participant_count,$2),updated_at=now() WHERE id=$1', [meetingId, count])
          .catch((error) => warnPersistenceFailure('participant-count', error));
        const hands = [...(raisedHands.get(meetingId)?.values() || [])];
        callback?.({ ok: true, participants: existing, raisedHands: hands });
        socket.emit('meeting:hands-snapshot', { meetingId, hands });
        socket.to(mediaRoomName(meetingId, breakoutRoomId)).emit('meeting:participant-joined', participant);
        io.to(`meeting:${meetingId}`).emit('meeting:presence', { meetingId, count, participants: [...roomParticipants.values()] });
        await rebalanceTemporaryHost(io, meetingId);
      } catch {
        callback?.(fail('REALTIME_JOIN_FAILED', 'Impossible de rejoindre la réunion en temps réel.'));
      }
    });

    socket.on('meeting:leave', async () => {
      const meetingId = Number(socket.data.meetingId || 0);
      await removeSocketFromMeeting(io, socket);
      if (meetingId) await rebalanceTemporaryHost(io, meetingId);
    });

    socket.on('meeting:media-updated', async (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      const participant = participantForSocket(meetingId, socket.id);
      if (!participant) return callback?.(fail('REALTIME_NOT_JOINED', 'Participant introuvable.'));
      const meeting = await getMeetingById(meetingId);
      if (!meeting) return callback?.(fail('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
      const moderator = canModerateMeeting(meeting, user);
      const requestedMedia = cleanMedia(payload?.media);
      const guestScreenAllowed = !user.isGuest || await isPlatformFeatureEnabled('guestScreenShareEnabled');
      const accountScreenAllowed = canUseAccountFeature(user, 'screenShare');
      participant.media = {
        audio: (moderator || meeting.settings.participantAudio !== false) ? requestedMedia.audio : false,
        video: (moderator || meeting.settings.participantVideo !== false) ? requestedMedia.video : false,
        screen: accountScreenAllowed && guestScreenAllowed && (moderator || meeting.settings.screenShare !== false) ? requestedMedia.screen : false,
      };
      if (participant.media.audio || participant.media.video) {
        await query(
          `UPDATE room_meeting_members
              SET muted_by_host=CASE WHEN $3 THEN false ELSE muted_by_host END,
                  camera_disabled_by_host=CASE WHEN $4 THEN false ELSE camera_disabled_by_host END,
                  updated_at=now()
            WHERE meeting_id=$1 AND user_id=$2`,
          [meetingId, user.id, participant.media.audio, participant.media.video],
        ).catch((error) => warnPersistenceFailure('participant-media', error));
      }
      socket.to(mediaRoomName(meetingId, participant.breakoutRoomId)).emit('meeting:participant-media-updated', participant);
      callback?.({ ok: true, media: participant.media });
    });

    socket.on('meeting:chat-message', async (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      try {
        if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
        const meeting = await getMeetingById(meetingId);
        if (!canUseAccountFeature(user, 'messages')) {
          return callback?.(fail(user.accountStatus === 'quarantined' ? 'ACCOUNT_QUARANTINED' : 'FEATURE_RESTRICTED', 'La messagerie a été désactivée pour ce compte.'));
        }
        if (user.isGuest && !(await isPlatformFeatureEnabled('guestChatEnabled'))) {
          return callback?.(fail('GUEST_CHAT_DISABLED', 'Les invités ne sont pas autorisés à envoyer des messages.'));
        }
        if (meeting?.settings.chat === false) return callback?.(fail('REALTIME_CHAT_DISABLED', 'Le chat est désactivé pour cette réunion.'));
        const message = await insertChatMessage(meetingId, user, payload?.text);
        if (!message) return callback?.(fail('VALIDATION_ERROR', 'Message vide.'));
        io.to(`meeting:${meetingId}`).emit('meeting:chat-message', message);
        callback?.({ ok: true, message });
      } catch {
        callback?.(fail('REALTIME_CHAT_FAILED', 'Envoi du message impossible.'));
      }
    });

    socket.on('meeting:hands-request', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId) {
        return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      }
      const hands = [...(raisedHands.get(meetingId)?.values() || [])];
      socket.emit('meeting:hands-snapshot', { meetingId, hands });
      callback?.({ ok:true, hands });
    });

    socket.on('meeting:hand-raised', async (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      const raised = Boolean(payload?.raised);
      if (raised && user.isGuest && !(await isPlatformFeatureEnabled('guestRaiseHandEnabled'))) {
        return callback?.(fail('GUEST_RAISE_HAND_DISABLED', 'Les invités ne sont pas autorisés à lever la main.'));
      }
      const meetingHands = raisedHands.get(meetingId) || new Map<number, { userId:number; name:string; raisedAt:string }>();
      let raisedAt: string | null = null;
      if (raised) {
        raisedAt = new Date().toISOString();
        meetingHands.set(user.id, { userId:user.id, name:user.name || user.email, raisedAt });
        raisedHands.set(meetingId, meetingHands);
      } else {
        meetingHands.delete(user.id);
        if (meetingHands.size === 0) raisedHands.delete(meetingId);
      }
      io.to(`meeting:${meetingId}`).emit('meeting:hand-raised', {
        meetingId,
        userId: user.id,
        name: user.name || user.email,
        raised,
        raisedAt,
      });
      callback?.({ ok: true, raisedAt });
    });

    socket.on('meeting:reaction', async (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      const meeting = await getMeetingById(meetingId);
      if (!meeting) return callback?.(fail('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
      if (!canModerateMeeting(meeting, user) && meeting.settings.reactions === false) {
        return callback?.(fail('REALTIME_REACTIONS_DISABLED', 'Les réactions sont désactivées pour cette réunion.'));
      }
      const reaction = String(payload?.reaction || '').slice(0, 16);
      if (!reaction) return callback?.(fail('VALIDATION_ERROR', 'Réaction invalide.'));
      io.to(`meeting:${meetingId}`).emit('meeting:reaction', { meetingId, userId: user.id, name: user.name, reaction, at: new Date().toISOString() });
      callback?.({ ok: true });
    });

    for (const eventName of ['meeting:offer', 'meeting:answer', 'meeting:ice-candidate'] as const) {
      socket.on(eventName, (payload: any, callback?: Ack) => {
        const meetingId = Number(socket.data.meetingId || 0);
        const targetSocketId = String(payload?.targetSocketId || '');
        const participants = meetings.get(meetingId);
        const source = participants?.get(socket.id);
        const target = participants?.get(targetSocketId);
        if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId || !source || !target || source.breakoutRoomId !== target.breakoutRoomId) {
          return callback?.(fail('REALTIME_TARGET_INVALID', 'Participant cible introuvable dans cette salle média.'));
        }
        io.to(targetSocketId).emit(eventName, {
          ...payload,
          meetingId,
          fromSocketId: socket.id,
          fromUserId: user.id,
        });
        callback?.({ ok: true });
      });
    }

    socket.on('meeting:request-ice-restart', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      const targetSocketId = String(payload?.targetSocketId || '');
      const source = meetings.get(meetingId)?.get(socket.id);
      const target = meetings.get(meetingId)?.get(targetSocketId);
      if (!meetingId || !source || !target || source.breakoutRoomId !== target.breakoutRoomId) return callback?.(fail('REALTIME_TARGET_INVALID', 'Participant cible introuvable dans cette salle média.'));
      io.to(targetSocketId).emit('meeting:ice-restart-requested', { meetingId, fromSocketId: socket.id, fromUserId: user.id });
      callback?.({ ok: true });
    });

    socket.on('meeting:request-renegotiation', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      const targetSocketId = String(payload?.targetSocketId || '');
      const source = meetings.get(meetingId)?.get(socket.id);
      const target = meetings.get(meetingId)?.get(targetSocketId);
      if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId || !source || !target || source.breakoutRoomId !== target.breakoutRoomId) {
        return callback?.(fail('REALTIME_TARGET_INVALID', 'Participant cible introuvable dans cette salle média.'));
      }
      io.to(targetSocketId).emit('meeting:renegotiation-requested', {
        meetingId,
        fromSocketId: socket.id,
        fromUserId: user.id,
      });
      callback?.({ ok: true });
    });

    socket.on('disconnect', () => {
      realtimeRateBuckets.clear();
      const meetingId = Number(socket.data.meetingId || 0);
      void removeSocketFromMeeting(io, socket).then(() => {
        if (meetingId) return rebalanceTemporaryHost(io, meetingId);
        return undefined;
      });
    });
  });
};
