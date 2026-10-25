// Dominion Theatre (The Devil Wears Prada): the seat map behind ticketing.nederlander.co.uk's "Shop By Seat Map" view.
// Nederlander's nliven shop loads /api/svg/svgdata/<id>, a public list of [x, y, r, 'AREA-ROW-SEAT', group, scale];
// the id shows up in the network log of any performance page (e.g. …/shop/tickets/series/TheDevilWearsPrada/the-devil-wears-prada-2020652).
import { fetchCached, writePlan } from '../lib.mjs';

const URL = 'https://ticketing.nederlander.co.uk/api/svg/svgdata/10576?admin=false';
const raw = JSON.parse(await fetchCached('dominion.svgdata.json', URL));

// The map draws the Royal Box (left) and Nederlander Box (right) beside the front stalls.
const place = (area, row) => {
  if (row === 'BOX') return ['Stalls', 'Boxes', `${area[0]}${area.slice(1).toLowerCase()} Box`];
  const level = { STALLS: 'Stalls', CIRCLE: 'Circle' }[area];
  return [level, level, row];
};

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 4 },
  Circle: { height: 6, rake: 0.4, front: 15 },
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
  id: 'dominion',
  name: 'Dominion Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Dominion Theatre'],
  mapVenueIds: ['dominion-theatre'],
  source: { system: 'nliven (Nederlander)', url: 'https://ticketing.nederlander.co.uk/tickets/series/TheDevilWearsPrada', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 14, depth: 13, pit: 3 },
  levels: [...levels].map(([name, secs]) => ({
    name,
    ...LEVELS[name],
    sections: [...secs].map(([s, rows]) => ({ name: s, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  })),
});
