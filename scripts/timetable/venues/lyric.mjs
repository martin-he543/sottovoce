// Lyric Hammersmith. /whats-on links each show; /shows/<slug>/book-now/ lists every performance server-side
// (li.event-instance with data-instance-date / data-instance-time).
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'lyric',
  name: 'Lyric Hammersmith',
  kind: 'theatre',
  address: 'King Street, London W6 0QL',
  lat: 51.4926,
  lng: -0.2241,
  site: 'https://lyric.co.uk/whats-on/',
};

const SKIP = /\b(masterclass|workshop|comedy club|comedy gala|hair braiding|festival|class|classes|talk|tour|michael mcintyre)\b/i;

export async function scrape() {
  const $ = await fetchDoc(venue.site);
  const slugs = new Set();
  $('a[href*="/shows/"]').each((_, a) => {
    const m = abs($(a).attr('href'), venue.site).match(/\/shows\/([a-z0-9-]+)\/?/);
    if (m) slugs.add(m[1]);
  });
  if (!slugs.size) throw new Error('Lyric: no shows found');

  const out = [];
  for (const slug of slugs) {
    if (SKIP.test(slug.replace(/-/g, ' '))) continue;
    const url = `https://lyric.co.uk/shows/${slug}/`;
    let $b;
    try { $b = await fetchDoc(url + 'book-now/'); } catch { continue; }
    const title = clean($b('h1.page-header__heading').text());
    if (!title || SKIP.test(title)) continue;
    const tags = $b('.page-header__titles-category').map((_, e) => clean($b(e).text())).get().join(' ');
    if (/comedy/i.test(tags) && !/panto|drama|dance|music|theatre/i.test(tags)) continue;   // stand-up
    let blurb = '', hall;
    try {
      const $s = await fetchDoc(url);
      const text = clean($s('main').text());
      hall = text.match(/Venue:\s*([A-Za-z ]+?)(?:\s+Share|\s+Overview|$)/)?.[1];
      blurb = clean($s('meta[name=description]').attr('content') || $s('meta[property="og:description"]').attr('content'));
    } catch {}
    const g = guessCategory(`${title} ${blurb}`);
    const category = /dance/i.test(tags) ? 'dance' : /\bmusic\b/i.test(tags) ? 'live_music' : /\b(new musical|a musical|the musical)\b/i.test(blurb) ? 'musical' : ['musical', 'opera', 'classical', 'live_music'].includes(g) ? g : 'drama';
    $b('li.event-instance').each((_, li) => {
      const el = $b(li);
      const d = el.attr('data-instance-date')?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const t = el.attr('data-instance-time')?.match(/^(\d{1,2}):(\d{2})/);
      if (!d || !t) return;
      const price = clean(el.find('.event-instance__band').first().contents().first().text());
      const flags = clean(el.find('.event-instance__cats').text()).replace(/Sold Out/i, '').trim();
      out.push(makeEvent(venue, {
        title,
        category,
        start: londonISO(+d[1], +d[2], +d[3], +t[1], +t[2]),
        hall: hall || undefined,
        url,
        price: /£/.test(price) ? `from ${price.replace(/\s+/g, '')}` : undefined,
        blurb: [flags, blurb].filter(Boolean).join('. '),
      }));
    });
  }
  return out;
}
