// Royal Opera House: the /tickets-and-events page ships its full catalogue (with every performance date+time)
// in a dehydrated React-Query state blob (window.__REACT_QUERY_DEHYDRATED_STATE__). No per-event fetches needed.
import { fetchText, clean, abs, makeEvent, cheerio } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'roh',
  name: 'Royal Opera House',
  kind: 'opera',
  address: 'Bow Street, London WC2E 9DD',
  lat: 51.5129,
  lng: -0.1222,
  site: 'https://www.rbo.org.uk/tickets-and-events',
};

const BASE = 'https://www.rbo.org.uk';
const text = (html) => clean(cheerio.load(`<div>${html ?? ''}</div>`)('div').text());
const normISO = (s) => String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/\.\d+/, '');

export async function scrape() {
  const html = await fetchText(`${BASE}/tickets-and-events`);
  const m = html.match(/__REACT_QUERY_DEHYDRATED_STATE__\s*=\s*/);
  if (!m) throw new Error('ROH: dehydrated state not found');
  const state = new JSONParseAt(html, m.index + m[0].length);
  const q = state.queries?.find((x) => x.queryKey?.[0] === 'eventsPage')?.state?.data?.events;
  if (!q?.events) throw new Error('ROH: events not found in state');
  const locs = new Map(q.locations.map((l) => [String(l.id), l.title]));
  const tags = new Map(q.tags.map((t) => [String(t.id), t.title]));

  const out = [];
  const seen = new Set();
  for (const e of q.events) {
    if (e.isCancelled || e.isHiddenFromTicketsAndEvents || !e.performances?.length) continue;
    const title = text(e.title);
    const tg = (e.tags ?? []).map((t) => tags.get(String(t)) ?? '');
    const isOpera = tg.includes('Opera and music');
    const isDance = tg.includes('Ballet and dance');
    const lunch = /recitals? at lunch|live at lunch/i.test(title);
    if (tg.some((t) => /^(Tours|Workshops and activities|Talks and insights|Rehearsals|Cinema broadcasts)$/.test(t)) && !isOpera && !isDance) continue;
    if (!isOpera && !isDance) continue;
    if (e.sourceType === 'event-detail') continue; // tours / tea dances etc.
    let category;
    if (/\bin concert\b|recital|lunch|dark nights/i.test(title)) category = /live at lunch/i.test(title) ? 'live_music' : 'classical';
    else if (isDance && !isOpera) category = 'dance';
    else category = isOpera ? 'opera' : (guessCategory(title) ?? 'dance');
    const url = e.productionPageUrl ? abs(e.productionPageUrl.replace(/\?.*$/, ''), BASE) : undefined;
    const hall = locs.get(String(e.locations?.[0]));
    const blurb = text(e.carouselDescription || e.description);
    for (const p of e.performances) {
      const ok = p.performanceType === 'standard' || p.performanceType === 'relaxed' || p.performanceType === 'young-roh' || p.performanceType === 'hamlyn' || (lunch && p.performanceType === 'landp-daytime');
      if (!ok || !p.date) continue;
      const start = normISO(p.date);
      if (Number.isNaN(Date.parse(start))) continue;
      const key = title + start;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(makeEvent(venue, {
        title, category, start, hall: hall && hall !== 'Royal Opera House' ? hall : undefined, url, blurb,
      }));
    }
  }
  return out;
}

/** Parse a JSON value that starts at `pos` in `s` (ignores trailing text). */
function JSONParseAt(s, pos) {
  let depth = 0, inStr = false, esc = false;
  for (let i = pos; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return JSON.parse(s.slice(pos, i + 1)); }
  }
  throw new Error('ROH: unterminated JSON');
}
