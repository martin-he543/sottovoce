/**
 * Builds the offline Libretto repertoire catalogue (operas, operettas, musicals) from Wikidata + English Wikipedia.
 *
 *   npm run libretti            # uses cached responses (30 days)
 *   TIMETABLE_FRESH=1 npm run libretti
 *
 * Writes public/libretti/index.json (searchable metadata), public/libretti/details/NN.json (synopsis, roles,
 * numbers; sharded by Wikidata id) and docs/REPERTOIRE.md (the full list). Text is CC BY-SA from Wikipedia.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, fetchJson } from '../timetable/lib.mjs';
import { listItems, parseTable, proseOnly, sectionTree, splitSections, toPlain } from './wikitext.mjs';

const UA = { 'user-agent': 'sottovoce-libretti/1.0 (https://github.com/; martin.he@memrise.com) node-fetch' };
const TTL = 30 * 24 * 3600e3;
const OUT_DIR = join(ROOT, 'public', 'libretti');
const SHARDS = 64;

/** Wikidata "form of creative work" (P7937) values we treat as stage works, most specific first. */
const FORMS = [
  ['Q253137', 'rock opera', 'musical'],
  ['Q643684', 'jukebox musical', 'musical'],
  ['Q2743', 'musical', 'musical'],
  ['Q170384', 'operetta', 'operetta'],
  ['Q148163', 'zarzuela', 'operetta'],
  ['Q785479', 'opéra comique', 'opera'],
  ['Q208080', 'opera buffa', 'opera'],
  ['Q210675', 'opera seria', 'opera'],
  ['Q915591', 'chamber opera', 'opera'],
  ['Q1344', 'opera', 'opera'],
];

const WORKS_WHERE = `
  VALUES ?f { ${FORMS.map(([q]) => `wd:${q}`).join(' ')} }
  ?w wdt:P7937 ?f .
  ?article schema:about ?w ; schema:isPartOf <https://en.wikipedia.org/> .`;

/** The base query (one row per work+form); each property is fetched separately to stay under the 60s limit. */
const BASE_SPARQL = `SELECT ?w ?article ?links ?f ?wLabel WHERE { ${WORKS_WHERE}
  ?w wikibase:sitelinks ?links .
  OPTIONAL { ?w rdfs:label ?wLabel . FILTER(LANG(?wLabel) = "en") } }`;

/** Wikidata property → our field; `label` resolves item values to English labels. */
const PROPS = [
  ['composers', 'P86', true],
  ['librettists', 'P87', true],
  ['lyricists', 'P676', true],
  ['premiere_date', 'P1191', false],
  ['premiere_venue', 'P4647', true],
  ['languages', 'P364', true],
  ['languages', 'P407', true],
  ['based_on', 'P144', true],
];
const propSparql = (pid, label) =>
  label
    ? `SELECT DISTINCT ?w ?v WHERE { ${WORKS_WHERE} ?w wdt:${pid} ?x . ?x rdfs:label ?v . FILTER(LANG(?v) = "en") }`
    : `SELECT DISTINCT ?w ?v WHERE { ${WORKS_WHERE} ?w wdt:${pid} ?v . }`;

const val = (b, k) => b[k]?.value ?? '';
const qid = (uri) => uri.split('/').pop();

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { headers: { ...UA, accept: 'application/sparql-results+json' }, ttlMs: TTL, timeoutMs: 120e3 });
  return data.results.bindings;
}

