/** Return the meeting identifier from a code or a shared invitation URL.
 * Keep hyphens: generated meeting links contain them.
 */
export function extractMeetingIdentifier(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let identifier = raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const routeIndex = parts.findIndex((part) => ['join', 'reunions'].includes(part.toLowerCase()));
    if (routeIndex < 0 || !parts[routeIndex + 1]) return '';
    identifier = decodeURIComponent(parts[routeIndex + 1]);
  } catch {
    // Code or ID, not a URL.
  }
  return identifier.replace(/\s+/g, '');
}
