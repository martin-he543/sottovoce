// Cambridge Theatre (LW Theatres). LW's own booking (ticketing.lwtheatres.co.uk, Line-Up) sits behind a Cloudflare Turnstile check,
// so this uses the seating chart TodayTix draws from the same inventory.
// To recapture: open https://www.todaytix.com/london/shows/305 (Matilda The Musical), pick any performance
// (→ todaytix.com/booking/seating-plan?…&venue_id=114&showtime_id=…), wait for the map, and save
// document.getElementById('svg-canvas').outerHTML to scripts/seatmaps/raw/cambridge.todaytix.svg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'cambridge.todaytix.svg'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.08, front: 3 },
  'Dress Circle': { height: 4, rake: 0.3, front: 9 },
  'Upper Circle': { height: 8, rake: 0.45, front: 13 },
};
// The chart's BOXES groups: box A sits by the stalls, boxes C and D beside the dress circle.
const levels = todaytixLevels(
  seats,
  (s) => {
    if (s.section.name !== 'BOXES') return { level: titleCase(s.section.name) };
    const box = s.row.replace(/^BOX /, '');
    return { level: box === 'A' || box === 'B' ? 'Stalls' : 'Dress Circle', section: 'Boxes', row: `Box ${box}` };
  },
  Object.keys(LEVELS),
);

await writePlan({
  id: 'cambridge',
  name: 'Cambridge Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Cambridge Theatre'],
  mapVenueIds: ['cambridge-theatre'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/305', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 10, depth: 10, pit: 2.5 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name] })),
});
