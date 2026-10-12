import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Exercise the actual server-side Google pagination helper without touching Google accounts.
const source = await readFile(new URL('../server/googleCalendarPages.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', target: 'es2022', format: 'esm' });
const { listGoogleCalendarEvents } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const pages = [
  { items: [{ id: 'one', summary: 'first' }, { id: 'two' }], nextPageToken: 'page/+2=' },
  { items: [{ id: 'two', summary: 'duplicate' }, { id: 'three' }], nextPageToken: '' },
];
const visited = [];
const request = async (path) => {
  visited.push(path);
  const page = visited.length - 1;
  return new Response(JSON.stringify(pages[page]), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const result = await listGoogleCalendarEvents(request, '2026-10-01T00:00:00Z', '2027-10-01T00:00:00Z');
assert.deepEqual(result.map((item) => item.id), ['one', 'two', 'three']);
assert.equal(visited.length, 2);
assert.equal(new URL('https://google.invalid' + visited[1]).searchParams.get('pageToken'), 'page/+2=');
assert.equal(new URL('https://google.invalid' + visited[1]).searchParams.get('maxResults'), '500');

await assert.rejects(
  listGoogleCalendarEvents(async () => new Response('{}', { status: 200 }), 'start', 'end'),
  /réponse inattendue/,
);
await assert.rejects(
  listGoogleCalendarEvents(async () => new Response('error', { status: 403 }), 'start', 'end'),
  /HTTP 403/,
);
await assert.rejects(
  listGoogleCalendarEvents(async () => new Response(JSON.stringify({ items: [], nextPageToken: 'loop' }), { status: 200 }), 'start', 'end', 3),
  /répété un jeton/,
);
let count = 0;
await assert.rejects(
  listGoogleCalendarEvents(async () => new Response(JSON.stringify({ items: [], nextPageToken: 'page' + ++count }), { status: 200 }), 'start', 'end', 3),
  /trop de résultats/,
);
assert.equal(count, 3);
console.log('Google Calendar pagination tests passed.');
