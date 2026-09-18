import type { Server, Socket } from 'socket.io';
import {
  PublicUser,
  canModerateMeeting,
  getUserByRawToken,
  hasMeetingAccess,
  query,
} from './core.js';
import { getMeetingById, insertChatMessage } from './meetingRoutes.js';

type MediaState = { audio: boolean; video: boolean; screen: boolean };
type LiveParticipant = {
  socketId: string;
  userId: number;
  name: string;
  avatar: string;
  role: string;
  media: MediaState;
};

type Ack = (payload: unknown) => void;

const meetings = new Map<number, Map<string, LiveParticipant>>();
const cleanMedia = (value: any): MediaState => ({ audio: Boolean(value?.audio), video: Boolean(value?.video), screen: Boolean(value?.screen) });
const fail = (code: string, error: string) => ({ ok: false, code, error });

const participantForSocket = (meetingId: number, socketId: string) => meetings.get(meetingId)?.get(socketId) || null;

const removeSocketFromMeeting = async (io: Server, socket: Socket) => {
  const meetingId = Number(socket.data.meetingId || 0);
  if (!meetingId) return;
  const participants = meetings.get(meetingId);
  const participant = participants?.get(socket.id);
  participants?.delete(socket.id);
  if (participant) {
    io.to(`meeting:${meetingId}`).emit('meeting:participant-left', { socketId: socket.id, userId: participant.userId });
    const otherDeviceOnline = [...(participants?.values() || [])].some((item) => item.userId === participant.userId);
    if (!otherDeviceOnline) {
      await query(`UPDATE room_meeting_members SET left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meetingId, participant.userId]).catch(() => undefined);
    }
  }
  if (participants && participants.size === 0) meetings.delete(meetingId);
  socket.leave(`meeting:${meetingId}`);
  socket.leave(`meeting:${meetingId}:moderators`);
  socket.data.meetingId = null;
};

export const registerRealtime = (io: Server) => {
  io.use(async (socket, next) => {
    try {
      const user = await getUserByRawToken(String(socket.handshake.auth?.token || ''));
      if (!user) {
        const error = new Error('Session invalide.') as Error & { data?: unknown };
        error.data = { code: 'REALTIME_AUTH_REQUIRED', error: 'Session invalide.' };
        next(error);
        return;
      }
      socket.data.user = user;
      next();
    } catch (cause) {
      next(cause instanceof Error ? cause : new Error('Authentification temps réel impossible.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as PublicUser;
    socket.join(`user:${user.id}`);

    socket.on('meeting:join', async (payload: any, callback?: Ack) => {
      try {
        const meetingId = Number(payload?.meetingId);
        const meeting = await getMeetingById(meetingId);
        if (!meeting) return callback?.(fail('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
        const banned = await query('SELECT 1 FROM room_meeting_bans WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meetingId, user.id]);
        if (banned.rows[0]) return callback?.(fail('REALTIME_MEETING_BANNED', 'Vous avez été exclu de cette réunion.'));
        if (!(await hasMeetingAccess(meetingId, user))) return callback?.(fail('REALTIME_MEETING_ACCESS_DENIED', 'Accès non autorisé à cette réunion.'));
        const moderator = canModerateMeeting(meeting, user);
        if (!moderator && meeting.status !== 'live' && meeting.settings.joinBeforeHost !== true) {
          return callback?.(fail('REALTIME_MEETING_NOT_STARTED', 'La réunion n’a pas encore commencé.'));
        }

        if (socket.data.meetingId && Number(socket.data.meetingId) !== meetingId) await removeSocketFromMeeting(io, socket);

        const roleResult = await query(`SELECT role FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1`, [meetingId, user.id]);
        const role = moderator ? (meeting.host_id === user.id ? 'host' : 'cohost') : String(roleResult.rows[0]?.role || 'participant');
        const participant: LiveParticipant = {
          socketId: socket.id,
          userId: user.id,
          name: user.name || user.email,
          avatar: user.avatar,
          role,
          media: cleanMedia(payload?.media),
        };
        const roomParticipants = meetings.get(meetingId) || new Map<string, LiveParticipant>();
        const existing = [...roomParticipants.values()];
        socket.data.meetingId = meetingId;
        socket.join(`meeting:${meetingId}`);
        if (moderator) socket.join(`meeting:${meetingId}:moderators`);
        roomParticipants.set(socket.id, participant);
        meetings.set(meetingId, roomParticipants);
        await query(`UPDATE room_meeting_members SET status='accepted',joined_at=COALESCE(joined_at,now()),left_at=NULL,updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meetingId, user.id]).catch(() => undefined);
        const count = new Set([...roomParticipants.values()].map((item) => item.userId)).size;
        await query('UPDATE room_meetings SET participant_count=GREATEST(participant_count,$2),updated_at=now() WHERE id=$1', [meetingId, count]).catch(() => undefined);
        callback?.({ ok: true, participants: existing });
        socket.to(`meeting:${meetingId}`).emit('meeting:participant-joined', participant);
        io.to(`meeting:${meetingId}`).emit('meeting:presence', { meetingId, count, participants: [...roomParticipants.values()] });
      } catch {
        callback?.(fail('REALTIME_JOIN_FAILED', 'Impossible de rejoindre la réunion en temps réel.'));
      }
    });

    socket.on('meeting:leave', async () => {
      await removeSocketFromMeeting(io, socket);
    });

    socket.on('meeting:media-updated', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      const participant = participantForSocket(meetingId, socket.id);
      if (!participant) return callback?.(fail('REALTIME_NOT_JOINED', 'Participant introuvable.'));
      participant.media = cleanMedia(payload?.media);
      socket.to(`meeting:${meetingId}`).emit('meeting:participant-media-updated', participant);
      callback?.({ ok: true });
    });

    socket.on('meeting:chat-message', async (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      try {
        if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
        const meeting = await getMeetingById(meetingId);
        if (!meeting?.settings.chat) return callback?.(fail('REALTIME_CHAT_DISABLED', 'Le chat est désactivé pour cette réunion.'));
        const message = await insertChatMessage(meetingId, user, payload?.text);
        if (!message) return callback?.(fail('VALIDATION_ERROR', 'Message vide.'));
        io.to(`meeting:${meetingId}`).emit('meeting:chat-message', message);
        callback?.({ ok: true, message });
      } catch {
        callback?.(fail('REALTIME_CHAT_FAILED', 'Envoi du message impossible.'));
      }
    });

    socket.on('meeting:hand-raised', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
      const raised = Boolean(payload?.raised);
      io.to(`meeting:${meetingId}`).emit('meeting:hand-raised', { meetingId, userId: user.id, name: user.name, raised });
      callback?.({ ok: true });
    });

    socket.on('meeting:reaction', (payload: any, callback?: Ack) => {
      const meetingId = Number(socket.data.meetingId || 0);
      if (!meetingId) return callback?.(fail('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion.'));
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
        if (!meetingId || Number(payload?.meetingId || meetingId) !== meetingId || !participants?.has(socket.id) || !participants.has(targetSocketId)) {
          return callback?.(fail('REALTIME_TARGET_INVALID', 'Participant cible introuvable dans cette réunion.'));
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
      if (!meetingId || !meetings.get(meetingId)?.has(targetSocketId)) return callback?.(fail('REALTIME_TARGET_INVALID', 'Participant cible introuvable.'));
      io.to(targetSocketId).emit('meeting:ice-restart-requested', { meetingId, fromSocketId: socket.id, fromUserId: user.id });
      callback?.({ ok: true });
    });

    socket.on('disconnect', () => {
      void removeSocketFromMeeting(io, socket);
    });
  });
};
