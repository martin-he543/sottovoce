import { useEffect, useMemo, useState } from 'react';
import type { TimetableEvent, TimetableVenue } from '../data/timetableCategories';
import { localEventSearch, warmEventSearch } from './eventSearch';

export type SearchVia = 'keyword' | 'meaning' | 'related' | 'concept';

interface Remote {
  source: string;
  hits: { id: string; score: number; via: SearchVia[] }[];
  understood: { intent: string; terms: string[]; works: string[] } | null;
}

export interface EventSearchState {
  /** Listing id → relevance (higher is better) for everything the search matched; null when there is no query. */
  scores: Map<string, number> | null;
  /** Why each listing matched, from Atlas / Argon (absent for matches only the browser found). */
  via: Map<string, SearchVia[]>;
  /** Atlas keyword + meaning answered / Argon's reading of the query arrived. */
  atlas: 'idle' | 'pending' | 'done' | 'unavailable';
  argon: 'idle' | 'pending' | 'done' | 'unavailable';
  understood: Remote['understood'];
}

/** One request per query, shared between keystrokes that land on the same text. */
const memo = new Map<string, Promise<Remote>>();
function fetchSearch(q: string, deep: boolean): Promise<Remote> {
  const key = `${deep ? 'deep' : 'fast'}|${q.toLowerCase()}`;
  let p = memo.get(key);
  if (!p) {
    p = fetch(`/api/events/search?q=${encodeURIComponent(q)}${deep ? '&deep=1' : ''}`)
      .then((r) => (r.ok ? (r.json() as Promise<Remote>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => {
        memo.delete(key);
        throw e;
      });
    memo.set(key, p);
    if (memo.size > 60) memo.delete(memo.keys().next().value!);
  }
  return p;
}

const IDLE: EventSearchState = { scores: null, via: new Map(), atlas: 'idle', argon: 'idle', understood: null };

/**
 * The Events search box, in three layers that each replace the last as it lands:
 *   1. the browser, at once: every field of every listing, typo tolerant
 *   2. MongoDB Atlas, ~half a second: $search + $vectorSearch fused by rank (finds pieces, names and ideas by meaning)
 *   3. Argon, a few seconds: what the query is really about (the composer of "ballade no 1", what an actor is known for)
 * Matches only one layer found stay in the list, ranked below those the server found.
 */
export function useEventSearch(query: string, events: TimetableEvent[], venues: Map<string, TimetableVenue>): EventSearchState {
  const q = query.trim();
  const active = q.length >= 2;
  useEffect(() => warmEventSearch(events, venues), [events, venues]);
  const local = useMemo(() => (active ? localEventSearch(events, venues, q) : null), [active, events, venues, q]);

  const [fast, setFast] = useState<{ q: string; r: Remote | 'error' } | null>(null);
  const [deep, setDeep] = useState<{ q: string; r: Remote | 'error' } | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const t1 = setTimeout(() => fetchSearch(q, false).then((r) => live && setFast({ q, r }), () => live && setFast({ q, r: 'error' })), 250);
    // Argon is slower and costs more, so it waits for the typing to settle.
    const t2 = setTimeout(() => fetchSearch(q, true).then((r) => live && setDeep({ q, r }), () => live && setDeep({ q, r: 'error' })), 700);
    return () => {
      live = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [q, active]);

  return useMemo(() => {
    if (!active || !local) return IDLE;
    const f = fast?.q === q ? fast.r : null;
    const d = deep?.q === q ? deep.r : null;
    const fastOk = f && f !== 'error' && f.source === 'atlas' ? f : null;
    const deepOk = d && d !== 'error' && d.source === 'atlas' ? d : null;
    const remote = deepOk ?? fastOk;

    const scores = new Map<string, number>();
    const via = new Map<string, SearchVia[]>();
    if (remote) {
      for (const h of remote.hits) {
        scores.set(h.id, 1 + h.score);
        via.set(h.id, h.via);
      }
    }
    // What only the browser found (the server may not have indexed it yet, or is unreachable) goes below.
    const top = Math.max(1, ...local.values());
    for (const [id, s] of local) if (!scores.has(id)) scores.set(id, s / top);
    return {
      scores,
      via,
      atlas: fastOk || deepOk ? 'done' : f === 'error' || f?.source === 'none' ? 'unavailable' : 'pending',
      argon: deepOk ? 'done' : d === 'error' || d?.source === 'none' ? 'unavailable' : 'pending',
      understood: deepOk?.understood ?? null,
    } satisfies EventSearchState;
  }, [active, local, fast, deep, q]);
}
