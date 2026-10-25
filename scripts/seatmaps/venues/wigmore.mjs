// Wigmore Hall: the Tessitura seat map drawn as inline SVG on wigmore-hall.org.uk/booking/<performanceId>.
// The SVG lists every seat (sold ones too) as <rect class="seatmap__seat" data-id="<screen>-<row>-<seat>"> in an
// 8-unit box at its x/y; /api/v1/seatmap/<id> only returns the seats still on sale, so the DOM is the full source.
// Recapture: open https://www.wigmore-hall.org.uk/booking/61337 (any performance; the "Book" link on a
// /whats-on/<yyyymmddhhmm> page) in a browser, wait for the map, and save the <div class="seatmap__main"> outer HTML
// to scripts/seatmaps/raw/wigmore.seatmap.html. Screens 1 and 2 are the front and rear Stalls, 3 the Balcony.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';

const html = await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', 'wigmore.seatmap.html'), 'utf8');
// The map packs rows 10 units apart, the same as seats; real rows are ~1.6x the seat pitch apart.
const ROW_STRETCH = 1.6;

const levels = { Stalls: new Map(), Balcony: new Map() };
for (const [, x, y, screen, row, n] of html.matchAll(/<svg height="8" width="8" x="([\d.]+)" y="([\d.]+)"><rect class="seatmap__seat[^"]*" data-id="(\d)-([A-Z]+)-(\d+)"/g)) {
  const rows = levels[screen === '3' ? 'Balcony' : 'Stalls'];
  const r = rows.get(row) ?? [];
  rows.set(row, r);
  r.push([String(+n), +x + 4, (+y + 4) * ROW_STRETCH]);
}

const GEOMETRY = {
  Stalls: { height: 0, rake: 0.03, front: 1.5 },
  Balcony: { height: 4, rake: 0.3, front: 18 },
};

await writePlan({
  id: 'wigmore',
  name: 'Wigmore Hall',
  hall: 'Wigmore Hall',
  venueNames: ['Wigmore Hall'],
  mapVenueIds: ['wigmore'],
  source: { system: 'Tessitura (Wigmore Hall seat map SVG)', url: 'https://www.wigmore-hall.org.uk/booking/61337', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'platform', width: 9, depth: 5 },
  levels: Object.entries(levels).map(([name, rows]) => ({
    name,
    ...GEOMETRY[name],
    sections: [{ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) }],
  })),
});
