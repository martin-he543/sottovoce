/**
 * Downloads full libretto texts (act → scene → speaker → lines) and matches them to the repertoire catalogue.
 *
 *   npm run libretti:texts            # uses cached pages (30 days)
 *   TIMETABLE_FRESH=1 npm run libretti:texts
 *   TEXTS_REPARSE=1 npm run libretti:texts   # rebuild every text from the cached pages (after a parser fix)
 *
 * Source: librettidopera.it (Italian-language libretti, one HTML page per act). Writes
 * public/libretti/texts/<wikidata id>.json plus public/libretti/texts/index.json (id → counts). Run
 * `npm run libretti` first so public/libretti/index.json exists to match against.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, cheerio, clean } from '../timetable/lib.mjs';

const BASE = 'https://www.librettidopera.it/';
const OUT = join(ROOT, 'public', 'libretti', 'texts');
const TTL = 30 * 24 * 3600e3;
const SOURCE = 'librettidopera.it';
const CACHE = join(ROOT, 'scripts', 'libretto', '.cache', 'texts');
const GAP = Number(process.env.TEXTS_GAP_MS ?? 2000);
const UA = 'sottovoce-libretti/1.0 (personal research; martin.he@memrise.com)';

let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a page, cached on disk; one request every GAP ms, backing off when the site answers 429/5xx. */
async function fetchText(url, { ttlMs = TTL } = {}) {
  const file = join(CACHE, createHash('sha1').update(url).digest('hex'));
  if (!process.env.TIMETABLE_FRESH) {
    try {
      if (Date.now() - (await stat(file)).mtimeMs < ttlMs) return await readFile(file, 'utf8');
    } catch {}
  }
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Date.now() + wait + GAP;
    if (wait) await sleep(wait);
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) {
      const body = await res.text();
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, body);
      return body;
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 6) throw new Error(`${res?.status ?? 'network error'} for ${url}`);
    const after = Number(res?.headers.get('retry-after')) * 1000 || 0;
    const backoff = Math.max(after, 20000 * 2 ** attempt);
    nextSlot = Date.now() + backoff;
    process.stdout.write(`\n  ${res?.status ?? 'error'} on ${url}; waiting ${Math.round(backoff / 1000)}s\n`);
  }
}

/** One-line progress bar: [████░░░░] 42% 162/387 · saved 98 · skipped 60 · eta 7m. */
function bar(done, total, saved, skipped, startedAt, slug) {
  const width = 24;
  const filled = Math.round((done / total) * width);
  const rate = (Date.now() - startedAt) / Math.max(1, done);
  const eta = Math.round((rate * (total - done)) / 60000);
  const pct = String(Math.round((done / total) * 100)).padStart(3);
  process.stdout.write(
    `\r  [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${pct}% ${done}/${total} · saved ${saved} · skipped ${skipped} · eta ${eta}m  ${slug.slice(0, 22).padEnd(22)}`,
  );
}

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const dropArticle = (s) => s.replace(/^(il|lo|la|le|gli|i|l|the|les|le|un|una|an|a|der|die|das) /, '');
const lastName = (s) => fold(s).split(' ').filter(Boolean).pop() ?? '';

async function listWorks() {
  const html = await fetchText(`${BASE}ope_alfatit.html`, { ttlMs: TTL });
  const $ = cheerio.load(html);
  const works = [];
  $('div.alfa').each((_, el) => {
    const a = $(el).find('span.pt a').first();
    const href = a.attr('href');
    if (!href) return;
    works.push({
      slug: href.replace(/\/.*$/, ''),
      title: clean(a.text()),
      composer: clean($(el).find('span.pm').text()),
      librettist: clean($(el).find('span.pl').text()),
      date: clean($(el).find('span.pe').text()),
      kind: clean(a.attr('title') ?? '').replace(/\.$/, ''),
    });
  });
  return works;
}

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’(-])([a-zàèéìòù])/g, (_, p, c) => p + c.toUpperCase());

