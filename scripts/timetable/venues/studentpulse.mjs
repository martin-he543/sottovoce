// Student Pulse London (studentpulselondon.co.uk) — discounted student tickets for London concerts.
// /concerts is a paginated Event Booking timeline (20 per page, ?start=N). Each card carries title, poster thumb, date, time,
// venue (linking to a map page with lat/long + address) and price. "Sorry, the event is now full…" marks a sold-out event.
// Every event is tagged `student: true`; sold-out ones also get `sold_out: true` (the UI superimposes a red "Sold out" tag).
import { fetchDoc, clean, abs, londonISO, monthNum, parseTime, jsonLd, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';
import { venueRegistry, slug } from '../external.mjs';

const BASE = 'https://studentpulselondon.co.uk';
export const venues = [];
const registry = venueRegistry(venues);
const places = new Map();

async function place(name, address) {
  if (places.has(name)) return places.get(name);
  let p = { name, address };
  try {
    const html = (await fetchDoc(`${BASE}/component/eventbooking/${slug(name.replace(/['’]/g, ''))}/view-map?tmpl=component`, { ttlMs: 7 * 864e5 })).html();
    const m = html.match(/"lat":"(-?[\d.]+)","long":"(-?[\d.]+)"[^}]*?<li>([^<\\]+)/);
    if (m) {
      // Some of the site's map pages store a west-of-Greenwich longitude with the wrong sign (RAH at +0.177); every venue listed is in central/west London.
      const lng = +m[2];
      p = { name, lat: +m[1], lng: lng > 0 && lng < 0.25 ? -lng : lng, address: clean(m[3]) };
    }
  } catch {}
  places.set(name, p);
  return p;
}

export async function scrape() {
  const out = [];
  for (let start = 0; start < 400; start += 20) {
    const $ = await fetchDoc(`${BASE}/concerts${start ? `?start=${start}` : ''}`, { ttlMs: 3 * 3600e3 });
    const cards = $('.eb-event-container');
    // JSON-LD lists the same events with venue and availability, including cards whose HTML omits the venue.
    const ld = new Map(jsonLd($).filter((n) => n['@type'] === 'Event' && n.url).map((n) => [n.url, n]));
    if (!cards.length) {
      if (!start) throw new Error('Student Pulse: listing structure changed');
      break;
    }
    for (const el of cards.toArray()) {
      const c = $(el);
      const a = c.find('a.eb-event-title').first();
      const title = clean(a.text());
      const url = abs(a.attr('href'), BASE);
      const day = +clean(c.find('.eb-event-date-day').text());
      const month = monthNum(clean(c.find('.eb-event-date-month').text()));
      const year = +clean(c.find('.eb-event-date-year').text());
      if (!title || !url || !day || !month || !year) continue;
      const t0 = parseTime(c.find('.eb-time').first().text());
      const t1 = c.find('.eb-time').length > 1 ? parseTime(c.find('.eb-time').eq(1).text()) : null;
      const meta = ld.get(url);
      const venueName = clean(c.find('a.eb-colorbox-map').first().text()) || clean(meta?.location?.name);
      const pl = venueName ? await place(venueName, clean(meta?.location?.address)) : null;
      const venue = registry({ name: venueName || 'London', address: pl?.address, lat: pl?.lat, lng: pl?.lng, site: BASE });
      const prices = [...clean(c.find('.eb-event-price-container').text()).matchAll(/£\s?(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
      const free = /\bfree\b/i.test(c.find('.eb-event-price-container').text());
      const status = clean(c.find('.alert').text());
      const [h, m] = t0 ?? [0, 0];
      out.push(makeEvent(venue, {
        title,
        category: guessCategory(`${title} ${clean(c.find('.event-intro').text()).slice(0, 200)}`, 'classical'),
        start: t0 ? londonISO(year, month, day, h, m) : `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        end: t0 && t1 ? londonISO(year, month, day, t1[0], t1[1]) : undefined,
        url,
        price: prices.length ? `student £${Math.min(...prices)}${prices.length > 1 && Math.max(...prices) > Math.min(...prices) ? '+' : ''}` : free ? 'Free' : undefined,
        blurb: clean(c.find('.event-intro').text()),
        image: abs(c.find('img.eb-thumb-left').attr('src'), BASE),
        source: 'studentpulse',
        student: true,
        sold_out: /event is now full/i.test(status) || /SoldOut/.test(meta?.offers?.availability ?? ''),
      }));
    }
  }
  // The same performance can be listed twice (featured + normal); keep one per id.
  return [...new Map(out.map((e) => [e.id, e])).values()];
}
