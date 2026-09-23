import { z } from 'zod';
import type { ScheduleTiming } from '../shared/schedules.js';

const zone = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid time zone.');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Enter a time from 00:00 to 23:59.');
export const scheduleTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.number().int().min(0).max(8_640_000_000_000_000) }).strict(),
  z.object({ kind: z.literal('hourly'), every: z.number().int().min(1).max(168) }).strict(),
  z.object({ kind: z.literal('daily'), time, timezone: zone }).strict(),
  z.object({ kind: z.literal('weekly'), time, timezone: zone, days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length) }).strict(),
]);
const minute = 60_000, day = 86_400_000;
const wallTime = (format: Intl.DateTimeFormat, stamp: number) => {
  const parts = Object.fromEntries(format.formatToParts(stamp).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
};

/** Earliest occurrence strictly after `after`. Calendar schedules run once per
 * local day, including a repeated DST hour. A missing hour shifts by the DST
 * gap. Hourly schedules stay anchored, so delays do not accumulate drift. */
export function nextOccurrence(timing: ScheduleTiming, after: number, anchor = after): number | null {
  if (timing.kind === 'once') return timing.at > after ? timing.at : null;
  if (timing.kind === 'hourly') {
    const interval = timing.every * 60 * minute;
    return anchor + Math.max(1, Math.floor((after - anchor) / interval) + 1) * interval;
  }
  const format = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: timing.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const localNow = new Date(wallTime(format, after));
  const [hour, minutes] = timing.time.split(':').map(Number);
  const first = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), hour, minutes);
  for (let offset = 0; offset < 9; offset++) {
    const target = first + offset * day;
    if (timing.kind === 'weekly' && !timing.days.includes(new Date(target).getUTCDay())) continue;
    const offsets = new Set([-2, -1, 0, 1, 2].map(delta => {
      const probe = target + delta * day;
      return wallTime(format, probe) - probe;
    }));
    const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
    const exact = candidates.filter(candidate => wallTime(format, candidate) === target);
    const next = exact[0] ?? candidates.find(candidate => wallTime(format, candidate) > target);
    if (next !== undefined && next > after) return next;
  }
  throw new Error('Could not find the next scheduled time.');
}
