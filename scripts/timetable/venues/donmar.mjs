// Donmar Warehouse. /whats-on lists productions (sections before "In the West End"); each production page has a
// "Dates and Times" instance list: li[data-date] with start time spans.
import { cheerio, fetchDoc, clean, londonISO, parseTime, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'donmar',
  name: 'Donmar Warehouse',
  kind: 'theatre',
  address: '41 Earlham Street, London WC2H 9LX',
  lat: 51.5136,
  lng: -0.1264,
  site: 'https://www.donmarwarehouse.com/whats-on/',
};

export async function scrape() {
  const $ = await fetchDoc('https://www.donmarwarehouse.com/whats-on/');
  const prods = [];
  let stop = false;
  $('main h2, main h3.c-media__title').each((_, el) => {
    if (stop) return;
    const x = $(el);
    if (el.tagName === 'h2') { if (/west end|elsewhere|on tour|past/i.test(x.text())) stop = true; return; }
    const box = x.closest('.c-media');
    const href = box.attr('@click')?.match(/goToUrl\('([^']+)'/)?.[1];
    if (href) prods.push({ title: clean(x.text()), url: href, blurb: clean(box.find('.c-media__summary').text()) });
  });
  if (!prods.length) throw new Error('Donmar: no productions found');

  const out = [];
  const seen = new Set();
  for (const p of prods) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    let $p;
    try { $p = await fetchDoc(p.url); } catch { continue; }
    const text = clean($p('main').text());
    const tp = text.match(/Ticket Prices(.{0,160})/)?.[1] ?? '';
    const nums = [...tp.matchAll(/£\s?(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    const price = nums.length ? `from £${Math.min(...nums)}` : undefined;
    const guessed = guessCategory(p.title);
    const category = ['musical', 'opera', 'dance'].includes(guessed) ? guessed : 'drama';
    const dedupe = new Set();
    $p('li.c-instance-list__item').each((_, li) => {
      const date = $p(li).attr('data-date');
      const $i = cheerio.load($p(li).html() || '');   // content sits inside a <template>; re-parse the serialised HTML
      const spans = $i('.c-instance-list__date-time span');
      const t = parseTime(clean(spans.last().text()));
      const d = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!d || !t || !/\d:\d\d|\d\s*[ap]m/i.test(spans.last().text())) return;
      const start = londonISO(+d[1], +d[2], +d[3], t[0], t[1]);
      if (dedupe.has(start)) return;
      dedupe.add(start);
      const notes = clean($i('.c-instance__notes').text());
      out.push(makeEvent(venue, { title: p.title, category, start, hall: 'Donmar Warehouse', url: p.url, price, blurb: [notes, p.blurb].filter(Boolean).join('. ') }));
    });
  }
  return out;
}
