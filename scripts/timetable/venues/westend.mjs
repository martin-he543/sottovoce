// West End commercial theatres, via Official London Theatre (officiallondontheatre.com, run by SOLT).
//
// Sources (all openly served HTML; robots.txt only blocks wp-admin):
//  1. /theatre-tickets/ -> JSON-LD TheaterEvent per show (title, url, venue slug, run dates).
//  2. each show page ->
//       a) `data-cal` on the performance calendar: every DATE on which the show plays for the whole run
//          (so dark days, Christmas gaps and closing dates are real, not guessed);
//       b) JSON-LD TheaterEvent nodes with `startDate` (local time + offset): the next 2-4 weeks of real performance times;
//       c) JSON-LD `category` tags (Musical, Plays, Drama, Opera, Dance, Comedy, Entertainment ...), lowest price, blurb.
//
// EXPANSION RULE (documented because it is inferred): the page lists exact times only for the next few weeks.
// For later dates that appear in the calendar we assign start times from the weekly pattern observed in the real
// performances (weekday -> set of times, built from all fully-listed days). If a weekday never occurred in the real
// window (e.g. a one-off Sunday at Christmas) we use the show's most common evening time. Those events carry
// `source: 'venue-pattern'` (real listed times carry `source: 'venue'`). Dates come from the calendar either way, and
// nothing is generated beyond today + 183 days. Special Christmas / school-holiday schedules may differ from the pattern.
//
// OVERLAY (Delfont Mackintosh, delfontmackintosh.co.uk): DMT's own show pages state an explicit "Performance Schedule"
// (weekly pattern, Extra Matinees, Christmas Schedule incl. "No Performances" days). For DMT shows that also appear in OLT,
// that explicit schedule replaces the inferred pattern for dates beyond the real-time window (precedence: OLT real times >
// DMT Christmas/extra dates > DMT weekly pattern > OLT-inferred pattern). DMT shows not (yet) in OLT, e.g. John Proctor Is
// The Villain, are expanded purely from the DMT page: run range + weekly pattern + extras (source 'venue-pattern').
//
// Not included (other adapters/batches cover them or they are not commercial West End): London Coliseum, Sadler's Wells,
// Peacock, Barbican, Globe, Royal Albert Hall, Wilton's and fringe/off-West-End venues. Comedy/magic/circus/concert-only
// listings (Entertainment / Comedy / Concert tags without Musical/Plays/Drama/Opera/Dance) are skipped.
import { fetchText, cheerio, clean, londonISO, makeEvent, parseTime, monthNum } from '../lib.mjs';

const mk = (id, name, address, lat, lng, slug) => ({ id, name, kind: 'theatre', address, lat, lng, site: `https://officiallondontheatre.com/venue/${slug}/` });

