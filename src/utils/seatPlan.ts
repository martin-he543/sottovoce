/**
 * Seating plans (public/seatmaps/<id>.json, built by scripts/seatmaps/ from each venue's own booking seat map) and
 * their layout in 3D: metres, x across the house, y up, z from the stage front (0) back into the auditorium.
 */

/** `band`: index into the plan's `prices.bands`, when the booking map priced the seat. */
export type SeatTuple = [num: string, x: number, y: number, band?: number];

export interface PlanLevel {
  name: string;
  height?: number;
  rake?: number;
  front?: number;
  origin?: [number, number];
  scale?: number;
  /** Plan point a round hall's rows curve about (its middle): the tier rises with distance from it, not from the stage. */
  ring?: [number, number];
  /** Half-width (m) of a horseshoe: seats a flattened booking map draws beyond it fold back along the side walls. */
  wrap?: number;
  /** `lift`: metres to raise (or, negative, lower) a section the map draws in this tier's panel but sits a floor apart. */
  sections: { name: string; lift?: number; rows: { row: string; seats: SeatTuple[] }[] }[];
  standing?: { name: string; capacity?: number }[];
}

export interface SeatPlan {
  id: string;
  name: string;
  hall: string;
  venueNames?: string[];
  mapVenueIds?: string[];
  halls?: string[];
  capacity: number;
  seated: number;
  /** url: where to book; plan: the published seating plan, when the seats came from that rather than the booking map. */
  source: { system: string; url: string; plan?: string; note?: string; captured: string; method: 'extracted' | 'traced' };
  stage: { type: 'proscenium' | 'thrust' | 'platform' | 'round'; width: number; depth: number; pit?: number; thrust?: number; focus?: [number, number] };
  levels: PlanLevel[];
  /** Price bands (£, cheapest first) read off the booking map for one performance; `fees`: booking fee included. */
  prices?: { bands: number[]; fees: boolean; captured: string; production?: string; inferred?: number };
}

export type SeatPlanSummary = Pick<SeatPlan, 'id' | 'name' | 'hall' | 'venueNames' | 'mapVenueIds' | 'halls' | 'capacity'> & {
  /** Cheapest and dearest captured price band, for plans that have them. */
  priceRange?: [number, number];
  levels: string[];
  stage: SeatPlan['stage']['type'];
};

export interface WorldSeat {
  level: number;
  section: number;
  row: string;
  num: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about y so the seat faces the stage. */
  yaw: number;
}

/** A run of adjacent seats in one row (rows break at aisles), for the terraces and row labels. */
export interface SeatRun {
  level: number;
  section: number;
  row: string;
  /** Index into seats, in order across the row. */
  seats: number[];
  /** First row of its section, so upper tiers get a balcony front. */
  front: boolean;
}

export interface PlanLayout {
  seats: WorldSeat[];
  runs: SeatRun[];
  /** Where each level's label floats. */
  levelLabels: { level: number; text: string; x: number; y: number; z: number }[];
  /** The point the seats face (stage centre for prosceniums, the thrust for open stages). */
  focus: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
}

export const SEAT_PITCH = 0.52;
/** Least distance between rows; booking maps often draw rows as close as seats. */
export const ROW_PITCH = 0.85;

// Typical tier geometry by level order (stalls first) when a plan doesn't say.
const DEFAULT_HEIGHT = [0, 4.2, 8.2, 12, 15.5, 19];
const DEFAULT_FRONT = [3, 9, 12, 15, 18, 21];
const DEFAULT_RAKE = [0.08, 0.32, 0.4, 0.45, 0.5, 0.5];

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Plan units per seat: the median gap from each seat to its nearest neighbour in the same row. */
function seatPitchUnits(level: PlanLevel) {
  const gaps: number[] = [];
  for (const sec of level.sections)
    for (const { seats } of sec.rows) {
      if (seats.length < 2 || seats.length > 400) continue;
      for (const a of seats) {
        let best = Infinity;
        for (const b of seats) if (a !== b) best = Math.min(best, Math.hypot(a[1] - b[1], a[2] - b[2]));
        if (best > 0 && best < Infinity) gaps.push(best);
      }
    }
  return median(gaps) || 1;
}

/** Plan units between rows, from the middle of the level: the median gap between consecutive rows' centre lines. */
function rowPitchUnits(rows: SeatTuple[][], cx: number, halfBand: number) {
  const ys = rows
    .map((seats) => seats.filter((s) => Math.abs(s[1] - cx) <= halfBand).map((s) => s[2]))
    .filter((y) => y.length >= 2)
    .map(median)
    .sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > 0);
  const m = median(gaps);
  return median(gaps.filter((g) => g < m * 3)) || 0;
}

