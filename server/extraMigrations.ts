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

    CREATE TABLE IF NOT EXISTS room_home_slides (
      slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
      title text NOT NULL,
      body text NOT NULL,
      image_url text NOT NULL DEFAULT '',
      action_label text NOT NULL DEFAULT '',
      action_path text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO room_home_slides (slot,title,body,image_url,action_label,action_path,is_active) VALUES
      (1,'Réunions simples, professionnelles et sécurisées','Créez, planifiez et animez vos réunions depuis un espace pensé pour vos équipes.','/images/meeting-black-team.svg','Créer une réunion','/app/meetings',true),
      (2,'Retrouvez votre équipe en quelques secondes','Rejoignez une réunion par ID ou par lien, avec salle d’attente et contrôles de sécurité.','','Rejoindre une réunion','/join',true),
      (3,'Collaborez avec Luna IA','Retrouvez les décisions, points clés, messages et actions importantes de vos réunions.','','Découvrir mes réunions','/app/meetings',true)
    ON CONFLICT (slot) DO NOTHING;

    CREATE TABLE IF NOT EXISTS room_platform_settings (
      key text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO room_platform_settings (key,enabled) VALUES
      ('registrationEnabled',true),
      ('guestAccessEnabled',true),
      ('meetingCreationEnabled',true),
      ('lunaEnabled',true),
      ('recordingEnabled',true),
      ('publicMeetingsEnabled',true)
    ON CONFLICT (key) DO NOTHING;

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
