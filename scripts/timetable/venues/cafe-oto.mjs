// Cafe OTO (Dalston): experimental / improvised / new music. /events/?page=N lists one card per night with the date line
// ("Saturday 24 October 2026, 7.30pm"); multi-night residencies/festivals are shells ("29–31 October 2026") whose detail
// page lists each night with its own date line, title and URL.
import { fetchDoc, clean, abs, londonISO, monthNum, makeEvent } from '../lib.mjs';

export const venue = {
  id: 'cafe-oto',
  name: 'Cafe OTO',
  kind: 'concert',
  address: '18-22 Ashwin Street, London E8 3DL',
  lat: 51.5478,
  lng: -0.0753,
  site: 'https://www.cafeoto.co.uk/events/',
};

const BASE = 'https://www.cafeoto.co.uk';
const SKIP = /\b(talk|book launch|workshop|screening|listening session|reading group|lecture|film|exhibition|record fair|launch party|winter fair|offsite)\b/i;

/** "Saturday 24 October 2026, 7.30pm" | "Thursday 5 November 2026, 5.30–7pm" -> {y,m,d,hh,mm} or null */
function parseNight(text) {
  const m = clean(text).match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}),?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?(?:\s*[–-]\s*(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm))?/i);
  if (!m) return null;
  const month = monthNum(m[2]);
  if (!month) return null;
  let hh = +m[4];
  const mm = m[5] ? +m[5] : 0;
  let ap = (m[6] || '').toLowerCase();
  if (!ap && m[9]) {
    // "2–5pm": start inherits the end's meridiem when that keeps the start before the end
    const endAp = m[9].toLowerCase();
    const to24 = (h, a2) => (h % 12) + (a2 === 'pm' ? 12 : 0);
    const endH = to24(+m[7], endAp);
    ap = to24(hh, endAp) < endH ? endAp : endAp === 'pm' ? 'am' : 'pm';
  }
  if (!ap) ap = hh >= 1 && hh <= 8 ? 'pm' : 'am'; // venue doesn't open before noon: bare "7" means evening
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;
  return { y: +m[3], m: month, d: +m[1], hh, mm };
}

const firstPrice = ($el) => {
  const m = clean($el.text()).match(/£\s*\d+(?:\.\d+)?/);
  return m ? `from ${m[0].replace(/\s+/g, '')}` : undefined;
};

function cardTitle($, $card) {
  // second .each-header holds the title (prefix span, link, suffix span)
  const $p = $card.find('.each-header p').filter((_, p) => $(p).find('a').length).first();
  const link = $p.find('a').first();
  const title = clean([$p.find('.prefix').text(), link.text(), $p.find('.suffix').text()].join(' ')).replace(/^(show \+ live ?stream|live ?stream):\s*/i, '');
  return { title, href: link.attr('href') };
}

export async function scrape() {
  const events = [];
  const shells = [];
  let seenAny = false;
  for (let page = 1; page <= 20; page++) {
    const $ = await fetchDoc(`${BASE}/events/${page > 1 ? `?page=${page}` : ''}`).catch(() => null);
    if (!$) break;
    const cards = $('.each-activity');
    if (!cards.length) break;
    seenAny = true;
    cards.each((_, c) => {
      const $c = $(c);
      const dateLine = clean($c.find('.each-header').first().text());
      const { title, href } = cardTitle($, $c);
      if (!title || !href || SKIP.test(title)) return;
      const night = /\d{4}/.test(dateLine) && /\d{1,2}\s*(?:[.:]\d{2})?\s*(am|pm)/i.test(dateLine) ? parseNight(dateLine) : null;
      if (night) {
        events.push(makeEvent(venue, {
          title, category: 'live_music', url: abs(href, BASE),
          start: londonISO(night.y, night.m, night.d, night.hh, night.mm),
          price: firstPrice($c.find('.each-price')),
        }));
      } else if (/\d{4}/.test(dateLine)) {
        shells.push({ title, href });
      }
    });
    if (!$(`a[href="?page=${page + 1}"]`).length) break;
  }
  if (!seenAny) throw new Error('cafe-oto: no event cards found, page structure changed?');

  for (const s of shells) {
    let $;
    try { $ = await fetchDoc(abs(s.href, BASE)); } catch { continue; }
    $('.each-activity').each((_, c) => {
      const $c = $(c);
      const links = $c.find('.each-header p a');
      if (links.length < 2) return;
      const night = parseNight($(links[0]).text());
      const sub = clean($(links[1]).text());
      if (!night || !sub || SKIP.test(sub)) return;
      events.push(makeEvent(venue, {
        title: sub, category: 'live_music', url: abs($(links[0]).attr('href'), BASE),
        start: londonISO(night.y, night.m, night.d, night.hh, night.mm),
        price: firstPrice($c.find('.event-detail-meta')),
        blurb: s.title,
      }));
    });
  }

  const now = Date.now() - 3 * 3600e3;
  const uniq = new Map(events.filter((e) => Date.parse(e.start) >= now).map((e) => [e.id, e]));
  return [...uniq.values()].sort((a, b) => a.start.localeCompare(b.start));
}