/**
 * One act page → { heading, scenes: [{ title, description, lines }] }. A line is [speaker, text, kind]. `voices` collects
 * who sings in each voice part (the page marks a soprano's lines atto_testo_soprano) so unnamed solos can be given to
 * the one character singing that part; such lines carry the part as a fourth element until fetchWork resolves it.
 */
function parseAct(html, voices) {
  const $ = cheerio.load(html);
  const heading = clean($('#ps-dati h2').first().text()) || 'Act';
  const scenes = [];
  let scene = null;
  let who = '';
  let onStage = [];
  const open = (title = '', description = '') => {
    scene = { title, description, lines: [] };
    scenes.push(scene);
  };
  $('table#testo tr').each((_, tr) => {
    const row = $(tr);
    if (row.hasClass('scena')) {
      open(clean(row.find('.scena_tit').text()), clean(row.find('.scena_des').text()));
      onStage = row.find('p.strpre').toArray().map((p) => clean($(p).text())).filter(Boolean);
      who = '';
      return;
    }
    const mini = clean(row.find('td.scena_min, td.scena_max').text());
    if (mini) {
      if (!scene) open();
      scene.lines.push(['', mini, 'dir']);
      return;
    }
    const setVoice = (voice) => {
      const how = clean(voice.find('.atto_indp').text());
      voice.find('.atto_indp').remove();
      const name = clean(voice.text());
      if (name) who = name;
      else if (!who && onStage.length === 1) who = onStage[0].toUpperCase();
      if (how) scene.lines.push(['', how, 'dir']);
    };
    const sing = (ps) =>
      ps.each((_, p) => {
        const text = clean($(p).text());
        if (!text) return;
        if ($(p).hasClass('atto_indt')) return void scene.lines.push(['', text, 'dir']);
        const part = $(p).closest('div[class^="atto_testo_"]').attr('class')?.split(' ')[0].replace('atto_testo_', '');
        if (who && part) voices.set(part, (voices.get(part) ?? new Set()).add(who));
        scene.lines.push(who || !part ? [who, text, 'sung'] : [who, text, 'sung', part]);
      });
    // Ensembles (concertati) set each singer's part side by side in testo_c columns: a name, then that singer's lines.
    const columns = row.children('td.testo_c');
    if (columns.length) {
      if (!scene) open();
      columns.each((_, td) => {
        who = '';
        $(td).children().each((_, el) => {
          const node = $(el);
          if (node.hasClass('atto_voce_c')) setVoice(node);
          else sing(node.is('p') ? node : node.find('p'));
        });
      });
      return;
    }
    // testo_s rows name the singer in their own cell; testo_a rows (arias and other long solos) name them inline, or
    // carry on with whoever sang last, or with the only character on stage (Tonio's prologue in Pagliacci).
    const body = row.find('td.testo_s, td.testo_a');
    if (!body.length) return;
    if (!scene) open();
    setVoice(row.find('td.atto_voce_s, p.atto_voce_a').first());
    sing(body.find('p').not('.atto_voce_a'));
  });
  return { heading, scenes: scenes.filter((s) => s.lines.length) };
}

async function fetchWork(w) {
  const home = await fetchText(`${BASE}${w.slug}/${w.slug}.html`, { ttlMs: TTL });
  const pages = [...new Set([...home.matchAll(/href="(a_\d\d\.html)"/g)].map((m) => m[1]))].sort();
  if (!pages.length) return null;
  const acts = [];
  const voices = new Map();
  for (const p of pages) {
    try {
      const act = parseAct(await fetchText(`${BASE}${w.slug}/${p}`, { ttlMs: TTL }), voices);
      if (act.scenes.length) acts.push(act);
    } catch (e) {
      console.warn(`\n  ${w.slug}/${p}: ${e.message}`);
    }
  }
  if (!acts.length) return null;
  for (const line of acts.flatMap((a) => a.scenes.flatMap((s) => s.lines))) {
    if (line.length < 4) continue;
    const part = line.pop();
    const sole = voices.get(part);
    if (sole?.size === 1 && !/coro|altro/.test(part)) line[0] = [...sole][0];
  }
  const $ = cheerio.load(home);
  const text = $('body').text();
  const form = clean((text.match(/\n\s*((?:Melodramma|Dramma|Opera|Commedia|Farsa|Tragedia|Azione|Intermezzo|Operetta|Cantata|Favola|Scherzo|Burletta|Festa|Serenata|Componimento|Oratorio|Tragicommedia|Pastorale|Tragedia lirica)[^\n]{0,80})/i) ?? [])[1]);
  return { acts, form };
}

