import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundle = 'android/app/src/main/assets';
const html = readFileSync(join(bundle, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)=["']([^"'<>]+)["']/g)]
  .map((match) => match[1])
  .filter((ref) => /\.(?:js|css)(?:\?.*)?$/.test(ref));
assert(refs.some((ref) => /\.js(?:\?.*)?$/.test(ref)), 'Missing bundled JS entry');

for (const route of [
  '/index.html',
  '/connexion',
  '/inscription',
  '/app/calendar',
  '/app/meetings',
  '/reunions/example-room/salle-attente',
]) {
  for (const ref of refs) {
    const resolved = new URL(ref, `https://appassets.androidplatform.net${route}`);
    assert.equal(resolved.hostname, 'appassets.androidplatform.net');
    assert(resolved.pathname.startsWith('/assets/'),
      `Non-root asset on restored route ${route}: ${resolved.pathname}`);
    assert(existsSync(join(bundle, resolved.pathname.slice(1))),
      `Missing bundled file ${resolved.pathname} on ${route}`);
  }
}

console.log('Android SPA bundle URLs work on restored /connexion, /app and meeting routes.');
