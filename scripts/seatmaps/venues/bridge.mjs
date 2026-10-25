// Bridge Theatre: the Tixly hall SVG behind booking.bridgetheatre.co.uk's seat picker (Pride, end-stage layout).
// Each seat is <g class="seat s-s" transform="matrix(1,0,0,1,x,y)" data-row-name data-seat-name> inside one
// <g class="section"> per level; the three levels share one frame (Circle and Gallery wrap round the Stalls).
// The layout changes per production: pick a performance of the current show (event page → time → buyingflow URL
// /en/buyingflow/tickets/<showId>/<eventId>/) and point URL at /en/buyingflow/hallsvg/<eventId>/0/.
import { fetchCached, writePlan } from '../lib.mjs';

const URL = 'https://booking.bridgetheatre.co.uk/en/buyingflow/hallsvg/71309/0/';
const svg = await fetchCached('bridge.hall.svg', URL);

// Section ids → level names (the map labels them STALLS, CIRCLE, GALLERY).
const LEVELS = {
  'SEID-232911': { name: 'Stalls', height: 0, rake: 0.12 },
  'SEID-232909': { name: 'Circle', height: 3.6, rake: 0.4 },
  'SEID-232910': { name: 'Gallery', height: 7.2, rake: 0.45 },
};
// Stage rectangle in the SVG: x 397.7–795.1, front edge at y 128.4 (shapes are offset by translate(280,230)).
const ORIGIN = [596.4, 128.4];

const levels = [];
for (const [, id, body] of svg.matchAll(/<g class="section" id="([^"]+)">([\s\S]*?)(?=<g class="section"|$)/g)) {
  const rows = new Map();
  for (const [, x, y, row, n] of body.matchAll(/transform="matrix\(1,0,0,1,([-\d.]+),([-\d.]+)\)"\s*class="seat s-s[^"]*"\s*data-row-name="([^"]*)"\s*data-seat-name="([^"]*)"/g)) {
    const r = rows.get(row) ?? [];
    rows.set(row, r);
    r.push([n, +x + 8, +y + 8]);
  }
  const { name, ...geo } = LEVELS[id];
  levels.push({ name, ...geo, origin: ORIGIN, sections: [{ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) }] });
}

await writePlan({
  id: 'bridge',
  name: 'Bridge Theatre',
  hall: 'End stage',
  venueNames: ['Bridge Theatre'],
  mapVenueIds: ['bridge', 'bridge-theatre'],
  source: { system: 'Tixly', url: 'https://booking.bridgetheatre.co.uk/en/buyingflow/tickets/34894/71309/', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 15, depth: 9 },
  levels: ['Stalls', 'Circle', 'Gallery'].map((n) => levels.find((l) => l.name === n)),
});
