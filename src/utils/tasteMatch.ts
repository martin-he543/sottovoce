import type { TimetableEvent } from '../data/timetableCategories';

/** Minimal shape of a scraped Last.fm library used for matching. */
export interface TasteLibrary {
  artists: { name: string; playcount: number }[];
  albums: { name: string; artist: string; playcount: number }[];
  tracks: { name: string; artist: string; playcount: number }[];
}

export interface ScoredEvent {
  event: TimetableEvent;
  score: number;
  matched: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Words too generic on their own to count as a distinctive artist/track mention.
const STOPWORDS = new Set(['the', 'and', 'feat', 'featuring', 'ft', 'with', 'of', 'a', 'an', 'live', 'show']);

/** Words from a normalised name worth matching individually (drops short/common ones). */
const significantWords = (key: string) => key.trim().split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w));

/** Distinct artist names across the library, heaviest first. */
export function libraryArtists(lib: TasteLibrary, max = 40): string[] {
  const weight = new Map<string, { name: string; w: number }>();
  const add = (name: string | undefined, w: number) => {
    const key = name ? norm(name) : '';
    if (key.length < 3) return;
    const cur = weight.get(key);
    if (cur) cur.w += w;
    else weight.set(key, { name: name!, w });
  };
  lib.artists.forEach((a) => add(a.name, a.playcount * 3));
  lib.albums.forEach((a) => add(a.artist, a.playcount));
  lib.tracks.forEach((t) => add(t.artist, t.playcount));
  return [...weight.values()].sort((a, b) => b.w - a.w).slice(0, max).map((v) => v.name);
}

const dayKey = (e: TimetableEvent) => e.start.slice(0, 10);

/** Upcoming events, one per (title, venue), earliest showing kept. */
export function upcomingUnique(events: TimetableEvent[], now = new Date()): TimetableEvent[] {
  const today = now.toISOString().slice(0, 10);
  const seen = new Map<string, TimetableEvent>();
  for (const e of events) {
    if (dayKey(e) < today) continue;
    const key = `${norm(e.title)}|${e.venue_id}`;
    const cur = seen.get(key);
    if (!cur || e.start < cur.start) seen.set(key, e);
  }
  return [...seen.values()];
}

/** Score events by literal mentions of the listener's artists / album / track titles. */
export function scoreEvents(events: TimetableEvent[], lib: TasteLibrary): ScoredEvent[] {
  const artists = libraryArtists(lib).map((name) => {
    const norm_ = norm(name);
    return { name, key: ` ${norm_} `, words: significantWords(norm_) };
  });
  const titles = [...lib.albums.slice(0, 40), ...lib.tracks.slice(0, 40)]
    .map((x) => ({ name: x.name, key: ` ${norm(x.name)} ` }))
    .filter((x) => x.key.trim().length >= 4);
  return events.map((event) => {
    const hay = ` ${norm(`${event.title} ${event.blurb ?? ''}`)} `;
    const matched: string[] = [];
    let score = 0;
    for (const a of artists) {
      if (hay.includes(a.key)) {
        // Full artist name present, e.g. a listing for "Taylor Swift".
        matched.push(a.name);
        score += 10;
      } else if (a.words.some((w) => hay.includes(` ${w} `))) {
        // Just a distinctive word of the name, e.g. "Swift" or "Weeknd" in the listing title.
        matched.push(a.name);
        score += 5;
      }
    }
    for (const t of titles) {
      if (hay.includes(t.key)) {
        matched.push(t.name);
        score += 3;
      }
    }
    return { event, score, matched };
  });
}

/**
 * Candidate set to hand to the LLM: every literal match, plus a spread of upcoming events
 * across categories (soonest first) so it can reason about similar-but-unnamed acts.
 */
export function buildCandidatePool(events: TimetableEvent[], lib: TasteLibrary, max = 110, now = new Date()): ScoredEvent[] {
  const scored = scoreEvents(upcomingUnique(events, now), lib);
  const direct = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);
  const taken = new Set(direct.map((s) => s.event.id));
  const byCat = new Map<string, ScoredEvent[]>();
  for (const s of scored.sort((a, b) => a.event.start.localeCompare(b.event.start))) {
    if (taken.has(s.event.id)) continue;
    (byCat.get(s.event.category) ?? byCat.set(s.event.category, []).get(s.event.category)!).push(s);
  }
  // Heavier on the categories a Last.fm listener is likeliest to cross over into.
  const quota: Record<string, number> = { opera: 18, classical: 18, live_music: 24, musical: 12, dance: 6, drama: 6 };
  const rest: ScoredEvent[] = [];
  for (const [cat, list] of byCat) {
    // Listings with a description give the model more to reason from, so they go first.
    const described = [...list.filter((s) => s.event.blurb), ...list.filter((s) => !s.event.blurb)];
    rest.push(...described.slice(0, quota[cat] ?? 6));
  }
  return [...direct, ...rest].slice(0, max);
}
