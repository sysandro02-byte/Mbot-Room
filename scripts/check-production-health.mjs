const backendUrl = String(process.env.MBOTE_ROOM_BACKEND_URL || 'https://mbote-room-api.onrender.com').replace(/\/+$/, '');
const frontendUrl = String(process.env.MBOTE_ROOM_FRONTEND_URL || 'https://mbote-room.vercel.app').replace(/\/+$/, '');
const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const get = async (url, timeoutMs) => {
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

const getWithRetry = async (url, { attempts, timeoutMs, label }) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      const delayMs = Math.min(2_000 * (2 ** (attempt - 2)), 15_000);
      console.warn(`${label}: nouvelle tentative ${attempt}/${attempts} dans ${delayMs} ms.`);
      await sleep(delayMs);
    }
    try {
      const response = await get(url, timeoutMs);
      const shouldRetry = retryableStatusCodes.has(response.status) && attempt < attempts;
      if (!shouldRetry) return response;
      console.warn(`${label}: HTTP ${response.status} pendant le réveil du service.`);
      await response.text().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      console.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError || new Error(`${label}: aucune réponse après ${attempts} tentatives.`);
};

const frontend = await getWithRetry(frontendUrl, {
  attempts: 3,
  timeoutMs: 30_000,
  label: 'Frontend MBotéRoom',
});
if (!frontend.ok) {
  throw new Error(`Frontend unavailable: HTTP ${frontend.status} ${frontendUrl}`);
}
const frontendHtml = await frontend.text();
if (!/MBot[eé]Room|MBot[eé] Room/i.test(frontendHtml)) {
  throw new Error('Frontend responded but MBotéRoom application shell was not detected.');
}

const healthResponse = await getWithRetry(`${backendUrl}/api/health`, {
  attempts: 5,
  timeoutMs: 45_000,
  label: 'API Render MBotéRoom',
});
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
