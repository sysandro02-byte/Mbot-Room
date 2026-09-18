import type express from 'express';
import type { QueryResultRow } from 'pg';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  Meeting,
  MeetingSettings,
  authenticateToken,
  canModerateMeeting,
  createId,
  createMeetingAccessId,
  createMeetingLink,
  hashPassword,
  hasMeetingAccess,
  mapMeeting,
  normalizeEmail,
  normalizeText,
  publicMeeting,
  query,
  requireDatabase,
  sanitizeMeetingSettings,
  sendApiError,
  validateMeetingPassword,
} from './core.js';

const findMeetingByValue = async (value: unknown): Promise<Meeting | null> => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return null;
  const rows = await query('SELECT * FROM room_meetings ORDER BY id DESC');
  return rows.rows.map(mapMeeting).find((meeting) =>
    String(meeting.id) === normalized
    || meeting.meeting_link.toLowerCase() === normalized
    || String(meeting.settings.meetingAccessId || '').toLowerCase() === normalized
    || meeting.meeting_link.slice(-6).toLowerCase() === normalized
  ) || null;
};

const getMeetingById = async (id: number) => {
  const result = await query('SELECT * FROM room_meetings WHERE id=$1 LIMIT 1', [id]);
  return result.rows[0] ? mapMeeting(result.rows[0]) : null;
};

const visibleToUser = async (meeting: Meeting, user: NonNullable<AuthedRequest['user']>) => {
  if (user.role === 'admin' || canModerateMeeting(meeting, user)) return true;
  if (meeting.settings.isPublic === true || meeting.settings.visibility === 'public') return true;
  const invited = (meeting.settings.participants || []).some((value) => normalizeEmail(value) === normalizeEmail(user.email));
  if (invited) return true;
  return hasMeetingAccess(meeting.id, user);
};

const meetingRole = (meeting: Meeting, user: NonNullable<AuthedRequest['user']>) => {
  if (meeting.host_id === user.id) return 'host';
  if (meeting.co_host_id === user.id) return 'cohost';
  return 'participant';
};

const meetingCapacity = (meeting: Meeting) => {
  const configured = Number(meeting.settings.participantCapacity || 100);
  if (!Number.isFinite(configured)) return 100;
  return Math.max(2, Math.min(1000, Math.floor(configured)));
};

const acceptedMemberCount = async (meetingId: number) => {
  const result = await query(`SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'`, [meetingId]);
  return Number(result.rows[0]?.count || 0);
};

const normalizeInvitationEmails = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map(normalizeEmail).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))].slice(0, 200)
  : [];

const escapeHtml = (value: unknown) => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const sendInvitations = async (meeting: Meeting, emails: string[], password: string, request: express.Request) => {
  if (!emails.length) return { configured: Boolean(process.env.RESEND_API_KEY), sent: 0, failed: 0 };
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { configured: false, sent: 0, failed: emails.length };
  const clientOrigin = String(process.env.MBOTE_ROOM_APP_URL || request.headers.origin || '').replace(/\/+$/, '');
  const joinUrl = `${clientOrigin}/join/${encodeURIComponent(meeting.meeting_link)}`;
  const meetingId = String(meeting.settings.meetingAccessId || meeting.id);
  const results = await Promise.all(emails.map(async (email) => {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: String(process.env.MEETING_INVITE_FROM || 'MBotéRoom <onboarding@resend.dev>'),
        to: [email],
        subject: `Invitation MBotéRoom : ${meeting.title}`,
        text: `${meeting.host_name} vous invite à « ${meeting.title} ».\nID : ${meetingId}\n${password ? `Mot de passe : ${password}\n` : ''}Rejoindre : ${joinUrl}`,
        html: `<div style="font-family:Arial,sans-serif;color:#17213c"><h2>Invitation MBotéRoom</h2><p><strong>${escapeHtml(meeting.host_name)}</strong> vous invite à <strong>${escapeHtml(meeting.title)}</strong>.</p><p>ID : <strong>${escapeHtml(meetingId)}</strong>${password ? `<br>Mot de passe : <strong>${escapeHtml(password)}</strong>` : ''}</p><p><a href="${escapeHtml(joinUrl)}">Rejoindre la réunion</a></p></div>`,
      }),
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);
    return Boolean(result?.ok);
  }));
  const sent = results.filter(Boolean).length;
  return { configured: true, sent, failed: emails.length - sent };
};

const defaultSettings = (): MeetingSettings => ({
  waitingRoom: true,
  participantAudio: true,
  participantVideo: true,
  screenShare: true,
  chat: true,
  reactions: true,
  recording: false,
  lunaSummary: true,
  encryption: true,
  linkSharing: true,
  externalAccess: true,
  joinBeforeHost: false,
  locked: false,
});

const buildSettings = (body: any, existing?: Meeting) => {
  const incoming = (body?.settings || {}) as MeetingSettings & { password?: string };
  const settings: MeetingSettings = { ...defaultSettings(), ...(existing?.settings || {}), ...incoming };
  const invitationEmails = normalizeInvitationEmails(body?.participants || incoming.participants);
  if (invitationEmails.length) settings.participants = invitationEmails;
  const plainPassword = String(incoming.password || '').trim();
  delete (settings as any).password;
  if (Object.prototype.hasOwnProperty.call(incoming, 'password')) {
    delete settings.passwordHash;
    delete settings.passwordSalt;
    if (plainPassword) {
      const passwordData = hashPassword(plainPassword);
      settings.passwordHash = passwordData.hash;
      settings.passwordSalt = passwordData.salt;
    }
  }
  if (!settings.meetingAccessId) settings.meetingAccessId = createMeetingAccessId();
  return { settings, invitationEmails, plainPassword };
};