// OLT venue slug -> venue (WGS84, approximate to ~50m)
const V = {
  'adelphi-theatre': mk('adelphi-theatre', 'Adelphi Theatre', '409 Strand, London WC2R 0NS', 51.5105, -0.1205, 'adelphi-theatre'),
  'aldwych-theatre': mk('aldwych-theatre', 'Aldwych Theatre', 'Aldwych, London WC2B 4DF', 51.5129, -0.1189, 'aldwych-theatre'),
  'ambassadors-theatre': mk('ambassadors-theatre', 'Ambassadors Theatre', 'West Street, London WC2H 9ND', 51.5130, -0.1285, 'ambassadors-theatre'),
  'apollo-theatre': mk('apollo-theatre', 'Apollo Theatre', '31 Shaftesbury Avenue, London W1D 7EZ', 51.5113, -0.1341, 'apollo-theatre'),
  'apollo-victoria-theatre': mk('apollo-victoria-theatre', 'Apollo Victoria Theatre', '17 Wilton Road, London SW1V 1LG', 51.4953, -0.1437, 'apollo-victoria-theatre'),
  'cambridge-theatre': mk('cambridge-theatre', 'Cambridge Theatre', 'Earlham Street, London WC2H 9HU', 51.5140, -0.1272, 'cambridge-theatre'),
  'criterion-theatre': mk('criterion-theatre', 'Criterion Theatre', '218-223 Piccadilly, London W1J 9HP', 51.5098, -0.1343, 'criterion-theatre'),
  'dominion-theatre': mk('dominion-theatre', 'Dominion Theatre', '268-269 Tottenham Court Road, London W1T 7AQ', 51.5160, -0.1306, 'dominion-theatre'),
  'drury-lane-theatre-royal': mk('theatre-royal-drury-lane', 'Theatre Royal Drury Lane', 'Catherine Street, London WC2B 5JF', 51.5130, -0.1203, 'drury-lane-theatre-royal'),
  'duchess-theatre': mk('duchess-theatre', 'Duchess Theatre', 'Catherine Street, London WC2B 5LA', 51.5127, -0.1197, 'duchess-theatre'),
  'fortune-theatre': mk('fortune-theatre', 'Fortune Theatre', 'Russell Street, London WC2B 5HH', 51.5135, -0.1208, 'fortune-theatre'),
  'garrick-theatre': mk('garrick-theatre', 'Garrick Theatre', '2 Charing Cross Road, London WC2H 0HH', 51.5115, -0.1281, 'garrick-theatre'),
  'gielgud-theatre': mk('gielgud-theatre', 'Gielgud Theatre', '33 Shaftesbury Avenue, London W1D 6AR', 51.5117, -0.1335, 'gielgud-theatre'),
  'gillian-lynne-theatre': mk('gillian-lynne-theatre', 'Gillian Lynne Theatre', 'Drury Lane, London WC2B 5PW', 51.5150, -0.1210, 'gillian-lynne-theatre'),
  'harold-pinter-theatre': mk('harold-pinter-theatre', 'Harold Pinter Theatre', 'Panton Street, London SW1Y 4DN', 51.5094, -0.1315, 'harold-pinter-theatre'),
  'haymarket-theatre-royal': mk('theatre-royal-haymarket', 'Theatre Royal Haymarket', 'Haymarket, London SW1Y 4HT', 51.5089, -0.1317, 'haymarket-theatre-royal'),
  'her-majestys-theatre': mk('his-majestys-theatre', "His Majesty's Theatre", 'Haymarket, London SW1Y 4QL', 51.5085, -0.1320, 'her-majestys-theatre'),
  'lyceum-theatre': mk('lyceum-theatre', 'Lyceum Theatre', '21 Wellington Street, London WC2E 7RQ', 51.5116, -0.1204, 'lyceum-theatre'),
  'lyric-theatre': mk('lyric-theatre', 'Lyric Theatre', '29 Shaftesbury Avenue, London W1D 7ES', 51.5112, -0.1337, 'lyric-theatre'),
  'noel-coward-theatre': mk('noel-coward-theatre', 'Noël Coward Theatre', "85 St Martin's Lane, London WC2N 4AU", 51.5104, -0.1267, 'noel-coward-theatre'),
  'novello-theatre': mk('novello-theatre', 'Novello Theatre', 'Aldwych, London WC2B 4LD', 51.5127, -0.1185, 'novello-theatre'),
  'palace-theatre': mk('palace-theatre', 'Palace Theatre', '113 Shaftesbury Avenue, London W1D 5AY', 51.5134, -0.1291, 'palace-theatre'),
  'phoenix-theatre': mk('phoenix-theatre', 'Phoenix Theatre', '110 Charing Cross Road, London WC2H 0JP', 51.5144, -0.1284, 'phoenix-theatre'),
  'piccadilly-theatre': mk('piccadilly-theatre', 'Piccadilly Theatre', '16 Denman Street, London W1D 7DY', 51.5105, -0.1351, 'piccadilly-theatre'),
  'playhouse-theatre': mk('playhouse-theatre', 'Playhouse Theatre', 'Northumberland Avenue, London WC2N 5DE', 51.5073, -0.1243, 'playhouse-theatre'),
  'prince-edward-theatre': mk('prince-edward-theatre', 'Prince Edward Theatre', '28 Old Compton Street, London W1D 4HS', 51.5138, -0.1317, 'prince-edward-theatre'),
  'prince-of-wales-theatre': mk('prince-of-wales-theatre', 'Prince of Wales Theatre', 'Coventry Street, London W1D 6AS', 51.5100, -0.1327, 'prince-of-wales-theatre'),
  'savoy-theatre': mk('savoy-theatre', 'Savoy Theatre', 'Strand, London WC2R 0ET', 51.5103, -0.1204, 'savoy-theatre'),
  'shaftesbury-theatre': mk('shaftesbury-theatre', 'Shaftesbury Theatre', '210 Shaftesbury Avenue, London WC2H 8DP', 51.5155, -0.1270, 'shaftesbury-theatre'),
  'sondheim-theatre': mk('sondheim-theatre', 'Sondheim Theatre', '51 Shaftesbury Avenue, London W1D 6BA', 51.5117, -0.1326, 'sondheim-theatre'),
  'st-martins-theatre': mk('st-martins-theatre', "St Martin's Theatre", 'West Street, London WC2H 9NZ', 51.5129, -0.1283, 'st-martins-theatre'),
  'the-tom-stoppard-theatre': mk('tom-stoppard-theatre', 'Tom Stoppard Theatre', "104 St Martin's Lane, London WC2N 4BG", 51.5110, -0.1271, 'the-tom-stoppard-theatre'),
  'trafalgar-theatre': mk('trafalgar-theatre', 'Trafalgar Theatre', '14 Whitehall, London SW1A 2DY', 51.5072, -0.1267, 'trafalgar-theatre'),
  'vaudeville-theatre': mk('vaudeville-theatre', 'Vaudeville Theatre', '404 Strand, London WC2R 0NH', 51.5100, -0.1219, 'vaudeville-theatre'),
  'victoria-palace-theatre': mk('victoria-palace-theatre', 'Victoria Palace Theatre', 'Victoria Street, London SW1E 5EA', 51.4964, -0.1425, 'victoria-palace-theatre'),
  'wyndhams-theatre': mk('wyndhams-theatre', "Wyndham's Theatre", 'Charing Cross Road, London WC2H 0DA', 51.5110, -0.1283, 'wyndhams-theatre'),
  // Bridge Theatre is deliberately absent: bridge.mjs reads its own performance API (exact times), so OLT's copy would duplicate it.
};
export const venues = Object.values(V);

