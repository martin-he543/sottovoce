/**
 * Turns the libretti scraped from opera-guide.ch and operafolio.com (`npm run libretti:scrape`) into full texts in
 * public/libretti/texts, next to the librettidopera.it ones, so the reader and the Immerse lists pick them up.
 * librettidopera.it texts are left alone; for the rest every version on both sites is weighed and the fullest kept, in
 * the language it is sung in where that version is whole (otherwise an English translation, which needs no
 * translating). A text that changes loses its machine translations, so translate.py redoes it. Adds to
 * texts/index.json instead of replacing it.
 *
 *   node scripts/libretto/import-scraped.mjs
 */
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../timetable/lib.mjs';

const LIB = join(ROOT, 'public', 'libretti');
const TEXTS = join(LIB, 'texts');
const NAMES = { de: 'German', en: 'English', fr: 'French', it: 'Italian', la: 'Latin' };
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));

// Sung language by composer, for works the catalogue does not give one for.
const SUNG = [
  [/handel|haendel|h[aä]ndel|rossini|verdi|puccini|donizetti|bellini|mozart|cilea|giordano|monteverdi|vivaldi|scarlatti/i, 'it'],
  [/berlioz|offenbach|auber|gounod|saint-sa|adam|bizet|massenet|gluck|spontini|meyerbeer|halévy|delibes|thomas/i, 'fr'],
  [/wagner|strauss|weber|flotow|beethoven|lortzing|nicolai|humperdinck/i, 'de'],
];
const STOP = {
  it: 'che di il la non per un una con sei sono mio mia tu io del dei della le ti si ma',
  fr: 'que de le la les des un une est je tu il nous vous mon ma pas pour dans qui et ne',
  de: 'der die das und ich nicht ein eine ist du mit zu den sie wir auf dem mein es von',
  en: 'the and of to a in is you my i that for with not me be your he she we it his her',
};
const detect = (acts) => {
  const words = acts.flatMap((a) => a.scenes.flatMap((s) => s.lines.slice(0, 40).map((l) => l[1]))).join(' ').toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const score = Object.entries(STOP).map(([k, v]) => [k, words.filter((w) => v.split(' ').includes(w)).length]);
  return score.sort((a, b) => b[1] - a[1])[0][0];
};

// operafolio names the catalogue's La Cenerentola "Cinderella"; its text is the fuller one, so opera-guide's is dropped.
const ALIAS = { Cinderella: 'Q176700' };
const DROP = new Set(['la+cenerentola+ossia+la+bonta+in+trionfo']);

const catalogue = new Map((await json(join(LIB, 'index.json'))).works.map((w) => [w.id, w]));
const index = await json(join(TEXTS, 'index.json'));
const have = new Set(Object.keys(index.works));
const taken = new Set((await readdir(TEXTS)).map((f) => f.replace(/\.json$/, '')));

// The scraped sites often lack a catalogue id: match by title and composer surname instead.
const fold = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normTitle = (t) => fold(t).replace(/\/.*$/, '').replace(/\b(ossia|ou|oder)\b.*$/, '').replace(/^(the|il|lo|la|le|les|l|der|die|das|un|una|una|an|a)\s+/, '').replace(/[^a-z0-9]+/g, '');
const surname = (c) => fold(c).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').split(/[\s,]+/).filter(Boolean).pop()?.replace(/^.*['’]/, '') ?? '';
const byTitle = new Map();
for (const w of catalogue.values()) byTitle.set(normTitle(w.title), [...(byTitle.get(normTitle(w.title)) ?? []), w]);
const findCatalogue = (title, composer) => {
  const sn = surname(composer);
  const hit = (byTitle.get(normTitle(title)) ?? []).find((w) => w.composers?.some((c) => surname(c) === sn));
  return hit?.id ?? null;
};

const countLines = (acts) => acts.reduce((n, a) => n + a.scenes.reduce((m, s) => m + s.lines.length, 0), 0);
const clean = (acts) =>
  acts
    .map((a) => ({ heading: a.heading, scenes: a.scenes.map((s) => ({ title: s.title, description: s.description ?? '', lines: s.lines.filter((l) => l[1]?.trim()) })).filter((s) => s.lines.length) }))
    .filter((a) => a.scenes.length);
// How much of the opera a version holds: characters of sung text, halved for pages with broken encoding.
const size = (acts) => {
  const sung = acts.flatMap((a) => a.scenes.flatMap((s) => s.lines.filter((l) => l[2] !== 'dir').map((l) => l[1]))).join('\n');
  return /ï¿½|�/.test(sung) ? sung.length / 2 : sung.length;
};

