const backendUrl = String(process.env.MBOTE_ROOM_BACKEND_URL || 'https://mbote-room-api.onrender.com').replace(/\/+$/, '');
const frontendUrl = String(process.env.MBOTE_ROOM_FRONTEND_URL || 'https://mbote-room.vercel.app').replace(/\/+$/, '');

const get = async (url, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MBoteRoom-Production-Health/1.0' },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
};

const frontend = await get(frontendUrl);
if (!frontend.ok) {
  throw new Error(`Frontend unavailable: HTTP ${frontend.status} ${frontendUrl}`);
}
const frontendHtml = await frontend.text();
if (!/MBot[eé]Room|MBot[eé] Room/i.test(frontendHtml)) {
  throw new Error('Frontend responded but MBotéRoom application shell was not detected.');
}

const healthResponse = await get(`${backendUrl}/api/health`);
const healthText = await healthResponse.text();
let health = {};
try {
  health = healthText ? JSON.parse(healthText) : {};
} catch {
  throw new Error(`Backend health returned invalid JSON: ${healthText.slice(0, 300)}`);
}

if (!healthResponse.ok || health?.ok !== true) {
  throw new Error(`Backend health failed: HTTP ${healthResponse.status} ${JSON.stringify(health)}`);
}
if (health?.database?.connected !== true || health?.database?.type !== 'postgres') {
  throw new Error(`Persistent PostgreSQL is not healthy: ${JSON.stringify(health?.database || {})}`);
}

const blockers = Array.isArray(health?.readiness?.blockers) ? health.readiness.blockers : [];
console.log(JSON.stringify({
  frontend: { url: frontendUrl, ok: true },
  backend: { url: backendUrl, ok: true },
  database: health.database,
  readiness: {
    productionReady: Boolean(health?.readiness?.productionReady),
    blockers,
    integrations: health?.readiness?.integrations || {},
  },
}, null, 2));

if (blockers.length) {
  console.warn(`Production availability is healthy, but readiness blockers remain: ${blockers.join(', ')}`);
}
