// Royal Court Theatre. /whats-on lists the season productions (before the "Other Events" heading); each production
// page carries every performance as a .c-instance block ("Thu 3 Dec 7:45pm", notes, booking id).
// (The Spektrix API behind it is disallowed by robots.txt, so we only read the venue's own pages.)
import { cheerio, fetchDoc, clean, abs, londonISO, parseTime, monthNum, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'royalcourt',
  name: 'Royal Court Theatre',
  kind: 'theatre',
  address: 'Sloane Square, London SW1W 8AS',
  lat: 51.4924,
  lng: -0.1565,
  site: 'https://royalcourttheatre.com/whats-on/',
};

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function resolveDate(dow, d, mo) {
  const y0 = new Date().getFullYear() - 1;
  for (let y = y0; y <= y0 + 3; y++) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (DOW[dt.getUTCDay()] === dow.toLowerCase().slice(0, 3) && dt.getTime() > Date.now() - 45 * 864e5) return y;
  }
  return null;
}

export async function scrape() {
  const $ = await fetchDoc('https://royalcourttheatre.com/whats-on/');
  const prods = [];
  let stop = false;
  $('main h2, main h3.c-media__title').each((_, el) => {
    if (stop) return;
    const x = $(el);
    if (el.tagName === 'h2') { if (/other events/i.test(x.text())) stop = true; return; }
    const box = x.closest('.c-media');
    const href = box.attr('@click')?.match(/goToUrl\('([^']+)'/)?.[1] || box.attr('href') || box.find('a[href*="/events/"]').first().attr('href') || box.closest('a').attr('href');
    const sum = clean(x.closest('.c-media').find('.c-media__summary').text());
    if (href) prods.push({ title: clean(x.text()), url: abs(href, 'https://royalcourttheatre.com/'), blurb: sum });
  });
  if (!prods.length) throw new Error('Royal Court: no season productions found');

  const out = [];
  const seenUrl = new Set();
  for (const p of prods) {
    if (seenUrl.has(p.url)) continue;
    seenUrl.add(p.url);
    let $p;
    try { $p = await fetchDoc(p.url); } catch { continue; }
    const text = clean($p('main').text());
    const hall = text.match(/Location\s*((?:Jerwood Theatre (?:Downstairs|Upstairs))|Theatre (?:Downstairs|Upstairs)|[A-Z][A-Za-z' ]{3,40}?)\s*(?:Age guidance|Availability|Running time|Price)/)?.[1];
    const price = text.match(/Price\s*£\s?(\d+(?:\.\d+)?)/)?.[1];
    const desc = clean($p('meta[name=description]').attr('content')) || p.blurb;
    const category = guessCategory(`${p.title}`) === 'musical' ? 'musical' : 'drama';
    if (!$p('.c-instance').length) {
      // no dates tab (e.g. last performance): header reads "Sat 24 Oct, 6:30pm"
      const m = text.match(/([A-Z][a-z]{2}) (\d{1,2}) ([A-Z][a-z]{2}),? (\d{1,2}[:.]\d{2}\s*[ap]m)/);
      const mo = m && monthNum(m[3]);
      const y = m && mo && resolveDate(m[1], +m[2], mo);
      const tm = m && parseTime(m[4].replace('.', ':'));
      if (y && tm) out.push(makeEvent(venue, { title: p.title, category, start: londonISO(y, mo, +m[2], tm[0], tm[1]), hall: hall || undefined, url: p.url, price: price ? `from £${price}` : undefined, blurb: desc }));
    }
    $p('.c-instance').each((_, el) => {
      const inst = $p(el);
      // <event-manager> wraps its markup in a <template>, which cheerio does not traverse: re-parse the serialised HTML.
      const $i = cheerio.load(inst.html() || '');
      const t = clean($i('time').first().text());
      const m = t.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}[:.]\d{2}\s*[ap]m)/i);
      if (!m) return;
      const mo = monthNum(m[3]);
      const y = resolveDate(m[1], +m[2], mo);
      const tm = parseTime(m[4].replace('.', ':'));
      if (!y || !tm) return;
      const notes = clean($i('.c-instance__note').text());
      out.push(makeEvent(venue, {
        title: p.title,
        category,
        start: londonISO(y, mo, +m[2], tm[0], tm[1]),
        hall: hall || undefined,
        url: p.url,
        price: price ? `from £${price}` : undefined,
        blurb: [notes, desc].filter(Boolean).join('. '),
      }));
    });
  }
  return out;
}
