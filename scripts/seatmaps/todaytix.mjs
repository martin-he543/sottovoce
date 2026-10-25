/**
 * Reads the seating chart SVG that TodayTix (todaytix.com/booking/seating-plan, also behind londontheatre.co.uk's
 * "Pick your seats") draws for a performance: <svg id="svg-canvas"> with one group per section (data-parent-id
 * "SECTIONS", id = section name), its rows under "ROWS-<section uuid>", and one <rect data-test-id="seat-<row>-<n>">
 * per seat. Save it with: document.getElementById('svg-canvas').outerHTML once the map has rendered.
 *
 * Returns [{ section: { index, name }, row, seat, x, y }] in the chart's own coordinates (stage at the top).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from './lib.mjs';

export function todaytixSeats(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const sections = new Map();
  const stack = [];
  const seats = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const a = attrs(rest);
    if (a['data-parent-id'] === 'SECTIONS') {
      const uuid = a['data-section-group-id'].replace(/-group$/, '');
      sections.set(`ROWS-${uuid}`, { index: sections.size, name: a.id.trim() });
    }
    if (tag === 'rect' && a['data-test-id']?.startsWith('seat-')) {
      if (/rotate\((?!0[,)])/.test(stack.map((e) => e.transform ?? '').join(' '))) throw new Error('rotated seat group');
      const rows = [...stack].reverse().find((e) => e['data-parent-id']?.startsWith('ROWS-'));
      const key = a['data-test-id'].slice(5);
      const i = key.lastIndexOf('-');
      seats.push({ rows: rows?.['data-parent-id'], row: key.slice(0, i), seat: key.slice(i + 1), x: +a.x + +a.width / 2, y: +a.y + +a.height / 2 });
    }
    if (!self) stack.push(a);
  }
  return seats.map(({ rows, ...s }) => ({ section: sections.get(rows), ...s }));
}

/**
 * Groups TodayTix seats into plan levels. `place(seat)` returns { level, section?, row? } (section defaults to the
 * level name, row to the chart's row), or null to skip the seat. Levels come out in `order`.
 */
export function todaytixLevels(seats, place, order) {
  const levels = new Map(order.map((name) => [name, new Map()]));
  for (const s of seats) {
    const p = place(s);
    if (!p) continue;
    if (!levels.has(p.level)) throw new Error(`unknown level ${p.level} (section ${s.section?.name})`);
    const sections = levels.get(p.level);
    const section = p.section ?? p.level;
    const rows = sections.get(section) ?? new Map();
    sections.set(section, rows);
    const row = p.row ?? s.row;
    const r = rows.get(row) ?? [];
    rows.set(row, r);
    r.push([s.seat, s.x, s.y]);
  }
  return [...levels].map(([name, sections]) => ({
    name,
    sections: [...sections].map(([section, rows]) => ({ name: section, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  }));
}

/** Title-cases a TodayTix section id: 'ROYAL CIRCLE ' → 'Royal Circle'. */
export const titleCase = (s) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const TYPICAL_GEOMETRY = [
  { height: 0, rake: 0.08, front: 3 },
  { height: 4.2, rake: 0.3, front: 9 },
  { height: 8, rake: 0.42, front: 13 },
  { height: 11.8, rake: 0.5, front: 17 },
];

/**
 * Builds and writes the plan of a theatre from its TodayTix chart (raw/<id>.todaytix.svg, saved by capture-todaytix.py).
 *
 *   levels   level names, stalls first; each chart section is a level of the same name (title-cased) unless `rename`
 *            maps its name to one (e.g. { 'ORCHESTRA STALLS': 'Stalls' }); `skip` lists sections to leave out (on-stage seats)
 *   geometry per level [height, rake, front] (defaults: a typical West End house, see lib.mjs for the units)
 *   Boxes, loges and slips (a "BOX" section, or box rows inside a tier) become a "Boxes" section on the tier they sit beside on the chart.
 */
export async function todaytixVenue({ id, name, hall, venueNames, mapVenueIds, halls, show, levels: order, rename = {}, skip = [], geometry = [], stage }) {
  const seats = todaytixSeats(await readFile(join(ROOT, 'scripts', 'seatmaps', 'raw', `${id}.todaytix.svg`), 'utf8'));

  const boxLike = (s) => /^box/i.test(s.row) || /box|loge|slip/i.test(s.section?.name ?? '');
  const tierOf = (s) => (rename[s.section?.name] ?? titleCase(s.section?.name ?? '')).trim();
  // Each tier's span on the chart, so a box section that isn't a tier goes to the nearest one.
  const span = new Map();
  for (const s of seats) {
    const t = tierOf(s);
    if (!order.includes(t) || boxLike(s)) continue;
    const e = span.get(t) ?? [Infinity, -Infinity];
    span.set(t, [Math.min(e[0], s.y), Math.max(e[1], s.y)]);
  }
  const nearest = (y) => [...span].map(([t, [a, b]]) => [t, y < a ? a - y : y > b ? y - b : 0]).sort((p, q) => p[1] - q[1])[0][0];
  const boxName = (s) => {
    const sec = /^box\s+(\w+)/i.exec(s.section?.name ?? '');
    const row = /^box\s*(\w+)$/i.exec(s.row);
    if (sec) return `Box ${sec[1].toUpperCase()}`;
    if (row) return `Box ${row[1].toUpperCase()}`;
    if (/slip/i.test(s.section?.name ?? '') || /slip/i.test(s.row)) return 'Slips';
    if (/loge/i.test(s.section?.name ?? '')) return `Loge ${s.row}`;
    return `Box ${s.row.toUpperCase()}`;
  };

  const built = todaytixLevels(
    seats,
    (s) => {
      if (skip.includes(s.section?.name)) return null;
      const tier = tierOf(s);
      if (!boxLike(s)) return order.includes(tier) ? { level: tier } : null;
      return { level: order.includes(tier) ? tier : nearest(s.y), section: 'Boxes', row: boxName(s) };
    },
    order,
  );
  return writePlan({
    id,
    name,
    hall,
    venueNames,
    mapVenueIds,
    ...(halls ? { halls } : {}),
    source: { system: 'TodayTix', url: `https://www.todaytix.com/london/shows/${show}`, captured: new Date().toISOString().slice(0, 10), method: 'extracted' },
    stage: { type: 'proscenium', pit: 2.5, ...stage },
    levels: built.map((l, i) => {
      const [height, rake, front] = geometry[i] ?? [];
      const g = TYPICAL_GEOMETRY[Math.min(i, 3)];
      return { ...l, height: height ?? g.height, rake: rake ?? g.rake, front: front ?? g.front };
    }),
  });
}
