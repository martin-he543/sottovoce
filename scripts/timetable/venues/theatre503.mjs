import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'theatre503',
  name: 'Theatre503',
  kind: 'theatre',
  address: 'The Latchmere, 503 Battersea Park Road, London SW11 3BW',
  lat: 51.4667,
  lng: -0.1652,
  site: 'https://theatre503.com/whats-on/',
};

const SPEKTRIX = 'https://system.spektrix.com/theatre503/api/v3';
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SKIP = /masterclass|workshop|rapid write response|\bclass\b|\btalk\b|fundrais/i;

/** Theatre503 ticketing is Spektrix; the public v3 API lists each performance. The what's-on page gives event URLs. */
export async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances?startFrom=${today}T00:00:00`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('theatre503: unexpected Spektrix payload');

  const urls = new Map();
  const $ = await fetchDoc(venue.site);
  $('.listing .details').each((_, el) => {
    const href = $(el).find('a.cta').first().attr('href');
    if (href) urls.set(norm($(el).find('h3').text()), abs(href, venue.site));
  });

  const byId = new Map(events.filter((e) => !SKIP.test(e.name)).map((e) => [e.id, e]));
  const out = [];
  for (const inst of instances) {
    const e = byId.get(inst.event?.id);
    if (!e || inst.cancelled) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const blurb = clean(String(e.description ?? '').replace(/<[^>]+>/g, ' '));
    const guess = guessCategory(`${e.name} ${blurb}`);
    out.push(makeEvent(venue, {
      title: clean(e.name),
      category: ['musical', 'opera', 'dance'].includes(guess) ? guess : 'drama',
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      url: urls.get(norm(e.name)) ?? venue.site,
      blurb: blurb || undefined,
    }));
  }
  return out;
}
