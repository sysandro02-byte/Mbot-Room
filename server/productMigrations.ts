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
  `);
};
