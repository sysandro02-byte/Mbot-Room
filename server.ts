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
  isPublic?: boolean;
  visibility?: string;
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
  phoneNumber?: string;
  organization?: string;
  jobTitle?: string;
  mboteUserId?: string;
  passwordHash: string;
  passwordSalt: string;
  isGuest?: boolean;
  createdAt: string;
};

type UserRole = 'admin' | 'user' | 'guest';

type PublicUser = Omit<User, 'passwordHash' | 'passwordSalt'> & {
  role: UserRole;
  permissions: string[];
};

type AdminActivityType = 'user' | 'meeting' | 'report' | 'ban' | 'recording';

type Session = {
  tokenHash: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
};

type PasswordResetRequest = {
  tokenHash: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

type DashboardTip = {
  id: string;
  title: string;
  body: string;
  actionLabel: string;
  actionPath: string;
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
};

type GuestAccessSlide = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type DatabaseState = {
  users: User[];
  meetings: Meeting[];
  lobby: LobbyParticipant[];
  mediaRequests: MediaRequest[];
  sessions: Session[];
  passwordResetRequests?: PasswordResetRequest[];
  dashboardTips?: DashboardTip[];
  guestAccessSlides?: GuestAccessSlide[];
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
const dataDir = process.env.MBOTE_ROOM_DATA_DIR
  ? path.resolve(process.env.MBOTE_ROOM_DATA_DIR)
  : path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'mbote-room-db.json');
const databaseUrl = process.env.MBOTE_ROOM_DISABLE_POSTGRES === '1' ? '' : process.env.DATABASE_URL;
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
const passwordResetRequests = new Map<string, PasswordResetRequest>();
const meetings = new Map<number, Meeting>();
const lobby = new Map<number, LobbyParticipant[]>();
const mediaRequests = new Map<number, MediaRequest[]>();
const dashboardTips = new Map<string, DashboardTip>();
const guestAccessSlides = new Map<string, GuestAccessSlide>();
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

const adminPermissions = [
  'admin.dashboard.view',
  'admin.users.view',
  'admin.meetings.view',
  'admin.live_meetings.view',
  'admin.recordings.view',
  'admin.reports.view',
  'admin.bans.view',
  'admin.statistics.view',
  'admin.audit_logs.view',
  'admin.storage.view',
  'meeting.admin.join',
];

const getConfiguredAdminEmails = () => String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const getUserRole = (user: Pick<User, 'id' | 'email' | 'isGuest'>): UserRole => {
  if (user.isGuest) return 'guest';
  if (Number(user.id) === 1 || getConfiguredAdminEmails().includes(String(user.email || '').toLowerCase())) {
    return 'admin';
  }
  return 'user';
};

const getPublicUser = (user: User): PublicUser => {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...publicUser } = user;
  const role = getUserRole(user);
  return {
    ...publicUser,
    role,
    permissions: role === 'admin' ? adminPermissions : [],
  };
};

const isAdminUser = (user?: PublicUser | null) => {
  if (!user) return false;
  return user.role === 'admin'
    || Number(user.id) === 1
    || getConfiguredAdminEmails().includes(String(user.email || '').toLowerCase());
};

type ApiErrorCode =
  | 'ADMIN_ACCESS_DENIED'
  | 'AUTH_REQUIRED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'EXTERNAL_AUTH_NOT_CONFIGURED'
  | 'EXTERNAL_AUTH_PROFILE_UNAVAILABLE'
  | 'EXTERNAL_AUTH_STATE_INVALID'
  | 'MBOTE_CREDENTIALS_INVALID'
  | 'MBOTE_AUTH_NOT_CONFIGURED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_EMAIL'
  | 'LOBBY_HOST_REQUIRED'
  | 'LUNA_ACCESS_DENIED'
  | 'LUNA_PROMPT_REQUIRED'
  | 'MEDIA_REQUEST_ACCESS_DENIED'
  | 'MEDIA_REQUEST_FORBIDDEN'
  | 'MEDIA_REQUEST_NOT_FOUND'
  | 'MEETING_ACCESS_DENIED'
  | 'MEETING_HOST_REQUIRED'
  | 'MEETING_NOT_FOUND'
  | 'MEETING_PASSWORD_INVALID'
  | 'PARTICIPANT_NOT_FOUND'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_RESET_INVALID'
  | 'PASSWORD_RESET_NOT_CONFIGURED'
  | 'TIP_BODY_REQUIRED'
  | 'TIP_NOT_FOUND'
  | 'SLIDE_CONTENT_REQUIRED'
  | 'SLIDE_NOT_FOUND'
  | 'VALIDATION_ERROR';

const sendApiError = (
  response: express.Response,
  status: number,
  code: ApiErrorCode,
  error: string,
  details?: Record<string, unknown>,
) => {
  response.status(status).json({
    error,
    code,
    ...(details ? { details } : {}),
  });
};

const requireAdmin = (request: AuthedRequest, response: express.Response, next: express.NextFunction) => {
  if (!isAdminUser(request.user)) {
    sendApiError(response, 403, 'ADMIN_ACCESS_DENIED', 'Accès administrateur refusé.');
    return;
  }
  next();
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
    passwordResetRequests: [...passwordResetRequests.values()],
    dashboardTips: [...dashboardTips.values()],
    guestAccessSlides: [...guestAccessSlides.values()],
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

const mojibakeReplacements: Array<[string, string]> = [
  ['\u00c3\u0192\u00c2\u00a9', 'é'],
  ['\u00c3\u0192\u00c2\u00a8', 'è'],
  ['\u00c3\u0192\u00c2\u00aa', 'ê'],
  ['\u00c3\u0192\u00c2\u00ab', 'ë'],
  ['\u00c3\u0192\u00c2\u00a0', 'à'],
  ['\u00c3\u0192\u00c2\u00a2', 'â'],
  ['\u00c3\u0192\u00c2\u00a7', 'ç'],
  ['\u00c3\u0192\u00c2\u00ae', 'î'],
  ['\u00c3\u0192\u00c2\u00af', 'ï'],
  ['\u00c3\u0192\u00c2\u00b4', 'ô'],
  ['\u00c3\u0192\u00c2\u00bb', 'û'],
  ['\u00c3\u0192\u00c2\u00b9', 'ù'],
  ['\u00c3\u0192\u00c2\u2030', 'É'],
  ['\u00c3\u0192\u00c2\u20ac', 'À'],
  ['\u00c3\u00a9', 'é'],
  ['\u00c3\u00a8', 'è'],
  ['\u00c3\u00aa', 'ê'],
  ['\u00c3\u00ab', 'ë'],
  ['\u00c3\u00a0', 'à'],
  ['\u00c3\u00a2', 'â'],
  ['\u00c3\u00a7', 'ç'],
  ['\u00c3\u00ae', 'î'],
  ['\u00c3\u00af', 'ï'],
  ['\u00c3\u00b4', 'ô'],
  ['\u00c3\u00bb', 'û'],
  ['\u00c3\u00b9', 'ù'],
  ['\u00c3\u2030', 'É'],
  ['\u00c3\u20ac', 'À'],
  ['\u00e2\u20ac\u2122', '’'],
  ['\u00e2\u20ac\u0153', '“'],
  ['\u00e2\u20ac\u009d', '”'],
  ['\u00e2\u20ac\u201c', '–'],
  ['\u00e2\u20ac\u201d', '—'],
  ['\u00e2\u20ac\u00a2', '•'],
  ['\u00c2 ', ' '],
  ['\u00c2', ''],
];

const repairStoredText = (value: string) => {
  let next = value;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [bad, good] of mojibakeReplacements) next = next.split(bad).join(good);
  }
  return next;
};

