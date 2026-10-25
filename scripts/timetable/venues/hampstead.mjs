// Hampstead Theatre. Production pages at /production/<slug>/ (linked from /whats-on/); every performance's date/time
// comes from the theatre's own Tessitura TNEW booking site (my.hampsteadtheatre.com) via its public listing endpoint.
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'hampstead',
  name: 'Hampstead Theatre',
  kind: 'theatre',
  address: 'Eton Avenue, Swiss Cottage, London NW3 3EU',
  lat: 51.5434,
  lng: -0.1753,
  site: 'https://www.hampsteadtheatre.com/whats-on/',
};

const API = 'https://my.hampsteadtheatre.com/api/products/productionseasons';
const SKIP = /\b(workshop|talk|tour|voucher|membership|gift|class|masterclass)\b/i;

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
const titleCase = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|A|In|To)\b(?!$)/g, (m, w, o) => (o ? w.toLowerCase() : w)) : t);

export async function scrape() {
  const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00';
  const data = await postJson(API, { startDate: iso(new Date(Date.now() - 36 * 3600e3)), endDate: iso(new Date(Date.now() + 200 * 864e5)), keywords: [] });
  if (!Array.isArray(data?.productions)) throw new Error('Hampstead: unexpected TNEW response');

  const pages = new Map();
  try {
    const $ = await fetchDoc(venue.site);
    $('a[href*="/production/"]').each((_, a) => { const h = abs($(a).attr('href').split('#')[0], venue.site); pages.set(h.split('/').filter(Boolean).pop(), h); });
  } catch {}

  const out = [];
  for (const p of data.productions) {
    const raw = clean(String(p.productionTitle).replace(/<[^>]*>/g, ''));
    if (!raw || SKIP.test(raw)) continue;
    const title = titleCase(raw);
    const s = slugify(raw);
    const url = pages.get(s) || [...pages.entries()].find(([k]) => k === s || k.startsWith(s + '-') || s.startsWith(k + '-'))?.[1];
    let hall = 'Hampstead Theatre', price, blurb = '';
    if (url) {
      try {
        const $p = await fetchDoc(url);
        const text = clean($p('main').text());
        if (/HAMPSTEAD DOWNSTAIRS/i.test(text.slice(0, 200))) hall = 'Hampstead Downstairs';
        const pr = text.slice(0, 400).match(/FROM £\s?(\d+(?:\.\d+)?)/i);
        if (pr) price = `from £${pr[1]}`;
        blurb = clean($p('meta[name=description]').attr('content') || $p('meta[property="og:description"]').attr('content'))
          || $p('main p').map((_, e) => clean($p(e).text())).get().find((t) => t.length > 90 && !/on-sale|ticket/i.test(t)) || '';
      } catch {}
    }
    const guessed = guessCategory(title);
    const category = /\b(musical)\b/i.test(blurb) ? 'musical' : ['musical', 'opera', 'dance'].includes(guessed) ? guessed : 'drama';
    for (const perf of p.performances ?? []) {
      if (perf.isPerformanceVisible === false) continue;
      const m = String(perf.iso8601DateString).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      out.push(makeEvent(venue, {
        title,
        category,
        start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
        hall,
        url: url || abs(perf.actionUrl, API),
        price,
        blurb,
      }));
    }
  }
  return out;
}
