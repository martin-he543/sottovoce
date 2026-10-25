// Usage: node scripts/timetable/images.mjs [--retry]
// Resolves a poster image for every distinct event URL in the generated timetable (og:image / twitter:image / JSON-LD image)
// and stores url → image in src/data/timetable.images.json (null = looked, none found). Resumable: already-resolved URLs are skipped
// unless --retry. run.mjs merges this map into each event's `image`; this script also patches the generated JSON directly.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, OWN_IMAGE_ADAPTERS, fetchText, cheerio, jsonLd, abs } from './lib.mjs';

const DATA = join(ROOT, 'src', 'data', 'timetable.generated.json');
const MAP = join(ROOT, 'src', 'data', 'timetable.images.json');
const retry = process.argv.includes('--retry');

const data = JSON.parse(await readFile(DATA, 'utf8'));
let map = {};
try { map = JSON.parse(await readFile(MAP, 'utf8')); } catch {}

const BAD = /logo|placeholder|default|favicon|sprite|blank|avatar|icon[-_.]|share[-_]?image/i;
const first = (v) => (Array.isArray(v) ? first(v[0]) : typeof v === 'string' ? v : v && typeof v === 'object' ? first(v.url ?? v.contentUrl) : undefined);

function findImage(html, url) {
  const $ = cheerio.load(html);
  const metas = [
    $('meta[property="og:image:secure_url"]').attr('content'),
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[name="twitter:image:src"]').attr('content'),
  ];
  const ld = jsonLd($).filter((n) => /Event|Product|CreativeWork|TheaterEvent|MusicEvent/.test([n['@type']].flat().join(' '))).map((n) => first(n.image));
  for (const c of [...ld, ...metas]) {
    if (!c) continue;
    try {
      const u = abs(c.trim(), url);
      if (u && /^https?:/.test(u) && !BAD.test(new URL(u).pathname)) return u;
    } catch {}
  }
  return null;
}

const urls = [...new Set(data.events.filter((e) => !OWN_IMAGE_ADAPTERS.has(e.adapter)).map((e) => e.url).filter(Boolean))].filter((u) => retry || !(u in map));
console.log(`${urls.length} URLs to resolve (${Object.keys(map).length} already known)`);

let done = 0;
let sinceSave = 0;
const save = () => writeFile(MAP, JSON.stringify(map));
const queue = [...urls];
const worker = async () => {
  for (let u; (u = queue.shift()); ) {
    try {
      map[u] = findImage(await fetchText(u, { ttlMs: 7 * 864e5 }), u);
    } catch (err) {
      // Transient failures stay unresolved so the next run retries them; 404s are final.
      if (/^40[34]|^410/.test(String(err.message))) map[u] = null;
    }
    done++;
    if (++sinceSave >= 100) { sinceSave = 0; await save(); console.log(`${done}/${urls.length}`); }
  }
};
await Promise.all(Array.from({ length: 12 }, worker));

// An image shared by many different pages on one host is a site-wide fallback, not a poster.
const usage = new Map();
for (const [u, img] of Object.entries(map)) {
  if (!img) continue;
  const k = new URL(u).host + ' ' + img;
  usage.set(k, (usage.get(k) ?? 0) + 1);
}
for (const [u, img] of Object.entries(map)) if (img && usage.get(new URL(u).host + ' ' + img) > 6) map[u] = null;
await save();

let withImage = 0;
for (const e of data.events) {
  if (OWN_IMAGE_ADAPTERS.has(e.adapter)) { if (e.image) withImage++; continue; }
  const img = e.url && map[e.url];
  if (img) { e.image = img; withImage++; } else delete e.image;
}
await writeFile(DATA, JSON.stringify(data));
console.log(`${withImage}/${data.events.length} events have an image (${Object.values(map).filter(Boolean).length}/${Object.keys(map).length} URLs)`);
