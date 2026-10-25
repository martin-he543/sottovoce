// Wilton's Music Hall (Whitechapel): music hall, cabaret, opera, new writing, musical theatre, concerts.
// /whats-on/?event-page=N lists events (category label hidden in an HTML comment); each event page has a
// "Tickets & Times" table (rows "Sat 24 Oct" | "2:30 pm") that gives every performance.
import { fetchDoc, clean, abs, londonISO, parseTime, monthNum, inferYear, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'wiltons',
  name: "Wilton's Music Hall",
  kind: 'theatre',
  address: "1 Graces Alley, London E1 8JB",
  lat: 51.5113,
  lng: -0.0698,
  site: 'https://www.wiltons.org.uk/whats-on',
};

const BASE = 'https://wiltons.org.uk';
const SKIP_LABEL = /\b(tour|talk|comedy|film|exhibition|workshop|learning|community|private)\b/i;
const SKIP_TITLE = /\b(history tours?|guided tour|tours?|workshop|masterclass|gift|voucher|membership|quiz)\b/i;

function categoryFor(label, title, blurb) {
  const text = `${label} ${title} ${blurb}`;
  if (/opera/i.test(label) || /\bopera\b/i.test(title)) return 'opera';
  if (/dance/i.test(label) || /\b(ballet|dance)\b/i.test(title)) return 'dance';
  if (/musical/i.test(label)) return 'musical';
  if (/^(theatre|new writing|drama)$/i.test(label.trim())) return 'drama';
  const g = guessCategory(text, null);
  if (/cabaret/i.test(label)) return g === 'classical' ? 'classical' : 'live_music';
  if (/^music$/i.test(label.trim())) return g === 'classical' ? 'classical' : 'live_music';
  return g && g !== 'opera' ? g : 'drama';
}

export async function scrape() {
  const items = new Map();
  for (let page = 1; page <= 15; page++) {
    const url = page === 1 ? `${BASE}/whats-on/` : `${BASE}/whats-on/?date-from=&date-to=&event-page=${page}&venue=&category=`;
    const $ = await fetchDoc(url).catch(() => null);
    if (!$) break;
    const cards = $('li.WhatsonItem');
    if (!cards.length) break;
    let fresh = 0;
    cards.each((_, el) => {
      const $e = $(el);
      const a = $e.find('h3 a').first();
      const href = (a.attr('href') || '').replace(/\/+$/, '/');
      const title = clean(a.text());
      if (!href || !title || items.has(href)) return;
      fresh++;
      const label = clean(($e.html() || '').match(/category=\d+[^>]*>([^<]+)<\/a>/)?.[1] || '');
      items.set(href, { href, title, label, blurb: clean($e.find('.short-desc p').first().text()) });
    });
    if (!fresh) break;
  }
  if (!items.size) throw new Error("wiltons: no event cards found, page structure changed?");

  const events = [];
  for (const it of items.values()) {
    if (SKIP_LABEL.test(it.label) || SKIP_TITLE.test(it.title)) continue;
    let $;
    try { $ = await fetchDoc(abs(it.href, BASE)); } catch { continue; }
    const blurb = clean($('.whatson-event-details-content p').filter((_, p) => clean($(p).text()).length > 60).first().text()) || it.blurb;
    const category = categoryFor(it.label, it.title, blurb);
    $('#datetime_tbody_web tr').each((_, tr) => {
      const tds = $(tr).find('td');
      const dm = clean($(tds[0]).text()).match(/(\d{1,2})\s+([A-Za-z]{3})/);
      const t = parseTime(clean($(tds[1]).text()));
      if (!dm || !t) return;
      const month = monthNum(dm[2]);
      const y = inferYear(+dm[1], month);
      const start = londonISO(y, month, +dm[1], t[0], t[1]);
      const book = $(tr).find('a[href*="booking"]').first().attr('href');
      events.push(makeEvent(venue, { title: it.title, category, start, url: abs(it.href, BASE), blurb }));
    });
  }
  const now = Date.now() - 3 * 3600e3;
  const uniq = new Map(events.filter((e) => Date.parse(e.start) >= now).map((e) => [e.id, e]));
  return [...uniq.values()].sort((a, b) => a.start.localeCompare(b.start));
}
