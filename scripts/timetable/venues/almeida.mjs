// Almeida Theatre. The site's WordPress calendar uses /admin/wp-admin/admin-ajax.php (disallowed by robots.txt), so we use
// the Tessitura TNEW ticketing site's own public listing endpoint (POST /api/products/productionseasons), which returns
// every performance with an ISO local datetime, and map titles to almeida.co.uk/whats-on pages for URLs/blurbs.
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'almeida',
  name: 'Almeida Theatre',
  kind: 'theatre',
  address: 'Almeida Street, London N1 1TA',
  lat: 51.5389,
  lng: -0.1030,
  site: 'https://almeida.co.uk/whats-on/',
};

const API = 'https://ticketing.almeida.co.uk/api/products/productionseasons';
const SKIP = /\b(tour|workshop|talk|voucher|membership|dinner|gift)\b/i;

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

export async function scrape() {
  const from = new Date(Date.now() - 36 * 3600e3);
  const to = new Date(Date.now() + 200 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00';
  const data = await postJson(API, { startDate: iso(from), endDate: iso(to), keywords: [] });
  if (!Array.isArray(data?.productions)) throw new Error('Almeida: unexpected TNEW response');

  // title -> whats-on page
  const pages = new Map();
  try {
    const $ = await fetchDoc('https://almeida.co.uk/whats-on/');
    $('a[href*="/whats-on/"]').each((_, a) => {
      const href = $(a).attr('href');
      const t = clean($(a).text()).replace(/\s*(Event Information|Book Tickets).*$/i, '');
      const slug = href.split('/').filter(Boolean).pop();
      if (slug && slug !== 'whats-on') pages.set(slug, href);
    });
  } catch {}
  const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const out = [];
  for (const p of data.productions) {
    const title = clean(String(p.productionTitle).replace(/<[^>]*>/g, ''));
    if (!title || SKIP.test(title)) continue;
    const pageUrl = pages.get(slugify(title)) || [...pages.entries()].find(([s]) => s === slugify(title.replace(/^the /i, '')) || s.replace(/^the-/, '') === slugify(title).replace(/^the-/, ''))?.[1];
    let blurb = '';
    if (pageUrl) {
      try {
        const $p = await fetchDoc(pageUrl);
        blurb = clean($p('meta[name=description]').attr('content')) || $p('main p').map((_, e) => clean($p(e).text())).get().find((t) => t.length > 80 && !/ticket|sold out|availability|★/i.test(t)) || '';
      } catch {}
    }
    const guessed = guessCategory(title);
    const category = ['musical', 'opera', 'dance'].includes(guessed) ? guessed : 'drama';
    for (const perf of p.performances ?? []) {
      if (perf.isPerformanceVisible === false) continue;
      const m = String(perf.iso8601DateString).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      const status = clean(perf.performanceStatusMessage);
      out.push(makeEvent(venue, {
        title,
        category,
        start: londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]),
        hall: 'Almeida Theatre',
        url: pageUrl || abs(perf.actionUrl, API),
        blurb: [/sold out|limited/i.test(status) ? status : '', blurb].filter(Boolean).join('. '),
      }));
    }
  }
  return out;
}
