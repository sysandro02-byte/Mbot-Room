import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { build } from 'esbuild';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const output = await build({
  entryPoints: ['server/nativePushService.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [{
    name: 'mock-database',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: 'mock-core', namespace: 'mock' }));
      plugin.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: 'export const query = (...args) => globalThis.__mboteFcmDb(...args);',
        loader: 'js',
      }));
    },
  }],
});
const code = output.outputFiles[0].text;
const { isNativePushConfigured, validNativeToken, sendNativePushToUsers } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

assert.equal(validNativeToken('a'.repeat(32)), true);
assert.equal(validNativeToken('a'.repeat(31)), false);
assert.equal(validNativeToken('<script>'.repeat(10)), false);
assert.equal(validNativeToken('a'.repeat(4097)), false);
assert.equal(isNativePushConfigured(), false);
assert.deepEqual(await sendNativePushToUsers([1], { title: 'A', body: 'B' }), { sent: 0, failed: 0, stale: 0 });

process.env.FCM_PROJECT_ID = 'mboteroom-test-project';
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: process.env.FCM_PROJECT_ID,
  client_email: 'ci-test@mboteroom-test-project.iam.gserviceaccount.com',
  private_key: privateKey,
});
assert.equal(isNativePushConfigured(), true);

const delivered = [];
const removed = [];
let oauthRequests = 0;
const makeToken = (name) => 'fcm_ci_token_' + name + '_'.repeat(40);
globalThis.__mboteFcmDb = async (sql, parameters) => {
  if (sql.includes('SELECT n.id')) {
    assert.deepEqual(parameters, [[1, 2]]);
    return { rows: [
      { id: 'silent', token: makeToken('silent'), preferences: { notificationSounds: false, lockScreenPreview: false, vibration: false } },
      { id: 'normal', token: makeToken('normal'), preferences: { vibration: true } },
      { id: 'old', token: makeToken('expired'), preferences: {} },
    ] };
  }
  if (sql.startsWith('DELETE FROM room_native_push_tokens')) {
    removed.push(parameters[0]);
    return { rows: [], rowCount: 1 };
  }
  throw new Error('Unexpected SQL ' + sql);
};

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address === 'https://oauth2.googleapis.com/token') {
      oauthRequests += 1;
      const form = new URLSearchParams(options.body);
      const [header, payload, signature] = String(form.get('assertion')).split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
      assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
      assert.ok(createVerify('RSA-SHA256').update(header + '.' + payload).end()
        .verify(publicKey, Buffer.from(signature, 'base64url')));
      return new Response(JSON.stringify({ access_token: 'oauth-ci', expires_in: 3600 }), { status: 200 });
    }
    assert.equal(address, 'https://fcm.googleapis.com/v1/projects/mboteroom-test-project/messages:send');
    assert.equal(options.headers.Authorization, 'Bearer oauth-ci');
    const request = JSON.parse(options.body).message;
    delivered.push(request);
    if (request.token === makeToken('expired')) {
      return new Response(JSON.stringify({
        error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] },
      }), { status: 404 });
    }
    return new Response(JSON.stringify({ name: 'projects/test/messages/accepted' }), { status: 200 });
  };
  const result = await sendNativePushToUsers([1, 2, 1], {
    title: 'Réunion d’équipe',
    body: 'Vous avez un message privé.',
    url: 'https://evil.test/steal',
  });
  assert.deepEqual(result, { sent: 2, failed: 0, stale: 1 });
  assert.equal(oauthRequests, 1);
  assert.deepEqual(removed, ['old']);
  assert.equal(delivered.length, 3);
  assert.equal(delivered[0].notification.title, 'MBotéRoom');
  assert.equal(delivered[0].notification.body, 'Vous avez une nouvelle activité.');
  assert.equal(delivered[0].android.notification.channel_id, 'mboteroom_silent');
  assert.equal(delivered[0].data.path, '/app/notifications');
  assert.equal(delivered[1].notification.title, 'Réunion d’équipe');
  assert.equal(delivered[1].android.notification.channel_id, 'mboteroom_updates');
  assert.equal(delivered[1].android.notification.default_vibrate_timings, true);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__mboteFcmDb;
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_PROJECT_ID;
}
console.log('Native FCM OAuth signing, opt-in delivery, privacy and stale-token cleanup passed.');
