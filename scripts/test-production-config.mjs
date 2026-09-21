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

const readiness = fs.readFileSync(new URL('../server/readiness.ts', import.meta.url), 'utf8');
if (!readiness.includes("databaseType === 'postgres'")) {
  throw new Error('Production readiness must require a persistent PostgreSQL database');
}
if (!readiness.includes("'persistent_database'")) {
  throw new Error('Production readiness must expose the persistent database blocker');
}
if (!server.includes('getRuntimeReadiness')) {
  throw new Error('Production server must log runtime readiness at startup');
}

if (!server.includes("code === '28P01'") || !server.includes('PostgreSQL a refusé les identifiants DATABASE_URL')) {
  throw new Error('Production startup must expose a clear PostgreSQL authentication diagnostic');
}
if (!server.includes('transientDatabaseErrorCodes') || !server.includes('DATABASE_STARTUP_ATTEMPTS')) {
  throw new Error('Production startup must retry transient PostgreSQL connection failures');
}
if (!server.includes('process.exitCode = 1')) {
  throw new Error('Production startup failures must be handled without an unhandled PostgreSQL stack dump');
}

const authService = fs.readFileSync(new URL('../src/services/authService.ts', import.meta.url), 'utf8');
if (!authService.includes("'X-MBote-Room-Session-Mode': 'bearer'")) {
  throw new Error('Login/register must explicitly request a Bearer session for cross-origin hosting');
}
if (!authService.includes('storage.setItem(TOKEN_KEY, token)')) {
  throw new Error('Authentication must persist the Bearer token returned by the backend');
}

const apiClient = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
if (!apiClient.includes('https://mbote-room-api.onrender.com')) {
  throw new Error('Hosted frontend must have a production Render API fallback');
}
if (!apiClient.includes("parsed.hostname.endsWith('.invalid')")) {
  throw new Error('Invalid placeholder API hosts must be rejected in production');
}

const renderBlueprint = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
if (!renderBlueprint.includes('https://mbote-room.vercel.app')) {
  throw new Error('Render CORS configuration must allow the MBotéRoom Vercel frontend');
}

console.log('Production configuration smoke checks passed.');
