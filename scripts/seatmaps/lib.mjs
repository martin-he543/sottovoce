/**
 * Shared helpers for the 3D seating plans in public/seatmaps/.
 *
 * A plan is one auditorium, captured from the venue's own booking seat map (the JSON / SVG the "select a seat" screen
 * loads) and normalised to this shape:
 *
 *   {
 *     id: 'coliseum',                      // file name: public/seatmaps/<id>.json
 *     name: 'London Coliseum', hall: 'Main Auditorium',
 *     venueNames: ['London Coliseum', 'English National Opera (London Coliseum)'],   // timetable venue_name matches
 *     mapVenueIds: ['eno', 'ext_london-coliseum'],                                     // timetable venue ids
 *     halls: ['Main Stage'],               // optional: only these timetable `hall` values use this plan
 *     source: { system: 'Spektrix', url: 'https://…' (booking), plan?: 'https://…' (published plan, if used), captured, method: 'extracted' | 'traced' },
 *     stage: { type: 'proscenium' | 'thrust' | 'platform' | 'round', width: 14, depth: 10, thrust?: 6, pit?: 3 },  // metres
 *     levels: [{
 *       name: 'Stalls',
 *       height?: 0,                        // metres above the stalls floor at the level's front row
 *       rake?: 0.1,                        // rise per metre going back (stalls ~0.08, steep circles ~0.45)
 *       front?: 2,                         // metres from the stage front to the level's first central row
 *       origin?: [x, y],                   // or: the plan point under the stage's front-centre, in this level's units
 *       scale?: 0.02,                      // metres per plan unit (default: seat pitch taken as 0.52 m)
 *       wrap?: 11,                         // horseshoe half-width (m): seats a flattened map draws further out fold
 *                                          // back along the side walls towards the stage (slips, side boxes)
 *       sections: [{ name: 'Stalls', rows: [{ row: 'A', seats: [['1', x, y], ['2', x, y, band?], …] }] }],
 *                                          // section lift?: m up/down, for blocks a map draws in the wrong tier
 *       standing?: [{ name: 'Yard', capacity: 700 }],
 *     }],
 *     prices?: { bands: [25, 35, …], fees: true, captured, production, inferred },    // optional: price bands (£,
 *                                          // cheapest first) from the booking map; a seat's 4th value is its band
 *   }
 *
 * Plan coordinates are the booking map's own (x right, y down), with the stage at the top (small y). Each level keeps
 * its own coordinate frame because booking maps usually draw the tiers side by side; the viewer lines each one up on
 * the stage: centred on the level's middle seats, with its first central row `front` metres back (or via `origin`,
 * for plans whose tiers already share one frame, e.g. in-the-round halls). Stage `pit` is the orchestra pit depth.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = join(ROOT, 'public', 'seatmaps');

const round = (n) => Math.round(n * 10) / 10;

/** Rows in their natural order: A, B, …, Z, AA, … then anything else (boxes) alphabetically with numbers in order. */
export const rowOrder = (a, b) => {
  const k = (r) => (/^[A-Z]{1,2}$/.test(r) ? `0${r.length}${r}` : `1${r.replace(/\d+/g, (d) => d.padStart(4, '0'))}`);
  return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
};

/** Checks a plan, rounds coordinates, sorts rows and seats, and writes public/seatmaps/<id>.json + the index. */
export async function writePlan(plan) {
  if (!/^[a-z0-9-]+$/.test(plan.id)) throw new Error(`bad id ${plan.id}`);
  if (!plan.stage?.type) throw new Error(`${plan.id}: stage.type missing`);
  let capacity = 0;
  for (const level of plan.levels) {
    for (const section of level.sections) {
      section.rows = section.rows
        .filter((r) => r.seats.length)
        .map((r) => ({
          row: String(r.row).trim(),
          seats: r.seats
            .map(([n, x, y, band]) => (band == null ? [String(n).trim(), round(x), round(y)] : [String(n).trim(), round(x), round(y), band]))
            .sort((a, b) => (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0) || a[0].localeCompare(b[0])),
        }))
        .sort((a, b) => rowOrder(a.row, b.row));
      for (const r of section.rows) capacity += r.seats.length;
    }
    level.sections = level.sections.filter((s) => s.rows.length);
  }
  plan.levels = plan.levels.filter((l) => l.sections.length || l.standing?.length);
  // Stalls first, then up the house: the viewer colours tiers and hides "the ones above" by this order.
  if (plan.levels.every((l) => l.height !== undefined)) plan.levels.sort((a, b) => a.height - b.height);
  plan.capacity = capacity + plan.levels.reduce((n, l) => n + (l.standing ?? []).reduce((m, s) => m + (s.capacity ?? 0), 0), 0);
  plan.seated = capacity;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, `${plan.id}.json`), JSON.stringify(plan));
  await updateIndex(plan);
  console.log(`${plan.id}: ${capacity} seats in ${plan.levels.length} levels → public/seatmaps/${plan.id}.json`);
  return plan;
}

