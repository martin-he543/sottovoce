// National Theatre, Olivier Theatre: the NT's own seating-plan PDF (linked from the venue page), read with `mutool trace`.
// The booking map (tickets.nationaltheatre.org.uk, Tessitura TNEW "syos" API) sits behind an Imperva captcha, so this
// uses the PDF instead. Its seat boxes are vector squares and the seat numbers are glyph outlines (not text), so each
// digit is recognised by its path's command sequence. Needs mutool (MuPDF tools) on the PATH.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, writePlan } from '../lib.mjs';

const URL = 'https://national-theatre-assets.s3.amazonaws.com/uploads/2022/08/Olivier-Theatre-seating-plan.pdf';
const pdf = join(ROOT, 'scripts', 'seatmaps', 'raw', 'nt-olivier.pdf');
if (!existsSync(pdf)) {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
  await mkdir(join(ROOT, 'scripts', 'seatmaps', 'raw'), { recursive: true });
  await writeFile(pdf, Buffer.from(await res.arrayBuffer()));
}
const trace = execFileSync('mutool', ['trace', pdf], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// Paths in page coordinates (y down). Stroked squares are seats; black fills are glyphs.
const H = 595.276;
const paths = [];
for (const m of trace.matchAll(/<(fill_path|stroke_path)([^>]*)>([\s\S]*?)<\/\1>/g)) {
  const subs = [];
  let sig = '';
  for (const c of m[3].matchAll(/<(moveto|lineto|curveto|closepath)([^>]*)\/>/g)) {
    const n = [...c[2].matchAll(/="([-\d.]+)"/g)].map((v) => +v[1]);
    if (c[1] === 'moveto') (sig += '|M'), subs.push([]);
    else sig += c[1][0].toUpperCase();
    if (n.length) subs.at(-1).push([n.at(-2), H - n.at(-1)]);
  }
  const pts = subs.flat();
  const mid = (i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2;
  paths.push({ type: m[1], black: /color="0 0 0 1"/.test(m[2]), sig, subs, cx: mid(0), cy: mid(1) });
}

// Digit outlines by command sequence. 6 and 9 share one: told apart by where the counter sits.
const DIGITS = {
  '|MCCCC|MCCCC': '0', '|MLLLLCLC': '1', '|MCCCCLLLCCCCC': '2', '|MCCCCLCCCLCCCLCCCCC': '3', '|MLLLC|MLLLLLLLLLLC': '4',
  '|MLLLCCCCLCCCCLLLC': '5', '|MCCCC|MCCLCCCCCCC': '6', '|MCLCLLLC': '7', '|MCCCC|MCCCC|MCCCCCCCC': '8',
};
const STAGE = [425, 517]; // centre of the stage arc on the page
const avg = (ps, i) => ps.reduce((s, p) => s + p[i], 0) / ps.length;
const seats = paths.filter((p) => p.type === 'stroke_path').map((p) => {
  const q = p.subs[0].slice(0, 4);
  const [cx, cy] = [avg(q, 0), avg(q, 1)];
  // Text runs along the fan (its "up" points away from the stage): pick the box edge closest to that tangent.
  const r = Math.hypot(cx - STAGE[0], cy - STAGE[1]);
  const t = [(STAGE[1] - cy) / r, (cx - STAGE[0]) / r];
  const size = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  const edges = [[q[1], q[0]], [q[2], q[1]], [q[0], q[1]], [q[1], q[2]]].map(([a, b]) => [(a[0] - b[0]) / size, (a[1] - b[1]) / size]);
  const u = edges.sort((a, b) => b[0] * t[0] + b[1] * t[1] - (a[0] * t[0] + a[1] * t[1]))[0];
  return { q, cx, cy, size, u, v: [u[1], -u[0]], glyphs: [] };
});
const inside = (q, x, y) => Math.abs(q.reduce((s, a, i) => { const b = q[(i + 1) % 4]; return s + Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])); }, 0)) === 4;
for (const g of paths.filter((p) => p.type === 'fill_path' && p.black && DIGITS[p.sig])) {
  seats.find((s) => Math.hypot(s.cx - g.cx, s.cy - g.cy) < s.size && inside(s.q, g.cx, g.cy))?.glyphs.push(g);
}
for (const s of seats) {
  const along = (g) => g.cx * s.u[0] + g.cy * s.u[1];
  s.n = +s.glyphs.sort((a, b) => along(a) - along(b)).map((g) => {
    if (DIGITS[g.sig] !== '6') return DIGITS[g.sig];
    const c = g.subs[1];
    return (avg(c, 0) - g.cx) * s.v[0] + (avg(c, 1) - g.cy) * s.v[1] < 0 ? '9' : '6';
  }).join('');
}