const LISTING = 'https://officiallondontheatre.com/theatre-tickets/';
const HORIZON_DAYS = 183;
const decode = (s) => clean(cheerio.load(`<p>${String(s ?? '')}</p>`)('p').text());

function categoryFor(tags, title) {
  const t = new Set(tags.map((x) => x.trim().toLowerCase()));
  if (/improvis/i.test(title) || (t.has('concert') && !t.has('plays') && !t.has('drama'))) return null;
  if (t.has('opera')) return 'opera';
  if (t.has('dance')) return 'dance';
  if (t.has('musical')) return 'musical';
  if (t.has('plays') || t.has('drama')) return 'drama';
  if (t.has('family') || t.has("children's")) return 'drama';
  return null; // Comedy / Entertainment / Concert only
}

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const hm = (min) => [Math.floor(min / 60), min % 60];

function parseJsonLd($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).contents().text());
      for (const n of Array.isArray(j) ? j : j['@graph'] ?? [j]) nodes.push(n);
    } catch {}
  });
  return nodes;
}


// ---------- Delfont Mackintosh overlay ----------
const DM = 'https://www.delfontmackintosh.co.uk';
const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const wdNum = (s) => WD[String(s).slice(0, 3).toLowerCase()];
const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/\bthe musical\b/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const WDRE = '(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*';
const TIMERE = '\\d{1,2}(?:[.:]\\d{2})?\\s*[ap]m';
const timesOf = (str) => [...String(str).matchAll(new RegExp(TIMERE, 'gi'))].map((m) => parseTime(m[0])).filter(Boolean).map(([h, m]) => h * 60 + m);

