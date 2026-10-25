// Shakespeare's Globe + Sam Wanamaker Playhouse. whats-on listing -> one page per production, each listing
// every performance (date row + time buttons). robots.txt asks for Crawl-delay 10, so we pace ourselves.
import { fetchDoc, clean, londonISO, parseTime, monthNum, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'globe',
  name: "Shakespeare's Globe",
  kind: 'theatre',
  address: '21 New Globe Walk, Bankside, London SE1 9DT',
  lat: 51.5081,
  lng: -0.0972,
  site: 'https://www.shakespearesglobe.com/whats-on/',
};

const SKIP = /\b(tour|tours|workshop|course|cpd|revision|demonstration|teaching|talk|lecture|exhibition|voucher|membership)\b/i;
const SKIP_TAGS = /guided tours|teaching|young people|shakespeare and race/i;
const HALLS = /(globe theatre|sam wanamaker playhouse|bankside)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastNetwork = 0;
/** Crawl-delay: 10 -> wait 10s between real network fetches (fast returns = disk cache, no wait needed). */
async function polite(url) {
  const gap = 10000 - (Date.now() - lastNetwork);
  if (lastNetwork && gap > 0) await sleep(gap);
  const t0 = Date.now();
  const $ = await fetchDoc(url);
  if (Date.now() - t0 > 40) lastNetwork = Date.now();
  else lastNetwork = lastNetwork && lastNetwork - 10000 > 0 ? lastNetwork : 0;
  return $;
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** "FRI 15 JANUARY" -> {y,m,d}; year chosen so the weekday matches, searching today-30d .. +2y. */
function parseDay(txt) {
  const m = clean(txt).match(/([a-z]{3})[a-z]*\s+(\d{1,2})\s+([a-z]+)/i);
  if (!m) return null;
  const mo = monthNum(m[3]);
  const d = +m[2];
  const y0 = new Date().getFullYear() - 1;
  for (let y = y0; y <= y0 + 3; y++) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (DOW[dt.getUTCDay()] === m[1].toLowerCase() && dt.getTime() > Date.now() - 45 * 864e5) return { y, m: mo, d };
  }
  return null;
}

function minPrice(txt) {
  const nums = [...String(txt ?? '').matchAll(/£\s?(\d+(?:\.\d+)?)/g)].map((x) => parseFloat(x[1])).filter((n) => n > 0);
  if (!nums.length) return undefined;
  const n = Math.min(...nums);
  return `from £${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function timeFrom(txt) {
  const t = clean(txt);
  if (/noon/i.test(t)) return [12, 0];
  const m = t.match(/(\d{1,2})[.:](\d{2})\s*(am|pm)/i);
  return m ? parseTime(`${m[1]}:${m[2]}${m[3]}`) : null;
}

export async function scrape() {
  const $ = await polite('https://www.shakespearesglobe.com/whats-on/');
  const cards = [];
  const seen = new Set();
  $('section.c-event-card').each((_, el) => {
    const x = $(el);
    const a = x.find('.c-event-card__cover-link').first();
    const url = a.attr('href');
    const title = clean(a.text() || x.find('.c-event-card__title').text());
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const hall = clean(x.find('.c-event-card__venue').first().text());
    const tags = clean(x.find('.c-event-card__bottom-details').text());
    const blurb = clean(x.find('.c-event-card__description').text());
    if (SKIP.test(title) || SKIP_TAGS.test(tags)) return;
    if (hall && !HALLS.test(hall)) return;            // "At Home" etc.
    cards.push({ url, title, hall, blurb });
  });
  if (!cards.length) throw new Error('Globe: no event cards found');

  const out = [];
  for (const c of cards) {
    let $p;
    try { $p = await polite(c.url); } catch { continue; }
    const hall = clean($p('.c-masthead__location [role=listitem]').first().text()) || c.hall;
    const guess = guessCategory(`${c.title} ${c.blurb}`);
    const isMusic = /\b(concert|recital|consort|baroque|early music|choir|choral|orchestra|music of)\b/i.test(`${c.title} ${c.blurb}`);
    const category = isMusic ? 'classical' : guess === 'dance' ? 'dance' : /\b(new musical|a musical|the musical)\b/i.test(c.blurb) ? 'musical' : 'drama';
    const base = { title: c.title, category, hall, url: c.url, blurb: c.blurb };

    const rows = $p('.c-event-listing');
    if (rows.length) {
      rows.each((_, r) => {
        const day = parseDay($p(r).find('.c-event-listing__date').text());
        if (!day) return;
        $p(r).find('.c-time-slot').each((__, s) => {
          const slot = $p(s);
          const btn = slot.find('a[href*="basket."]').first();
          const t = timeFrom(btn.text() || btn.find('.u-hidden-visually').text());
          if (!t) return;                                  // sold-out slots show no time; skip them
          const notes = clean(slot.find('.c-time-slot__notes, .c-time-slot__details').text());
          out.push(makeEvent(venue, {
            ...base,
            start: londonISO(day.y, day.m, day.d, t[0], t[1]),
            price: minPrice(slot.find('.c-event-listing__price').text()),
            blurb: notes ? `${notes}. ${c.blurb}` : c.blurb,
          }));
        });
      });
    } else {
      // single-performance page: masthead reads "24 October – 7.30 PM"
      const txt = clean($p('.c-masthead__dates').text());
      const m = txt.match(/(\d{1,2})\s+([A-Za-z]+)\s+[–-]\s+(.*)$/);
      const t = m && timeFrom(m[3]);
      if (m && t && monthNum(m[2])) {
        const mo = monthNum(m[2]);
        const now = new Date();
        let y = now.getFullYear();
        if (new Date(y, mo - 1, +m[1]) < new Date(now.getTime() - 45 * 864e5)) y += 1;
        out.push(makeEvent(venue, { ...base, start: londonISO(y, mo, +m[1], t[0], t[1]), price: minPrice($p('.c-masthead__price-label').text()) }));
      }
    }
  }
  return out;
}
