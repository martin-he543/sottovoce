// Ticketmaster UK — Discovery API v2 (https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).
// Needs a free consumer key in TICKETMASTER_API_KEY (5000 calls/day, 5 req/s). Without it the adapter is skipped.
// Segments queried: Music and Arts & Theatre, around London. Each result is one dated event.
import { fetchJson, londonISO, makeEvent } from '../lib.mjs';
import { EXCLUDE, LONDON, categorise, venueRegistry } from '../external.mjs';

export const requires = ['TICKETMASTER_API_KEY'];
export const venues = [];

const API = 'https://app.ticketmaster.com/discovery/v2/events.json';
const SEGMENTS = ['KZFzniwnSyZfZ7v7nJ', 'KZFzniwnSyZfZ7v7na'];   // Music, Arts & Theatre
const PAGE = 200, MAX_PAGES = 5, WINDOW_DAYS = 7;                                   // the API caps size*page at 1000 per query

export async function scrape() {
  const key = process.env.TICKETMASTER_API_KEY;
  const register = venueRegistry(venues);
  const out = new Map();
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  // The API caps size*page at 1000 per query, so walk the horizon in short windows to get everything.
  const windows = [];
  for (let t = Date.now(); t < Date.now() + 200 * 864e5; t += WINDOW_DAYS * 864e5) windows.push([iso(t), iso(t + WINDOW_DAYS * 864e5 - 1000)]);
  for (const [from, to] of windows) for (const seg of SEGMENTS) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({
        apikey: key, countryCode: 'GB', latlong: `${LONDON.lat},${LONDON.lng}`, radius: '20', unit: 'km',
        segmentId: seg, startDateTime: from, endDateTime: to, size: String(PAGE), page: String(page), sort: 'date,asc', locale: '*',
      });
      const j = await fetchJson(`${API}?${q}`, { ttlMs: 3600e3 });
      for (const e of j._embedded?.events ?? []) {
        if (e.dates?.status?.code === 'cancelled' || !e.dates?.start?.localDate || EXCLUDE.test(e.name)) continue;
        const v = e._embedded?.venues?.[0];
        if (!v?.name) continue;
        const cls = e.classifications?.[0];
        const category = categorise(e.name, [cls?.segment?.name, cls?.genre?.name, cls?.subGenre?.name]);
        if (!category) continue;
        const [y, m, d] = e.dates.start.localDate.split('-').map(Number);
        const t = e.dates.start.localTime ?? null;
        const [hh, mm] = t ? t.split(':').map(Number) : [];
        const start = t ? londonISO(y, m, d, hh, mm) : e.dates.start.localDate;
        const pr = e.priceRanges?.[0];
        const ven = register({
          name: v.name,
          address: [v.address?.line1, v.city?.name, v.postalCode].filter(Boolean).join(', '),
          lat: v.location?.latitude != null ? Number(v.location.latitude) : undefined,
          lng: v.location?.longitude != null ? Number(v.location.longitude) : undefined,
          site: v.url,
        });
        const ev = makeEvent(ven, {
          title: e.name, category, start, url: e.url, source: 'ticketmaster',
          price: pr ? (pr.min === pr.max ? `£${pr.min}` : `£${pr.min}–£${pr.max}`) : undefined,
          blurb: e.info ?? e.pleaseNote,
        });
        out.set(ev.id, ev);
      }
      if (page + 1 >= (j.page?.totalPages ?? 0)) break;
    }
  }
  console.error(`[ticketmaster] kept=${out.size} venues=${venues.length}`);
  return [...out.values()];
}
