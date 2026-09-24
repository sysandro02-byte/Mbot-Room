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
  requireAccountFeature,
  requireDatabase,
  sanitizeMeetingSettings,
  sendApiError,
  validateMeetingPassword,
} from './core.js';
import { getEmailDeliveryStatus, sendTransactionalEmail } from './emailDelivery.js';
import { createNotificationAndPush } from './pushService.js';
import { isPlatformFeatureEnabled } from './platformSettings.js';
import { recordingStorageBucket, toSupabaseRecordingMarker } from './supabaseRecordingStorage.js';

const findMeetingByValue = async (value: unknown): Promise<Meeting | null> => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return null;
  const rows = await query(`SELECT * FROM room_meetings
    ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, id DESC`);
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
  const lobby = await query(
    `SELECT 1 FROM room_lobby WHERE meeting_id=$1 AND user_id=$2 AND status IN ('requested','accepted') LIMIT 1`,
    [meeting.id, user.id],
  );
  if (lobby.rows[0]) return true;
  return hasMeetingAccess(meeting.id, user);
};

const meetingRole = (meeting: Meeting, user: NonNullable<AuthedRequest['user']>) => {
  if (meeting.host_id === user.id || meeting.temporary_host_id === user.id) return 'host';
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
  const status = getEmailDeliveryStatus();
  if (!emails.length) return { configured: status.configured, sent: 0, failed: 0 };
  if (!status.configured) return { configured: false, sent: 0, failed: emails.length };

  const clientOrigin = String(process.env.MBOTE_ROOM_APP_URL || request.headers.origin || '').replace(/\/+$/, '');
  const joinUrl = `${clientOrigin}/join/${encodeURIComponent(meeting.meeting_link)}`;
  const meetingId = String(meeting.settings.meetingAccessId || meeting.id);
  const startLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(meeting.start_time));
  const passwordRow = password
    ? `<tr><td style="padding:8px 0;color:#7b879e;font-size:13px">Mot de passe de réunion</td><td align="right" style="padding:8px 0;font-weight:850;color:#24345c">${escapeHtml(password)}</td></tr>`
    : '';

  const results = await Promise.all(emails.map(async (email) => sendTransactionalEmail({
    to: email,
    subject: `Invitation MBotéRoom : ${meeting.title}`,
    text: `${meeting.host_name} vous invite à « ${meeting.title} ».
ID : ${meetingId}
Début : ${startLabel}
${password ? `Mot de passe : ${password}\n` : ''}Rejoindre : ${joinUrl}`,
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f7fc;font-family:Inter,Arial,sans-serif;color:#17213c">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fc;padding:30px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #e2e8f4;border-radius:24px;overflow:hidden;box-shadow:0 16px 48px rgba(22,34,69,.08)">
<tr><td style="padding:28px 34px;background:linear-gradient(135deg,#13224d,#3156eb 62%,#6046f4);color:#fff"><div style="font-size:25px;font-weight:850">MBoté<span style="color:#c0cbff">Room</span></div><div style="margin-top:6px;font-size:13px;opacity:.84">Invitation à une réunion sécurisée</div></td></tr>
<tr><td style="padding:34px"><div style="font-size:12px;color:#3156eb;font-weight:850;text-transform:uppercase;letter-spacing:1px">Vous êtes invité(e)</div><h1 style="margin:8px 0 10px;font-size:27px;line-height:1.2;color:#15203d">${escapeHtml(meeting.title)}</h1><p style="margin:0 0 24px;color:#68758f;line-height:1.65"><strong style="color:#26365a">${escapeHtml(meeting.host_name)}</strong> vous invite à participer à une réunion MBotéRoom.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:6px 16px;border:1px solid #e5eaf3;border-radius:14px;background:#fafcff">
<tr><td style="padding:8px 0;color:#7b879e;font-size:13px">ID de réunion</td><td align="right" style="padding:8px 0;font-weight:850;color:#24345c">${escapeHtml(meetingId)}</td></tr>
<tr><td style="padding:8px 0;color:#7b879e;font-size:13px">Début</td><td align="right" style="padding:8px 0;font-weight:850;color:#24345c">${escapeHtml(startLabel)}</td></tr>
${passwordRow}
</table>
<p style="margin:28px 0 12px"><a href="${escapeHtml(joinUrl)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#3156eb;color:#fff;text-decoration:none;font-weight:850">Rejoindre la réunion</a></p>
<p style="margin:0;color:#7b8798;font-size:12px;line-height:1.6">Vous pouvez rejoindre depuis un ordinateur, un téléphone ou une tablette. L’hôte peut utiliser une salle d’attente avant de vous admettre.</p></td></tr>
<tr><td style="padding:19px 34px;border-top:1px solid #edf1f7;background:#fafcff;color:#7a879d;font-size:12px;line-height:1.6">Ne transférez cette invitation qu’aux personnes autorisées à participer.<br>MBotéRoom est une application créée par LoukaTech.<br>© LoukaTech · MBotéRoom</td></tr>
</table></td></tr></table></body></html>`,
  })));

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

  const configuredModels = String(process.env.GROQ_MODEL || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const fallbackModels = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ];
  const models = [...new Set([...configuredModels, ...fallbackModels])];

  for (const model of models) {
    let response: Response | null = null;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 30000)),
      });
    } catch (error) {
      console.warn('Groq request failed', {
        model,
        reason: error instanceof Error ? error.message.slice(0, 240) : 'network_error',
      });
      continue;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      console.warn('Groq completion rejected', {
        model,
        status: response.status,
        code: String(payload?.error?.code || ''),
        type: String(payload?.error?.type || ''),
        message: String(payload?.error?.message || '').slice(0, 300),
      });
      continue;
    }
    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (text) return String(text).trim();
    console.warn('Groq completion returned no text', { model, status: response.status });
  }
  return null;
};

const getSummarySourceStats = async (meetingId: number) => {
  const [messages, captions] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM room_messages WHERE meeting_id=$1 AND deleted_at IS NULL`, [meetingId]),
    query(`SELECT COUNT(*)::int AS count FROM room_captions WHERE meeting_id=$1`, [meetingId]),
  ]);
  return {
    chat: Number(messages.rows[0]?.count || 0),
    captions: Number(captions.rows[0]?.count || 0),
  };
};

