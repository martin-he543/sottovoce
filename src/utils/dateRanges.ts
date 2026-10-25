import { dayKey } from './timetableFormat';

export type RangeId =
  | 'today' | 'tomorrow' | 'weekend' | 'week' | 'next-week' | 'month' | 'next-month'
  | 'days30' | 'quarter' | 'year' | 'all' | 'custom';

export const SLIDER_DAYS = 365;

export const RANGE_PRESETS: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'next-week', label: 'Next week' },
  { id: 'days30', label: 'Next 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'next-month', label: 'Next month' },
  { id: 'quarter', label: 'Next 3 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'Anytime' },
  { id: 'custom', label: 'Custom…' },
];

const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const parseKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const offsetOf = (key: string, today = new Date()) =>
  Math.round((parseKey(key).getTime() - parseKey(dayKey(today)).getTime()) / 864e5);
export const keyAtOffset = (n: number, today = new Date()) => dayKey(add(today, n));

/** Resolves a preset (or custom from/to keys) to inclusive day keys. */
export function resolveRange(id: RangeId, customFrom: string, customTo: string, now = new Date()): [string, string] {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const k = dayKey;
  switch (id) {
    case 'today': return [k(t), k(t)];
    case 'tomorrow': return [k(add(t, 1)), k(add(t, 1))];
    case 'weekend': {
      const dow = t.getDay(); // 0 Sun
      if (dow === 0) return [k(t), k(t)];
      const sat = add(t, dow === 6 ? 0 : 6 - dow);
      return [k(sat), k(add(sat, 1))];
    }
    case 'week': return [k(t), k(add(t, 6))];
    case 'next-week': {
      const mon = add(t, ((8 - t.getDay()) % 7) || 7);
      return [k(mon), k(add(mon, 6))];
    }
    case 'days30': return [k(t), k(add(t, 30))];
    case 'month': return [k(t), k(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
    case 'next-month': return [k(new Date(t.getFullYear(), t.getMonth() + 1, 1)), k(new Date(t.getFullYear(), t.getMonth() + 2, 0))];
    case 'quarter': return [k(t), k(add(new Date(t.getFullYear(), t.getMonth() + 3, t.getDate()), 0))];
    case 'year': return [k(t), `${t.getFullYear()}-12-31`];
    case 'custom': {
      const from = customFrom || k(t);
      const to = customTo || '9999-12-31';
      return from <= to ? [from, to] : [to, from];
    }
    default: return [k(t), '9999-12-31'];
  }
}

export const LEGACY_RANGES: Record<string, RangeId> = { week: 'week', month: 'days30' };

const fmt = (key: string) => parseKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export function describeRange(from: string, to: string): string {
  if (to === '9999-12-31') return `From ${fmt(from)} onwards`;
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}
