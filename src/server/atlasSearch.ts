import type { Collection, Db, Document } from 'mongodb';
import type { HybridSearchResult } from '../types/sottovoce';
import { computeReciprocalRankFusion } from '../utils/sottovoceEngine';

const EMBED_URL = 'https://ai.mongodb.com/v1/embeddings';
const EMBED_MODEL = 'voyage-4';
const EMBED_DIMS = 1024;
const PER_LIST = 40;

export type AtlasTarget = 'events' | 'works';

export interface AtlasSearchOptions {
  query: string;
  targets: AtlasTarget[];
  lat?: number;
  lng?: number;
  /** Only events starting from now. */
  upcomingOnly?: boolean;
  category?: string;
  limit?: number;
  /** Keep every showing of a production instead of collapsing them (the timetable filters by id). */
  keepShowings?: boolean;
}

export const embedQuery = (text: string) => embedText(text, 'query');
export const embedDocument = (text: string) => embedText(text, 'document');

async function embedText(text: string, inputType: 'query' | 'document'): Promise<number[]> {
  const r = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: [text], model: EMBED_MODEL, input_type: inputType, output_dimension: EMBED_DIMS }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Voyage embed ${r.status}`);
  return (await r.json()).data[0].embedding;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return Math.round(12742000 * Math.asin(Math.sqrt(a)));
}

const PROJECTION = { embedding: 0, embed_text: 0 };

async function lexicalList(col: Collection, target: AtlasTarget, o: AtlasSearchOptions): Promise<Document[]> {
  const filter: Document[] = [];
  if (target === 'events' && o.upcomingOnly) filter.push({ range: { path: 'start', gte: new Date() } });
  if (target === 'events' && o.category) filter.push({ text: { path: 'category', query: o.category } });
  if (target === 'works' && o.category) filter.push({ text: { path: 'kind', query: o.category } });
  const should: Document[] =
    target === 'events'
      ? [
          { text: { query: o.query, path: 'title', fuzzy: { maxEdits: 1 }, score: { boost: { value: 3 } } } },
          { text: { query: o.query, path: ['blurb', 'venue_name'] } },
        ]
      : [
          { text: { query: o.query, path: 'title', fuzzy: { maxEdits: 1 }, score: { boost: { value: 3 } } } },
          { text: { query: o.query, path: ['composers', 'librettists'], score: { boost: { value: 2 } } } },
          { text: { query: o.query, path: ['summary', 'synopsis'] } },
        ];
  return col
    .aggregate([
      { $search: { index: `${target}_search`, compound: { should, minimumShouldMatch: 1, filter } } },
      { $limit: PER_LIST },
      { $project: PROJECTION },
    ])
    .toArray();
}

async function vectorList(
  col: Collection,
  target: AtlasTarget,
  o: AtlasSearchOptions,
  queryVector: number[]
): Promise<Document[]> {
  const filter: Document = {};
  if (target === 'events' && o.upcomingOnly) filter.start = { $gte: new Date() };
  if (target === 'events' && o.category) filter.category = o.category;
  if (target === 'works' && o.category) filter.kind = o.category;
  return col
    .aggregate([
      {
        $vectorSearch: {
          index: `${target}_vector`,
          path: 'embedding',
          queryVector,
          numCandidates: 300,
          limit: PER_LIST,
          ...(Object.keys(filter).length ? { filter } : {}),
        },
      },
      { $project: PROJECTION },
    ])
    .toArray();
}

/** Real Atlas `$search` + `$vectorSearch` (+ distance rank for geo-tagged events), fused with reciprocal rank fusion. */
export async function atlasHybridSearch(db: Db, o: AtlasSearchOptions): Promise<HybridSearchResult[]> {
  const queryVector = await embedQuery(o.query);
  const hasOrigin = Number.isFinite(o.lat) && Number.isFinite(o.lng);
  const out: HybridSearchResult[] = [];

  for (const target of o.targets) {
    const col = db.collection(target);
    const [lexical, vector] = await Promise.all([lexicalList(col, target, o), vectorList(col, target, o, queryVector)]);

    const docs = new Map<string, Document>();
    const lexRank = new Map<string, number>();
    const vecRank = new Map<string, number>();
    lexical.forEach((d, i) => (docs.set(d._id, d), lexRank.set(d._id, i + 1)));
    vector.forEach((d, i) => (docs.set(d._id, d), vecRank.set(d._id, i + 1)));

    const dist = new Map<string, number>();
    const geoRank = new Map<string, number>();
    if (target === 'events' && hasOrigin) {
      for (const [id, d] of docs) {
        const c = d.location?.coordinates;
        if (c) dist.set(id, haversineMeters(o.lat!, o.lng!, c[1], c[0]));
      }
      [...dist.entries()].sort((a, b) => a[1] - b[1]).forEach(([id], i) => geoRank.set(id, i + 1));
    }

    for (const [id, d] of docs) {
      const score = computeReciprocalRankFusion(
        lexRank.get(id) ?? null,
        vecRank.get(id) ?? null,
        geoRank.get(id) ?? null
      );
      const base = {
        id,
        rrf_score: score,
        lexical_rank: lexRank.get(id) ?? null,
        vector_rank: vecRank.get(id) ?? null,
        geo_rank: geoRank.get(id) ?? null,
        distance_meters: dist.get(id) ?? null,
      };
      if (target === 'works') {
        out.push({
          ...base,
          collection: 'works_and_libretti',
          title: d.title,
          subtitle: [(d.composers ?? []).join(', '), d.year].filter(Boolean).join(' · '),
          snippet: String(d.summary ?? '').slice(0, 220),
          metadata: { kind: d.kind ?? '', url: d.wikipedia_url ?? '', languages: (d.languages ?? []).join(', ') },
        });
      } else {
        out.push({
          ...base,
          collection: 'live_events',
          title: d.title,
          subtitle: [d.venue_name, d.start ? new Date(d.start).toISOString().slice(0, 16).replace('T', ' ') : '']
            .filter(Boolean)
            .join(' · '),
          snippet: String(d.blurb ?? '').slice(0, 220),
          metadata: { category: d.category ?? '', url: d.url ?? '', price: d.price ?? '' },
        });
      }
    }
  }
  // Collapse repeat showings of one production (same title + venue) into its best-ranked hit.
  const seen = new Map<string, HybridSearchResult>();
  for (const r of out.sort((a, b) => b.rrf_score - a.rrf_score)) {
    const key = r.collection === 'live_events' && !o.keepShowings ? `${r.title}|${r.subtitle.split(' · ')[0]}` : r.id;
    const first = seen.get(key);
    if (first) first.metadata.showings = Number(first.metadata.showings ?? 1) + 1;
    else seen.set(key, r);
  }
  return [...seen.values()].slice(0, o.limit ?? 12);
}

/** More like this: `$vectorSearch` seeded with the document's own stored embedding (no Voyage call). */
export async function atlasSimilar(db: Db, target: AtlasTarget, id: string, limit = 8): Promise<HybridSearchResult[]> {
  const col = db.collection(target);
  const doc = await col.findOne({ _id: id as any }, { projection: { embedding: 1, title: 1, venue_id: 1 } });
  if (!doc?.embedding) return [];
  const filter: Document = target === 'events' ? { start: { $gte: new Date() } } : {};
  const hits = await col
    .aggregate([
      {
        $vectorSearch: {
          index: `${target}_vector`,
          path: 'embedding',
          queryVector: doc.embedding,
          numCandidates: 300,
          limit: 60,
          ...(Object.keys(filter).length ? { filter } : {}),
        },
      },
      { $addFields: { _score: { $meta: 'vectorSearchScore' } } },
      { $project: { embedding: 0, embed_text: 0 } },
    ])
    .toArray();
  const seen = new Set<string>([String(doc.title).toLowerCase()]);
  const out: HybridSearchResult[] = [];
  for (const d of hits) {
    const key = String(d.title).toLowerCase();
    if (d._id === id || seen.has(key)) continue;
    seen.add(key);
    const isWork = target === 'works';
    out.push({
      id: d._id,
      collection: isWork ? 'works_and_libretti' : 'live_events',
      title: d.title,
      subtitle: isWork
        ? [(d.composers ?? []).join(', '), d.year].filter(Boolean).join(' · ')
        : [d.venue_name, d.start ? new Date(d.start).toISOString().slice(0, 10) : ''].filter(Boolean).join(' · '),
      snippet: String(isWork ? d.summary ?? '' : d.blurb ?? '').slice(0, 160),
      rrf_score: Number(d._score.toFixed(4)),
      lexical_rank: null,
      vector_rank: out.length + 1,
      geo_rank: null,
      distance_meters: null,
      metadata: { url: d.url ?? d.wikipedia_url ?? '', category: d.category ?? d.kind ?? '' },
    });
    if (out.length >= limit) break;
  }
  return out;
}
