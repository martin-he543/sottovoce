/**
 * Has Argon (gemini-4-argon) read the lyrics off every page of a scanned vocal score, one page per call.
 * Answers are cached per page, so the run is resumable.
 *
 *   node scripts/libretto/scores-pages.mjs <pdf> <cache dir> <first pdf page> <last pdf page>
 *
 * Pages are rendered with pdftoppm. Output: <cache dir>/p<pdf page>.json = { no?: piece number that begins on the page,
 * printed?: printed page number, lyrics: [sung lines in reading order, syllable hyphens joined] }.
 */
import { GoogleGenAI } from '@google/genai';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [pdf, dir, first, last] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const PROMPT = `This is one page of an opera vocal score. Return JSON {"no": number|null, "printed": number|null, "lyrics": string[]}.
"no": the piece number if a heading like "N° 7. Duet" starts on this page, else null. "printed": the page number printed in the corner.
"lyrics": the sung text of the ORIGINAL language (not the English translation printed beneath it), one string per staff line in reading order, with the hyphens that split syllables joined back into whole words. Skip stage directions, tempo marks and the piano part. [] if the page has no sung text.`;

// DIALOGUE=1: read the spoken text printed between the numbers (German column) instead of the sung lyrics.
const DIALOGUE = !!process.env.DIALOGUE;
const DIALOGUE_PROMPT = `This is one page of an opera vocal score. Return JSON {"lyrics": string[]}.
"lyrics": only the SPOKEN DIALOGUE printed as text on this page, in the ORIGINAL language (not the English translation printed beside it), one string per printed line in reading order, without the speaker names. [] if the page has no spoken text.`;

async function page(n) {
  const out = `${dir}/p${n}${DIALOGUE ? '.d' : ''}.json`;
  if (existsSync(out)) return;
  const stem = `${dir}/img${n}`;
  if (existsSync(`${stem}.jpg`)) { /* rendered by an earlier pass */ } else
  execFileSync('pdftoppm', ['-f', n, '-l', n, '-r', '110', '-jpeg', '-singlefile', pdf, stem]);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-4-argon',
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: readFileSync(`${stem}.jpg`).toString('base64') } }, { text: DIALOGUE ? DIALOGUE_PROMPT : PROMPT }] }],
        config: { responseMimeType: 'application/json' },
      });
      writeFileSync(out, JSON.stringify(JSON.parse(r.text)));
      return;
    } catch (e) {
      if (attempt === 3) { console.warn(`p${n}: ${e.message}`); return; }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const todo = [];
for (let n = Number(first); n <= Number(last); n++) todo.push(n);
let done = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (todo.length) {
      await page(todo.shift());
      if (++done % 25 === 0) console.log(done);
    }
  }),
);
