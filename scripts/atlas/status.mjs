import 'dotenv/config';
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI);
const db = c.db('sottovoce_prod');
console.log('server', (await db.admin().serverInfo()).version);
for (const n of ['events', 'works']) {
  const col = db.collection(n);
  console.log(n, 'docs', await col.countDocuments(), 'embedded', await col.countDocuments({ embedding: { $exists: true } }));
  for (const i of await col.listSearchIndexes().toArray()) console.log(' ', i.name, i.status, i.queryable);
}
await c.close();
