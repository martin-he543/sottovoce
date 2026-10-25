import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'hackney',
  name: 'Hackney Empire',
  kind: 'theatre',
  address: '291 Mare Street, London E8 1EJ',
  lat: 51.5457,
  lng: -0.0553,
  site: 'https://www.hackneyempire.co.uk/whats-on',
};

const BASE = 'https://www.hackneyempire.co.uk/whats-on';
const SPEKTRIX = 'https://system.spektrix.com/hackneyempire/api/v3';
const CAT_PAGES = ['opera', 'dance', 'live-music', 'theatre', 'comedy', 'podcasts-talks', 'family'];
const SKIP_TITLE = /\b(tours?|bootcamp|awards|rottys|pre.show talk|secure my booking|workshop|gift|voucher)\b/i;

/** Listing cards (url, title, Spektrix event id) from the site; categories from category pages; times from the Spektrix public API. */
function cards($) {
  const out = [];
  $('.c-media--event').each((_, el) => {
    const e = $(el);
    const href = e.find('a.c-media__faux-link').attr('href');
    const ed = e.find('event-manager').first().attr(':event-data') || '';
    const id = ed.match(/eventId'\s*:\s*'(\d+)/)?.[1];
    const inst = (e.find('event-manager').first().attr(':instance-data') || '').match(/instanceUrlId'\s*:\s*'(\d+)/)?.[1];
    if (href && id) out.push({ url: abs(href, BASE), id, inst, title: clean(e.find('.c-media__title').text()) });
  });
  return out;
}

export async function scrape() {
  const evs = new Map(); // spektrix numeric id -> {url,title,cats:Set}
  const add = (c, cat) => {
    if (!evs.has(c.id)) evs.set(c.id, { ...c, cats: new Set() });
    else if (!evs.get(c.id).inst) evs.get(c.id).inst = c.inst;
    if (cat) evs.get(c.id).cats.add(cat);
  };
  for (let p = 1; p <= 6; p++) {
    const list = cards(await fetchDoc(p === 1 ? BASE : `${BASE}/page-${p}`));
    const before = evs.size;
    list.forEach((c) => add(c));
    if (evs.size === before) break;
  }
  if (!evs.size) throw new Error('hackney: no event cards found');
  for (const cat of CAT_PAGES) {
    for (let p = 1; p <= 4; p++) {
      let list;
      try { list = cards(await fetchDoc(p === 1 ? `${BASE}/category/${cat}` : `${BASE}/category/${cat}/page-${p}`)); } catch { break; }
      const before = [...evs.values()].reduce((n, e) => n + e.cats.size, 0);
      list.forEach((c) => add(c, cat));
      if ([...evs.values()].reduce((n, e) => n + e.cats.size, 0) === before) break;
    }
  }

  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('hackney: unexpected Spektrix payload');
  const numId = (s) => String(s).match(/^\d+/)?.[0];
  const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const instToEvent = new Map(instances.map((i) => [numId(i.id), i.event?.id]));
  const nameToEvent = new Map(events.map((e) => [norm(e.name), e.id]));
  // site card id -> Spektrix event id (via a shared performance id, else by title)
  const spekOf = new Map();
  for (const [id, ev] of evs) {
    const sid = instToEvent.get(ev.inst) ?? nameToEvent.get(norm(ev.title));
    if (sid) spekOf.set(id, sid);
  }
  const usedIds = new Set(spekOf.keys());

  // decide category per event (fetch event page only for those with performances)
  const decided = new Map();
  for (const [id, ev] of evs) {
    if (!usedIds.has(id) || SKIP_TITLE.test(ev.title)) continue;
    let desc = '';
    let descriptors = [];
    try {
      const $ = await fetchDoc(ev.url);
      desc = clean($('meta[name="description"]').attr('content') || '');
      const dt = $('.c-meta__list dt').filter((_, d) => /what to expect/i.test($(d).text())).first();
      descriptors = dt.next('dd').find('li, span').map((_, x) => clean($(x).text()).toLowerCase()).get();
      if (!descriptors.length) descriptors = clean(dt.next('dd').text()).toLowerCase().split(/\s{2,}|,/).filter(Boolean);
    } catch {}
    const d = descriptors.join('|');
    const txt = `${ev.title} ${desc}`;
    let category = null;
    if (ev.cats.has('opera') || /opera/.test(d)) category = 'opera';
    else if (ev.cats.has('dance') || /dance|ballet/.test(d)) category = 'dance';
    else if (/musical/.test(d) || /\bmusical\b/i.test(ev.title)) category = 'musical';
    else if (ev.cats.has('live-music') || /live music|concert/.test(d)) category = guessCategory(txt) === 'classical' ? 'classical' : 'live_music';
    else if (ev.cats.has('theatre') || /theatre|drama|pantomime|play/.test(d)) category = 'drama';
    else if (!ev.cats.size || ev.cats.has('family')) category = ['opera', 'dance', 'musical', 'classical', 'live_music'].includes(guessCategory(txt)) ? guessCategory(txt) : null;
    if (/stand.?up|comedian/.test(d) && !['opera', 'dance'].includes(category)) category = category === 'drama' || category === 'musical' ? category : null;
    if (category) decided.set(id, { ...ev, category, desc });
  }

  const out = [];
  for (const inst of instances) {
    const ev = [...decided.entries()].find(([id]) => spekOf.get(id) === inst.event?.id)?.[1];
    if (!ev || inst.cancelled) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m || Date.parse(inst.startUtc + 'Z') < Date.now() - 36 * 3600e3) continue;
    const from = clean(inst.attribute_PriceFrom);
    out.push(makeEvent(venue, {
      title: ev.title,
      category: ev.category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      url: ev.url,
      price: from ? (/^£/.test(from) ? `from ${from}` : `from £${from}`) : undefined,
      blurb: ev.desc || undefined,
    }));
  }
  return out;
}
