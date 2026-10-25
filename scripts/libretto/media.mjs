/**
 * Adds the pictures and recordings that sit on each work's English Wikipedia page: up to 8 images and 12 audio clips
 * (arias, overtures, excerpts from Wikimedia Commons) per work. Counts go in public/libretti/index.json
 * (`image_count`, `audio_count`, for the search bar and the "Only with audio" filter); the files themselves go in the
 * work's details shard under `media`. Nothing is downloaded: the app streams files from Commons by name.
 *
 *   npm run libretti            # base index first
 *   npm run libretti:enrich     # thumbnails + pageviews
 *   npm run libretti:media      # then this (resumable; API answers are cached in scripts/libretto/.cache)
 *
 * `--top=N` handles only the N most popular operas (the index lists works most popular first), in that order, so the
 * ones people look for come first; other works are left without media. Requests go out one at a time.
 *
 * `--popular=N` handles the union of the N leading works (of every kind) under each popularity sort in the Libretto
 * repertoire menu: overall, London performances, Wikipedia views, rising, languages and article depth. It adds to
 * what is already there, so it can follow a `--top` run. Run it through tsx (`npm run libretti:media`), because the
 * London ranking reuses the app's own title matching.
 *
 * Files are on Commons under their own licences (mostly CC BY-SA or public domain); each clip and picture links back
 * to its Commons page for credit.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../timetable/lib.mjs';
import { matchPerformances } from '../../src/utils/londonPerformances.ts';

const UA = { 'user-agent': 'sottovoce-libretti/1.0 (https://github.com/; martin.he@memrise.com) node-fetch' };
const API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const OUT = join(ROOT, 'public', 'libretti');
const CACHE = join(ROOT, 'scripts', 'libretto', '.cache');
const MAX_IMAGES = 8;
const MAX_AUDIO = 12;
/** Posters of musicals are non-free files on Wikipedia itself, and only ~250px wide; they are the picture people look for. */
const MIN_IMAGE_WIDTH = 200;
/** Spoken-name recordings ("LL-Q150 (fra)-Speaker-Carmen.wav", "De-Ger Die Zauberflöte.ogg") run a few seconds; music doesn't. */
const MIN_CLIP_SECONDS = 10;
const PRONUNCIATION = /^(LL-Q\d+|[A-Z][a-z]{1,2}-[A-Z][a-z]{1,2}[ -])/;

