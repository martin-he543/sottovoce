import { useEffect, useState } from 'react';

export interface AtlasHit {
  id: string;
  score: number;
  lexical_rank: number | null;
  vector_rank: number | null;
}

/** One in-flight or finished request per key, so the search bar and the catalogue share a call instead of making it twice. */
const memo = new Map<string, Promise<any>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = memo.get(key);
  if (!p) {
    p = make().catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, p);
    if (memo.size > 100) memo.delete(memo.keys().next().value!);
  }
  return p;
}

/** Ranked ids from MongoDB Atlas ($search + $vectorSearch, fused). Debounced; `null` hits mean Atlas is unavailable or the query is too short. */
export function useAtlasSearch(query: string, scope: 'events' | 'works', limit = 40) {
  const q = query.trim();
  const [state, setState] = useState<{ q: string; hits: Map<string, AtlasHit> | null }>({ q: '', hits: null });

  useEffect(() => {
    if (q.length < 3) {
      setState({ q, hits: null });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      once(`atlas|${scope}|${limit}|${q}`, () =>
        fetch(`/api/atlas/search?scope=${scope}&limit=${limit}&q=${encodeURIComponent(q)}`).then((r) => r.json() as Promise<{ source: string; hits: AtlasHit[] }>)
      ).then(
        (d) => live && setState({ q, hits: d.source === 'atlas' ? new Map(d.hits.map((h) => [h.id, h])) : null }),
        () => live && setState({ q, hits: null })
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, scope, limit]);

  return state.q === q ? state.hits : null;
}

export interface SimilarItem {
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  rrf_score: number;
  metadata: Record<string, string | number | boolean>;
}

/** Nearest neighbours of a stored event or work, by vector similarity of their Voyage embeddings. */
export function useAtlasSimilar(scope: 'events' | 'works', id: string | undefined) {
  const [items, setItems] = useState<SimilarItem[]>([]);
  useEffect(() => {
    setItems([]);
    if (!id) return;
    const ctl = new AbortController();
    fetch(`/api/atlas/similar?scope=${scope}&id=${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => setItems(d.results ?? []))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [scope, id]);
  return items;
}

export interface InterpretedWork {
  title: string;
  composer: string;
  /** Why Gemini thinks it fits what was typed. */
  why: string;
}

/**
 * What Gemini (gemini-4-argon, via /api/works/interpret) thinks a vague or descriptive query means: "a play about a
 * bullfighter and love being like a bird" → Carmen. Only asked when `enabled`, after a pause in typing.
 */
export function useInterpretedWorks(query: string, enabled: boolean) {
  const q = query.trim();
  const [state, setState] = useState<{ q: string; works: InterpretedWork[] }>({ q: '', works: [] });
  const active = enabled && q.length >= 3;
  useEffect(() => {
    if (!active) return;
    let live = true;
    const t = setTimeout(() => {
      once(`interpret|${q.toLowerCase()}`, () =>
        fetch('/api/works/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) }).then(
          (r) => (r.ok ? (r.json() as Promise<{ works: InterpretedWork[] }>) : Promise.reject(new Error(`HTTP ${r.status}`)))
        )
      ).then(
        (d) => live && setState({ q, works: d.works ?? [] }),
        () => live && setState({ q, works: [] })
      );
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, active]);
  const settled = state.q === q;
  return { works: active && settled ? state.works : [], loading: active && !settled };
}
