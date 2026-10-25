// SeatGeek — Platform API (https://platform.seatgeek.com/). Needs a free client id in SEATGEEK_CLIENT_ID.
// Without it the adapter is skipped. Taxonomies queried: concerts, classical, theater, dance_performing_arts; London only.
import { fetchJson, londonISO, makeEvent } from '../lib.mjs';
import { EXCLUDE, LONDON, categorise, venueRegistry } from '../external.mjs';

export const requires = ['SEATGEEK_CLIENT_ID'];
export const venues = [];

const API = 'https://api.seatgeek.com/2/events';
const TAXONOMIES = ['concert', 'classical', 'theater', 'dance_performing_arts', 'broadway'];
const PER_PAGE = 100, MAX_PAGES = 10;

export async function scrape() {
  const id = process.env.SEATGEEK_CLIENT_ID;
  const register = venueRegistry(venues);
  const out = new Map();
  const to = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
  for (const tax of TAXONOMIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = new URLSearchParams({
        client_id: id, lat: String(LONDON.lat), lon: String(LONDON.lng), range: '20mi', 'taxonomies.name': tax,
        'datetime_local.lte': to, per_page: String(PER_PAGE), page: String(page), sort: 'datetime_local.asc',
      });
      const j = await fetchJson(`${API}?${q}`, { ttlMs: 3600e3 });
      for (const e of j.events ?? []) {
        const v = e.venue;
        if (!v?.name || e.datetime_tbd || !e.datetime_local || EXCLUDE.test(e.title)) continue;
        if (v.country && v.country !== 'UK' && v.country !== 'GB') continue;
        const genres = [...(e.taxonomies ?? []).map((t) => t.name), ...(e.performers ?? []).flatMap((p) => (p.genres ?? []).map((g) => g.name))];
        const category = categorise(e.title, genres);
        if (!category) continue;
        const [y, m, d, hh, mm] = e.datetime_local.match(/\d+/g).map(Number);
        const ven = register({
          name: v.name,
          address: [v.address, v.extended_address].filter(Boolean).join(', '),
          lat: v.location?.lat, lng: v.location?.lon, site: v.url,
        });
        const st = e.stats ?? {};
        const ev = makeEvent(ven, {
          title: e.title, category, start: londonISO(y, m, d, hh, mm), url: e.url, source: 'seatgeek',
          price: st.lowest_price ? `from £${st.lowest_price}` : undefined,
        });
        out.set(ev.id, ev);
      }
      if (page * PER_PAGE >= (j.meta?.total ?? 0)) break;
    }
  }
  console.error(`[seatgeek] kept=${out.size} venues=${venues.length}`);
  return [...out.values()];
}
