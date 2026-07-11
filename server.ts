import dotenv from 'dotenv';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Server } from 'socket.io';

dotenv.config();

type MeetingSettings = {
  callType?: 'video' | 'audio';
  coverImage?: string;
  timeZone?: string;
  participants?: string[];
  participantCapacity?: number;
  meetingAccessId?: string;
  waitingRoom?: boolean;
  participantAudio?: boolean;
  participantVideo?: boolean;
  screenShare?: boolean;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  encryption?: boolean;
  joinBeforeHost?: boolean;
  chat?: boolean;
  reactions?: boolean;
  recording?: boolean;
  lunaSummary?: boolean;
  linkSharing?: boolean;
  externalAccess?: boolean;
};

type Meeting = {
  id: number;
  title: string;
  description: string;
  host_id: number;
  co_host_id?: number;
  host_name: string;
  host_avatar: string;
  start_time: string;
  duration: number;
  meeting_link: string;
  is_active: boolean;
  settings: MeetingSettings;
  participant_count: number;
};

type LobbyParticipant = {
  meeting_id: number;
  user_id: number;
  status: 'requested' | 'accepted' | 'rejected';
  name: string;
  avatar: string;
};

type MediaRequest = {
  id: string;
  meetingId: number;
  targetUserId: number;
  requestedBy: number;
  requestedByName: string;
  kind: 'mic' | 'camera';
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  respondedAt?: string;
};

type User = {
  id: number;
  name: string;
  username: string;
  email: string;
  avatar: string;
  passwordHash: string;
  passwordSalt: string;
  isGuest?: boolean;
  createdAt: string;
};

type PublicUser = Omit<User, 'passwordHash' | 'passwordSalt'>;

type Session = {
  tokenHash: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
};

type DatabaseState = {
  users: User[];
  meetings: Meeting[];
  lobby: LobbyParticipant[];
  mediaRequests: MediaRequest[];
  sessions: Session[];
  nextUserId: number;
  nextMeetingId: number;
};

type RoomUserRow = {
  id: number;
  name: string;
  username: string;
  email: string;
  avatar: string;
  password_hash: string;
  password_salt: string;
  is_guest: boolean;
  created_at: string;
};

type RoomMeetingRow = {
  id: number;
  title: string;
  description: string;
  host_id: number;
  co_host_id: number | null;
  host_name: string;
  host_avatar: string;
  start_time: string;
  duration: number;
  meeting_link: string;
  is_active: boolean;
  settings: MeetingSettings | string;
  participant_count: number;
};

type RoomLobbyRow = LobbyParticipant;

type RoomMediaRequestRow = {
  id: string;
  meeting_id: number;
  target_user_id: number;
  requested_by: number;
  requested_by_name: string;
  kind: 'mic' | 'camera';
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  responded_at: string | null;
};

type RoomSessionRow = {
  token_hash: string;
  user_id: number;
  created_at: string;
  expires_at: string;
};

type LunaTone = 'professional' | 'casual' | 'creative';

type AuthedRequest = express.Request & {
  user?: PublicUser;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'mbote-room-db.json');
const databaseUrl = process.env.DATABASE_URL;
const pgPool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

const users = new Map<number, User>();
const sessions = new Map<string, Session>();
const meetings = new Map<number, Meeting>();
const lobby = new Map<number, LobbyParticipant[]>();
const mediaRequests = new Map<number, MediaRequest[]>();
const meetingParticipants = new Map<string, Map<string, {
  socketId: string;
  userId: string;
  name: string;
  avatar: string;
  media: { audio: boolean; video: boolean; screen: boolean };
}>>();

let nextUserId = 1;
let nextMeetingId = 1;
let databaseMode: 'postgres' | 'local-json' = 'local-json';

const demoUsers = [
  { id: '2', name: 'Amina Louka', username: 'amina', avatar: 'https://ui-avatars.com/api/?name=Amina+Louka&background=0f766e&color=fff' },
  { id: '3', name: 'Darel Mbote', username: 'darel', avatar: 'https://ui-avatars.com/api/?name=Darel+Mbote&background=7c3aed&color=fff' },
  { id: '4', name: 'Sarah Tech', username: 'sarah', avatar: 'https://ui-avatars.com/api/?name=Sarah+Tech&background=be185d&color=fff' },
];