const normalizeStoredText = () => {
  let changed = false;
  const fix = (value?: string) => {
    if (typeof value !== 'string') return value || '';
    const repaired = repairStoredText(value);
    if (repaired !== value) changed = true;
    return repaired;
  };

  for (const user of users.values()) {
    user.name = fix(user.name);
    user.username = fix(user.username);
    user.organization = fix(user.organization);
    user.jobTitle = fix(user.jobTitle);
  }

  for (const meeting of meetings.values()) {
    meeting.title = fix(meeting.title);
    meeting.description = fix(meeting.description);
    meeting.host_name = fix(meeting.host_name);
  }

  for (const rows of lobby.values()) {
    for (const participant of rows) participant.name = fix(participant.name);
  }

  for (const rows of mediaRequests.values()) {
    for (const mediaRequest of rows) mediaRequest.requestedByName = fix(mediaRequest.requestedByName);
  }

  return changed;
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
      passwordResetRequests.clear();
      dashboardTips.clear();
    guestAccessSlides.clear();
      guestAccessSlides.clear();

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
      ensureDefaultDashboardTips();
      if (users.size === 0 && meetings.size === 0) await seedDatabase();
      if (normalizeStoredText()) await saveDatabase();
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
    passwordResetRequests.clear();
    dashboardTips.clear();
    guestAccessSlides.clear();
    for (const user of state.users || []) users.set(Number(user.id), user);
    for (const meeting of state.meetings || []) meetings.set(Number(meeting.id), meeting);
    for (const [meetingId, rows] of restoreRowsByMeeting(state.lobby || [])) lobby.set(meetingId, rows as LobbyParticipant[]);
    for (const [meetingId, rows] of restoreRowsByMeeting(state.mediaRequests || [])) mediaRequests.set(meetingId, rows as MediaRequest[]);
    for (const session of state.sessions || []) {
      if (new Date(session.expiresAt).getTime() > Date.now()) sessions.set(session.tokenHash, session);
    }
    for (const resetRequest of state.passwordResetRequests || []) {
      if (!resetRequest.usedAt && new Date(resetRequest.expiresAt).getTime() > Date.now()) {
        passwordResetRequests.set(resetRequest.tokenHash, resetRequest);
      }
    }
    for (const tip of state.dashboardTips || []) dashboardTips.set(tip.id, tip);
    for (const slide of state.guestAccessSlides || []) guestAccessSlides.set(slide.id, slide);
    nextUserId = Math.max(Number(state.nextUserId || 1), ...[...users.keys()].map((id) => id + 1), 1);
    nextMeetingId = Math.max(Number(state.nextMeetingId || 1), ...[...meetings.keys()].map((id) => id + 1), 1);
    ensureDefaultDashboardTips();
    if (normalizeStoredText()) await saveDatabase();
  } catch {
    await seedDatabase();
  }
};

const authenticateToken = (request: AuthedRequest, response: express.Response, next: express.NextFunction) => {
  const token = getBearerToken(request);
  const user = getUserByToken(token);
  if (!user) {
    sendApiError(response, 401, 'AUTH_REQUIRED', 'Compte requis pour accéder aux réunions.');
    return;
  }
  request.user = user;
  next();
};

const createSession = async (user: User, rememberMe = false) => {
  const token = createToken();
  const durationMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const session: Session = {
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + durationMs).toISOString(),
  };
  sessions.set(session.tokenHash, session);
  await saveDatabase();
  return { token, user: getPublicUser(user), expiresAt: session.expiresAt };
};

const getRequestOrigin = (request: express.Request) => {
  const protocol = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0];
  const host = String(request.headers['x-forwarded-host'] || request.get('host') || '').split(',')[0].trim();
  return `${protocol}://${host}`.replace(/\/+$/, '');
};

const normalizeHttpOrigin = (value: unknown) => {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
};

const getMboteRoomClientOrigin = (request: express.Request) => {
  const apiOrigin = getRequestOrigin(request);
  const configuredOrigins = [
    process.env.MBOTE_ROOM_APP_URL,
    ...(process.env.MBOTE_ROOM_ALLOWED_ORIGINS || '').split(','),
  ]
    .map(normalizeHttpOrigin)
    .filter(Boolean);
  const requestOrigin = normalizeHttpOrigin(request.headers.origin);

  if (requestOrigin === apiOrigin || configuredOrigins.includes(requestOrigin)) return requestOrigin;
  return configuredOrigins[0] || apiOrigin;
};

