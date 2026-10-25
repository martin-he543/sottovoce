// Shakespeare's Globe (Globe Theatre): the seating chart TodayTix draws for its bookings (Pinocchio, show 44741).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py globe=44741
// The chart draws the three galleries as one shared round frame (rows run unbroken round each gallery's bays), with the
// stage above the Yard; the Yard is standing, so it is a capacity rather than seats. Chart positions are schematic: the
// galleries are drawn wider than the Yard, so the scale is set by the seat pitch (21 units for ~0.45 m).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';
import { titleCase, todaytixLevels, todaytixSeats } from '../todaytix.mjs';

const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'globe.todaytix.svg'), 'utf8'));

const LEVELS = {
  'Lower Gallery': { height: 2.4, rake: 0.25 },
  'Middle Gallery': { height: 5.4, rake: 0.25 },
  'Upper Gallery': { height: 8.4, rake: 0.25 },
};
const levels = todaytixLevels(seats, (s) => (s.section.name.startsWith('YARD') ? null : { level: titleCase(s.section.name) }), Object.keys(LEVELS));

await writePlan({
  id: 'globe',
  name: "Shakespeare's Globe",
  hall: 'Globe Theatre',
  venueNames: ["Shakespeare's Globe"],
  mapVenueIds: ['globe'],
  halls: ['Globe Theatre', 'Bankside'],
  source: { system: 'TodayTix', url: 'https://www.todaytix.com/london/shows/44741', captured: new Date().toISOString().slice(0, 10), method: 'extracted' },
  stage: { type: 'thrust', width: 13.6, depth: 7.8, thrust: 0, pit: 0 },
  levels: levels.map((l) => ({
    ...l,
    ...LEVELS[l.name],
    scale: 0.0195,
    origin: [1382, 691],
    ring: [1382, 1000],
    ...(l.name === 'Lower Gallery' ? { standing: [{ name: 'Yard', capacity: 700 }] } : {}),
  })),
});