/** weekday + day + month -> the YYYY-MM-DD (this year or next) whose weekday matches */
function dateFor(wd, day, monthName, year) {
  const mo = monthNum(monthName);
  if (!mo) return null;
  const y0 = new Date().getUTCFullYear();
  for (const y of year ? [+year] : [y0, y0 + 1]) {
    const k = `${y}-${pad(mo)}-${pad(day)}`;
    if (wd == null || weekday(k) === wd) return k;
  }
  return null;
}

function parseSchedule(lines) {
  const weekly = new Map(); // weekday -> Set(min)
  const extra = new Map();  // ymd -> Set(min)
  const xmas = new Map();   // ymd -> Set(min) (empty = no performances)
  let section = 'weekly';
  let firstMat = null; // "First midweek matinee performance: Wednesday 10 February" => weekday matinees only start then
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (/first.*matinee/i.test(line)) {
      const f = line.match(new RegExp(`(${WDRE})\\s+(\\d{1,2})\\s+([A-Za-z]+)(?:\\s+(\\d{4}))?`, 'i'));
      if (f) firstMat = dateFor(wdNum(f[1]), f[2], f[3], f[4]);
    }
    if (/^extra matinees?/i.test(line)) { section = 'extra'; continue; }
    if (/^christmas|^festive|^new year/i.test(line) && !/:\s*\d/.test(line)) { section = 'xmas'; continue; }
    const dated = line.match(new RegExp(`(${WDRE})\\s+(\\d{1,2})\\s+([A-Za-z]+)(?:\\s+(\\d{4}))?\\s*(?::|,|at)\\s*(.*)$`, 'i'));
    if (dated) {
      const ymd = dateFor(wdNum(dated[1]), dated[2], dated[3], dated[4]);
      if (!ymd) continue;
      const times = timesOf(dated[5]);
      if (section === 'xmas') xmas.set(ymd, new Set(times));
      else if (times.length) extra.set(ymd, new Set([...(extra.get(ymd) ?? []), ...times]));
      continue;
    }
    const wk = line.match(new RegExp(`^((?:${WDRE})(?:\\s*(?:-|–|—|&|,|and)\\s*(?:${WDRE}))*)\\s*:\\s*(.*)$`, 'i'));
    if (wk && section === 'weekly') {
      const names = [...wk[1].matchAll(new RegExp(WDRE, 'gi'))].map((m) => wdNum(m[0]));
      const range = names.length === 2 && /(-|–|—)/.test(wk[1]);
      let days = names;
      if (range) { days = []; for (let d = names[0]; ; d = (d + 1) % 7) { days.push(d); if (d === names[1]) break; } }
      const times = timesOf(wk[2]);
      for (const d of days) { if (!weekly.has(d)) weekly.set(d, new Set()); for (const t of times) weekly.get(d).add(t); }
    }
  }
  return { weekly, extra, xmas, firstMat };
}

function parseRange(text) {
  const dt = '(\\d{1,2})\\s+([A-Za-z]+)(?:\\s+(\\d{4}))?';
  let m = text.match(new RegExp(`Booking until\\s+${dt}`, 'i'));
  if (m) { const y = m[3] ?? new Date().getUTCFullYear(); return { from: null, to: `${y}-${pad(monthNum(m[2]))}-${pad(m[1])}` }; }
  m = text.match(new RegExp(`${dt}\\s*-\\s*${dt}`));
  if (m) {
    const y2 = m[6] ?? new Date().getUTCFullYear();
    const y1 = m[3] ?? (monthNum(m[2]) > monthNum(m[5]) ? +y2 - 1 : y2);
    return { from: `${y1}-${pad(monthNum(m[2]))}-${pad(m[1])}`, to: `${y2}-${pad(monthNum(m[5]))}-${pad(m[4])}` };
  }
  return null;
}

