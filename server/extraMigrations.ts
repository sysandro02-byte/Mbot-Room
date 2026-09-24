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
      slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 4),
      title text NOT NULL,
      body text NOT NULL,
      image_url text NOT NULL DEFAULT '',
      action_label text NOT NULL DEFAULT '',
      action_path text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE room_home_slides DROP CONSTRAINT IF EXISTS room_home_slides_slot_check;
    ALTER TABLE room_home_slides ADD CONSTRAINT room_home_slides_slot_check CHECK (slot BETWEEN 1 AND 4);

    INSERT INTO room_home_slides (slot,title,body,image_url,action_label,action_path,is_active) VALUES
      (1,'Réunions simples, professionnelles et sécurisées','Créez, planifiez et animez vos réunions depuis un espace pensé pour vos équipes.','/images/mboteroom-home-hero.svg','Créer une réunion','/app/meetings',true),
      (2,'Retrouvez votre équipe en quelques secondes','Rejoignez une réunion par ID ou par lien, avec salle d’attente et contrôles de sécurité.','','Rejoindre une réunion','/join',true),
      (3,'Collaborez avec Luna IA','Retrouvez les décisions, points clés, messages et actions importantes de vos réunions.','','Découvrir mes réunions','/app/meetings',true),
      (4,'Des réunions plus humaines avec MBotéRoom','Collaborez, partagez, créez, où que vous soyez.','/images/mboteroom-home-banner.svg','Découvrir toutes les fonctionnalités','/fonctionnalites',true)
    ON CONFLICT (slot) DO NOTHING;

    UPDATE room_home_slides
       SET image_url='/images/mboteroom-home-hero.svg', updated_at=now()
     WHERE slot=1 AND (image_url='' OR image_url='/images/meeting-black-team.svg');

    CREATE TABLE IF NOT EXISTS room_login_branding (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      wordmark_url text NOT NULL DEFAULT '/icons/mboteroom-wordmark.png',
      illustration_url text NOT NULL DEFAULT '/images/meeting-black-team.svg',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO room_login_branding (id,wordmark_url,illustration_url)
    VALUES (1,'/icons/mboteroom-wordmark.png','/images/meeting-black-team.svg')
    ON CONFLICT (id) DO NOTHING;

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
      ('publicMeetingsEnabled',true),
      ('premiumPaymentEnabled',false),
      ('guestRaiseHandEnabled',false),
      ('guestRecordingEnabled',false),
      ('guestScreenShareEnabled',false),
      ('guestLunaEnabled',false),
      ('guestTranscriptionEnabled',false),
      ('guestChatEnabled',false)
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

    ALTER TABLE room_calendar_events ADD COLUMN IF NOT EXISTS google_event_id text;
    ALTER TABLE room_calendar_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'mboteroom';
    ALTER TABLE room_calendar_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE UNIQUE INDEX IF NOT EXISTS room_calendar_google_event_unique
      ON room_calendar_events(user_id, google_event_id)
      WHERE google_event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS room_google_calendar_connections (
      user_id integer PRIMARY KEY REFERENCES room_users(id) ON DELETE CASCADE,
      access_token_enc text NOT NULL,
      refresh_token_enc text NOT NULL DEFAULT '',
      expires_at timestamptz,
      scope text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS room_google_oauth_states (
      state text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      return_to text NOT NULL DEFAULT '/app/calendar',
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_google_oauth_states_expires_idx ON room_google_oauth_states(expires_at);

    CREATE TABLE IF NOT EXISTS room_files (
      id uuid PRIMARY KEY,
      owner_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      name text NOT NULL,
      mime_type text NOT NULL,
      size_bytes integer NOT NULL,
      content bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_files_owner_created_idx ON room_files(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS room_work_groups (
      id uuid PRIMARY KEY,
      owner_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS room_work_groups_owner_idx ON room_work_groups(owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS room_work_group_members (
      group_id uuid NOT NULL REFERENCES room_work_groups(id) ON DELETE CASCADE,
      email text NOT NULL,
      user_id integer REFERENCES room_users(id) ON DELETE SET NULL,
      role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, email)
    );
    CREATE INDEX IF NOT EXISTS room_work_group_members_user_idx ON room_work_group_members(user_id);

    CREATE TABLE IF NOT EXISTS room_work_group_files (
      group_id uuid NOT NULL REFERENCES room_work_groups(id) ON DELETE CASCADE,
      file_id uuid NOT NULL REFERENCES room_files(id) ON DELETE CASCADE,
      uploaded_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, file_id)
    );

    CREATE TABLE IF NOT EXISTS room_work_group_calls (
      id uuid PRIMARY KEY,
      group_id uuid NOT NULL REFERENCES room_work_groups(id) ON DELETE CASCADE,
      meeting_id integer NOT NULL REFERENCES room_meetings(id) ON DELETE CASCADE,
      call_type text NOT NULL CHECK (call_type IN ('audio','video')),
      created_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (group_id, meeting_id)
    );
    CREATE INDEX IF NOT EXISTS room_work_group_calls_group_idx ON room_work_group_calls(group_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS room_user_contacts (
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      contact_user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      favorite boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, contact_user_id),
      CHECK (user_id <> contact_user_id)
    );
    CREATE INDEX IF NOT EXISTS room_user_contacts_contact_idx ON room_user_contacts(contact_user_id);

    CREATE TABLE IF NOT EXISTS room_conversations (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('direct','work_group')),
      title text NOT NULL DEFAULT '',
      created_by integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      work_group_id uuid REFERENCES room_work_groups(id) ON DELETE CASCADE,
      direct_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS room_conversations_direct_unique
      ON room_conversations(direct_key) WHERE direct_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS room_conversations_group_unique
      ON room_conversations(work_group_id) WHERE work_group_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS room_conversations_updated_idx ON room_conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS room_conversation_members (
      conversation_id uuid NOT NULL REFERENCES room_conversations(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      pinned boolean NOT NULL DEFAULT false,
      archived boolean NOT NULL DEFAULT false,
      notifications_enabled boolean NOT NULL DEFAULT true,
      last_read_at timestamptz NOT NULL DEFAULT now(),
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS room_conversation_members_user_idx
      ON room_conversation_members(user_id, archived, pinned);

    CREATE TABLE IF NOT EXISTS room_conversation_messages (
      id uuid PRIMARY KEY,
      conversation_id uuid NOT NULL REFERENCES room_conversations(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      text text NOT NULL DEFAULT '',
      file_id uuid REFERENCES room_files(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS room_conversation_messages_conversation_idx
      ON room_conversation_messages(conversation_id, created_at DESC);
  `);
};
