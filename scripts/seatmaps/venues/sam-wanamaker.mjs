// Sam Wanamaker Playhouse (Shakespeare's Globe): the seating chart TodayTix draws for its bookings (The Animals Come to the
// Table, show 47381). To recapture: python3 scripts/seatmaps/capture-todaytix.py sam-wanamaker=47381
// The chart has the stage at the bottom, so it is flipped to put the stage at the top. The musicians' gallery over the
// stage ("REAR", 18 seats) is left out; the back two rows of the side galleries are standing tickets on the chart's note.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'sam-wanamaker.todaytix.svg'), 'utf8'));
const STAGE_FRONT = [613, 802];

const LEVELS = {
  Pit: { height: 0, rake: 0.1 },
  'Lower Gallery': { height: 2.2, rake: 0.3 },
  'Upper Gallery': { height: 4.6, rake: 0.3 },
};
const levels = todaytixLevels(
  seats.map((s) => ({ ...s, y: 2 * STAGE_FRONT[1] - s.y })),
  (s) => (s.section.name === 'REAR' ? null : { level: titleCase(s.section.name.replace(/^PLAYHOUSE /, '')) }),
  Object.keys(LEVELS),
);

await writePlan({
  id: 'sam-wanamaker',
  name: 'Sam Wanamaker Playhouse',
  hall: 'Sam Wanamaker Playhouse',
  venueNames: ["Shakespeare's Globe", 'Sam Wanamaker Playhouse'],
  mapVenueIds: ['globe'],
  halls: ['Sam Wanamaker Playhouse'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/47381', captured: new Date().toISOString().slice(0, 10), method: 'extracted' },
  stage: { type: 'thrust', width: 8, depth: 5, thrust: 0, pit: 0 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name], scale: 0.018, origin: STAGE_FRONT })),
});
