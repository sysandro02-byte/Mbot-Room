import type { Preferences } from '../services/appDataService';

export type PreferencesBackupIdentity = { id?: string | number | null; email?: string | null };

type PlainObject = Record<string, unknown>;
const isObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const PREFERENCES_BACKUP_MAX_BYTES = 256 * 1024;

export const createPreferencesBackup = (identity: PreferencesBackupIdentity, preferences: Preferences) => ({
  application: 'MBotéRoom',
  schemaVersion: 1,
  exportType: 'preferences-only',
  exportedAt: new Date().toISOString(),
  note: 'Cet export contient uniquement des préférences. Messages, fichiers, réunions et sessions ne sont pas inclus.',
  user: { id: identity.id, email: identity.email },
  preferences,
});

const flags: ReadonlySet<string> = new Set([
  'notifications', 'emailNotifications', 'audio', 'video', 'defaultMic', 'defaultCamera',
  'notificationSounds', 'vibration', 'lockScreenPreview', 'noiseReduction',
  'hdVideo', 'lunaAutoSummary', 'lunaRealtimeTranslation', 'lunaActionSuggestions',
  'dataSaver', 'waitingRoomDefault', 'meetingLockDefault',
  'participantAudioAllowed', 'participantVideoAllowed', 'screenShareAllowed',
]);
const allowedStrings: Record<string, readonly string[]> = {
  language: ['fr', 'en', 'ln', 'ar'],
  theme: ['system', 'light', 'dark'],
  textSize: ['small', 'normal', 'large'],
  mediaDownload: ['wifi', 'always', 'never'],
  chatBackground: ['default', 'soft', 'dark'],
};
const allowedNumbers: Record<string, readonly number[]> = {
  automaticLogoutMinutes: [0, 5, 15, 30, 60, 240],
  autoArchiveDays: [0, 7, 30, 90],
};

/** Parse a same-account export. Never restore sessions, authentication or arbitrary object keys. */
export function parsePreferencesBackup(text: string, identity: PreferencesBackupIdentity): Preferences {
  if (new TextEncoder().encode(text).byteLength > PREFERENCES_BACKUP_MAX_BYTES) {
    throw new Error('Le fichier dépasse la taille autorisée de 256 Ko.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Le fichier de sauvegarde n’est pas un JSON valide.'); }
  if (!isObject(parsed) || parsed.application !== 'MBotéRoom' || parsed.exportType !== 'preferences-only'
    || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)
    || !isObject(parsed.user) || !isObject(parsed.preferences)) {
    throw new Error('Ce fichier ne correspond pas à une sauvegarde de préférences MBotéRoom.');
  }
  const accountId = String(identity.id ?? '').trim();
  const sourceId = String(parsed.user.id ?? '').trim();
  if (!accountId || !sourceId || accountId !== sourceId) {
    throw new Error('Cette sauvegarde appartient à un autre compte MBotéRoom.');
  }
  const accountEmail = String(identity.email || '').trim().toLowerCase();
  const sourceEmail = String(parsed.user.email || '').trim().toLowerCase();
  if (accountEmail && sourceEmail && accountEmail !== sourceEmail) {
    throw new Error('L’adresse e-mail de la sauvegarde ne correspond pas au compte actif.');
  }

  const input = parsed.preferences;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (flags.has(key)) {
      if (typeof value !== 'boolean') throw new Error('Le réglage « ' + key + ' » est invalide.');
      output[key] = value;
    } else if (Object.hasOwn(allowedStrings, key)) {
      if (typeof value !== 'string' || !allowedStrings[key].includes(value)) {
        throw new Error('Le réglage « ' + key + ' » est invalide.');
      }
      output[key] = value;
    } else if (Object.hasOwn(allowedNumbers, key)) {
      if (typeof value !== 'number' || !allowedNumbers[key].includes(value)) {
        throw new Error('Le réglage « ' + key + ' » est invalide.');
      }
      output[key] = value;
    } else if (['background', 'timezone'].includes(key)) {
      if (typeof value !== 'string' || value.length > 200) {
        throw new Error('Le réglage « ' + key + ' » est invalide.');
      }
      output[key] = value;
    } else if (key === 'accessibility') {
      if (!isObject(value) || Object.keys(value).length > 20) {
        throw new Error('Le réglage d’accessibilité est invalide.');
      }
      const clean: Record<string, boolean> = {};
      for (const [entry, setting] of Object.entries(value)) {
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(entry) || typeof setting !== 'boolean') {
          throw new Error('Le réglage d’accessibilité est invalide.');
        }
        clean[entry] = setting;
      }
      output.accessibility = clean;
    } else {
      // Ignore unknown settings rather than trusting arbitrary keys from a user-provided file.
      continue;
    }
  }
  if (!Object.keys(output).length) throw new Error('Aucune préférence reconnue dans ce fichier.');
  return output as Preferences;
}
