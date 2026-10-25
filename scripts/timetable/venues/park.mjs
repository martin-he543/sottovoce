import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'park',
  name: 'Park Theatre',
  kind: 'theatre',
  address: 'Clifton Terrace, London N4 3JP',
  lat: 51.5645,
  lng: -0.1085,
  site: 'https://parktheatre.co.uk/whats-on/',
};

const SPEKTRIX = 'https://system.spektrix.com/parktheatre/api/v3';
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const recs = (e) => [1, 2, 3, 4].map((n) => e[`attribute_RecommendationCategory${n}`] ?? '').join('|');

/** Park Theatre ticketing is Spektrix; use its public v3 JSON API for every performance, plus the what's-on page for URLs. */
export async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances?startFrom=${today}T00:00:00`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('park: unexpected Spektrix payload');

  const pages = new Map();
  try {
    const $ = await fetchDoc(venue.site);
    $('a[href*="/events/"]').each((_, a) => {
      const slug = ($(a).attr('href') || '').match(/\/events\/([^/#?]+)/)?.[1];
      if (slug && !pages.has(norm(slug.replace(/-\d+$/, '')))) pages.set(norm(slug.replace(/-\d+$/, '')), abs(`/events/${slug}/`, venue.site));
    });
    $('a.card__fill-link[href*="/events/"]').each((_, a) => {
      const name = clean($(a).find('.sr-text, .sr-only').text()).replace(/^Find out more about\s+/i, '');
      if (name) pages.set(norm(name), abs($(a).attr('href'), venue.site));
    });
  } catch {}

  const wanted = new Map();
  for (const e of events) {
    const genre = clean(e.attribute_Genre);
    const r = recs(e);
    if (!genre || /supplementary|creative learning|one-off/i.test(genre)) continue;
    if (/test/i.test(e.name)) continue;
    if (/stand-up/i.test(genre) || /stand-up/i.test(r)) continue;
    if (/^comedy$/i.test(genre) && !/drama|new writing/i.test(r)) continue;
    wanted.set(e.id, e);
  }

  const blurbs = new Map();
  const out = [];
  for (const inst of instances) {
    const e = wanted.get(inst.event?.id);
    if (!e || inst.cancelled) continue;
    if (inst.attribute_SchoolPerformance === true) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const genre = clean(e.attribute_Genre);
    const url = pages.get(norm(e.name)) ?? pages.get(norm(e.name.replace(/\s*[(:].*$/, ''))) ?? venue.site;
    let blurb = clean(String(e.description ?? '').replace(/<[^>]+>/g, ' '));
    if (!blurb && url !== venue.site) {
      if (!blurbs.has(url)) {
        try { blurbs.set(url, clean((await fetchDoc(url))('meta[property="og:description"]').attr('content'))); } catch { blurbs.set(url, ''); }
      }
      blurb = blurbs.get(url);
    }
    const guess = guessCategory(`${e.name} ${blurb}`);
    const category = /^musicals?$/i.test(genre)
      ? (guess === 'opera' ? 'opera' : 'musical')
      : /^music$/i.test(genre) ? (guess === 'live_music' ? 'live_music' : 'classical') : 'drama';
    out.push(makeEvent(venue, {
      title: e.name,
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      hall: clean(e.attribute_Venue) || undefined,
      url,
      blurb: blurb || undefined,
    }));
  }
  return out;
}
