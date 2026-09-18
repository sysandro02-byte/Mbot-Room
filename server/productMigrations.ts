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

    CREATE TABLE IF NOT EXISTS room_captions (
      id uuid PRIMARY KEY,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      speaker text NOT NULL,
      text text NOT NULL,
      breakout_room_id uuid REFERENCES room_breakout_rooms(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_captions_meeting_created_idx ON room_captions(meeting_id, created_at);
    CREATE INDEX IF NOT EXISTS room_captions_user_idx ON room_captions(user_id);
  `);
};
