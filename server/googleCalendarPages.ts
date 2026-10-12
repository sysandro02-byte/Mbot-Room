type GoogleEventList = { items?: unknown; nextPageToken?: unknown };
type GoogleEventRequest = (path: string) => Promise<Response>;

/**
 * Google Calendar lists are paginated. Fetch every bounded page before writing
 * into PostgreSQL so an API error cannot produce a misleading partial sync.
 */
export async function listGoogleCalendarEvents(
  request: GoogleEventRequest,
  timeMin: string,
  timeMax: string,
  maxPages = 10,
): Promise<Record<string, any>[]> {
  const collected: Record<string, any>[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '500',
      timeMin,
      timeMax,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await request('/calendars/primary/events?' + params.toString());
    if (!response.ok) {
      throw new Error('Impossible de lire tous les événements Google Calendar (HTTP ' + response.status + ').');
    }
    const result = await response.json().catch(() => null) as GoogleEventList | null;
    if (!result || !Array.isArray(result.items)) {
      throw new Error('Google Calendar a renvoyé une réponse inattendue.');
    }
    for (const item of result.items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, any>;
      const id = String(record.id || '');
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      collected.push(record);
    }
    const next = typeof result.nextPageToken === 'string' ? result.nextPageToken.trim() : '';
    if (!next) return collected;
    if (seenTokens.has(next)) throw new Error('Google Calendar a répété un jeton de pagination.');
    seenTokens.add(next);
    pageToken = next;
  }
  throw new Error('Google Calendar contient trop de résultats pour une seule synchronisation. Réduisez la période.');
}
