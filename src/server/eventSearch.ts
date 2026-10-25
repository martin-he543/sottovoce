import type { Db, Document } from 'mongodb';
import { embedQuery } from './atlasSearch';

/**
 * The Events search box, end to end. Four ranked lists are fused with weighted reciprocal rank fusion:
 *
 *   keyword   Atlas `$search` over every field of a listing (title, description, venue, hall, address, category…),
 *             with phrase matching and typo tolerance, so "ballade no 1" lands on a programme that only mentions it
 *   meaning   Atlas `$vectorSearch` on the query's Voyage embedding
 *   related   `$search` for what Argon (gemini-4-argon) says the query is about — the composer behind a piece, the
 *             shows a performer is known for — plus the catalogue works (title, composer, roles) it names
 *   concept   `$vectorSearch` on a listing Argon imagines would satisfy the query (HyDE), for plots, moods and names
 *             no listing contains
 *
 * Without `understand` only keyword + meaning run, which is the fast first answer.
 */

const PER_LIST = 150;
const K = 60;

export interface Understanding {
  /** One line: what Argon thinks the person is after. */
  intent: string;
  /** Short strings likely to appear in a matching listing's title or description. */
  terms: string[];
  /** A one or two sentence listing that would satisfy the query. */
  description: string;
  /** Categories (opera, classical, live_music, drama, musical, dance) the query points at. */
  categories: string[];
}

export type Via = 'keyword' | 'meaning' | 'related' | 'concept';

export interface EventHit {
  id: string;
  score: number;
  via: Via[];
}

