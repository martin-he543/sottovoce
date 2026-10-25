// Adelphi Theatre (LW Theatres). LW's own booking (ticketing.lwtheatres.co.uk, Line-Up) sits behind a Cloudflare Turnstile check,
// so this uses the seating chart TodayTix draws from the same inventory.
// To recapture: open https://www.todaytix.com/london/shows/46914 (The Lives of Others; Billy Elliot, from Feb 2027, is show 46308), pick any performance
// (→ todaytix.com/booking/seating-plan?…&venue_id=569&showtime_id=…), wait for the map, and save
// document.getElementById('svg-canvas').outerHTML to scripts/seatmaps/raw/adelphi.todaytix.svg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'adelphi.todaytix.svg'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 3 },
  'Dress Circle': { height: 4.5, rake: 0.3, front: 10 },
  'Upper Circle': { height: 9, rake: 0.45, front: 14 },
};
const levels = todaytixLevels(seats, (s) => ({ level: titleCase(s.section.name) }), Object.keys(LEVELS));

await writePlan({
  id: 'adelphi',
  name: 'Adelphi Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Adelphi Theatre'],
  mapVenueIds: ['adelphi-theatre'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/46914', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 11.5, depth: 12, pit: 3 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name] })),
});
