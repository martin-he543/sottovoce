// Gillian Lynne Theatre (LW Theatres). LW's own booking (ticketing.lwtheatres.co.uk, Line-Up) sits behind a Cloudflare Turnstile check,
// so this uses the seating chart TodayTix draws from the same inventory.
// To recapture: open https://www.todaytix.com/london/shows/25389 (My Neighbour Totoro), pick any performance
// (→ todaytix.com/booking/seating-plan?…&venue_id=129&showtime_id=…), wait for the map, and save
// document.getElementById('svg-canvas').outerHTML to scripts/seatmaps/raw/gillian-lynne.todaytix.svg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'gillian-lynne.todaytix.svg'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.12, front: 2 },
  Circle: { height: 5, rake: 0.4, front: 12 },
};
// TodayTix notes this chart is approximate and not spatially accurate (the stalls fan round a semi-thrust stage).
const levels = todaytixLevels(seats, (s) => ({ level: titleCase(s.section.name) }), Object.keys(LEVELS));

await writePlan({
  id: 'gillian-lynne',
  name: 'Gillian Lynne Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Gillian Lynne Theatre'],
  mapVenueIds: ['gillian-lynne-theatre'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/25389', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'thrust', width: 14, depth: 12, thrust: 3 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name] })),
});
