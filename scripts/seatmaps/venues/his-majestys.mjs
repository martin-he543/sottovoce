// His Majesty's Theatre (LW Theatres). LW's own booking (ticketing.lwtheatres.co.uk, Line-Up) sits behind a Cloudflare Turnstile check,
// so this uses the seating chart TodayTix draws from the same inventory.
// To recapture: open https://www.todaytix.com/london/shows/308 (The Phantom of the Opera), pick any performance
// (→ todaytix.com/booking/seating-plan?…&venue_id=161&showtime_id=…), wait for the map, and save
// document.getElementById('svg-canvas').outerHTML to scripts/seatmaps/raw/his-majestys.todaytix.svg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'his-majestys.todaytix.svg'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 3 },
  'Royal Circle': { height: 4, rake: 0.3, front: 9 },
  'Grand Circle': { height: 8, rake: 0.4, front: 13 },
  Balcony: { height: 12, rake: 0.5, front: 17 },
};
const levels = todaytixLevels(seats, (s) => ({ level: titleCase(s.section.name) }), Object.keys(LEVELS));

await writePlan({
  id: 'his-majestys',
  name: "His Majesty's Theatre",
  hall: 'Main Auditorium',
  venueNames: ["His Majesty's Theatre", "Her Majesty's Theatre"],
  mapVenueIds: ['his-majestys-theatre'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/308', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 10.5, depth: 16, pit: 3 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name] })),
});
