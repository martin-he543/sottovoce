// Eventbrite UK — London discover pages (server-rendered; the embedded window.__SERVER_DATA__ holds the same search
// results a logged-out browser renders). Each result is one dated session. No login, no API keys; only /d/ pages with
// ?page=N (robots.txt only disallows query strings starting with calendar/x/i etc.).
//
// `venues` is filled in place during scrape() (run.mjs reads the array reference before scrape resolves).
import { fetchText, clean, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venues = [];

const BASE = 'https://www.eventbrite.co.uk/d/united-kingdom--london';
// [discover slug, max pages]. Results are relevance-ranked, so quality decays with depth; we stop early once pages stop yielding new fits.
const QUERIES = [
  ['opera', 6], ['classical-music', 10], ['concerts', 6], ['choir', 4], ['orchestra', 4],
  ['theatre', 8], ['musical', 6], ['live-music', 10], ['jazz', 8], ['dance', 4], ['ballet', 3],
];

const FORMAT_OK = new Set(['Concert or Performance']);
// things that are not performances (or are not a performing-arts fit)
const EXCLUDE = /\b(workshops?|classes|class|lessons?|masterclass(es)?|courses?|training|rehearsals?|party|parties|rave|raves|quiz|networking|speed dating|tasting|brunch|dinner|afternoon tea|screening|screenings|film|cinema|talks?|lectures?|seminar|webinar|walking tour|tour of|karaoke|silent disco|club night|clubbing|dj set|djs?|trance|yoga|fitness|wellness|health|meditation|sound bath|stand.?up|comedy night|comedy club|murder mystery|book launch|launch party|exhibition|fashion show|expo|conference|auditions?|open mic comedy|bingo|casino|gala dinner|awards?|kids club|baby|toddler|babies|hen party|rituals?|forum|pub choir|sing.?along|vigil|memorial service|conversation with|in conversation|book fair|market|bake sale|pageant|karate|graduation|ceremony|circus|magic shows?|magicians?|comedy|comedian|podcast|men's day|oppressed|mixed by|soul train|afterglow|alldayer|all.?dayer)\b/i;

// Eventbrite answers 429 if we go faster than a person paging through results, so: >=2.5s between live requests, back off on 429.
let lastNet = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function politeFetch(url) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastNet + 2500 - Date.now();
    if (wait > 0 && lastNet) await sleep(wait);
    const t0 = Date.now();
    try {
      const body = await fetchText(url);
      if (Date.now() - t0 > 150) lastNet = Date.now();   // a real network hit (not a disk-cache hit)
      return body;
    } catch (err) {
      lastNet = Date.now();
      if (/^429/.test(err.message) && attempt < 2) { await sleep(60000 * (attempt + 1)); continue; }
      throw err;
    }
  }
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function parseServerData(html) {
  const i = html.indexOf('window.__SERVER_DATA__');
  if (i < 0) throw new Error('no __SERVER_DATA__');
  let e = html.indexOf('window.__REACT_QUERY_STATE__', i);
  if (e < 0) e = html.indexOf('</script>', i);
  const t = html.slice(html.indexOf('=', i) + 1, e).trim().replace(/;\s*$/, '');
  return JSON.parse(t);
}

const subcat = (r) => r.tags.find((t) => t.prefix === 'EventbriteSubCategory')?.display_name;
const format = (r) => r.tags.find((t) => t.prefix === 'EventbriteFormat')?.display_name;

function categorise(r, fallback) {
  const text = `${r.name} ${r.summary ?? ''}`;
  const title = r.name;
  const sub = subcat(r);
  if (/candlelight/i.test(title)) return /\b(musicals?|broadway)\b/i.test(title) ? 'classical' : 'classical';   // Fever "… by Candlelight" instrumental concerts
  if (/\bopera\b/i.test(title) && !/\b(soap|opera house|opera singer)\b/i.test(title)) return 'opera';
  if (/\b(flamenco|ballet|dance)\b/i.test(title) && !/\bmusic(al)?\b.*\bdance party\b/i.test(title)) return 'dance';
  if (/\b(musicals?|broadway|west end|cabaret)\b/i.test(title)) return 'musical';
  if (/\b(classical|carols?|choir|choral|chorus|singers|orchestra|quartet|trio|recital|sonata|symphon\w*|chamber|piano|cello|violin|organ|baroque|requiem|messiah|cantata|stabat|vespers|evensong|mozart|bach|beethoven|brahms|handel|vivaldi|chopin|schubert)\b/i.test(title)) return 'classical';
  if (/\b(jazz|reggae|gig|band|rock|folk|blues|soul|funk|indie|acoustic|songwriter|dj|open mic|live music|vtuber)\b/i.test(title)) return 'live_music';
  if (/\b(play|theatre|theater|drama|monologue|shakespeare|panto|pantomime)\b/i.test(title)) return 'drama';
  const bySub = {
    Opera: 'classical', Classical: 'classical', Orchestra: 'classical', Choir: 'classical', 'Chamber Music': 'classical',
    Musical: 'musical', Dance: 'dance', Ballet: 'dance', Theatre: 'drama', Drama: 'drama', Play: 'drama',
    Jazz: 'live_music', Rock: 'live_music', Pop: 'live_music', Folk: 'live_music', Indie: 'live_music', Blues: 'live_music',
    'R&B': 'live_music', Soul: 'live_music', Electronic: 'live_music', 'Hip Hop': 'live_music', Reggae: 'live_music', Latin: 'live_music', Country: 'live_music',
    Metal: 'live_music', Alternative: 'live_music', World: 'live_music', 'Singer/Songwriter': 'live_music', Acoustic: 'live_music',
  }[sub];
  const g = guessCategory(title);
  return bySub ?? g ?? fallback;
}

const FALLBACK = { opera: null, 'classical-music': 'classical', concerts: 'classical', choir: 'classical', orchestra: 'classical', theatre: 'drama', musical: 'musical', 'live-music': 'live_music', jazz: 'live_music', dance: 'dance', ballet: 'dance' };

function venueKind(name) {
  if (/opera house|\bopera\b.*(hall|house)|coliseum/i.test(name)) return 'opera';
  if (/theatre|theater|playhouse|palladium|cinema|arts centre|studio|stage/i.test(name)) return 'theatre';
  return 'concert';
}

const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 69);

