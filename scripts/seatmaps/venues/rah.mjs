// Royal Albert Hall: the booking seat map on royalalberthall.com, traced from a screenshot (the site sits behind an
// Imperva bot wall, so there is no seat data to fetch). scripts/seatmaps/trace/rah-trace.py finds the seats and groups
// them into tier > block > row (rah.rows.json, committed); this adds the hall's size and tier heights.
// The map is one flat picture of a round hall: every tier shares its frame, so they all use the same origin and scale,
// and rows rise with distance from the hall's middle (`ring`), not from the stage.
// Not on the map: the Gallery (unreserved) and the choir seats behind the stage.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';

const { levels } = JSON.parse(await readFile(join(ROOT, 'scripts', 'seatmaps', 'trace', 'rah.rows.json'), 'utf8'));

// Seat pitch on the map is 14 px, 0.52 m in the hall. The middle (H) is where the side and end blocks meet; the stage
// edge is the middle of the stage's diagonal front, so ringside seats beside the stage sit just in front of it.
const SCALE = 0.0371;
const MIDDLE = [1050, 964];
const ORIGIN = [1050, 567];
const GEOMETRY = {
  Arena: { height: 0, rake: 0 },
  Stalls: { height: 0.3, rake: 0.11 },
  'Loggia Boxes': { height: 3.2, rake: 0 },
  'Grand Tier Boxes': { height: 6.8, rake: 0 },
  'Second Tier Boxes': { height: 10.2, rake: 0 },
  Circle: { height: 13.4, rake: 0.5 },
};

await writePlan({
  id: 'rah',
  name: 'Royal Albert Hall',
  hall: 'Main Auditorium',
  venueNames: ['Royal Albert Hall'],
  mapVenueIds: ['rah'],
  source: { system: 'Royal Albert Hall seat map (traced)', url: 'https://www.royalalberthall.com/tickets/', captured: '2026-10-24', method: 'traced', note: 'seat, row and box numbers are counted off the map in order; the Gallery is not on it' },
  stage: { type: 'platform', width: 26, depth: 17 },
  levels: levels.map((level) => ({ ...level, ...GEOMETRY[level.name], scale: SCALE, origin: ORIGIN, ring: MIDDLE })),
});