async function updateIndex(plan) {
  const file = join(OUT_DIR, 'index.json');
  let index = [];
  try {
    index = JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const entry = {
    id: plan.id,
    name: plan.name,
    hall: plan.hall,
    venueNames: plan.venueNames ?? [plan.name],
    mapVenueIds: plan.mapVenueIds ?? [],
    ...(plan.halls ? { halls: plan.halls } : {}),
    capacity: plan.capacity,
    ...(plan.prices ? { priceRange: [plan.prices.bands[0], plan.prices.bands.at(-1)] } : {}),
    levels: plan.levels.map((l) => l.name),
    stage: plan.stage.type,
  };
  index = [...index.filter((e) => e.id !== plan.id), entry].sort((a, b) => a.name.localeCompare(b.name) || a.hall.localeCompare(b.hall));
  await writeFile(file, JSON.stringify(index, null, 1) + '\n');
}

/**
 * Price bands from a booking map: `seats` are [level, seat tuple, price | null]. Prices become band indexes (cheapest
 * first) appended to each tuple; a seat the map priced nothing for (sold, held) takes the band of the nearest priced
 * seat in its level. Returns the plan's `prices` block.
 */
export function assignBands(seats, meta) {
  const bands = [...new Set(seats.map(([, , p]) => p).filter((p) => p != null))].sort((a, b) => a - b);
  let inferred = 0;
  for (const [level, tuple, price] of seats) {
    if (price != null) {
      tuple[3] = bands.indexOf(price);
      continue;
    }
    let best = null;
    let bestD = Infinity;
    for (const [l, t, p] of seats) {
      if (p == null || l !== level) continue;
      const d = Math.hypot(t[1] - tuple[1], t[2] - tuple[2]);
      if (d < bestD) [best, bestD] = [p, d];
    }
    if (best != null) {
      tuple[3] = bands.indexOf(best);
      inferred++;
    }
  }
  return { bands, ...meta, inferred };
}

/**
 * Turns a Spektrix seating-plan JSON (…/cog-wp-spektrix/plans/<id>.json, or /api/v3/plans/<id>) into plan levels.
 * `levelOf(areaName)` maps each Spektrix area to a level name (null to skip it); box rows like "Box 9 Seat " become
 * a "Boxes" section with row "Box 9".
 */
export function spektrixLevels(raw, levelOf = (n) => n) {
  const levels = new Map();
  const visit = (area) => {
    for (const sub of area.areas ?? []) visit(sub);
    if (!area.seats?.length) return;
    const levelName = levelOf(area.name);
    if (!levelName) return;
    const level = levels.get(levelName) ?? { name: levelName, sections: new Map() };
    levels.set(levelName, level);
    for (const s of area.seats) {
      const box = /^(.*?box.*?)\s*seat\s*$/i.exec(s.row);
      const section = box ? 'Boxes' : area.name;
      const row = box ? box[1].trim() : s.row.trim();
      const sec = level.sections.get(section) ?? new Map();
      level.sections.set(section, sec);
      const r = sec.get(row) ?? [];
      sec.set(row, r);
      r.push([String(s.number ?? s.name), s.x, s.y]);
    }
  };
  visit(raw);
  return [...levels.values()].map((l) => ({
    name: l.name,
    sections: [...l.sections].map(([name, rows]) => ({ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) })),
  }));
}

/** Fetches a public seat-map URL, caching it under scripts/seatmaps/raw/ (gitignored) so reruns work offline. */
export async function fetchCached(name, url, init) {
  const file = join(ROOT, 'scripts', 'seatmaps', 'raw', name);
  try {
    return await readFile(file, 'utf8');
  } catch {}
  const res = await fetch(url, { ...init, headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36', ...init?.headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}