async function main() {
  const catalogue = JSON.parse(await readFile(join(ROOT, 'public', 'libretti', 'index.json'), 'utf8')).works;
  const byTitle = new Map();
  for (const c of catalogue) {
    for (const key of new Set([fold(c.title), dropArticle(fold(c.title))])) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(c);
    }
  }

  const works = (await listWorks()).filter((w) => !process.env.ONLY || w.slug === process.env.ONLY);
  console.log(`${works.length} libretti listed`);
  await mkdir(OUT, { recursive: true });

  const index = {};
  const unmatched = [];
  let done = 0;
  let saved = 0;
  let skipped = 0;
  const startedAt = Date.now();
  for (const w of works) {
    done++;
    bar(done - 1, works.length, saved, skipped, startedAt, w.slug);
    const t = titleCase(w.title);
    const cands = byTitle.get(fold(t)) ?? byTitle.get(dropArticle(fold(t))) ?? [];
    const comp = lastName(w.composer);
    const match =
      cands.find((c) => c.composers.some((x) => lastName(x) === comp)) ??
      (cands.length === 1 && !c_composerKnownAndDifferent(cands[0], comp) ? cands[0] : null);
    if (!match && !process.env.INCLUDE_UNMATCHED) {
      unmatched.push(`${t} — ${w.composer}`);
      continue;
    }
    // Works missing from the catalogue get a stand-in id so their text is still kept.
    const id = match?.id ?? `libretti-${w.slug}`;
    const file = join(OUT, `${id}.json`);
    if (!process.env.TIMETABLE_FRESH && !process.env.TEXTS_REPARSE) {
      try {
        const have = JSON.parse(await readFile(file, 'utf8'));
        index[id] = summarise(have.acts, have.language ?? 'Italian', match ? {} : { title: have.title, composer: have.composer });
        skipped++;
        continue;
      } catch {}
    }
    let got;
    try {
      got = await fetchWork(w);
    } catch (e) {
      console.warn(`\n  ${w.slug}: ${e.message}`);
      continue;
    }
    if (!got) continue;
    const doc = {
      id,
      title: match?.title ?? t,
      ...(match ? {} : { composer: w.composer }),
      language: 'Italian',
      form: got.form || w.kind || null,
      source: SOURCE,
      source_url: `${BASE}${w.slug}/${w.slug}.html`,
      acts: got.acts,
    };
    await writeFile(file, JSON.stringify(doc));
    saved++;
    index[id] = summarise(got.acts, doc.language, match ? {} : { title: t, composer: w.composer });
  }
  bar(works.length, works.length, saved, skipped, startedAt, 'done');
  process.stdout.write('\n');
  await writeFile(
    join(OUT, 'index.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      count: Object.keys(index).length,
      sources: { [SOURCE]: BASE },
      works: index,
    }),
  );
  console.log(`Saved ${saved} new, skipped ${skipped} already downloaded; ${unmatched.length} not matched to the catalogue`);
  await writeFile(join(OUT, 'unmatched.txt'), unmatched.join('\n') + '\n');
}

function summarise(acts, language, extra = {}) {
  const lines = acts.reduce((n, a) => n + a.scenes.reduce((m, s) => m + s.lines.length, 0), 0);
  return { acts: acts.length, scenes: acts.reduce((n, a) => n + a.scenes.length, 0), lines, language, source: SOURCE, ...extra };
}

function c_composerKnownAndDifferent(c, comp) {
  return c.composers.length > 0 && !c.composers.some((x) => lastName(x) === comp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
