// Theatre Royal Drury Lane (LW Theatres). LW's own booking (ticketing.lwtheatres.co.uk, Line-Up) sits behind a
// Cloudflare Turnstile check, so this uses the seating chart TodayTix draws from the same Line-Up inventory.
// To recapture: open https://www.todaytix.com/london/shows/46996 (Jesus Christ Superstar), pick any performance
// (→ todaytix.com/booking/seating-plan?…&venue_id=523&showtime_id=…), wait for the map, and save
// document.getElementById('svg-canvas').outerHTML to scripts/seatmaps/raw/drury-lane.todaytix.svg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'drury-lane.todaytix.svg'), 'utf8'));

const LEVELS = {
  Stalls: { height: 0, rake: 0.07, front: 3 },
  'Royal Circle': { height: 4.5, rake: 0.3, front: 11 },
  'Grand Circle': { height: 9, rake: 0.4, front: 15 },
  Balcony: { height: 13, rake: 0.5, front: 19 },
};
const BOX = { 'THE KINGS BOX': "The King's Box", 'THE PRINCES BOX': "The Prince's Box", TKGB: "King's Grand Box", TPGB: "Prince's Grand Box" };

// Small chart groups are boxes (rows A–L, or "THE KINGS BOX" etc.), except the side runs of row A in the circles.
const groupSize = new Map();
for (const s of seats) groupSize.set(s.section.index, (groupSize.get(s.section.index) ?? 0) + 1);

const levels = todaytixLevels(
  seats,
  (s) => {
    const level = titleCase(s.section.name);
    if (/^SLIPS /.test(s.row)) return { level, section: 'Stalls Slips', row: titleCase(s.row) };
    if (groupSize.get(s.section.index) < 30 && s.row !== 'A') return { level, section: 'Boxes', row: BOX[s.row] ?? `Box ${s.row.replace(/^BOX /, '').toUpperCase()}` };
    return { level };
  },
  Object.keys(LEVELS),
);

await writePlan({
  id: 'drury-lane',
  name: 'Theatre Royal Drury Lane',
  hall: 'Main Auditorium',
  venueNames: ['Theatre Royal Drury Lane'],
  mapVenueIds: ['theatre-royal-drury-lane'],
  source: { system: 'TodayTix (Line-Up inventory)', url: 'https://www.todaytix.com/london/shows/46996', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 13, depth: 24, pit: 3 },
  levels: levels.map((l) => ({ ...l, ...LEVELS[l.name] })),
});