/** Splits a row's seats (sorted across the house) wherever the gap is wider than an aisle's worth. */
function splitRuns(idx: number[], seats: WorldSeat[]) {
  const sorted = [...idx].sort((a, b) => seats[a].x - seats[b].x || seats[a].z - seats[b].z);
  const runs: number[][] = [];
  for (const i of sorted) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (prev !== undefined && Math.hypot(seats[i].x - seats[prev].x, seats[i].z - seats[prev].z) < SEAT_PITCH * 2.2) run.push(i);
    else runs.push([i]);
  }
  return runs;
}

export function layoutPlan(plan: SeatPlan): PlanLayout {
  const stage = plan.stage;
  // Open stages are watched from round the thrust; prosceniums from in front of the stage, rows curving about a point
  // a little behind the front.
  const focus =
    stage.focus
      ? { x: stage.focus[0], z: stage.focus[1] }
      : stage.type === 'thrust'
        ? { x: 0, z: (stage.thrust ?? 4) * 0.4 }
        : stage.type === 'round'
          ? { x: 0, z: 0 }
          : { x: 0, z: -Math.min(4, stage.depth / 3) };
  const seats: WorldSeat[] = [];
  const runs: SeatRun[] = [];
  const levelLabels: PlanLayout['levelLabels'] = [];

  plan.levels.forEach((level, li) => {
    const all = level.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
    if (!all.length) return;
    const scale = level.scale ?? SEAT_PITCH / seatPitchUnits(level);
    // Line the level up on the stage: centre on its main (non-box) seats, first central row `front` metres back.
    const main = level.sections.filter((s) => s.name !== 'Boxes').flatMap((s) => s.rows.flatMap((r) => r.seats));
    const ref = main.length ? main : all;
    const xs = ref.map((s) => s[1]);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const cx = (minX + maxX) / 2;
    const band = ref.filter((s) => Math.abs(s[1] - cx) <= Math.max((maxX - minX) * 0.15, 3 / scale));
    const frontY = Math.min(...(band.length ? band : ref).map((s) => s[2]));
    const front = level.front ?? DEFAULT_FRONT[li] ?? DEFAULT_FRONT[DEFAULT_FRONT.length - 1];
    const mainRows = level.sections.filter((s) => s.name !== 'Boxes').flatMap((s) => s.rows.map((r) => r.seats));
    const rowGap = level.scale ? 0 : rowPitchUnits(mainRows, cx, Math.max((maxX - minX) * 0.15, 3 / scale));
    const scaleZ = rowGap ? Math.max(scale, ROW_PITCH / rowGap) : scale;
    const [ox, oy] = level.origin ?? [cx, frontY - front / scaleZ];
    const frontZ = (frontY - oy) * scaleZ;
    const height = level.height ?? DEFAULT_HEIGHT[li] ?? li * 4;
    const rake = level.rake ?? DEFAULT_RAKE[li] ?? 0.45;

    const first = seats.length;
    const dist = (x: number, z: number) => Math.hypot(x - focus.x, z - focus.z);
    level.sections.forEach((sec, si) => {
      // A section's overhang (slips, side boxes) measures depth from its own front row, locally (rows often slope).
      const overhangFront = new Map<number, number>();
      const strip = (x: number) => Math.round(x / 1.2);
      if (level.wrap)
        for (const r of sec.rows)
          for (const [, px, py] of r.seats) {
            const x = (px - ox) * scale, z = (py - oy) * scaleZ;
            if (Math.abs(x) > level.wrap) overhangFront.set(strip(x), Math.min(overhangFront.get(strip(x)) ?? Infinity, z));
          }
      sec.rows.forEach((r) => {
        for (const [num, px, py] of r.seats) {
          let x = (px - ox) * scale;
          let z = (py - oy) * scaleZ;
          if (level.wrap && Math.abs(x) > level.wrap) {
            // Turn the overhang 90° about the wall line: along the map becomes towards the stage, depth becomes outwards.
            const side = Math.sign(x), along = Math.abs(x) - level.wrap, depth = z - overhangFront.get(strip(x))!;
            x = side * (level.wrap + depth);
            z = frontZ - along;
          }
          seats.push({ level: li, section: si, row: r.row, num, x, y: 0, z, yaw: Math.atan2(focus.x - x, focus.z - z) });
        }
      });
    });
    // Rake: rise with distance from the stage, measured from the level's first central row (boxes stay level).
    const levelSeats = seats.slice(first);
    const mainSeats = levelSeats.filter((s) => level.sections[s.section].name !== 'Boxes');
    const pool = mainSeats.length ? mainSeats : levelSeats;
    const central = level.ring ? pool : pool.filter((s) => Math.abs(s.x) < Math.max(3, ((maxX - minX) * scale) / 6));
    const ringAt = level.ring && { x: (level.ring[0] - ox) * scale, z: (level.ring[1] - oy) * scaleZ };
    const rise = ringAt ? (s: WorldSeat) => Math.hypot(s.x - ringAt.x, s.z - ringAt.z) : (s: WorldSeat) => dist(s.x, s.z);
    const d0 = Math.min(...(central.length ? central : pool).map(rise));
    for (const s of levelSeats) s.y = height + rake * Math.max(0, rise(s) - d0) + (level.sections[s.section].lift ?? 0);

    let i = first;
    level.sections.forEach((sec, si) =>
      sec.rows.forEach((r, ri) => {
        const idx = r.seats.map(() => i++);
        for (const run of splitRuns(idx, seats)) runs.push({ level: li, section: si, row: r.row, seats: run, front: ri === 0 && sec.name !== 'Boxes' });
      })
    );
    // Caption off one end of the tier, alternating sides so neighbouring tiers' captions don't overlap.
    const dir = li % 2 ? -1 : 1;
    const side = (mainSeats.length ? mainSeats : levelSeats).reduce((m, s) => (s.x * dir > m.x * dir ? s : m));
    levelLabels.push({ level: li, text: level.name, x: side.x + dir * 1.8, y: side.y + 1.6, z: side.z });
  });

  const bounds = seats.reduce(
    (b, s) => ({ minX: Math.min(b.minX, s.x), maxX: Math.max(b.maxX, s.x), minZ: Math.min(b.minZ, s.z), maxZ: Math.max(b.maxZ, s.z), maxY: Math.max(b.maxY, s.y) }),
    { minX: -stage.width / 2, maxX: stage.width / 2, minZ: -stage.depth, maxZ: 0, maxY: 0 }
  );
  return { seats, runs, levelLabels, focus, bounds };
}