const generateSummary = async (meeting: Meeting) => {
  const [messages, captions] = await Promise.all([
    query(`SELECT sender,text,created_at FROM room_messages WHERE meeting_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 500`, [meeting.id]),
    query(`SELECT speaker,text,created_at FROM room_captions WHERE meeting_id=$1 ORDER BY created_at ASC LIMIT 1500`, [meeting.id]),
  ]);
  if ((!messages.rows.length && !captions.rows.length) || !process.env.GROQ_API_KEY) return null;
  const transcriptRows = [
    ...messages.rows.map((row) => ({ at: new Date(row.created_at).getTime(), line: `[Chat · ${row.sender}] ${row.text}` })),
    ...captions.rows.map((row) => ({ at: new Date(row.created_at).getTime(), line: `[Audio · ${row.speaker}] ${row.text}` })),
  ].sort((left, right) => left.at - right.at);
  const transcript = transcriptRows.map((row) => row.line).join('\n').slice(0, 50000);
  const answer = await callGroq(
    'Tu es Luna IA. Retourne UNIQUEMENT un JSON valide avec les clés bullets (string[]), decisions (string[]), actions (string[]), nextMeeting (string). N’invente rien qui ne figure pas dans le transcript.',
    `Réunion: ${meeting.title}\nTranscript de réunion (chat + transcription audio):\n${transcript}`,
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

  app.post('/api/meetings', ...protectedApi, requireAccountFeature('meetings'), async (request: AuthedRequest, response, next) => {
    try {
      if (!(await isPlatformFeatureEnabled('meetingCreationEnabled')) && request.user?.role !== 'admin') {
        return sendApiError(response,403,'MEETING_CREATION_DISABLED','La création de nouvelles réunions est temporairement désactivée.');
      }
      const title = normalizeText(request.body?.title || 'Réunion MBoté').slice(0, 160);
      const description = normalizeText(request.body?.description).slice(0, 1500);
      const start = new Date(request.body?.startTime || request.body?.start_time || Date.now());
      const duration = Math.max(15, Math.min(1440, Number(request.body?.duration || 60)));
      const { settings, invitationEmails, plainPassword } = buildSettings(request.body);
      if (request.user!.personalMeetingId && !Object.prototype.hasOwnProperty.call(request.body?.settings || {}, 'meetingAccessId')) {
        settings.meetingAccessId = request.user!.personalMeetingId;
      }
      const requestedCoHostId = Number(request.body?.coHostId || 0) || null;
      if (requestedCoHostId === request.user!.id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être son propre co-hôte.');
      if (requestedCoHostId) {
        const coHost = await query('SELECT id FROM room_users WHERE id=$1 AND is_guest=false LIMIT 1', [requestedCoHostId]);
        if (!coHost.rows[0]) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Co-hôte introuvable ou compte invité non autorisé.');
      }
      const inserted = await query(
        `INSERT INTO room_meetings
          (title,description,host_id,co_host_id,host_name,host_avatar,start_time,duration,meeting_link,is_active,settings,participant_count,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10::jsonb,1,'scheduled') RETURNING *`,
        [title, description, request.user!.id, requestedCoHostId, request.user!.name, request.user!.avatar, Number.isNaN(start.getTime()) ? new Date().toISOString() : start.toISOString(), duration, createMeetingLink(), JSON.stringify(settings)],
      );
      const meeting = mapMeeting(inserted.rows[0]);
      await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'host','accepted') ON CONFLICT DO NOTHING`, [meeting.id, request.user!.id]);
      if (meeting.co_host_id) await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'cohost','accepted') ON CONFLICT DO NOTHING`, [meeting.id, meeting.co_host_id]);
      const invitations = await sendInvitations(meeting, invitationEmails, plainPassword, request);
      io.to('admins').emit('meeting:created', { ...meeting, settings: sanitizeMeetingSettings(meeting.settings) });
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
      if (meeting.status === 'ended') return sendApiError(response, 410, 'MEETING_ENDED', 'Cette réunion est terminée.');
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

      const actorIsPrimaryHost = meeting.host_id === request.user!.id || request.user!.role === 'admin';
      const coHostChangeRequested = Object.prototype.hasOwnProperty.call(request.body || {}, 'coHostId');
      if (coHostChangeRequested && !actorIsPrimaryHost) {
        return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte principal peut changer le co-hôte.');
      }

      let nextCoHostId = Number(meeting.co_host_id || 0) || null;
      if (coHostChangeRequested) {
        nextCoHostId = Number(request.body?.coHostId || 0) || null;
        if (nextCoHostId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être son propre co-hôte.');
        if (nextCoHostId) {
          const coHost = await query('SELECT id FROM room_users WHERE id=$1 AND is_guest=false LIMIT 1', [nextCoHostId]);
          if (!coHost.rows[0]) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Co-hôte introuvable ou compte invité non autorisé.');
        }
      }

      const { settings } = buildSettings(request.body, meeting);
      const updated = await query(
        `UPDATE room_meetings SET title=$2,description=$3,start_time=$4,duration=$5,co_host_id=$6,settings=$7::jsonb,updated_at=now() WHERE id=$1 RETURNING *`,
        [meeting.id, normalizeText(request.body?.title || meeting.title).slice(0,160), normalizeText(request.body?.description ?? meeting.description).slice(0,1500), new Date(request.body?.startTime || request.body?.start_time || meeting.start_time).toISOString(), Math.max(15,Number(request.body?.duration || meeting.duration)), nextCoHostId, JSON.stringify(settings)],
      );

      const previousCoHostId = Number(meeting.co_host_id || 0) || null;
      if (coHostChangeRequested && previousCoHostId !== nextCoHostId) {
        if (previousCoHostId) {
          await query(`UPDATE room_meeting_members SET role='participant',updated_at=now() WHERE meeting_id=$1 AND user_id=$2 AND role='cohost'`, [meeting.id, previousCoHostId]);
          io.in(`user:${previousCoHostId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
          io.to(`user:${previousCoHostId}`).emit('meeting:moderation', { meetingId: meeting.id, role: 'participant' });
        }
        if (nextCoHostId) {
          await query(
            `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at)
             VALUES ($1,$2,'cohost','accepted',now())
             ON CONFLICT (meeting_id,user_id) DO UPDATE SET role='cohost',status='accepted',left_at=NULL,updated_at=now()`,
            [meeting.id, nextCoHostId],
          );
          io.in(`user:${nextCoHostId}`).socketsJoin(`meeting:${meeting.id}:moderators`);
          io.to(`user:${nextCoHostId}`).emit('meeting:moderation', { meetingId: meeting.id, role: 'cohost' });
        }
      }

      const value = publicMeeting(updated.rows[0]);
      io.to(`meeting:${meeting.id}`).emit('meeting:updated', value);
      io.to('admins').emit('meeting:updated', value);
      io.to(`meeting:${meeting.id}`).emit('meeting:presence', { meetingId: meeting.id, coHostId: nextCoHostId });
      response.json(value);
    } catch (error) { next(error); }
  });

  app.delete('/api/meetings/:meetingId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return response.status(204).end();
      if (meeting.host_id !== request.user!.id && request.user!.role !== 'admin') return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte principal peut annuler cette réunion.');
      if (meeting.status === 'live' || meeting.is_active) return sendApiError(response, 409, 'MEETING_ALREADY_LIVE', 'Une réunion en direct doit être terminée avec « Terminer pour tous ».');
      await query(`UPDATE room_meetings SET status='cancelled',is_active=false,ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1`, [meeting.id]);
      io.to(`meeting:${meeting.id}`).emit('meeting:cancelled', { meetingId: meeting.id });
      io.to('admins').emit('meeting:cancelled', { meetingId: meeting.id });
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
      if (meeting.status === 'ended' || meeting.status === 'cancelled') return sendApiError(response, 410, 'MEETING_ENDED', 'Cette réunion est terminée ou annulée.');
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
      const blockedUntilHost = !moderator && !alreadyAccepted && !hostHasStarted && meeting.settings.joinBeforeHost !== true;
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
      io.to(`meeting:${meeting.id}:moderators`).emit('meeting:lobby-updated', { meetingId: meeting.id, userId: request.user!.id, status, name: request.user!.name, avatar: request.user!.avatar });
      if (status === 'requested') {
        const moderatorIds=[meeting.host_id,meeting.co_host_id].map(Number).filter((id)=>id&&id!==request.user!.id);
        await Promise.all(moderatorIds.map(async(userId)=>{
          const notification=await createNotificationAndPush(userId,{
            type:'MEETING_LOBBY_REQUEST',
            title:'Participant en salle d’attente',
            body:`${request.user!.name || 'Un participant'} souhaite rejoindre « ${meeting.title} ».`,
            url:`/reunions/${meeting.meeting_link}`,
            tag:`meeting-lobby-${meeting.id}`,
            data:{meetingId:meeting.id,userId:request.user!.id},
          });
          io.to(`user:${userId}`).emit('notification:new',notification);
        })).catch(()=>undefined);
      }
      response.json({ success: true, status });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/lobby/respond', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'LOBBY_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut gérer la salle d’attente.');
      const userId = Number(request.body?.userId);
      const status = request.body?.status === 'rejected' ? 'rejected' : 'accepted';
      const lobbyEntry = await query('SELECT status FROM room_lobby WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id, userId]);
      if (!lobbyEntry.rows[0]) return sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable dans la salle d’attente.');
      if (status === 'accepted') {
        const existingAccepted = await query(`SELECT 1 FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 AND status='accepted' LIMIT 1`, [meeting.id, userId]);
        if (!existingAccepted.rows[0] && await acceptedMemberCount(meeting.id) >= meetingCapacity(meeting)) {
          return sendApiError(response, 409, 'MEETING_CAPACITY_REACHED', 'La capacité maximale de la réunion est atteinte.');
        }
        await query(
          `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'participant','accepted',now())
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),left_at=NULL,updated_at=now()`, [meeting.id,userId],
        );
      }
      await query('UPDATE room_lobby SET status=$3 WHERE meeting_id=$1 AND user_id=$2', [meeting.id, userId, status]);
      io.to(`user:${userId}`).emit('meeting:lobby-status', { meetingId: meeting.id, status });
      io.to(`meeting:${meeting.id}`).emit('meeting:lobby-updated', { meetingId: meeting.id, userId, status });
      const notification=await createNotificationAndPush(userId,{
        type:status==='accepted'?'MEETING_LOBBY_ACCEPTED':'MEETING_LOBBY_REJECTED',
        title:status==='accepted'?'Vous pouvez rejoindre la réunion':'Demande de participation refusée',
        body:status==='accepted'
          ? `L’hôte vous a admis dans « ${meeting.title} ».`
          : `Votre demande pour « ${meeting.title} » n’a pas été acceptée.`,
        url:status==='accepted'?`/reunions/${meeting.id}`:'/app/meetings',
        tag:`meeting-lobby-result-${meeting.id}`,
        data:{meetingId:meeting.id,status},
      }).catch(()=>null);
      if(notification)io.to(`user:${userId}`).emit('notification:new',notification);
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
          const notification=await createNotificationAndPush(userId,{
            type:'MEETING_LOBBY_ACCEPTED',
            title:'Vous pouvez rejoindre la réunion',
            body:`L’hôte vous a admis dans « ${meeting.title} ».`,
            url:`/reunions/${meeting.meeting_link}`,
            tag:`meeting-lobby-result-${meeting.id}`,
            data:{meetingId:meeting.id,status:'accepted'},
          }).catch(()=>null);
          if(notification)io.to(`user:${userId}`).emit('notification:new',notification);
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

  app.post('/api/meetings/:meetingId/restart', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const source = await getMeetingById(Number(request.params.meetingId));
      if (!source) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!canModerateMeeting(source, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut relancer cette réunion.');
      if (source.status !== 'ended' && source.status !== 'cancelled') return sendApiError(response, 409, 'MEETING_NOT_ENDED', 'Cette réunion peut déjà être démarrée normalement.');

      const now = new Date();
      const nextSettings: MeetingSettings = {
        ...source.settings,
        locked: false,
        meetingAccessId: request.user!.personalMeetingId || source.settings.meetingAccessId || createMeetingAccessId(),
      };
      const inserted = await query(
        `INSERT INTO room_meetings
          (title,description,host_id,co_host_id,host_name,host_avatar,start_time,duration,meeting_link,is_active,settings,participant_count,status,started_at,ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10::jsonb,1,'live',now(),NULL) RETURNING *`,
        [
          source.title,
          source.description,
          source.host_id,
          source.co_host_id || null,
          source.host_name,
          source.host_avatar,
          now.toISOString(),
          source.duration,
          createMeetingLink(),
          JSON.stringify(nextSettings),
        ],
      );
      const meeting = mapMeeting(inserted.rows[0]);

      const previousMembers = await query(
        `SELECT user_id,role FROM room_meeting_members
          WHERE meeting_id=$1 AND status<>'removed'
          ORDER BY CASE role WHEN 'host' THEN 0 WHEN 'cohost' THEN 1 ELSE 2 END,user_id`,
        [source.id],
      );
      const copied = new Set<number>();
      for (const row of previousMembers.rows) {
        const userId = Number(row.user_id);
        if (!userId || copied.has(userId)) continue;
        copied.add(userId);
        const role = userId === source.host_id ? 'host' : userId === Number(source.co_host_id || 0) ? 'cohost' : 'participant';
        await query(
          `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at,left_at,updated_at)
           VALUES ($1,$2,$3,'accepted',NULL,NULL,now())
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET role=excluded.role,status='accepted',left_at=NULL,updated_at=now()`,
          [meeting.id, userId, role],
        );
      }
      if (!copied.has(source.host_id)) {
        await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'host','accepted') ON CONFLICT DO NOTHING`, [meeting.id, source.host_id]);
      }
      if (source.co_host_id && !copied.has(source.co_host_id)) {
        await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status) VALUES ($1,$2,'cohost','accepted') ON CONFLICT DO NOTHING`, [meeting.id, source.co_host_id]);
      }

      const value = { ...meeting, settings: sanitizeMeetingSettings(meeting.settings) };
      io.to('admins').emit('meeting:created', value);
      io.to(`meeting:${source.id}`).emit('meeting:restarted', { sourceMeetingId: source.id, meeting: value });
      response.status(201).json({ success: true, sourceMeetingId: source.id, meeting: value });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/start-notify', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (meeting.status === 'ended' || meeting.status === 'cancelled') return sendApiError(response, 409, 'MEETING_ALREADY_ENDED', 'Cette réunion est déjà terminée ou annulée.');
      if (!canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte ou le co-hôte peut démarrer la réunion.');
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
      const members = await query(`SELECT DISTINCT user_id FROM room_meeting_members WHERE meeting_id=$1 AND user_id<>$2`, [meeting.id, request.user!.id]);
      const memberIds=members.rows.map((row)=>Number(row.user_id)).filter(Boolean);
      const value = publicMeeting(updated.rows[0]);
      io.to(`meeting:${meeting.id}`).emit('meeting:started', value);
      io.to('admins').emit('meeting:started', value);
      await Promise.all(memberIds.map(async(userId)=>{
        const notification=await createNotificationAndPush(userId,{
          type:'MEETING_STARTED',
          title:'La réunion a commencé',
          body:`« ${meeting.title} » est maintenant en direct.`,
          url:`/reunions/${meeting.meeting_link}`,
          tag:`meeting-started-${meeting.id}`,
          data:{meetingId:meeting.id},
        }).catch(()=>null);
        if(notification)io.to(`user:${userId}`).emit('notification:new',notification);
      }));
      response.json({ success: true, notifiedCount: memberIds.length, meeting: value });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/end', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (meeting.host_id !== request.user!.id && meeting.temporary_host_id !== request.user!.id && request.user!.role !== 'admin') return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte actif peut terminer la réunion pour tout le monde.');
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
          WHERE meeting_id=$1 AND status='accepted' AND role NOT IN ('host','cohost')
          RETURNING user_id`,
        [meeting.id],
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
      const actorIsPrimaryHost = meeting.host_id === request.user!.id || request.user!.role === 'admin';
      const target = await query(
        `SELECT role,status FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1`,
        [meeting.id, userId],
      );
      if (!target.rows[0]) return sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable.');
      if (target.rows[0].role === 'host') return sendApiError(response, 400, 'VALIDATION_ERROR', 'Le rôle de l’hôte principal ne peut pas être modifié.');
      if (!actorIsPrimaryHost && target.rows[0].role === 'cohost') {
        return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte principal peut gérer le rôle d’un co-hôte.');
      }

      const role = ['cohost','participant'].includes(request.body?.role) ? request.body.role : null;
      if (role && !actorIsPrimaryHost) {
        return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte principal peut nommer ou retirer un co-hôte.');
      }

      const muted = typeof request.body?.mutedByHost === 'boolean' ? request.body.mutedByHost : null;
      const cameraDisabled = typeof request.body?.cameraDisabledByHost === 'boolean' ? request.body.cameraDisabledByHost : null;

      if (role === 'cohost') {
        const previousCoHostId = Number(meeting.co_host_id || 0);
        if (previousCoHostId && previousCoHostId !== userId) {
          await query(
            `UPDATE room_meeting_members SET role='participant',updated_at=now() WHERE meeting_id=$1 AND user_id=$2 AND role='cohost'`,
            [meeting.id, previousCoHostId],
          );
          io.in(`user:${previousCoHostId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
          io.to(`user:${previousCoHostId}`).emit('meeting:moderation', { meetingId: meeting.id, role: 'participant' });
        }
        await query('UPDATE room_meetings SET co_host_id=$2,updated_at=now() WHERE id=$1', [meeting.id, userId]);
        io.in(`user:${userId}`).socketsJoin(`meeting:${meeting.id}:moderators`);
      } else if (role === 'participant' && Number(meeting.co_host_id || 0) === userId) {
        await query('UPDATE room_meetings SET co_host_id=NULL,updated_at=now() WHERE id=$1', [meeting.id]);
        io.in(`user:${userId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
      }

      const updated = await query(
        `UPDATE room_meeting_members SET
          role=COALESCE($3,role), muted_by_host=COALESCE($4,muted_by_host), camera_disabled_by_host=COALESCE($5,camera_disabled_by_host), updated_at=now()
         WHERE meeting_id=$1 AND user_id=$2 RETURNING *`, [meeting.id,userId,role,muted,cameraDisabled],
      );
      io.to(`user:${userId}`).emit('meeting:moderation', { meetingId: meeting.id, mutedByHost: updated.rows[0].muted_by_host, cameraDisabledByHost: updated.rows[0].camera_disabled_by_host, role: updated.rows[0].role });
      if (role) {
        const refreshedMeeting = await getMeetingById(meeting.id);
        if (refreshedMeeting) io.to(`meeting:${meeting.id}`).emit('meeting:updated', { ...refreshedMeeting, settings: sanitizeMeetingSettings(refreshedMeeting.settings) });
      }
      io.to(`meeting:${meeting.id}`).emit('meeting:presence', { meetingId: meeting.id, roleChangedUserId: role ? userId : undefined });
      response.json(updated.rows[0]);
    } catch (error) { next(error); }
  });

  app.delete('/api/meetings/:meetingId/participants/:userId', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      if (userId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être retiré.');
      const target = await query('SELECT role FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id,userId]);
      if (!target.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant introuvable.');
      const actorIsPrimaryHost = meeting.host_id === request.user!.id || request.user!.role === 'admin';
      if (target.rows[0].role === 'cohost' && !actorIsPrimaryHost) return sendApiError(response,403,'MEETING_HOST_REQUIRED','Seul l’hôte principal peut retirer un co-hôte.');
      if (Number(meeting.co_host_id || 0) === userId) {
        await query('UPDATE room_meetings SET co_host_id=NULL,updated_at=now() WHERE id=$1', [meeting.id]);
        io.in(`user:${userId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
        const refreshedMeeting = await getMeetingById(meeting.id);
        if (refreshedMeeting) io.to(`meeting:${meeting.id}`).emit('meeting:updated', { ...refreshedMeeting, settings: sanitizeMeetingSettings(refreshedMeeting.settings) });
      }
      await query(`UPDATE room_meeting_members SET role='participant',status='removed',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      await query(`UPDATE room_lobby SET status='rejected' WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      io.to(`user:${userId}`).emit('meeting:removed', { meetingId: meeting.id });
      io.to(`meeting:${meeting.id}`).emit('meeting:presence', { meetingId: meeting.id, removedUserId: userId });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/participants/:userId/ban', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      if (userId === meeting.host_id) return sendApiError(response, 400, 'VALIDATION_ERROR', 'L’hôte principal ne peut pas être banni.');
      const target = await query('SELECT role FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id,userId]);
      if (!target.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant introuvable.');
      const actorIsPrimaryHost = meeting.host_id === request.user!.id || request.user!.role === 'admin';
      if (target.rows[0].role === 'cohost' && !actorIsPrimaryHost) return sendApiError(response,403,'MEETING_HOST_REQUIRED','Seul l’hôte principal peut bannir un co-hôte.');
      if (Number(meeting.co_host_id || 0) === userId) {
        await query('UPDATE room_meetings SET co_host_id=NULL,updated_at=now() WHERE id=$1', [meeting.id]);
        io.in(`user:${userId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
        const refreshedMeeting = await getMeetingById(meeting.id);
        if (refreshedMeeting) io.to(`meeting:${meeting.id}`).emit('meeting:updated', { ...refreshedMeeting, settings: sanitizeMeetingSettings(refreshedMeeting.settings) });
      }
      await query(`INSERT INTO room_meeting_bans (meeting_id,user_id,banned_by,reason) VALUES ($1,$2,$3,$4) ON CONFLICT (meeting_id,user_id) DO UPDATE SET banned_by=excluded.banned_by,reason=excluded.reason,created_at=now()`, [meeting.id,userId,request.user!.id,normalizeText(request.body?.reason).slice(0,500)]);
      await query(`UPDATE room_meeting_members SET role='participant',status='removed',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
      io.to(`user:${userId}`).emit('meeting:banned', { meetingId: meeting.id });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.post('/api/meetings/:meetingId/participants/:userId/move-to-lobby', ...protectedApi, async (request: AuthedRequest, response, next) => {
    try {
      const meeting = await getMeetingById(Number(request.params.meetingId));
      if (!meeting || !canModerateMeeting(meeting, request.user!)) return sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Action réservée à l’hôte ou au co-hôte.');
      const userId = Number(request.params.userId);
      if (userId === meeting.host_id) return sendApiError(response,400,'VALIDATION_ERROR','L’hôte principal ne peut pas être placé en salle d’attente.');
      const target = await query('SELECT role FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 LIMIT 1', [meeting.id,userId]);
      if (!target.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant introuvable.');
      const actorIsPrimaryHost = meeting.host_id === request.user!.id || request.user!.role === 'admin';
      if (target.rows[0].role === 'cohost' && !actorIsPrimaryHost) return sendApiError(response,403,'MEETING_HOST_REQUIRED','Seul l’hôte principal peut déplacer un co-hôte en salle d’attente.');
      if (Number(meeting.co_host_id || 0) === userId) {
        await query('UPDATE room_meetings SET co_host_id=NULL,updated_at=now() WHERE id=$1', [meeting.id]);
        io.in(`user:${userId}`).socketsLeave(`meeting:${meeting.id}:moderators`);
        const refreshedMeeting = await getMeetingById(meeting.id);
        if (refreshedMeeting) io.to(`meeting:${meeting.id}`).emit('meeting:updated', { ...refreshedMeeting, settings: sanitizeMeetingSettings(refreshedMeeting.settings) });
      }
      const user = await query('SELECT name,avatar FROM room_users WHERE id=$1 LIMIT 1',[userId]);
      if (!user.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant introuvable.');
      await query(`INSERT INTO room_lobby (meeting_id,user_id,status,name,avatar) VALUES ($1,$2,'requested',$3,$4) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='requested'`, [meeting.id,userId,user.rows[0].name,user.rows[0].avatar]);
      await query(`UPDATE room_meeting_members SET role='participant',status='left',left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`, [meeting.id,userId]);
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
      const meeting=await getMeetingById(meetingId);
      if(!meeting) return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      if(request.user!.isGuest && !(await isPlatformFeatureEnabled('guestChatEnabled'))) return sendApiError(response,403,'GUEST_CHAT_DISABLED','Les invités ne sont pas autorisés à envoyer des messages.');
      if(meeting.settings.chat===false) return sendApiError(response,403,'MEETING_CHAT_DISABLED','Le chat est désactivé pour cette réunion.');
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
      const meeting=await getMeetingById(meetingId);
      if(!meeting||!canModerateMeeting(meeting,request.user!)) return sendApiError(response,403,'MEETING_HOST_REQUIRED','Seul l’hôte ou le co-hôte peut créer un sondage.');
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
      const meeting=await getMeetingById(Number(request.params.meetingId)); if(!meeting||!canModerateMeeting(meeting,request.user!)) return sendApiError(response,403,'MEDIA_REQUEST_FORBIDDEN','Action réservée à l’hôte ou au co-hôte.');
      const targetUserId=Number(request.body?.targetUserId); const kind=request.body?.kind==='camera'?'camera':'mic'; const id=createId();
      if(!targetUserId||targetUserId===request.user!.id) return sendApiError(response,400,'VALIDATION_ERROR','Participant cible invalide.');
      const target=await query(`SELECT 1 FROM room_meeting_members WHERE meeting_id=$1 AND user_id=$2 AND status='accepted' LIMIT 1`,[meeting.id,targetUserId]);
      if(!target.rows[0]) return sendApiError(response,404,'PARTICIPANT_NOT_FOUND','Participant cible introuvable dans la réunion.');
      const result=await query(`INSERT INTO room_media_requests (id,meeting_id,target_user_id,requested_by,requested_by_name,kind,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',now()) RETURNING *`,[id,meeting.id,targetUserId,request.user!.id,request.user!.name,kind]);
      const payload={id,meetingId:meeting.id,targetUserId,requestedBy:request.user!.id,requestedByName:request.user!.name,kind,status:'pending',createdAt:new Date(result.rows[0].created_at).toISOString()};
      io.to(`user:${targetUserId}`).emit('meeting:media-request',payload); response.status(201).json(payload);
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
      const status=request.body?.status==='accepted'?'accepted':'rejected'; const result=await query(`UPDATE room_media_requests SET status=$4,responded_at=now() WHERE id=$1 AND meeting_id=$2 AND target_user_id=$3 AND status='pending' RETURNING *`,[request.params.requestId,Number(request.params.meetingId),request.user!.id,status]);
      if(!result.rows[0]) return sendApiError(response,404,'MEDIA_REQUEST_NOT_FOUND','Demande introuvable.');
      const row=result.rows[0];
      const payload={id:row.id,meetingId:Number(row.meeting_id),targetUserId:Number(row.target_user_id),requestedBy:Number(row.requested_by),requestedByName:row.requested_by_name,kind:row.kind,status:row.status,createdAt:new Date(row.created_at).toISOString(),respondedAt:row.responded_at?new Date(row.responded_at).toISOString():undefined};
      io.to(`user:${row.requested_by}`).emit('meeting:media-request-responded',payload); response.json(payload);
    }catch(error){next(error);}
  });

  app.get('/api/meetings/:meetingId/recordings', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const meetingId=Number(request.params.meetingId);if(!(await hasMeetingAccess(meetingId,request.user!)))return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');const result=await query('SELECT * FROM room_recordings WHERE meeting_id=$1 ORDER BY created_at DESC',[meetingId]);response.json(result.rows);}catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/recordings', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId));
      if(!meeting)return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      if(!(await isPlatformFeatureEnabled('recordingEnabled'))&&request.user!.role!=='admin')return sendApiError(response,403,'RECORDING_DISABLED','L’enregistrement est temporairement désactivé.');
      if(request.user!.isGuest&&!(await isPlatformFeatureEnabled('guestRecordingEnabled')))return sendApiError(response,403,'GUEST_RECORDING_DISABLED','Les invités ne sont pas autorisés à enregistrer une réunion.');
      const canRecord=canModerateMeeting(meeting,request.user!)
        || (meeting.settings.recording===true && await hasMeetingAccess(meeting.id,request.user!));
      if(!canRecord)return sendApiError(response,403,'RECORDING_ACCESS_DENIED','Vous n’êtes pas autorisé à enregistrer cette réunion.');

      const mimeType=String(request.body?.mimeType||'video/webm').split(';')[0].trim().toLowerCase();
      const sizeBytes=Math.max(0,Number(request.body?.sizeBytes||0));
      const durationSeconds=Math.max(0,Number(request.body?.durationSeconds||0));
      const storagePath=String(request.body?.storagePath||'').trim().replace(/^\/+/, '');
      const externalUrl=String(request.body?.storageUrl||'').trim();

      let storageUrl='';
      let provider='manual';
      if(storagePath){
        const expectedPrefix=`users/${request.user!.id}/meetings/${meeting.id}/`;
        if(!storagePath.startsWith(expectedPrefix)||storagePath.includes('..')){
          return sendApiError(response,400,'RECORDING_STORAGE_PATH_INVALID','Chemin Supabase invalide.');
        }
        storageUrl=toSupabaseRecordingMarker(recordingStorageBucket(),storagePath);
        provider='supabase';
      }else if(/^https:\/\//i.test(externalUrl)){
        storageUrl=externalUrl;
      }else{
        return sendApiError(response,400,'VALIDATION_ERROR','Un enregistrement Supabase ou une URL HTTPS réelle est requis.');
      }

      const id=createId();
      const result=await query(
        `INSERT INTO room_recordings
          (id,meeting_id,created_by,storage_url,mime_type,size_bytes,duration_seconds,provider,status,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready',$9::jsonb)
         RETURNING *`,
        [
          id,meeting.id,request.user!.id,storageUrl,mimeType,sizeBytes,durationSeconds,provider,
          JSON.stringify({storage:provider==='supabase'?'supabase':'external',storagePath:provider==='supabase'?storagePath:''}),
        ],
      );
      response.status(201).json(result.rows[0]);
    }catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/luna/catch-up', ...protectedApi, requireAccountFeature('luna'), async (request:AuthedRequest,response,next)=>{
    try{
      const meetingId=Number(request.params.meetingId);
      const minutes=Math.max(5,Math.min(45,Number(request.body?.minutes||15)));
      if(!(await hasMeetingAccess(meetingId,request.user!)))return sendApiError(response,403,'LUNA_ACCESS_DENIED','Accès refusé.');
      if(request.user!.isGuest&&!(await isPlatformFeatureEnabled('guestLunaEnabled')))return sendApiError(response,403,'GUEST_LUNA_DISABLED','Luna IA n’est pas autorisée pour les invités.');
      const meeting=await getMeetingById(meetingId);
      if(!meeting)return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      if(meeting.settings.lunaSummary===false&&!canModerateMeeting(meeting,request.user!))return sendApiError(response,403,'LUNA_DISABLED','Luna est désactivée pour les participants de cette réunion.');
      const since=new Date(Date.now()-minutes*60_000).toISOString();
      const moderator=canModerateMeeting(meeting,request.user!);
      const [messages,captions]=await Promise.all([
        query(`SELECT sender,text,created_at FROM room_messages WHERE meeting_id=$1 AND deleted_at IS NULL AND created_at>=$2 ORDER BY created_at ASC LIMIT 250`,[meetingId,since]),
        moderator
          ? query(`SELECT speaker,text,created_at FROM room_captions WHERE meeting_id=$1 AND created_at>=$2 ORDER BY created_at ASC LIMIT 900`,[meetingId,since])
          : query(
              `SELECT c.speaker,c.text,c.created_at
                 FROM room_captions c
                WHERE c.meeting_id=$1
                  AND c.created_at>=$2
                  AND (
                    c.breakout_room_id IS NULL
                    OR EXISTS (
                      SELECT 1
                        FROM room_breakout_members bm
                        JOIN room_breakout_rooms br ON br.id=bm.breakout_room_id
                       WHERE bm.breakout_room_id=c.breakout_room_id
                         AND bm.user_id=$3
                         AND br.meeting_id=$1
                    )
                  )
                ORDER BY c.created_at ASC
                LIMIT 900`,
              [meetingId,since,request.user!.id],
            ),
      ]);
      const rows=[
        ...messages.rows.map((row)=>({at:new Date(row.created_at).getTime(),line:`[Chat · ${row.sender}] ${row.text}`})),
        ...captions.rows.map((row)=>({at:new Date(row.created_at).getTime(),line:`[Audio · ${row.speaker}] ${row.text}`})),
      ].sort((a,b)=>a.at-b.at);
      if(!rows.length){
        response.json({available:false,minutes,reason:'Pas encore assez de contenu transcrit pour créer un rattrapage.',generatedAt:new Date().toISOString()});
        return;
      }
      const transcript=rows.map((row)=>row.line).join('\n').slice(-48000);
      const answer=await callGroq(
        'Tu es Luna IA dans MBotéRoom. Tu crées un rattrapage PRIVÉ pour une personne qui rejoint une réunion en retard. Retourne UNIQUEMENT un JSON valide: {"headline":string,"brief":string,"keyPoints":string[],"decisions":string[],"actions":string[],"openQuestions":string[]}. Sois très concis, factuel, sans inventer, et ne révèle aucune information absente du transcript.',
        `Réunion: ${meeting.title}\nFenêtre analysée: les ${minutes} dernières minutes.\nTranscript:\n${transcript}`,
      );
      let parsed:any=null;
      if(answer){
        try{
          const match=answer.match(/\{[\s\S]*\}/);
          parsed=JSON.parse(match?.[0]||answer);
        }catch{}
      }
      const fallbackLines=rows.slice(-6).map((row)=>row.line.replace(/^\[[^\]]+\]\s*/, '').slice(0,220));
      const payload={
        available:true,
        private:true,
        minutes,
        headline:String(parsed?.headline||'Rattrapage express'),
        brief:String(parsed?.brief||'Voici les derniers éléments disponibles de la réunion.'),
        keyPoints:Array.isArray(parsed?.keyPoints)?parsed.keyPoints.slice(0,5).map(String):fallbackLines.slice(-4),
        decisions:Array.isArray(parsed?.decisions)?parsed.decisions.slice(0,4).map(String):[],
        actions:Array.isArray(parsed?.actions)?parsed.actions.slice(0,4).map(String):[],
        openQuestions:Array.isArray(parsed?.openQuestions)?parsed.openQuestions.slice(0,3).map(String):[],
        sources:{chat:messages.rows.length,captions:captions.rows.length},
        generatedAt:new Date().toISOString(),
      };
      response.json(payload);
    }catch(error){next(error);}
  });

  app.post('/api/ai/luna', ...protectedApi, requireAccountFeature('luna'), async (request:AuthedRequest,response,next)=>{
    try{if(!(await isPlatformFeatureEnabled('lunaEnabled'))&&request.user?.role!=='admin')return sendApiError(response,403,'LUNA_DISABLED','Luna est temporairement indisponible.');if(request.user!.isGuest&&!(await isPlatformFeatureEnabled('guestLunaEnabled')))return sendApiError(response,403,'GUEST_LUNA_DISABLED','Luna IA n’est pas autorisée pour les invités.');const meetingId=Number(request.body?.meetingId);const prompt=normalizeText(request.body?.prompt).slice(0,5000);if(!prompt)return sendApiError(response,400,'LUNA_PROMPT_REQUIRED','Message requis pour Luna IA.');if(!(await hasMeetingAccess(meetingId,request.user!)))return sendApiError(response,403,'LUNA_ACCESS_DENIED','Accès refusé.');const meeting=await getMeetingById(meetingId);if(!meeting)return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');if(meeting.settings.lunaSummary===false&&!canModerateMeeting(meeting,request.user!))return sendApiError(response,403,'LUNA_DISABLED','Luna est désactivée pour les participants de cette réunion.');const answer=await callGroq(`Tu es Luna IA, assistante de réunion MBotéRoom. Réunion: ${meeting?.title||meetingId}. Réponds en français. Ne prétends pas avoir entendu ou vu du contenu qui ne t’a pas été fourni.`,prompt);if(!answer)return response.status(503).json({error:'Luna IA n’est pas configurée ou le fournisseur est indisponible.',code:'LUNA_NOT_CONFIGURED',configured:false});response.json({answer,configured:true});}catch(error){next(error);}
  });

  app.post('/api/meetings/:meetingId/summary/generate', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{
      const meeting=await getMeetingById(Number(request.params.meetingId));
      if(!meeting||!canModerateMeeting(meeting,request.user!))return sendApiError(response,403,'MEETING_HOST_REQUIRED','Action réservée à l’hôte.');
      if(!String(process.env.GROQ_API_KEY||'').trim()){
        return sendApiError(response,503,'LUNA_NOT_CONFIGURED','Luna est momentanément indisponible pour générer ce résumé.');
      }
      const sourceCounts=await getSummarySourceStats(meeting.id);
      if(sourceCounts.chat+sourceCounts.captions===0){
        return sendApiError(response,409,'SUMMARY_SOURCE_EMPTY','Aucune transcription audio ni aucun message n’a été enregistré pendant cette réunion.');
      }
      const summary=await generateSummary(meeting);
      if(!summary){
        return sendApiError(response,502,'SUMMARY_GENERATION_FAILED','Luna n’a pas pu générer le résumé pour le moment. Réessayez dans quelques instants.');
      }
      response.json({...summary,sourceCounts});
    }catch(error){next(error);}
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
      const meeting=await findMeetingByValue(request.params.meetingId);
      if(!meeting)return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      if(!(await hasMeetingAccess(meeting.id,request.user!)))return sendApiError(response,403,'MEETING_ACCESS_DENIED','Accès refusé.');
      const [members,summaryResult,recordings,sourceCounts]=await Promise.all([
        query(`SELECT m.user_id,m.role,u.name,u.avatar,u.is_guest FROM room_meeting_members m JOIN room_users u ON u.id=m.user_id WHERE m.meeting_id=$1 ORDER BY m.role,u.name`,[meeting.id]),
        query('SELECT * FROM room_meeting_summaries WHERE meeting_id=$1 LIMIT 1',[meeting.id]),
        query('SELECT storage_url FROM room_recordings WHERE meeting_id=$1 ORDER BY created_at DESC LIMIT 1',[meeting.id]),
        getSummarySourceStats(meeting.id),
      ]);
      const summaryRow=summaryResult.rows[0];
      const lunaConfigured=Boolean(String(process.env.GROQ_API_KEY||'').trim());
      const processingStatus=summaryRow
        ? 'ready'
        : sourceCounts.chat+sourceCounts.captions===0
          ? 'empty'
          : lunaConfigured
            ? 'pending'
            : 'unavailable';
      const startedAt=meeting.started_at||meeting.start_time;
      const endedAt=meeting.ended_at||new Date().toISOString();
      const durationMinutes=Math.max(0,Math.round((new Date(endedAt).getTime()-new Date(startedAt).getTime())/60000));
      response.json({
        meeting:{...meeting,settings:sanitizeMeetingSettings(meeting.settings)},
        publicId:String(meeting.settings.meetingAccessId||meeting.id),
        status:meeting.status==='ended'?'ended':'active',
        startedAt,
        endedAt,
        durationMinutes,
        timezone:meeting.settings.timeZone||'UTC',
        userRole:meetingRole(meeting,request.user!),
        participants:members.rows.map((row)=>({id:String(row.user_id),name:row.name,role:row.role==='host'?'Hôte':row.role==='cohost'?'Co-hôte':row.is_guest?'Invité':'Participant',avatar:row.avatar})),
        summary:{
          bullets:summaryRow?.bullets||[],
          decisions:summaryRow?.decisions||[],
          actions:summaryRow?.actions||[],
          nextMeeting:summaryRow?.next_meeting||'',
          processingStatus,
          sourceCounts,
          lunaConfigured,
        },
        nextActions:[],
        recording:{available:Boolean(recordings.rows[0]),retentionDays:0,url:recordings.rows[0]?.storage_url||null},
        permissions:{canDownloadSummary:true,canShareSummary:true,canViewRecording:Boolean(recordings.rows[0]),canExportChat:true,canRate:true},
        guestRestrictions:Boolean(request.user!.isGuest),
      });
    }catch(error){next(error);}
  });

  app.get('/api/actus/events', ...protectedApi, async (request:AuthedRequest,response,next)=>{
    try{const result=await query(`SELECT * FROM room_meetings WHERE status<>'cancelled' ORDER BY start_time DESC LIMIT 100`);const values: ActusMeetingPayload[]=[];for(const row of result.rows){const meeting=mapMeeting(row);if(await visibleToUser(meeting,request.user!))values.push({...meeting,settings:sanitizeMeetingSettings(meeting.settings),is_public:Boolean(meeting.settings.isPublic||meeting.settings.visibility==='public'),is_invited:(meeting.settings.participants||[]).some((v)=>normalizeEmail(v)===normalizeEmail(request.user!.email)),my_lobby_status:null,relevance_reason:canModerateMeeting(meeting,request.user!)?'created_by_me':'registered'});}response.json(values);}catch(error){next(error);}
  });
};

export { insertChatMessage, getMeetingById };