const getMboteAuthConfig = (request: express.Request) => {
  const baseUrl = String(process.env.MBOTE_AUTH_BASE_URL || process.env.MBOTE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const clientId = String(process.env.MBOTE_AUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.MBOTE_AUTH_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.MBOTE_AUTH_REDIRECT_URI || `${getRequestOrigin(request)}/api/auth/mbote/callback`).trim();
  const authorizeUrl = String(process.env.MBOTE_AUTH_AUTHORIZE_URL || (baseUrl ? `${baseUrl}/api/oauth/authorize` : '')).trim();
  const tokenUrl = String(process.env.MBOTE_AUTH_TOKEN_URL || (baseUrl ? `${baseUrl}/api/oauth/token` : '')).trim();
  const profileUrl = String(process.env.MBOTE_AUTH_PROFILE_URL || (baseUrl ? `${baseUrl}/api/auth/me` : '')).trim();
  const loginUrl = String(process.env.MBOTE_AUTH_LOGIN_URL || (baseUrl ? baseUrl + '/api/auth/login' : '')).trim();
  return { baseUrl, clientId, clientSecret, redirectUri, authorizeUrl, tokenUrl, profileUrl, loginUrl };
};

const mboteOAuthStates = new Map<string, { redirectTo: string; clientOrigin: string; createdAt: number }>();
const mboteCredentialChallenges = new Map<string, { profile: NonNullable<ReturnType<typeof normalizeExternalProfile>>; createdAt: number }>();

const normalizeRedirectPath = (value: unknown) => {
  const redirectTo = String(value || '/app').trim();
  return redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/app';
};

const normalizeExternalProfile = (value: any) => {
  const source = value?.user || value?.profile || value;
  const id = String(source?.id || source?.sub || source?.userId || source?.user_id || '').trim();
  if (!id) return null;

  const email = normalizeEmail(source?.email) || 'mbote-' + id + '@oauth.mbote.local';
  const username = String(
    source?.username || source?.preferred_username || email.split('@')[0] || 'mbote-' + id,
  ).trim().toLowerCase();
  const name = String(source?.name || source?.displayName || username || 'Utilisateur MBoté').trim();
  if (!name) return null;

  return {
    id,
    name,
    username,
    email,
    avatar: String(source?.avatar || source?.picture || source?.avatar_url || source?.avatarUrl || ''),
    phoneNumber: String(source?.phoneNumber || source?.phone_number || ''),
  };
};

const findOrCreateMboteUser = async (profile: NonNullable<ReturnType<typeof normalizeExternalProfile>>) => {
  const existing = [...users.values()].find((user) => (
    normalizeEmail(user.email) === profile.email
    || (user.mboteUserId && user.mboteUserId === profile.id)
  ));
  if (existing) {
    existing.name = existing.name || profile.name;
    existing.username = existing.username || profile.username;
    existing.avatar = existing.avatar || profile.avatar || createAvatar(profile.name);
    existing.phoneNumber = existing.phoneNumber || profile.phoneNumber;
    existing.mboteUserId = profile.id;
    await saveDatabase();
    return existing;
  }

  const { salt, hash } = hashPassword(createToken());
  const user: User = {
    id: nextUserId++,
    name: profile.name,
    username: profile.username,
    email: profile.email,
    avatar: profile.avatar || createAvatar(profile.name),
    phoneNumber: profile.phoneNumber,
    mboteUserId: profile.id,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  await saveDatabase();
  return user;
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

const getPublicDashboardTip = (tip: DashboardTip): DashboardTip => ({
  ...tip,
  title: repairStoredText(tip.title),
  body: repairStoredText(tip.body),
  actionLabel: repairStoredText(tip.actionLabel),
});

const isDashboardTipVisible = (tip: DashboardTip, now = Date.now()) => {
  if (!tip.isActive) return false;
  const startsAt = tip.startsAt ? new Date(tip.startsAt).getTime() : Number.NEGATIVE_INFINITY;
  const endsAt = tip.endsAt ? new Date(tip.endsAt).getTime() : Number.POSITIVE_INFINITY;
  return now >= startsAt && now <= endsAt;
};

const ensureDefaultDashboardTips = () => {
  if (dashboardTips.size > 0) return;
  const now = new Date().toISOString();
  dashboardTips.set('default-whiteboard', {
    id: 'default-whiteboard',
    title: 'Astuce du jour',
    body: 'Utilisez le tableau blanc pour collaborer visuellement avec votre équipe en temps réel.',
    actionLabel: 'Essayer maintenant',
    actionPath: '/app/whiteboard',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
};

const ensureDefaultGuestAccessSlides = () => {
  if (guestAccessSlides.size > 0) return;
  const now = new Date().toISOString();
  guestAccessSlides.set('guest-access-default', {
    id: 'guest-access-default', title: 'Acc\u00e8s invit\u00e9',
    body: "Vous participez en tant qu'invit\u00e9. Certaines fonctionnalit\u00e9s peuvent \u00eatre limit\u00e9es.",
    imageUrl: '/meeting-black-team.svg', isActive: true, createdAt: now, updatedAt: now,
  });
};

const normalizeGuestAccessSlidePayload = (body: Record<string, unknown>, existing?: GuestAccessSlide): GuestAccessSlide => {
  const now = new Date().toISOString();
  return {
    id: existing?.id || crypto.randomUUID(),
    title: String(body.title || existing?.title || 'Acc\u00e8s invit\u00e9').trim().slice(0, 80),
    body: String(body.body || existing?.body || '').trim().slice(0, 280),
    imageUrl: String(body.imageUrl || existing?.imageUrl || '/meeting-black-team.svg').trim().slice(0, 500),
    isActive: typeof body.isActive === 'boolean' ? body.isActive : existing?.isActive ?? true,
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
};

const getPublicGuestAccessSlide = (slide: GuestAccessSlide): GuestAccessSlide => ({
  ...slide, title: repairStoredText(slide.title), body: repairStoredText(slide.body),
});
const normalizeDashboardTipPayload = (body: Record<string, unknown>, existing?: DashboardTip): DashboardTip => {
  const now = new Date().toISOString();
  const startsAt = String(body.startsAt || existing?.startsAt || '').trim();
  const endsAt = String(body.endsAt || existing?.endsAt || '').trim();
  return {
    id: existing?.id || crypto.randomUUID(),
    title: String(body.title || existing?.title || 'Astuce du jour').trim().slice(0, 80),
    body: String(body.body || existing?.body || '').trim().slice(0, 260),
    actionLabel: String(body.actionLabel || existing?.actionLabel || 'Essayer maintenant').trim().slice(0, 40),
    actionPath: String(body.actionPath || existing?.actionPath || '/app').trim().slice(0, 160),
    isActive: typeof body.isActive === 'boolean' ? body.isActive : existing?.isActive ?? true,
    startsAt: startsAt && !Number.isNaN(new Date(startsAt).getTime()) ? new Date(startsAt).toISOString() : undefined,
    endsAt: endsAt && !Number.isNaN(new Date(endsAt).getTime()) ? new Date(endsAt).toISOString() : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
};

const getMeetingAccessCode = (meeting: Pick<Meeting, 'meeting_link' | 'settings'>) =>
  String(meeting.settings?.meetingAccessId || meeting.meeting_link.slice(-6)).toUpperCase();

const buildEndedMeetingSummary = (meeting: Meeting) => {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(meeting.start_time));
  return {
    bullets: [
      `Revue de l'avancement de ${meeting.title} et des priorités de l'équipe.`,
      'Décisions et points d’action regroupés pour faciliter le suivi après la réunion.',
      'Participants synchronisés avec la salle d’attente et les accès validés.',
      `Prochaine étape recommandée : partager le résumé avec l’équipe concernée.`,
      `Réunion tenue le ${dateLabel}.`,
    ],
    decisions: [
      'Partager le résumé avec les participants.',
      'Suivre les tâches assignées après la réunion.',
    ],
    actions: [
      "Préparer les points de la prochaine réunion.",
      "Consulter l'enregistrement si celui-ci a été activé.",
    ],
    nextMeeting: "À planifier selon les disponibilités de l'équipe.",
    processingStatus: meeting.settings.lunaSummary ? 'pending' : 'fallback',
  } as const;
};

const buildEndedMeetingPayload = (meeting: Meeting, user: PublicUser) => {
  const startedAt = new Date(meeting.start_time);
  const durationMinutes = Math.max(1, Number(meeting.duration || 60));
  const endedAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
  const rows = lobby.get(meeting.id) || [];
  const participants = new Map<string, {
    id: string;
    name: string;
    role: 'Hôte' | 'Participant' | 'Invité';
    avatar?: string;
    online?: boolean;
  }>();

  participants.set(`host-${meeting.host_id}`, {
    id: String(meeting.host_id),
    name: meeting.host_name,
    role: 'Hôte',
    avatar: meeting.host_avatar,
    online: true,
  });

  for (const row of rows) {
    if (row.status === 'rejected') continue;
    const key = `user-${row.user_id}`;
    if (participants.has(key)) continue;
    participants.set(key, {
      id: String(row.user_id),
      name: row.name,
      role: row.status === 'accepted' ? 'Participant' : 'Invité',
      avatar: row.avatar,
      online: row.status === 'accepted',
    });
  }

  if (!participants.has(`user-${user.id}`) && user.id !== meeting.host_id) {
    participants.set(`user-${user.id}`, {
      id: String(user.id),
      name: user.name || 'Vous',
      role: user.isGuest ? 'Invité' : 'Participant',
      avatar: user.avatar,
      online: true,
    });
  }

  const userRole = isMeetingModerator(meeting, user)
    ? 'host'
    : user.isGuest ? 'guest' : 'participant';
  const restricted = userRole === 'guest';
  const recordingAvailable = Boolean(meeting.settings.recording);

  return {
    meeting: getPublicMeeting(meeting),
    publicId: getMeetingAccessCode(meeting),
    status: meeting.is_active ? 'active' : 'ended',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMinutes,
    timezone: meeting.settings.timeZone || 'GMT+1',
    userRole,
    participants: [...participants.values()],
    summary: buildEndedMeetingSummary(meeting),
    nextActions: [
      { id: 'share-summary', label: "Partager le résumé avec l'équipe", completed: true },
      { id: 'follow-tasks', label: 'Suivre les tâches assignées', completed: true },
      { id: 'prepare-next', label: 'Préparer les points pour la prochaine réunion', completed: false },
      { id: 'review-recording', label: "Consulter l'enregistrement si besoin", completed: false },
    ],
    recording: {
      available: recordingAvailable,
      retentionDays: 30,
      url: null,
    },
    permissions: {
      canDownloadSummary: !restricted,
      canShareSummary: !restricted,
      canViewRecording: recordingAvailable && !restricted,
      canExportChat: !restricted,
      canRate: true,
    },
    guestRestrictions: restricted,
  };
};

const getAdminPeriodStart = (period: unknown) => {
  const now = new Date();
  const value = String(period || '30d');
  if (value === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (value === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
};

const buildDailyAdminUsage = (startDate: Date) => {
  const days = Math.max(7, Math.ceil((Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  return Array.from({ length: Math.min(days, 30) }, (_, index) => {
    const date = new Date(Date.now() - (Math.min(days, 30) - index - 1) * 24 * 60 * 60 * 1000);
    const label = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);
    return {
      label,
      meetings: [...meetings.values()].filter((meeting) => new Date(meeting.start_time).toDateString() === date.toDateString()).length,
      users: [...users.values()].filter((user) => new Date(user.createdAt).toDateString() === date.toDateString()).length,
    };
  });
};

const buildAdminStatPoints = (values: number[]) => {
  const padded = values.length >= 8 ? values : [...Array.from({ length: 8 - values.length }, () => 0), ...values];
  return padded.map((value, index) => value + index + 1);
};

const buildAdminActivities = (limit = 5) => {
  const userActivities = [...users.values()]
    .filter((user) => !user.isGuest)
    .map((user) => ({
      id: `user-${user.id}`,
      type: 'user' as AdminActivityType,
      title: 'Nouvel utilisateur inscrit',
      description: `${user.name || user.email} vient de s'inscrire`,
      createdAt: user.createdAt,
    }));
  const meetingActivities = [...meetings.values()].map((meeting) => ({
    id: `meeting-${meeting.id}`,
    type: 'meeting' as AdminActivityType,
    title: meeting.is_active ? 'Réunion démarrée' : 'Nouvelle réunion créée',
    description: `Titre : ${meeting.title}`,
    createdAt: meeting.start_time,
  }));
  return [...userActivities, ...meetingActivities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
};

const buildAdminDashboard = (period: unknown) => {
  const startDate = getAdminPeriodStart(period);
  const allUsers = [...users.values()];
  const allMeetings = [...meetings.values()];
  const periodMeetings = allMeetings.filter((meeting) => new Date(meeting.start_time) >= startDate);
  const liveMeetings = allMeetings.filter((meeting) => meeting.is_active);
  const usage = buildDailyAdminUsage(startDate);
  const totalMeetingMinutes = allMeetings.reduce((sum, meeting) => sum + Math.max(0, Number(meeting.duration || 0)) * Math.max(1, meeting.participant_count || 1), 0);
  const guests = allUsers.filter((user) => user.isGuest).length;
  const activeUsers = Math.max(0, allUsers.length - guests);
  const countryBuckets = new Map<string, { name: string; flag: string; count: number }>();

  for (const user of allUsers) {
    const record = user as User & { country?: string; countryCode?: string };
    const countryName = record.country || 'Autres';
    const countryCode = String(record.countryCode || '').toUpperCase();
    const flag = countryCode === 'CG' ? '🇨🇬'
      : countryCode === 'FR' ? '🇫🇷'
        : countryCode === 'CM' ? '🇨🇲'
          : countryCode === 'CD' ? '🇨🇩'
            : '🌐';
    const current = countryBuckets.get(countryName) || { name: countryName, flag, count: 0 };
    current.count += 1;
    countryBuckets.set(countryName, current);
  }

  const countries = [...countryBuckets.entries()].map(([id, value]) => ({
    id,
    ...value,
    percentage: allUsers.length ? Number(((value.count / allUsers.length) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.count - a.count);

  return {
    stats: [
      { id: 'users', label: 'Utilisateurs total', value: allUsers.length, evolution: 0, helper: 'ce mois', points: buildAdminStatPoints(usage.map((item) => item.users)) },
      { id: 'meetings', label: 'Réunions créées', value: periodMeetings.length, evolution: 0, helper: 'ce mois', points: buildAdminStatPoints(usage.map((item) => item.meetings)) },
      { id: 'live', label: 'Réunions en direct', value: liveMeetings.length, evolution: 0, helper: 'En ce moment', points: buildAdminStatPoints(usage.map((item) => item.meetings)) },
      { id: 'hours', label: 'Heures de réunion', value: Math.round(totalMeetingMinutes / 60), suffix: 'h', evolution: 0, helper: 'au total', points: buildAdminStatPoints(usage.map((item) => item.meetings * 2)) },
      { id: 'recordings', label: 'Enregistrements', value: allMeetings.filter((meeting) => meeting.settings.recording).length, evolution: 0, helper: 'au total', points: buildAdminStatPoints(usage.map(() => 0)) },
    ],
    liveMeetings: liveMeetings.map(getPublicMeeting),
    recentActivity: buildAdminActivities(5),
    usage,
    distribution: {
      active: activeUsers,
      guests,
      inactive: 0,
      banned: 0,
    },
    countries,
    permissions: adminPermissions,
  };
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
  if (!lower) return "Je n'ai pas reçu de message à traiter.";
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
  if (Array.isArray(body.participants)) {
    settings.participants = [...new Set(body.participants
      .map((participant) => String(participant || '').trim().toLowerCase())
      .filter(Boolean))]
      .slice(0, 100);
  }
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
  ensureDefaultDashboardTips();
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

app.get('/api/public/guest-access-slides', (_request, response) => {
  ensureDefaultGuestAccessSlides();
  response.json([...guestAccessSlides.values()].filter((slide) => slide.isActive).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(getPublicGuestAccessSlide));
});

app.get('/api/public/meetings', (_request, response) => {
  const publicMeetings = [...meetings.values()]
    .filter((meeting) => {
      const settings = meeting.settings || {};
      return settings.isPublic === true || settings.visibility === 'public';
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 12)
    .map(getPublicMeeting);

  response.json(publicMeetings);
});

app.post('/api/auth/register', async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || '');
  const username = String(request.body?.username || email.split('@')[0] || '').trim().toLowerCase();
  const phoneNumber = String(request.body?.phoneNumber || '').trim().slice(0, 40);
  const organization = String(request.body?.organization || '').trim().slice(0, 120);
  const jobTitle = String(request.body?.jobTitle || '').trim().slice(0, 120);

  if (!name || !email || !password) {
    sendApiError(response, 400, 'VALIDATION_ERROR', 'Nom, email et mot de passe sont requis.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendApiError(response, 400, 'INVALID_EMAIL', 'Email invalide.');
    return;
  }
  if (password.length < 8) {
    sendApiError(response, 400, 'PASSWORD_TOO_SHORT', 'Le mot de passe doit contenir au moins 8 caractères.');
    return;
  }
  if ([...users.values()].some((user) => user.email === email)) {
    sendApiError(response, 409, 'EMAIL_ALREADY_EXISTS', 'Un compte existe déjà avec cet email.');
    return;
  }

  const { salt, hash } = hashPassword(password);
  const user: User = {
    id: nextUserId++,
    name,
    username,
    email,
    avatar: createAvatar(name),
    phoneNumber,
    organization,
    jobTitle,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  await saveDatabase();
  response.status(201).json(await createSession(user, true));
});

app.post('/api/auth/login', async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || '');
  const user = [...users.values()].find((item) => item.email === email);
  if (!user || !verifyPassword(password, user)) {
    sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');
    return;
  }
  response.json(await createSession(user, Boolean(request.body?.rememberMe)));
});

app.post('/api/auth/mbote/credentials', async (request, response) => {
  const identifier = String(request.body?.identifier || '').trim();
  const password = String(request.body?.password || '');
  const config = getMboteAuthConfig(request);
  if (!config.loginUrl || !config.profileUrl) {
    sendApiError(response, 503, 'MBOTE_AUTH_NOT_CONFIGURED', 'Authentification MBoté non configurée.');
    return;
  }
  if (!identifier || !password) {
    sendApiError(response, 400, 'MBOTE_CREDENTIALS_INVALID', 'Identifiant et mot de passe requis.');
    return;
  }
  try {
    const loginResponse = await fetch(config.loginUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, email: identifier, username: identifier, password }),
      signal: AbortSignal.timeout(15000),
    });
    const loginPayload = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok) throw new Error('Identifiants MBoté incorrects.');
    const externalToken = String(loginPayload.access_token || loginPayload.token || loginPayload.accessToken || '').trim();
    const profileResponse = externalToken
      ? await fetch(config.profileUrl, { headers: { Authorization: `Bearer ${externalToken}` }, signal: AbortSignal.timeout(15000) })
      : null;
    const profilePayload = profileResponse ? await profileResponse.json().catch(() => ({})) : loginPayload;
    if (profileResponse && !profileResponse.ok) throw new Error('Profil MBoté indisponible.');
    const profile = normalizeExternalProfile(profilePayload);
    if (!profile) throw new Error('Profil MBoté incomplet.');
    const challengeId = createToken();
    mboteCredentialChallenges.set(challengeId, { profile, createdAt: Date.now() });
    response.json({ challengeId, profile: { id: profile.id, name: profile.name, email: profile.email, avatar: profile.avatar } });
  } catch (error) {
    sendApiError(response, 401, 'MBOTE_CREDENTIALS_INVALID', error instanceof Error ? error.message : 'Identifiants MBoté incorrects.');
  }
});

app.post('/api/auth/mbote/authorize', async (request, response) => {
  const challengeId = String(request.body?.challengeId || '').trim();
  const challenge = mboteCredentialChallenges.get(challengeId);
  mboteCredentialChallenges.delete(challengeId);
  if (!challenge || Date.now() - challenge.createdAt > 10 * 60 * 1000) {
    sendApiError(response, 401, 'EXTERNAL_AUTH_STATE_INVALID', 'La demande d’autorisation a expiré.');
    return;
  }
  const user = await findOrCreateMboteUser(challenge.profile);
  response.json(await createSession(user, true));
});
app.get('/api/auth/mbote/start', (request, response) => {
  const config = getMboteAuthConfig(request);
  if (!config.authorizeUrl || !config.clientId || !config.tokenUrl || !config.profileUrl) {
    sendApiError(
      response,
      503,
      'EXTERNAL_AUTH_NOT_CONFIGURED',
      "L'authentification MBoté doit être configurée avec MBOTE_AUTH_BASE_URL, MBOTE_AUTH_CLIENT_ID et MBOTE_AUTH_PROFILE_URL.",
    );
    return;
  }

  const state = createToken();
  mboteOAuthStates.set(state, {
    redirectTo: normalizeRedirectPath(request.query.redirect),
    clientOrigin: getMboteRoomClientOrigin(request),
    createdAt: Date.now(),
  });

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'profile email');
  url.searchParams.set('state', state);
  response.json({ url: url.toString() });
});

app.get('/api/auth/mbote/callback', async (request, response) => {
  const code = String(request.query.code || '').trim();
  const state = String(request.query.state || '').trim();
  const storedState = mboteOAuthStates.get(state);
  mboteOAuthStates.delete(state);

  if (!code || !storedState || Date.now() - storedState.createdAt > 10 * 60 * 1000) {
    response.redirect(`/connexion?externalAuth=failed&reason=${encodeURIComponent('Session MBoté expirée ou invalide.')}`);
    return;
  }

  const config = getMboteAuthConfig(request);
  try {
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret || undefined,
        redirect_uri: config.redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error || 'Token MBoté indisponible.');

    const profileResponse = await fetch(config.profileUrl, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const profilePayload = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok) throw new Error(profilePayload.error || 'Profil MBoté indisponible.');

    const profile = normalizeExternalProfile(profilePayload);
    if (!profile) throw new Error('Profil MBoté incomplet.');

    const user = await findOrCreateMboteUser(profile);
    const session = await createSession(user, true);
    const callbackUrl = new URL('/connexion', storedState.clientOrigin);
    callbackUrl.hash = new URLSearchParams({
      mboteToken: session.token,
      mboteUser: JSON.stringify(session.user),
      redirect: storedState.redirectTo,
    }).toString();
    response.redirect(callbackUrl.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentification MBoté impossible.';
    response.redirect(`/connexion?externalAuth=failed&reason=${encodeURIComponent(message)}`);
  }
});

app.post('/api/auth/forgot-password', async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendApiError(response, 400, 'INVALID_EMAIL', 'Adresse e-mail invalide.');
    return;
  }

  const user = [...users.values()].find((item) => item.email === email && !item.isGuest);
  if (!user) {
    response.json({ success: true, message: 'Si un compte existe, un lien de réinitialisation sera envoyé.' });
    return;
  }

  const token = createToken();
  const requestItem: PasswordResetRequest = {
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  passwordResetRequests.set(requestItem.tokenHash, requestItem);
  await saveDatabase();

  response.json({
    success: true,
    message: 'Un lien de réinitialisation a été généré pour ce compte.',
    resetUrl: process.env.NODE_ENV === 'production' ? undefined : `/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`,
  });
});

app.post('/api/auth/reset-password', async (request, response) => {
  const token = String(request.body?.token || '').trim();
  const password = String(request.body?.password || '');
  const resetRequest = token ? passwordResetRequests.get(hashToken(token)) : null;
  if (!resetRequest || resetRequest.usedAt || new Date(resetRequest.expiresAt).getTime() <= Date.now()) {
    sendApiError(response, 400, 'PASSWORD_RESET_INVALID', 'Lien de réinitialisation invalide ou expiré.');
    return;
  }
  if (password.length < 8) {
    sendApiError(response, 400, 'PASSWORD_TOO_SHORT', 'Le mot de passe doit contenir au moins 8 caractères.');
    return;
  }
  const user = users.get(resetRequest.userId);
  if (!user) {
    sendApiError(response, 400, 'PASSWORD_RESET_INVALID', 'Lien de réinitialisation invalide ou expiré.');
    return;
  }
  const { salt, hash } = hashPassword(password);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  resetRequest.usedAt = new Date().toISOString();
  await saveDatabase();
  response.json({ success: true });
});

app.post('/api/auth/guest-join', async (request, response) => {
  const name = String(request.body?.name || '').trim().slice(0, 80);
  const meeting = findMeetingByAccessValue(request.body?.meetingCode);
  if (!name) {
    sendApiError(response, 400, 'VALIDATION_ERROR', 'Votre nom est requis pour rejoindre la salle d’attente.');
    return;
  }
  if (!meeting) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }
  if (!validateMeetingPassword(meeting, request.body?.password)) {
    sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'ID ou mot de passe de réunion incorrect.');
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
  const session = await createSession(guest, false);
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

app.get('/api/admin/dashboard', authenticateToken, requireAdmin, (request, response) => {
  response.json(buildAdminDashboard(request.query.period));
});

app.get('/api/admin/search', authenticateToken, requireAdmin, (request, response) => {
  const query = String(request.query.q || '').trim().toLowerCase().slice(0, 80);
  if (!query) {
    response.json({ meetings: [], users: [] });
    return;
  }

  const normalized = query.replace(/\s+/g, '');
  response.json({
    meetings: [...meetings.values()]
      .filter((meeting) => (
        meeting.title.toLowerCase().includes(query)
        || meeting.host_name.toLowerCase().includes(query)
        || String(meeting.id).includes(normalized)
        || meeting.meeting_link.toLowerCase().includes(query)
        || String(meeting.settings.meetingAccessId || '').toLowerCase().includes(normalized)
      ))
      .slice(0, 10)
      .map(getPublicMeeting),
    users: [...users.values()]
      .filter((user) => !user.isGuest)
      .filter((user) => (
        user.name.toLowerCase().includes(query)
        || user.email.toLowerCase().includes(query)
        || user.username.toLowerCase().includes(query)
      ))
      .slice(0, 10)
      .map((user) => ({ id: user.id, name: user.name, email: user.email })),
  });
});

app.post('/api/admin/meetings/:meetingId/join', authenticateToken, requireAdmin, async (request: AuthedRequest, response) => {
  const meeting = meetings.get(Number(request.params.meetingId));
  if (!meeting) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }

  console.info(`Admin ${request.user?.id} joined meeting ${meeting.id}`);
  await addLobbyParticipant(meeting, request.user!, 'accepted');
  response.json({ success: true, meeting: getPublicMeeting(meeting) });
});

app.get('/api/admin/guest-access-slides', authenticateToken, requireAdmin, (_request, response) => {
  ensureDefaultGuestAccessSlides();
  response.json([...guestAccessSlides.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(getPublicGuestAccessSlide));
});

app.post('/api/admin/guest-access-slides', authenticateToken, requireAdmin, async (request, response) => {
  const slide = normalizeGuestAccessSlidePayload(request.body || {});
  if (!slide.title || !slide.body) { sendApiError(response, 400, 'SLIDE_CONTENT_REQUIRED', 'Title and body are required.'); return; }
  guestAccessSlides.set(slide.id, slide); await saveDatabase(); response.status(201).json(getPublicGuestAccessSlide(slide));
});

app.put('/api/admin/guest-access-slides/:slideId', authenticateToken, requireAdmin, async (request, response) => {
  const existing = guestAccessSlides.get(request.params.slideId);
  if (!existing) { sendApiError(response, 404, 'SLIDE_NOT_FOUND', 'Slide not found.'); return; }
  const slide = normalizeGuestAccessSlidePayload(request.body || {}, existing);
  if (!slide.title || !slide.body) { sendApiError(response, 400, 'SLIDE_CONTENT_REQUIRED', 'Title and body are required.'); return; }
  guestAccessSlides.set(slide.id, slide); await saveDatabase(); response.json(getPublicGuestAccessSlide(slide));
});

app.delete('/api/admin/guest-access-slides/:slideId', authenticateToken, requireAdmin, async (request, response) => {
  guestAccessSlides.delete(request.params.slideId); ensureDefaultGuestAccessSlides(); await saveDatabase(); response.status(204).end();
});
app.get('/api/admin/dashboard-tips', authenticateToken, requireAdmin, (_request, response) => {
  ensureDefaultDashboardTips();
  response.json([...dashboardTips.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(getPublicDashboardTip));
});

app.post('/api/admin/dashboard-tips', authenticateToken, requireAdmin, async (request, response) => {
  const tip = normalizeDashboardTipPayload(request.body || {});
  if (!tip.body) {
    sendApiError(response, 400, 'TIP_BODY_REQUIRED', 'Le contenu de l’astuce est requis.');
    return;
  }
  dashboardTips.set(tip.id, tip);
  await saveDatabase();
  io.emit('dashboard:tips-updated', getPublicDashboardTip(tip));
  response.status(201).json(getPublicDashboardTip(tip));
});

app.put('/api/admin/dashboard-tips/:tipId', authenticateToken, requireAdmin, async (request, response) => {
  const existing = dashboardTips.get(request.params.tipId);
  if (!existing) {
    sendApiError(response, 404, 'TIP_NOT_FOUND', 'Astuce introuvable.');
    return;
  }
  const tip = normalizeDashboardTipPayload(request.body || {}, existing);
  if (!tip.body) {
    sendApiError(response, 400, 'TIP_BODY_REQUIRED', 'Le contenu de l’astuce est requis.');
    return;
  }
  dashboardTips.set(tip.id, tip);
  await saveDatabase();
  io.emit('dashboard:tips-updated', getPublicDashboardTip(tip));
  response.json(getPublicDashboardTip(tip));
});

app.delete('/api/admin/dashboard-tips/:tipId', authenticateToken, requireAdmin, async (request, response) => {
  dashboardTips.delete(request.params.tipId);
  ensureDefaultDashboardTips();
  await saveDatabase();
  io.emit('dashboard:tips-updated');
  response.status(204).end();
});

app.get('/api/dashboard/tips', authenticateToken, (_request, response) => {
  ensureDefaultDashboardTips();
  response.json([...dashboardTips.values()]
    .filter((tip) => isDashboardTipVisible(tip))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(getPublicDashboardTip));
});

app.get('/api/meetings', authenticateToken, (_request, response) => {
  response.json([...meetings.values()]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map(getPublicMeeting));
});

const normalizeInvitationEmails = (value: unknown) => Array.isArray(value)
  ? [...new Set(value
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))]
    .slice(0, 100)
  : [];

const escapeInvitationHtml = (value: unknown) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const sendMeetingInvitations = async (
  meeting: Meeting,
  emails: string[],
  password: string,
  clientOrigin: string,
) => {
  if (!emails.length) return { configured: Boolean(process.env.RESEND_API_KEY), sent: 0, failed: 0 };
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('Invitations non envoyées : RESEND_API_KEY est absent.');
    return { configured: false, sent: 0, failed: emails.length };
  }

  const from = String(process.env.MEETING_INVITE_FROM || 'MBotéRoom <onboarding@resend.dev>').trim();
  const meetingId = String(meeting.settings.meetingAccessId || meeting.meeting_link.slice(-6)).toUpperCase();
  const joinUrl = new URL(`/join/${meeting.meeting_link}`, clientOrigin).toString();
  const safeTitle = escapeInvitationHtml(meeting.title);
  const safeHost = escapeInvitationHtml(meeting.host_name);
  const safeMeetingId = escapeInvitationHtml(meetingId);
  const safePassword = escapeInvitationHtml(password);
  const safeJoinUrl = escapeInvitationHtml(joinUrl);

  const results = await Promise.all(emails.map(async (email) => {
    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `Invitation à la réunion : ${meeting.title}`,
          text: `${meeting.host_name} vous invite à la réunion "${meeting.title}".\nID : ${meetingId}\nMot de passe : ${password}\nRejoindre : ${joinUrl}`,
          html: `<div style="font-family:Arial,sans-serif;color:#17213c;line-height:1.6"><h2>Invitation MBotéRoom</h2><p><strong>${safeHost}</strong> vous invite à la réunion <strong>${safeTitle}</strong>.</p><p><strong>ID de la réunion :</strong> ${safeMeetingId}<br><strong>Mot de passe :</strong> ${safePassword}</p><p><a href="${safeJoinUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#315cf5;color:#fff;text-decoration:none;font-weight:700">Rejoindre la réunion</a></p></div>`,
        }),
        signal: AbortSignal.timeout(12000),
      });
      return resendResponse.ok;
    } catch {
      return false;
    }
  }));

  const sent = results.filter(Boolean).length;
  return { configured: true, sent, failed: emails.length - sent };
};

app.post('/api/meetings', authenticateToken, async (request: AuthedRequest, response) => {
  const invitationEmails = normalizeInvitationEmails(request.body?.participants);
  const invitationPassword = String(request.body?.settings?.password || '').trim();
  const meeting = normalizeMeetingPayload(request.body || {}, request.user!);
  meetings.set(meeting.id, meeting);
  lobby.set(meeting.id, []);
  mediaRequests.set(meeting.id, []);
  await saveDatabase();
  io.emit('meeting:created', getPublicMeeting(meeting));
  const invitations = await sendMeetingInvitations(
    meeting,
    invitationEmails,
    invitationPassword,
    getMboteRoomClientOrigin(request),
  );
  response.status(201).json({ ...getPublicMeeting(meeting), invitations });
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
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }

  if (!validateMeetingPassword(meeting, request.body?.password)) {
    sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
    return;
  }

  response.json(getPublicMeeting(meeting));
});

app.get('/api/meetings/link/:meetingLink', authenticateToken, (request, response) => {
  const meeting = [...meetings.values()].find((item) => item.meeting_link === request.params.meetingLink);
  if (!meeting) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }
  response.json(getPublicMeeting(meeting));
});

app.get('/api/meetings/:meetingId/ended', authenticateToken, (request: AuthedRequest, response) => {
  const meeting = findMeetingByAccessValue(request.params.meetingId);
  if (!meeting) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }

  if (!canEnterMeeting(meeting, request.user!)) {
    sendApiError(response, 403, 'MEETING_ACCESS_DENIED', 'Accès refusé à cette réunion.');
    return;
  }

  response.json(buildEndedMeetingPayload(meeting, request.user!));
});

app.put('/api/meetings/:meetingId', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const existing = meetings.get(meetingId);
  if (!existing) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }
  const canManage = isMeetingModerator(existing, request.user!);
  if (!canManage) {
    sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut modifier cette réunion.');
    return;
  }
  const updated = normalizeMeetingPayload(request.body || {}, request.user!, existing);
  meetings.set(meetingId, updated);
  await saveDatabase();
  io.emit('meeting:updated', getPublicMeeting(updated));
  response.json(getPublicMeeting(updated));
});

