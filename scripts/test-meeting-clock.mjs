import test from 'node:test';
import assert from 'node:assert/strict';
import { getMeetingClock } from '../src/lib/meetingClock.ts';

const meeting = {
  is_active: true,
  start_time: '2026-10-16T13:00:00.000Z',
  started_at: '2026-10-16T13:15:00.000Z',
  duration: 45,
};

test('timer uses actual server start and configured meeting minutes', () => {
  const clock = getMeetingClock(meeting, Date.parse('2026-10-16T13:35:00.000Z'));
  assert.equal(clock.elapsedSeconds, 20 * 60);
  assert.equal(clock.durationSeconds, 45 * 60);
  assert.equal(clock.remainingSeconds, 25 * 60);
  assert.equal(Math.round(clock.progressPercent), 44);
  assert.equal(clock.overtime, false);
});

test('timer never starts early for a scheduled meeting', () => {
  const clock = getMeetingClock({ ...meeting, is_active: false }, Date.parse('2026-10-16T13:34:00.000Z'));
  assert.equal(clock.elapsedSeconds, 0);
  assert.equal(clock.remainingSeconds, 45 * 60);
});

test('timer shows overtime without prematurely ending host meeting', () => {
  const clock = getMeetingClock(meeting, Date.parse('2026-10-16T14:10:00.000Z'));
  assert.equal(clock.elapsedSeconds, 55 * 60);
  assert.equal(clock.remainingSeconds, 0);
  assert.equal(clock.progressPercent, 100);
  assert.equal(clock.overtime, true);
});

test('timer handles legacy start time and unexpected duration values', () => {
  const fallback = getMeetingClock({ ...meeting, started_at: null, duration: 0 }, Date.parse('2026-10-16T13:05:00.000Z'));
  assert.equal(fallback.elapsedSeconds, 300);
  assert.equal(fallback.durationSeconds, 60 * 60);
  assert.equal(getMeetingClock({ ...meeting, started_at: 'not a date' }, Date.now()).elapsedSeconds, 0);
});