const insertChatMessage = async (meetingId: number, user: NonNullable<AuthedRequest['user']>, textValue: unknown) => {
  const text = normalizeText(textValue).slice(0, 2000);
  if (!text) return null;
  const id = createId();
  const result = await query(
    `INSERT INTO room_messages (id,meeting_id,user_id,sender,text) VALUES ($1,$2,$3,$4,$5)
     RETURNING id,meeting_id,user_id,sender,text,created_at`,
    [id, meetingId, user.id, user.name || user.email, text],
  );
  const row = result.rows[0];
  return { id: row.id, meetingId: String(row.meeting_id), userId: row.user_id, sender: row.sender, text: row.text, time: new Date(row.created_at).toISOString() };
};

const getPoll = async (pollId: string) => {
  const pollResult = await query('SELECT * FROM room_polls WHERE id=$1 LIMIT 1', [pollId]);
  const poll = pollResult.rows[0];
  if (!poll) return null;
  const optionsResult = await query(
    `SELECT o.id,o.label,o.position,COUNT(a.user_id)::int AS votes
       FROM room_poll_options o LEFT JOIN room_poll_answers a ON a.option_id=o.id
      WHERE o.poll_id=$1 GROUP BY o.id,o.label,o.position ORDER BY o.position ASC`,
    [pollId],
  );
  return {
    id: poll.id,
    meetingId: Number(poll.meeting_id),
    question: poll.question,
    isOpen: poll.is_open,
    createdBy: Number(poll.created_by),
    createdAt: new Date(poll.created_at).toISOString(),
    options: optionsResult.rows.map((row) => ({ id: row.id, label: row.label, votes: Number(row.votes) })),
  };
};

type MeetingPollPayload = NonNullable<Awaited<ReturnType<typeof getPoll>>>;

type ActusMeetingPayload = Meeting & {
  is_public: boolean;
  is_invited: boolean;
  my_lobby_status: null;
  relevance_reason: 'created_by_me' | 'registered';
};

const callGroq = async (system: string, prompt: string) => {
  const key = String(process.env.GROQ_API_KEY || '').trim();
  if (!key) return null;
  const models = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').split(',').map((m) => m.trim()).filter(Boolean);
  for (const model of models) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 30000)),
    }).catch(() => null);
    if (!response?.ok) continue;
    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (text) return String(text).trim();
  }
  return null;
};

const generateSummary = async (meeting: Meeting) => {
  const [messages, captions] = await Promise.all([
    query(`SELECT sender,text,created_at FROM room_messages WHERE meeting_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 500`, [meeting.id]),
    query(`SELECT speaker,text,created_at FROM room_captions WHERE meeting_id=$1 ORDER BY created_at ASC LIMIT 1200`, [meeting.id]).catch(() => ({ rows: [] })),
  ]);
  if ((!messages.rows.length && !captions.rows.length) || !process.env.GROQ_API_KEY) return null;
  const transcriptRows = [
    ...messages.rows.map((row) => ({ at: new Date(row.created_at).getTime(), line: `[Chat · ${row.sender}] ${row.text}` })),
    ...captions.rows.map((row) => ({ at: new Date(row.created_at).getTime(), line: `[Sous-titre · ${row.speaker}] ${row.text}` })),
  ].sort((a, b) => a.at - b.at);
  const transcript = transcriptRows.map((row) => row.line).join('\n').slice(0, 30000);
  const answer = await callGroq(
    'Tu es Luna IA. Retourne UNIQUEMENT un JSON valide avec les clés bullets (string[]), decisions (string[]), actions (string[]), nextMeeting (string). N’invente rien qui ne figure pas dans le transcript.',
    `Réunion: ${meeting.title}\nTranscript textuel (chat + sous-titres):\n${transcript}`,
  );
  if (!answer) return null;
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || answer);
    const summary = {
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 8).map(String) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 8).map(String) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 10).map(String) : [],
      nextMeeting: String(parsed.nextMeeting || ''),
    };
    await query(
      `INSERT INTO room_meeting_summaries (meeting_id,bullets,decisions,actions,next_meeting,provider)
       VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,'groq')
       ON CONFLICT (meeting_id) DO UPDATE SET bullets=excluded.bullets,decisions=excluded.decisions,actions=excluded.actions,next_meeting=excluded.next_meeting,provider=excluded.provider,updated_at=now()`,
      [meeting.id, JSON.stringify(summary.bullets), JSON.stringify(summary.decisions), JSON.stringify(summary.actions), summary.nextMeeting],
    );
    return summary;
  } catch {
    return null;
  }
};

