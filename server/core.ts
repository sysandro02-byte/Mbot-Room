import crypto from 'node:crypto';
import type express from 'express';
import pg from 'pg';

export type UserRole = 'admin' | 'user' | 'guest';

export type PublicUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  avatar: string;
  phoneNumber?: string;
  organization?: string;
  jobTitle?: string;
  mboteUserId?: string;
  isGuest: boolean;
  role: UserRole;
  permissions: string[];
  createdAt: string;
};

export type AuthedRequest = express.Request & { user?: PublicUser };

export type MeetingSettings = {
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

export type Meeting = {
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
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const adminPermissions = [
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

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
export const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, ssl: process.env.PGSSLMODE === 'disable' ? undefined : { rejectUnauthorized: false } })
  : null;

export const hasDatabase = () => Boolean(pool);

export const query = async <T = any>(text: string, params: unknown[] = []) => {
  if (!pool) throw new Error('DATABASE_URL is required');
  return pool.query<T>(text, params);
};

export const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();
export const normalizeText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
export const createToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const createId = () => crypto.randomUUID();
export const createMeetingLink = () => `room-${crypto.randomBytes(10).toString('base64url').toLowerCase()}`;
export const createMeetingAccessId = () => {
  const digits = crypto.randomBytes(8).reduce((value, byte) => `${value}${byte % 10}`, '').slice(0, 10);
  return digits.replace(/^0/, '9').padEnd(10, '0');
};

export const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});

export const verifyPasswordHash = (password: string, salt: string, expectedHash: string) => {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
};

export const getConfiguredAdminEmails = () => String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(normalizeEmail)
  .filter(Boolean);

const resolveRole = (row: any): UserRole => {
  if (row.is_guest) return 'guest';
  if (row.role === 'admin' || Number(row.id) === 1 || getConfiguredAdminEmails().includes(normalizeEmail(row.email))) return 'admin';
  return 'user';
};

export const toPublicUser = (row: any): PublicUser => {
  const role = resolveRole(row);
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    username: String(row.username || ''),
    email: String(row.email || ''),
    avatar: String(row.avatar || ''),
    phoneNumber: String(row.phone_number || ''),
    organization: String(row.organization || ''),
    jobTitle: String(row.job_title || ''),
    mboteUserId: String(row.mbote_user_id || ''),
    isGuest: Boolean(row.is_guest),
    role,
    permissions: role === 'admin' ? adminPermissions : [],
    createdAt: String(row.created_at || ''),
  };
};

export const sanitizeMeetingSettings = (settings: MeetingSettings = {}) => {
  const { passwordHash: _hash, passwordSalt: _salt, ...publicSettings } = settings;
  return publicSettings;
};

export const mapMeeting = (row: any): Meeting => ({
  id: Number(row.id),
  title: String(row.title || ''),
  description: String(row.description || ''),
  host_id: Number(row.host_id),
  co_host_id: row.co_host_id ? Number(row.co_host_id) : undefined,
  host_name: String(row.host_name || ''),
  host_avatar: String(row.host_avatar || ''),
  start_time: new Date(row.start_time).toISOString(),
  duration: Number(row.duration || 60),
  meeting_link: String(row.meeting_link || ''),
  is_active: Boolean(row.is_active),
  settings: typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : (row.settings || {}),
  participant_count: Number(row.participant_count || 0),
  status: row.status || (row.is_active ? 'live' : 'scheduled'),
  started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
  ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
});

export const publicMeeting = (row: any): Meeting => {
  const meeting = mapMeeting(row);
  return { ...meeting, settings: sanitizeMeetingSettings(meeting.settings) };
};

export const sendApiError = (response: express.Response, status: number, code: string, error: string, details?: unknown) => {
  response.status(status).json({ error, code, ...(details ? { details } : {}) });
};

export const requireDatabase: express.RequestHandler = (_request, response, next) => {
  if (!pool) {
    sendApiError(response, 503, 'DATABASE_REQUIRED', 'La base PostgreSQL n’est pas configurée.');
    return;
  }
  next();
};