function registerVenue(v, eventUrl) {
  const a = v.address ?? {};
  const lat = a.latitude != null ? Number(a.latitude) : undefined;
  const lng = a.longitude != null ? Number(a.longitude) : undefined;
  const base = `ext_${slug(v.name)}`;
  let id = base;
  const same = venues.find((x) => x.id === id);
  if (same && same.address !== a.localized_address_display && lat != null && same.lat != null && dist({ lat, lng }, same) > 0.3) id = `${base}-${v.id}`;
  let ven = venues.find((x) => x.id === id);
  if (!ven) {
    ven = {
      id, name: clean(v.name), kind: venueKind(v.name),
      address: clean(a.localized_address_display || [a.address_1, a.city, a.postal_code].filter(Boolean).join(', ')),
      ...(Number.isFinite(lat) && Number.isFinite(lng) && { lat, lng }),
      site: v.venue_profile_url || eventUrl,
    };
    venues.push(ven);
  }
  return ven;
}

export async function scrape() {
  const seen = new Map();    // event id -> true
  const seenKey = new Set(); // title|start|venue for cross-listing dupes
  const events = [];
  const stats = { fetched: 0, results: 0, kept: 0 };

  for (const [qslug, maxPages] of QUERIES) {
    let dry = 0;
    for (let n = 1; n <= maxPages; n++) {
      let data;
      try {
        data = parseServerData(await politeFetch(`${BASE}/${qslug}/?page=${n}`));
      } catch (err) {
        console.error(`[eventbrite] ${qslug} p${n}: ${err.message}`);
        break;
      }
      stats.fetched++;
      const results = data.search_data?.events?.results ?? [];
      if (!results.length) break;
      let fresh = 0;
      for (const r of results) {
        stats.results++;
        if (seen.has(r.id)) continue;
        seen.set(r.id, true);
        if (r.is_online_event || r.is_cancelled || r.hide_start_date || !r.start_date || !r.start_time) continue;
        if (!FORMAT_OK.has(format(r))) continue;
        if (!r.locations?.some((l) => l.type === 'region' && /greater london/i.test(l.name)) && !/london/i.test(r.primary_venue?.address?.city ?? '')) continue;
        const v = r.primary_venue;
        if (!v?.name) continue;
        if (EXCLUDE.test(r.name)) continue;
        const sub = subcat(r);
        if (['Comedy', 'Film', 'Literary Arts', 'Fashion', 'Visual Arts', 'Design', 'Photography', 'Gaming', 'Anime'].includes(sub)) continue;
        const [y, m, d] = r.start_date.split('-').map(Number);
        const [hh, mm] = r.start_time.split(':').map(Number);
        const start = londonISO(y, m, d, hh, mm);
        let end;
        if (r.end_date && r.end_time) {
          const [ey, em, ed] = r.end_date.split('-').map(Number);
          const [eh, emin] = r.end_time.split(':').map(Number);
          end = londonISO(ey, em, ed, eh, emin);
          if (Date.parse(end) <= Date.parse(start)) end = undefined;
        }
        const category = categorise(r, FALLBACK[qslug]);
        if (!category) continue;   // no usable signal in title or tags (e.g. unreliable 'Opera' tag on a pop gig)
        const ven = registerVenue(v, r.url);
        const key = `${slug(r.name)}|${start}|${ven.id}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        events.push(makeEvent(ven, {
          title: r.name,
          category,
          start, end,
          url: r.url,
          blurb: r.summary,
          source: 'eventbrite',
        }));
        fresh++;
        stats.kept++;
      }
      dry = fresh ? 0 : dry + 1;
      if (dry >= 2) break;
    }
  }
  console.error(`[eventbrite] pages=${stats.fetched} results=${stats.results} kept=${stats.kept} venues=${venues.length}`);
  return events;
}
