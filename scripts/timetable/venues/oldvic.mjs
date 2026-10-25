// The Old Vic. Production pages live under /stage/<slug>/ (listed at /productions/); dates and times come from the
// Old Vic's own Tessitura TNEW booking site (my.oldvictheatre.com), via the same public listing endpoint its calendar uses.
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'oldvic',
  name: 'The Old Vic',
  kind: 'theatre',
  address: 'The Cut, London SE1 8NB',
  lat: 51.5035,
  lng: -0.1108,
  site: 'https://www.oldvictheatre.com/productions/',
};

const API = 'https://my.oldvictheatre.com/api/products/productionseasons';
const SKIP = /\b(storytelling|tour|workshop|talk|screening|in conversation|voucher|membership|quiz|carers?)\b/i;

async function postJson(url, body) {
  await new Promise((r) => setTimeout(r, 700));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'sottovoce-timetable/1.0 (personal listings aggregator)' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function scrape() {
  const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00';
  const data = await postJson(API, { startDate: iso(new Date(Date.now() - 36 * 3600e3)), endDate: iso(new Date(Date.now() + 200 * 864e5)), keywords: [] });
  if (!Array.isArray(data?.productions)) throw new Error('Old Vic: unexpected TNEW response');

  const stage = new Map();   // slug -> url
  try {
    const $ = await fetchDoc('https://www.oldvictheatre.com/productions/');
    $('a[href*="/stage/"]').each((_, a) => { const h = abs($(a).attr('href'), venue.site); stage.set(h.split('/').filter(Boolean).pop(), h); });
  } catch {}

  const out = [];
  for (const p of data.productions) {
    const title = clean(String(p.productionTitle).replace(/<[^>]*>/g, ''));
    if (!title || SKIP.test(title)) continue;
    const s = slugify(title);
    const url = stage.get(s) || [...stage.entries()].find(([k]) => k === s || k.startsWith(s + '-'))?.[1];
    let desc = '', price;
    if (url) {
      try {
        const $p = await fetchDoc(url);
        desc = clean($p('meta[name=description]').attr('content') || $p('meta[property="og:description"]').attr('content'));
        const t = clean($p('main').text()).match(/Tickets\s+(?:Off-Peak\s+)?£\s?(\d+(?:\.\d+)?)/);
        if (t) price = `from £${t[1]}`;
      } catch {}
    }
    const guessed = guessCategory(title);
    const category = /\bmusical\b/i.test(desc) ? 'musical' : ['opera', 'dance'].includes(guessed) ? guessed : 'drama';
    for (const perf of p.performances ?? []) {
      if (perf.isPerformanceVisible === false) continue;
      const m = String(perf.iso8601DateString).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      const status = clean(perf.performanceStatusMessage);
      out.push(makeEvent(venue, {
        title,
        category,
        start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
        hall: 'Old Vic',
        url: url || abs(perf.actionUrl, API),
        price,
        blurb: [/sold out|limited/i.test(status) ? status : '', desc].filter(Boolean).join('. '),
      }));
    }
  }
  return out;
}
