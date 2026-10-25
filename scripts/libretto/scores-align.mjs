/**
 * Lines up a libretto with the pages of a scanned vocal score read by scores-pages.mjs.
 *
 *   node scripts/libretto/scores-align.mjs <work id> <pages dir> <pdf page offset> <archive.org id> <pdf url> <index.json>
 *
 * <index.json> is the score's own contents list: [{ no, title, page }] with printed page numbers. Each numbered piece
 * ("No 5 - Habanera" in the libretto) owns the pages from its start to the next piece's start. Inside a piece the lines
 * are placed on pages by a monotone best fit of words sung on the page (dynamic programming), so a line never lands
 * before the one that precedes it. Writes public/libretti/scores/<id>.json:
 *   { source, offset, pieces: [{ no, title, page }], lines: [pdf page for each sung line, in libretto order] }
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const [id, dir, offset, archive, pdfUrl, indexFile] = process.argv.slice(2);
const OFF = Number(offset);
const index = JSON.parse(readFileSync(indexFile, 'utf8'));
const text = JSON.parse(readFileSync(`public/libretti/texts/${id}.json`, 'utf8'));

const tokens = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{3,}/g) ?? [];
const MARK = /^(?:(?:no|nr|n[^\w\s]{0,3})\.?\s*)?(\d+)\s*(?:bis|ter|[a-z])?\s*[-–—:]\s*\S/i;

// sung lines in libretto order, each with the piece number in force
const lines = [];
let no = 1;
for (const act of text.acts) for (const sc of act.scenes) for (const [, t, kind] of sc.lines) {
  if (kind === 'dir') { const m = MARK.exec(t.trim()); if (m && t.length < 90) no = Number(m[1]); }
  else lines.push({ no, toks: new Set(tokens(t)) });
}

const pageToks = (p) => {
  const f = `${dir}/p${p}.json`;
  // sung lyrics, plus the spoken dialogue when scores-pages.mjs was also run with DIALOGUE=1
  const d = `${dir}/p${p}.d.json`;
  const read = (x) => (existsSync(x) ? JSON.parse(readFileSync(x, 'utf8')).lyrics.join(' ') : '');
  return new Set(tokens(`${read(f)} ${read(d)}`));
};
const range = (n) => {
  const i = index.findIndex((x) => x.no === n);
  if (i < 0) return null;
  return [index[i].page + OFF, (index[i + 1]?.page ?? index[i].page + 12) + OFF - 1];
};

const result = new Array(lines.length).fill(0);
for (const n of [...new Set(lines.map((l) => l.no))]) {
  const idxs = lines.flatMap((l, i) => (l.no === n ? [i] : []));
  const r = range(n);
  if (!r) { idxs.forEach((i) => (result[i] = result[i - 1] ?? 0)); continue; }
  const pages = Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k);
  const pt = pages.map(pageToks);
  const score = idxs.map((i, a) =>
    pages.map((p, b) => {
      const l = lines[i].toks;
      if (!l.size) return 0;
      let hit = 0;
      for (const w of l) if (pt[b].has(w)) hit++;
      // a small pull toward the proportional position breaks ties for lines no page seems to carry
      return hit / l.size - 0.02 * Math.abs(a / idxs.length - b / pages.length);
    }),
  );
  // best[a][b]: best total for lines 0..a with line a on page b and pages never going backwards
  const best = score.map((row) => row.slice());
  const from = score.map((row) => row.map(() => 0));
  for (let a = 1; a < idxs.length; a++) {
    let m = -Infinity, mb = 0;
    for (let b = 0; b < pages.length; b++) {
      if (best[a - 1][b] > m) { m = best[a - 1][b]; mb = b; }
      best[a][b] += m; from[a][b] = mb;
    }
  }
  let b = best[idxs.length - 1].reduce((bi, v, k, arr) => (v > arr[bi] ? k : bi), 0);
  for (let a = idxs.length - 1; a >= 0; a--) { result[idxs[a]] = pages[b]; b = from[a][b]; }
}

mkdirSync('public/libretti/scores', { recursive: true });
const outFile = `public/libretti/scores/${id}.json`;
// images / credit / link are set by hand per score: keep them across runs
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
writeFileSync(
  outFile,
  JSON.stringify({ ...prev, source: { archive, pdf: pdfUrl }, offset: OFF, pieces: index.map((x) => ({ no: x.no, title: x.title, page: x.page + OFF })), lines: result }),
);
console.log(id, lines.length, 'lines; pages', Math.min(...result), '-', Math.max(...result));
