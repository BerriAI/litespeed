import { describe, expect, it } from 'vitest';
import { nextOccurrence, scheduleTimingSchema } from '../server/schedule-time.js';
import type { ScheduleTiming } from '../shared/schedules.js';

const next = (timing: ScheduleTiming, after: string) => new Date(nextOccurrence(timing, Date.parse(after))!).toISOString();
describe('calendar schedule times', () => {
  it('uses the selected time zone rather than the server time zone', () => {
    expect(next({ kind: 'daily', time: '09:00', timezone: 'America/Los_Angeles' }, '2026-09-22T14:00:00Z')).toBe('2026-09-22T16:00:00.000Z');
    expect(next({ kind: 'daily', time: '09:00', timezone: 'Asia/Kathmandu' }, '2026-09-22T00:00:00Z')).toBe('2026-09-22T03:15:00.000Z');
  });
  it('advances past an occurrence, including a nonzero millisecond timestamp', () => {
    expect(next({ kind: 'daily', time: '09:00', timezone: 'UTC' }, '2026-09-22T09:00:00.001Z')).toBe('2026-09-23T09:00:00.000Z');
  });
  it('skips weekends and handles dates across years', () => {
    expect(next({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00', timezone: 'America/Los_Angeles' }, '2026-09-26T12:00:00Z')).toBe('2026-09-28T16:00:00.000Z');
    expect(next({ kind: 'daily', time: '00:00', timezone: 'UTC' }, '2026-12-31T23:59:59Z')).toBe('2027-01-01T00:00:00.000Z');
  });
  it('shifts a nonexistent spring-forward time by the gap', () => {
    expect(next({ kind: 'daily', time: '02:30', timezone: 'America/Los_Angeles' }, '2026-03-08T08:00:00Z')).toBe('2026-03-08T10:30:00.000Z');
    expect(next({ kind: 'daily', time: '02:30', timezone: 'Australia/Lord_Howe' }, '2026-10-03T12:00:00Z')).toBe('2026-10-03T15:30:00.000Z');
  });
  it('runs only once in a repeated fall-back hour', () => {
    const timing: ScheduleTiming = { kind: 'daily', time: '01:30', timezone: 'America/Los_Angeles' };
    expect(next(timing, '2026-11-01T07:00:00Z')).toBe('2026-11-01T08:30:00.000Z');
    expect(next(timing, '2026-11-01T08:45:00Z')).toBe('2026-11-02T09:30:00.000Z');
  });
  it('anchors hourly schedules and completes one-time schedules', () => {
    const anchor = Date.parse('2026-09-22T10:00:00Z');
    expect(nextOccurrence({ kind: 'hourly', every: 3 }, anchor + 3.2 * 3600_000, anchor)).toBe(anchor + 6 * 3600_000);
    expect(nextOccurrence({ kind: 'once', at: anchor }, anchor)).toBeNull();
    expect(nextOccurrence({ kind: 'once', at: anchor }, anchor - 1)).toBe(anchor);
  });
  it('rejects malformed or ambiguous schedule inputs', () => {
    for (const input of [{ kind: 'weekly', days: [], time: '09:00', timezone: 'UTC' }, { kind: 'daily', time: '24:00', timezone: 'UTC' }, { kind: 'daily', time: '09:00', timezone: 'Invalid/Nowhere' }, { kind: 'weekly', days: [1, 1], time: '09:00', timezone: 'UTC' }, { kind: 'hourly', every: 0 }]) expect(scheduleTimingSchema.safeParse(input).success).toBe(false);
  });
});
