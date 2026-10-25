// Opera Holland Park. Season/event pages list "instances" (month / weekday / day / time) in server-rendered HTML.
// We discover production pages from /season-and-events/ (+ home page), then read each page's instances.
// Off-season (Oct-Mar) only a few ticketed one-offs exist, often at other venues (Cadogan Hall, St Mary Abbots).
import { fetchDoc, clean, abs, londonISO, parseTime, monthNum, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'ohp',
  name: 'Opera Holland Park',
  kind: 'opera',
  address: 'Holland Park, Ilchester Place, London W8 6LU',
  lat: 51.5026,
  lng: -0.2037,
  site: 'https://operahollandpark.com/season-and-events/',
};

const BASE = 'https://operahollandpark.com';
const EXCLUDE = /(gala-dinner|inspire|workshop|dementia|tasting|fundrais|box-office|dress-rehearsal|songs-on-the-steps|testing|past-productions|ticket-schemes|dining|supper)/i;
const OFFSITE = [
  [/cadogan hall/i, 'Cadogan Hall', 51.4934, -0.1587],
  [/st mary abbots/i, 'St Mary Abbots Church', 51.5030, -0.1925],
  [/rackley'?s barn/i, "Rackley's Barn", null, null],
];

export async function scrape() {
  const links = new Set();
  for (const page of [`${BASE}/season-and-events/`, `${BASE}/`]) {
    try {
      const $ = await fetchDoc(page);
      $('a[href]').each((_, a) => {
        const h = abs($(a).attr('href'), page);
        if (h && /^https:\/\/operahollandpark\.com\/(productions|events)\/[^/]+\/?$/.test(h) && !EXCLUDE.test(h)) links.add(h.replace(/\/?$/, '/'));
      });
    } catch (e) {
      if (page.endsWith('/season-and-events/')) throw e;
    }
  }

  const out = [];
  const now = Date.now() - 36 * 3600e3;
  for (const url of links) {
    let $;
    try { $ = await fetchDoc(url); } catch { continue; }
    const title = clean($('h1').first().text());
    if (!title) continue;
    const body = clean($('.article-content').text() || $('body').text());
    const composer = clean($('h2.composer').first().text());
    const off = OFFSITE.find(([re]) => re.test(body));
    const intro = clean($('.article-content p').filter((_, p) => clean($(p).text()).length > 60).first().text());
    const category = /\b(christmas with|concert|songs|prelude|recital|in song|music for|gala)\b/i.test(title)
      ? 'classical'
      : guessCategory(`${title} ${composer}`, 'opera') === 'dance' ? 'dance' : (guessCategory(title, null) === 'classical' ? 'classical' : 'opera');
    $('.instances .month').each((_, mEl) => {
      const mm = clean($(mEl).find('.month-name').first().text()).match(/([A-Za-z]+)\s+(\d{4})/);
      if (!mm) return;
      const month = monthNum(mm[1]);
      const year = +mm[2];
      $(mEl).find('li[role="presentation"] > div, ul.month-instances li div[data-toggle="tab"]').each((_, d) => {
        const day = parseInt(clean($(d).find('.monthday').first().text()), 10);
        const t = parseTime(clean($(d).find('.time').first().text()));
        if (!month || !day) return;
        const start = t ? londonISO(year, month, day, t[0], t[1]) : `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (Date.parse(start) < now) return;
        const pane = $(d).attr('data-target') ? $($(d).attr('data-target')) : null;
        const prices = [];
        pane?.find('td:nth-child(2)').each((_, td) => { const m = clean($(td).text()).match(/£\s?(\d+(?:\.\d+)?)/); if (m) prices.push(+m[1]); });
        out.push(makeEvent(venue, {
          title,
          category,
          start,
          hall: off ? off[1] : undefined,
          venue_name: off ? `${off[1]} (Opera Holland Park)` : undefined,
          url,
          price: prices.length ? `from £${Math.min(...prices)}` : undefined,
          blurb: intro || composer,
          ...(off && off[2] ? { lat: off[2], lng: off[3] } : {}),
        }));
      });
    });
  }
  return out;
}
