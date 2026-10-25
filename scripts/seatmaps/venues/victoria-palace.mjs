// Victoria Palace Theatre (Hamilton): the seat map behind buytickets.delfontmackintosh.co.uk's "Shop By Seat Map" view
// (hamiltonmusical.com/london hands off to it). Delfont Mackintosh's nliven shop loads /api/svg/svgdata/<id>, a public
// list of [x, y, r, 'AREA-ROW-SEAT', group, scale]; the id shows up in the network log of any VPHAM performance page
// (e.g. …/shop/tickets/series/VPHAM/hamilton-1160258).
import { fetchCached, writePlan } from '../lib.mjs';

const URL = 'https://buytickets.delfontmackintosh.co.uk/api/svg/svgdata/9949?admin=false';
const raw = JSON.parse(await fetchCached('victoria-palace.svgdata.json', URL));

// Booking-map area + row → [level, section, row]. The Albert, Matcham and Victoria boxes are drawn with the Royal Circle.
const place = (area, row) => {
  const box = /^(STALLS|ROYAL CIRCLE|GRAND CIRCLE) BOX$/.exec(area);
  const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  if (box) return [title(box[1]), 'Boxes', `${title(area)} ${row}`];
  if (/^(VICTORIA|MATCHAM|ALBERT) BOX$/.test(area)) return ['Royal Circle', 'Boxes', title(area)];
  const slips = /^(.*) SLIPS$/.exec(area);
  if (slips) return [title(slips[1]), 'Slip Seats', row];
  if (row === 'STAND') return [title(area), 'Standing Area', 'Standing'];
  return [title(area), title(area), row];
};

const LEVELS = {
  Stalls: { height: 0, rake: 0.07, front: 4 },
  'Royal Circle': { height: 4.2, rake: 0.33, front: 11 },
  'Grand Circle': { height: 8.6, rake: 0.45, front: 14 },
};
const levels = new Map(Object.keys(LEVELS).map((n) => [n, new Map()]));
for (const [x, y, , key] of raw) {
  const [, area, r, seat] = /^(.*)-([^-]+)-([^-]+)$/.exec(key);
  const [level, section, row] = place(area, r);
  const sec = levels.get(level).get(section) ?? new Map();
  levels.get(level).set(section, sec);
  sec.set(row, [...(sec.get(row) ?? []), [seat, x, y]]);
}

await writePlan({
  id: 'victoria-palace',
  name: 'Victoria Palace Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Victoria Palace Theatre'],
  mapVenueIds: ['victoria-palace-theatre'],
  source: { system: 'nliven (Delfont Mackintosh)', url: 'https://buytickets.delfontmackintosh.co.uk/shop/tickets/series/VPHAM', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 12.6, depth: 12, pit: 3 },
  levels: [...levels].map(([name, secs]) => ({
    name,
    ...LEVELS[name],
    sections: [...secs].map(([s, rows]) => ({ name: s, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  })),
});
