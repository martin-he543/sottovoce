// Skiddle — public API v1 (https://github.com/Skiddle/web-api). Needs a free key in SKIDDLE_API_KEY.
// Without it the adapter is skipped. Event codes: LIVE (gigs), THEATRE, DANCE... filtered by a 15 km radius of central London.
import { fetchJson, londonISO, makeEvent } from '../lib.mjs';
import { EXCLUDE, LONDON, categorise, venueRegistry } from '../external.mjs';

export const requires = ['SKIDDLE_API_KEY'];
export const venues = [];

const API = 'https://www.skiddle.com/api/v1/events/search/';
const CODES = [['LIVE', 'live_music'], ['FEST', null]];
const LIMIT = 100, MAX_PAGES = 10;

export async function scrape() {
  const key = process.env.SKIDDLE_API_KEY;
  const register = venueRegistry(venues);
  const out = new Map();
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
  for (const [code, fallback] of CODES) {
    for (let n = 0; n < MAX_PAGES; n++) {
      const q = new URLSearchParams({
        api_key: key, latitude: String(LONDON.lat), longitude: String(LONDON.lng), radius: '15', eventcode: code,
        minDate: today, maxDate: to, limit: String(LIMIT), offset: String(n * LIMIT), order: 'date', description: '1',
      });
      const j = await fetchJson(`${API}?${q}`, { ttlMs: 3600e3 });
      if (j.error) throw new Error(`Skiddle: ${j.errormessage}`);
      for (const e of j.results ?? []) {
        const v = e.venue;
        if (!v?.name || e.cancelled === '1' || !e.date || EXCLUDE.test(e.eventname)) continue;
        const category = categorise(e.eventname, (e.genres ?? []).map((g) => g.name), fallback);
        if (!category) continue;
        const [y, m, d] = e.date.split('-').map(Number);
        const t = e.openingtimes?.doorsopen || e.startdate?.slice(11, 16);
        const [hh, mm] = /^\d{1,2}:\d{2}/.test(t ?? '') ? t.split(':').map(Number) : [];
        const ven = register({
          name: v.name, address: [v.address, v.town, v.postcode].filter(Boolean).join(', '),
          lat: v.latitude ? Number(v.latitude) : undefined, lng: v.longitude ? Number(v.longitude) : undefined, site: e.link,
        });
        const ev = makeEvent(ven, {
          title: e.eventname, category, start: hh != null ? londonISO(y, m, d, hh, mm) : e.date, url: e.link, source: 'skiddle',
          price: e.entryprice, blurb: e.description,
        });
        out.set(ev.id, ev);
      }
      if ((j.results ?? []).length < LIMIT) break;
    }
  }
  console.error(`[skiddle] kept=${out.size} venues=${venues.length}`);
  return [...out.values()];
}
