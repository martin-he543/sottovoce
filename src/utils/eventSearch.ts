import { TIMETABLE_CATEGORIES, type TimetableEvent, type TimetableVenue } from '../data/timetableCategories';
import { detectSource, SOURCE_META } from './eventSource';
import { fold, wordDistance } from './fuzzy';
import { eventDay } from './timetableFormat';

/**
 * The browser half of the Events search: every listing is indexed on every field it has (title, description, venue, hall,
 * address, category, price, source, and the date spoken aloud: "saturday", "november", "25"), and a query matches a
 * listing when each of its words matches one of them, forgiving typos. It answers instantly and works offline; the
 * server's Atlas + Argon search (src/server/eventSearch.ts) adds meaning on top.
 */

const FIELD_WEIGHT = { title: 5, venue: 3, hall: 3, category: 2, blurb: 1, other: 1 } as const;
type Field = keyof typeof FIELD_WEIGHT;

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

interface Index {
  events: TimetableEvent[];
  /** word → listing index → weight of the best field it appears in */
  postings: Map<string, Map<number, number>>;
  /** Folded title + description per listing, for whole-phrase bonuses. */
  haystack: string[];
  /** Listings each query word matched, kept so the words already typed aren't matched again on every keystroke. */
  termHits: Map<string, Map<number, number>>;
}

const indexes = new WeakMap<TimetableEvent[], Index>();

const categoryText = (e: TimetableEvent) => {
  const c = TIMETABLE_CATEGORIES.find((x) => x.id === e.category);
  return c ? `${c.label} ${c.blurb}` : e.category;
};

function buildIndex(events: TimetableEvent[], venues: Map<string, TimetableVenue>): Index {
  const postings = new Map<string, Map<number, number>>();
  const haystack: string[] = [];
  const add = (i: number, text: string | undefined, field: Field) => {
    if (!text) return;
    const w = FIELD_WEIGHT[field];
    for (const word of words(text)) {
      let p = postings.get(word);
      if (!p) postings.set(word, (p = new Map()));
      if ((p.get(i) ?? 0) < w) p.set(i, w);
    }
  };
  events.forEach((e, i) => {
    const v = venues.get(e.venue_id);
    add(i, e.title, 'title');
    add(i, e.venue_name, 'venue');
    add(i, e.hall, 'hall');
    add(i, categoryText(e), 'category');
    add(i, e.blurb, 'blurb');
    add(i, v?.address, 'other');
    add(i, e.price, 'other');
    add(i, SOURCE_META[detectSource(e.url, e.source)].label, 'other');
    add(i, longDate.format(new Date(eventDay(e) + 'T12:00:00Z')), 'other');
    if (e.student) add(i, 'student discount', 'other');
    if (e.sold_out) add(i, 'sold out', 'other');
    haystack.push(fold(`${e.title} ${e.blurb ?? ''}`));
  });
  return { events, postings, haystack, termHits: new Map() };
}

const STOP = new Set(
  'a an the by of in at on for and or with to from some any something me i want find show looking anything like about featuring'.split(' ')
);

function indexFor(events: TimetableEvent[], venues: Map<string, TimetableVenue>): Index {
  let index = indexes.get(events);
  if (!index) indexes.set(events, (index = buildIndex(events, venues)));
  return index;
}

/** Builds the index while the browser is idle, so the first keystroke doesn't pay for it. */
export function warmEventSearch(events: TimetableEvent[], venues: Map<string, TimetableVenue>): () => void {
  if (indexes.has(events)) return () => {};
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(() => indexFor(events, venues), { timeout: 2500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => indexFor(events, venues), 600);
  return () => window.clearTimeout(id);
}

/**
 * Listings matching every word of `query` (a word under four letters must match exactly; longer ones within a typo or
 * two, and a half-typed word matches its prefix), with a score: title hits count most, a whole-phrase hit counts more.
 */
export function localEventSearch(events: TimetableEvent[], venues: Map<string, TimetableVenue>, query: string): Map<string, number> {
  const all = words(query);
  // "a ballade by Chopin": the little words say how it is asked, not what is wanted, so they need not match.
  const content = all.filter((w, i) => !STOP.has(w) || i === all.length - 1);
  const terms = content.some((w) => !STOP.has(w)) ? content.filter((w) => !STOP.has(w)) : all;
  const out = new Map<string, number>();
  if (!terms.length) return out;
  const index = indexFor(events, venues);

  const matched = new Map<number, { n: number; s: number }>();
  for (const [n, term] of terms.entries()) {
    const typing = n === terms.length - 1;
    const key = `${typing && term.length === 2 ? '+' : ''}${term}`;
    let hit = index.termHits.get(key);
    if (!hit) {
      hit = new Map<number, number>();
      for (const [word, posting] of index.postings) {
        // A one- or two-letter word ("1", "no") must be the whole word, unless it is the half-typed last one ("swan la").
        const d = term.length < 3 ? (word === term || (typing && term.length === 2 && word.startsWith(term)) ? 0 : Infinity) : wordDistance(term, word);
        if (d > (term.length < 4 ? 0 : term.length < 8 ? 1 : 2)) continue;
        const fit = 1 - d * 0.25;
        for (const [i, w] of posting) hit.set(i, Math.max(hit.get(i) ?? 0, w * fit));
      }
      if (index.termHits.size > 200) index.termHits.clear();
      index.termHits.set(key, hit);
    }
    for (const [i, h] of hit) {
      const c = matched.get(i);
      matched.set(i, c ? { n: c.n + 1, s: c.s + h } : { n: 1, s: h });
    }
  }
  // Listings with every word; failing that, those with the most of them ("ballade" and "Chopin" in different listings),
  // scored lower so a full match found later still ranks first.
  let most = 0;
  for (const m of matched.values()) most = Math.max(most, m.n);
  // Not while the last word is a few letters in: "cho" would bring in every choir.
  if (!most || (most < terms.length && (terms.length - most > Math.floor(terms.length / 2) || terms[terms.length - 1].length < 4))) return out;
  const partial = most < terms.length;
  const phrase = fold(query).replace(/\s+/g, ' ').trim();
  for (const [i, { n, s }] of matched) {
    if (n < most) continue;
    out.set(index.events[i].id, (s + (terms.length > 1 && index.haystack[i].includes(phrase) ? 10 : 0)) * (partial ? 0.5 : 1));
  }
  return out;
}

/** Literal matching for "quoted" searches and links that mean one title: the text must appear in the title, venue or hall. */
export function literalEventMatch(e: TimetableEvent, query: string): boolean {
  const q = fold(query);
  return !q || fold(`${e.title} ${e.venue_name} ${e.hall ?? ''}`).includes(q);
}