app.delete('/api/meetings/:meetingId', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (meeting && !isMeetingModerator(meeting, request.user!)) {
    sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut supprimer cette réunion.');
    return;
  }
  meetings.delete(meetingId);
  lobby.delete(meetingId);
  mediaRequests.delete(meetingId);
  await saveDatabase();
  io.emit('meeting:cancelled', { meetingId });
  response.status(204).end();
});

app.get('/api/meetings/:meetingId/lobby', authenticateToken, (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
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
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }

  if (!validateMeetingPassword(meeting, request.body?.password)) {
    sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
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
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }
  if (!isMeetingModerator(meeting, request.user!)) {
    sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut démarrer cette réunion.');
    return;
  }
  meeting.is_active = true;
  await saveDatabase();
  io.emit('meeting:started', getPublicMeeting(meeting));
  response.json({ success: true, notifiedCount: Math.max(0, meeting.participant_count - 1), meeting: getPublicMeeting(meeting) });
});

app.post('/api/meetings/:meetingId/lobby/respond', authenticateToken, async (request: AuthedRequest, response) => {
  const meetingId = Number(request.params.meetingId);
  const meeting = meetings.get(meetingId);
  if (!meeting || !isMeetingModerator(meeting, request.user!)) {
    sendApiError(response, 403, 'LOBBY_HOST_REQUIRED', 'Seul l’hôte peut gérer le lobby.');
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
    sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
    return;
  }
  if (!isMeetingModerator(meeting, request.user!)) {
    sendApiError(response, 403, 'MEETING_HOST_REQUIRED', 'Seul l’hôte peut demander un contrôle média.');
    return;
  }
  const targetUserId = Number(request.body?.targetUserId);
  const targetUser = users.get(targetUserId);
  if (!targetUser || !canEnterMeeting(meeting, getPublicUser(targetUser))) {
    sendApiError(response, 404, 'PARTICIPANT_NOT_FOUND', 'Participant introuvable dans cette réunion.');
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
    sendApiError(response, 403, 'MEDIA_REQUEST_ACCESS_DENIED', 'Accès refusé à cette réunion.');
    return;
  }
  const rows = mediaRequests.get(Number(request.params.meetingId)) || [];
  response.json(rows.filter((item) => item.status === 'pending' && item.targetUserId === request.user!.id));
});

