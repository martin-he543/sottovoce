// Wigmore Hall. /whats-on embeds a <script id="props"> JSON blob with the performance list (max 5 "pages" x 12 per request,
// filterable by ?startDate=YYYY-MM-DD and ?genres=jazz). We walk forward by startDate to cover ~6 months.
import { fetchText, clean, abs, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'wigmore',
  name: 'Wigmore Hall',
  kind: 'concert',
  address: '36 Wigmore Street, London W1U 2BP',
  lat: 51.5176,
  lng: -0.1493,
  site: 'https://www.wigmore-hall.org.uk/whats-on',
};

const BASE = 'https://www.wigmore-hall.org.uk';
const HORIZON_DAYS = 190;
const SKIP = /\b(workshop|masterclass|talk|lecture|tour|baby|babies|toddler|school visit|study day|in conversation|film)\b/i;

function parseProps(html) {
  const m = html.match(/<script id="props" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('wigmore: props JSON not found, page structure changed?');
  // The embedded JSON contains a few invalid escapes (e.g. "\<!--") — drop stray backslashes.
  const json = m[1].replace(/\\(?!["\\/bfnrtu])/g, '');
  const items = JSON.parse(json)?.data?.page?.items;
  if (!items) throw new Error('wigmore: no items in props');
  return items;
}

/** Walk the listing from today forward; returns performance nodes. */
async function walk(extraQuery, horizon) {
  const out = new Map();
  let start = new Date().toISOString().slice(0, 10);
  for (let loop = 0; loop < 30; loop++) {
    const q = `startDate=${start}${extraQuery}`;
    const first = parseProps(await fetchText(`${BASE}/whats-on?${q}`));
    let items = first;
    if (first.totalPages > 1) {
      const last = Math.min(5, first.totalPages); // the site ignores pages beyond 5
      if (last > 1) items = parseProps(await fetchText(`${BASE}/whats-on?${q}&page=${last}`));
    }
    const nodes = (items.edges || []).map((e) => e.node).filter(Boolean);
    if (!nodes.length) break;
    for (const n of nodes) out.set(n.url, n);
    const lastDate = nodes[nodes.length - 1].groupDate || String(nodes[nodes.length - 1].date).slice(0, 10);
    if (items.edges.length >= first.total || first.totalPages <= 5) break; // everything from `start` has been returned
    if (!lastDate || lastDate < start || Date.parse(lastDate) > horizon) break;
    // continue from the last day returned (a day never has 60 performances, so this always advances)
    start = lastDate === start ? new Date(Date.parse(lastDate) + 864e5).toISOString().slice(0, 10) : lastDate;
  }
  return out;
}

function priceText(t) {
  const nums = [...String(t ?? '').matchAll(/£\s*(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
  if (!nums.length) return undefined;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `£${lo}` : `from £${lo} (up to £${hi})`;
}

const stripTags = (s) => clean(String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+;/g, ';').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"'));

export async function scrape() {
  const horizon = Date.now() + HORIZON_DAYS * 864e5;
  const all = await walk('', horizon);
  if (!all.size) throw new Error('wigmore: no performances found');
  const live = new Set();
  for (const g of ['jazz', 'global']) {
    for (const url of (await walk(`&genres=${g}`, horizon)).keys()) live.add(url);
  }

  const events = [];
  for (const n of all.values()) {
    const title = stripTags(n.titleOverrideText || n.title);
    const blurb = stripTags(n.subtitleText);
    if (!title || SKIP.test(`${title} ${blurb}`)) continue;
    const start = String(n.date || '');
    const ts = Date.parse(start);
    if (Number.isNaN(ts) || ts > horizon || ts < Date.now() - 3 * 3600e3) continue;
    let category = 'classical';
    if (live.has(n.url)) category = 'live_music';
    else if (/\b(opera|opera scenes)\b/i.test(`${title} ${blurb}`)) category = 'opera';
    events.push(makeEvent(venue, {
      title,
      category,
      start,
      url: abs(n.url, BASE),
      price: priceText(n.pricesText),
      blurb,
    }));
  }
  const uniq = new Map(events.map((e) => [e.id, e]));
  return [...uniq.values()].sort((a, b) => a.start.localeCompare(b.start));
}