const AUDIO_EXT = /\.(ogg|oga|opus|mp3|wav|flac)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
/** Boilerplate pictures Wikipedia pages pull in (icons, flags, maintenance banners, speaker symbols). */
const JUNK = /(flag_of|flag of|icon|logo|symbol|commons-|wiki(?:data|quote|source|media|books|news|versity)|button|edit-|question|stub|ambox|padlock|folder|crystal|nuvola|blank|disambig|portal|increase|decrease|steady|\bstar\b|cc-|speaker|play_|ogg_|clef|signature|autograph|coat_of_arms|map_of|locator|location_map|sheet_music|score|\bpdf\b|lock-)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET json, spacing requests and honouring Retry-After on 429s (Wikipedia rate-limits shared IPs hard). */
let nextSlot = 0;
async function getJson(params, api = API) {
  const url = `${api}?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
  for (let attempt = 0; ; attempt++) {
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(Date.now(), nextSlot) + 350;
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60e3) });
      if (res.status === 429 || res.status >= 500) {
        const after = Number(res.headers.get('retry-after')) || Math.min(60, 2 ** attempt);
        nextSlot = Math.max(nextSlot, Date.now() + after * 1000 + 500);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error?.code === 'maxlag') {
        nextSlot = Math.max(nextSlot, Date.now() + Math.min(60, 5 * (attempt + 1)) * 1000);
        throw new Error('maxlag');
      }
      return data;
    } catch (e) {
      if (attempt >= 20) throw e;
    }
  }
}

/** Run a query with `continue` until exhausted, handing each page of results to `onPage`. */
async function drain(params, onPage) {
  let cont = {};
  do {
    const data = await getJson({ ...params, ...cont });
    onPage(data.query?.pages ?? [], data.query ?? {});
    cont = data.continue ?? null;
  } while (cont);
}

async function cached(name, build) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, name);
  const cache = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
  const save = () => writeFile(file, JSON.stringify(cache));
  return build(cache, save);
}

const titleOf = (w) => decodeURIComponent(w.wikipedia_url.split('/wiki/')[1]).replace(/_/g, ' ');

/** The text of an HTML snippet from Commons metadata, whitespace-collapsed and trimmed to a caption. */
function plain(html, max = 160) {
  const t = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, t.lastIndexOf(' ', max)).replace(/[,;:\s]+$/, '') + '…' : t;
}

/** Files embedded in each article, in page order: title → ["File:….ogg", …]. */
async function fetchFileLists(works) {
  return cached('media-files.json', async (cache, save) => {
    const titles = works.map(titleOf).filter((t) => !(t in cache));
    console.log(`  file lists: ${works.length - titles.length} cached, ${titles.length} to fetch`);
    let done = 0;
    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const got = {};
      const alias = new Map(); // final title → requested title
      await drain({ action: 'query', prop: 'images', imlimit: 'max', redirects: '1', titles: batch.join('|') }, (pages, q) => {
        for (const r of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(r.to, r.from);
        for (const p of pages) {
          let t = p.title;
          while (alias.has(t)) t = alias.get(t);
          (got[t] ??= []).push(...(p.images ?? []).map((x) => x.title));
        }
      });
      for (const t of batch) cache[t] = got[t] ?? [];
      if (++done % 25 === 0) {
        console.log(`  file lists ${Math.min(i + 20, titles.length)}/${titles.length}`);
        await save();
      }
    }
    await save();
    return cache;
  });
}

/**
 * Recordings Wikipedia's own embeds miss: Wikidata's "audio" (P51) file and the audio in the work's Commons category
 * (P373). Work id → ["File:….ogg", …].
 */
async function fetchExtraAudio(works) {
  return cached('media-extra-audio.json', async (cache, save) => {
    const todo = works.filter((w) => !(w.id in cache));
    console.log(`  wikidata/commons audio: ${works.length - todo.length} cached, ${todo.length} to fetch`);
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const data = await getJson({ action: 'wbgetentities', props: 'claims', ids: batch.map((w) => w.id).join('|') }, WIKIDATA);
      for (const w of batch) {
        const claims = data.entities?.[w.id]?.claims ?? {};
        const val = (p) => (claims[p] ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v) => typeof v === 'string');
        const files = val('P51').map((f) => `File:${f}`);
        for (const cat of val('P373').slice(0, 1)) {
          const r = await getJson(
            { action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmtype: 'file', cmlimit: '50' },
            COMMONS
          );
          files.push(...(r.query?.categorymembers ?? []).map((m) => m.title));
        }
        cache[w.id] = [...new Set(files.filter((f) => AUDIO_EXT.test(f)))];
      }
      await save();
    }
    return cache;
  });
}

/** Size, type, credit and duration for each wanted file: "File:x" → info. */
async function fetchFileInfo(files) {
  return cached('media-info.json', async (cache, save) => {
    const todo = [...files].filter((f) => !(f in cache));
    console.log(`  file info: ${files.size - todo.length} cached, ${todo.length} to fetch`);
    let done = 0;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      await drain(
        {
          action: 'query', prop: 'imageinfo', iiprop: 'size|mime|mediatype|extmetadata',
          iiextmetadatafilter: 'ObjectName|ImageDescription|Artist|LicenseShortName', titles: batch.join('|'),
        },
        (pages) => {
          for (const p of pages) {
            const ii = p.imageinfo?.[0];
            const md = ii?.extmetadata ?? {};
            cache[p.title] = ii
              ? {
                  w: ii.width ?? 0, h: ii.height ?? 0, d: Math.round(ii.duration ?? 0), type: ii.mediatype, mime: ii.mime,
                  name: plain(md.ObjectName?.value, 100), desc: plain(md.ImageDescription?.value),
                  by: plain(md.Artist?.value, 80), lic: plain(md.LicenseShortName?.value, 40),
                }
              : null;
          }
        }
      );
      for (const t of batch) if (!(t in cache)) cache[t] = null; // missing on Commons
      if (++done % 20 === 0) {
        console.log(`  file info ${Math.min(i + 50, todo.length)}/${todo.length}`);
        await save();
      }
    }
    await save();
    return cache;
  });
}

const fileName = (t) => t.replace(/^File:/i, '');
/** "Verdi - Rigoletto - La donna è mobile.ogg" → a readable clip title when Commons gives none. */
const titleFromFile = (f) => fileName(f).replace(/\.\w+$/, '').replace(/_/g, ' ').replace(/^\d+[\s.-]+/, '').trim();

/** Mirrors the sort menu in RepertoireCatalogue.tsx. */
const MIN_VIEWS_FOR_TREND = 600;
const trendOf = (w) => ((w.views_12m ?? 0) >= MIN_VIEWS_FOR_TREND ? ((w.views_3m ?? 0) * 4) / (w.views_12m ?? 1) - 1 : null);

/** Percentile (0–1) of each value among all values; ties share the lowest rank, so zeros stay at 0. */
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const first = new Map();
  sorted.forEach((v, i) => first.has(v) || first.set(v, i));
  return values.map((v) => first.get(v) / Math.max(1, sorted.length - 1));
}

/** The N leading works under each popularity sort, as { metric → works } (works most popular first overall). */
async function popularByMetric(works, n) {
  const views = percentiles(works.map((x) => x.views_12m ?? 0));
  const langs = percentiles(works.map((x) => x.popularity));
  const depth = percentiles(works.map((x) => x.article_length ?? 0));
  const scored = works
    .map((x, i) => ({ ...x, score: 0.5 * views[i] + 0.3 * langs[i] + 0.2 * depth[i] }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const events = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'timetable.generated.json'), 'utf8')).events ?? [];
  const london = matchPerformances(scored, events, new Date().toISOString().slice(0, 10));

  const top = (cmp, keep = () => true) => [...scored].filter(keep).sort(cmp).slice(0, n);
  return {
    overall: scored.slice(0, n),
    london: top((a, b) => london.count(b.id) - london.count(a.id), (w) => london.count(w.id) > 0),
    views: top((a, b) => (b.views_12m ?? 0) - (a.views_12m ?? 0)),
    rising: top((a, b) => trendOf(b) - trendOf(a), (w) => trendOf(w) != null),
    languages: top((a, b) => b.popularity - a.popularity),
    depth: top((a, b) => (b.article_length ?? 0) - (a.article_length ?? 0)),
  };
}

async function main() {
  const index = JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8'));
  const top = Number(process.argv.find((a) => a.startsWith('--top='))?.slice(6));
  const popular = Number(process.argv.find((a) => a.startsWith('--popular='))?.slice(10));
  let scope = top ? index.works.filter((w) => w.kind === 'opera').slice(0, top) : index.works;
  if (popular) {
    const byMetric = await popularByMetric(index.works, popular);
    const ids = new Set();
    for (const [metric, list] of Object.entries(byMetric)) {
      console.log(`  top ${list.length} by ${metric}: ${list.slice(0, 3).map((w) => w.title).join(', ')}…`);
      list.forEach((w) => ids.add(w.id));
    }
    scope = index.works.filter((w) => ids.has(w.id));
  }
  console.log(`Media for ${scope.length} works`);
  const lists = await fetchFileLists(scope);
  const extra = await fetchExtraAudio(scope);

  const wanted = new Set();
  const candidates = new Map(); // work id → { images: [], audio: [] } file titles
  for (const w of scope) {
    const all = lists[titleOf(w)] ?? [];
    const audio = [...new Set([...all.filter((f) => AUDIO_EXT.test(f)), ...(extra[w.id] ?? [])])].slice(0, MAX_AUDIO + 8);
    const images = all.filter((f) => IMAGE_EXT.test(f) && !JUNK.test(fileName(f))).slice(0, 24);
    candidates.set(w.id, { audio, images });
    [...audio, ...images].forEach((f) => wanted.add(f));
  }
  const info = await fetchFileInfo(wanted);

  const shards = new Map();
  const loadShard = async (n) => {
    if (!shards.has(n)) {
      const file = join(OUT, 'details', `${String(n).padStart(2, '0')}.json`);
      shards.set(n, JSON.parse(await readFile(file, 'utf8')));
    }
    return shards.get(n);
  };

  let withImages = 0;
  let withAudio = 0;
  let clips = 0;
  for (const w of scope) {
    const { audio, images } = candidates.get(w.id);
    const media = {
      images: images
        .filter((f) => (info[f]?.w ?? 0) >= MIN_IMAGE_WIDTH)
        .slice(0, MAX_IMAGES)
        .map((f) => ({ f: fileName(f), w: info[f].w, h: info[f].h, c: info[f].desc || info[f].name || '', by: info[f].by, lic: info[f].lic })),
      audio: audio
        .filter((f) => info[f] && info[f].d >= MIN_CLIP_SECONDS && !PRONUNCIATION.test(fileName(f)))
        .slice(0, MAX_AUDIO)
        .map((f) => ({ f: fileName(f), t: info[f].name || titleFromFile(f), d: info[f].d, by: info[f].by, lic: info[f].lic })),
    };
    w.image_count = media.images.length;
    w.audio_count = media.audio.length;
    if (w.image_count) withImages++;
    if (w.audio_count) withAudio++;
    clips += w.audio_count;
    const shard = await loadShard(Number(w.id.slice(1)) % index.shards);
    if (shard[w.id]) shard[w.id].media = media;
  }
  for (const [n, shard] of shards) await writeFile(join(OUT, 'details', `${String(n).padStart(2, '0')}.json`), JSON.stringify(shard));
  index.media_at = new Date().toISOString();
  await writeFile(join(OUT, 'index.json'), JSON.stringify(index));
  console.log(`Done: ${withImages} works with pictures, ${withAudio} with audio (${clips} clips)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
