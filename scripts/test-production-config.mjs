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
if (!apiClient.includes('export const apiFetch') || !apiClient.includes('Impossible de joindre le serveur MBotéRoom')) {
  throw new Error('Frontend API requests must use centralized network timeout/error handling');
}
const resilientClientFiles = [
  '../src/services/meetingService.ts',
  '../src/services/appDataService.ts',
  '../src/services/notificationService.ts',
  '../src/services/transcriptionService.ts',
  '../src/services/collaborationService.ts',
  '../src/services/mediaTransportService.ts',
  '../src/services/adminDashboardService.ts',
  '../src/lib/webrtc.ts',
  '../src/pages/GuestJoinPage.tsx',
];
for (const relativePath of resilientClientFiles) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  if (source.includes('fetch(apiUrl(')) {
    throw new Error(`Direct fetch(apiUrl(...)) bypasses resilient API handling in ${relativePath}`);
  }
}

const meetingRoutes = fs.readFileSync(new URL('../server/meetingRoutes.ts', import.meta.url), 'utf8');
if (!meetingRoutes.includes('qwen/qwen3.8-27b') || !meetingRoutes.includes('openai/gpt-oss-120b')) {
  throw new Error('Luna must keep current Groq fallback models when the configured model is blocked');
}

const liveSmoke = fs.readFileSync(new URL('../scripts/test-production-live.mjs', import.meta.url), 'utf8');
if (!liveSmoke.includes('GITHUB_RUN_ATTEMPT') || !liveSmoke.includes('Date.now()')) {
  throw new Error('Live production smoke must generate a unique identity for every rerun attempt');
}

if (!String(packageJson.scripts?.start || '').includes('wait-for-ci-gate.mjs')) {
  throw new Error('Production start must wait for the CI release gate');
}
const releaseGate = fs.readFileSync(new URL('../scripts/wait-for-ci-gate.mjs', import.meta.url), 'utf8');
if (!releaseGate.includes('RENDER_GIT_COMMIT') || !releaseGate.includes('MBoteRoom CI') || !releaseGate.includes("run.conclusion === 'success'")) {
  throw new Error('Render release gate must verify the exact deployed commit has a successful MBoteRoom CI run');
}
const deviceMatrix = fs.readFileSync(new URL('../scripts/test-device-matrix.mjs', import.meta.url), 'utf8');
if (!deviceMatrix.includes('PC Chromium') || !deviceMatrix.includes('Android Pixel 7') || !deviceMatrix.includes('iPhone 15 WebKit') || !deviceMatrix.includes('setOffline')) {
  throw new Error('CI must cover PC, Android, iPhone and network recovery');
}
if (!server.includes('MBOTE_ROOM_RELEASE_EMAIL_TEST_TO') || !server.includes('release email probe')) {
  throw new Error('Production server must support the private release email delivery probe');
}
const vercelConfig = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
if (vercelConfig.buildCommand !== 'npm run build:frontend' || vercelConfig.outputDirectory !== 'dist') {
  throw new Error('Vercel must use the frontend-only production build');
}
const renderBlueprint = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
if (!renderBlueprint.includes('qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b')) {
  throw new Error('Render must configure a resilient Groq model order for Luna');
}
if (!renderBlueprint.includes('https://mbote-room.vercel.app')) {
  throw new Error('Render CORS configuration must allow the MBotéRoom Vercel frontend');
}
if (!renderBlueprint.includes('https://mboteroom.loukatech.com')) {
  throw new Error('Render CORS configuration must be ready for the official MBotéRoom domain');
}
if (!renderBlueprint.includes('MBOTE_ROOM_ALLOWED_ORIGIN_PATTERNS') || !renderBlueprint.includes('https://mbote-room-*.vercel.app')) {
  throw new Error('Render CORS configuration must allow only MBotéRoom Vercel preview origins');
}
const originPolicy = fs.readFileSync(new URL('../server/originPolicy.ts', import.meta.url), 'utf8');
if (!originPolicy.includes('configuredOriginPatterns') || !originPolicy.includes('resolveAllowedClientOrigin')) {
  throw new Error('Server must centralize exact and preview frontend origin validation');
}
if (!renderBlueprint.includes('autoDeployTrigger: checksPass')) {
  throw new Error('Render production deploys must wait for CI checks to pass');
}
if (!renderBlueprint.includes('MBOTE_ROOM_REQUIRE_CI_GATE') || !renderBlueprint.includes('MBOTE_ROOM_REQUIRED_WORKFLOW')) {
  throw new Error('Render blueprint must enable the runtime CI release gate');
}
if (!readiness.includes('MBOTE_ROOM_REQUIRE_LIVEKIT') || !readiness.includes('MBOTE_ROOM_REQUIRE_SERVER_RECORDING')) {
  throw new Error('Readiness must support enforcing LiveKit and server recording when V1 credentials are enabled');
}

const appRoutes = fs.readFileSync(new URL('../server/appRoutes.ts', import.meta.url), 'utf8');
const sfuRoutes = fs.readFileSync(new URL('../server/sfuRoutes.ts', import.meta.url), 'utf8');
for (const source of [appRoutes, sfuRoutes]) {
  if (!source.includes('MBOTEROOM_TURN_URL') || !source.includes('MBOTEROOM_TURN_USERNAME') || !source.includes('MBOTEROOM_TURN_CREDENTIAL')) {
    throw new Error('Runtime media readiness must recognize static Metered TURN configuration');
  }
}

const manifestPath = new URL('../public/manifest.webmanifest', import.meta.url);
const serviceWorkerPath = new URL('../public/sw.js', import.meta.url);
const icon192Path = new URL('../public/icons/mbote-room-192.png', import.meta.url);
const icon512Path = new URL('../public/icons/mbote-room-512.png', import.meta.url);
if (!fs.existsSync(manifestPath) || !fs.existsSync(serviceWorkerPath) || !fs.existsSync(icon192Path) || !fs.existsSync(icon512Path)) {
  throw new Error('Installable PWA manifest, service worker and standard icons are required');
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.icons?.some((icon) => icon.sizes === '192x192') || !manifest.icons?.some((icon) => icon.sizes === '512x512')) {
  throw new Error('PWA manifest must expose 192x192 and 512x512 icons');
}
const serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
if (!serviceWorker.includes("url.pathname.startsWith('/api/')") || !serviceWorker.includes("url.pathname.startsWith('/socket.io/')")) {
  throw new Error('PWA service worker must never cache API or Socket.IO traffic');
}
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if (!indexHtml.includes('rel="manifest"') || !indexHtml.includes('theme-color')) {
  throw new Error('PWA metadata is missing from index.html');
}

console.log('Production configuration smoke checks passed.');
