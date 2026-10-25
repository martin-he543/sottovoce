/**
 * Draws a seating plan flat, one panel per level, so it can be checked against the booking site's own seat map.
 *
 *   node scripts/seatmaps/preview.mjs <id> [out.png]
 *
 * Writes <out>.svg and, when Google Chrome is installed, screenshots it to <out>.png.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';

const [id, outArg] = process.argv.slice(2);
const plan = JSON.parse(await readFile(join(OUT_DIR, `${id}.json`), 'utf8'));
const out = (outArg ?? `${id}-preview.png`).replace(/\.png$/, '');
const COLORS = ['#c0392b', '#2471a3', '#229954', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#2e4053'];
const PANEL = 760;

const panels = plan.levels.map((level, li) => {
  const seats = level.sections.flatMap((s, si) => s.rows.flatMap((r) => r.seats.map(([n, x, y]) => ({ n, x, y, r: r.row, si }))));
  const xs = seats.map((s) => s.x), ys = seats.map((s) => s.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = (PANEL - 60) / Math.max(x1 - x0, y1 - y0, 1);
  const px = (x) => 30 + (x - x0) * k, py = (y) => 50 + (y - y0) * k;
  const dot = Math.max(1.5, Math.min(6, k * 6));
  let g = `<g transform="translate(${(li % 2) * PANEL},${Math.floor(li / 2) * PANEL})"><rect width="${PANEL}" height="${PANEL}" fill="#fff" stroke="#ccc"/>`;
  g += `<text x="12" y="24" font-size="18" font-family="sans-serif" font-weight="bold">${level.name} — ${seats.length} seats (stage ↑)</text>`;
  for (const s of seats) g += `<circle cx="${px(s.x).toFixed(1)}" cy="${py(s.y).toFixed(1)}" r="${dot}" fill="${COLORS[s.si % COLORS.length]}"/>`;
  // Row labels at both ends, seat numbers on the first and last seat of every row.
  for (const [si, sec] of level.sections.entries())
    for (const r of sec.rows) {
      const a = r.seats[0], b = r.seats[r.seats.length - 1];
      g += `<text x="${px(a[1]) - 4}" y="${py(a[2]) + 3}" font-size="9" text-anchor="end" font-family="sans-serif" fill="#000">${r.row}·${a[0]}</text>`;
      g += `<text x="${px(b[1]) + 4}" y="${py(b[2]) + 3}" font-size="9" font-family="sans-serif" fill="#555">${b[0]}</text>`;
    }
  return g + '</g>';
});
const W = PANEL * Math.min(2, plan.levels.length), H = PANEL * Math.ceil(plan.levels.length / 2);
await writeFile(`${out}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${panels.join('')}</svg>`);
try {
  execFileSync('google-chrome', ['--headless', '--disable-gpu', `--screenshot=${out}.png`, `--window-size=${W},${H}`, `file://${out.startsWith('/') ? out : join(process.cwd(), out)}.svg`], { stdio: 'ignore' });
  console.log(`${out}.png`);
} catch {
  console.log(`${out}.svg (no Chrome for the PNG)`);
}
