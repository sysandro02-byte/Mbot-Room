import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../server/fileTypeValidation.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', target: 'es2022', format: 'esm' });
const { hasAllowedFileSignature } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const utf8 = (value) => Buffer.from(value, 'utf8');

assert.equal(hasAllowedFileSignature('application/pdf', utf8('%PDF-1.7\n')), true);
assert.equal(hasAllowedFileSignature('application/pdf', utf8('<html>bad</html>')), false);
assert.equal(hasAllowedFileSignature('image/png', Buffer.from('89504e470d0a1a0a', 'hex')), true);
assert.equal(hasAllowedFileSignature('image/png', utf8('not-a-png')), false);
assert.equal(hasAllowedFileSignature('image/jpeg', Buffer.from('ffd8ffe0', 'hex')), true);
assert.equal(hasAllowedFileSignature('image/jpeg', Buffer.from('ffd8', 'hex')), false);
assert.equal(hasAllowedFileSignature('image/gif', utf8('GIF87a')), true);
assert.equal(hasAllowedFileSignature('image/gif', utf8('GIF89a')), true);
assert.equal(hasAllowedFileSignature('image/gif', utf8('GIF10x')), false);
assert.equal(hasAllowedFileSignature('image/webp', utf8('RIFFabcdWEBP')), true);
assert.equal(hasAllowedFileSignature('image/webp', utf8('RIFFabcdEVIL')), false);
assert.equal(hasAllowedFileSignature('text/html', utf8('%PDF-1.7')), false);
console.log('Attachment file signature validation passed.');
