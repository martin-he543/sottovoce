/**
 * Scrapes every opera from opera-guide.ch and operafolio.com: synopses plus full libretti, in the same
 * act → scene → [speaker, text, 'sung' | 'dir'] shape as public/libretti/texts.
 *
 *   npm run libretti:scrape                 # both sites, resumable (finished operas are skipped)
 *   npm run libretti:scrape -- --status     # progress of a running (or finished) scrape
 *   SCRAPE_FRESH=1 npm run libretti:scrape  # re-download everything
 *   SCRAPE_REPARSE=1 npm run libretti:scrape  # rebuild every opera from the downloaded pages (after a parser fix)
 *   ONLY=die+zauberflote npm run libretti:scrape
 *
 * opera-guide.ch → public/libretti/opera-guide/<slug>.json   (synopses + librettos in every language it has)
 * operafolio.com → public/libretti/operafolio/<slug>.json    (synopsis, roles, hosted libretto, outside libretto links)
 * Each directory gets an index.json. `catalogue_id` is the matching Wikidata id in public/libretti/index.json.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, cheerio, clean } from '../timetable/lib.mjs';

const OUT = join(ROOT, 'public', 'libretti');
const CACHE = join(ROOT, 'scripts', 'libretto', '.cache', 'scrape');
const PROGRESS = join(CACHE, 'progress.json');
const FRESH = !!process.env.SCRAPE_FRESH;
const REPARSE = !!process.env.SCRAPE_REPARSE;
const UA = 'sottovoce-libretti/1.0 (personal research; martin.he@memrise.com)';
const OG = 'https://opera-guide.ch';
const OF = 'http://www.operafolio.com';

/* ───────────────────────── progress ───────────────────────── */

const state = { startedAt: Date.now(), updatedAt: 0, sites: {} };
const site = (name) => (state.sites[name] ??= { total: 0, done: 0, saved: 0, skipped: 0, failed: 0, current: '', errors: [] });

