import { fetchDoc, fetchJson, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

const deanSt = {
  id: 'soho',
  name: 'Soho Theatre',
  kind: 'theatre',
  address: '21 Dean Street, London W1D 3NE',
  lat: 51.5142,
  lng: -0.1318,
  site: 'https://sohotheatre.com/dean-street/',
};
const walthamstow = {
  id: 'soho-walthamstow',
  name: 'Soho Theatre Walthamstow',
  kind: 'theatre',
  address: 'Town Square, Walthamstow, London E17 4JF',
  lat: 51.5867,
  lng: -0.0131,
  site: 'https://sohotheatre.com/walthamstow/',
};
export const venues = [deanSt, walthamstow];

const SPEKTRIX = 'https://system.spektrix.com/sohotheatre/api/v3';
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cats = (e) => [1, 2, 3].flatMap((n) => [e[`attribute_WebsiteFilterCategory${n}`], e[`attribute_AudiencePreference${n}`]]).filter(Boolean).map((c) => c.toLowerCase());

/** Soho Theatre: comedy-heavy. Keep theatre / music / cabaret-without-comedy shows; skip stand-up, comedy, talks, podcasts. */
function wanted(e) {
  const c = cats(e);
  const main = [1, 2, 3].map((n) => (e[`attribute_WebsiteFilterCategory${n}`] ?? '').toLowerCase());
  if (!c.length) return false;
  if (c.some((x) => ['stand up', 'talk', 'podcast'].includes(x))) return false;
  if (/chess|workshop|class\b|hardback|add-ons|dietary|gift/i.test(e.name)) return false;
  if (main.includes('theatre') || main.includes('music')) return true;
  if (main.includes('cabaret') && !main.includes('comedy')) return true;
  return false;
}

/** Soho Theatre ticketing is Spektrix (public v3 API: all performances); the site's own listing pages supply URLs and prices. */
export async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const [events, instances] = await Promise.all([
    fetchJson(`${SPEKTRIX}/events`),
    fetchJson(`${SPEKTRIX}/instances?startFrom=${today}T00:00:00`),
  ]);
  if (!Array.isArray(events) || !Array.isArray(instances)) throw new Error('soho: unexpected Spektrix payload');

  // listing cards: title -> {url, price}
  const cards = new Map();
  for (const base of [deanSt.site, walthamstow.site]) {
    const seen = new Set();
    for (let p = 1; p <= 14; p++) {
      let $;
      try { $ = await fetchDoc(p === 1 ? base : `${base}page/${p}/`); } catch { break; }
      let fresh = 0;
      $('.card--event').each((_, el) => {
        const href = $(el).find('a.card-link').attr('href');
        if (!href || seen.has(href)) return;
        seen.add(href);
        fresh++;
        const key = norm($(el).find('.card-title').text());
        if (!cards.has(key)) cards.set(key, { url: abs(href, base), price: clean($(el).find('.price').text()) });
      });
      if (!fresh) break;
    }
  }
  if (!cards.size) throw new Error('soho: no listing cards found');

  const byId = new Map(events.filter(wanted).map((e) => [e.id, e]));
  const out = [];
  for (const inst of instances) {
    const e = byId.get(inst.event?.id);
    if (!e || inst.cancelled) continue;
    const m = String(inst.start).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const hall = clean(e.attribute_Venue);
    const v = /walthamstow/i.test(hall) ? walthamstow : deanSt;
    const main = [1, 2, 3].map((n) => (e[`attribute_WebsiteFilterCategory${n}`] ?? '').toLowerCase());
    const blurb = clean(String(e.description ?? '').replace(/<[^>]+>/g, ' '));
    const guess = guessCategory(`${e.name} ${blurb}`);
    let category = 'drama';
    if (main.includes('music')) category = guess === 'classical' || /philharmonia|orchestra|brass|quartet/i.test(e.name) ? 'classical' : 'live_music';
    else if (main.includes('cabaret') && !main.includes('theatre')) category = 'live_music';
    else if (['dance', 'musical', 'opera'].includes(guess)) category = guess;
    const card = cards.get(norm(e.name)) ?? cards.get(norm(e.name.replace(/\s*Oct\d\d$/i, '')));
    out.push(makeEvent(v, {
      title: e.name.replace(/\s+/g, ' ').replace(/\.$/, ''),
      category,
      start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
      hall: v === walthamstow ? undefined : hall || undefined,
      url: card?.url ?? v.site,
      price: card?.price ? card.price.replace(/^From\s*/i, 'from ') : undefined,
      blurb: blurb || undefined,
    }));
  }
  return out;
}
