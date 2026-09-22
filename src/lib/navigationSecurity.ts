const SAFE_FALLBACK = '/app';
const DISALLOWED_PREFIXES = ['/login','/connexion','/inscription','/mot-de-passe-oublie'];

export const sanitizeInternalPath = (value: unknown, fallback = SAFE_FALLBACK) => {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1500) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    const lower = parsed.pathname.toLowerCase();
    if (DISALLOWED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix + '/'))) return fallback;
    const allowed = new URLSearchParams();
    for (const [key,val] of parsed.searchParams.entries()) {
      if (['tab','page','view'].includes(key) && val.length <= 80) allowed.set(key,val);
    }
    return parsed.pathname + (allowed.size ? '?' + allowed.toString() : '');
  } catch {
    return fallback;
  }
};

export const routeContainsSensitiveData = (value: string) => {
  const lowered = value.toLowerCase();
  return /(?:token|password|otp|challenge|secret|code)=/.test(lowered)
    || DISALLOWED_PREFIXES.some((prefix)=>lowered === prefix || lowered.startsWith(prefix+'?'));
};

export const cleanSensitiveUrl = () => {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (/token|password|otp|challenge|secret|code/i.test(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(null,'',url.pathname + (url.search ? url.search : ''));
};
