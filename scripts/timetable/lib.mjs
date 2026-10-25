import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

export { cheerio };
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_DIR = join(ROOT, 'scripts', 'timetable', '.cache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 sottovoce-timetable/1.0 (personal listings aggregator)';

const lastHit = new Map();
/** At most one request per host per ~700ms, so we stay polite when adapters run in parallel. */
async function throttle(url) {
  const host = new URL(url).host;
  const wait = Math.max(0, (lastHit.get(host) ?? 0) + 700 - Date.now());
  lastHit.set(host, Date.now() + wait);
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/**
 * GET a URL as text. Cached on disk for `ttlMs` (default 6h) so adapter development doesn't hammer venues;
 * pass `{ fresh: true }` or set TIMETABLE_FRESH=1 to bypass.
 */
export async function fetchText(url, { headers = {}, ttlMs = 6 * 3600e3, timeoutMs = 30000, fresh = !!process.env.TIMETABLE_FRESH } = {}) {
  const key = createHash('sha1').update(url).digest('hex');
  const file = join(CACHE_DIR, key);
  if (!fresh) {
    try {
      const meta = JSON.parse(await readFile(file + '.json', 'utf8'));
      if (Date.now() - meta.at < ttlMs) return await readFile(file + '.body', 'utf8');
    } catch {}
  }
  await throttle(url);
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = await res.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file + '.body', body);
  await writeFile(file + '.json', JSON.stringify({ url, at: Date.now() }));
  return body;
}

/** Adapters whose listing pages give a poster image and whose event pages carry no og:image of their own. */
export const OWN_IMAGE_ADAPTERS = new Set(['studentpulse']);

export const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));
export const fetchDoc = async (url, opts) => cheerio.load(await fetchText(url, opts));

export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const abs = (href, base) => (href ? new URL(href, base).toString() : undefined);

/** Europe/London UTC offset (+01:00 BST / +00:00 GMT) for a calendar date, so naive local times can be stored as unambiguous ISO. */
export function londonOffset(y, m, d, hh = 12) {
  const probe = new Date(Date.UTC(y, m - 1, d, hh));
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(probe);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m2 = tz.match(/GMT([+-]\d+)?/);
  const h = m2?.[1] ? parseInt(m2[1], 10) : 0;
  return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`;
}

/** Build an ISO string with the correct London offset from local date/time parts. */
export function londonISO(y, m, d, hh = 0, mm = 0) {
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:00${londonOffset(y, m, d, hh)}`;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export const monthNum = (s) => MONTHS[String(s).slice(0, 3).toLowerCase()];

/**
 * Parse "7:30pm", "19:30", "7.30 pm", "noon" → [h, m] or null.
 */
export function parseTime(s) {
  const t = String(s ?? '').toLowerCase();
  if (/\bnoon\b/.test(t)) return [12, 0];
  const m = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** Infer a full year for a "24 Oct" style date: the next occurrence on or after (today - 60 days). */
export function inferYear(day, month, today = new Date()) {
  const floor = new Date(today.getTime() - 60 * 864e5);
  let y = today.getFullYear();
  if (new Date(y, month - 1, day) < floor) y += 1;
  return y;
}

/** Collect every schema.org node from a document's JSON-LD (flattening @graph / arrays). */
export function jsonLd($) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      out.push(n);
      if (n['@graph']) walk(n['@graph']);
      if (n.itemListElement) walk(n.itemListElement);
      if (n.item) walk(n.item);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).contents().text())); } catch {}
  });
  return out;
}

/**
 * Normalise an adapter's raw event into the timetable schema. Throws on missing essentials so bad parses surface in the report.
 * `start` must be an ISO string with offset (use londonISO) or date-only 'YYYY-MM-DD' (then `time_known:false`).
 */
export function makeEvent(venue, raw) {
  const title = clean(raw.title);
  if (!title) throw new Error('event without title');
  if (!raw.start || Number.isNaN(Date.parse(raw.start))) throw new Error(`event "${title}" has bad start "${raw.start}"`);
  if (!raw.category) throw new Error(`event "${title}" has no category`);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw.start);
  const id = createHash('sha1').update([venue.id, title, raw.start, raw.hall ?? ''].join('|')).digest('hex').slice(0, 12);
  return {
    id,
    title,
    category: raw.category,
    start: raw.start,
    end: raw.end,
    time_known: !dateOnly,
    venue_id: venue.id,
    venue_name: raw.venue_name ?? venue.name,
    hall: raw.hall ? clean(raw.hall) : undefined,
    url: raw.url,
    price: raw.price ? clean(raw.price) : undefined,
    blurb: raw.blurb ? clean(raw.blurb).slice(0, 280) : undefined,
    source: raw.source ?? 'venue',
    ...(raw.image && { image: raw.image }),
    ...(raw.student && { student: true }),
    ...(raw.sold_out && { sold_out: true }),
    ...(raw.lat != null && { lat: raw.lat, lng: raw.lng }),
  };
}
