// Conway Hall (Holborn): Sunday Concerts (chamber music), lunchtime recitals, plus many talks (skipped).
// /events/ renders every upcoming event as <li class="ch-event-filter" data-category=... data-date="YYYY-MM-DD HH:MM:SS">.
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'conway-hall',
  name: 'Conway Hall',
  kind: 'concert',
  address: '25 Red Lion Square, London WC1R 4RL',
  lat: 51.5185,
  lng: -0.1188,
  site: 'https://www.conwayhall.org.uk/events/',
};

const BASE = 'https://www.conwayhall.org.uk';

export async function scrape() {
  const $ = await fetchDoc(`${BASE}/events/`);
  const cards = $('li.ch-event-filter');
  if (!cards.length) throw new Error('conway-hall: no event cards found, page structure changed?');
  const out = [];
  cards.each((_, el) => {
    const $e = $(el);
    const cats = clean($e.attr('data-category')).split(' ');
    if (!cats.includes('concerts')) return; // talks, film, workshops, walks, exhibitions are not performances
    const m = clean($e.attr('data-date') || $e.find('time').attr('datetime')).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return;
    const title = clean($e.find('.event-title').first().text()).replace(/\s*:\s*/, ': ');
    if (!title) return;
    const blurb = clean($e.find('.uk-modal-body p').first().text());
    const href = $e.find('a[href*="/whats-on/event/"]').first().attr('href');
    let category = guessCategory(`${title} ${blurb}`, 'classical');
    if (!['classical', 'opera', 'live_music', 'dance'].includes(category)) category = 'classical';
    if (/\b(sunday concerts|lunchtime recitals?|quartet|trio|carols)\b/i.test(title)) category = 'classical';
    out.push(makeEvent(venue, {
      title,
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      url: abs(href, BASE),
      blurb,
    }));
  });
  const now = Date.now() - 3 * 3600e3;
  return out.filter((e) => Date.parse(e.start) >= now).sort((a, b) => a.start.localeCompare(b.start));
}
