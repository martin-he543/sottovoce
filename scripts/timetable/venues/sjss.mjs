// St John's Smith Square / Sinfonia Smith Square. The What's On page is a JS app that reads one public JSON file,
// /wp-content/uploads/whats-on.json: items with a `timestamp` array of local "YYYY-MM-DD HH:mm" (one per performance).
// Items whose venues don't include Smith Square Hall/Crypt (touring dates, Westminster Abbey, etc.) are skipped.
import { fetchJson, clean, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'sjss',
  name: "St John's Smith Square",
  kind: 'concert',
  address: 'Smith Square, London SW1P 3HA',
  lat: 51.4952,
  lng: -0.1272,
  site: 'https://www.sinfoniasmithsq.org.uk/whats-on/',
};

const decode = (s) => clean(String(s ?? '').replace(/&#0*38;|&#038;/g, '&').replace(/&#8217;|&#8216;/g, '’').replace(/&#8211;/g, '–').replace(/&#8220;|&#8221;/g, '"').replace(/&amp;/g, '&'));

function category(types, title) {
  const t = new Set(types);
  if (t.has('opera')) return 'opera';
  if (t.has('ballet') || t.has('dance')) return 'dance';
  if (t.has('jazz') || t.has('folk')) return 'live_music';
  if (t.has('gospel')) return 'live_music';
  return guessCategory(title) === 'live_music' ? 'live_music' : 'classical';
}

export async function scrape() {
  const j = await fetchJson('https://www.sinfoniasmithsq.org.uk/wp-content/uploads/whats-on.json');
  if (!Array.isArray(j?.items)) throw new Error('sjss: whats-on.json structure changed');
  const out = [];
  const now = Date.now() - 6 * 3600e3;
  for (const it of j.items) {
    const venues = (it.venues ?? []).map((v) => v.slug);
    if (!venues.some((v) => v === 'smith-square-hall' || v === 'smith-square-crypt')) continue;
    const types = (it.types ?? []).map((t) => t.slug);
    if (types.includes('talks-and-events')) continue;
    const title = decode(it.title);
    const hall = venues.includes('smith-square-crypt') ? 'Smith Square Crypt' : 'Smith Square Hall';
    const blurb = [it.performer, it.excerpt].map(decode).filter(Boolean).join(' – ');
    for (const ts of it.timestamp ?? []) {
      const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
      if (!m) continue;
      const start = m[4] ? londonISO(+m[1], +m[2], +m[3], +m[4], +m[5]) : `${m[1]}-${m[2]}-${m[3]}`;
      if (Date.parse(start) < now) continue;
      out.push(makeEvent(venue, {
        title, category: category(types, title), start, hall, url: it.link,
        price: it.free ? 'Free' : undefined, blurb,
      }));
    }
  }
  return out;
}
