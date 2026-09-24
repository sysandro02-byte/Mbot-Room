import { query } from './core.js';

export type PlatformSettingKey =
  | 'registrationEnabled'
  | 'guestAccessEnabled'
  | 'meetingCreationEnabled'
  | 'lunaEnabled'
  | 'recordingEnabled'
  | 'publicMeetingsEnabled'
  | 'premiumPaymentEnabled'
  | 'guestRaiseHandEnabled'
  | 'guestRecordingEnabled'
  | 'guestScreenShareEnabled'
  | 'guestLunaEnabled'
  | 'guestTranscriptionEnabled'
  | 'guestChatEnabled';

export type PlatformSettings = Record<PlatformSettingKey, boolean>;

export const platformSettingDefaults: PlatformSettings = {
  registrationEnabled: true,
  guestAccessEnabled: true,
  meetingCreationEnabled: true,
  lunaEnabled: true,
  recordingEnabled: true,
  publicMeetingsEnabled: true,
  premiumPaymentEnabled: false,
  guestRaiseHandEnabled: false,
  guestRecordingEnabled: false,
  guestScreenShareEnabled: false,
  guestLunaEnabled: false,
  guestTranscriptionEnabled: false,
  guestChatEnabled: false,
};

export const getPlatformSettings = async (): Promise<PlatformSettings> => {
  const result = await query('SELECT key,enabled FROM room_platform_settings');
  const settings = { ...platformSettingDefaults };
  for (const row of result.rows) {
    const key = String(row.key) as PlatformSettingKey;
    if (key in settings) settings[key] = Boolean(row.enabled);
  }
  return settings;
};

export const isPlatformFeatureEnabled = async (key: PlatformSettingKey) => {
  const result = await query('SELECT enabled FROM room_platform_settings WHERE key=$1 LIMIT 1', [key]);
  return result.rows[0] ? Boolean(result.rows[0].enabled) : platformSettingDefaults[key];
};

export const updatePlatformSettings = async (patch: Partial<PlatformSettings>) => {
  const allowed = Object.keys(platformSettingDefaults) as PlatformSettingKey[];
  for (const key of allowed) {
    if (typeof patch[key] !== 'boolean') continue;
    await query(
      `INSERT INTO room_platform_settings (key,enabled,updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET enabled=excluded.enabled,updated_at=now()`,
      [key, patch[key]],
    );
  }
  return getPlatformSettings();
};
