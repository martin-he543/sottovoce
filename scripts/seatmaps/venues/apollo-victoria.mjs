// Apollo Victoria Theatre (Wicked): the seat map behind atgtickets.com's "Reserve seats" screen.
// ATG's booking page loads boltapi.atgtickets.com/admissions/<show>/<venue>/<performance GUID>, whose `seats` list has
// level, row, number and x/y for every seat. It needs a browser session, so it is saved to raw/apollo-victoria.atg.json.
// To recapture: open https://www.atgtickets.com/shows/wicked/apollo-victoria-theatre/calendar/, accept cookies,
// click any performance (…/tickets/<GUID>) and save the admissions response body from the network log.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignBands, ROOT, writePlan } from '../lib.mjs';

const raw = JSON.parse(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'apollo-victoria.atg.json'), 'utf8'));

// What each seat costs at the captured performance: its zone's full-price ticket, booking fee included.
const priceOf = (s) => {
  const zone = raw.zones[s.zone];
  const tickets = Object.values(zone?.tickets ?? {});
  const t = tickets.find((x) => /^Z - Full Price/.test(x.name)) ?? zone?.tickets[zone.defaultTicket];
  return t ? Number(t.total) : null;
};
const priced = [];

// One very wide stalls and a single deep circle that ATG calls the Dress Circle.
const LEVELS = {
  Stalls: { height: 0, rake: 0.07, front: 4 },
  'Dress Circle': { height: 6, rake: 0.4, front: 17 },
};
const levels = new Map(Object.keys(LEVELS).map((n) => [n, new Map()]));
// ATG draws the map with y pointing up (stage at the largest y), so y is flipped to put the stage at the top.
for (const s of raw.seats) {
  const rows = levels.get(s.level);
  const seat = [s.number, s.x, -s.y];
  priced.push([s.level, seat, priceOf(s)]);
  rows.set(s.row, [...(rows.get(s.row) ?? []), seat]);
}

await writePlan({
  id: 'apollo-victoria',
  name: 'Apollo Victoria Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Apollo Victoria Theatre'],
  mapVenueIds: ['apollo-victoria-theatre'],
  prices: assignBands(priced, { fees: true, captured: '2026-10-24', production: 'Wicked' }),
  source: { system: 'ATG Tickets', url: 'https://www.atgtickets.com/shows/wicked/apollo-victoria-theatre/calendar/', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 14, depth: 15, pit: 3 },
  levels: [...levels].map(([name, rows]) => ({
    name,
    ...LEVELS[name],
    sections: [{ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) }],
  })),
});
