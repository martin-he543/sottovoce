import { fetchDoc, fetchJson, clean, abs, londonISO, jsonLd, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'bridge',
  name: 'Bridge Theatre',
  kind: 'theatre',
  address: '3 Potters Fields Park, London SE1 2SG',
  lat: 51.5023,
  lng: -0.0786,
  site: 'https://www.bridgetheatre.co.uk/en-GB/whats-on',
};

const HOST = 'https://www.bridgetheatre.co.uk';
const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** A real UTC instant → London wall-clock ISO. */
function toLondonISO(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(LONDON.formatToParts(d).map((x) => [x.type, x.value]));
  return londonISO(+p.year, +p.month, +p.day, +p.hour, +p.minute);
}

/** whats-on JSON-LD ItemList → event slugs → the site's own /api/events/<slug>/performance JSON. */
export async function scrape() {
  const $ = await fetchDoc(`${HOST}/en-GB/whats-on`);
  const urls = new Set();
  for (const n of jsonLd($)) {
    if (n['@type'] === 'ListItem' && typeof n.url === 'string') urls.add(n.url);
  }
  $('a[href*="/event/"]').each((_, a) => urls.add(abs($(a).attr('href'), HOST)));
  const events = [];
  for (const u of urls) {
    const slug = new URL(u).pathname.split('/').filter(Boolean).pop();
    if (!slug) continue;
    const pageUrl = `${HOST}/en-GB${new URL(u).pathname.replace(/^\/en-GB/, '')}`;
    let blurb, title;
    try {
      const p = await fetchDoc(pageUrl);
      const ev = jsonLd(p).find((n) => /Event$/.test(String(n['@type'])));
      title = ev?.name;
      blurb = ev?.description;
    } catch {}
    let data;
    try { data = await fetchJson(`${HOST}/api/events/${slug}/performance`); } catch { continue; }
    for (const day of data.events ?? []) {
      for (const perf of day.availablePerformances ?? []) {
        const start = toLondonISO(perf.startDate);
        if (!start) continue;
        const cat = (perf.categories ?? []).join(' ').toLowerCase();
        const name = title || perf.performanceName;
        events.push(makeEvent(venue, {
          title: name,
          category: /musical/.test(cat) ? 'musical' : /opera/.test(cat) ? 'opera' : guessCategory(`${name} ${cat}`, 'drama'),
          start,
          url: pageUrl,
          price: perf.fromPrice ? `from £${perf.fromPrice}` : undefined,
          blurb,
          hall: perf.venueName && perf.venueName !== venue.name ? perf.venueName : undefined,
        }));
      }
    }
  }
  return events;
}
