import type { Request, Response, NextFunction, Express } from 'express';
import type { Collection, Db } from 'mongodb';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth';

/**
 * Per-user synced data: saved events, recent history, small preferences (taste profile, theme, reader settings).
 * One endpoint, POST /api/me/sync, both pushes the client's changes and returns what changed on the server since
 * `since`. Every record is last-write-wins on a client-supplied `at` timestamp, so an unsave on one device (a
 * tombstone) beats an older save on another.
 */

const PREF_KEYS = new Set(['lastfm.user', 'theme', 'follow.prefs', 'captions']);
const HISTORY_KINDS = new Set(['search', 'event', 'venue', 'page']);
const HISTORY_TTL_DAYS = 90;
const MAX_ITEMS = 500;
const MAX_EVENT_BYTES = 20_000;
const MAX_PREF_BYTES = 4_000;

interface SavedDoc { userId: string; eventId: string; event: unknown; at: number; deleted: boolean; syncedAt: number }
interface HistoryDoc { userId: string; kind: string; ref: string; label?: string; at: number; expiresAt: Date; syncedAt: number }
interface PrefDoc { userId: string; key: string; value: unknown; at: number; syncedAt: number }

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const ts = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const size = (v: unknown) => JSON.stringify(v ?? null).length;

export interface UserCollections { saved: Collection<SavedDoc>; history: Collection<HistoryDoc>; prefs: Collection<PrefDoc> }

export async function initUserData(db: Db): Promise<UserCollections> {
  const cols: UserCollections = {
    saved: db.collection('user_saved'),
    history: db.collection('user_history'),
    prefs: db.collection('user_prefs'),
  };
  await Promise.all([
    cols.saved.createIndex({ userId: 1, eventId: 1 }, { unique: true }),
    cols.saved.createIndex({ userId: 1, syncedAt: 1 }),
    cols.history.createIndex({ userId: 1, kind: 1, ref: 1 }, { unique: true }),
    cols.history.createIndex({ userId: 1, syncedAt: 1 }),
    cols.history.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    cols.prefs.createIndex({ userId: 1, key: 1 }, { unique: true }),
    cols.prefs.createIndex({ userId: 1, syncedAt: 1 }),
  ]);
  return cols;
}

export async function deleteUserData(cols: UserCollections, userId: string) {
  await Promise.all([
    cols.saved.deleteMany({ userId }),
    cols.history.deleteMany({ userId }),
    cols.prefs.deleteMany({ userId }),
  ]);
}

export function mountUserData(app: Express, auth: Auth, cols: UserCollections) {
  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return res.status(401).json({ error: 'Not signed in' });
      res.locals.userId = session.user.id;
      next();
    } catch {
      res.status(401).json({ error: 'Not signed in' });
    }
  };

  app.post('/api/me/sync', requireUser, async (req, res) => {
    const userId = res.locals.userId as string;
    const body = (req.body ?? {}) as Record<string, any>;
    const since = ts(body.since) ?? 0;
    const now = Date.now();

    try {
      // Saved events: apply when the incoming change is newer than what's stored.
      for (const s of (Array.isArray(body.saved) ? body.saved : []).slice(0, MAX_ITEMS)) {
        const eventId = str(s?.id, 200);
        const at = ts(s?.at);
        if (!eventId || at === null) continue;
        const deleted = s.deleted === true;
        if (!deleted && (typeof s.event !== 'object' || s.event === null || size(s.event) > MAX_EVENT_BYTES)) continue;
        const set = { event: deleted ? null : s.event, at, deleted, syncedAt: now };
        await cols.saved.updateOne({ userId, eventId, at: { $lt: at } }, { $set: set }, { upsert: false });
        await cols.saved
          .updateOne({ userId, eventId }, { $setOnInsert: { userId, eventId, ...set } }, { upsert: true })
          .catch(() => {}); // lost a race against an equal/newer write: keep that one
      }

      for (const h of (Array.isArray(body.history) ? body.history : []).slice(0, MAX_ITEMS)) {
        const kind = str(h?.kind, 20);
        const ref = str(h?.ref, 300);
        const at = ts(h?.at);
        if (!kind || !HISTORY_KINDS.has(kind) || !ref || at === null) continue;
        const label = str(h.label, 300) ?? undefined;
        const set = { label, at, expiresAt: new Date(at + HISTORY_TTL_DAYS * 86_400_000), syncedAt: now };
        await cols.history.updateOne({ userId, kind, ref, at: { $lt: at } }, { $set: set });
        await cols.history
          .updateOne({ userId, kind, ref }, { $setOnInsert: { userId, kind, ref, ...set } }, { upsert: true })
          .catch(() => {});
      }

      const prefsIn = body.prefs && typeof body.prefs === 'object' ? (body.prefs as Record<string, any>) : {};
      for (const [key, p] of Object.entries(prefsIn)) {
        const at = ts(p?.at);
        if (!PREF_KEYS.has(key) || at === null || size(p.value) > MAX_PREF_BYTES) continue;
        const set = { value: p.value, at, syncedAt: now };
        await cols.prefs.updateOne({ userId, key, at: { $lt: at } }, { $set: set });
        await cols.prefs.updateOne({ userId, key }, { $setOnInsert: { userId, key, ...set } }, { upsert: true }).catch(() => {});
      }

      const changed = { userId, syncedAt: { $gt: since } };
      const [saved, history, prefs] = await Promise.all([
        cols.saved.find(changed).limit(2000).toArray(),
        cols.history.find({ ...changed, expiresAt: { $gt: new Date() } }).sort({ at: -1 }).limit(1000).toArray(),
        cols.prefs.find(changed).toArray(),
      ]);

      res.json({
        serverTime: now,
        saved: saved.map((d) => ({ id: d.eventId, event: d.event, at: d.at, deleted: d.deleted })),
        history: history.map((d) => ({ kind: d.kind, ref: d.ref, label: d.label, at: d.at })),
        prefs: Object.fromEntries(prefs.map((d) => [d.key, { value: d.value, at: d.at }])),
      });
    } catch (err) {
      console.error('[sync] failed:', err);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  // GDPR-style export of everything held for the signed-in user besides the auth records.
  app.get('/api/me/export', requireUser, async (_req, res) => {
    const userId = res.locals.userId as string;
    const [saved, history, prefs] = await Promise.all([
      cols.saved.find({ userId, deleted: false }).toArray(),
      cols.history.find({ userId }).toArray(),
      cols.prefs.find({ userId }).toArray(),
    ]);
    res.json({ saved, history, prefs });
  });
}