export const registerMeetingRoutes = (app: express.Express, io: Server) => {
  const protectedApi = [requireDatabase, authenticateToken] as const;

  app.get('/api/meetings', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query('SELECT * FROM room_meetings WHERE status <> \'cancelled\' ORDER BY start_time ASC');
      const visible: Meeting[] = [];
      for (const row of result.rows) {
        const meeting = mapMeeting(row);
        if (await visibleToUser(meeting, request.user!)) visible.push({ ...meeting, settings: sanitizeMeetingSettings(meeting.settings) });
      }
      response.json(visible);
    } catch (error) { next(error); }
  });

  app.post('/api/meetings', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const title = normalizeText(request.body?.title || 'Réunion MBoté').slice(0, 160);
      const description = normalizeText(request.body?.description).slice(0, 1500);
      const start = new Date(request.body?.startTime || request.body?.start_time || Date.now());
      const duration = Math.max(15, Math.min(1440, Number(request.body?.duration || 60)));
      const { settings, invitationEmails, plainPassword } = buildSettings(request.body);
      const inserted = await query(
        `INSERT INTO room_meetings
          (title,description,host_id,co_host_id,host_name,host_avatar,start_time,duration,meeting_link,is_active,settings,participant_count,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10::jsonb,1,'scheduled') RETURNING *`,
        [title, description, request.user!.id, request.body?.coHostId ? Number(request.body.coHostId) : null, request.user!.name, request.user!.avatar, Number.isNaN(start.getTime()) ? new Date().toISOString() : start.toISOString(), duration, createMeetingLink(), JSON.stringify(settings)],
      );
      const meeting = mapMeeting(inserted.rows[0]);
      await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'host','accepted') ON CONFLICT DO NOTHING`, [meeting.id, request.user!.id]);
      if (meeting.co_host_id) await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'cohost','accepted') ON CONFLICT DO NOTHING`, [meeting.id, meeting.co_host_id]);
      const invitations = await sendInvitations(meeting, invitationEmails, plainPassword, request);
      io.emit('meeting:created', { ...meeting, settings: sanitizeMeetingSettings(meeting.settings) });
      response.status(201).json({ ...meeting, settings: sanitizeMeetingSettings(meeting.settings), invitations });
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/participant-suggestions', ...protectedApi, async (request, response, next) => {
    try {
      const term = `%${normalizeText(request.query.query).toLowerCase()}%`;
      const result = await query(
        `SELECT id,name,username,email,avatar FROM room_users
          WHERE is_guest=false AND (lower(name) LIKE $1 OR lower(username) LIKE $1 OR lower(email) LIKE $1)
          ORDER BY name ASC LIMIT 20`, [term],
      );
      response.json(result.rows);
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/join-lookup', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await findMeetingByValue(request.body?.value);
      if (!meeting || meeting.status === 'cancelled') return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!validateMeetingPassword(meeting, request.body?.password)) return sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
      const ban = await query('SELECT 1 FROM room_meeting_bans WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id, request.user!.id]);
      if (ban.rows[0]) return sendApiError(response, 403, 'MEETING_BANNED', 'Vous avez été exclu de cette réunion.');
      response.json({ ...meeting, settings: sanitizeMeetingSettings(meeting.settings) });
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/link/:meetingLink', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query('SELECT * FROM room_meetings WHERE meeting_link=$1 AND status<>\'cancelled\' LIMIT 1', [request.params.meetingLink]);
      if (!result.rows[0]) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      const meeting = mapMeeting(result.rows[0]);
      const allowed = await visibleToUser(meeting, request.user!);
      if (!allowed && meeting.settings.externalAccess === false) return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé à cette réunion.');
      response.json({ ...meeting, settings: sanitizeMeetingSettings(meeting.settings) });
    } catch (error) { next(error); }
  });

  app.put('/api/meetings/:meetingId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut modifier cette réunion.');
      const { settings } = buildSettings(request.body, meeting);
      const updated = await query(
        `UPDATE room_meetings SET title=$2,description=$3,start_time=$4,duration=$5,co_host_id=$6,settings=$7::jsonb,updated_at=now() WHERE id=$1 RETURNING *`,
        [meeting.id, normalizeText(request.body?.title || meeting.title).slice(0,160), normalizeText(request.body?.description ?? meeting.description).slice(0,1500), new Date(request.body?.startTime || request.body?.start_time || meeting.start_time).toISOString(), Math.max(15,Number(request.body?.duration || meeting.duration)), request.body?.coHostId ? Number(request.body.coHostId) : meeting.co_host_id || null, JSON.stringify(settings)],
      );
      const value = publicMeeting(updated.rows[0]);
      io.emit('meeting:updated', value);
      response.json(value);
    } catch (error) { next(error); }
  });

  app.delete('/api/meetings/:meetingId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return response.status(204).end();
      if (!canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut annuler cette réunion.');
      await query(`UPDATE room_meetings SET status='cancelled',is_active=false,ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1`, [meeting.id]);
      io.emit('meeting:cancelled', { meetingId: meeting.id });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/:meetingId/lobby', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      const moderator = canModerateMeeting(meeting, request.user!);
      const rows = await query(`SELECT meeting_id,user_id,status,name,avatar FROM room_lobby WHERE meeting_id=$1 ${moderator ? '' : 'AND user_id=$2'} ORDER BY name`, moderator ? [meeting.id] : [meeting.id, request.user!.id]);
      response.json(rows.rows);
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/join-request', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!validateMeetingPassword(meeting, request.body?.password)) return sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
      const ban = await query('SELECT 1 FROM room_meeting_bans WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id, request.user!.id]);
      if (ban.rows[0]) return sendApiError(response, 403, 'MEETING_BANNED', 'Vous avez été exclu de cette réunion.');
      const existingMember = await query(
        `SELECT status FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1`,
        [meeting.id, request.user!.id],
      );
      const alreadyAccepted = existingMember.rows[0]?.status === 'accepted';
      if (meeting.settings.locked === true && !canModerateMeeting(meeting, request.user!) && !alreadyAccepted) {
        return sendApiError(response, 423, 'MEETING_LOCKED', 'La réunion est verrouillée par l’hôte.');
      }
      const moderator = canModerateMeeting(meeting, request.user!);
      const hostHasStarted = meeting.is_active || meeting.status === 'live';
      const blockedUntilHost = !moderator && !alreadyAccepted && !hostHasStarted && meeting.settings.joinBeforeHost === false;
      const status = moderator || alreadyAccepted || (!blockedUntilHost && meeting.settings.waitingRoom === false) ? 'accepted' : 'requested';
      if (status === 'accepted' && !alreadyAccepted && !moderator) {
        const count = await acceptedMemberCount(meeting.id);
        if (count >= meetingCapacity(meeting)) return sendApiError(response, 409, 'MEETING_CAPACITY_REACHED', 'La capacité maximale de la réunion est atteinte.');
      }
      await query(
        `INSERT INTO room_lobby (meeting_id,user_id,status,name,avatar) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (meeting_id,user_id) DO UPDATE SET status=excluded.status,name=excluded.name,avatar=excluded.avatar`,
        [meeting.id, request.user!.id, status, request.user!.name, request.user!.avatar],
      );
      if (status === 'accepted') {
        await query(
          `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,$3,'accepted',now())
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),updated_at=now()`,
          [meeting.id, request.user!.id, meetingRole(meeting, request.user!)],
        );
      }
      io.to(`meeting:${meeting.id}:moderators`).emit('meeting:lobby-updated', { meetingId: meeting.id, userId: request.user!.id, status });
      response.json({ success: true, status });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/lobby/respond', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'LOBBY_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut gérer la salle d’attente.');
      const userId = Number(request.body?.userId);
      const status = request.body?.status === 'rejected' ? 'rejected' : 'accepted';
      const updated = await query('UPDATE room_lobby SET status=$3 WHERE meeting_id=$1 AND user_id=$2 RETURNING *', [meeting.id, userId, status]);
      if (!updated.rows[0]) return sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable dans la salle d’attente.');
      if (status === 'accepted') {
        const existingAccepted = await query(`SELECT 1 FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 AND status='accepted' LIMIT 1`, [meeting.id, userId]);
        if (!existingAccepted.rows[0] && await acceptedMemberCount(meeting.id) >= meetingCapacity(meeting)) {
          return sendApiError(response, 409, 'MEETING_CAPACITY_REACHED', 'La capacité maximale de la réunion est atteinte.');
        }
        await query(
          `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'participant','accepted',now())
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),updated_at=now()`, [meeting.id,userId],
        );
      }
      io.to(`user:${userId}`).emit('meeting:lobby-status', { meetingId: meeting.id, status });
      io.to(`meeting:${meeting.id}`).emit('meeting:lobby-updated', { meetingId: meeting.id, userId, status });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/lobby/admit-all', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'LOBBY_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut gérer la salle d’attente.');
      const pending = await query(`SELECT user_id FROM room_lobby WHERE meeting_id=$1 AND status='requested' ORDER BY user_id`, [meeting.id]);
      const currentCount = await acceptedMemberCount(meeting.id);
      const availableSlots = Math.max(0, meetingCapacity(meeting) - currentCount);
      const userIds = pending.rows.map((row) => Number(row.user_id)).filter(Boolean).slice(0, availableSlots);
      if (userIds.length) {
        await query(`UPDATE room_lobby SET status='accepted' WHERE meeting_id=$1 AND user_id = ANY($2::int[])`, [meeting.id, userIds]);
        for (const userId of userIds) {
          await query(
            `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'participant','accepted',now())
             ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),updated_at=now()`,
            [meeting.id, userId],
          );
          io.to(`user:${userId}`).emit('meeting:lobby-status', { meetingId: meeting.id, status: 'accepted' });
        }
        io.to(`meeting:${meeting.id}`).emit('meeting:lobby-updated', { meetingId: meeting.id, admitAll: true, userIds });
      }
      response.json({ success: true, admitted: userIds.length, userIds });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/lock', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const locked = Boolean(request.body?.locked);
      const settings = { ...meeting.settings, locked };
      const updated = await query(
        `UPDATE room_meetings SET settings=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *`,
        [meeting.id, JSON.stringify(settings)],
      );
      const value = publicMeeting(updated.rows[0]);
      io.to(`meeting:${meeting.id}`).emit('meeting:locked', { meetingId: meeting.id, locked });
      response.json({ success: true, locked, meeting: value });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/start-notify', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut démarrer la réunion.');
      const updated = await query(`UPDATE room_meetings SET status='live',is_active=true,started_at=COALESCE(started_at,now()),ended_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [meeting.id]);
      if (meeting.settings.waitingRoom === false) {
        const pending = await query(`SELECT user_id FROM room_lobby WHERE meeting_id=$1 AND status='requested' ORDER BY user_id`, [meeting.id]);
        const currentCount = await acceptedMemberCount(meeting.id);
        const availableSlots = Math.max(0, meetingCapacity(meeting) - currentCount);
        const autoAdmitIds = pending.rows.map((row) => Number(row.user_id)).filter(Boolean).slice(0, availableSlots);
        if (autoAdmitIds.length) {
          await query(`UPDATE room_lobby SET status='accepted' WHERE meeting_id=$1 AND user_id = ANY($2::int[])`, [meeting.id, autoAdmitIds]);
          for (const userId of autoAdmitIds) {
            await query(
              `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'participant','accepted',now())
               ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),updated_at=now()`,
              [meeting.id, userId],
            );
            io.to(`user:${userId}`).emit('meeting:lobby-status', { meetingId: meeting.id, status: 'accepted' });
          }
          io.to(`meeting:${meeting.id}`).emit('meeting:lobby-updated', { meetingId: meeting.id, autoAdmitted: true });
        }
      }
      const members = await query(`SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND user_id<>$2`, [meeting.id, request.user!.id]);
      const value = publicMeeting(updated.rows[0]);
      io.emit('meeting:started', value);
      response.json({ success: true, notifiedCount: Number(members.rows[0]?.count || 0), meeting: value });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/end', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut terminer la réunion.');
      const updated = await query(`UPDATE room_meetings SET status='ended',is_active=false,ended_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [meeting.id]);
      if (meeting.settings.lunaSummary !== false) await generateSummary(mapMeeting(updated.rows[0])).catch(() => null);
      io.to(`meeting:${meeting.id}`).emit('meeting:ended', { meetingId: meeting.id, endedBy: request.user!.id });
      response.json({ success: true, meeting: publicMeeting(updated.rows[0]) });
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/:meetingId/participants', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!(await hasMeetingAccess(meetingId, request.user!))) return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
      const result = await query(
        `SELECT m.user_id,m.role,m.status,m.muted_by_host,m.camera_disabled_by_host,m.joined_at,m.left_at,u.name,u.username,u.email,u.avatar,u.is_guest
           FROM room_meeting_members m JOIN room_users u ON u.id=m.user_id WHERE m.meeting_id=$1 ORDER BY m.role,u.name`, [meetingId],
      );
      response.json(result.rows.map((row) => ({ userId:Number(row.user_id),role:row.role,status:row.status,mutedByHost:row.muted_by_host,cameraDisabledByHost:row.camera_disabled_by_host,joinedAt:row.joined_at,leftAt:row.left_at,name:row.name,username:row.username,email:row.email,avatar:row.avatar,isGuest:row.is_guest })));
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/participants/mute-all', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const updated = await query(
        `UPDATE room_meeting_members
            SET muted_by_host=true, updated_at=now()
          WHERE meeting_id=$1 AND user_id<>$2 AND status='accepted'
          RETURNING user_id`,
        [meeting.id, meeting.host_id],
      );
      const userIds = updated.rows.map((row) => Number(row.user_id));
      for (const userId of userIds) {
        io.to(`user:${userId}`).emit('meeting:moderation', { meetingId: meeting.id, mutedByHost: true });
      }
      io.to(`meeting:${meeting.id}`).emit('meeting:participants-muted', { meetingId: meeting.id, userIds });
      response.json({ success: true, muted: userIds.length, userIds });
    } catch (error) { next(error); }
  });

  app.patch('/api/meetings/:meetingId/participants/:userId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      const role = ['cohost','participant'].includes(request.body?.role) ? request.body.role : null;
      const muted = typeof request.body?.mutedByHost === 'boolean' ? request.body.mutedByHost : null;
      const cameraDisabled = typeof request.body?.cameraDisabledByHost === 'boolean' ? request.body.cameraDisabledByHost : null;
      const updated = await query(
        `UPDATE room_meeting_members SET
          role=COALESCE($3,role), muted_by_host=COALESCE($4,muted_by_host), camera_disabled_by_host=COALESCE($5,camera_disabled_by_host), updated_at=now()
         WHERE meeting_id=$1 AND user_id=$2 RETURNING *`, [meeting.id,userId,role,muted,cameraDisabled],
      );
      if (!updated.rows[0]) return sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable.');
      io.to(`user:${userId}`).emit('meeting:moderation', { meetingId: meeting.id, mutedByHost: updated.rows[0].muted_by_host, cameraDisabledByHost: updated.rows[0].camera_disabled_by_host, role: updated.rows[0].role });
      response.json(updated.rows[0]);
    } catch (error) { next(error); }
  });

  app.delete('/api/meetings/:meetingId/participants/:userId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      if (userId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être retiré.');
      await query(`UPDATE room_meeting_members SET status='removed',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      await query(`UPDATE room_lobby SET status='rejected' WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      io.to(`user:${userId}`).emit('meeting:removed', { meetingId: meeting.id });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/participants/:userId/ban', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      if (userId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être banni.');
      await query(`INSERT INTO room_meeting_bans (meeting_id,user_id,banned_by,reason) VALUES ($1,$2,$3,$4) ON CONFLICT (meeting_id,user_id) DO UPDATE SET banned_by=excluded.banned_by,reason=excluded.reason,created_at=now()`, [meeting.id,userId,request.user!.id,normalizeText(request.body?.reason).slice(0,500)]);
      await query(`UPDATE room_meeting_members SET status='removed',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      io.to(`user:${userId}`).emit('meeting:banned', { meetingId: meeting.id });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/participants/:userId/move-to-lobby', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      const user = await query('SELECT name,avatar FROM room_users WHERE id=$1 LIMIT 1',[userId]);
      if (!user.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant introuvable.');
      await query(`INSERT INTO room_lobby (meeting_id,user_id,status,name,avatar) VALUES ($1,$2,'requested',$3,$4) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='requested'`, [meeting.id,userId,user.rows[0].name,user.rows[0].avatar]);
      await query(`UPDATE room_meeting_members SET status='left',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      io.to(`user:${userId}`).emit('meeting:moved-to-lobby', { meetingId: meeting.id });
      response.json({ success:true });
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/:meetingId/messages', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId=Number(request.params.meetingId);
      if (!(await hasMeetingAccess(meetingId,request.user!))) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const limit=Math.max(1,Math.min(200,Number(request.query.limit||100)));
      const result=await query(`SELECT id,meeting_id,user_id,sender,text,created_at FROM room_messages WHERE meeting_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`,[meetingId,limit]);
      response.json(result.rows.reverse().map((row)=>({id:row.id,meetingId:String(row.meeting_id),userId:row.user_id,sender:row.sender,text:row.text,time:new Date(row.created_at).toISOString()})));
    } catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/messages', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meetingId=Number(request.params.meetingId);
      if(!(await hasMeetingAccess(meetingId,request.user!))) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const message=await insertChatMessage(meetingId,request.user!,request.body?.text);
      if(!message) return sendApiError(response,400,'VALIDATION_ERROR','Message vide.');
      io.to(`meeting:${meetingId}`).emit('meeting:chat-message',message);
      response.status(201).json(message);
    }catch(error){next(error);}
  });

  app.delete('/api/meetings/:meetingId/messages/:messageId', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId));
      if(!meeting) return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      const message=await query('SELECT * FROM room_messages WHERE id=$1 AND meeting_id=$2 LIMIT 1',[request.params.messageId,meeting.id]);
      if(!message.rows[0]) return response.status(204).end();
      if(Number(message.rows[0].user_id)!==request.user!.id&&!canModerateMeeting(meeting,request.user!)) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Suppression refusée.');
      await query('UPDATE room_messages SET deleted_at=now() WHERE id=$1',[request.params.messageId]);
      io.to(`meeting:${meeting.id}`).emit('meeting:chat-deleted',{meetingId:meeting.id,messageId:request.params.messageId});
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.get('/api/meetings/:meetingId/polls', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meetingId=Number(request.params.meetingId);
      if(!(await hasMeetingAccess(meetingId,request.user!))) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const polls=await query('SELECT id FROM room_polls WHERE meeting_id=$1 ORDER BY created_at DESC',[meetingId]);
      const values: MeetingPollPayload[]=[]; for(const row of polls.rows){const poll=await getPoll(String(row.id));if(poll) values.push(poll);} response.json(values);
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/polls', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meetingId=Number(request.params.meetingId);
      if(!(await hasMeetingAccess(meetingId,request.user!))) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const question=normalizeText(request.body?.question).slice(0,300);
      const options=Array.isArray(request.body?.options)?request.body.options.map((x:unknown)=>normalizeText(x).slice(0,120)).filter(Boolean).slice(0,10):[];
      if(!question||options.length<2) return sendApiError(response,400,'VALIDATION_ERROR','Une question et au moins deux options sont requises.');
      const pollId=createId();
      await query('INSERT INTO room_polls (id,meeting_id,created_by,question) VALUES ($1,$2,$3,$4)',[pollId,meetingId,request.user!.id,question]);
      for(let index=0;index<options.length;index+=1) await query('INSERT INTO room_poll_options (id,poll_id,label,position) VALUES ($1,$2,$3,$4)',[createId(),pollId,options[index],index]);
      const poll=await getPoll(pollId); io.to(`meeting:${meetingId}`).emit('meeting:poll-updated',poll); response.status(201).json(poll);
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/polls/:pollId/vote', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meetingId=Number(request.params.meetingId);
      if(!(await hasMeetingAccess(meetingId,request.user!))) return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const poll=await getPoll(request.params.pollId); if(!poll||poll.meetingId!==meetingId) return sendApiError(response,404,'POLL_NOT_FOUND','Sondage introuvable.');
      if(!poll.isOpen) return sendApiError(response,409,'POLL_CLOSED','Ce sondage est fermé.');
      const optionId=String(request.body?.optionId||''); if(!poll.options.some((o:any)=>o.id===optionId)) return sendApiError(response,400,'VALIDATION_ERROR','Option invalide.');
      await query(`INSERT INTO room_poll_answers (poll_id,option_id,user_id) VALUES ($1,$2,$3) ON CONFLICT (poll_id,user_id) DO UPDATE SET option_id=excluded.option_id,created_at=now()`,[poll.id,optionId,request.user!.id]);
      const updated=await getPoll(poll.id); io.to(`meeting:${meetingId}`).emit('meeting:poll-updated',updated); response.json(updated);
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/polls/:pollId/close', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId)); if(!meeting||!canModerateMeeting(meeting,request.user!)) return sendApiError(response,403,'MEETING_HOST_REQUIRED','Action réservée à l’hôte.');
      await query('UPDATE room_polls SET is_open=false,closed_at=now() WHERE id=$1 AND meeting_id=$2',[request.params.pollId,meeting.id]);
      const poll=await getPoll(request.params.pollId); io.to(`meeting:${meeting.id}`).emit('meeting:poll-updated',poll); response.json(poll);
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/media-requests', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId)); if(!meeting||!canModerateMeeting(meeting,request.user!)) return sendApiError(response,403,'MEDIA_REQUEST_FORBIDDEN','Action réservée à l’hôte.');
      const targetUserId=Number(request.body?.targetUserId); const kind=request.body?.kind==='camera'?'camera':'mic'; const id=createId();
      const result=await query(`INSERT INTO room_media_requests (id,meeting_id,target_user_id,requested_by,requested_by_name,kind,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',now()) RETURNING *`,[id,meeting.id,targetUserId,request.user!.id,request.user!.name,kind]);
      io.to(`user:${targetUserId}`).emit('meeting:media-request',result.rows[0]); response.status(201).json({id,meetingId:meeting.id,targetUserId,requestedBy:request.user!.id,requestedByName:request.user!.name,kind,status:'pending',createdAt:new Date(result.rows[0].created_at).toISOString()});
    }catch(error){next(error);}
  });

  app.get('/api/meetings/:meetingId/media-requests', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId)); if(!meeting) return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      const moderator=canModerateMeeting(meeting,request.user!); const result=await query(`SELECT * FROM room_media_requests WHERE meeting_id=$1 ${moderator?'':'AND target_user_id=$2'} ORDER BY created_at DESC LIMIT 100`,moderator?[meeting.id]:[meeting.id,request.user!.id]);
      response.json(result.rows.map((row)=>({id:row.id,meetingId:Number(row.meeting_id),targetUserId:Number(row.target_user_id),requestedBy:Number(row.requested_by),requestedByName:row.requested_by_name,kind:row.kind,status:row.status,createdAt:new Date(row.created_at).toISOString(),respondedAt:row.responded_at?new Date(row.responded_at).toISOString():undefined})));
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/media-requests/:requestId/respond', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const status=request.body?.status==='accepted'?'accepted':'rejected'; const result=await query(`UPDATE room_media_requests SET status=$4,responded_at=now() WHERE id=$1 AND meeting_id=$2 AND target_user_id=$3 RETURNING *`,[request.params.requestId,Number(request.params.meetingId),request.user!.id,status]);
      if(!result.rows[0]) return sendApiError(response,404,'MEDIA_REQUEST_NOT_FOUND','Demande introuvable.');
      io.to(`user:${result.rows[0].requested_by}`).emit('meeting:media-request-responded',result.rows[0]); response.json(result.rows[0]);
    }catch(error){next(error);}
  });

  app.get('/api/meetings/:meetingId/recordings', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const meetingId=Number(request.params.meetingId);if(!(await hasMeetingAccess(meetingId,request.user!)))return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');const result=await query('SELECT * FROM room_recordings WHERE meeting_id=$1 ORDER BY created_at DESC',[meetingId]);response.json(result.rows);}catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/recordings', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const meeting=await getMeetingById(Number(request.params.meetingId));if(!meeting||!canModerateMeeting(meeting,request.user!))return sendApiError(response,403,'MEETING_HOST_REQUIRED','Seul l’hôte peut enregistrer un enregistrement serveur.');const url=String(request.body?.storageUrl||'').trim();if(!/^https:\/\//i.test(url))return sendApiError(response,400,'VALIDATION_ERROR','Une URL de stockage HTTPS réelle est requise.');const id=createId();const result=await query(`INSERT INTO room_recordings (id,meeting_id,created_by,storage_url,mime_type,size_bytes,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,meeting.id,request.user!.id,url,String(request.body?.mimeType||'video/webm'),Math.max(0,Number(request.body?.sizeBytes||0)),Math.max(0,Number(request.body?.durationSeconds||0))]);response.status(201).json(result.rows[0]);}catch(error){next(error);}
  });

  app.post('/api/ai/luna', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const meetingId=Number(request.body?.meetingId);const prompt=normalizeText(request.body?.prompt).slice(0,5000);if(!prompt)return sendApiError(response,400,'LUNA_PROMPT_REQUIRED','Message requis pour Luna IA.');if(!(await hasMeetingAccess(meetingId,request.user!)))return sendApiError(response,403,'LUNA_ACCESS_DENIED','Accès refusé.');const meeting=await getMeetingById(meetingId);const answer=await callGroq(`Tu es Luna IA, assistante de réunion MBotéRoom. Réunion: ${meeting?.title||meetingId}. Réponds en français. Ne prétends pas avoir entendu ou vu du contenu qui ne t’a pas été fourni.`,prompt);if(!answer)return response.status(503).json({error:'Luna IA n’est pas configurée ou le fournisseur est indisponible.',code:'LUNA_NOT_CONFIGURED',configured:false});response.json({answer,configured:true});}catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/summary/generate', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const meeting=await getMeetingById(Number(request.params.meetingId));if(!meeting||!canModerateMeeting(meeting,request.user!))return sendApiError(response,403,'MEETING_HOST_REQUIRED','Action réservée à l’hôte.');const summary=await generateSummary(meeting);if(!summary)return response.status(422).json({error:'Aucun transcript textuel exploitable ou Luna IA non configurée.',code:'SUMMARY_UNAVAILABLE'});response.json(summary);}catch(error){next(error);}
  });

  app.get('/api/meetings/:meetingId/breakouts', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meetingId = Number(request.params.meetingId);
      if (!(await hasMeetingAccess(meetingId, request.user!))) return sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé.');
      const rooms = await query(
        `SELECT r.id,r.meeting_id,r.name,r.is_open,r.created_at,r.updated_at,
                COALESCE(json_agg(json_build_object('userId',m.user_id,'name',u.name,'avatar',u.avatar))
                  FILTER (WHERE m.user_id IS NOT NULL),'[]'::json) AS members
           FROM room_breakout_rooms r
           LEFT JOIN room_breakout_members m ON m.breakout_room_id=r.id
           LEFT JOIN room_users u ON u.id=m.user_id
          WHERE r.meeting_id=$1
          GROUP BY r.id
          ORDER BY r.created_at,r.name`, [meetingId],
      );
      response.json(rooms.rows.map((row) => ({
        id: row.id, meetingId: Number(row.meeting_id), name: row.name, isOpen: Boolean(row.is_open),
        createdAt: row.created_at, updatedAt: row.updated_at, members: row.members || [],
      })));
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/breakouts', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const names = Array.isArray(request.body?.names)
        ? request.body.names.map((value: unknown) => normalizeText(value).slice(0, 80)).filter(Boolean).slice(0, 20)
        : [];
      if (!names.length) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Ajoutez au moins une salle de sous-groupe.');
      const created: QueryResultRow[] = [];
      for (const name of names) {
        const id = createId();
        const result = await query(
          `INSERT INTO room_breakout_rooms (id,meeting_id,name,created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
          [id, meeting.id, name, request.user!.id],
        );
        created.push(result.rows[0]);
      }
      io.to(`meeting:${meeting.id}`).emit('meeting:breakouts-updated', { meetingId: meeting.id });
      response.status(201).json(created.map((row) => ({ id: row.id, meetingId: Number(row.meeting_id), name: row.name, isOpen: row.is_open })));
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/breakouts/:breakoutId/assign', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.body?.userId);
      if (!userId || userId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Participant invalide pour une sous-salle.');
      const room = await query('SELECT * FROM room_breakout_rooms WHERE id=$1 AND meeting_id=$2 LIMIT 1', [request.params.breakoutId, meeting.id]);
      if (!room.rows[0]) return sendApiError(response, 404, 'BREAKOUT_NOT_FOUND', 'Sous-salle introuvable.');
      const member = await query(`SELECT 1 FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 AND status='accepted' LIMIT 1`, [meeting.id,userId]);
      if (!member.rows[0]) return sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable.');
      await query(
        `DELETE FROM room_breakout_members bm USING room_breakout_rooms br
          WHERE bm.breakout_room_id=br.id AND br.meeting_id=$1 AND bm.user_id=$2`, [meeting.id,userId],
      );
      await query(
        `INSERT INTO room_breakout_members (breakout_room_id,user_id,assigned_by) VALUES ($1,$2,$3)
         ON CONFLICT (breakout_room_id,user_id) DO UPDATE SET assigned_by=excluded.assigned_by,assigned_at=now(),left_at=NULL`,
        [request.params.breakoutId,userId,request.user!.id],
      );
      io.to(`user:${userId}`).emit('meeting:breakout-assigned', {
        meetingId: meeting.id, breakoutRoomId: request.params.breakoutId, breakoutRoomName: room.rows[0].name, isOpen: Boolean(room.rows[0].is_open),
      });
      io.to(`meeting:${meeting.id}`).emit('meeting:breakouts-updated', { meetingId: meeting.id });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/breakouts/open', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      await query(`UPDATE room_breakout_rooms SET is_open=true,updated_at=now() WHERE meeting_id=$1`, [meeting.id]);
      const assignments = await query(
        `SELECT bm.user_id,br.id,br.name FROM room_breakout_members bm JOIN room_breakout_rooms br ON br.id=bm.breakout_room_id WHERE br.meeting_id=$1`, [meeting.id],
      );
      for (const row of assignments.rows) {
        io.to(`user:${Number(row.user_id)}`).emit('meeting:breakout-assigned', {
          meetingId: meeting.id, breakoutRoomId: row.id, breakoutRoomName: row.name, isOpen: true,
        });
      }
      io.to(`meeting:${meeting.id}`).emit('meeting:breakouts-opened', { meetingId: meeting.id });
      response.json({ success: true, assignments: assignments.rows.length });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/breakouts/close', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const members = await query(
        `SELECT DISTINCT bm.user_id FROM room_breakout_members bm JOIN room_breakout_rooms br ON br.id=bm.breakout_room_id WHERE br.meeting_id=$1`, [meeting.id],
      );
      await query(`UPDATE room_breakout_rooms SET is_open=false,updated_at=now() WHERE meeting_id=$1`, [meeting.id]);
      for (const row of members.rows) {
        io.to(`user:${Number(row.user_id)}`).emit('meeting:breakout-assigned', {
          meetingId: meeting.id, breakoutRoomId: null, breakoutRoomName: '', isOpen: false,
        });
      }
      io.to(`meeting:${meeting.id}`).emit('meeting:breakouts-closed', { meetingId: meeting.id });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get('/api/meetings/:meetingId/ended', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await findMeetingByValue(request.params.meetingId); if(!meeting)return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.'); if(!(await hasMeetingAccess(meeting.id,request.user!)))return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const members=await query(`SELECT m.user_id,m.role,u.name,u.avatar,u.is_guest FROM room_meeting_members m JOIN room_users u ON u.id=m.user_id WHERE m.meeting_id=$1 ORDER BY m.role,u.name`,[meeting.id]);
      const summaryResult=await query('SELECT * FROM room_meeting_summaries WHERE meeting_id=$1 LIMIT 1',[meeting.id]); const summaryRow=summaryResult.rows[0];
      const startedAt=meeting.started_at||meeting.start_time; const endedAt=meeting.ended_at||new Date().toISOString(); const durationMinutes=Math.max(0,Math.round((new Date(endedAt).getTime()-new Date(startedAt).getTime())/60000));
      const recordings=await query('SELECT storage_url FROM room_recordings WHERE meeting_id=$1 ORDER BY created_at DESC LIMIT 1',[meeting.id]);
      response.json({meeting:{...meeting,settings:sanitizeMeetingSettings(meeting.settings)},publicId:String(meeting.settings.meetingAccessId||meeting.id),status:meeting.status==='ended'?'ended':'active',startedAt,endedAt,durationMinutes,timezone:meeting.settings.timeZone||'UTC',userRole:meetingRole(meeting,request.user!),participants:members.rows.map((row)=>({id:String(row.user_id),name:row.name,role:row.role==='host'?'Hôte':row.is_guest?'Invité':'Participant',avatar:row.avatar})),summary:{bullets:summaryRow?.bullets||[],decisions:summaryRow?.decisions||[],actions:summaryRow?.actions||[],nextMeeting:summaryRow?.next_meeting||'',processingStatus:summaryRow?'ready':'pending'},nextActions:[],recording:{available:Boolean(recordings.rows[0]),retentionDays:0,url:recordings.rows[0]?.storage_url||null},permissions:{canDownloadSummary:true,canShareSummary:true,canViewRecording:Boolean(recordings.rows[0]),canExportChat:true,canRate:true},guestRestrictions:Boolean(request.user!.isGuest)});
    }catch(error){next(error);}
  });

  app.get('/api/actus/events', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const result=await query(`SELECT * FROM room_meetings WHERE status<>'cancelled' ORDER BY start_time DESC LIMIT 100`);const values: ActusMeetingPayload[]=[];for(const row of result.rows){const meeting=mapMeeting(row);if(await visibleToUser(meeting,request.user!))values.push({...meeting,settings:sanitizeMeetingSettings(meeting.settings),is_public:Boolean(meeting.settings.isPublic||meeting.settings.visibility==='public'),is_invited:(meeting.settings.participants||[]).some((v)=>normalizeEmail(v)===normalizeEmail(request.user!.email)),my_lobby_status:null,relevance_reason:canModerateMeeting(meeting,request.user!)?'created_by_me':'registered'});}response.json(values);}catch(error){next(error);}
  });
};

export { insertChatMessage, getMeetingById };
