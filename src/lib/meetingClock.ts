import type { Meeting } from '../services/meetingService';

export type MeetingClock = {
  elapsedSeconds: number;
  durationSeconds: number;
  remainingSeconds: number;
  progressPercent: number;
  overtime: boolean;
};

/** Duration is configured in minutes. started_at is the actual host start time;
 * scheduled start_time is a legacy fallback, not a client-local join timestamp. */
export function getMeetingClock(
  meeting: Pick<Meeting, 'is_active' | 'started_at' | 'start_time' | 'duration'>,
  now = Date.now(),
): MeetingClock {
  const configuredMinutes = Number(meeting.duration);
  const durationSeconds = Math.round((Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : 60) * 60);
  const startValue = meeting.started_at || meeting.start_time;
  const startAt = Date.parse(startValue);
  const elapsedSeconds = meeting.is_active && Number.isFinite(startAt)
    ? Math.max(0, Math.floor((now - startAt) / 1000))
    : 0;
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  return {
    elapsedSeconds,
    durationSeconds,
    remainingSeconds,
    progressPercent: Math.min(100, (elapsedSeconds / durationSeconds) * 100),
    overtime: meeting.is_active && elapsedSeconds > durationSeconds,
  };
}
