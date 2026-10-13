import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMeetingIdentifier } from '../src/lib/meetingInvitation.ts';

test('invitation URL preserves UUID-style hyphens and underscore', () => {
  assert.equal(
    extractMeetingIdentifier('https://mboteroom.loukatech.com/join/mbote-123_abc?source=invite'),
    'mbote-123_abc',
  );
});

test('meeting room URL preserves the meeting id', () => {
  assert.equal(
    extractMeetingIdentifier('https://mboteroom.loukatech.com/reunions/123-456'),
    '123-456',
  );
});

test('plain codes trim whitespace but retain significant hyphens', () => {
  assert.equal(extractMeetingIdentifier('  123 456-789  '), '123456-789');
});

test('unknown URLs and untrusted protocols are not accepted as meeting codes', () => {
  assert.equal(extractMeetingIdentifier('https://example.com/profile/1234'), '');
  assert.equal(extractMeetingIdentifier('javascript:alert(1)'), '');
});