async function fetchWikidata() {
  const works = new Map();
  for (const b of await sparql(BASE_SPARQL)) {
    const id = qid(val(b, 'w'));
    const w = works.get(id) ?? {
      id,
      title: val(b, 'wLabel'),
      wikipedia_url: val(b, 'article'),
      wiki_title: decodeURIComponent(val(b, 'article').split('/wiki/')[1]).replace(/_/g, ' '),
      forms: new Set(),
      popularity: Number(val(b, 'links')) || 0,
      composers: [], librettists: [], lyricists: [], premiere_date: [], premiere_venue: [], languages: [], based_on: [],
    };
    w.forms.add(qid(val(b, 'f')));
    works.set(id, w);
  }
  for (const [field, pid, label] of PROPS) {
    const rows = await sparql(propSparql(pid, label));
    for (const b of rows) {
      const w = works.get(qid(val(b, 'w')));
      const v = val(b, 'v').trim();
      if (w && v && !w[field].includes(v)) w[field].push(v);
    }
    console.log(`  ${pid} ${field}: ${rows.length} values`);
  }
  return [...works.values()].map((w) => {
    const form = FORMS.find(([q]) => w.forms.has(q)) ?? FORMS.at(-1);
    const { forms, ...rest } = w;
    return {
      ...rest,
      genre: form[1],
      kind: form[2],
      premiere_date: w.premiere_date.sort()[0]?.slice(0, 10) ?? null,
      premiere_venue: w.premiere_venue[0] ?? null,
      languages: w.languages.map((l) => l.replace(/ language$/, '')),
    };
  });
}

