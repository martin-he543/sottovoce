// Usage: node scripts/timetable/run.mjs [venueId ...]   (no args = all venues + aggregators)
// Writes src/data/timetable.generated.json and prints a per-source report.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OWN_IMAGE_ADAPTERS } from './lib.mjs';
try { process.loadEnvFile(join(ROOT, '.env')); } catch {}
import { CATEGORIES } from './categories.mjs';

const OUT = process.env.TIMETABLE_OUT || join(ROOT, 'src', 'data', 'timetable.generated.json');
const only = process.argv.slice(2);
const dir = join(ROOT, 'scripts', 'timetable', 'venues');
const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));

let previous = { venues: [], events: [], sources: {} };
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const horizon = Date.now() + 200 * 864e5;
const floor = Date.now() - 36 * 3600e3;
const results = await Promise.all(
  files.map(async (f) => {
    const id = f.replace(/\.mjs$/, '');
    if (only.length && !only.includes(id)) return { id, skipped: true };
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const missing = (mod.requires ?? []).filter((k) => !process.env[k]);
      if (missing.length) return { id, skipped: true, missing };   // key-gated adapter: leave its previous output alone
      const venues = mod.venues ?? (mod.venue ? [mod.venue] : []);
      const events = await mod.scrape();
      const bad = events.filter((e) => !CATEGORIES.includes(e.category) || !e.title || Number.isNaN(Date.parse(e.start)));
      if (bad.length) throw new Error(`${bad.length} malformed events, e.g. ${JSON.stringify(bad[0])}`);
      return { id, venues, events: events.filter((e) => Date.parse(e.start) >= floor && Date.parse(e.start) <= horizon) };
    } catch (err) {
      return { id, error: String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ') };
    }
  })
);

const venues = new Map(previous.venues.map((v) => [v.id, v]));
const events = new Map(previous.events.map((e) => [e.id, e]));
const sources = { ...previous.sources };
const now = new Date().toISOString();
for (const r of results) {
  if (r.missing) { console.log(`skipped ${r.id}: set ${r.missing.join(', ')} in .env`); continue; }
  if (r.skipped) continue;
  if (r.error) { sources[r.id] = { ...sources[r.id], ok: false, error: r.error, at: now }; continue; }
  for (const [k, e] of [...events]) if (e.adapter === r.id) events.delete(k);   // replace this adapter's previous output wholesale
  for (const v of r.venues) venues.set(v.id, v);
  for (const e of r.events) events.set(e.id, { ...e, adapter: r.id });
  sources[r.id] = { ok: true, count: r.events.length, at: now };
}

// Aggregators register their own `ext_*` venues. When one is the same place as a curated venue (same name words, or on top of it),
// fold its events into the curated venue so e.g. Ticketmaster's "Royal Albert Hall" lands on /venue/rah.
{
  const w2 = (n = '') => new Set(n.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'theatre', 'theater', 'hall', 'centre', 'center', 'london', 'and', 'room', 'studio', 'music', 'church'].includes(w)));
  const dist = (a, b) => Math.hypot((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180) * 111.3, (a.lat - b.lat) * 111.3);
  const curated = [...venues.values()].filter((v) => !v.id.startsWith('ext_') && v.lat != null);
  let merged = 0;
  for (const v of [...venues.values()]) {
    if (!v.id.startsWith('ext_')) continue;
    const target = curated.find((c) => {
      if (v.lat == null) return false;
      const d = dist(v, c);
      return d < 0.03 || (d < 0.25 && [...w2(v.name)].some((x) => w2(c.name).has(x)));
    });
    if (!target) continue;
    for (const e of events.values()) if (e.venue_id === v.id) { e.venue_id = target.id; e.venue_name = target.name; }
    venues.delete(v.id);
    merged++;
  }
  if (merged) console.log(`merged ${merged} aggregator venues into curated venues`);
}

// Aggregator listings (Eventbrite, Luma) re-list shows that venue adapters already cover, usually under a different title.
// Drop an aggregator event when a first-party event starts the same minute at a nearby venue with a similar name.
const AGGREGATORS = new Set(['eventbrite', 'luma', 'ticketmaster', 'seatgeek', 'skiddle']);
const STOP = new Set(['the', 'theatre', 'theater', 'hall', 'centre', 'center', 'london', 'of', 'and', 'at', 'room', 'studio', 'music', 'church', 'st']);
const words = (n = '') => new Set(n.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const km = (a, b) => Math.hypot((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180) * 111.3, (a.lat - b.lat) * 111.3);
const firstParty = new Map();
for (const e of events.values()) if (!AGGREGATORS.has(e.adapter)) {
  const k = e.start.slice(0, 16);
  if (!firstParty.has(k)) firstParty.set(k, []);
  firstParty.get(k).push(e);
}
let deduped = 0;
for (const [k, e] of [...events]) {
  if (!AGGREGATORS.has(e.adapter)) continue;
  const v = venues.get(e.venue_id);
  if (!v?.lat) continue;
  const dup = (firstParty.get(e.start.slice(0, 16)) ?? []).some((o) => {
    const w = venues.get(o.venue_id);
    if (!w?.lat) return false;
    const d = km(v, w);
    return d < 0.03 || (d < 0.15 && [...words(v.name)].some((x) => words(w.name).has(x)));
  });
  if (dup) { events.delete(k); deduped++; }
}
if (deduped) console.log(`dropped ${deduped} aggregator events already covered by venue adapters`);

// Poster images are resolved separately (images.mjs) into a url → image map; re-attach them here so a re-scrape doesn't lose them.
let images = {};
try { images = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'timetable.images.json'), 'utf8')); } catch {}
for (const e of events.values()) { const img = e.url && images[e.url]; if (img) e.image = img; else if (!OWN_IMAGE_ADAPTERS.has(e.adapter)) delete e.image; }

const out = {
  generated_at: now,
  venues: [...venues.values()].sort((a, b) => a.name.localeCompare(b.name)),
  events: [...events.values()].filter((e) => Date.parse(e.start) >= floor).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  sources,
};
await writeFile(OUT, JSON.stringify(out));

console.log(`\n${out.events.length} events · ${out.venues.length} venues → ${OUT}`);
for (const [id, s] of Object.entries(sources).sort()) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${id.padEnd(16)} ${s.ok ? s.count + ' events' : s.error}`);
