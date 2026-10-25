// National Theatre, Lyttelton Theatre: the NT's own seating-plan PDF (linked from the venue page), read with `mutool trace`.
// The booking map (tickets.nationaltheatre.org.uk, Tessitura TNEW "syos" API) sits behind an Imperva captcha, so this
// uses the PDF instead: seat boxes are stroked squares with the seat number as text inside; row letters are outlines,
// so rows are found from the geometry and lettered from the front as printed. Needs mutool (MuPDF tools) on the PATH.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';

const URL = 'https://national-theatre-assets.s3.amazonaws.com/uploads/2022/08/Lyttelton-Theatre-seating-plan.pdf';
const pdf = join(ROOT, 'scripts', 'seatmaps', 'raw', 'nt-lyttelton.pdf');
if (!existsSync(pdf)) {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
  await mkdir(join(ROOT, 'scripts', 'seatmaps', 'raw'), { recursive: true });
  await writeFile(pdf, Buffer.from(await res.arrayBuffer()));
}
const trace = execFileSync('mutool', ['trace', pdf], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// Page coordinates, y down.
const H = 841.89;
const boxes = [];
for (const m of trace.matchAll(/<stroke_path[^>]*>([\s\S]*?)<\/stroke_path>/g)) {
  const q = [...m[1].matchAll(/<(?:moveto|lineto) x="([-\d.]+)" y="([-\d.]+)"/g)].map((v) => [+v[1], H - +v[2]]);
  if (q.length < 4 || q.length > 5 || /curveto/.test(m[1])) continue;
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  if (w < 5 || w > 14 || h < 5 || h > 14) continue;
  boxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), cx: (Math.min(...xs) + w / 2), cy: Math.min(...ys) + h / 2, digits: [] });
}
for (const m of trace.matchAll(/<span[^>]*trm="([-\d.]+)[^"]*"[^>]*>\s*<g unicode="(\d)"[^>]*x="([-\d.]+)" y="([-\d.]+)" adv="([-\d.]+)"/g)) {
  const [size, ch, x, y, adv] = [+m[1], m[2], +m[3], H - +m[4], +m[5]];
  const [gx, gy] = [x + (adv * size) / 2, y - size * 0.35];
  boxes.find((b) => gx > b.x0 && gx < b.x1 && gy > b.y0 && gy < b.y1)?.digits.push([gx, ch]);
}
const seats = boxes.filter((b) => b.digits.length).map((b) => ({ ...b, n: +b.digits.sort((a, c) => a[0] - c[0]).map((d) => d[1]).join('') }));

// The slips: single boxes beside the circle, outside its rows.
const isSlip = (s) => s.cy < 340 && (s.cx < 60 || s.cx > 545);

// Rows: chains of consecutively numbered neighbours on (nearly) the same line.
const rowSeats = seats.filter((s) => !isSlip(s));
const parent = rowSeats.map((_, i) => i);
const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
rowSeats.forEach((a, i) => rowSeats.forEach((b, j) => {
  if (b.n === a.n + 1 && Math.abs(b.cx - a.cx) < 25 && Math.abs(b.cy - a.cy) < 3.5) parent[root(i)] = root(j);
}));
const chains = Object.values(Object.groupBy(rowSeats.map((s, i) => ({ ...s, i })), (s) => root(s.i)));
const meanY = (c) => c.reduce((t, s) => t + s.cy, 0) / c.length;

// Front rows are lowest on the page (stage at the bottom). Letters as printed on the plan.
const LETTERS = { Stalls: 'ABCDEFGHJKLMOPRSTUV'.split(''), Circle: 'ABCDEFGHJ'.split('') };
const level = (name, cs) => {
  cs.sort((a, b) => meanY(b) - meanY(a));
  if (cs.length !== LETTERS[name].length) throw new Error(`${name}: ${cs.length} rows, expected ${LETTERS[name].length}`);
  // Turned 180° (the plan has the stage at the bottom).
  return cs.map((c, k) => ({ row: LETTERS[name][k], seats: c.map((s) => [String(s.n), -s.cx, -s.cy]) }));
};
const slips = seats.filter(isSlip).map((s) => [String(s.n), -s.cx, -s.cy]);

const LEVELS = {
  Stalls: { height: 0, rake: 0.12, front: 3 },
  Circle: { height: 5, rake: 0.4, front: 14 },
};

await writePlan({
  id: 'nt-lyttelton',
  name: 'National Theatre',
  hall: 'Lyttelton Theatre',
  venueNames: ['National Theatre'],
  mapVenueIds: ['nt'],
  halls: ['Lyttelton Theatre'],
  source: { system: 'NT seating plan (PDF)', url: 'https://www.nationaltheatre.org.uk/whats-on/', plan: URL, captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 13.5, depth: 17, pit: 3 },
  levels: [
    { name: 'Stalls', ...LEVELS.Stalls, sections: [{ name: 'Stalls', rows: level('Stalls', chains.filter((c) => meanY(c) >= 340)) }] },
    {
      name: 'Circle',
      ...LEVELS.Circle,
      sections: [
        { name: 'Circle', rows: level('Circle', chains.filter((c) => meanY(c) < 340)) },
        { name: 'Slips', rows: [{ row: 'Slips', seats: slips }] },
      ],
    },
  ],
});
