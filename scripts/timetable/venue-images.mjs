// Usage: node scripts/timetable/venue-images.mjs [--top=N] [--retry]
// Finds up to 4 photos of every venue (busiest first; --top limits it): the lead image of its Wikipedia article, Commons files
// named after it, then Commons photos geotagged around it (60 m, widening to 400 m). Stores id → [{ image, page, title, via }]
// in src/data/venues.images.json.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const TOP = Number(process.argv.find((a) => a.startsWith('--top='))?.slice(6) ?? Infinity);
const retry = process.argv.includes('--retry');
const OUT = join(ROOT, 'src', 'data', 'venues.images.json');
const UA = 'sottovoce/1.0 (https://github.com/; martin.he@memrise.com) venue-images script';
const data = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'timetable.generated.json'), 'utf8'));
let map = {};
try { map = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const counts = new Map();
for (const e of data.events) counts.set(e.venue_id, (counts.get(e.venue_id) ?? 0) + 1);
const venues = data.venues.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, TOP);

const STOP = new Set(['the', 'of', 'and', 'london', 'royal']);
/** Venue name → Wikipedia article, where the search can't tell which article is the venue. */
const ALIASES = {
  'English National Opera (London Coliseum)': 'London Coliseum',
  'Park Theatre': 'Park Theatre, London',
  'Bush Theatre': 'Bush Theatre',
  'Peacock Theatre (Sadler\'s Wells)': 'Peacock Theatre',
  'Theatre Royal Drury Lane': 'Theatre Royal, Drury Lane',
  'St John\'s Smith Square': 'St John\'s, Smith Square',
  'Underbelly Boulevard': 'Underbelly Boulevard Soho',
  'Gillian Lynne Theatre': 'Gillian Lynne Theatre',
  'Arcola Theatre': 'Arcola Theatre',
  'Electric Brixton': 'Electric Brixton',
  'O2 Academy Brixton': 'Brixton Academy',
  'OVO Arena Wembley': 'Wembley Arena',
  'Troubadour Canary Wharf Theatre': 'Troubadour Canary Wharf Theatre',
};
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
const PER_VENUE = 4;
const BAD = /\.svg|logo|map|plan|diagram|seating|poster|signature|flag|coat_of_arms|screenshot|ticket|menu|interior_of_a_|\.pdf|\.tiff?$|\.gif$/i;
const api = async (params, host = 'en.wikipedia.org') => {
  const r = await fetch(`https://${host}/w/api.php?format=json&origin=*&` + new URLSearchParams(params), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};

async function viaWikipedia(v) {
  const j = await api({ action: 'query', generator: 'search', gsrsearch: ALIASES[v.name] ?? `${v.name} London`, gsrlimit: '5', prop: 'pageimages|coordinates', piprop: 'thumbnail|name', pithumbsize: '800', colimit: '5' });
  const pages = Object.values(j.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  const want = words(ALIASES[v.name] ? ALIASES[v.name].replace(/\s*\(.*\)$/, '').replace(/,.*$/, '') : v.name);
  for (const p of pages) {
    // The article must be about this venue: its title (less a "(…)" or ", London" suffix) is the venue's name.
    const got = words(p.title.replace(/\s*\(.*\)$/, '').replace(/,.*$/, ''));
    if (!want.length || got.length !== want.length || !want.every((w) => got.includes(w))) continue;
    if (p.coordinates?.[0] && v.lat != null && Math.hypot(p.coordinates[0].lat - v.lat, (p.coordinates[0].lon - v.lng) * 0.62) > 0.05) continue;
    if (p.thumbnail && !BAD.test(p.pageimage ?? '')) return [{ image: p.thumbnail.source, page: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, title: p.title, via: 'wikipedia' }];
  }
  return [];
}

const fromCommons = (j, via, accept = () => true) =>
  Object.values(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl || !/^image\/(jpeg|png)/.test(ii.mime) || BAD.test(p.title) || !accept(p)) return [];
      return [{ image: ii.thumburl, page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, title: p.title.replace(/^File:/, ''), via }];
    });

async function viaCommonsName(v) {
  const j = await api({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${v.name} London`, gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' }, 'commons.wikimedia.org');
  const want = words(v.name);
  return fromCommons(j, 'commons', (p) => want.length && want.every((w) => words(p.title).includes(w)));
}

async function viaCommonsNear(v) {
  if (v.lat == null || v.lng == null) return [];
  for (const radius of [60, 150, 400]) {
    const j = await api({ action: 'query', generator: 'geosearch', ggscoord: `${v.lat}|${v.lng}`, ggsradius: String(radius), ggsnamespace: '6', ggslimit: '20', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' }, 'commons.wikimedia.org');
    const found = fromCommons(j, 'commons-nearby');
    if (found.length) return found;
  }
  return [];
}

const seen = (list, x) => list.some((y) => y.image === x.image || y.title === x.title);
for (const v of venues) {
  const old = map[v.id];
  if (!retry && Array.isArray(old) && old.length >= PER_VENUE) continue;
  try {
    const list = [];
    for (const find of [viaWikipedia, viaCommonsName, viaCommonsNear]) {
      if (list.length >= PER_VENUE) break;
      for (const x of await find(v)) if (list.length < PER_VENUE && !seen(list, x)) list.push(x);
      await new Promise((r) => setTimeout(r, 150));
    }
    map[v.id] = list;
  } catch (err) { console.log(`! ${v.name}: ${err.message}`); continue; }
  console.log(`${map[v.id].length} ${v.name}${map[v.id][0] ? ' ← ' + map[v.id].map((x) => x.via[0]).join('') : ''}`);
}
await writeFile(OUT, JSON.stringify(map, null, 1));
const have = venues.filter((v) => map[v.id]?.length).length;
console.log(`${have}/${venues.length} venues have photos (${venues.filter((v) => map[v.id]?.length >= 2).length} with several)`);