const getPublicUser = (user: User): PublicUser => {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...publicUser } = user;
  return publicUser;
};

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const createAvatar = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'MBoté')}&background=7c3aed&color=fff&bold=true`;

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});

const verifyPassword = (password: string, user: User) => {
  const { hash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
};

const createToken = () => crypto.randomBytes(32).toString('base64url');

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const getBearerToken = (request: express.Request) => {
  const header = request.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getUserByToken = (token: unknown) => {
  const rawToken = String(token || '');
  const session = rawToken ? sessions.get(hashToken(rawToken)) : null;
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = users.get(session.userId);
  return user ? getPublicUser(user) : null;
};

const runRoomMigrations = async () => {
  if (!pgPool) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS room_users (
      id integer PRIMARY KEY,
      name text NOT NULL,
      username text NOT NULL,
      email text NOT NULL UNIQUE,
      avatar text NOT NULL DEFAULT '',
      password_hash text NOT NULL DEFAULT '',
      password_salt text NOT NULL DEFAULT '',
      is_guest boolean NOT NULL DEFAULT false,
      created_at text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_sessions (
      token_hash text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at text NOT NULL,
      expires_at text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_meetings (
      id integer PRIMARY KEY,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      host_id integer NOT NULL,
      co_host_id integer,
      host_name text NOT NULL,
      host_avatar text NOT NULL DEFAULT '',
      start_time text NOT NULL,
      duration integer NOT NULL,
      meeting_link text NOT NULL UNIQUE,
      is_active boolean NOT NULL DEFAULT false,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      participant_count integer NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS room_lobby (
      meeting_id integer NOT NULL,
      user_id integer NOT NULL,
      status text NOT NULL CHECK (status IN ('requested', 'accepted', 'rejected')),
      name text NOT NULL,
      avatar text NOT NULL DEFAULT '',
      PRIMARY KEY (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_media_requests (
      id text PRIMARY KEY,
      meeting_id integer NOT NULL,
      target_user_id integer NOT NULL,
      requested_by integer NOT NULL,
      requested_by_name text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('mic', 'camera')),
      status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_at text NOT NULL,
      responded_at text
    );
  `);
};

const parseSettings = (settings: RoomMeetingRow['settings']): MeetingSettings => {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      return JSON.parse(settings) as MeetingSettings;
    } catch {
      return {};
    }
  }
  return settings;
};