async function fetchWikitext(titles) {
  const out = new Map();
  const queue = [...new Set(titles)];
  for (let i = 0; i < queue.length; i += 50) {
    const batch = queue.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1',
      format: 'json', formatversion: '2', maxlag: '5', titles: batch.join('|'),
    });
    const data = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`, { headers: UA, ttlMs: TTL });
    const alias = new Map();
    for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(r.to, r.from);
    const resolve = (t) => { while (alias.has(t)) t = alias.get(t); return t; };
    for (const p of data.query?.pages ?? []) {
      const content = p.revisions?.[0]?.slots?.main?.content;
      if (content) out.set(resolve(p.title), content);
    }
    process.stdout.write(`\r  wikitext ${Math.min(i + 50, queue.length)}/${queue.length}`);
  }
  process.stdout.write('\n');
  return out;
}

/** Named arguments of the first {{Infobox …}} template. */
function infobox(wt) {
  const start = wt.search(/\{\{\s*Infobox/i);
  if (start < 0) return {};
  let depth = 0;
  let j = start;
  for (; j < wt.length - 1; j++) {
    if (wt[j] === '{' && wt[j + 1] === '{') { depth++; j++; }
    else if (wt[j] === '}' && wt[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
  }
  const inner = wt.slice(start + 2, j - 1).replace(/<!--[\s\S]*?-->/g, '\n');
  const fields = {};
  for (const m of inner.matchAll(/\n\s*\|\s*([\w ]+?)\s*=([\s\S]*?)(?=\n\s*\|\s*[\w ]+?\s*=|$)/g)) {
    fields[m[1].toLowerCase().replace(/ /g, '_')] = toPlain(m[2]).replace(/\n+/g, ', ').trim();
  }
  return fields;
}

const SYNOPSIS = /^(synopsis|plot|story|plot summary|plot synopsis|summary|scenario|libretto and synopsis|plot and synopsis)$/i;
const ROLES = /^(roles|roles and premiere cast|roles and premiere casts|characters|principal roles|cast|original cast|characters and original cast|roles and original cast)$/i;
const NUMBERS = /^(musical numbers|songs|song list|list of songs|list of musical numbers|numbers|musical numbers and songs|arias|noted arias|principal arias|famous arias|list of numbers|list of arias|arias and numbers|musical numbers \(original production\)|structure|the music|songs and musical numbers|score)$/i;

const VOICE_IN_PARENS = /^(.+?)\s*\(([^()]*\b(?:soprano|mezzo|contralto|alto|tenor|baritone|bass|countertenor|treble|spoken|silent|dancer)\b[^()]*)\)\s*$/i;

function cap(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return (stop > n * 0.6 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…');
}

function firstSentences(text, max = 320) {
  const para = text.split('\n').find((l) => l.length > 40) ?? text;
  return cap(para, max);
}

function parseArticle(wt) {
  const { lead, sections } = splitSections(wt);
  const box = infobox(lead);
  const leadText = proseOnly(lead);

  const syn = sectionTree(sections, (h) => SYNOPSIS.test(h));
  let synopsis = [];
  if (syn) {
    let budget = 12000;
    for (const s of syn) {
      const text = proseOnly(s.body);
      if (!text || budget <= 0) continue;
      const clipped = cap(text, budget);
      budget -= clipped.length;
      synopsis.push({ heading: s === syn[0] ? null : s.heading, text: clipped });
    }
  }

  const roles = [];
  const rolesSec = sectionTree(sections, (h) => ROLES.test(h));
  if (rolesSec) {
    const rows = parseTable(rolesSec.map((s) => s.body).join('\n'));
    for (const r of rows) {
      if (r.header) continue;
      const [name, voice, cast] = r.cells.map((c) => c.text);
      if (!name || /^(conductor|chorus|role|roles)\b/i.test(name)) continue;
      roles.push({ name: cap(name, 140), voice: voice ? cap(voice, 80) : null, premiere_cast: cast ? cap(cast, 120) : null });
      if (roles.length >= 40) break;
    }
    if (!roles.length) {
      for (const item of listItems(rolesSec.map((s) => s.body).join('\n')).slice(0, 40)) {
        const paren = item.match(VOICE_IN_PARENS);
        if (paren) {
          roles.push({ name: cap(paren[1], 140), voice: cap(paren[2], 80), premiere_cast: null });
          continue;
        }
        const [name, ...rest] = item.split(/\s+[–—-]\s+|,\s+(?=(?:a |an |the )?(?:soprano|mezzo|contralto|alto|tenor|baritone|bass|countertenor|treble|spoken))/i);
        roles.push({ name: cap(name, 140), voice: rest.length ? cap(rest.join(', '), 80) : null, premiere_cast: null });
      }
    }
  }

  let numbers = [];
  const numSec = sectionTree(sections, (h) => NUMBERS.test(h));
  if (numSec) {
    for (const s of numSec) {
      const items = listItems(s.body).map((x) => cap(x, 160));
      if (!items.length) continue;
      numbers.push({ heading: s === numSec[0] ? null : s.heading, items });
    }
    const count = numbers.reduce((n, g) => n + g.items.length, 0);
    if (count > 150) numbers = numbers.slice(0, 8);
  }

  return {
    lead: cap(leadText, 2500),
    synopsis,
    roles,
    numbers,
    infobox: {
      composer: box.composer || box.music || null,
      librettist: box.librettist || box.lyrics || box.book || null,
      book: box.book || null,
      lyrics: box.lyrics || null,
      premiere_date: box.premiere_date || box.premiere || null,
      premiere_location: box.premiere_location || box.place || null,
      productions: box.productions || null,
      awards: box.awards || null,
      basis: box.basis || box.based_on || null,
    },
  };
}

const yearOf = (s) => {
  const m = String(s ?? '').match(/\b(1[5-9]\d\d|20[0-2]\d)\b/);
  return m ? Number(m[1]) : null;
};

async function main() {
  console.log('Wikidata: querying stage works…');
  const works = await fetchWikidata();
  console.log(`  ${works.length} works with English Wikipedia articles`);

  const wikitext = await fetchWikitext(works.map((w) => w.wiki_title));
  console.log(`  ${wikitext.size} articles fetched`);

  const index = [];
  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const w of works) {
    const wt = wikitext.get(w.wiki_title);
    if (!wt || /^#REDIRECT/i.test(wt)) continue;
    const a = parseArticle(wt);
    const composers = w.composers.length ? w.composers : a.infobox.composer ? [a.infobox.composer] : [];
    const librettists = w.librettists.length ? w.librettists : a.infobox.librettist ? [a.infobox.librettist] : [];
    const year = yearOf(w.premiere_date) ?? yearOf(a.infobox.premiere_date) ?? yearOf(a.infobox.productions);
    const entry = {
      id: w.id,
      title: w.title || w.wiki_title.replace(/ \(.*\)$/, ''),
      kind: w.kind,
      genre: w.genre,
      composers,
      librettists,
      lyricists: w.lyricists,
      year,
      premiere_venue: w.premiere_venue ?? (a.infobox.premiere_location ? cap(a.infobox.premiere_location, 120) : null),
      languages: w.languages,
      based_on: w.based_on.length ? w.based_on : a.infobox.basis ? [cap(a.infobox.basis, 120)] : [],
      popularity: w.popularity,
      summary: firstSentences(a.lead),
      has_synopsis: a.synopsis.length > 0,
      roles_count: a.roles.length,
      wikipedia_url: w.wikipedia_url,
    };
    index.push(entry);
    shards[Number(w.id.slice(1)) % SHARDS][w.id] = {
      lead: a.lead,
      synopsis: a.synopsis,
      roles: a.roles,
      numbers: a.numbers,
      // Wikidata stores year-only premieres as 1 January; the infobox usually has the real day.
      premiere_date: w.premiere_date?.endsWith('-01-01')
        ? a.infobox.premiere_date || w.premiere_date.slice(0, 4)
        : w.premiere_date ?? a.infobox.premiere_date,
      book: a.infobox.book,
      lyrics: a.infobox.lyrics,
      productions: a.infobox.productions,
      awards: a.infobox.awards,
    };
  }
  index.sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title));

  await rm(join(OUT_DIR, 'details'), { recursive: true, force: true });
  await mkdir(join(OUT_DIR, 'details'), { recursive: true });
  const meta = {
    generated_at: new Date().toISOString(),
    count: index.length,
    shards: SHARDS,
    source: 'Wikidata (CC0) and English Wikipedia (CC BY-SA 4.0)',
    license_note: 'Synopses, roles and numbers are adapted from English Wikipedia articles under CC BY-SA 4.0; see each work’s wikipedia_url.',
  };
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify({ ...meta, works: index }));
  for (let i = 0; i < SHARDS; i++) {
    await writeFile(join(OUT_DIR, 'details', `${String(i).padStart(2, '0')}.json`), JSON.stringify(shards[i]));
  }
  await writeFile(join(ROOT, 'docs', 'REPERTOIRE.md'), renderMarkdown(index, meta));

  const by = (k) => index.reduce((m, w) => ((m[w[k]] = (m[w[k]] ?? 0) + 1), m), {});
  console.log(`Wrote ${index.length} works`, by('kind'));
  console.log(`  with synopsis: ${index.filter((w) => w.has_synopsis).length}, with roles: ${index.filter((w) => w.roles_count).length}`);
}

function renderMarkdown(index, meta) {
  const esc = (s) => String(s).replace(/([\\`*_[\]|<>])/g, '\\$1');
  const KINDS = [['opera', 'Operas'], ['operetta', 'Operettas & Zarzuelas'], ['musical', 'Musicals']];
  const lines = [
    '# Sotto Voce Repertoire Catalogue',
    '',
    `Offline reference list of **${index.length.toLocaleString('en-GB')}** stage works bundled with the Libretto tab ` +
      `(\`public/libretti/\`). Generated ${meta.generated_at.slice(0, 10)} by \`npm run libretti\` from ${meta.source}.`,
    '',
    '| Kind | Works | With synopsis | With roles |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const [k, label] of KINDS) {
    const ws = index.filter((w) => w.kind === k);
    lines.push(`| ${label} | ${ws.length} | ${ws.filter((w) => w.has_synopsis).length} | ${ws.filter((w) => w.roles_count).length} |`);
  }
  lines.push('', 'Sorted by composer, then premiere year. ✎ = synopsis available offline, ♫ = cast list available offline.', '');
  for (const [k, label] of KINDS) {
    const ws = index
      .filter((w) => w.kind === k)
      .sort((a, b) => (a.composers[0] ?? '~').localeCompare(b.composers[0] ?? '~') || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
    lines.push(`## ${label} (${ws.length})`, '');
    for (const w of ws) {
      const words = w.kind === 'musical' ? [...new Set([...w.lyricists, ...w.librettists])] : w.librettists;
      const bits = [
        w.composers.length ? esc(w.composers.join(', ')) : 'Composer unknown',
        words.length ? `words: ${esc(words.join(', '))}` : null,
        w.languages.length ? esc(w.languages.join('/')) : null,
        w.genre !== w.kind && w.genre !== 'musical' ? esc(w.genre) : null,
      ].filter(Boolean);
      const flags = `${w.has_synopsis ? ' ✎' : ''}${w.roles_count ? ' ♫' : ''}`;
      lines.push(`- [*${esc(w.title)}*](${w.wikipedia_url.replace(/\)/g, '%29')})${w.year ? ` (${w.year})` : ''} — ${bits.join(' · ')}${flags}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