async function readDelfont() {
  const out = [];
  try {
    const $l = cheerio.load(await fetchText(`${DM}/whats-on`));
    const slugs = new Set();
    $l('a[href^="/whats-on/"]').each((_, a) => {
      const m = ($l(a).attr('href') ?? '').match(/^\/whats-on\/([a-z0-9-]+)\/?$/);
      if (m) slugs.add(m[1]);
    });
    for (const slug of slugs) {
      try {
        const $ = cheerio.load(await fetchText(`${DM}/whats-on/${slug}`));
        $('br,p,li,div,h1,h2,h3,h4,h5,tr').append('\n');
        const title = clean($('main h1').first().text()) || slug;
        const head = clean($('main').text()).match(/What's On \/ (.{0,400}?)(?: Book Now| Book Tickets| More Information)/)?.[1] ?? '';
        const body = $('body').text().replace(/[ \t ]+/g, ' ').replace(/\n\s*/g, '\n');
        const i = body.indexOf('Performance Schedule');
        if (i < 0) continue;
        const j = body.search(/\n\s*(Show Running Time|Running Time)/i);
        const sched = parseSchedule(body.slice(i + 'Performance Schedule'.length, j > i ? j : i + 1500).split('\n'));
        out.push({ slug, title, url: `${DM}/whats-on/${slug}`, head, range: parseRange(head), ...sched });
      } catch (e) { if (process.env.DEBUG) console.error('dm', slug, e); }
    }
  } catch (e) { if (process.env.DEBUG) console.error('dm list', e); }
  return out;
}

async function readShow(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const m = html.match(/data-cal='([^']*)'/);
  let dates = [];
  if (m) { try { dates = Object.keys(JSON.parse(m[1].replace(/&quot;/g, '"')).dates ?? {}); } catch {} }
  const nodes = parseJsonLd($).filter((n) => n['@type'] === 'TheaterEvent');
  const real = [...new Set(nodes.filter((n) => n.eventAttendanceMode && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(n.startDate ?? '')).map((n) => n.startDate))].sort();
  const withCat = nodes.find((n) => n.category);
  const tags = String(withCat?.category ?? html.match(/"category":"([^"]*)"/)?.[1] ?? '').split(',');
  const low = nodes.map((n) => n.offers?.lowPrice).find((p) => p);
  const desc = decode(nodes.find((n) => n.description)?.description ?? '');
  return { dates, real, tags, low, desc };
}