app.post('/api/meetings/:meetingId/media-requests/:requestId/respond', authenticateToken, async (request: AuthedRequest, response) => {
  const rows = mediaRequests.get(Number(request.params.meetingId)) || [];
  const item = rows.find((row) => row.id === request.params.requestId);
  if (!item) {
    sendApiError(response, 404, 'MEDIA_REQUEST_NOT_FOUND', 'Demande introuvable.');
    return;
  }
  if (item.targetUserId !== request.user!.id) {
    sendApiError(response, 403, 'MEDIA_REQUEST_FORBIDDEN', 'Cette demande ne vous est pas destinée.');
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
    sendApiError(response, 400, 'LUNA_PROMPT_REQUIRED', 'Message requis pour Luna IA.');
    return;
  }
  if (!meeting || !canEnterMeeting(meeting, request.user!)) {
    sendApiError(response, 403, 'LUNA_ACCESS_DENIED', 'Accès refusé à cette réunion.');
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

type RealtimeErrorCode =
  | 'REALTIME_AUTH_REQUIRED'
  | 'REALTIME_MEETING_INVALID'
  | 'REALTIME_MEETING_ACCESS_DENIED'
  | 'REALTIME_NOT_JOINED'
  | 'REALTIME_TARGET_INVALID';

type RealtimeCallbackError = {
  ok: false;
  code: RealtimeErrorCode;
  error: string;
};

const createRealtimeError = (code: RealtimeErrorCode, error: string): RealtimeCallbackError => ({
  ok: false,
  code,
  error,
});

const createRealtimeConnectionError = (code: RealtimeErrorCode, message: string) => {
  const error = new Error(message) as Error & { data?: { code: RealtimeErrorCode; error: string } };
  error.data = { code, error: message };
  return error;
};

io.use((socket, next) => {
  const user = getUserByToken(socket.handshake.auth?.token);
  if (!user) {
    next(createRealtimeConnectionError('REALTIME_AUTH_REQUIRED', 'Session invalide.'));
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
      next(createRealtimeConnectionError('REALTIME_AUTH_REQUIRED', 'Session invalide.'));
      return;
    }

    if (eventName === 'meeting:join') {
      const meetingId = Number(payload?.meetingId);
      const meeting = meetings.get(meetingId);
      if (!meeting) {
        callback?.(createRealtimeError('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
        return;
      }
      if (!canEnterMeeting(meeting, user)) {
        callback?.(createRealtimeError('REALTIME_MEETING_ACCESS_DENIED', 'Accès non autorisé à cette réunion.'));
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
      if (!meetingId || meetingId !== String(socket.data.meetingId || '')) {
        callback?.(createRealtimeError('REALTIME_NOT_JOINED', 'Vous devez rejoindre la réunion avant cette action.'));
        return;
      }
      packet[1] = { ...(payload || {}), media: sanitizeMediaState(payload?.media) };
      next();
      return;
    }

    if (['meeting:offer', 'meeting:answer', 'meeting:ice-candidate'].includes(eventName)) {
      const meetingId = String(payload?.meetingId || '');
      const targetSocketId = String(payload?.targetSocketId || '');
      const participants = meetingParticipants.get(meetingId);
      if (meetingId !== String(socket.data.meetingId || '') || !participants?.has(socket.id) || !participants.has(targetSocketId)) {
        callback?.(createRealtimeError('REALTIME_TARGET_INVALID', 'Participant cible introuvable.'));
        return;
      }
      next();
      return;
    }

    next();
  });

  socket.on('meeting:join', (payload, callback) => {
    const meetingId = String(payload?.meetingId || '');
    if (!meetingId) {
      callback?.(createRealtimeError('REALTIME_MEETING_INVALID', 'Réunion invalide.'));
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

  socket.on('meeting:chat-message', (payload) => {
    const meetingId = String(payload?.meetingId || socket.data.meetingId || '');
    const roomName = String(socket.data.roomName || '');
    const user = socket.data.user as PublicUser | undefined;
    if (!user || !meetingId || roomName !== `meeting:${meetingId}`) return;
    const text = normalizePlainText(payload?.text).slice(0, 800);
    if (!text) return;
    io.to(roomName).emit('meeting:chat-message', {
      id: `${Date.now()}-${socket.id}`,
      meetingId,
      userId: user.id,
      sender: user.name || user.email || 'Participant',
      text,
      time: new Date().toISOString(),
    });
  });

  socket.on('meeting:hand-raised', (payload) => {
    const meetingId = String(payload?.meetingId || socket.data.meetingId || '');
    const roomName = String(socket.data.roomName || '');
    const user = socket.data.user as PublicUser | undefined;
    if (!user || !meetingId || roomName !== `meeting:${meetingId}`) return;
    socket.to(roomName).emit('meeting:hand-raised', {
      meetingId,
      userId: user.id,
      name: user.name || user.email || 'Participant',
      raised: Boolean(payload?.raised),
    });
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
