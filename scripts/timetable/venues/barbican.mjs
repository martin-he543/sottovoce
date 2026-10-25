import { fetchDoc, clean, abs, londonISO, parseTime, monthNum, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'barbican',
  name: 'Barbican Centre',
  kind: 'concert',
  address: 'Silk Street, London EC2Y 8DS',
  lat: 51.52,
  lng: -0.0936,
  site: 'https://www.barbican.org.uk/whats-on',
};

const BASE = 'https://www.barbican.org.uk';
// Category listing pages (chronological, paginated with ?page=N, ~15 per page, dates shown).
// Theatre first: shows cross-listed under music (e.g. a theatre piece with a band) keep their theatre classification.
const SECTIONS = [
  { path: '/whats-on/theatre-dance', fallback: 'drama' },
  { path: '/whats-on/classical-music', fallback: 'classical' },
  { path: '/whats-on/contemporary-music', fallback: 'live_music' },
];
const SKIP = /\b(masterclass|course|lecture|appreciation|workshop|talk|tour|tours|screening|film|exhibition|installation|sound loop|baby|conversation|discussion|in conversation|keynote|symposium|quiz|class)\b/i;
const HORIZON_DAYS = 200;

function parseListingDate(text) {
  // "Sat 24 Oct 2026, 19:30" (single performance) -> {y,m,d,hh,mm}; ranges ("Sat 24 – Sun 25 Oct 2026") -> null
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4}),\s*(\d{1,2}):(\d{2})/);
  if (!m || /[–—-]\s*\w{3}\s+\d/.test(text)) return null;
  return { y: +m[3], m: monthNum(m[2]), d: +m[1], hh: +m[4], mm: +m[5] };
}

function categoryFor(section, title, blurb) {
  const text = `${title} ${blurb}`;
  if (section.fallback === 'classical') {
    if (/\b(opera|poppea|incoronazione|hippolyte et aricie)\b/i.test(title) || /\b(an opera|semi-staged opera|staged opera|opera in)\b/i.test(blurb)) return 'opera';
    return 'classical';
  }
  if (section.fallback === 'live_music') {
    if (/\b(orchestra|quartet|symphony|ensemble|string|piano recital|choir)\b/i.test(text) && /\bclassical|contemporary classical|composer\b/i.test(text)) return 'classical';
    return 'live_music';
  }
  const g = guessCategory(text, 'drama');
  if (/\bdance|choreograph|ballet|hip.hop|physical\b/i.test(text)) return 'dance';
  return ['opera', 'dance', 'musical', 'drama'].includes(g) ? g : 'drama';
}

export async function scrape() {
  const items = new Map(); // node id -> item
  for (const section of SECTIONS) {
    let empty = 0;
    for (let p = 0; p < 40; p++) {
      const $ = await fetchDoc(BASE + section.path + (p ? `?page=${p}` : ''));
      const arts = $('article.listing--event');
      if (!arts.length) break;
      let fresh = 0;
      arts.each((_, a) => {
        const $a = $(a);
        const href = $a.find('a.search-listing__link').attr('href');
        const id = $a.find('[data-saved-event-id]').first().attr('data-saved-event-id');
        const title = clean($a.find('.listing-title').first().text());
        if (!href || !id || !title) return;
        if (items.has(id)) return;
        fresh++;
        const dateText = clean($a.find('.listing-date').first().text());
        const times = $a.find('.listing-date time').map((_, t) => $(t).attr('datetime')).get();
        items.set(id, {
          id, title, section,
          url: abs(href.replace('/index%2Ephp', '').replace('/index.php', ''), BASE),
          dateText,
          lastIso: times[times.length - 1],
          blurb: clean($a.find('.search-listing__intro p').not('.listing-date').first().text()),
        });
      });
      if (!fresh && ++empty >= 2) break;
    }
  }
  if (!items.size) throw new Error('barbican: no listings found, page structure changed?');

  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 864e5;
  const events = [];
  for (const it of items.values()) {
    if (SKIP.test(it.title)) continue;
    if (/\b(sound loop|installation)\b/i.test(it.blurb)) continue;
    const category = categoryFor(it.section, it.title, it.blurb);
    const base = { title: it.title, category, url: it.url, blurb: it.blurb };
    const single = parseListingDate(it.dateText);
    if (single) {
      const start = londonISO(single.y, single.m, single.d, single.hh, single.mm);
      if (Date.parse(start) >= now - 3 * 3600e3 && Date.parse(start) <= horizon) events.push(makeEvent(venue, { ...base, start }));
      continue;
    }
    // Multi-performance run: read the per-performance calendar.
    if (it.lastIso && Date.parse(it.lastIso) < now - 864e5) continue;
    let $;
    try { $ = await fetchDoc(`${BASE}/whats-on/event/${it.id}/performances`); } catch { continue; }
    $('.calendar-item').each((_, c) => {
      const $c = $(c);
      const [mon, yr] = ($c.attr('data-month') || '').split(' ');
      const day = parseInt(clean($c.find('.instance-date__date').first().text()), 10);
      const month = monthNum(mon || '');
      if (!month || !yr || !day) return;
      $c.find('.instance-listing').each((_, l) => {
        const t = parseTime(clean($(l).find('.instance-time__time').text()));
        if (!t) return;
        const start = londonISO(+yr, month, day, t[0], t[1]);
        if (Date.parse(start) < now - 3 * 3600e3 || Date.parse(start) > horizon) return;
        events.push(makeEvent(venue, { ...base, start }));
      });
    });
  }
  // de-duplicate (same id hash) and sort
  const uniq = new Map(events.map((e) => [e.id, e]));
  return [...uniq.values()].sort((a, b) => a.start.localeCompare(b.start));
}
