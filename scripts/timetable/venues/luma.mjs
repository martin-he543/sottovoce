// Luma (luma.com, formerly lu.ma) — London discover feed.
// Source: the public discover page https://luma.com/london (__NEXT_DATA__ carries the place id) and the same public
// JSON endpoint the page itself calls for "load more" (api2.luma.com/discover/get-paginated-events). No login, no keys.
// Luma London is overwhelmingly tech meetups / hackathons / parties, so this adapter is deliberately strict:
// an event must look like a live performance by its title / calendar name AND by its description, and must not match
// the non-performance exclusion list. A result of zero events on a given day is a correct outcome.
//
// To add known London performing-arts organisers, put their calendar slug (the luma.com/<slug> path) in CALENDARS;
// the calendar page's upcoming items are run through the same filter.
//
// `venues` is filled in place during scrape() (run.mjs reads the array reference before scrape resolves).
import { fetchText, fetchJson, clean, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venues = [];

const CALENDARS = [];   // e.g. 'some-london-chamber-music-society'
const API = 'https://api2.luma.com/discover/get-paginated-events';
const MAX_PAGES = 12;

// Positive signal: the thing is a live performance.
const POSITIVE = /\b(concerts?|recitals?|orchestra|orchestral|symphon\w*|philharmonic|sinfonia|quartet|quintet|trio|chamber music|choir|choral|chorus|opera|operetta|ballet|musical theatre|musical|theatre|theater|play|plays|jazz|gig|gigs|live music|live band|live set|live session|live performance|live at|acoustic|open.?mic|cabaret|variety show|poetry slam|improv|dance performance|dance show|contemporary dance|flamenco|a cappella|string|piano|violin|cello|guitar|singer|songwriter|showcase|unplugged)\b/i;
// Negative signal: the typical Luma non-performance content (and non-performing-arts formats).
const NEGATIVE = /\b(hackathons?|buildathon|hack|meetups?|summit|conference|networking|workshops?|masterclass|talks?|lectures?|panel|fireside|webinar|demo day|pitch|founders?|startups?|ai|agents?|llm|crypto|web3|solana|blockchain|saas|gtm|ventures?|investors?|career|careers|fair|classes|class|course|bootcamp|screening|film|club night|party|rave|afterparty|after.?party|pop.?up|run club|runclub|5k|hike|walk|poker|chess|quiz|trivia|book club|debate|tasting|supper|dinner|brunch|coffee|networking|stand.?up|comedy|tour|game night|games night|scavenger)\b/i;


async function nextData(url, opts) {
  const html = await fetchText(url, opts);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no __NEXT_DATA__ at ${url}`);
  return JSON.parse(m[1]);
}

function fits(entry) {
  const e = entry.event;
  const text = `${e.name} ${entry.calendar?.name ?? ''}`;
  return POSITIVE.test(e.name) && !NEGATIVE.test(e.name) ? true : (POSITIVE.test(text) && !NEGATIVE.test(e.name) && !NEGATIVE.test(entry.calendar?.name ?? ''));
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function descText(mirror) {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.text) out.push(n.text); (n.content ?? []).forEach(walk); if (n.type === 'paragraph') out.push(' '); };
  walk(mirror);
  return clean(out.join(''));
}

function categorise(title, desc) {
  const g = guessCategory(`${title} ${desc.slice(0, 400)}`);
  if (g) return g;
  return 'live_music';
}

function londonParts(iso, tz = 'Europe/London') {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day, +p.hour, +p.minute];
}

function registerVenue(info, eventUrl) {
  const name = clean(info.address || info.short_address || '');
  if (!name) return null;
  const full = info.full_address || info.localized?.['en-GB']?.full_address || name;
  const id = `ext_${slug(name)}`;
  let v = venues.find((x) => x.id === id);
  if (!v) {
    const c = info.place_coordinate ?? {};
    v = { id, name, kind: /opera house|coliseum/i.test(name) ? 'opera' : /theatre|theater|playhouse|palladium|stage/i.test(name) ? 'theatre' : 'concert', address: clean(full), ...(c.latitude != null && { lat: c.latitude, lng: c.longitude }), site: eventUrl };
    venues.push(v);
  }
  return v;
}

export async function scrape() {
  // 1. London discover place id + all upcoming London events via the public paginated feed
  const nd = await nextData('https://luma.com/london');
  const placeId = nd.props.pageProps.initialData.data.place.api_id;
  const entries = new Map();
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = `${API}?discover_place_api_id=${placeId}&pagination_limit=50${cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : ''}`;
    const j = await fetchJson(url);
    for (const e of j.entries ?? []) entries.set(e.api_id, e);
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  // 2. optional curated calendars
  for (const cal of CALENDARS) {
    try {
      const d = (await nextData(`https://luma.com/${cal}`)).props.pageProps.initialData.data;
      for (const e of d.featured_items ?? []) if (e.event) entries.set(e.api_id, { ...e, calendar: e.calendar ?? d.calendar });
    } catch (err) { console.error(`[luma] calendar ${cal}: ${err.message}`); }
  }

  // 3. strict filter, then confirm on the event page (description, venue, price)
  const out = [];
  const scanned = entries.size;
  let candidates = 0;
  for (const entry of entries.values()) {
    const e = entry.event;
    if (e.location_type !== 'offline' || e.visibility !== 'public') continue;
    if (!fits(entry)) continue;
    candidates++;
    let page;
    try { page = (await nextData(`https://luma.com/${e.url}`)).props.pageProps.initialData.data; } catch (err) { console.error(`[luma] ${e.url}: ${err.message}`); continue; }
    const ev = page.event;
    const geo = ev.geo_address_info;
    if (!geo || !/london|greater london/i.test(`${geo.city ?? ''} ${geo.region ?? ''} ${geo.full_address ?? ''}`)) continue;
    const desc = descText(page.description_mirror);
    // description must not read like a tech/networking event or a club night
    if (/\b(networking|founders|startups?|hackathon|dj set|clubnight|club night|dance floor|disco|house.led|workshop)\b/i.test(`${ev.name} ${desc.slice(0, 600)}`)) continue;
    const ven = registerVenue(geo, `https://luma.com/${ev.url}`);
    if (!ven) continue;
    const tz = ev.timezone || 'Europe/London';
    const s = londonParts(ev.start_at, tz);
    const en = ev.end_at ? londonParts(ev.end_at, tz) : null;
    const t = page.ticket_info;
    const price = t?.is_free ? 'Free' : t?.price ? `£${(t.price.cents / 100).toFixed(t.price.cents % 100 ? 2 : 0)}${t.max_price && t.max_price.cents !== t.price.cents ? `–£${(t.max_price.cents / 100).toFixed(0)}` : ''}` : undefined;
    out.push(makeEvent(ven, {
      title: ev.name,
      category: categorise(ev.name, desc),
      start: londonISO(...s),
      end: en ? londonISO(...en) : undefined,
      url: `https://luma.com/${ev.url}`,
      price,
      blurb: desc,
      source: 'luma',
    }));
  }
  console.error(`[luma] scanned=${scanned} candidates=${candidates} kept=${out.length}`);
  return out;
}
