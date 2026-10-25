// node --import tsx scripts/atlas/try.mjs "query" [events|works]
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { atlasHybridSearch } from '../../src/server/atlasSearch.ts';
const c = new MongoClient(process.env.MONGODB_URI);
const targets = process.argv[3] ? [process.argv[3]] : ['events', 'works'];
const t = Date.now();
const r = await atlasHybridSearch(c.db('sottovoce_prod'), { query: process.argv[2], targets, lat: 51.5129, lng: -0.1222, upcomingOnly: true, limit: 6 });
console.log(Date.now() - t, 'ms');
for (const x of r) console.log(x.rrf_score, `L${x.lexical_rank} V${x.vector_rank} G${x.geo_rank}`, x.title, '|', x.subtitle, x.distance_meters ?? '');
await c.close();
