// English National Opera at the London Coliseum. The /whats-on/ page embeds <script id="json-data"> with every
// bookable performance for on-sale shows; events that are listed but not yet in that blob have the same blob on their own page.
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'eno',
  name: 'English National Opera (London Coliseum)',
  kind: 'opera',
  address: "London Coliseum, St Martin's Lane, London WC2N 4ES",
  lat: 51.5099,
  lng: -0.1266,
  site: 'https://www.eno.org/whats-on/',
};

const SKIP = new Set(['relaxed-programme', 'abracadopera']); // relaxed = duplicate slots of other shows; abracadopera = schools screening
const parseBlob = ($) => {
  const raw = $('script#json-data').first().contents().text();
  try { return JSON.parse(raw); } catch { return []; }
};
const decode = (s) => clean(String(s ?? '').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;/g, '–').replace(/&#038;|&amp;/g, '&').replace(/&#8216;/g, '‘').replace(/&#039;|&#8217;/g, "'").replace(/&#\d+;/g, ''));

export async function scrape() {
  const $ = await fetchDoc('https://www.eno.org/whats-on/');
  const listing = parseBlob($);
  if (!Array.isArray(listing) || !$('li.listing-item').length) throw new Error('ENO: whats-on structure changed');

  // slug -> {title, surtitle, summary, venue}
  const meta = new Map();
  $('li.listing-item').each((_, li) => {
    const l = $(li);
    meta.set(l.attr('data-id'), {
      title: clean(l.find('h3').first().text()),
      composer: clean(l.find('.surtitle').first().text()),
      summary: clean(l.find('.card__summary').first().text()),
      where: clean(l.find('.event-title__venue-location').first().text()),
    });
  });
  const byId = new Map(listing.map((e) => [e.id, e]));
  const slugs = [...new Set([...meta.keys(), ...byId.keys()])].filter((s) => s && !SKIP.has(s));

  const out = [];
  for (const slug of slugs) {
    const m = meta.get(slug);
    if (m?.where && !/coliseum/i.test(m.where)) continue; // e.g. Aviva Studios, Manchester
    const url = `https://www.eno.org/events/${slug}/`;
    let bookings = byId.get(slug)?.bookings;
    let price, blurb, title = m?.title;
    let page;
    try { page = await fetchDoc(url); } catch { page = null; }
    if (page) {
      if (!bookings?.length) bookings = parseBlob(page);
      title = clean(page('h1').first().text()) || title;
      const txt = clean(page('body').text());
      price = txt.match(/Tickets? from\s*(£\s?\d+)/i)?.[1];
      blurb = clean(page('meta[property="og:description"]').attr('content') || '');
      blurb = blurb.replace(/\s*Book (your|now|tickets)[^.]*\./gi, '').replace(/\s*Book your[^.]*$/i, '');
      if (m?.summary && m.summary.length > 25) blurb = m.summary;
    }
    if (!Array.isArray(bookings)) continue;
    for (const b of bookings) {
      const mt = String(b.raw_date || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
      if (!mt) continue;
      const [y, mo, d, hh, mm] = mt.slice(1).map(Number);
      const name = decode(b.event_name) || title || m?.title;
      const text = `${name} ${m?.summary ?? ''}`;
      const category = /^sessions at\b/i.test(name) || /\b(band|gig)\b/i.test(name) ? 'live_music' : 'opera';
      out.push(makeEvent(venue, {
        title: name,
        category,
        start: londonISO(y, mo, d, hh, mm),
        hall: 'London Coliseum',
        url: b.url ? abs(b.url, 'https://booking.eno.org') : url,
        price: price ? `from ${price.replace(/\s/g, '')}` : undefined,
        blurb: [m?.composer, blurb].filter(Boolean).join(' – ') || undefined,
      }));
    }
  }
  return out;
}
