import { query } from './core.js';

export const runProductMigrations = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS room_whiteboards (
      id uuid PRIMARY KEY,
      owner_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      meeting_id integer REFERENCES room_meetings(id) ON DELETE SET NULL,
      title text NOT NULL DEFAULT 'Tableau blanc',
      document jsonb NOT NULL DEFAULT '{"strokes":[]}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_whiteboards_owner_updated_idx ON room_whiteboards(owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS room_breakout_rooms (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      name text NOT NULL,
      created_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      is_open boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_breakout_rooms_meeting_idx ON room_breakout_rooms(meeting_id, created_at);

    CREATE TABLE IF NOT EXISTS room_breakout_members (
      breakout_room_id uuid NOT NULL REFERENCES room_breakout_rooms(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      assigned_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      joined_at timestamptz,
      left_at timestamptz,
      PRIMARY KEY (breakout_room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS room_breakout_members_user_idx ON room_breakout_members(user_id);
    CREATE INDEX IF NOT EXISTS room_breakout_members_assigned_by_idx ON room_breakout_members(assigned_by);

    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual';
    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS provider_recording_id text NOT NULL DEFAULT '';
    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS ended_at timestamptz;
    ALTER TABLE room_recordings ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS room_recordings_provider_id_idx ON room_recordings(provider_recording_id);
    CREATE INDEX IF NOT EXISTS room_recordings_meeting_status_idx ON room_recordings(meeting_id,status,created_at DESC);

    CREATE TABLE IF NOT EXISTS room_recording_user_state (
      recording_id uuid NOT NULL REFERENCES room_recordings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      favorite boolean NOT NULL DEFAULT false,
      hidden boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recording_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS room_recording_user_state_user_idx
      ON room_recording_user_state(user_id,hidden,favorite,updated_at DESC);

    CREATE TABLE IF NOT EXISTS room_push_subscriptions (
      id uuid PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      expiration_time bigint,
      user_agent text NOT NULL DEFAULT '',
      platform text NOT NULL DEFAULT 'web',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_push_subscriptions_user_idx ON room_push_subscriptions(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS room_login_otps (
      challenge_id uuid PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      code_hash text NOT NULL,
      remember_me boolean NOT NULL DEFAULT false,
      purpose text NOT NULL DEFAULT 'login',
      attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE room_login_otps ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';
    CREATE INDEX IF NOT EXISTS room_login_otps_user_created_idx ON room_login_otps(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS room_login_otps_expires_idx ON room_login_otps(expires_at);

    CREATE TABLE IF NOT EXISTS room_captions (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      speaker text NOT NULL,
      text text NOT NULL,
      breakout_room_id uuid REFERENCES room_breakout_rooms(id) ON DELETE SET NULL,
      provider text NOT NULL DEFAULT 'browser',
      language text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE room_captions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'browser';
    ALTER TABLE room_captions ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS room_captions_meeting_created_idx ON room_captions(meeting_id, created_at);
    CREATE INDEX IF NOT EXISTS room_captions_user_idx ON room_captions(user_id);

    CREATE TABLE IF NOT EXISTS room_live_sessions (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL UNIQUE REFERENCES room_meetings(id) ON DELETE CASCADE,
      host_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT 'other',
      visibility text NOT NULL DEFAULT 'public',
      cover_url text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'scheduled',
      scheduled_for timestamptz NOT NULL,
      started_at timestamptz,
      ended_at timestamptz,
      chat_enabled boolean NOT NULL DEFAULT true,
      cohosts_enabled boolean NOT NULL DEFAULT true,
      recording_enabled boolean NOT NULL DEFAULT false,
      moderation_enabled boolean NOT NULL DEFAULT true,
      viewer_count integer NOT NULL DEFAULT 0,
      peak_viewer_count integer NOT NULL DEFAULT 0,
      like_count integer NOT NULL DEFAULT 0,
      share_count integer NOT NULL DEFAULT 0,
      share_token text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_live_sessions_feed_idx ON room_live_sessions(status,visibility,scheduled_for DESC);
    CREATE INDEX IF NOT EXISTS room_live_sessions_host_idx ON room_live_sessions(host_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS room_live_viewers (
      live_id uuid NOT NULL REFERENCES room_live_sessions(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      joined_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      left_at timestamptz,
      PRIMARY KEY(live_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS room_live_viewers_presence_idx ON room_live_viewers(live_id,left_at,last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS room_live_comments (
      id uuid PRIMARY KEY,
      live_id uuid NOT NULL REFERENCES room_live_sessions(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS room_live_comments_live_idx ON room_live_comments(live_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS room_live_likes (
      live_id uuid NOT NULL REFERENCES room_live_sessions(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(live_id,user_id)
    );

    CREATE TABLE IF NOT EXISTS room_live_follows (
      creator_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      follower_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(creator_id,follower_id)
    );
    CREATE INDEX IF NOT EXISTS room_live_follows_follower_idx ON room_live_follows(follower_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS room_live_participation_requests (
      live_id uuid NOT NULL REFERENCES room_live_sessions(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz,
      PRIMARY KEY(live_id,user_id)
    );
  `);
};
