/**
 * Adds browse metadata to public/libretti/index.json: a thumbnail, a clean two-sentence description, Wikipedia
 * article length and 12-month / 3-month English Wikipedia pageviews (the popularity signals the Libretto sort menu uses).
 *
 *   npm run libretti            # build the base index first
 *   npm run libretti:enrich     # then enrich it (resumable; pageviews are cached in scripts/libretto/.cache)
 *
 * `--top=N` limits the slow pageview step to the N most popular operas (works come most popular first); the rest keep
 * their thumbnails and descriptions but no view counts. Requests are made one at a time to stay inside Wikimedia's limits.
 *
 * Text is CC BY-SA from Wikipedia; thumbnails are hot-linked from Wikimedia Commons (see each work's Wikipedia page for credits).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../timetable/lib.mjs';

const UA = { 'user-agent': 'sottovoce-libretti/1.0 (https://github.com/; martin.he@memrise.com) node-fetch' };
const INDEX = join(ROOT, 'public', 'libretti', 'index.json');
const CACHE = join(ROOT, 'scripts', 'libretto', '.cache');
const THUMB_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const THUMB_SIZE = 120;

/** Last 12 full calendar months, as YYYYMM01 bounds and the month keys inside them. */
function window12() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of previous month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const p = (d, day) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${day}`;
  return { start: p(start, '01'), end: p(end, String(end.getUTCDate()).padStart(2, '0')), tag: p(end, '') };
}

async function getJson(url, { retries = 9 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60e3) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30e3, 1000 * 2 ** attempt)));
    }
  }
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|St|Op|No|Nos|vs|Jr|Sr|Mt|c|ca|b|d|Vol|Act|Sgt|Gen|Col|Lt)\.$/;

/** First one or two sentences of a Wikipedia extract, without pronunciation / IPA / audio parentheses. */
export function describe(extract) {
  let text = String(extract ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/g, (m) =>
      /[;:]|pronounced|listen|\.(?:wav|ogg|mp3)|[^\u0000-ɏ\s]/i.test(m) ? '' : m
    )
    .replace(/\s+([,.;])/g, '$1')
    .trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“‘'])/).reduce((acc, s) => {
    if (acc.length && ABBREV.test(acc.at(-1))) acc[acc.length - 1] += ` ${s}`;
    else acc.push(s);
    return acc;
  }, []);
  let out = sentences[0];
  if (out.length < 110 && sentences[1]) out += ` ${sentences[1]}`;
  if (out.length > 260) {
    const cut = out.slice(0, 260);
    const stop = cut.lastIndexOf('. ');
    out = stop > 120 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
  }
  return out;
}

async function fetchPages(works) {
  const info = new Map(); // wikipedia_url → { title, thumb, length, extract, shortdesc }
  const byTitle = new Map();
  for (const w of works) byTitle.set(decodeURIComponent(w.wikipedia_url.split('/wiki/')[1]).replace(/_/g, ' '), w);
  const titles = [...byTitle.keys()];
  const batches = [];
  for (let i = 0; i < titles.length; i += 20) batches.push(titles.slice(i, i + 20));
  let done = 0;
  await pool(batches, 1, async (batch) => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1', maxlag: '5',
      prop: 'pageimages|extracts|info|description', piprop: 'thumbnail', pithumbsize: String(THUMB_SIZE),
      exintro: '1', explaintext: '1', exlimit: '20', titles: batch.join('|'),
    });
    const data = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
    const alias = new Map();
    for (const r of [...(data?.query?.normalized ?? []), ...(data?.query?.redirects ?? [])]) alias.set(r.to, r.from);
    const resolve = (t) => { while (alias.has(t)) t = alias.get(t); return t; };
    for (const p of data?.query?.pages ?? []) {
      const w = byTitle.get(resolve(p.title));
      if (!w || p.missing) continue;
      info.set(w.id, {
        title: p.title,
        thumb: p.thumbnail?.source?.match(/\/wikipedia\/commons\/thumb\/([^?]+)/)?.[1] ?? null,
        length: p.length ?? null,
        extract: p.extract ?? '',
        shortdesc: p.description ?? null,
      });
    }
    if (++done % 40 === 0) console.log(`  article info ${Math.min(done * 20, titles.length)}/${titles.length}`);
  });
  return info;
}

async function fetchViews(info, win, only) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `views-${win.tag}.json`);
  const cache = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
  const todo = [...new Set([...info].filter(([id]) => !only || only.has(id)).map(([, i]) => i.title))].filter((t) => !(t in cache));
  console.log(`  pageviews: ${Object.keys(cache).length} cached, ${todo.length} to fetch`);
  let done = 0;
  await pool(todo, 1, async (title) => {
    await new Promise((r) => setTimeout(r, 250));
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(
      title.replace(/ /g, '_')
    )}/monthly/${win.start}/${win.end}`;
    const data = await getJson(url);
    const months = (data?.items ?? []).map((m) => m.views);
    cache[title] = { v12: months.reduce((a, b) => a + b, 0), v3: months.slice(-3).reduce((a, b) => a + b, 0) };
    if (++done % 250 === 0) {
      console.log(`  pageviews ${done}/${todo.length}`);
      await writeFile(file, JSON.stringify(cache));
    }
  });
  await writeFile(file, JSON.stringify(cache));
  
  return cache;
}

async function main() {
  const index = JSON.parse(await readFile(INDEX, 'utf8'));
  const win = window12();
  console.log(`Enriching ${index.works.length} works (pageviews ${win.start}–${win.end})`);
  const info = await fetchPages(index.works);
  const top = Number(process.argv.find((a) => a.startsWith('--top='))?.slice(6));
  const only = top ? new Set(index.works.filter((w) => w.kind === 'opera').slice(0, top).map((w) => w.id)) : null;
  const views = await fetchViews(info, win, only);

  let described = 0;
  let withThumb = 0;
  for (const w of index.works) {
    const i = info.get(w.id);
    const v = i && views[i.title];
    w.summary = describe(i?.extract) || describe(w.summary) || '';
    if (w.summary) described++;
    w.thumb = i?.thumb ?? null;
    if (w.thumb) withThumb++;
    w.tagline = i?.shortdesc ?? null;
    w.article_length = i?.length ?? 0;
    w.views_12m = v?.v12 ?? 0;
    w.views_3m = v?.v3 ?? 0;
  }
  index.enriched_at = new Date().toISOString();
  index.views_window = { start: win.start, end: win.end };
  index.thumb_base = THUMB_PREFIX;
  await writeFile(INDEX, JSON.stringify(index));
  console.log(`Done: ${described} descriptions, ${withThumb} thumbnails`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