export async function scrape() {
  const listing = cheerio.load(await fetchText(LISTING));
  const shows = new Map();
  for (const n of parseJsonLd(listing)) {
    if (n['@type'] !== 'TheaterEvent' || !n.url) continue;
    const slug = String(n.location?.name ?? '').replace(/\/$/, '').split('/').pop();
    if (V[slug] && !shows.has(n.url)) shows.set(n.url, { title: decode(n.name), url: n.url, venue: V[slug] });
  }
  if (!shows.size) throw new Error('westend: no shows found in OLT listing');

  const dm = await readDelfont();
  const dmUsed = new Set();
  const out = [];
  const today = key(new Date());
  const last = key(new Date(Date.now() + HORIZON_DAYS * 864e5));
  const priceText = (low) => (low ? `from £${Number(low).toFixed(Number(low) % 1 ? 2 : 0)}` : undefined);

  for (const s of shows.values()) {
    let info;
    try { info = await readShow(s.url); } catch { continue; }
    const category = categoryFor(info.tags, s.title);
    if (!category || !info.dates.length) continue;
    const nk = norm(s.title);
    const sch = dm.find((d) => { const dk = norm(d.title); return dk.length > 4 && nk.length > 4 && (dk.startsWith(nk) || nk.startsWith(dk)) && d.venueOk !== false; });
    if (sch) dmUsed.add(sch.slug);

    // real performances: "2026-10-24T14:30:00+01:00" -> local date + minutes (T00:00 = time not yet published, ignored)
    const realBy = new Map(); // ymd -> Set(minutes)
    const realIso = new Map(); // `${ymd}|${min}` -> iso
    for (const iso of info.real) {
      if (/T00:00/.test(iso)) continue;
      const ymd = iso.slice(0, 10), min = +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
      if (!realBy.has(ymd)) realBy.set(ymd, new Set());
      realBy.get(ymd).add(min);
      realIso.set(`${ymd}|${min}`, iso);
    }
    const realDays = [...realBy.keys()].sort();
    const lastReal = realDays.at(-1);
    // weekday pattern from fully listed days (all but the final, possibly truncated, day)
    const pat = new Map();
    for (const ymd of realDays.slice(0, -1)) {
      const w = weekday(ymd);
      if (!pat.has(w)) pat.set(w, new Set());
      for (const t of realBy.get(ymd)) pat.get(w).add(t);
    }
    const evening = (() => {
      const cnt = new Map();
      for (const t of [...pat.values()].flatMap((x) => [...x]).filter((t) => t >= 17 * 60)) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? [...(realBy.get(lastReal) ?? [])][0];
    })();

    const emit = (ymd, min, source) => {
      const [y, mo, d] = ymd.split('-').map(Number);
      const [h, mi] = hm(min);
      const start = source === 'venue' ? realIso.get(`${ymd}|${min}`) : londonISO(y, mo, d, h, mi);
      out.push(makeEvent(s.venue, { title: s.title, category, start, url: s.url, source, price: priceText(info.low), blurb: info.desc }));
    };

    // pattern times for a date that has no (complete) real listing
    const patternTimes = (ymd) => {
      const w = weekday(ymd);
      let times = new Set(sch?.weekly.get(w) ?? pat.get(w) ?? (evening != null ? [evening] : []));
      if (sch?.firstMat && ymd < sch.firstMat && w >= 1 && w <= 5) times = new Set([...times].filter((t) => t >= 17 * 60));
      if (sch?.xmas.has(ymd)) times = new Set(sch.xmas.get(ymd));
      for (const t of sch?.extra.get(ymd) ?? []) times.add(t);
      return times;
    };

    const days = new Set([...info.dates, ...realDays]);
    if (sch) for (const m of [sch.xmas, sch.extra]) for (const [ymd, t] of m) if (t.size && (!sch.range?.to || ymd <= sch.range.to) && (!sch.range?.from || ymd >= sch.range.from)) days.add(ymd);
    for (const ymd of [...days].filter((d) => d >= today && d <= last).sort()) {
      if (realBy.has(ymd) && ymd !== lastReal) { for (const t of [...realBy.get(ymd)].sort((a, b) => a - b)) emit(ymd, t, 'venue'); continue; }
      const times = patternTimes(ymd);
      if (ymd === lastReal) {
        const realTimes = realBy.get(ymd);
        for (const t of realTimes) emit(ymd, t, 'venue');
        const latest = Math.max(...realTimes);
        for (const t of times) if (t > latest && !realTimes.has(t)) emit(ymd, t, 'venue-pattern');
        continue;
      }
      for (const t of [...times].sort((a, b) => a - b)) emit(ymd, t, 'venue-pattern');
    }
  }

  // Delfont Mackintosh shows that OLT does not (yet) list: expand purely from the DMT page (explicit schedule + run range).
  for (const d of dm) {
    if (dmUsed.has(d.slug) || !d.range?.to || !d.weekly.size) continue;
    const venue = Object.values(V).find((v) => norm(d.head).includes(norm(v.name)));
    if (!venue) continue;
    const category = /\bMusical\b/.test(d.head) ? 'musical' : /\bPlay\b/.test(d.head) ? 'drama' : null;
    if (!category) continue;
    const from = d.range.from && d.range.from > today ? d.range.from : today;
    const to = d.range.to < last ? d.range.to : last;
    for (let t = Date.parse(`${from}T12:00:00Z`); key(new Date(t)) <= to; t += 864e5) {
      const ymd = key(new Date(t));
      const w = weekday(ymd);
      let times = new Set(d.weekly.get(w) ?? []);
      if (d.firstMat && ymd < d.firstMat && w >= 1 && w <= 5) times = new Set([...times].filter((x) => x >= 17 * 60));
      if (d.xmas.has(ymd)) times = new Set(d.xmas.get(ymd));
      for (const x of d.extra.get(ymd) ?? []) times.add(x);
      const [y, mo, dd] = ymd.split('-').map(Number);
      for (const m of [...times].sort((a, b) => a - b)) {
        out.push(makeEvent(venue, { title: d.title, category, start: londonISO(y, mo, dd, ...hm(m)), url: d.url, source: 'venue-pattern' }));
      }
    }
  }
  return out;
}
