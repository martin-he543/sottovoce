// St Martin-in-the-Fields: the What's On page is populated client-side from a WordPress admin-ajax action
// (`whatson_filter`; /wp-admin/admin-ajax.php is explicitly allowed in robots.txt). We POST it per category
// (concerts, crypt-events) and parse the returned <li> cards. Each card gives "Sat 24 October & Sat 14 November, 7pm":
// a list of dates sharing one time. "Various Times" cards are resolved from the event page's Tickets & Times table.
import { fetchText, cheerio, clean, londonISO, parseTime, monthNum, inferYear, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'stmartins',
  name: 'St Martin-in-the-Fields',
  kind: 'concert',
  address: 'Trafalgar Square, London WC2N 4JJ',
  lat: 51.5086,
  lng: -0.1264,
  site: 'https://www.stmartin-in-the-fields.org/whats-on/',
};

const AJAX = 'https://www.stmartin-in-the-fields.org/wp-admin/admin-ajax.php';
const SKIP = /\b(disco|come and sing|livestream|online|tour|craft fair|eucharist|evensong|prayer|service|talk|here i stand)\b/i;
const LIVE = /\b(beth nielsen|streisand|motown|aretha|sinatra|nashville|jazz|country|cabaret|crypt live|west end musicals)\b/i;

async function postList(category) {
  // fetchText is GET-only, so POST directly (polite: only 2 calls).
  const body = new URLSearchParams({ action: 'whatson_filter' });
  body.append('category[]', category);
  const res = await fetch(AJAX, {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/5.0 sottovoce-timetable/1.0 (personal listings aggregator)', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} for ${AJAX} (${category})`);
  const j = await res.json();
  if (!j?.success || typeof j?.data?.html !== 'string') throw new Error('stmartins: unexpected ajax response');
  return j.data.html;
}

/** "Sat 5, Sun 6 & Sat 12 December" / "Fri 12 March & Sat 13 March 2027" -> [{d,m,y}] */
function parseDates(text) {
  const out = [];
  let pendingNoMonth = [];
  for (const piece of text.split(/,|&/)) {
    const m = piece.match(/(\d{1,2})\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?\s*(\d{4})?/i);
    if (!m) continue;
    const e = { d: +m[1], m: m[2] ? monthNum(m[2]) : null, y: m[3] ? +m[3] : null };
    if (e.m) {
      for (const p of pendingNoMonth) { p.m = e.m; if (!p.y) p.y = e.y; }
      pendingNoMonth = [];
      // a trailing year applies to earlier dates in the same list that lack one
      if (e.y) out.forEach((p) => { if (!p.y && p.m === e.m) p.y = e.y; });
    } else pendingNoMonth.push(e);
    out.push(e);
  }
  return out.filter((e) => e.m).map((e) => ({ ...e, y: e.y ?? inferYear(e.d, e.m) }));
}

export async function scrape() {
  const seen = new Map(); // url -> {$li, cat}
  for (const cat of ['concerts', 'crypt-events']) {
    const $ = cheerio.load(await postList(cat));
    $('li.WhatsonItem').each((_, li) => {
      const a = $(li).find('h3 a').first();
      const url = a.attr('href');
      if (url && !seen.has(url)) seen.set(url, { $, li, cat });
    });
  }
  if (!seen.size) throw new Error('stmartins: no events in ajax response');

  const events = [];
  const now = Date.now() - 6 * 3600e3;
  for (const [url, { $, li, cat }] of seen) {
    const title = clean($(li).find('h3 a').first().text());
    if (!title || SKIP.test(title)) continue;
    const dateText = clean($(li).find('.DateText').first().text());
    const blurb = clean($(li).find('.short-desc').first().text());
    const category = cat === 'crypt-events' || LIVE.test(title) ? 'live_music' : (guessCategory(title) === 'live_music' ? 'live_music' : 'classical');
    const hall = cat === 'crypt-events' ? 'Crypt' : undefined;
    const push = (y, mo, d, t, price) => {
      const start = t ? londonISO(y, mo, d, t[0], t[1]) : `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (Date.parse(start) < now) return;
      events.push(makeEvent(venue, { title, category, start, hall, url, price, blurb }));
    };
    const ci = dateText.lastIndexOf(',');
    const timePart = /\d\s*(am|pm)/i.test(dateText.slice(ci + 1)) ? dateText.slice(ci + 1) : '';
    const hasTime = !!timePart && !/various/i.test(timePart);
    if (hasTime) {
      const t = parseTime(timePart);
      for (const { d, m, y } of parseDates(dateText.slice(0, ci))) push(y, m, d, t);
    } else {
      // "Various Times" or none: read the Tickets & Times table on the event page
      let rows = [];
      try {
        const $p = cheerio.load(await fetchText(url));
        $p('table.whatson-event-details-list tr').each((_, tr) => {
          const tds = $p(tr).find('td').map((_, td) => clean($p(td).text())).get();
          if (tds.length >= 2) rows.push(tds);
        });
      } catch {}
      for (const [dt, tm, price] of rows) {
        const dm = dt.match(/(\d{1,2})\s+([A-Za-z]{3})/);
        if (!dm) continue;
        const mo = monthNum(dm[2]);
        const t = /\d/.test(tm) ? parseTime(tm) : null;
        push(inferYear(+dm[1], mo), mo, +dm[1], t, /£/.test(price ?? '') ? price : undefined);
      }
    }
  }
  return events;
}