const bar = (done, total, width = 28) => {
  const f = total ? Math.round((done / total) * width) : 0;
  return `[${'█'.repeat(f)}${'░'.repeat(width - f)}] ${String(total ? Math.round((done / total) * 100) : 0).padStart(3)}%`;
};
const eta = (s, startedAt) => {
  if (!s.done || s.done >= s.total) return '';
  const left = ((Date.now() - startedAt) / s.done) * (s.total - s.done);
  return ` · eta ${left > 90e3 ? `${Math.round(left / 60e3)}m` : `${Math.round(left / 1e3)}s`}`;
};
function render(snapshot = state) {
  return Object.entries(snapshot.sites)
    .map(([n, s]) => `${n.padEnd(11)} ${bar(s.done, s.total)} ${s.done}/${s.total} · saved ${s.saved} · skipped ${s.skipped} · failed ${s.failed}${eta(s, snapshot.startedAt)}  ${(s.current ?? '').slice(0, 26)}`)
    .join('\n');
}
let lastLines = 0;
let lastWrite = 0;
async function tick(force = false) {
  if (!force && Date.now() - lastWrite < 1000) return;
  lastWrite = Date.now();
  state.updatedAt = lastWrite;
  await writeFile(PROGRESS, JSON.stringify(state)).catch(() => {});
  const text = render();
  if (process.stdout.isTTY) {
    process.stdout.write(`${lastLines ? `\x1b[${lastLines}F` : ''}${text.split('\n').map((l) => `${l}\x1b[K`).join('\n')}\n`);
    lastLines = text.split('\n').length;
  } else if (force || Date.now() - (tick.lastPlain ?? 0) > 10000) {
    tick.lastPlain = Date.now();
    console.log(text.replace(/\n/g, ' | '));
  }
}

/* ───────────────────────── fetching ───────────────────────── */

const gaps = { 'opera-guide.ch': 80, 'www.operafolio.com': 200 };
const nextSlot = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a page (cached on disk, retried with backoff). Resolves null for a 404. */
async function get(url, encoding = 'utf-8') {
  const file = join(CACHE, createHash('sha1').update(url).digest('hex'));
  if (!FRESH) {
    try {
      return await readFile(file, 'utf8');
    } catch {}
  }
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const at = Math.max(Date.now(), nextSlot[host] ?? 0);
    nextSlot[host] = at + (gaps[host] ?? 150);
    if (at > Date.now()) await sleep(at - Date.now());
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) {
      const body = new TextDecoder(encoding).decode(await res.arrayBuffer());
      await writeFile(file, body);
      return body;
    }
    if (res?.status === 404) return null;
    if (attempt >= 5) throw new Error(`${res?.status ?? 'network error'} for ${url}`);
    await sleep(2000 * 2 ** attempt);
  }
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/* ───────────────────────── text → acts ───────────────────────── */

const ORD = 'erste[rsn]?|zweite[rsn]?|dritte[rsn]?|vierte[rsn]?|fünfte[rsn]?|sechste[rsn]?|siebte[rsn]?|first|second|third|fourth|fifth|sixth|premier|première|deuxième|troisième|quatrième|primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|one|two|three|four|five';
const ACT_RE = new RegExp(`^(?:(?:${ORD})\\s+)?(?:act|akt|atto|acte|aufzug|prolog|prologue|prologo|epilog|epilogue|epilogo|vorspiel|nachspiel|intermezzo|tableau)\\b|^(?:act|akt|atto|acte|aufzug)\\s+[\\divxlc]+\\b`, 'i');
// Il trovatore's "Parte prima" is an act; Falstaff's and Don Carlo's are halves of one.
const PART_RE = /^parte\s+(?:prima|seconda|terza|quarta|quinta)\b/i;
const SCENE_RE = new RegExp(`^(?:(?:${ORD}|\\d+\\.?|[ivxlc]+\\.?)\\s+)?(?:auftritt|szene|scene|scène|scena|bild|quadro)(?:\\s+[\\divxlc]+\\.?)?(?:[:.]\\s.{0,40})?$|^(?:scene|szene|auftritt|scène|scena)\\s+[\\divxlc]+\\b.{0,40}$`, 'i');
const isUpper = (s) => /\p{L}/u.test(s) && s === s.toUpperCase() && s === s.replace(/[a-zà-ÿ]/g, '');

const MARK = { u: ['\u0001', '\u0002'], b: ['\u0003', '\u0004'], i: ['\u0005', '\u0006'] };
const whole = (s, [a, b]) => s.startsWith(a) && s.endsWith(b) && s.indexOf(b) === s.length - 1;
const unmark = (s) => s.replace(/[\u0001-\u0006]/g, '');
// A bare "<" in the text (Carmen's letter opens «<Continue…) would otherwise swallow everything up to the next tag.
const escapeStray = (html) => html.replace(/<(?!\/?[a-z][a-z0-9]*\b[^<>]*>|!--)/gi, '&lt;');

/** Turn a fragment of HTML (br-separated lines with b/u/i markup) into acts → scenes → lines. */
function parseLibretto(html, { upperSpeakers }) {
  const marked = escapeStray(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|tr|table|h\d)[^>]*>/gi, '\n')
    .replace(/<(u)>/gi, MARK.u[0]).replace(/<\/u>/gi, MARK.u[1])
    .replace(/<(b|strong)>/gi, MARK.b[0]).replace(/<\/(?:b|strong)>/gi, MARK.b[1])
    .replace(/<(i|em)>/gi, MARK.i[0]).replace(/<\/(?:i|em)>/gi, MARK.i[1])
    .replace(/<[^>]+>/g, '');
  const spanned = marked.replace(/([\u0001\u0003\u0005])([^\u0002\u0004\u0006]*)([\u0002\u0004\u0006])/g, (_, a, body, b) =>
    `${a}${body.replace(/\n/g, `${b}\n${a}`)}${b}`,
  );
  const text = cheerio.load(`<x>${spanned}</x>`).text();

  const acts = [];
  let act = null;
  let scene = null;
  let who = '';
  let blankBefore = true;
  let expectDescription = false;
  const openAct = (heading) => {
    act = { heading, scenes: [] };
    acts.push(act);
    scene = null;
    who = '';
  };
  const openScene = (title = '') => {
    if (!act) openAct('Act');
    scene = { title, description: '', lines: [] };
    act.scenes.push(scene);
    who = '';
  };
  const push = (line) => {
    if (!scene) openScene();
    scene.lines.push(line);
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      blankBefore = true;
      continue;
    }
    const plain = clean(unmark(line));
    if (!plain) {
      blankBefore = true;
      continue;
    }
    const wasBlank = blankBefore;
    blankBefore = false;

    if (whole(line, MARK.b)) {
      if (ACT_RE.test(plain)) openAct(plain);
      else if (PART_RE.test(plain)) (!act || act.heading === 'Act' || PART_RE.test(act.heading) ? openAct : openScene)(plain);
      else push(['', plain, 'dir']);
      expectDescription = false;
      continue;
    }
    if (ACT_RE.test(plain) && isUpper(plain) && wasBlank) {
      openAct(plain);
      continue;
    }
    if (SCENE_RE.test(plain) && plain.length < 50) {
      openScene(plain);
      expectDescription = true;
      continue;
    }
    if (whole(line, MARK.i)) {
      if (expectDescription && scene && !scene.lines.length) scene.description = clean(`${scene.description} ${plain}`);
      else push(['', plain, 'dir']);
      continue;
    }
    expectDescription = false;
    if (whole(line, MARK.u) || (upperSpeakers && wasBlank && isUpper(plain) && plain.length < 70)) {
      who = plain;
      continue;
    }
    // "(stage direction) sung text" on one line
    const lead = line.match(/^\u0005([^\u0006]*)\u0006\s*(.+)$/);
    if (lead && clean(unmark(lead[2]))) {
      push(['', clean(lead[1]), 'dir']);
      push([who, clean(unmark(lead[2])), 'sung']);
      continue;
    }
    push([who, plain, 'sung']);
  }
  return acts
    .map((a) => ({ ...a, scenes: a.scenes.filter((s) => s.lines.length) }))
    .filter((a) => a.scenes.length);
}

