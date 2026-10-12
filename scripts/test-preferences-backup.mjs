import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Compile the exact browser TypeScript module; no parallel mock implementation.
const source = await readFile(new URL('../src/lib/preferencesBackup.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', target: 'es2022', format: 'esm' });
const backup = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const current = { id: 23, email: 'person@example.com' };
const expected = { language: 'fr', notifications: false, textSize: 'large', automaticLogoutMinutes: 5, accessibility: { enabled: true } };
const file = backup.createPreferencesBackup(current, expected);
assert.equal(file.exportType, 'preferences-only');
assert.deepEqual(backup.parsePreferencesBackup(JSON.stringify(file), current), expected);
assert.deepEqual(backup.parsePreferencesBackup(JSON.stringify({ ...file, schemaVersion: undefined }), current), expected, 'Older format is accepted');
assert.throws(() => backup.parsePreferencesBackup('not-json', current), /JSON valide/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, user: { id: 24, email: current.email } }), current), /autre compte/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, user: { id: 23, email: 'another@example.com' } }), current), /e-mail/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, schemaVersion: 999 }), current), /ne correspond pas/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, preferences: { notifications: 'oui' } }), current), /invalide/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, preferences: { automaticLogoutMinutes: -50 } }), current), /invalide/);
assert.throws(() => backup.parsePreferencesBackup(JSON.stringify({ ...file, preferences: {} }), current), /Aucune préférence/);
assert.throws(() => backup.parsePreferencesBackup(' '.repeat(backup.PREFERENCES_BACKUP_MAX_BYTES + 1), current), /256 Ko/);
assert.deepEqual(backup.parsePreferencesBackup(JSON.stringify({
  ...file,
  preferences: { theme: 'dark', __proto__: { admin: true }, unsafeRole: 'admin' },
}), current), { theme: 'dark' }, 'Unknown keys are not restored');
console.log('Preferences backup import/export validation passed.');