const getBearerToken = (request: express.Request) => {
  const [scheme, token] = String(request.headers.authorization || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

export const getUserByRawToken = async (rawToken: string): Promise<PublicUser | null> => {
  if (!pool || !rawToken) return null;
  const result = await query(
    `SELECT u.* FROM room_sessions s
       JOIN room_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at::timestamptz > now()
      LIMIT 1`,
    [hashToken(rawToken)],
  );
  return result.rows[0] ? toPublicUser(result.rows[0]) : null;
};

export const authenticateToken: express.RequestHandler = async (request: AuthedRequest, response, next) => {
  try {
    const user = await getUserByRawToken(getBearerToken(request));
    if (!user) {
      sendApiError(response, 401, 'AUTH_REQUIRED', 'Authentification requise.');
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdmin: express.RequestHandler = (request: AuthedRequest, response, next) => {
  if (request.user?.role !== 'admin') {
    sendApiError(response, 403, 'ADMIN_ACCESS_DENIED', 'Accès administrateur refusé.');
    return;
  }
  next();
};

export const createSession = async (userId: number, rememberMe = false) => {
  const token = createToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (rememberMe ? 30 : 0.5) * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO room_sessions (token_hash, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), userId, createdAt.toISOString(), expiresAt.toISOString()],
  );
  const userResult = await query('SELECT * FROM room_users WHERE id = $1', [userId]);
  return { token, expiresAt: expiresAt.toISOString(), user: toPublicUser(userResult.rows[0]) };
};

export const canModerateMeeting = (meeting: Meeting, user: PublicUser) =>
  meeting.host_id === user.id || meeting.co_host_id === user.id || user.role === 'admin';

export const hasMeetingAccess = async (meetingId: number, user: PublicUser) => {
  if (user.role === 'admin') return true;
  const meetingResult = await query('SELECT * FROM room_meetings WHERE id = $1', [meetingId]);
  if (!meetingResult.rows[0]) return false;
  const meeting = mapMeeting(meetingResult.rows[0]);
  if (canModerateMeeting(meeting, user)) return true;
  const memberResult = await query(
    `SELECT 1 FROM room_meeting_members WHERE meeting_id = $1 AND user_id = $2 AND status = 'accepted' LIMIT 1`,
    [meetingId, user.id],
  );
  return Boolean(memberResult.rows[0]);
};

export const validateMeetingPassword = (meeting: Meeting, password: unknown) => {
  const settings = meeting.settings || {};
  if (!settings.passwordHash || !settings.passwordSalt) return true;
  return verifyPasswordHash(String(password || ''), settings.passwordSalt, settings.passwordHash);
};

export const runMigrations = async () => {
  if (!pool) return;
  await query(`
    CREATE SEQUENCE IF NOT EXISTS room_users_id_seq;
    CREATE SEQUENCE IF NOT EXISTS room_meetings_id_seq;

    CREATE TABLE IF NOT EXISTS room_users (
      id integer PRIMARY KEY DEFAULT nextval('room_users_id_seq'),
      name text NOT NULL,
      username text NOT NULL,
      email text NOT NULL UNIQUE,
      avatar text NOT NULL DEFAULT '',
      password_hash text NOT NULL DEFAULT '',
      password_salt text NOT NULL DEFAULT '',
      is_guest boolean NOT NULL DEFAULT false,
      created_at text NOT NULL
    );
    ALTER TABLE room_users ALTER COLUMN id SET DEFAULT nextval('room_users_id_seq');
    ALTER TABLE room_users ADD COLUMN IF NOT EXISTS phone_number text NOT NULL DEFAULT '';
    ALTER TABLE room_users ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT '';
    ALTER TABLE room_users ADD COLUMN IF NOT EXISTS job_title text NOT NULL DEFAULT '';
    ALTER TABLE room_users ADD COLUMN IF NOT EXISTS mbote_user_id text NOT NULL DEFAULT '';
    ALTER TABLE room_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

    CREATE TABLE IF NOT EXISTS room_sessions (
      token_hash text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at text NOT NULL,
      expires_at text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_meetings (
      id integer PRIMARY KEY DEFAULT nextval('room_meetings_id_seq'),
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      host_id integer NOT NULL,
      co_host_id integer,
      host_name text NOT NULL,
      host_avatar text NOT NULL DEFAULT '',
      start_time text NOT NULL,
      duration integer NOT NULL DEFAULT 60,
      meeting_link text NOT NULL UNIQUE,
      is_active boolean NOT NULL DEFAULT false,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      participant_count integer NOT NULL DEFAULT 1
    );
    ALTER TABLE room_meetings ALTER COLUMN id SET DEFAULT nextval('room_meetings_id_seq');
    ALTER TABLE room_meetings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled';
    ALTER TABLE room_meetings ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE room_meetings ADD COLUMN IF NOT EXISTS ended_at timestamptz;
    ALTER TABLE room_meetings ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE room_meetings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    CREATE TABLE IF NOT EXISTS room_lobby (
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      status text NOT NULL CHECK (status IN ('requested', 'accepted', 'rejected')),
      name text NOT NULL,
      avatar text NOT NULL DEFAULT '',
      PRIMARY KEY (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_meeting_members (
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'cohost', 'participant')),
      status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'left', 'removed')),
      muted_by_host boolean NOT NULL DEFAULT false,
      camera_disabled_by_host boolean NOT NULL DEFAULT false,
      joined_at timestamptz,
      left_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_meeting_bans (
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      banned_by integer NOT NULL REFERENCES room_users(id),
      reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      sender text NOT NULL,
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS room_messages_meeting_created_idx ON room_messages(meeting_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS room_polls (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      created_by integer NOT NULL REFERENCES room_users(id),
      question text NOT NULL,
      is_open boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS room_poll_options (
      id uuid PRIMARY KEY,
      poll_id uuid NOT NULL REFERENCES room_polls(id) ON DELETE CASCADE,
      label text NOT NULL,
      position integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS room_poll_answers (
      poll_id uuid NOT NULL REFERENCES room_polls(id) ON DELETE CASCADE,
      option_id uuid NOT NULL REFERENCES room_poll_options(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (poll_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_recordings (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      created_by integer NOT NULL REFERENCES room_users(id),
      storage_url text NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL DEFAULT 0,
      duration_seconds integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_meeting_summaries (
      meeting_id integer PRIMARY KEY REFERENCES room_meetings(id) ON DELETE CASCADE,
      bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
      decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
      actions jsonb NOT NULL DEFAULT '[]'::jsonb,
      next_meeting text NOT NULL DEFAULT '',
      provider text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_password_resets (
      token_hash text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    );

    SELECT setval('room_users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM room_users), 0) + 1, 1), false);
    SELECT setval('room_meetings_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM room_meetings), 0) + 1, 1), false);
  `);
};
