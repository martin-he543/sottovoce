// Loads the offline data (timetable events + venues, libretti works) into MongoDB Atlas, embeds it with
// Voyage AI (MongoDB Model API, ai.mongodb.com), and creates the Atlas Search + Vector Search indexes.
//
//   node scripts/atlas/ingest.mjs            # everything (resumable: only embeds docs without an embedding)
//   node scripts/atlas/ingest.mjs --no-embed # load + indexes only
//   node scripts/atlas/ingest.mjs --no-embed --reindex  # also rewrite changed index definitions
//
// Collections (db sottovoce_prod): venues, events, works.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EMBED_MODEL = 'voyage-4';
export const EMBED_DIMS = 1024;
const EMBED_URL = 'https://ai.mongodb.com/v1/embeddings';
const BATCH = 128;
const skipEmbed = process.argv.includes('--no-embed');
// --reindex rewrites existing Atlas Search index definitions (after changing INDEXES below).
const reindex = process.argv.includes('--reindex');

export async function embed(texts, inputType = 'document') {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ input: texts, model: EMBED_MODEL, input_type: inputType, output_dimension: EMBED_DIMS }),
    });
    if (r.ok) return (await r.json()).data.map((d) => d.embedding);
    if (attempt < 6 && (r.status === 429 || r.status >= 500)) {
      await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
      continue;
    }
    throw new Error(`embed ${r.status}: ${await r.text()}`);
  }
}

const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

async function loadVenues() {
  const { venues } = await readJson('src/data/timetable.generated.json');
  return venues.map((v) => ({
    _id: v.id,
    name: v.name,
    kind: v.kind,
    address: v.address,
    site: v.site,
    location: Number.isFinite(v.lat) && Number.isFinite(v.lng) ? { type: 'Point', coordinates: [v.lng, v.lat] } : undefined,
  }));
}

async function loadEvents(venuesById) {
  const { events } = await readJson('src/data/timetable.generated.json');
  return events.map((e) => {
    const v = venuesById.get(e.venue_id);
    return {
      _id: e.id,
      title: e.title,
      category: e.category,
      start: new Date(e.start),
      time_known: e.time_known,
      venue_id: e.venue_id,
      venue_name: e.venue_name,
      url: e.url,
      hall: e.hall,
      blurb: e.blurb,
      price: e.price,
      source: e.source,
      venue_address: v?.address,
      venue_kind: v?.kind,
      location: v?.location,
      embed_text: [e.title, e.category, e.venue_name, e.blurb].filter(Boolean).join('. ').slice(0, 1500),
    };
  });
}

async function loadWorks() {
  const index = await readJson('public/libretti/index.json');
  const shards = new Map();
  const works = [];
  for (const w of index.works) {
    const shardNo = String(Number(w.id.slice(1)) % index.shards).padStart(2, '0');
    if (!shards.has(shardNo)) shards.set(shardNo, await readJson(`public/libretti/details/${shardNo}.json`));
    const d = shards.get(shardNo)[w.id] ?? {};
    const synopsis = (d.synopsis ?? []).map((s) => s.text).join(' ').slice(0, 1200);
    works.push({
      _id: w.id,
      title: w.title,
      kind: w.kind,
      genre: w.genre,
      composers: w.composers,
      librettists: w.librettists,
      year: w.year,
      languages: w.languages,
      popularity: w.popularity,
      summary: w.summary,
      wikipedia_url: w.wikipedia_url,
      roles: (d.roles ?? []).map((r) => r.name ?? r).slice(0, 30),
      synopsis,
      embed_text: [w.title, w.kind, (w.composers ?? []).join(', '), w.year, d.lead ?? w.summary, synopsis]
        .filter(Boolean)
        .join('. ')
        .slice(0, 2000),
    });
  }
  return works;
}

async function bulkUpsert(col, docs) {
  for (let i = 0; i < docs.length; i += 1000) {
    const ops = docs.slice(i, i + 1000).map(({ _id, ...rest }) => ({
      updateOne: { filter: { _id }, update: { $set: rest, $setOnInsert: {} }, upsert: true },
    }));
    await col.bulkWrite(ops, { ordered: false });
  }
}

async function embedMissing(col, label) {
  const todo = await col.find({ embedding: { $exists: false } }, { projection: { embed_text: 1 } }).toArray();
  console.log(`${label}: ${todo.length} docs to embed`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const vecs = await embed(chunk.map((d) => d.embed_text));
    await col.bulkWrite(
      chunk.map((d, j) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { embedding: vecs[j] } } } })),
      { ordered: false }
    );
    process.stdout.write(`\r${label}: ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  if (todo.length) process.stdout.write('\n');
}

async function ensureSearchIndex(col, def) {
  const existing = await col.listSearchIndexes(def.name).toArray();
  if (existing.length && reindex) {
    await col.updateSearchIndex(def.name, def.definition);
    return console.log(`index ${col.collectionName}.${def.name} updated`);
  }
  if (existing.length) return console.log(`index ${col.collectionName}.${def.name} exists (${existing[0].status})`);
  await col.createSearchIndex(def);
  console.log(`index ${col.collectionName}.${def.name} created`);
}

export const INDEXES = {
  events: [
    {
      name: 'events_search',
      type: 'search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            title: [{ type: 'string', analyzer: 'lucene.standard' }, { type: 'autocomplete' }],
            blurb: { type: 'string', analyzer: 'lucene.english' },
            venue_name: { type: 'string' },
            hall: { type: 'string' },
            venue_address: { type: 'string' },
            venue_kind: { type: 'string' },
            source: { type: 'string' },
            price: { type: 'string' },
            category: [{ type: 'string' }, { type: 'stringFacet' }],
            start: [{ type: 'date' }, { type: 'dateFacet' }],
            location: { type: 'geo' },
          },
        },
      },
    },
    {
      name: 'events_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
          { type: 'filter', path: 'category' },
          { type: 'filter', path: 'start' },
        ],
      },
    },
  ],
  works: [
    {
      name: 'works_search',
      type: 'search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            title: [{ type: 'string' }, { type: 'autocomplete' }],
            composers: { type: 'string' },
            librettists: { type: 'string' },
            roles: { type: 'string' },
            summary: { type: 'string', analyzer: 'lucene.english' },
            synopsis: { type: 'string', analyzer: 'lucene.english' },
            kind: [{ type: 'string' }, { type: 'stringFacet' }],
          },
        },
      },
    },
    {
      name: 'works_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
          { type: 'filter', path: 'kind' },
        ],
      },
    },
  ],
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('sottovoce_prod');

  const venues = await loadVenues();
  const venuesById = new Map(venues.map((v) => [v._id, v]));
  const events = await loadEvents(venuesById);
  const works = await loadWorks();

  await bulkUpsert(db.collection('venues'), venues);
  await bulkUpsert(db.collection('events'), events);
  await bulkUpsert(db.collection('works'), works);
  console.log(`loaded venues=${venues.length} events=${events.length} works=${works.length}`);

  await db.collection('events').createIndex({ location: '2dsphere' });
  await db.collection('events').createIndex({ start: 1, category: 1 });
  await db.collection('venues').createIndex({ location: '2dsphere' });
  for (const [name, defs] of Object.entries(INDEXES)) for (const d of defs) await ensureSearchIndex(db.collection(name), d);

  if (!skipEmbed) {
    await embedMissing(db.collection('works'), 'works');
    await embedMissing(db.collection('events'), 'events');
  }
  await client.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