const savePostgresDatabase = async () => {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM room_media_requests');
    await client.query('DELETE FROM room_lobby');
    await client.query('DELETE FROM room_sessions');
    await client.query('DELETE FROM room_meetings');
    await client.query('DELETE FROM room_users');

    for (const user of users.values()) {
      await client.query(
        `INSERT INTO room_users
          (id, name, username, email, avatar, password_hash, password_salt, is_guest, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          user.name,
          user.username,
          user.email,
          user.avatar,
          user.passwordHash,
          user.passwordSalt,
          Boolean(user.isGuest),
          user.createdAt,
        ],
      );
    }

    for (const meeting of meetings.values()) {
      await client.query(
        `INSERT INTO room_meetings
          (id, title, description, host_id, co_host_id, host_name, host_avatar, start_time, duration, meeting_link, is_active, settings, participant_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
        [
          meeting.id,
          meeting.title,
          meeting.description,
          meeting.host_id,
          meeting.co_host_id || null,
          meeting.host_name,
          meeting.host_avatar,
          meeting.start_time,
          meeting.duration,
          meeting.meeting_link,
          meeting.is_active,
          JSON.stringify(meeting.settings || {}),
          meeting.participant_count,
        ],
      );
    }

    for (const participant of [...lobby.values()].flat()) {
      await client.query(
        `INSERT INTO room_lobby (meeting_id, user_id, status, name, avatar)
         VALUES ($1, $2, $3, $4, $5)`,
        [participant.meeting_id, participant.user_id, participant.status, participant.name, participant.avatar],
      );
    }

    for (const mediaRequest of [...mediaRequests.values()].flat()) {
      await client.query(
        `INSERT INTO room_media_requests
          (id, meeting_id, target_user_id, requested_by, requested_by_name, kind, status, created_at, responded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          mediaRequest.id,
          mediaRequest.meetingId,
          mediaRequest.targetUserId,
          mediaRequest.requestedBy,
          mediaRequest.requestedByName,
          mediaRequest.kind,
          mediaRequest.status,
          mediaRequest.createdAt,
          mediaRequest.respondedAt || null,
        ],
      );
    }

    for (const session of sessions.values()) {
      await client.query(
        `INSERT INTO room_sessions (token_hash, user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [session.tokenHash, session.userId, session.createdAt, session.expiresAt],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const saveLocalDatabase = async () => {
  const state: DatabaseState = {
    users: [...users.values()],
    meetings: [...meetings.values()],
    lobby: [...lobby.values()].flat(),
    mediaRequests: [...mediaRequests.values()].flat(),
    sessions: [...sessions.values()],
    nextUserId,
    nextMeetingId,
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(state, null, 2));
};

const saveDatabase = async () => {
  if (databaseMode === 'postgres') {
    await savePostgresDatabase();
    return;
  }
  await saveLocalDatabase();
};

const restoreRowsByMeeting = <T extends { meeting_id?: number; meetingId?: number }>(rows: T[]) => {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const meetingId = Number(row.meeting_id || row.meetingId);
    if (!Number.isFinite(meetingId)) continue;
    grouped.set(meetingId, [...(grouped.get(meetingId) || []), row]);
  }
  return grouped;
};

const loadDatabase = async () => {
  if (pgPool) {
    try {
      await runRoomMigrations();
      const [userResult, meetingResult, lobbyResult, mediaRequestResult, sessionResult] = await Promise.all([
        pgPool.query<RoomUserRow>('SELECT * FROM room_users ORDER BY id ASC'),
        pgPool.query<RoomMeetingRow>('SELECT * FROM room_meetings ORDER BY id ASC'),
        pgPool.query<RoomLobbyRow>('SELECT * FROM room_lobby ORDER BY meeting_id ASC, user_id ASC'),
        pgPool.query<RoomMediaRequestRow>('SELECT * FROM room_media_requests ORDER BY created_at ASC'),
        pgPool.query<RoomSessionRow>('SELECT * FROM room_sessions WHERE expires_at > $1', [new Date().toISOString()]),
      ]);

      users.clear();
      meetings.clear();
      lobby.clear();
      mediaRequests.clear();
      sessions.clear();

      for (const user of userResult.rows) {
        users.set(Number(user.id), {
          id: Number(user.id),
          name: user.name,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          passwordHash: user.password_hash,
          passwordSalt: user.password_salt,
          isGuest: user.is_guest,
          createdAt: user.created_at,
        });
      }

      for (const meeting of meetingResult.rows) {
        meetings.set(Number(meeting.id), {
          id: Number(meeting.id),
          title: meeting.title,
          description: meeting.description,
          host_id: Number(meeting.host_id),
          co_host_id: meeting.co_host_id ? Number(meeting.co_host_id) : undefined,
          host_name: meeting.host_name,
          host_avatar: meeting.host_avatar,
          start_time: meeting.start_time,
          duration: Number(meeting.duration),
          meeting_link: meeting.meeting_link,
          is_active: meeting.is_active,
          settings: parseSettings(meeting.settings),
          participant_count: Number(meeting.participant_count),
        });
      }

      for (const [meetingId, rows] of restoreRowsByMeeting(lobbyResult.rows)) lobby.set(meetingId, rows as LobbyParticipant[]);
      for (const [meetingId, rows] of restoreRowsByMeeting(
        mediaRequestResult.rows.map((row) => ({
          id: row.id,
          meetingId: Number(row.meeting_id),
          targetUserId: Number(row.target_user_id),
          requestedBy: Number(row.requested_by),
          requestedByName: row.requested_by_name,
          kind: row.kind,
          status: row.status,
          createdAt: row.created_at,
          respondedAt: row.responded_at || undefined,
        })),
      )) mediaRequests.set(meetingId, rows as MediaRequest[]);
      for (const session of sessionResult.rows) {
        sessions.set(session.token_hash, {
          tokenHash: session.token_hash,
          userId: Number(session.user_id),
          createdAt: session.created_at,
          expiresAt: session.expires_at,
        });
      }

      databaseMode = 'postgres';
      nextUserId = Math.max(...[...users.keys()].map((id) => id + 1), 1);
      nextMeetingId = Math.max(...[...meetings.keys()].map((id) => id + 1), 1);
      if (users.size === 0 && meetings.size === 0) await seedDatabase();
      return;
    } catch (error) {
      console.error('Impossible de charger Supabase, fallback JSON local.', error);
      databaseMode = 'local-json';
    }
  }

  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const state = JSON.parse(raw) as Partial<DatabaseState>;
    users.clear();
    meetings.clear();
    lobby.clear();
    mediaRequests.clear();
    sessions.clear();
    for (const user of state.users || []) users.set(Number(user.id), user);
    for (const meeting of state.meetings || []) meetings.set(Number(meeting.id), meeting);
    for (const [meetingId, rows] of restoreRowsByMeeting(state.lobby || [])) lobby.set(meetingId, rows as LobbyParticipant[]);
    for (const [meetingId, rows] of restoreRowsByMeeting(state.mediaRequests || [])) mediaRequests.set(meetingId, rows as MediaRequest[]);
    for (const session of state.sessions || []) {
      if (new Date(session.expiresAt).getTime() > Date.now()) sessions.set(session.tokenHash, session);
    }
    nextUserId = Math.max(Number(state.nextUserId || 1), ...[...users.keys()].map((id) => id + 1), 1);
    nextMeetingId = Math.max(Number(state.nextMeetingId || 1), ...[...meetings.keys()].map((id) => id + 1), 1);
  } catch {
    await seedDatabase();
  }
};

const authenticateToken = (request: AuthedRequest, response: express.Response, next: express.NextFunction) => {
  const token = getBearerToken(request);
  const user = getUserByToken(token);
  if (!user) {
    response.status(401).json({ error: 'Compte requis pour accéder aux réunions.' });
    return;
  }
  request.user = user;
  next();
};

const createSession = async (user: User) => {
  const token = createToken();
  const session: Session = {
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  sessions.set(session.tokenHash, session);
  await saveDatabase();
  return { token, user: getPublicUser(user) };
};

const createMeetingLink = () => `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const findMeetingByAccessValue = (value: unknown) => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return null;
  return [...meetings.values()].find((item) => (
    String(item.id) === normalized
    || item.meeting_link.toLowerCase() === normalized
    || String(item.settings.meetingAccessId || '').toLowerCase() === normalized
    || item.meeting_link.slice(-6).toLowerCase() === normalized
  )) || null;
};

const validateMeetingPassword = (meeting: Meeting, password: unknown) => {
  const providedPassword = String(password || '').trim();
  if (meeting.settings.passwordHash && meeting.settings.passwordSalt) {
    if (!providedPassword) return false;
    const { hash } = hashPassword(providedPassword, meeting.settings.passwordSalt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(meeting.settings.passwordHash, 'hex'));
  }

  const expectedPassword = String(meeting.settings.password || '').trim().toLowerCase();
  return !expectedPassword || expectedPassword === providedPassword.toLowerCase();
};

const isMeetingModerator = (meeting: Meeting, user: PublicUser) =>
  meeting.host_id === user.id || meeting.co_host_id === user.id;

const getLobbyParticipant = (meetingId: number, userId: number) =>
  (lobby.get(meetingId) || []).find((item) => item.user_id === userId) || null;

const canEnterMeeting = (meeting: Meeting, user: PublicUser) =>
  isMeetingModerator(meeting, user) || getLobbyParticipant(meeting.id, user.id)?.status === 'accepted';

const sanitizeMediaState = (value: unknown) => {
  const media = value as Partial<{ audio: boolean; video: boolean; screen: boolean }> | null;
  return {
    audio: Boolean(media?.audio),
    video: Boolean(media?.video),
    screen: Boolean(media?.screen),
  };
};

const getPublicMeeting = (meeting: Meeting): Meeting => {
  const { password: _password, passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...settings } = meeting.settings || {};
  return { ...meeting, settings };
};

const normalizePlainText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

const parseCommaList = (value: unknown) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const getGroqModels = () => {
  const primary = parseCommaList(process.env.GROQ_MODEL || 'llama-3.1-8b-instant');
  const fallback = parseCommaList(process.env.GROQ_FALLBACK_MODELS || 'llama-3.1-8b-instant,openai/gpt-oss-20b,openai/gpt-oss-120b,meta-llama/llama-4-scout-17b-16e-instruct');
  return Array.from(new Set([...primary, ...fallback]));
};

const buildLunaFallback = (prompt: string) => {
  const lower = normalizePlainText(prompt).toLowerCase();
  if (!lower) return 'Je n’ai pas reçu de message à traiter.';
  if (/(résume|resume|synthèse|synthese|compte rendu|compte-rendu)/i.test(lower)) {
    return 'Fonctionnalité non configurée. Active GROQ_API_KEY pour générer un vrai résumé de réunion.';
  }
  if (/(ordre du jour|agenda|plan)/i.test(lower)) {
    return 'Fonctionnalité non configurée. Je pourrai préparer un ordre du jour dès que le fournisseur IA sera actif.';
  }
  if (/(action|tâche|tache|décision|decision)/i.test(lower)) {
    return 'Fonctionnalité non configurée. Je pourrai extraire les décisions et tâches avec un fournisseur IA actif.';
  }
  return 'Fonctionnalité non configurée. Ajoute GROQ_API_KEY dans .env pour activer Luna IA.';
};

const normalizeLunaResponse = (value: unknown, prompt: string) => {
  const cleaned = normalizePlainText(value);
  if (!cleaned) return buildLunaFallback(prompt);
  return cleaned
    .replace(/^je suis mbote[,.\s-]*/i, 'Je suis Luna IA, assistante de réunion MBotéRoom. ')
    .slice(0, 1800);
};

const completeWithGroq = async (system: string, prompt: string) => {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return null;

  for (const model of getGroqModels()) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 700,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 30000)),
    }).catch(() => null);

    if (!response?.ok) continue;
    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (text) return normalizePlainText(text);
  }

  return null;
};

const buildLunaMeetingSystemPrompt = (meeting: Meeting, user: PublicUser, tone: LunaTone) => `
Tu es Luna IA, assistante officielle de MBoteRoom.
Tu aides pendant une réunion en ligne: résumer, préparer une réponse, clarifier une décision, proposer un ordre du jour, extraire des tâches et améliorer la communication.
Réponds en français par défaut.
Reste factuelle. Ne prétends jamais avoir transcrit l'audio, vu la vidéo ou consulté des fichiers si le contexte n'est pas fourni.
Ne révèle jamais de secrets, tokens, mots de passe ou contenu .env.
Réunion: ${meeting.title}.
Utilisateur: ${user.name}.
Ton demandé: ${tone}.
`.trim();

const addLobbyParticipant = async (
  meeting: Meeting,
  user: PublicUser,
  status: 'requested' | 'accepted' = meeting.settings.waitingRoom === false ? 'accepted' : 'requested',
) => {
  const rows = lobby.get(meeting.id) || [];
  const existing = rows.find((item) => item.user_id === user.id);
  const nextStatus = existing?.status === 'accepted' && status === 'requested' ? 'accepted' : status;
  const participant = {
    meeting_id: meeting.id,
    user_id: user.id,
    status: nextStatus,
    name: user.name,
    avatar: user.avatar,
  } satisfies LobbyParticipant;

  if (existing) Object.assign(existing, participant);
  else rows.push(participant);
  lobby.set(meeting.id, rows);
  await saveDatabase();
  return participant;
};

const normalizeMeetingPayload = (body: Record<string, unknown>, currentUser: PublicUser, existing?: Meeting): Meeting => {
  const startTime = String(body.startTime || body.start_time || existing?.start_time || new Date().toISOString());
  const duration = Math.max(15, Number(body.duration || existing?.duration || 60));
  const incomingSettings = (body.settings as MeetingSettings | undefined) || {};
  const settings: MeetingSettings = {
    waitingRoom: true,
    participantAudio: true,
    participantVideo: true,
    screenShare: true,
    chat: true,
    reactions: true,
    encryption: true,
    linkSharing: true,
    externalAccess: true,
    ...(existing?.settings || {}),
    ...incomingSettings,
  };
  if (Object.prototype.hasOwnProperty.call(incomingSettings, 'password')) {
    const rawPassword = String(incomingSettings.password || '').trim();
    delete settings.password;
    delete settings.passwordHash;
    delete settings.passwordSalt;
    if (rawPassword) {
      const { salt, hash } = hashPassword(rawPassword);
      settings.passwordSalt = salt;
      settings.passwordHash = hash;
    }
  }

  return {
    id: existing?.id || nextMeetingId++,
    title: String(body.title || existing?.title || 'Réunion MBoté').trim().slice(0, 160),
    description: String(body.description || existing?.description || '').trim().slice(0, 1000),
    host_id: Number(body.host_id || body.hostId || existing?.host_id || currentUser.id),
    co_host_id: body.coHostId || body.co_host_id ? Number(body.coHostId || body.co_host_id) : existing?.co_host_id,
    host_name: existing?.host_name || currentUser.name,
    host_avatar: existing?.host_avatar || currentUser.avatar,
    start_time: Number.isNaN(new Date(startTime).getTime()) ? new Date().toISOString() : new Date(startTime).toISOString(),
    duration,
    meeting_link: existing?.meeting_link || createMeetingLink(),
    is_active: Boolean(existing?.is_active),
    settings,
    participant_count: Math.max(1, Number(settings.participantCapacity || existing?.participant_count || 1)),
  };
};

async function seedDatabase() {
  const { salt, hash } = hashPassword('MboteRoom2026!');
  const user: User = {
    id: nextUserId++,
    name: 'Hôte MBoté',
    username: 'hote',
    email: 'hote@mbote.local',
    avatar: createAvatar('Hôte MBoté'),
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  const seedMeeting = normalizeMeetingPayload({
    title: 'Réunion de démonstration MBoté',
    description: 'Salle prête pour tester le lobby, la vidéo, le micro, le chat et le partage de lien.',
    startTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    duration: 90,
    settings: {
      password: 'MBOTE2026',
      waitingRoom: false,
      participantCapacity: 8,
      meetingAccessId: '9845671234',
    },
  }, getPublicUser(user));
  seedMeeting.is_active = true;
  meetings.set(seedMeeting.id, seedMeeting);
  lobby.set(seedMeeting.id, []);
  mediaRequests.set(seedMeeting.id, []);
  await saveDatabase();
}

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin) response.header('Access-Control-Allow-Origin', origin);
  response.header('Vary', 'Origin');
  response.header('Access-Control-Allow-Credentials', 'true');
  response.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'mbote-room',
    database: {
      configured: true,
      connected: true,
      type: databaseMode,
      users: users.size,
      meetings: meetings.size,
    },
  });
});

app.post('/api/auth/register', async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || '');
  const username = String(request.body?.username || email.split('@')[0] || '').trim().toLowerCase();

  if (!name || !email || !password) {
    response.status(400).json({ error: 'Nom, email et mot de passe sont requis.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: 'Email invalide.' });
    return;
  }
  if (password.length < 8) {
    response.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    return;
  }
  if ([...users.values()].some((user) => user.email === email)) {
    response.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    return;
  }

  const { salt, hash } = hashPassword(password);
  const user: User = {
    id: nextUserId++,
    name,
    username,
    email,
    avatar: createAvatar(name),
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  await saveDatabase();
  response.status(201).json(await createSession(user));
});

app.post('/api/auth/login', async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || '');
  const user = [...users.values()].find((item) => item.email === email);
  if (!user || !verifyPassword(password, user)) {
    response.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    return;
  }
  response.json(await createSession(user));
});

app.post('/api/auth/guest-join', async (request, response) => {
  const name = String(request.body?.name || '').trim().slice(0, 80);
  const meeting = findMeetingByAccessValue(request.body?.meetingCode);
  if (!name) {
    response.status(400).json({ error: 'Votre nom est requis pour rejoindre la salle d’attente.' });
    return;
  }
  if (!meeting) {
    response.status(404).json({ error: 'Réunion introuvable.' });
    return;
  }
  if (!validateMeetingPassword(meeting, request.body?.password)) {
    response.status(403).json({ error: 'ID ou mot de passe de réunion incorrect.' });
    return;
  }

  const guestId = nextUserId++;
  const guest: User = {
    id: guestId,
    name,
    username: `invite-${guestId}`,
    email: `invite-${guestId}@guest.mbote.local`,
    avatar: createAvatar(name),
    passwordHash: '',
    passwordSalt: '',
    isGuest: true,
    createdAt: new Date().toISOString(),
  };
  users.set(guest.id, guest);
  const publicGuest = getPublicUser(guest);
  const lobbyParticipant = await addLobbyParticipant(meeting, publicGuest, 'requested');
  const session = await createSession(guest);
  response.status(201).json({
    ...session,
    meeting: getPublicMeeting(meeting),
    lobbyStatus: lobbyParticipant.status,
  });
});

app.get('/api/auth/me', authenticateToken, (request: AuthedRequest, response) => {
  response.json({ user: request.user });
});

app.post('/api/auth/logout', authenticateToken, async (request, response) => {
  const token = getBearerToken(request);
  if (token) sessions.delete(hashToken(token));
  await saveDatabase();
  response.json({ success: true });
});

app.get('/api/meetings', authenticateToken, (_request, response) => {
  response.json([...meetings.values()]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map(getPublicMeeting));
});

app.post('/api/meetings', authenticateToken, async (request: AuthedRequest, response) => {
  const meeting = normalizeMeetingPayload(request.body || {}, request.user!);
  meetings.set(meeting.id, meeting);
  lobby.set(meeting.id, []);
  mediaRequests.set(meeting.id, []);
  await saveDatabase();
  response.status(201).json(getPublicMeeting(meeting));
});

app.get('/api/meetings/participant-suggestions', authenticateToken, (request, response) => {
  const query = String(request.query.query || '').trim().toLowerCase();
  response.json(
    [...users.values()]
      .filter((user) => !user.isGuest)
      .map(getPublicUser)
      .filter((user) => !query || user.name.toLowerCase().includes(query) || user.username.includes(query)),
  );
});

app.post('/api/meetings/join-lookup', authenticateToken, (request, response) => {
  const meeting = findMeetingByAccessValue(request.body?.value);

  if (!meeting) {
    response.status(404).json({ error: 'Réunion introuvable' });
    return;
  }

  if (!validateMeetingPassword(meeting, request.body?.password)) {
    response.status(403).json({ error: 'Mot de passe de réunion incorrect' });
    return;
  }

  response.json(getPublicMeeting(meeting));
});

app.get('/api/meetings/link/:meetingLink', authenticateToken, (request, response) => {
  const meeting = [...meetings.values()].find((item) => item.meeting_link === request.params.meetingLink);
  if (!meeting) {
    response.status(404).json({ error: 'Réunion introuvable' });
    return;
  }
  response.json(getPublicMeeting(meeting));
});

app.put('/api/meetings/:meetingId', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const existing = meetings.get(meetingId);
  if (!existing) {
    response.status(404).json({ error: 'Réunion introuvable' });
    return;
  }
  const canManage = isMeetingModerator(existing, request.user!);
  if (!canManage) {
    response.status(403).json({ error: 'Seul l’hôte peut modifier cette réunion.' });
    return;
  }
  const updated = normalizeMeetingPayload(request.body || {}, request.user!, existing);
  meetings.set(meetingId, updated);
  await saveDatabase();
  response.json(getPublicMeeting(updated));
});

app.delete('/api/meetings/:meetingId', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (meeting && !isMeetingModerator(meeting, request.user!)) {
    response.status(403).json({ error: 'Seul l’hôte peut supprimer cette réunion.' });
    return;
  }
  meetings.delete(meetingId);
  lobby.delete(meetingId);
  mediaRequests.delete(meetingId);
  await saveDatabase();
  response.status(204).end();
});

app.get('/api/meetings/:meetingId/lobby', authenticateToken, (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    response.status(404).json({ error: 'RÃ©union introuvable' });
    return;
  }
  const rows = lobby.get(meetingId) || [];
  if (isMeetingModerator(meeting, request.user!)) {
    response.json(rows);
    return;
  }
  response.json(rows.filter((item) => item.user_id === request.user!.id));
});

app.post('/api/meetings/:meetingId/join-request', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    response.status(404).json({ error: 'Réunion introuvable' });
    return;
  }

  if (!validateMeetingPassword(meeting, request.body?.password)) {
    response.status(403).json({ error: 'Mot de passe de réunion incorrect' });
    return;
  }

  const participant = await addLobbyParticipant(
    meeting,
    request.user!,
    request.user!.isGuest ? 'requested' : undefined,
  );
  response.json({ success: true, status: participant.status });
});

app.post('/api/meetings/:meetingId/start-notify', authenticateToken, async (request: AuthedRequest, response) => {
  const meeting = meetings.get(Number(request.params.meetingId));
  if (!meeting) {
    response.status(404).json({ error: 'Réunion introuvable' });
    return;
  }
  if (!isMeetingModerator(meeting, request.user!)) {
    response.status(403).json({ error: 'Seul l’hôte peut démarrer cette réunion.' });
    return;
  }
  meeting.is_active = true;
  await saveDatabase();
  response.json({ success: true, notifiedCount: Math.max(0, meeting.participant_count - 1), meeting: getPublicMeeting(meeting) });
});

app.post('/api/meetings/:meetingId/lobby/respond', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting || !isMeetingModerator(meeting, request.user!)) {
    response.status(403).json({ error: 'Seul l’hôte peut gérer le lobby.' });
    return;
  }
  const userId = Number(request.body?.userId);
  const status = request.body?.status === 'rejected' ? 'rejected' : 'accepted';
  const rows = lobby.get(meetingId) || [];
  const participant = rows.find((item) => item.user_id === userId);
  if (participant) participant.status = status;
  await saveDatabase();
  response.json({ success: true });
});

app.post('/api/meetings/:meetingId/media-requests', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    response.status(404).json({ error: 'RÃ©union introuvable' });
    return;
  }
  if (!isMeetingModerator(meeting, request.user!)) {
    response.status(403).json({ error: 'Seul lâ€™hÃ´te peut demander un contrÃ´le mÃ©dia.' });
    return;
  }
  const targetUserId = Number(request.body?.targetUserId);
  const targetUser = users.get(targetUserId);
  if (!targetUser || !canEnterMeeting(meeting, getPublicUser(targetUser))) {
    response.status(404).json({ error: 'Participant introuvable dans cette rÃ©union.' });
    return;
  }
  const requestRows = mediaRequests.get(meetingId) || [];
  const item: MediaRequest = {
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    meetingId,
    targetUserId,
    requestedBy: request.user!.id,
    requestedByName: request.user!.name,
    kind: request.body?.kind === 'camera' ? 'camera' : 'mic',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  requestRows.push(item);
  mediaRequests.set(meetingId, requestRows);
  await saveDatabase();
  response.status(201).json(item);
});

app.get('/api/meetings/:meetingId/media-requests', authenticateToken, (request: AuthedRequest, response) => {
  const meeting = meetings.get(Number(request.params.meetingId));
  if (!meeting || !canEnterMeeting(meeting, request.user!)) {
    response.status(403).json({ error: 'AccÃ¨s refusÃ© Ã  cette rÃ©union.' });
    return;
  }
  const rows = mediaRequests.get(Number(request.params.meetingId)) || [];
  response.json(rows.filter((item) => item.status === 'pending' && item.targetUserId === request.user!.id));
});

app.post('/api/meetings/:meetingId/media-requests/:requestId/respond', authenticateToken, async (request: AuthedRequest, response) => {
  const rows = mediaRequests.get(Number(request.params.meetingId)) || [];
  const item = rows.find((row) => row.id === request.params.requestId);
  if (!item) {
    response.status(404).json({ error: 'Demande introuvable' });
    return;
  }
  if (item.targetUserId !== request.user!.id) {
    response.status(403).json({ error: 'Cette demande ne vous est pas destinÃ©e.' });
    return;
  }
  item.status = request.body?.status === 'rejected' ? 'rejected' : 'accepted';
  item.respondedAt = new Date().toISOString();
  await saveDatabase();
  response.json(item);
});

app.post('/api/ai/luna', authenticateToken, async (request: AuthedRequest, response) => {
  const prompt = normalizePlainText(request.body?.prompt).slice(0, 1800);
  const tone = ['professional', 'casual', 'creative'].includes(String(request.body?.tone))
    ? String(request.body?.tone) as LunaTone
    : 'professional';
  const meetingId = Number(request.body?.meetingId);
  const meeting = meetings.get(meetingId);

  if (!prompt) {
    response.status(400).json({ error: 'Message requis pour Luna IA.' });
    return;
  }
  if (!meeting || !canEnterMeeting(meeting, request.user!)) {
    response.status(403).json({ error: 'Accès refusé à cette réunion.' });
    return;
  }

  const system = buildLunaMeetingSystemPrompt(meeting, request.user!, tone);
  const answer = await completeWithGroq(system, prompt);
  response.json({
    answer: normalizeLunaResponse(answer, prompt),
    configured: Boolean(answer),
  });
});

app.get('/api/actus/events', authenticateToken, (_request, response) => {
  response.json([...meetings.values()].map((meeting) => ({
    ...getPublicMeeting(meeting),
    is_public: Boolean(meeting.settings.externalAccess),
    is_invited: true,
    my_lobby_status: null,
    relevance_reason: 'created_by_me',
  })));
});

io.use((socket, next) => {
  const user = getUserByToken(socket.handshake.auth?.token);
  if (!user) {
    next(new Error('Session invalide.'));
    return;
  }
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  socket.use((packet, next) => {
    const [eventName, payload, callback] = packet as [string, Record<string, unknown> | undefined, ((response: unknown) => void) | undefined];
    const user = socket.data.user as PublicUser | undefined;
    if (!user) {
      next(new Error('Session invalide.'));
      return;
    }

    if (eventName === 'meeting:join') {
      const meetingId = Number(payload?.meetingId);
      const meeting = meetings.get(meetingId);
      if (!meeting) {
        callback?.({ ok: false, error: 'RÃ©union invalide' });
        return;
      }
      if (!canEnterMeeting(meeting, user)) {
        callback?.({ ok: false, error: 'AccÃ¨s non autorisÃ© Ã  cette rÃ©union.' });
        return;
      }
      packet[1] = {
        ...(payload || {}),
        meetingId: String(meetingId),
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
        media: sanitizeMediaState(payload?.media),
      };
      next();
      return;
    }

    if (eventName === 'meeting:media-updated') {
      const meetingId = String(payload?.meetingId || '');
      if (!meetingId || meetingId !== String(socket.data.meetingId || '')) return;
      packet[1] = { ...(payload || {}), media: sanitizeMediaState(payload?.media) };
      next();
      return;
    }

    if (['meeting:offer', 'meeting:answer', 'meeting:ice-candidate'].includes(eventName)) {
      const meetingId = String(payload?.meetingId || '');
      const targetSocketId = String(payload?.targetSocketId || '');
      const participants = meetingParticipants.get(meetingId);
      if (meetingId !== String(socket.data.meetingId || '') || !participants?.has(socket.id) || !participants.has(targetSocketId)) return;
      next();
      return;
    }

    next();
  });

  socket.on('meeting:join', (payload, callback) => {
    const meetingId = String(payload?.meetingId || '');
    if (!meetingId) {
      callback?.({ ok: false, error: 'Réunion invalide' });
      return;
    }

    const roomName = `meeting:${meetingId}`;
    const participants = meetingParticipants.get(meetingId) || new Map();
    const currentParticipant = {
      socketId: socket.id,
      userId: String(payload?.userId || socket.handshake.auth?.userId || socket.id),
      name: String(payload?.name || 'Participant'),
      avatar: String(payload?.avatar || ''),
      media: {
        audio: Boolean(payload?.media?.audio),
        video: Boolean(payload?.media?.video),
        screen: Boolean(payload?.media?.screen),
      },
    };

    socket.data.meetingId = meetingId;
    socket.data.roomName = roomName;
    socket.join(roomName);
    callback?.({ ok: true, participants: [...participants.values()] });
    participants.set(socket.id, currentParticipant);
    meetingParticipants.set(meetingId, participants);
    socket.to(roomName).emit('meeting:participant-joined', currentParticipant);
  });

  socket.on('meeting:media-updated', (payload) => {
    const meetingId = String(payload?.meetingId || socket.data.meetingId || '');
    const participants = meetingParticipants.get(meetingId);
    const participant = participants?.get(socket.id);
    if (!participant) return;
    participant.media = {
      audio: Boolean(payload?.media?.audio),
      video: Boolean(payload?.media?.video),
      screen: Boolean(payload?.media?.screen),
    };
    socket.to(`meeting:${meetingId}`).emit('meeting:participant-media-updated', participant);
  });

  for (const eventName of ['meeting:offer', 'meeting:answer', 'meeting:ice-candidate']) {
    socket.on(eventName, (payload) => {
      if (!payload?.targetSocketId) return;
      socket.to(String(payload.targetSocketId)).emit(eventName, {
        ...payload,
        fromSocketId: socket.id,
        fromUserId: meetingParticipants.get(String(payload.meetingId))?.get(socket.id)?.userId || socket.id,
      });
    });
  }

  const leaveMeeting = () => {
    const meetingId = String(socket.data.meetingId || '');
    if (!meetingId) return;
    const participants = meetingParticipants.get(meetingId);
    participants?.delete(socket.id);
    socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', { socketId: socket.id });
    if (participants && participants.size === 0) meetingParticipants.delete(meetingId);
  };

  socket.on('meeting:leave', leaveMeeting);
  socket.on('disconnect', leaveMeeting);
});

const distPath = path.basename(__dirname) === 'dist'
  ? __dirname
  : path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_request, response) => {
  response.sendFile(path.join(distPath, 'index.html'));
});

const port = Number(process.env.PORT || 3004);
await loadDatabase();
httpServer.listen(port, () => {
  console.log(`MBoté Room API listening on http://localhost:${port}`);
});
