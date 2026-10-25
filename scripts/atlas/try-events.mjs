// node --import tsx scripts/atlas/try-events.mjs "query" [deep]  — the Events search box from the command line.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { GoogleGenAI, Type } from '@google/genai';
import { searchEvents } from '../../src/server/eventSearch.ts';
const c = new MongoClient(process.env.MONGODB_URI);
const db = c.db('sottovoce_prod');
const q = process.argv[2];
const deep = process.argv[3] === 'deep';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const understand = async (query) => {
  const r = await ai.models.generateContent({ model: 'gemini-4-argon', contents: `Someone is searching listings of London events. They typed: "${query}". It may be a piece of music (ballade no 1 is Chopin), a composer, performer/actor/band (shows they are known for), character, plot, mood. Return JSON {intent, terms (<=14 strings likely literally in a matching listing's title or description; only confident), description (listing that would satisfy), categories (of opera, classical, live_music, drama, musical, dance)}`, config: { responseMimeType: 'application/json', responseSchema: { type: Type.OBJECT, properties: { intent: { type: Type.STRING }, terms: { type: Type.ARRAY, items: { type: Type.STRING } }, description: { type: Type.STRING }, categories: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['intent','terms','description','categories'] } } });
  return JSON.parse(r.text);
};
const t = Date.now();
const out = await searchEvents(db, { query: q, understand: deep ? understand : undefined });
console.log(Date.now() - t, 'ms', out.understood);
const docs = await db.collection('events').find({ _id: { $in: out.hits.slice(0, 12).map((h) => h.id) } }, { projection: { title: 1, venue_name: 1, start: 1 } }).toArray();
const m = new Map(docs.map((d) => [d._id, d]));
console.log('total hits', out.hits.length);
for (const h of out.hits.slice(0, 12)) console.log(h.score.toFixed(4), h.via.join('+'), '|', m.get(h.id)?.title, '|', m.get(h.id)?.venue_name);
await c.close();