/** Where your eyes are, sitting in a seat. */
export const eyeOf = (s: WorldSeat) => ({ x: s.x, y: s.y + 1.2, z: s.z });

/** "Dress Circle · Row C · Seat 14" (box seats read "Box 9 · Seat 3"). */
export function seatLabel(plan: SeatPlan, s: WorldSeat) {
  const level = plan.levels[s.level];
  const section = level.sections[s.section].name;
  const where = section === 'Boxes' ? `${level.name} · ${s.row}` : `${section === level.name ? level.name : `${level.name} · ${section}`} · Row ${s.row}`;
  return `${where} · Seat ${s.num}`;
}

/** The plans that cover a timetable listing: venue id or name, then the hall when the plan is hall-specific. */
export function plansFor(index: SeatPlanSummary[], venue: { id?: string; name?: string; hall?: string | null }) {
  const name = venue.name?.toLowerCase();
  const matches = index.filter((p) => (venue.id && p.mapVenueIds?.includes(venue.id)) || (name && p.venueNames?.some((n) => n.toLowerCase() === name)));
  if (venue.hall) {
    const hall = matches.filter((p) => p.halls?.some((h) => h.toLowerCase() === venue.hall!.toLowerCase()));
    if (hall.length) return hall;
  }
  return matches.filter((p) => !p.halls || !venue.hall);
}

let indexPromise: Promise<SeatPlanSummary[]> | null = null;
const planCache = new Map<string, Promise<SeatPlan>>();

export const loadSeatPlanIndex = () =>
  (indexPromise ??= fetch('/seatmaps/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<SeatPlanSummary[]>) : []))
    .catch(() => []));

export function loadSeatPlan(id: string) {
  let p = planCache.get(id);
  if (!p) {
    p = fetch(`/seatmaps/${id}.json`).then((r) => (r.ok ? (r.json() as Promise<SeatPlan>) : Promise.reject(new Error(`HTTP ${r.status}`))));
    p.catch(() => planCache.delete(id));
    planCache.set(id, p);
  }
  return p;
}

/** How a seat sees the stage: straight-line distance to the stage front centre, angle off the centre line, height. */
export function seatSightline(s: WorldSeat) {
  const eye = eyeOf(s);
  return {
    distance: Math.hypot(eye.x, eye.y - 1.1, eye.z),
    offAxis: Math.abs((Math.atan2(eye.x, Math.max(0.1, eye.z)) * 180) / Math.PI),
    height: eye.y - 1.1,
  };
}

/** Rows in their natural order: A, B, …, Z, AA, … then anything else (boxes) with numbers in order. */
export const rowOrder = (a: string, b: string) => {
  const k = (r: string) => (/^[A-Z]{1,2}$/.test(r) ? `0${r.length}${r}` : `1${r.replace(/\d+/g, (d) => d.padStart(4, '0'))}`);
  return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
};

/** Seat key for URLs and the advisor: tier|row|number, with the block when it isn't the whole tier (slips left/right). */
export function seatKey(plan: SeatPlan, s: WorldSeat) {
  const level = plan.levels[s.level];
  const section = level.sections[s.section].name;
  return `${section === level.name || section === 'Boxes' ? level.name : `${level.name} · ${section}`}|${s.row}|${s.num}`;
}