const countLines = (acts) => acts.reduce((n, a) => n + a.scenes.reduce((m, s) => m + s.lines.length, 0), 0);

/** Prose with bold headings (a synopsis) → [{ heading, text }], paragraphs separated by newlines. */
function parseProse(html) {
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|tr|table|h\d)[^>]*>/gi, '\n')
    .replace(/<(b|strong|h\d)>/gi, MARK.b[0]).replace(/<\/(?:b|strong|h\d)>/gi, MARK.b[1])
    .replace(/<[^>]+>/g, '');
  const out = [];
  let cur = { heading: null, paras: [], para: [] };
  const endPara = () => {
    if (cur.para.length) cur.paras.push(cur.para.join(' '));
    cur.para = [];
  };
  const flush = () => {
    endPara();
    if (cur.paras.length || cur.heading) out.push({ heading: cur.heading, text: cur.paras.join('\n') });
  };
  for (const raw of cheerio.load(`<x>${marked}</x>`).text().split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      endPara();
      continue;
    }
    if (whole(line, MARK.b)) {
      const h = clean(unmark(line));
      if (cur.heading && !cur.paras.length && !cur.para.length) cur.heading = `${cur.heading} · ${h}`;
      else {
        flush();
        cur = { heading: h, paras: [], para: [] };
      }
    } else cur.para.push(clean(unmark(line)));
  }
  flush();
  return out.filter((s) => s.text);
}

/* ───────────────────────── catalogue matching ───────────────────────── */

const fold = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const dropArticle = (s) => s.replace(/^(il|lo|la|le|gli|i|l|the|les|un|una|an|a|der|die|das|el|los|las) /, '');
const lastName = (s) => fold(String(s ?? '').replace(/,.*$/, (m) => m)).split(' ').filter(Boolean)[0] ?? '';

let byTitle = null;
async function matchCatalogue(title, composer) {
  if (!byTitle) {
    byTitle = new Map();
    try {
      for (const c of JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8')).works) {
        for (const k of new Set([fold(c.title), dropArticle(fold(c.title))])) byTitle.set(k, [...(byTitle.get(k) ?? []), c]);
      }
    } catch {}
  }
  const cands = byTitle.get(fold(title)) ?? byTitle.get(dropArticle(fold(title))) ?? [];
  const comp = composer.includes(',') ? fold(composer.split(',')[0]) : fold(composer).split(' ').pop();
  const known = (c) => c.composers.some((x) => fold(x).split(' ').pop() === comp || fold(x).includes(comp));
  return (cands.find(known) ?? (cands.length === 1 && !cands[0].composers.length ? cands[0] : null))?.id ?? null;
}

