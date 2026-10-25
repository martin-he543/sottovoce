// Shared helpers for the API-key aggregator adapters (ticketmaster, seatgeek, skiddle).
// They are listed in AGGREGATORS (run.mjs) so shows a venue adapter already covers are dropped from them.
import { clean, makeEvent } from './lib.mjs';
import { guessCategory } from './categories.mjs';

export const LONDON = { lat: 51.5074, lng: -0.1278 };

/** Things that are not performances, or not a performing-arts / live-music fit. */
export const EXCLUDE = /\b(parking|vip upgrade|hospitality|meet (&|and) greet|tour of|backstage tour|workshops?|masterclass|quiz|comedy|comedian|stand.?up|club night|clubbing|dj set|rave|film|cinema|screening|conference|expo|exhibition|gift (card|voucher)|voucher|membership|afternoon tea|dinner)\b/i;

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export function venueKind(name) {
  if (/opera house|coliseum/i.test(name)) return 'opera';
  if (/theatre|theater|playhouse|palladium|stage/i.test(name)) return 'theatre';
  return 'concert';
}

/** Collects venues as events are added; `venues` is the array run.mjs reads. */
export function venueRegistry(venues) {
  return ({ name, address, lat, lng, site }) => {
    const id = `ext_${slug(name)}`;
    let v = venues.find((x) => x.id === id);
    if (!v) {
      v = { id, name: clean(name), kind: venueKind(name), address: clean(address ?? ''), ...(Number.isFinite(lat) && Number.isFinite(lng) && { lat, lng }), site };
      venues.push(v);
    }
    return v;
  };
}

/** Category from a platform's own genre label, falling back to a keyword guess on the title. */
export function categorise(title, genres = [], fallback = null) {
  const g = genres.map((x) => String(x ?? '').toLowerCase());
  const has = (re) => g.some((x) => re.test(x));
  if (/\bopera\b/i.test(title) && !/\bsoap\b/i.test(title)) return 'opera';
  if (has(/opera/)) return 'opera';
  if (has(/ballet|dance/)) return 'dance';
  if (has(/musical/)) return 'musical';
  if (has(/classical|orchestra|chamber|choral|choir/)) return 'classical';
  if (has(/theatre|theater|drama|play|shakespeare/)) return 'drama';
  if (has(/jazz|rock|pop|folk|blues|soul|funk|indie|alternative|r&b|hip.hop|rap|reggae|country|metal|world|electronic|singer|live music|gig/)) return guessCategory(title) ?? 'live_music';
  return guessCategory(title, fallback);
}

export { makeEvent };
