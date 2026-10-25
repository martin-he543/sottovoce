// Lyceum Theatre (The Lion King): the seat map behind atgtickets.com's "Reserve seats" screen.
// ATG's booking page loads boltapi.atgtickets.com/admissions/<show>/<venue>/<performance GUID>, whose `seats` list has
// level, row, number and x/y for every seat. It needs a browser session, so it is saved to raw/lyceum.atg.json.
// To recapture: open https://www.atgtickets.com/shows/disneys-the-lion-king/lyceum-theatre/calendar/, accept cookies,
// click any performance (…/tickets/<GUID>) and save the admissions response body from the network log.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignBands, ROOT, writePlan } from '../lib.mjs';

const raw = JSON.parse(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'lyceum.atg.json'), 'utf8'));

// What each seat costs at the captured performance: its zone's full-price ticket, booking fee included.
const priceOf = (s) => {
  const zone = raw.zones[s.zone];
  const tickets = Object.values(zone?.tickets ?? {});
  const t = tickets.find((x) => /^Z - Full Price/.test(x.name)) ?? zone?.tickets[zone.defaultTicket];
  return t ? Number(t.total) : null;
};
const priced = [];

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 4 },
  'Royal Circle': { height: 4.5, rake: 0.35, front: 12 },
  'Grand Circle': { height: 9, rake: 0.45, front: 16 },
};
const levels = new Map(Object.keys(LEVELS).map((n) => [n, { sections: new Map(), standing: 0 }]));
// ATG draws the map with y pointing up (stage at the largest y), so y is flipped to put the stage at the top.
for (const s of raw.seats) {
  const level = levels.get(s.level);
  if (s.row === 'Standing') {
    level.standing++;
    continue;
  }
  const box = /^box\s+(\w+)$/i.exec(s.row);
  const section = box ? 'Boxes' : s.level;
  const row = box ? `Box ${box[1]}` : s.row;
  const sec = level.sections.get(section) ?? new Map();
  level.sections.set(section, sec);
  const seat = [s.number, s.x, -s.y];
  priced.push([s.level, seat, priceOf(s)]);
  sec.set(row, [...(sec.get(row) ?? []), seat]);
}

await writePlan({
  id: 'lyceum',
  name: 'Lyceum Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Lyceum Theatre'],
  mapVenueIds: ['lyceum-theatre'],
  prices: assignBands(priced, { fees: true, captured: '2026-10-24', production: "Disney's The Lion King" }),
  source: { system: 'ATG Tickets', url: 'https://www.atgtickets.com/shows/disneys-the-lion-king/lyceum-theatre/calendar/', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 12.5, depth: 16, pit: 3 },
  levels: [...levels].map(([name, l]) => ({
    name,
    ...LEVELS[name],
    sections: [...l.sections].map(([s, rows]) => ({ name: s, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
    ...(l.standing ? { standing: [{ name: `${name} Standing`, capacity: l.standing }] } : {}),
  })),
});
