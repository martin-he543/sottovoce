/**
 * Adds public-domain sheet music from IMSLP to a work's details shard, under `scores`.
 * Nothing is downloaded: the app links to each scan's IMSLP file page.
 *
 *   node scripts/libretto/scores.mjs            # the works listed in PAGES below
 *   node scripts/libretto/scores.mjs Q185968    # one of them
 *
 * Only complete vocal and full scores are kept (the editions a listener follows along with), and only Public Domain ones.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const API = 'https://imslp.org/api.php';
const UA = 'sottovoce/1.0 (martin.he@memrise.com)';
const DETAILS = 'public/libretti/details';

/** Wikidata id -> IMSLP page title. */
const PAGES = {
  Q185968: 'Carmen (Bizet, Georges)',
  Q5064: 'Die Zauberflöte, K.620 (Mozart, Wolfgang Amadeus)',
};

const KINDS = { 'Vocal Scores': 'vocal', 'Full Scores': 'full' };

const clean = (s = '') =>
  s
    .replace(/\{\{(?:LinkEd|LinkTr|LinkArr)\|([^|}]*)\|([^|}]*)[^}]*\}\}/g, '$1 $2')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function wikitext(title) {
  const u = new URL(API);
  Object.entries({ action: 'parse', page: title, prop: 'wikitext', format: 'json' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${title}: ${r.status}`);
  return (await r.json()).parse.wikitext['*'];
}

export function parseScores(wt, page) {
  const out = [];
  let kind = null;
  let sub = '';
  for (const block of wt.split(/\n(?====)/)) {
    const h = block.match(/^(=+)\s*(.*?)\s*\1/);
    if (h && h[1].length === 3) kind = KINDS[h[2]] ?? null;
    if (h && h[1].length === 4) sub = h[2];
    if (!kind || !(h && h[1].length === 4 && sub === 'Complete')) continue;
    for (const m of block.matchAll(/\{\{#fte:imslpfile\n([\s\S]*?)\n\}\}/g)) {
      const f = Object.fromEntries([...m[1].matchAll(/^\|([^=]+)=(.*)$/gm)].map((x) => [x[1].trim(), x[2].trim()]));
      const file = f['File Name 1'];
      if (!file || !/pdf$/i.test(file) || f.Copyright !== 'Public Domain') continue;
      const pub = (f['Publisher Information'] ?? '').match(/\{\{[Pp]\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)/);
      out.push({
        kind,
        file,
        desc: clean(f['File Description 1']),
        publisher: pub ? clean(pub[2] || pub[1]) : '',
        place: pub ? clean(pub[3]) : '',
        year: pub ? Number(pub[5].match(/\d{4}/)?.[0]) || undefined : undefined,
        lang: clean(f.Language),
        editor: clean(f.Editor),
        translator: clean(f.Translator),
        arranger: clean(f.Arranger),
        note: clean(f['Misc. Notes']).slice(0, 240),
        page: `https://imslp.org/wiki/File:${encodeURIComponent(file)}`,
      });
    }
  }
  return { imslp: `https://imslp.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`, files: out };
}

const only = process.argv[2];
for (const [id, page] of Object.entries(PAGES)) {
  if (only && only !== id) continue;
  const scores = parseScores(await wikitext(page), page);
  const shard = readdirSync(DETAILS).find((f) => JSON.parse(readFileSync(`${DETAILS}/${f}`, 'utf8'))[id]);
  if (!shard) { console.warn(`${id}: no details shard`); continue; }
  const path = `${DETAILS}/${shard}`;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data[id].scores = scores;
  writeFileSync(path, JSON.stringify(data));
  console.log(id, shard, scores.files.length, 'scores');
}
