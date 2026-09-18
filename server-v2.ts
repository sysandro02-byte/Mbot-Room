import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { pool, query, runMigrations, setDatabaseReady } from './server/core.js';
import { runExtraMigrations } from './server/extraMigrations.js';
import { runProductMigrations } from './server/productMigrations.js';
import { registerAuthRoutes } from './server/authRoutes.js';
import { registerMeetingRoutes } from './server/meetingRoutes.js';
import { registerAdminRoutes } from './server/adminRoutes.js';
import { registerAppRoutes } from './server/appRoutes.js';
import { registerRealtime } from './server/realtime.js';
import { registerRtcRoutes } from './server/rtcRoutes.js';
import { registerSfuRoutes } from './server/sfuRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.basename(__dirname) === 'dist' ? __dirname : path.join(__dirname, 'dist');
const app = express();
const httpServer = createServer(app);

const configuredOrigins = [
  process.env.MBOTE_ROOM_APP_URL,
  ...(String(process.env.MBOTE_ROOM_ALLOWED_ORIGINS || '').split(',')),
]
  .map((value) => String(value || '').trim().replace(/\/+$/, ''))
  .filter(Boolean);

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true;
  if (configuredOrigins.includes(origin.replace(/\/+$/, ''))) return true;
  if (process.env.NODE_ENV !== 'production') return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return false;
};

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
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
const rateLimit = (limit: number, windowMs: number): express.RequestHandler => (request, response, next) => {
  const key = `${request.ip}:${request.path}`;
  const now = Date.now();
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

app.use('/api/auth', rateLimit(30, 60_000));
app.use('/api/meetings', rateLimit(240, 60_000));
app.use('/api/ai', rateLimit(30, 60_000));

registerAuthRoutes(app);
registerMeetingRoutes(app, io);
registerAdminRoutes(app, io);
registerAppRoutes(app, io);
registerRtcRoutes(app);
registerSfuRoutes(app);
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

const initializeDatabase = async () => {
  if (!pool) {
    setDatabaseReady(false, 'DATABASE_URL is not configured');
    console.error('DATABASE_URL est obligatoire pour les fonctions persistantes. Le serveur HTTP reste disponible en mode dégradé.');
    return;
  }

  try {
    if (String(process.env.RUN_MIGRATIONS_ON_START || 'true').toLowerCase() !== 'false') {
      await runMigrations();
      await runExtraMigrations();
      await runProductMigrations();
    } else {
      await query('SELECT 1');
    }
    setDatabaseReady(true);
    console.log('PostgreSQL ready.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database unavailable';
    setDatabaseReady(false, message);
    console.error('PostgreSQL indisponible au démarrage. MBotéRoom reste en ligne sans fallback simulé.', error);
  }
};

const start = async () => {
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`MBotéRoom API V2 listening on port ${port}`);
  });
  await initializeDatabase();
};

const shutdown = async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pool?.end().catch(() => undefined);
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await start();
