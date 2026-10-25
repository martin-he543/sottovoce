import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'bush',
  name: 'Bush Theatre',
  kind: 'theatre',
  address: '7 Uxbridge Road, London W12 8LJ',
  lat: 51.5034,
  lng: -0.2257,
  site: 'https://www.bushtheatre.co.uk/whats-on/',
};

const SPEKTRIX = 'https://system.spektrix.com/bushtheatre/api/v3';
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Bush ticketing is Spektrix; its public v3 JSON API lists every performance with local start time. */
export async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances?startFrom=${today}T00:00:00`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('bush: unexpected Spektrix payload');

  // event page URLs from the site's what's-on slider
  const pages = new Map();
  try {
    const $ = await fetchDoc(venue.site);
    $('.events_slide').each((_, el) => {
      const a = $(el).find('a.events_slide__link').first();
      if (a.attr('href')) pages.set(norm(a.find('h3').text()), abs(a.attr('href'), venue.site));
    });
  } catch {}

  const byId = new Map(events.map((e) => [e.id, e]));
  const out = [];
  for (const inst of instances) {
    const ev = byId.get(inst.event?.id);
    if (!ev || inst.cancelled) continue;
    if (/supplementary/i.test(ev.attribute_SeasonGrouping ?? '') || /supplementary/i.test(ev.attribute_WebsiteCategorisation ?? '')) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const genre = clean(ev.attribute_Genre);
    const blurb = clean(String(ev.description ?? '').replace(/\r?\n/g, ' '));
    let category = /music|gig|concert/i.test(genre) ? 'live_music' : /musical/i.test(`${ev.name} ${genre}`) ? 'musical' : 'drama';
    if (category === 'drama' && /\b(dance|ballet)\b/i.test(genre)) category = 'dance';
    const hall = clean(inst.attribute_Location || ev.attribute_TicketVenue || '').replace(/\s*\(.*\)$/, '');
    out.push(makeEvent(venue, {
      title: ev.name,
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      hall: hall || undefined,
      url: pages.get(norm(ev.name)) ?? venue.site,
      blurb: blurb || undefined,
    }));
  }
  return out;
}
