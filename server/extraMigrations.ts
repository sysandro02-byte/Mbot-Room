import { query } from './core.js';

export const runExtraMigrations = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS room_media_requests (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      target_user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      requested_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      requested_by_name text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('mic','camera')),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS room_dashboard_tips (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      body text NOT NULL,
      action_label text NOT NULL DEFAULT '',
      action_path text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      starts_at timestamptz,
      ends_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_guest_access_slides (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      body text NOT NULL,
      image_url text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_user_preferences (
      user_id integer PRIMARY KEY REFERENCES room_users(id) ON DELETE CASCADE,
      preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_calendar_events (
      id uuid PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      meeting_id integer REFERENCES room_meetings(id) ON DELETE SET NULL,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_notifications (
      id uuid PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL DEFAULT '',
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_notifications_user_created_idx ON room_notifications(user_id, created_at DESC);
  `);
};
