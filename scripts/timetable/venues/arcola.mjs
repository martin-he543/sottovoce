import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'arcola',
  name: 'Arcola Theatre',
  kind: 'theatre',
  address: '24 Ashwin Street, London E8 3DL',
  lat: 51.5455,
  lng: -0.0753,
  site: 'https://www.arcolatheatre.com/whats-on/',
};

const SPEKTRIX = 'https://system.spektrix.com/arcolatheatre/api/v3';
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripYear = (s) => clean(s).replace(/^\d{4}:\s*/, '');

/** Arcola ticketing is Spektrix; the public v3 API has every performance. The what's-on page gives event URLs. */
export async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances?startFrom=${today}T00:00:00`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('arcola: unexpected Spektrix payload');

  const cards = [];
  const $ = await fetchDoc(venue.site);
  $('li.listing-item article.card--event').each((_, el) => {
    const a = $(el).find('a.card__fill-link').attr('href');
    if (a) cards.push({ key: norm($(el).find('.card__heading').text()), url: abs(a, venue.site) });
  });
  const urlFor = (name) => {
    const n = norm(stripYear(name));
    return (cards.find((c) => c.key === n) ?? cards.find((c) => c.key && (n.startsWith(c.key) || c.key.startsWith(n))))?.url;
  };

  const byId = new Map();
  for (const e of events) {
    const genre = clean(e.attribute_Genre).toLowerCase();
    if (/workshop|learning|participat|class|talk|fundrais|comedy/.test(genre) || /\bAYT\b|workshop|masterclass/i.test(e.name)) continue;
    if (!genre) continue;
    byId.set(e.id, e);
  }
  const blurbs = new Map();
  const blurbFor = async (url) => {
    if (!url || url === venue.site) return undefined;
    if (!blurbs.has(url)) {
      try {
        const p = await fetchDoc(url);
        blurbs.set(url, clean(p('meta[property="og:description"]').attr('content') || p('meta[name="description"]').attr('content') || ''));
      } catch { blurbs.set(url, ''); }
    }
    return blurbs.get(url) || undefined;
  };
  const out = [];
  for (const inst of instances) {
    const e = byId.get(inst.event?.id);
    if (!e || inst.cancelled) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const genre = clean(e.attribute_Genre).toLowerCase();
    const url = urlFor(e.name) ?? venue.site;
    const blurb = await blurbFor(url);
    const guess = guessCategory(`${e.name} ${blurb ?? ''}`);
    let category = 'drama';
    if (/opera/.test(genre)) category = 'opera';
    else if (/dance/.test(genre)) category = 'dance';
    else if (/musical/.test(genre)) category = 'musical';
    else if (/music|concert|gig/.test(genre)) category = guess === 'classical' ? 'classical' : 'live_music';
    out.push(makeEvent(venue, {
      title: stripYear(e.name).replace(/\s+/g, ' ').trim(),
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      hall: clean(e.attribute_Location) || undefined,
      url,
      blurb,
    }));
  }
  return out;
}
