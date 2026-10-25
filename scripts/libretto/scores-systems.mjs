/**
 * Finds the staff systems on the pages of a scanned vocal score, then sets each sung line on its system.
 *
 *   node scripts/libretto/scores-systems.mjs <work id> <pages dir> <pdf>
 *
 * <pages dir> is the one scores-pages.mjs filled. Run after scores-align.mjs. Argon (gemini-4-argon) is asked once per page
 * for the vertical extent of every system (the voice staff, its lyrics and the piano beneath) with the words sung in it;
 * answers are cached as <pages dir>/s<pdf page>.json, so the run is resumable. Each line is then fitted to a system on its
 * page by a monotone best fit of shared words. Adds to public/libretti/scores/<id>.json:
 *   ratio: page height / width, boxes: [[top, bottom] as fractions of the page height, or null] for each sung line.
 */
import { GoogleGenAI } from '@google/genai';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [id, dir, pdf] = process.argv.slice(2);
const file = `public/libretti/scores/${id}.json`;
const score = JSON.parse(readFileSync(file, 'utf8'));
const text = JSON.parse(readFileSync(`public/libretti/texts/${id}.json`, 'utf8'));
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const PROMPT = `This is one page of an opera vocal score. List every system on it, top to bottom. A system is one block of staves read together: the voice staff(s) with their lyrics and the piano staves beneath, until the next such block starts.
Return JSON {"systems": [{"top": number, "bottom": number, "lyrics": string}]}. "top" and "bottom" are the system's vertical extent from 0 (top of the page) to 1000 (bottom), tight to the staves with no heading or page number. "lyrics": the words sung in that system in the ORIGINAL language (not the English translation printed beneath), syllable hyphens joined into whole words; "" if instrumental. [] if the page has no music.`;

async function systems(n) {
  const out = `${dir}/s${n}.json`;
  if (existsSync(out)) return JSON.parse(readFileSync(out, 'utf8'));
  const stem = `${dir}/img${n}`;
  if (!existsSync(`${stem}.jpg`)) execFileSync('pdftoppm', ['-f', n, '-l', n, '-r', '110', '-jpeg', '-singlefile', pdf, stem]);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-4-argon',
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: readFileSync(`${stem}.jpg`).toString('base64') } }, { text: PROMPT }] }],
        config: { responseMimeType: 'application/json' },
      });
      const s = JSON.parse(r.text).systems ?? [];
      writeFileSync(out, JSON.stringify(s));
      return s;
    } catch (e) {
      if (attempt === 3) { console.warn(`p${n}: ${e.message}`); return null; }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const tokens = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{3,}/g) ?? [];
const lines = [];
for (const act of text.acts) for (const sc of act.scenes) for (const [, t, kind] of sc.lines) if (kind !== 'dir') lines.push(new Set(tokens(t)));

const pages = [...new Set(score.lines)].sort((a, b) => a - b);
const found = new Map();
const todo = pages.slice();
let done = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (todo.length) {
      const p = todo.shift();
      found.set(p, await systems(p));
      if (++done % 25 === 0) console.log(done, '/', pages.length);
    }
  }),
);

const boxes = new Array(lines.length).fill(null);
for (const p of pages) {
  const sys = (found.get(p) ?? []).filter((s) => s.bottom > s.top).map((s) => ({ ...s, toks: new Set(tokens(s.lyrics ?? '')) }));
  const idxs = score.lines.flatMap((q, i) => (q === p ? [i] : []));
  if (!sys.length) continue;
  // best[a][b]: line a on system b, systems never going backwards (a system may carry several lines)
  const fit = idxs.map((i, a) =>
    sys.map((s, b) => {
      const l = lines[i];
      if (!l.size) return 0;
      let hit = 0;
      for (const w of l) if (s.toks.has(w)) hit++;
      return hit / l.size - 0.02 * Math.abs(a / idxs.length - b / sys.length);
    }),
  );
  const best = fit.map((r) => r.slice());
  const from = fit.map((r) => r.map(() => 0));
  for (let a = 1; a < idxs.length; a++) {
    let m = -Infinity, mb = 0;
    for (let b = 0; b < sys.length; b++) {
      if (best[a - 1][b] > m) { m = best[a - 1][b]; mb = b; }
      best[a][b] += m; from[a][b] = mb;
    }
  }
  let b = best[idxs.length - 1].reduce((bi, v, k, arr) => (v > arr[bi] ? k : bi), 0);
  for (let a = idxs.length - 1; a >= 0; a--) {
    const s = sys[b];
    boxes[idxs[a]] = [Math.max(0, s.top - 10) / 1000, Math.min(1000, s.bottom + 10) / 1000];
    b = from[a][b];
  }
}

// every page is the same shape
const [w, h] = execFileSync('pdfinfo', ['-f', pages[0], '-l', pages[0], pdf]).toString().match(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/).slice(1).map(Number);
writeFileSync(file, JSON.stringify({ ...score, ratio: Math.round((h / w) * 1000) / 1000, boxes }));
console.log(id, boxes.filter(Boolean).length, '/', lines.length, 'lines boxed');