/* ───────────────────────── opera-guide.ch ───────────────────────── */

async function ogList() {
  const html = await get(`${OG}/operas/`);
  const $ = cheerio.load(html);
  const seen = new Map();
  $('a[href^="/operas/"]').each((_, a) => {
    const m = $(a).attr('href').match(/^\/operas\/([^/]+)\/$/);
    if (m && !seen.has(m[1])) seen.set(m[1], clean($(a).text()));
  });
  return [...seen].map(([slug, title]) => ({ slug, title }));
}

const ogBody = (html) => {
  const m = html.match(/<div class="col-lg-7 col-12">([\s\S]*?)<\/div>/);
  return m ? m[1] : '';
};

async function ogWork({ slug, title }) {
  const base = `${OG}/operas/${slug}/`;
  const info = await get(base);
  if (!info) throw new Error('opera page missing');
  const $ = cheerio.load(info);
  const langs = (kind) => [...new Set([...info.matchAll(new RegExp(`value="/operas/${slug.replace(/\+/g, '\\+')}/${kind}/([a-z]{2})/"`, 'g'))].map((m) => m[1]))];

  const section = (h2) => {
    const el = $('h2').filter((_, e) => clean($(e).text()).toLowerCase().startsWith(h2)).first();
    return el.length ? el.next('p') : null;
  };
  const text = (el) => clean(el?.text() ?? '');
  const composerLink = $('a[href^="/komponisten/"]').filter((_, e) => $(e).closest('.col-lg-7').length).first();
  const composer = clean(composerLink.attr('title') ?? composerLink.text());
  const roles = ((section('besetzung') ?? section('cast'))?.html() ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const heading = clean($('h1').first().text()) || title;

  const doc = {
    slug,
    title: heading,
    composer,
    source: 'opera-guide.ch',
    source_url: base,
    librettist: clean((section('libretto') ?? $()).html()?.replace(/<br\s*\/?>/gi, ', ') ?? '').replace(/<[^>]+>/g, ''),
    premiere: text(section('uraufführung') ?? section('urauff')),
    place: text(section('ort')),
    time: text(section('zeit')),
    roles: cheerio.load(`<x>${roles}</x>`).text().split('\n').map(clean).filter(Boolean),
    synopses: {},
    librettos: {},
  };

  for (const lang of langs('synopsis')) {
    const html = await get(`${base}synopsis/${lang}/`);
    const parts = html ? parseProse(ogBody(html).replace(/^[\s\S]*?<hr\s*\/?>/i, '')) : [];
    if (parts.length) doc.synopses[lang] = parts;
  }
  for (const lang of langs('libretto')) {
    const html = await get(`${base}libretto/${lang}/`);
    if (!html) continue;
    // Rules (<hr>) split off a title and cast list at the top, but also sit between acts and around entr'actes: drop at
    // most two short leading parts, and only while they hold no act, scene or overture (Die Entführung's first rule
    // comes before Act 3; Mireille's Act 1 heading follows "Ouvertüre" in the same bold run).
    const parts = ogBody(html).split(/<hr\s*\/?>/i);
    const starts = (p) =>
      cheerio.load(`<x>${escapeStray(p).replace(/<br\s*\/?>/gi, '\n')}</x>`).text().split('\n').map(clean)
        .some((l) => ACT_RE.test(l) || PART_RE.test(l) || SCENE_RE.test(l) || /^(?:ouvert|overture|sinfonia|prélude|prelude|preludio|vorspiel|introduzione|introduction)/i.test(l));
    let first = 0;
    while (first < Math.min(2, parts.length - 1) && parts[first].length < 3000 && !starts(parts[first])) first++;
    const body = parts.slice(first);
    const acts = parseLibretto(body.join('\n'), { upperSpeakers: true });
    // A cast list kept with Act 1 parses as a scene of its own; copyright notices parse as a line or two.
    const opening = acts[0]?.scenes[0];
    if (opening && /^(?:personen|personaggi|personnages|cast|characters|dramatis personae)\b/i.test(opening.lines[0]?.[1] ?? '') && countLines(acts) > opening.lines.length) {
      acts[0].scenes.shift();
      if (!acts[0].scenes.length) acts.shift();
    }
    if (countLines(acts) < 20) continue;
    doc.librettos[lang] = {
      language: { de: 'German', en: 'English', it: 'Italian', fr: 'French' }[lang] ?? lang,
      title: clean(parts[0].replace(/<[^>]+>/g, '')),
      source_url: `${base}libretto/${lang}/`,
      acts,
    };
  }
  const altTitles = [doc.title, ...Object.values(doc.librettos).map((l) => l.title)].filter(Boolean);
  for (const t of altTitles) doc.catalogue_id ??= await matchCatalogue(t, doc.composer);
  doc.catalogue_id ??= null;
  return doc;
}

/* ───────────────────────── operafolio.com ───────────────────────── */

const ofGet = (path) => get(`${OF}/${path}`, 'windows-1252');

async function ofList() {
  // The plain listings only show the top-rated; the search pages ("%" matches everything) show them all.
  const composers = new Set();
  const operas = new Map();
  for (const p of ['index.asp?s=%25', 'index.asp?o=x', ...[...'abcdefghijklmnopqrstuvwxyz'].map((l) => `index.asp?s=${l}`)]) {
    for (const m of ((await ofGet(p)) ?? '').matchAll(/composer\.asp\?n=([^"&]+)/g)) composers.add(m[1]);
    if (composers.size > 600 && p.includes('%25')) break;
  }
  for (const p of ['operas.asp?s=%25', 'operas.asp?o=x']) {
    for (const m of ((await ofGet(p)) ?? '').matchAll(/opera\.asp\?n=([^"&#]+)/g)) operas.set(m[1], '');
  }
  await pool([...composers], 4, async (c) => {
    const html = await ofGet(`composer.asp?n=${c}`);
    for (const m of (html ?? '').matchAll(/opera\.asp\?n=([^"&#]+)/g)) if (!operas.get(m[1])) operas.set(m[1], c);
  });
  return [...operas].map(([slug, composer]) => ({ slug, composer }));
}

async function ofWork({ slug, composer }) {
  const html = await ofGet(`opera.asp?n=${slug}`);
  if (!html) throw new Error('opera page missing');
  const $ = cheerio.load(html);
  const header = (name) => $('td[bgcolor=lightblue]').filter((_, e) => clean($(e).text()).toLowerCase().startsWith(name)).first().closest('tr');
  const title = clean($('h1').first().text()) || clean($('a[href^="opera.asp"]').first().text()) || slug.replace(/_/g, ' ');

  const syn = header('synopsis').nextUntil('tr:has(td[bgcolor=lightblue])').toArray();
  const synopsis = parseProse(syn.map((r) => $.html(r).replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, '\n<b>$1</b>\n')).join('\n').replace(/(>|<br\s*\/?>\s*)((?:Act|Scene)\s+[\w]+[^<\n]{0,80}?|Prologue|Epilogue|Overture)(?=\s*<br)/gi, '$1<b>$2</b>'));
  const roles = header('roles').next().find('tr').toArray().map((tr) => {
    const c = $(tr).find('td').toArray().map((td) => clean($(td).text()));
    return { name: c[0], voice: c[1], description: c[3] ?? '' };
  }).filter((r) => r.name);

  const links = [...new Set($('a[href^="http"]').toArray().map((a) => $(a).attr('href')))]
    .filter((h) => /libretto|translation|obras|opera-csakovics|wikisource|haendel/i.test(h) && !/operafolio|wikipedia|operabase/.test(h));
  const metaText = clean($('body').text());
  const doc = {
    slug,
    title,
    composer: clean($(`a[href^="composer.asp"]`).first().text()) || composer.replace(/_/g, ' '),
    year: Number(metaText.match(/ - (\d{4})/)?.[1]) || null,
    librettist: metaText.match(/Libretto by ([^|]*?)(?= First performance|Synopsis|$)/)?.[1]?.trim() ?? '',
    premiere: metaText.match(/First performance at (.*?)(?= Synopsis| Upcoming)/)?.[1]?.trim() ?? '',
    stars: Number($('img[src*="symbols/star"]').first().attr('alt')?.[0]) || null,
    source: 'operafolio.com',
    source_url: `${OF}/opera.asp?n=${slug}`,
    synopsis,
    roles,
    external_libretti: links,
  };
  if (/libretto\.asp\?n=/i.test(html)) {
    const lib = await ofGet(`libretto.asp?n=${slug}`);
    if (lib) {
      const body = lib.slice(lib.indexOf('>Libretto</td>') + 14)
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n<b>$1</b>\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n$1\n')
        .replace(/<strong>([\s\S]*?)<\/strong>/gi, (_, t) => `\n<i>${t.replace(/<br\s*\/?>/gi, '</i>\n<i>')}</i>\n`)
        .replace(/<a href[^>]*>(?:Top|Act \d+)<\/a>/gi, '');
      const acts = parseLibretto(body, { upperSpeakers: false });
      if (acts.length) doc.libretto = { language: 'original', source_url: `${OF}/libretto.asp?n=${slug}`, acts };
    }
  }
  doc.catalogue_id = await matchCatalogue(doc.title, doc.composer);
  return doc;
}

/* ───────────────────────── driver ───────────────────────── */

async function runSite(name, dir, list, work, concurrency) {
  const s = site(name);
  const dest = join(OUT, dir);
  await mkdir(dest, { recursive: true });
  let items = await list();
  if (process.env.ONLY) items = items.filter((i) => i.slug === process.env.ONLY);
  s.total = items.length;
  const summaries = {};
  await pool(items, concurrency, async (item) => {
    const file = join(dest, `${item.slug.replace(/[^\w+.-]/g, '_')}.json`);
    s.current = item.slug;
    try {
      let doc;
      try {
        if (FRESH || REPARSE) throw 0;
        doc = JSON.parse(await readFile(file, 'utf8'));
        s.skipped++;
      } catch {
        doc = await work(item);
        await writeFile(file, JSON.stringify(doc));
        s.saved++;
      }
      summaries[item.slug] = summarise(doc);
    } catch (e) {
      s.failed++;
      s.errors.push(`${item.slug}: ${e.message}`);
    }
    s.done++;
    await tick();
  });
  await writeFile(
    join(dest, 'index.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), count: Object.keys(summaries).length, works: summaries }),
  );
}

function summarise(d) {
  const libs = d.librettos ?? (d.libretto ? { original: d.libretto } : {});
  return {
    title: d.title,
    composer: d.composer,
    catalogue_id: d.catalogue_id ?? null,
    synopsis_languages: d.synopses ? Object.keys(d.synopses) : d.synopsis?.length ? ['en'] : [],
    libretto_languages: Object.keys(libs),
    lines: Object.fromEntries(Object.entries(libs).map(([k, v]) => [k, countLines(v.acts)])),
  };
}

async function status() {
  let snap;
  try {
    snap = JSON.parse(await readFile(PROGRESS, 'utf8'));
  } catch {
    console.log('No scrape has been started yet (run: npm run libretti:scrape).');
    return;
  }
  const age = Math.round((Date.now() - snap.updatedAt) / 1000);
  console.log(render(snap));
  const files = {};
  for (const d of ['opera-guide', 'operafolio']) files[d] = (await readdir(join(OUT, d)).catch(() => [])).filter((f) => f !== 'index.json').length;
  const allDone = Object.values(snap.sites).every((s) => s.total > 0 && s.done >= s.total);
  console.log(`files on disk: ${Object.entries(files).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(allDone ? `finished (last update ${age}s ago)` : age > 60 ? `no update for ${age}s — the scrape may have stopped` : `running (updated ${age}s ago)`);
  for (const [n, s] of Object.entries(snap.sites)) for (const e of s.errors.slice(-5)) console.log(`  ${n} error: ${e}`);
}

async function main() {
  if (process.argv.includes('--status')) return status();
  await mkdir(CACHE, { recursive: true });
  const ticker = setInterval(() => tick(), 1000);
  site('opera-guide');
  site('operafolio');
  await Promise.all([
    runSite('opera-guide', 'opera-guide', ogList, ogWork, 8),
    runSite('operafolio', 'operafolio', ofList, ofWork, 3),
  ]);
  clearInterval(ticker);
  await tick(true);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
