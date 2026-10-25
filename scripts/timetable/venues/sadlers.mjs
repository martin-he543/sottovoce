import { fetchDoc, clean, abs, londonISO, parseTime, monthNum, inferYear, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

const main = {
  id: 'sadlers',
  name: "Sadler's Wells",
  kind: 'theatre',
  address: 'Rosebery Avenue, London EC1R 4TN',
  lat: 51.5294,
  lng: -0.1058,
  site: 'https://www.sadlerswells.com/whats-on/',
};
const peacock = {
  id: 'sadlers-peacock',
  name: 'Peacock Theatre (Sadler\'s Wells)',
  kind: 'theatre',
  address: 'Portugal Street, London WC2A 2HT',
  lat: 51.5139,
  lng: -0.1171,
  site: 'https://www.sadlerswells.com/whats-on/?venue-location=peacock-theatre',
};
const east = {
  id: 'sadlers-east',
  name: "Sadler's Wells East",
  kind: 'theatre',
  address: 'East Bank, Queen Elizabeth Olympic Park, London E20 1',
  lat: 51.5436,
  lng: -0.0117,
  site: 'https://www.sadlerswells.com/whats-on/?venue-location=sadlers-wells-east',
};
export const venues = [main, peacock, east];
const venue = main;

const BASE = 'https://www.sadlerswells.com/whats-on/';
const SKIP = /\b(workshop|talk|tour of|backstage|class|masterclass|gift|membership|culture club|family freestyle|taster)\b/i;

/** Listing pages (paginated) → production pages → one event per .c-event-instance. */
export async function scrape() {
  const prods = new Map();
  for (let p = 1; p <= 12; p++) {
    const $ = await fetchDoc(p === 1 ? BASE : `${BASE}page/${p}/`).catch((e) => {
      if (p === 1) throw e;
      return null;
    });
    if (!$) break;
    const cards = $('.c-event-card');
    if (!cards.length) {
      if (p === 1) throw new Error('sadlers: no event cards found');
      break;
    }
    cards.each((_, el) => {
      const c = $(el);
      const href = c.find('a.c-event-card__cover-link').attr('href');
      if (!href) return;
      const url = abs(href, BASE).split('#')[0];
      prods.set(url, clean(c.find('.c-event-card__title').text()));
    });
    if (!$('.c-pagination a.next').length) break;
  }

  const out = [];
  const today = new Date();
  for (const [url, listTitle] of prods) {
    if (SKIP.test(listTitle)) continue;
    let $;
    try { $ = await fetchDoc(url); } catch { continue; }
    const mast = $('h1.c-masthead__title span span').map((_, s) => clean($(s).text())).get().filter(Boolean);
    const title = listTitle || mast.join(' – ');
    let blurb = '';
    $('main p').each((_, p) => {
      const t = clean($(p).text());
      if (!blurb && t.length > 80) blurb = t;
    });
    $('.c-event-instance').each((_, el) => {
      const i = $(el);
      const dateTxt = clean(i.find('.c-event-instance__date').text());
      const timeTxt = clean(i.find('.c-event-instance__time').text());
      const dm = dateTxt.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
      if (!dm) return;
      const day = +dm[1];
      const mon = monthNum(dm[2]);
      if (!mon) return;
      const year = dm[3] ? +dm[3] : inferYear(day, mon, today);
      const t = parseTime(timeTxt);
      const hall = clean(i.find('.c-event-instance__venue-name').text());
      const price = clean(i.find('.c-event-instance__price').text()).replace(/^From:\s*/i, 'from ');
      const note = clean(i.find('.c-event-instance__note').text());
      const pad = (n) => String(n).padStart(2, '0');
      const start = t ? londonISO(year, mon, day, t[0], t[1]) : `${year}-${pad(mon)}-${pad(day)}`;
      if (/cancel/i.test(note)) return;
      const category = /\b(opera)\b/i.test(title) ? 'opera' : /\b(concert|recital|orchestra)\b/i.test(title) ? guessCategory(title, 'live_music') : 'dance';
      const v = /peacock/i.test(hall) ? peacock : /east/i.test(hall) ? east : main;
      out.push(makeEvent(v, {
        title,
        category,
        start,
        hall: v === main ? hall : undefined,
        url: `${url}#instance-${i.find('.c-event-instance__anchor').attr('id')?.replace('instance-', '') ?? ''}`.replace(/#instance-$/, ''),
        price,
        blurb: blurb || undefined,
      }));
    });
  }
  return out.filter(Boolean);
}
