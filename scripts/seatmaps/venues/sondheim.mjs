// Sondheim Theatre (Les Misérables): the seat map behind buytickets.delfontmackintosh.co.uk's "Shop By Seat Map" view.
// Delfont Mackintosh's nliven shop loads /api/svg/svgdata/<id>, a public list of [x, y, r, 'AREA-ROW-SEAT', group, scale];
// the id shows up in the network log of any SONLM performance page (e.g. …/shop/tickets/series/SONLM/les-misrables-1160106).
import { fetchCached, writePlan } from '../lib.mjs';

const URL = 'https://buytickets.delfontmackintosh.co.uk/api/svg/svgdata/9946?admin=false';
const raw = JSON.parse(await fetchCached('sondheim.svgdata.json', URL));

// Booking-map area + row → [level, section, row]. Slips, loges and named boxes sit at circle level.
const BOXES = { 'BOUBLIL-LOGE': 'Boublil Loge', 'SCHONBERG-LOGE': 'Schönberg Loge', "JUDI'S-BOX": "Judi's Box", "MAGGIE'S-BOX": "Maggie's Box" };
const place = (area, row) => {
  if (BOXES[`${area}-${row}`]) return ['Dress Circle', 'Boxes', BOXES[`${area}-${row}`]];
  const level = { STALLS: 'Stalls', 'DRESS CIRCLE': 'Dress Circle', 'GRAND CIRCLE': 'Grand Circle' }[area];
  if (row === 'STAND') return [level, 'Standing Area', 'Standing'];
  if (row === 'AA') return [level, 'Slip Seats', 'AA'];
  return [level, level, row];
};

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 3 },
  'Dress Circle': { height: 3.6, rake: 0.35, front: 9 },
  'Grand Circle': { height: 7.4, rake: 0.45, front: 12 },
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
  id: 'sondheim',
  name: 'Sondheim Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Sondheim Theatre'],
  mapVenueIds: ['sondheim-theatre', 'node_venue_sondheim'],
  source: { system: 'nliven (Delfont Mackintosh)', url: 'https://buytickets.delfontmackintosh.co.uk/shop/tickets/series/SONLM', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 9.8, depth: 10, pit: 2.5 },
  levels: [...levels].map(([name, secs]) => ({
    name,
    ...LEVELS[name],
    sections: [...secs].map(([s, rows]) => ({ name: s, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  })),
});