// Rows: chains of consecutively numbered seats side by side along the text direction.
const ok = seats.filter((s) => s.n);
const parent = ok.map((_, i) => i);
const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
ok.forEach((a, i) => ok.forEach((b, j) => {
  const [dx, dy] = [b.cx - a.cx, b.cy - a.cy];
  if (b.n === a.n + 1 && Math.hypot(dx, dy) < 1.8 * a.size && Math.abs(dx * a.v[0] + dy * a.v[1]) < 0.45 * a.size) parent[root(i)] = root(j);
}));
const chains = Object.values(Object.groupBy(ok.map((s, i) => ({ ...s, i })), (s) => root(s.i))).map((c) => {
  const m = c[c.length >> 1];
  return { seats: c, r: avg(c.map((s) => [Math.hypot(s.cx - STAGE[0], s.cy - STAGE[1])]), 0), ang: (Math.atan2(m.cx - STAGE[0], STAGE[1] - m.cy) * 180) / Math.PI };
});

// Blocks (by distance and bearing from the stage), each with its row letters from the front, as printed on the plan.
const STALLS = 'DEFGHJKLMOPR'.split('');
const BLOCKS = [
  { level: 'Stalls', test: (c) => c.r < 155, rows: ['A', 'B', 'C'] },
  { level: 'Stalls', test: (c) => c.r < 335 && Math.abs(c.ang) < 35, side: true, rows: STALLS },
  { level: 'Stalls', test: (c) => c.r < 200 && Math.abs(c.ang) >= 35, side: true, rows: ['B', 'C'] },
  { level: 'Stalls', test: (c) => c.r < 335 && Math.abs(c.ang) >= 35, side: true, rows: 'DEFGHJKLM'.split('') },
  { level: 'Circle', test: (c) => c.r >= 335, side: true, rows: 'ABCDEFG'.split('') },
];
const levels = { Stalls: new Map(), Circle: new Map() };
const used = new Set();
for (const b of BLOCKS) {
  for (const sign of b.side ? [-1, 0, 1] : [0]) {
    const cs = chains.filter((c) => !used.has(c) && b.test(c) && (!b.side || Math.sign(Math.round(c.ang / 10)) === sign)).sort((p, q) => p.r - q.r);
    if (!cs.length) continue;
    if (cs.length !== b.rows.length) throw new Error(`${b.level} block (${sign}): ${cs.length} rows, expected ${b.rows.length}`);
    cs.forEach((c, k) => {
      used.add(c);
      const rows = levels[b.level];
      // Turned 180° (the plan has the stage at the bottom).
      rows.set(b.rows[k], [...(rows.get(b.rows[k]) ?? []), ...c.seats.map((s) => [String(s.n), -s.cx, -s.cy])]);
    });
  }
}
if (used.size !== chains.length) throw new Error(`${chains.length - used.size} rows left unassigned`);

const LEVELS = {
  Stalls: { height: 0, rake: 0.2, front: 7 },
  Circle: { height: 5, rake: 0.4, front: 19 },
};

await writePlan({
  id: 'nt-olivier',
  name: 'National Theatre',
  hall: 'Olivier Theatre',
  venueNames: ['National Theatre'],
  mapVenueIds: ['nt'],
  halls: ['Olivier Theatre'],
  source: { system: 'NT seating plan (PDF)', url: 'https://www.nationaltheatre.org.uk/whats-on/', plan: URL, captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'thrust', width: 18, depth: 14, thrust: 6 },
  levels: Object.entries(levels).map(([name, rows]) => ({
    name,
    ...LEVELS[name],
    sections: [{ name, rows: [...rows].map(([row, seats]) => ({ row, seats })) }],
  })),
});
