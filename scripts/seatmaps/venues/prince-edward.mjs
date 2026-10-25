// Prince Edward Theatre (Beetlejuice): the seat map behind buytickets.delfontmackintosh.co.uk's "Shop By Seat Map" view.
// Delfont Mackintosh's nliven shop loads /api/svg/svgdata/<id>, a public list of [x, y, r, 'AREA-ROW-SEAT', group, scale];
// the id shows up in the network log of any PETBJ performance page (e.g. …/shop/tickets/series/PETBJ/beetlejuice-1157051).
import { fetchCached, writePlan } from '../lib.mjs';

const URL = 'https://buytickets.delfontmackintosh.co.uk/api/svg/svgdata/9991?admin=false';
const raw = JSON.parse(await fetchCached('prince-edward.svgdata.json', URL));

// Booking-map area + row → [level, section, row]. The map labels the loges "Circle Loges, Dress Circle level";
// CB/GB rows are the circle boxes, SB and Grand Circle AA the slip seats.
const place = (area, row) => {
  if (area === 'LOGE') return ['Dress Circle', 'Boxes', `Loge ${row}`];
  if (area === 'STALLS') return ['Stalls', /^BOX/.test(row) ? 'Boxes' : 'Stalls', row.replace('BOX', 'Stalls Box')];
  const level = { 'DRESS CIRCLE': 'Dress Circle', 'GRAND CIRCLE': 'Grand Circle' }[area];
  const box = /^([CG])B(\d)$/.exec(row);
  if (box) return [level, 'Boxes', `${box[1] === 'C' ? 'Circle' : 'Grand Circle'} Box ${box[2]}`];
  if (row === 'AA' || /^SB\d$/.test(row)) return [level, 'Slip Seats', row];
  return [level, level, row];
};

const LEVELS = {
  Stalls: { height: 0, rake: 0.07, front: 4 },
  'Dress Circle': { height: 4.5, rake: 0.35, front: 12 },
  'Grand Circle': { height: 9, rake: 0.45, front: 16 },
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
  id: 'prince-edward',
  name: 'Prince Edward Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Prince Edward Theatre'],
  mapVenueIds: ['prince-edward-theatre'],
  source: { system: 'nliven (Delfont Mackintosh)', url: 'https://buytickets.delfontmackintosh.co.uk/shop/tickets/series/PETBJ', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 13.7, depth: 12, pit: 3 },
  levels: [...levels].map(([name, secs]) => ({
    name,
    ...LEVELS[name],
    sections: [...secs].map(([s, rows]) => ({ name: s, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  })),
});
