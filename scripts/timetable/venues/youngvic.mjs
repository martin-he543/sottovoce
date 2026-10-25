// Young Vic. www.youngvic.org sits behind a Cloudflare bot wall (403 to plain requests), which we do not try to evade.
// The venue's ticketing site calls its own Spektrix API on the venue-owned domain book.youngvic.org (public read
// endpoints, no robots.txt on that host); we read /events and /instances there (2 requests total).
import { fetchJson, clean, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'youngvic',
  name: 'Young Vic',
  kind: 'theatre',
  address: '66 The Cut, London SE1 8LZ',
  lat: 51.5039,
  lng: -0.1060,
  site: 'https://www.youngvic.org/whats-on',
};

const API = 'https://book.youngvic.org/youngvic/api/v3';
const SKIP = /\b(programme|playtext|touch tour|headset|assisted listening|ask the|workshop|talk|tour|voucher|donation|membership|gift|test)\b/i;
const SMALL = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'at']);
/** The Young Vic's catalogue shouts in capitals; normalise ALL-CAPS titles. */
const tidy = (t) => (t === t.toUpperCase() && /[A-Z]{3}/.test(t)
  ? t.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.replace(/^([^a-z]*)([a-z])/, (_, a, b) => a + b.toUpperCase()))).join(' ')
  : t);

export async function scrape() {
  const from = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
  const events = await fetchJson(`${API}/events`);
  const insts = await fetchJson(`${API}/instances?startFrom=${from}T00:00:00`);
  if (!Array.isArray(events) || !Array.isArray(insts)) throw new Error('Young Vic: unexpected Spektrix response');
  const byId = new Map(events.map((e) => [e.id, e]));
  const out = [];
  for (const i of insts) {
    const e = byId.get(i.event?.id);
    if (!e || i.cancelled) continue;
    if (String(e.attribute_SupplementaryEvent).toLowerCase() === 'true') continue;
    const title = tidy(clean(e.name));
    if (e.duration && e.duration <= 45) continue;   // 30-minute immersive installations (EULOGY) would flood the timetable
    if (!title || SKIP.test(title)) continue;
    const m = String(i.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const desc = clean(String(e.description ?? '').replace(/<[^>]*>/g, ' '));
    const guessed = guessCategory(`${title} ${desc}`);
    const category = /\b(new musical|a musical|the musical|musical version|musical theatre)\b/i.test(desc) ? 'musical' : ['musical', 'opera', 'dance'].includes(guessed) ? guessed : 'drama';
    out.push(makeEvent(venue, {
      title,
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      hall: clean(e.attribute_Venue) || undefined,
      url: venue.site,
      blurb: [e.attribute_Festival, desc].filter(Boolean).join('. '),
    }));
  }
  return out;
}
