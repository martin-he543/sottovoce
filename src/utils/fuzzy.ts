/** Lower-case, accent-free text so "boheme" finds "La bohème". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours), giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Typos a word of this length may contain: none in short words, one up to seven letters, two beyond. */
const budget = (len: number) => (len < 4 ? 0 : len < 8 ? 1 : 2);

/** Edits needed to turn `term` into `word` or into the start of it (so "carmem" and a half-typed "carm" both reach "carmen"). */
export function wordDistance(term: string, word: string): number {
  const max = budget(term.length);
  const full = editDistance(term, word, max);
  const prefix = word.length > term.length ? editDistance(term, word.slice(0, term.length), max) : full;
  return Math.min(full, prefix === 0 ? 0 : prefix + 0.5);
}

export interface FuzzyDoc<T> {
  item: T;
  /** Title words, then the words of composers, writers and sources, all folded. */
  titleWords: string[];
  otherWords: string[];
}

export interface FuzzyHit<T> {
  item: T;
  /** Total typos across the query's words (0.5 for a typo in a prefix). */
  distance: number;
}

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

export const toFuzzyDoc = <T>(item: T, title: string, others: string[]): FuzzyDoc<T> => ({
  item,
  titleWords: words(title),
  otherWords: words(others.join(' ')),
});

/**
 * Every doc in which each query word matches some word within its typo budget, closest first. Words under four letters
 * must match exactly, so a stray "of" can't drag in the whole catalogue. Docs keep their incoming (popularity) order on ties.
 */
export function fuzzyRank<T>(docs: FuzzyDoc<T>[], query: string, limit = 50): FuzzyHit<T>[] {
  const terms = words(query);
  if (!terms.length || terms.every((t) => t.length < 4)) return [];
  const hits: (FuzzyHit<T> & { titleHits: number })[] = [];
  for (const d of docs) {
    let distance = 0;
    let titleHits = 0;
    let ok = true;
    for (const t of terms) {
      let best = Infinity;
      let inTitle = false;
      for (const w of d.titleWords) {
        const x = wordDistance(t, w);
        if (x < best) (best = x), (inTitle = true);
      }
      if (best > 0) {
        for (const w of d.otherWords) {
          const x = wordDistance(t, w);
          if (x < best) (best = x), (inTitle = false);
        }
      }
      if (best > budget(t.length)) {
        ok = false;
        break;
      }
      distance += best;
      if (inTitle) titleHits++;
    }
    if (ok) hits.push({ item: d.item, distance, titleHits });
  }
  return hits.sort((a, b) => a.distance - b.distance || b.titleHits - a.titleHits).slice(0, limit);
}
