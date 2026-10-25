// National Theatre: the site's own public ticketing "picker" API (events.nationaltheatre.org.uk) that powers the
// booking buttons on nationaltheatre.org.uk. Events list -> per-event JSON with one instance per performance.
// (The WordPress calendar uses /admin/wp-admin/admin-ajax.php which robots.txt disallows, so we do not touch it.)
import { fetchJson, clean, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'nt',
  name: 'National Theatre',
  kind: 'theatre',
  address: 'Upper Ground, South Bank, London SE1 9PX',
  lat: 51.5072,
  lng: -0.1148,
  site: 'https://www.nationaltheatre.org.uk/whats-on/',
};

const API = 'https://events.nationaltheatre.org.uk/api/v1/events/';
const SKIP_TITLE = /\b(tour|tours|backstage|workshop|talk|exhibition|gift|voucher|membership|walkthrough)\b/i;

/** UTC ISO ("2026-10-24T13:30:00Z") -> London-offset ISO. */
function toLondon(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]));
  return londonISO(+p.year, +p.month, +p.day, +p.hour, +p.minute);
}

export async function scrape() {
  const list = await fetchJson(API);
  if (!Array.isArray(list)) throw new Error('NT events API: unexpected shape');
  const out = [];
  for (const ev of list) {
    const title = clean(ev.title);
    if (!title || SKIP_TITLE.test(title)) continue;
    let detail;
    try { detail = await fetchJson(API + ev._id); } catch { continue; }
    const hallDefault = clean(detail.venueLabel || ev.venueLabel);
    const showUrl = String(detail.bookingInfo || '').match(/https:\/\/www\.nationaltheatre\.org\.uk\/productions\/[a-z0-9-]+\/?/i)?.[0];
    const guessed = guessCategory(title);
    const category = ['musical', 'opera', 'dance'].includes(guessed) ? guessed : 'drama';
    for (const inst of detail.instances ?? []) {
      const types = (inst.performanceTypes ?? []).map((t) => t.title).join(' ');
      if (/filmed|nt live|cinema|touch tour only/i.test(types)) continue;   // filmed screenings are not live performances
      const start = toLondon(inst.datetime);
      if (!start) continue;
      const prices = (inst.prices ?? []).filter((p) => String(p.mos) === '11').map((p) => parseFloat(p.price)).filter((n) => n > 0);
      const min = prices.length ? Math.min(...prices) : null;
      const tags = [...(inst.performanceTypes ?? []), ...(inst.accessTypes ?? [])].map((t) => t.title).filter((t) => !/touch tour/i.test(t));
      out.push(makeEvent(venue, {
        title,
        category,
        start,
        hall: inst.venue || hallDefault,
        url: showUrl || inst.bookingURL,
        price: min != null ? `from £${Number.isInteger(min) ? min : min.toFixed(2)}` : undefined,
        blurb: tags.length ? tags.join(', ') : undefined,
      }));
    }
  }
  return out;
}
