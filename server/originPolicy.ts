const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const normalizeOrigin = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return trimTrailingSlash(parsed.origin);
  } catch {
    return '';
  }
};

const configuredOrigins = [
  process.env.MBOTE_ROOM_APP_URL,
  ...String(process.env.MBOTE_ROOM_ALLOWED_ORIGINS || '').split(','),
]
  .map(normalizeOrigin)
  .filter(Boolean);

const escapeRegExp = (value: string) => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

const wildcardToRegExp = (pattern: string) => {
  const segments = pattern.split('*').map(escapeRegExp);
  return new RegExp('^' + segments.join('[a-z0-9-]+') + '$', 'i');
};

const configuredOriginPatterns = String(process.env.MBOTE_ROOM_ALLOWED_ORIGIN_PATTERNS || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter((value) => value.includes('*'))
  .map(wildcardToRegExp);

export const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (normalized === 'https://appassets.androidplatform.net') return true;
  if (configuredOrigins.includes(normalized)) return true;
  if (configuredOriginPatterns.some((pattern) => pattern.test(normalized))) return true;
  if (process.env.NODE_ENV !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized);
  }
  return false;
};

export const resolveAllowedClientOrigin = (candidate: unknown, fallback: unknown) => {
  const normalizedCandidate = normalizeOrigin(candidate);
  if (normalizedCandidate && isAllowedOrigin(normalizedCandidate)) return normalizedCandidate;
  return normalizeOrigin(fallback);
};

export const getConfiguredOriginDiagnostics = () => ({
  exactCount: configuredOrigins.length,
  patternCount: configuredOriginPatterns.length,
});
