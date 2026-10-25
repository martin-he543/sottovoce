// Palace Theatre (Harry Potter and the Cursed Child): the TickX seat map behind uk.harrypottertheplay.com's booking flow.
// The seats endpoint needs a booking session, so the raw response is saved to scripts/seatmaps/raw/palace.tickx.json.
// To recapture: open https://uk.harrypottertheplay.com/purchase-tickets/?calendar=tab-1, pick any performance in the
// calendar (the TickX iframe moves to /booking/seat-selection/<performanceId>), and save the response of
// https://w2-bff.tickxcore.com/seatmap/seats?…&performanceId=<id> (layout "Palace Theatre - HPATCC - 2025").
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignBands, ROOT, writePlan } from '../lib.mjs';

const raw = JSON.parse(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'palace.tickx.json'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 2.5 },
  'Dress Circle': { height: 4, rake: 0.35, front: 9 },
  'Grand Circle': { height: 8, rake: 0.45, front: 13 },
  Balcony: { height: 12, rake: 0.5, front: 17 },
};

// Each TickX "row" entity is a run of seats: labels in sl, offsets in sp from (x, y), level in categories[c].
// Every row here has r = 0 and cu = 0 (no rotation or curve), so seat = (x + dx, y + dy).
// m[i] is the seat's price band (an index into price_bands) while it is on sale, null once sold or held.
const priced = [];
const levels = new Map(raw.categories.map((name) => [name, new Map()]));
for (const e of raw.entities) {
  if (e.t !== 'row') continue;
  if (e.r || e.cu) throw new Error('rotated or curved row: handle r/cu');
  const rows = levels.get(raw.categories[e.c]);
  const row = e.l[0];
  const seats = rows.get(row) ?? [];
  rows.set(row, seats);
  e.sl.forEach((n, i) => {
    const seat = [String(n), e.x + e.sp[i][0], e.y + e.sp[i][1]];
    const band = raw.price_bands[e.m?.[i]];
    priced.push([e.c, seat, band ? Math.round((band.min + band.max) / 2) : null]);
    seats.push(seat);
  });
}

await writePlan({
  id: 'palace',
  name: 'Palace Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Palace Theatre'],
  mapVenueIds: ['palace-theatre'],
  prices: assignBands(priced, { fees: false, captured: '2026-10-24', production: 'Harry Potter and the Cursed Child' }),
  source: { system: 'TickX', url: 'https://uk.harrypottertheplay.com/purchase-tickets/', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 10.5, depth: 12 },
  levels: [...levels].map(([name, rows]) => ({
    name,
    ...LEVELS[name],
    sections: [{ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) }],
  })),
});
