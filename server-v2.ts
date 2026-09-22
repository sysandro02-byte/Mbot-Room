import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { closeDatabase, getDatabaseType, hasDatabase, runMigrations } from './server/core.js';
import { runExtraMigrations } from './server/extraMigrations.js';
import { runProductMigrations } from './server/productMigrations.js';
import { registerAuthRoutes } from './server/authRoutes.js';
import { registerMeetingRoutes } from './server/meetingRoutes.js';
import { registerAdminRoutes } from './server/adminRoutes.js';
import { registerAppRoutes } from './server/appRoutes.js';
import { registerRealtime } from './server/realtime.js';
import { registerRtcRoutes } from './server/rtcRoutes.js';
import { registerSfuRoutes } from './server/sfuRoutes.js';
import { registerRecordingRoutes } from './server/recordingRoutes.js';
import { registerTranscriptionRoutes } from './server/transcriptionRoutes.js';
import { getRuntimeReadiness } from './server/readiness.js';
import { isAllowedOrigin } from './server/originPolicy.js';
import { getEmailDeliveryStatus, sendTransactionalEmail } from './server/emailDelivery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.basename(__dirname) === 'dist' ? __dirname : path.join(__dirname, 'dist');
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error('Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1_000_000,
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((request, response, next) => {
  const origin = String(request.headers.origin || '');
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MBote-Room-Session-Mode');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (request.method === 'OPTIONS') return response.sendStatus(isAllowedOrigin(origin) ? 204 : 403);
  if (origin && !isAllowedOrigin(origin)) return response.status(403).json({ error: 'Origin non autorisée.', code: 'ORIGIN_DENIED' });
  next();
});
app.use(express.json({ limit: '1mb' }));

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let nextRateCleanupAt = 0;

const cleanupRateBuckets = (now: number) => {
  if (now < nextRateCleanupAt) return;
  nextRateCleanupAt = now + 60_000;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
};

const rateLimit = (limit: number, windowMs: number): express.RequestHandler => (request, response, next) => {
  const now = Date.now();
  cleanupRateBuckets(now);
  const routeKey = String(request.originalUrl || request.path).split('?')[0];
  const key = `${request.ip}:${routeKey}`;
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    response.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    response.status(429).json({ error: 'Trop de requêtes. Réessayez dans quelques instants.', code: 'RATE_LIMITED' });
    return;
  }
  next();
};

app.use('/api/auth/login/otp/resend', rateLimit(3, 60_000));
app.use('/api/auth/login/otp', rateLimit(10, 60_000));
app.use('/api/auth/login', rateLimit(10, 60_000));
app.use('/api/auth/register', rateLimit(8, 60_000));
app.use('/api/auth/forgot-password', rateLimit(5, 60_000));
app.use('/api/auth', rateLimit(60, 60_000));
app.use('/api/meetings', rateLimit(240, 60_000));
app.use('/api/ai', rateLimit(30, 60_000));

registerAuthRoutes(app);
registerMeetingRoutes(app, io);
registerAdminRoutes(app, io);
registerAppRoutes(app, io);
registerRtcRoutes(app);
registerSfuRoutes(app);
registerRecordingRoutes(app, io);
registerTranscriptionRoutes(app, io);
registerRealtime(io);

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API introuvable.', code: 'API_NOT_FOUND' });
});

app.use(express.static(rootDir));
app.get('*', (_request, response) => {
  response.sendFile(path.join(rootDir, 'index.html'));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('[MBotéRoom]', error);
  const message = process.env.NODE_ENV === 'production' ? 'Une erreur serveur est survenue.' : error instanceof Error ? error.message : 'Erreur serveur';
  response.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
});

const port = Number(process.env.PORT || 3004);

type DatabaseStartupError = Error & { code?: string };

const transientDatabaseErrorCodes = new Set([
  '08000', '08001', '08003', '08006', '53300', '57P01',
  'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
]);

const databaseStartupMessage = (error: unknown) => {
  const candidate = error as DatabaseStartupError;
  const code = String(candidate?.code || '').trim();

  if (code === '28P01') {
    return 'PostgreSQL a refusé les identifiants DATABASE_URL (28P01). Vérifiez le mot de passe, l’utilisateur et la chaîne de connexion Supabase configurés dans Render.';
  }
  if (code === '3D000') {
    return 'La base PostgreSQL indiquée dans DATABASE_URL est introuvable (3D000). Vérifiez le nom de la base.';
  }
  if (code === '28000') {
    return 'PostgreSQL a refusé l’autorisation de connexion (28000). Vérifiez l’utilisateur DATABASE_URL et les droits Supabase.';
  }
  if (transientDatabaseErrorCodes.has(code)) {
    return `Connexion PostgreSQL temporairement indisponible (${code || 'network'}).`;
  }

  return `Initialisation PostgreSQL impossible${code ? ` (${code})` : ''}: ${candidate?.message || 'erreur inconnue'}`;
};

const runDatabaseStartup = async () => {
  const maxAttempts = Math.max(1, Math.min(5, Number(process.env.DATABASE_STARTUP_ATTEMPTS || 3)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runMigrations();
      await runExtraMigrations();
      await runProductMigrations();
      return;
    } catch (error) {
      const code = String((error as DatabaseStartupError)?.code || '').trim();
      const transient = transientDatabaseErrorCodes.has(code);
      const lastAttempt = attempt >= maxAttempts;

      if (!transient || lastAttempt) {
        throw new Error(databaseStartupMessage(error), { cause: error });
      }

      const delayMs = Math.min(5000, 500 * (2 ** (attempt - 1)));
      console.warn(`[database startup] tentative ${attempt}/${maxAttempts} échouée; nouvelle tentative dans ${delayMs} ms (${code || 'network'}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

const runReleaseEmailProbe = async () => {
  const enabled = String(process.env.MBOTE_ROOM_RELEASE_EMAIL_TEST || '').toLowerCase() === 'true';
  const to = String(process.env.MBOTE_ROOM_RELEASE_EMAIL_TEST_TO || '').trim();
  if (!enabled || !to) return;

  const commit = String(process.env.RENDER_GIT_COMMIT || '').trim();
  const shortCommit = commit ? commit.slice(0, 12) : 'unknown';
  const subject = `[MBotéRoom] Test email production ${shortCommit}`;
  const status = getEmailDeliveryStatus();

  const ok = await sendTransactionalEmail({
    to,
    subject,
    text: `Test de livraison email MBotéRoom en production. Commit: ${shortCommit}. Si vous recevez ce message, le canal email transactionnel fonctionne.`,
    html: `<p><strong>MBotéRoom — test email production</strong></p><p>Commit : <code>${shortCommit}</code></p><p>Si vous recevez ce message, le canal email transactionnel fonctionne.</p>`,
  }).catch(() => false);

  console.log(`MBotéRoom release email probe ${JSON.stringify({ ok, provider: status.provider, commit: shortCommit })}`);
};

const start = async () => {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL est obligatoire en production. DATABASE_MODE=pgmem-test est réservé aux tests explicites.');
  }

  await runDatabaseStartup();

  httpServer.listen(port, () => {
    const databaseType = getDatabaseType();
    console.log(`MBotéRoom API V2 listening on port ${port} · database=${databaseType}`);
    console.log(`MBotéRoom readiness ${JSON.stringify(getRuntimeReadiness(databaseType))}`);
    void runReleaseEmailProbe();
  });
};

const shutdown = async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

try {
  await start();
} catch (error) {
  console.error(`[MBotéRoom startup] ${error instanceof Error ? error.message : 'Erreur de démarrage inconnue.'}`);
  await closeDatabase();
  process.exitCode = 1;
}
