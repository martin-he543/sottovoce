import type { TimetableEvent } from '../data/timetableCategories';

export const TZ = 'Europe/London';

// Building an Intl.DateTimeFormat costs far more than formatting with one, and these run for every listing on every
// filter pass: make each formatter once, and remember each start's day.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dayOfStart = new Map<string, string>();

export const dayKey = (d: Date | string) => {
  if (typeof d !== 'string') return DAY_FMT.format(d);
  let k = dayOfStart.get(d);
  if (k === undefined) {
    k = DAY_FMT.format(new Date(d));
    if (dayOfStart.size > 50_000) dayOfStart.clear();
    dayOfStart.set(d, k);
  }
  return k;
};

export const timeLabel = (e: TimetableEvent) => (e.time_known ? TIME_FMT.format(new Date(e.start)) : 'TBC');

// Events with no known time carry a bare YYYY-MM-DD; read the day straight off the string rather than via a timezone conversion.
export const eventDay = (e: TimetableEvent) => (e.time_known ? dayKey(e.start) : e.start.slice(0, 10));

export const shortDate = (e: TimetableEvent) => SHORT_FMT.format(new Date(eventDay(e) + 'T12:00:00Z'));

/** Lowest ticket price in pounds from strings like "from £28", "from £15-£48" or "from £18 (up to £45)"; null when none is listed. */
export function minPrice(e: { price?: string }): number | null {
  const m = e.price?.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