export interface EventSearchResult {
  hits: EventHit[];
  understood: { intent: string; terms: string[]; works: string[] } | null;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const cleanTerm = (s: string) => s.replace(/[^\p{L}\p{N}'’&.\- ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

const EVENT_FIELDS: [string, number][] = [
  ['title', 4],
  ['hall', 2],
  ['venue_name', 2],
  ['blurb', 1.5],
  ['venue_address', 1],
  ['category', 1],
  ['venue_kind', 0.5],
  ['source', 0.5],
  ['price', 0.5],
];

/** Every searchable field, typo tolerant; plus whole-phrase matches on the title and description, which count most. */
function keywordClauses(query: string): Document[] {
  const q = cleanTerm(query);
  if (!q) return [];
  const clauses: Document[] = [
    { phrase: { query: q, path: 'title', slop: 1, score: { boost: { value: 10 } } } },
    { phrase: { query: q, path: 'blurb', slop: 2, score: { boost: { value: 5 } } } },
    { autocomplete: { query: q, path: 'title', tokenOrder: 'any', fuzzy: { maxEdits: 1, prefixLength: 2 }, score: { boost: { value: 2 } } } },
  ];
  for (const [path, boost] of EVENT_FIELDS) {
    clauses.push({ text: { query: q, path, fuzzy: { maxEdits: 1, prefixLength: 2, maxExpansions: 30 }, score: { boost: { value: boost } } } });
  }
  return clauses;
}

/** What Argon (and the catalogue) say the query relates to: exact, un-fuzzed, since each is already a precise name. */
function relatedClauses(terms: string[]): Document[] {
  const out: Document[] = [];
  for (const raw of terms) {
    const t = cleanTerm(raw);
    if (t.length < 3) continue;
    const multi = /\s/.test(t);
    out.push({ phrase: { query: t, path: ['title', 'blurb', 'hall'], slop: multi ? 2 : 0, score: { boost: { value: multi ? 3 : 1.5 } } } });
  }
  return out;
}

async function search(db: Db, clauses: Document[], filter: Document[]): Promise<Document[]> {
  if (!clauses.length) return [];
  return db
    .collection('events')
    .aggregate([
      { $search: { index: 'events_search', compound: { should: clauses, minimumShouldMatch: 1, filter } } },
      { $limit: PER_LIST },
      { $project: { _id: 1, category: 1 } },
    ])
    .toArray();
}

/**
 * Vector hits closer than `SPREAD` to the best one. Nearest-neighbour search always returns its full limit, so without a
 * cut a gibberish query would still "match" 150 listings; relative to the best hit it keeps only the real neighbourhood.
 */
const SPREAD = 0.07;
async function vector(db: Db, queryVector: number[]): Promise<Document[]> {
  const hits = await db
    .collection('events')
    .aggregate([
      {
        $vectorSearch: {
          index: 'events_vector',
          path: 'embedding',
          queryVector,
          numCandidates: 600,
          limit: PER_LIST,
          filter: { start: { $gte: startOfToday() } },
        },
      },
      { $project: { _id: 1, category: 1, score: { $meta: 'vectorSearchScore' } } },
    ])
    .toArray();
  const best = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= best - SPREAD);
}

/** Catalogue works the query names (a title, composer, role or part of the story): their titles become related terms. */
async function matchingWorks(db: Db, query: string): Promise<string[]> {
  const q = cleanTerm(query);
  if (!q) return [];
  const docs = await db
    .collection('works')
    .aggregate([
      {
        $search: {
          index: 'works_search',
          compound: {
            should: [
              { phrase: { query: q, path: 'title', score: { boost: { value: 8 } } } },
              { text: { query: q, path: ['composers', 'librettists'], score: { boost: { value: 3 } } } },
              { text: { query: q, path: 'roles', score: { boost: { value: 4 } } } },
            ],
            minimumShouldMatch: 1,
          },
        },
      },
      { $limit: 4 },
      { $project: { title: 1, score: { $meta: 'searchScore' } } },
    ])
    .toArray();
  // Only a clear winner is trusted: a title, a composer or a role that is one work's alone.
  const top = docs[0]?.score ?? 0;
  return docs.filter((d, i) => i < 3 && d.score >= top * 0.6).map((d) => String(d.title));
}

export interface EventSearchOptions {
  query: string;
  /** Ask Argon what the query means. Omit for the fast keyword + meaning pass. */
  understand?: (q: string) => Promise<Understanding | null>;
}

const WEIGHT: Record<Via, number> = { keyword: 1, meaning: 1, related: 0.8, concept: 0.9 };

export async function searchEvents(db: Db, o: EventSearchOptions): Promise<EventSearchResult> {
  const query = o.query.trim().slice(0, 200);
  const filter: Document[] = [{ range: { path: 'start', gte: startOfToday() } }];

  const understandingP = o.understand ? o.understand(query).catch(() => null) : Promise.resolve(null);
  const worksP = o.understand ? matchingWorks(db, query).catch(() => []) : Promise.resolve([]);
  const [queryVector, keyword] = await Promise.all([embedQuery(query), search(db, keywordClauses(query), filter)]);
  const [meaning, understanding, works] = await Promise.all([vector(db, queryVector), understandingP, worksP]);

  const lists: [Via, Document[]][] = [['keyword', keyword], ['meaning', meaning]];
  let understood: EventSearchResult['understood'] = null;
  if (understanding || works.length) {
    const terms = [...new Set([...(understanding?.terms ?? []), ...works].map(cleanTerm).filter(Boolean))].slice(0, 20);
    const [related, concept] = await Promise.all([
      search(db, relatedClauses(terms), filter),
      understanding?.description ? embedQuery(understanding.description).then((v) => vector(db, v)) : Promise.resolve([]),
    ]);
    lists.push(['related', related], ['concept', concept]);
    understood = { intent: understanding?.intent ?? '', terms, works };
  }

  const boosted = new Set(understanding?.categories ?? []);
  const scores = new Map<string, { score: number; via: Set<Via>; category?: string }>();
  for (const [via, docs] of lists) {
    docs.forEach((d, i) => {
      const id = String(d._id);
      const entry = scores.get(id) ?? { score: 0, via: new Set<Via>(), category: d.category };
      entry.score += WEIGHT[via] / (K + i + 1);
      entry.via.add(via);
      scores.set(id, entry);
    });
  }
  const hits = [...scores.entries()]
    .map(([id, s]) => ({ id, score: s.score * (s.category && boosted.has(s.category) ? 1.15 : 1), via: [...s.via] }))
    .sort((a, b) => b.score - a.score);
  return { hits, understood };
}