async function add(entry, acts, lang, meta) {
  const cleaned = clean(acts);
  if (countLines(cleaned) < 50) return false;
  const matched = (entry.catalogue_id && catalogue.has(entry.catalogue_id) ? entry.catalogue_id : null) ?? findCatalogue(entry.title, entry.composer);
  let id = matched ?? `libretti-${entry.slug.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  if (have.has(id) || (!matched && taken.has(id) && !replaceable.has(id))) return false;
  const doc = { id, title: entry.title, ...(matched ? {} : { composer: entry.composer }), language: NAMES[lang] ?? 'Italian', form: null, source: meta.source, source_url: meta.url, acts: cleaned };
  const file = join(TEXTS, `${id}.json`);
  const before = await readFile(file, 'utf8').catch(() => null);
  if (before !== JSON.stringify(doc)) {
    await writeFile(file, JSON.stringify(doc));
    // The machine translations follow the old text line by line: drop them so translate.py redoes this work.
    await rm(join(LIB, 'translations', `${id}.json`), { force: true });
    await rm(join(LIB, 'translations', 'scenes', `${id}.json`), { force: true });
    if (before) replaced.push(`${id} ${entry.title}: ${index.works[id]?.lines ?? '?'} → ${countLines(cleaned)} lines (${doc.language}, ${meta.source})`);
  }
  have.add(id);
  index.works[id] = {
    acts: cleaned.length,
    scenes: cleaned.reduce((n, a) => n + a.scenes.length, 0),
    lines: countLines(cleaned),
    language: doc.language,
    source: meta.source,
    ...(matched ? {} : { title: entry.title, composer: entry.composer }),
  };
  return true;
}

// Texts imported earlier under a `libretti-` id that the catalogue now matches: move them to that id, or drop them when
// the catalogue work already has a text.
for (const [id, w] of Object.entries(index.works)) {
  if (!id.startsWith('libretti-') || w.source === 'librettidopera.it' || !w.title) continue;
  const cid = findCatalogue(w.title, w.composer);
  if (!cid) continue;
  const doc = await json(join(TEXTS, `${id}.json`));
  delete index.works[id];
  have.delete(id);
  await rm(join(TEXTS, `${id}.json`));
  if (have.has(cid)) {
    await rm(join(LIB, 'translations', `${id}.json`), { force: true });
    continue;
  }
  const { title, composer, ...rest } = w;
  index.works[cid] = rest;
  have.add(cid);
  await writeFile(join(TEXTS, `${cid}.json`), JSON.stringify({ ...doc, id: cid, composer: undefined }));
  await rename(join(LIB, 'translations', `${id}.json`), join(LIB, 'translations', `${cid}.json`)).catch(() => {});
}

// Every version of every opera on both sites, grouped by the work it is. Texts from librettidopera.it stay; the scraped
// ones are chosen afresh, since a site's copy in one language can be cut short (opera-guide.ch's French Carmen stops in
// Act 1) where another language or the other site has the whole opera.
// Read from the files, since `npm run libretti:texts` rewrites the index with its own texts only.
const replaceable = new Set();
for (const f of await readdir(TEXTS)) {
  const id = f.replace(/\.json$/, '');
  if (id === 'index' || id.includes('.')) continue;
  if ((await json(join(TEXTS, `${id}.json`))).source !== 'librettidopera.it') replaceable.add(id);
}
for (const id of replaceable) have.delete(id);
const replaced = [];

const groups = new Map();
const offer = (op, acts, lang, meta) => {
  const cid = op.catalogue_id && catalogue.has(op.catalogue_id) ? op.catalogue_id : findCatalogue(op.title, op.composer);
  const key = cid ?? `${meta.source}:${op.slug}`;
  if (have.has(cid)) return;
  groups.set(key, [...(groups.get(key) ?? []), { op, acts, lang, meta, size: size(acts) }]);
};
for (const f of await readdir(join(LIB, 'opera-guide'))) {
  if (f === 'index.json') continue;
  const op = await json(join(LIB, 'opera-guide', f));
  if (DROP.has(op.slug)) continue;
  for (const [lang, lib] of Object.entries(op.librettos ?? {})) offer(op, lib.acts, lang, { source: 'opera-guide.ch', url: lib.source_url });
}
for (const f of await readdir(join(LIB, 'operafolio'))) {
  if (f === 'index.json') continue;
  const op = await json(join(LIB, 'operafolio', f));
  op.catalogue_id ??= ALIAS[op.slug];
  if (op.libretto?.acts?.length) offer(op, op.libretto.acts, detect(op.libretto.acts), { source: 'operafolio.com', url: op.libretto.source_url });
}

// The sung language when a version of it holds the whole opera, otherwise the fullest version (English first). A
// version counts as whole when it is near the longest one in its own language and not far behind any translation
// (Italian runs to about half the characters of a German translation).
const pick = (key, options) => {
  const max = Math.max(...options.map((o) => o.size));
  const best = (list) => list.sort((a, b) => b.size - a.size)[0];
  const { op } = options[0];
  const catLangs = (catalogue.get(key)?.languages ?? []).map((l) => l.toLowerCase());
  const byComposer = SUNG.find(([re]) => re.test(op.composer ?? ''))?.[1];
  const sung = options.find((o) => catLangs.some((l) => l.includes(NAMES[o.lang]?.toLowerCase())))?.lang ?? (catLangs.length ? null : byComposer);
  const own = best(options.filter((o) => o.lang === sung));
  if (own && own.size >= 0.4 * max) return own;
  const en = best(options.filter((o) => o.lang === 'en'));
  return en && en.size >= 0.75 * max ? en : best(options);
};

let added = 0;
for (const [key, options] of groups) {
  const o = pick(key, options);
  if (await add(o.op, o.acts, o.lang, o.meta)) added++;
}
index.count = Object.keys(index.works).length;
index.generated_at = new Date().toISOString();
index.sources = { ...index.sources, 'opera-guide.ch': 'https://opera-guide.ch/', 'operafolio.com': 'http://www.operafolio.com/' };
await writeFile(join(TEXTS, 'index.json'), JSON.stringify(index));
for (const r of replaced) console.log(`replaced ${r}`);
console.log(`wrote ${added} libretti (${replaced.length} replaced); ${index.count} in the index`);
