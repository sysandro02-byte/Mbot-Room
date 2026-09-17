import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const build = String(packageJson.scripts?.build || '');
if (!build.includes('server-v2.ts')) throw new Error('Production build must bundle server-v2.ts');
if (!fs.existsSync(new URL('../server-v2.ts', import.meta.url))) throw new Error('server-v2.ts is missing');

const server = fs.readFileSync(new URL('../server-v2.ts', import.meta.url), 'utf8');
if (!server.includes('runMigrations')) throw new Error('Server V2 must run database migrations');
if (!server.includes('registerRealtime')) throw new Error('Server V2 must register realtime');
if (/Réunion de démonstration|Amina Louka|Darel Mbote|Sarah Tech/.test(server)) throw new Error('Demo seed data detected in production server');

const core = fs.readFileSync(new URL('../server/core.ts', import.meta.url), 'utf8');
if (!core.includes('room_meeting_members') || !core.includes('room_messages') || !core.includes('room_polls')) {
  throw new Error('Zoom core persistence tables are incomplete');
}

console.log('Production configuration smoke checks passed.');
