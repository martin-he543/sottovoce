import { ArgonTag } from './ArgonButton';
import { useAtlasSearch, useInterpretedWorks, type InterpretedWork } from '../utils/atlasClient';
import { fold, fuzzyRank, toFuzzyDoc, type FuzzyDoc } from '../utils/fuzzy';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Clapperboard,
  Drama,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Headphones,
  Images,
  Languages,
  Library,
  MapPin,
  Mic2,
  Music,
  Radio,
  Search,
  TrendingUp,
  User,
  X,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import type { RepertoireAudio, RepertoireDetail, RepertoireImage, RepertoireIndex, RepertoireWork } from '../types/sottovoce';
import type { TimetableEvent } from '../data/timetableCategories';
import { dayKey, shortDate, timeLabel } from '../utils/timetableFormat';
import { eventPath, venuePath } from '../utils/urlState';
import { matchPerformances, type LondonPerformances } from '../utils/londonPerformances';
import { gbp, gbpRange, parseListingPrice, usualPriceAt } from '../utils/seatPrices';
import { loadSeatPlanIndex, type SeatPlanSummary } from '../utils/seatPlan';
import { PlanJourneyButton, type JourneyRequest } from './PlanJourneyButton';
import { ListenButtons, useMediaDock } from './MediaDock';

/**
 * The offline repertoire: every opera, operetta and musical in public/libretti/ (≈5,500 works scraped from Wikidata and
 * Wikipedia by `npm run libretti`). `RepertoireSearch` is the Libretto tab's search bar (with instant suggestions);
 * `RepertoireCatalogue` is the browse view: filtered list on the left, synopsis by act, roles & voice types, premiere
 * cast and musical numbers for the picked work on the right.
 */

const BASE = `${import.meta.env.BASE_URL}libretti/`;
const PAGE = 60;

/** A work that has a fully annotated, line-by-line libretto in the live companion. */
export interface LiveWorkLink {
  work_id: string;
  title: string;
  composer: string;
}

type KindFilter = 'all' | RepertoireWork['kind'];
type SortKey = 'relevance' | 'london' | 'audio' | 'views' | 'rising' | 'languages' | 'depth' | 'oldest' | 'newest' | 'title' | 'composer';

const KINDS: { id: KindFilter; label: string; Icon: LucideIcon }[] = [
  { id: 'all', label: 'All', Icon: Library },
  { id: 'opera', label: 'Opera', Icon: Drama },
  { id: 'operetta', label: 'Operetta', Icon: Music },
  { id: 'musical', label: 'Musicals', Icon: Clapperboard },
];
const KIND_ICON: Record<RepertoireWork['kind'], LucideIcon> = { opera: Drama, operetta: Music, musical: Clapperboard };

const THUMB_BASE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
/**
 * English Wikipedia serves any file by name (its own uploads, such as posters, and Commons files alike), resized when
 * `width` is given, so the app stores names rather than hashed URLs.
 */
const commonsFile = (name: string, width?: number) =>
  `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/ /g, '_'))}${width ? `?width=${width}` : ''}`;
const commonsPage = (name: string) => `https://en.wikipedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`;
const clock = (secs: number) => (secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Views in the last 3 months, annualised, relative to the 12-month average; only meaningful for works people read about. */
const MIN_VIEWS_FOR_TREND = 600;
const trendOf = (w: RepertoireWork): number | null =>
  (w.views_12m ?? 0) >= MIN_VIEWS_FOR_TREND ? ((w.views_3m ?? 0) * 4) / (w.views_12m ?? 1) - 1 : null;

/**
 * The sort menu. `relevance` is the default (best match for a search, otherwise the blended popularity score);
 * the rest are single proxy metrics. `cmp` gives the natural order, `Reverse order` flips it.
 */
/** What the sort orders need beyond the work itself: how many London listings it has. */
interface SortCtx {
  london: (id: string) => number;
}

const SORTS: {
  id: SortKey;
  label: string;
  hint: string;
  Icon: LucideIcon;
  group: 'Popularity' | 'Date & name';
  cmp?: (a: RepertoireWork, b: RepertoireWork, x: SortCtx) => number;
  /** The figure shown on each row while this sort is active. */
  metric?: (w: RepertoireWork, x: SortCtx) => string | null;
}[] = [
  { id: 'relevance', label: 'Overall', hint: 'Blend of views, languages and article depth', Icon: TrendingUp, group: 'Popularity',
    metric: (w) => ((w.views_12m ?? 0) ? `${compact.format(w.views_12m!)} views` : null) },
  { id: 'london', label: 'London performances', hint: 'Upcoming listings in Discover Events', Icon: MapPin, group: 'Popularity',
    cmp: (a, b, x) => x.london(b.id) - x.london(a.id), metric: (w, x) => `${x.london(w.id)} in London` },
  { id: 'audio', label: 'Recordings', hint: 'Audio clips on the Wikipedia page', Icon: Headphones, group: 'Popularity',
    cmp: (a, b) => (b.audio_count ?? 0) - (a.audio_count ?? 0),
    metric: (w) => `${w.audio_count ?? 0} ${w.audio_count === 1 ? 'clip' : 'clips'}` },
  { id: 'views', label: 'Wikipedia views', hint: 'English pageviews, last 12 months', Icon: Eye, group: 'Popularity',
    cmp: (a, b) => (b.views_12m ?? 0) - (a.views_12m ?? 0), metric: (w) => `${compact.format(w.views_12m ?? 0)} views / yr` },
  { id: 'rising', label: 'Rising', hint: 'Last 3 months vs. the yearly average', Icon: TrendingUp, group: 'Popularity',
    cmp: (a, b) => (trendOf(b) ?? -Infinity) - (trendOf(a) ?? -Infinity),
    metric: (w) => { const t = trendOf(w); return t == null ? null : `${t >= 0 ? '+' : '−'}${Math.round(Math.abs(t) * 100)}%`; } },
  { id: 'languages', label: 'Wikipedia languages', hint: 'Editions that cover the work: a global-reach proxy', Icon: Globe, group: 'Popularity',
    cmp: (a, b) => b.popularity - a.popularity, metric: (w) => `${w.popularity} languages` },
  { id: 'depth', label: 'Article depth', hint: 'How much has been written about it', Icon: FileText, group: 'Popularity',
    cmp: (a, b) => (b.article_length ?? 0) - (a.article_length ?? 0), metric: (w) => `${compact.format(w.article_length ?? 0)} bytes` },
  { id: 'oldest', label: 'Oldest first', hint: 'By premiere year', Icon: Calendar, group: 'Date & name',
    cmp: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
  { id: 'newest', label: 'Newest first', hint: 'By premiere year', Icon: Calendar, group: 'Date & name',
    cmp: (a, b) => (b.year ?? -1) - (a.year ?? -1) },
  { id: 'title', label: 'Title A–Z', hint: 'Alphabetical', Icon: ArrowUpDown, group: 'Date & name',
    cmp: (a, b) => a.title.localeCompare(b.title) },
  { id: 'composer', label: 'Composer A–Z', hint: 'By composer, then year', Icon: User, group: 'Date & name',
    cmp: (a, b) => (a.composers[0] ?? '~').localeCompare(b.composers[0] ?? '~') || (a.year ?? 9999) - (b.year ?? 9999) },
];

/** Percentile (0–1) of each value among all values; ties share the lowest rank so zeros stay at 0. */
function percentiles(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const first = new Map<number, number>();
  sorted.forEach((v, i) => first.has(v) || first.set(v, i));
  return values.map((v) => first.get(v)! / Math.max(1, sorted.length - 1));
}

/** Blends pageviews, language editions and article depth into one `score` and returns works most popular first. */
function withScores(index: RepertoireIndex): RepertoireIndex {
  const w = index.works;
  const views = percentiles(w.map((x) => x.views_12m ?? 0));
  const langs = percentiles(w.map((x) => x.popularity));
  const depth = percentiles(w.map((x) => x.article_length ?? 0));
  const hasViews = w.some((x) => x.views_12m);
  const works = w
    .map((x, i) => ({ ...x, score: hasViews ? 0.5 * views[i] + 0.3 * langs[i] + 0.2 * depth[i] : langs[i] }))
    .sort((a, b) => b.score! - a.score! || a.title.localeCompare(b.title));
  return { ...index, works };
}

let indexPromise: Promise<RepertoireIndex> | null = null;
const loadIndex = () =>
  (indexPromise ??= fetch(`${BASE}index.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RepertoireIndex>;
    })
    .then(withScores));

const shardPromises = new Map<number, Promise<Record<string, RepertoireDetail>>>();
export function loadDetail(id: string, shards: number): Promise<RepertoireDetail | undefined> {
  const shard = Number(id.slice(1)) % shards;
  if (!shardPromises.has(shard)) {
    const load = fetch(`${BASE}details/${String(shard).padStart(2, '0')}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => {
        // Don't remember a failed shard, so the next pick retries it.
        shardPromises.delete(shard);
        return {};
      });
    shardPromises.set(shard, load);
  }
  return shardPromises.get(shard)!.then((s) => s[id]);
}

const londonCache = new WeakMap<RepertoireWork[], { events: TimetableEvent[]; day: string; result: LondonPerformances }>();
/** Upcoming London listings matched to each work. Shared by the search bar and the catalogue, and recomputed only when the day or the listings change. */
function useLondon(index: RepertoireIndex | null, events: TimetableEvent[]): LondonPerformances {
  return useMemo(() => {
    if (!index) return { byWork: new Map(), count: () => 0 };
    const day = dayKey(new Date());
    const hit = londonCache.get(index.works);
    if (hit && hit.events === events && hit.day === day) return hit.result;
    const result = matchPerformances(index.works, events, day);
    londonCache.set(index.works, { events, day, result });
    return result;
  }, [index, events]);
}

export interface Searchable {
  w: RepertoireWork;
  title: string;
  /** Words of the composers' and writers' names, for surname matches. */
  people: string[];
  text: string;
  /** Words for typo-tolerant matching. */
  doc: FuzzyDoc<RepertoireWork>;
}

const toSearchable = (w: RepertoireWork): Searchable => ({
  w,
  title: fold(w.title),
  people: fold([...w.composers, ...w.librettists, ...w.lyricists].join(' ')).split(/[\s-]+/),
  text: fold(
    [w.title, ...w.composers, ...w.librettists, ...w.lyricists, ...w.based_on, w.premiere_venue ?? '', w.genre, w.year ?? '', ...w.languages].join(' ')
  ),
  doc: toFuzzyDoc(w, w.title, [...w.composers, ...w.librettists, ...w.lyricists, ...w.based_on]),
});

/** Every work matching all words of `query`: title matches, then people ("verdi"), then the rest; most popular first within each. */
export function rank(items: Searchable[], query: string, kind: KindFilter = 'all'): RepertoireWork[] {
  const q = fold(query).trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { w: RepertoireWork; s: number }[] = [];
  for (const it of items) {
    if (kind !== 'all' && it.w.kind !== kind) continue;
    if (!terms.every((t) => it.text.includes(t))) continue;
    const s = !q
      ? 0
      : it.title === q
        ? 0
        : it.title.startsWith(q)
          ? 1
          : it.title.split(/[\s'’(-]+/).some((word) => word.startsWith(q))
            ? 2
            : it.people.some((word) => word.startsWith(q))
              ? 3
              : it.title.includes(q)
                ? 4
                : 5;
    scored.push({ w: it.w, s });
  }
  // The index is already most popular first, and sort is stable.
  return scored.sort((a, b) => a.s - b.s).map((x) => x.w);
}

/** The repertoire index, loaded once and shared by the search bar and the catalogue. */
export function useRepertoire() {
  const [index, setIndex] = useState<RepertoireIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e)));
  }, []);
  const searchable = useMemo(() => index?.works.map(toSearchable) ?? [], [index]);
  return { index, error, searchable };
}

/** The catalogue work a title and composer from Gemini refers to; the index is most-staged first, so a namesake loses to the famous one. */
function resolveWork(works: RepertoireWork[], t: InterpretedWork): RepertoireWork | undefined {
  const title = fold(t.title).replace(/^(the|a|an|la|le|les|il|der|die|das) /, '');
  const surname = fold(t.composer).split(/\s+/).at(-1) ?? '';
  const same = works.filter((w) => fold(w.title).replace(/^(the|a|an|la|le|les|il|der|die|das) /, '') === title);
  return same.find((w) => surname && w.composers.some((c) => fold(c).includes(surname))) ?? same[0];
}

const MAX_SUGGESTIONS = 5;

export interface WorkSuggestion {
  w: RepertoireWork;
  /** Why it is offered: the match Gemini or Atlas made, or a plain note for a close spelling. */
  why: string;
  via: 'spelling' | 'meaning' | 'atlas';
}

/**
 * Search the repertoire three ways. `exact` is the literal match (every word found in title, people or sources);
 * when that finds little, typo-tolerant matching, Gemini's reading of a description ("a play about a bullfighter…")
 * and MongoDB Atlas ($search with fuzzy + $vectorSearch) fill in. `matches` is all of them in that order and
 * `suggestions` is what the "Are you referring to" box offers.
 */
export function useWorkSearch(query: string, index: RepertoireIndex | null, searchable: Searchable[], kind: KindFilter = 'all') {
  const q = query.trim();
  const exact = useMemo(() => (q ? rank(searchable, q, kind) : []), [searchable, q, kind]);
  const sparse = exact.length < 3;
  const fuzzy = useMemo(
    () => (q && sparse ? fuzzyRank(searchable.map((s) => s.doc), q, 8).map((h) => h.item).filter((w) => kind === 'all' || w.kind === kind) : []),
    [searchable, q, sparse, kind]
  );
  const atlasHits = useAtlasSearch(sparse ? q : '', 'works', 12);
  // Ask Gemini when typos and literal words found nothing, or the query reads like a description rather than a name.
  const describing = q.split(/\s+/).length >= 4;
  const interpreted = useInterpretedWorks(q, sparse && (describing || (exact.length === 0 && fuzzy.length === 0)));

  return useMemo(() => {
    const seen = new Set(exact.map((w) => w.id));
    const suggestions: WorkSuggestion[] = [];
    const add = (w: RepertoireWork | undefined, why: string, via: WorkSuggestion['via']) => {
      if (!w || seen.has(w.id) || (kind !== 'all' && w.kind !== kind)) return;
      seen.add(w.id);
      suggestions.push({ w, why, via });
    };
    if (sparse && index) {
      fuzzy.slice(0, 3).forEach((w) => add(w, 'Close to the spelling you typed', 'spelling'));
      // Gemini lists loosely best-first; the catalogue knows which of its picks people actually stage, so the famous ones lead.
      const meant = interpreted.works.flatMap((t) => {
        const w = resolveWork(index.works, t);
        return w ? [{ w, why: t.why }] : [];
      });
      meant.sort((a, b) => (b.w.score ?? 0) - (a.w.score ?? 0));
      meant.slice(0, MAX_SUGGESTIONS).forEach((m) => add(m.w, m.why, 'meaning'));
      if (atlasHits) {
        const byId = new Map(index.works.map((w) => [w.id, w]));
        // Semantic neighbours are looser than the other two, so they only top the box up to its limit.
        [...atlasHits.keys()].forEach((id) => suggestions.length < MAX_SUGGESTIONS && add(byId.get(id), '', 'atlas'));
      }
    }
    return {
      exact,
      suggestions,
      matches: [...exact, ...suggestions.map((s) => s.w)],
      thinking: interpreted.loading,
      /** Shown while the literal match is thin (fewer than three works). */
      offer: sparse && !!q,
    };
  }, [exact, sparse, fuzzy, interpreted, atlasHits, index, kind, q]);
}

/** The live work a catalogue entry corresponds to (same title, and the composer's surname when known). */
export function liveMatch(w: RepertoireWork, live: LiveWorkLink[]): LiveWorkLink | undefined {
  return live.find((l) => {
    if (fold(l.title) !== fold(w.title)) return false;
    const surname = fold(l.composer.split(' ').at(-1) ?? '');
    return !w.composers.length || w.composers.some((c) => fold(c).includes(surname));
  });
}

/** The work's lead image, or a masks / music / clapperboard tile when Wikipedia has none. */
export const Thumb: React.FC<{ w: RepertoireWork; className?: string; iconClass?: string; width?: number }> = ({
  w,
  className = '',
  iconClass = 'w-5 h-5',
  width,
}) => {
  // Wikimedia won't enlarge a small original, so a failed sized request falls back to the stored thumbnail.
  const [stage, setStage] = useState(0);
  const failed = stage >= (width ? 2 : 1);
  const Icon = KIND_ICON[w.kind];
  return (
    <span
      aria-hidden
      className={`shrink-0 overflow-hidden rounded-md border flex items-center justify-center ${className}`}
      style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}
    >
      {w.thumb && !failed ? (
        <img src={THUMB_BASE + (width && stage === 0 ? w.thumb.replace(/\/\d+px-/, `/${width}px-`) : w.thumb)} alt="" loading="lazy" decoding="async" onError={() => setStage((n) => n + 1)} className="w-full h-full object-cover" />
      ) : (
        <Icon className={iconClass} strokeWidth={1.5} />
      )}
    </span>
  );
};

const kindLabel = (w: RepertoireWork) => (w.genre === 'musical' ? 'Musical' : w.genre[0].toUpperCase() + w.genre.slice(1));
const byline = (w: RepertoireWork) => [w.composers.join(', ') || 'Composer unknown', w.year, kindLabel(w)].filter(Boolean).join(' · ');

/* ------------------------------------------------------------------------------------------------------------------ */

interface RepertoireSearchProps {
  query: string;
  onQuery: (q: string) => void;
  /** Show the instant-suggestions dropdown (off when the catalogue below already shows the results). */
  suggest: boolean;
  /** The Discover timetable's listings, for the "n in London" figure on each suggestion. */
  events: TimetableEvent[];
  liveWorks: LiveWorkLink[];
  onPick: (w: RepertoireWork) => void;
  onOpenLive: (workId: string) => void;
  onBrowseAll: () => void;
}

const SUGGESTIONS = 7;

/** The search bar at the top of the Libretto tab. Press "/" anywhere to focus it. */
export const RepertoireSearch: React.FC<RepertoireSearchProps> = ({
  query,
  onQuery,
  suggest,
  events,
  liveWorks,
  onPick,
  onOpenLive,
  onBrowseAll,
}) => {
  const { index, searchable } = useRepertoire();
  const london = useLondon(index, events);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { matches } = useWorkSearch(query, index, searchable);

  // With an empty box, offer the live librettos first and then the most-staged works.
  type Option = { kind: 'live'; live: LiveWorkLink } | { kind: 'work'; w: RepertoireWork };
  const groups = useMemo((): { label: string; options: Option[] }[] => {
    if (query.trim()) return [{ label: '', options: matches.slice(0, SUGGESTIONS).map((w) => ({ kind: 'work', w })) }];
    const liveTitles = new Set(liveWorks.map((l) => fold(l.title)));
    return [
      { label: 'Follow along live', options: liveWorks.map((live) => ({ kind: 'live', live })) },
      {
        label: 'Most popular',
        options: (index?.works ?? [])
          .filter((w) => !liveTitles.has(fold(w.title)))
          .slice(0, 5)
          .map((w) => ({ kind: 'work', w })),
      },
    ];
  }, [query, matches, liveWorks, index]);
  const options = groups.flatMap((g) => g.options);
  const showList = suggest && open && options.length + (query.trim() ? 1 : 0) > 0;

  useEffect(() => setActive(0), [query]);

  const choose = (o: Option) => {
    setOpen(false);
    inputRef.current?.blur();
    if (o.kind === 'live') return onOpenLive(o.live.work_id);
    const live = liveMatch(o.w, liveWorks);
    if (live) onOpenLive(live.work_id);
    else onPick(o.w);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) onQuery('');
      else inputRef.current?.blur();
      setOpen(false);
      return;
    }
    if (!suggest) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const n = options.length + (query.trim() ? 1 : 0);
      if (n) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active < options.length) choose(options[active]);
      else {
        setOpen(false);
        onBrowseAll();
      }
    }
  };

  let optionIdx = -1;
  return (
    <div className="relative">
      <div
        className="flex items-center gap-3 rounded-2xl border px-4 sm:px-5 h-14 shadow-sm transition-shadow focus-within:shadow-md"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: open ? 'var(--accent-crimson)' : 'var(--border-hairline)' }}
      >
        <Search className="w-5 h-5 shrink-0" style={{ color: 'var(--accent-crimson)' }} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-label="Search operas, operettas and musicals"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={
            index
              ? `Search ${index.count.toLocaleString('en-GB')} operas, operettas & musicals`
              : 'Search operas, operettas & musicals'
          }
          className="flex-1 min-w-0 bg-transparent font-fraunces text-base sm:text-lg focus:outline-none placeholder:opacity-60"
          style={{ color: 'var(--text-primary)' }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              onQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="p-1 rounded-md cursor-pointer hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd
            className="hidden sm:inline-block text-[11px] font-mono px-1.5 py-0.5 rounded border"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-hairline)' }}
          >
            /
          </kbd>
        )}
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl border shadow-xl overflow-hidden animate-folio-enter"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
        >
          {groups.map((g) =>
            g.options.length ? (
              <div key={g.label || 'results'} className="py-1.5">
                {g.label && (
                  <p className="px-5 pt-2 pb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                    {g.label === 'Follow along live' ? <Radio className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {g.label}
                  </p>
                )}
                {g.options.map((o) => {
                  const i = ++optionIdx;
                  const live = o.kind === 'live' ? o.live : liveMatch(o.w, liveWorks);
                  const title = o.kind === 'live' ? o.live.title : o.w.title;
                  const sub = o.kind === 'live' ? `${o.live.composer} · line-by-line translation` : byline(o.w);
                  return (
                    <div
                      key={o.kind === 'live' ? o.live.work_id : o.w.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={active === i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(o)}
                      className="px-4 py-2 flex items-center gap-3 cursor-pointer"
                      style={{ backgroundColor: active === i ? 'var(--bg-subtle)' : undefined }}
                    >
                      {o.kind === 'work' ? (
                        <Thumb w={o.w} className="w-9 h-11" iconClass="w-4 h-4" />
                      ) : (
                        <span
                          aria-hidden
                          className="shrink-0 w-9 h-11 rounded-md flex items-center justify-center"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent-crimson)' }}
                        >
                          <Radio className="w-4 h-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-fraunces text-[15px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {title}
                        </span>
                        <span className="block text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                          {sub}
                        </span>
                      </span>
                      {o.kind === 'work' && (o.w.audio_count ?? 0) > 0 && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono tabular-nums"
                          style={{ color: 'var(--text-muted)' }}
                          title={`${o.w.audio_count} audio ${o.w.audio_count === 1 ? 'clip' : 'clips'} from Wikipedia`}
                        >
                          <Headphones className="w-3 h-3" /> {o.w.audio_count}
                        </span>
                      )}
                      {o.kind === 'work' && london.count(o.w.id) > 0 && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono tabular-nums px-2 py-0.5 rounded-full"
                          style={{ color: 'var(--accent-gold)', backgroundColor: 'var(--bg-subtle)' }}
                          title="Upcoming performances in London (Discover Events)"
                        >
                          <MapPin className="w-3 h-3" /> {london.count(o.w.id)} in London
                        </span>
                      )}
                      {o.kind === 'work' && !live && !london.count(o.w.id) && (o.w.views_12m ?? 0) > 0 && (
                        <span
                          className="shrink-0 hidden sm:inline-flex items-center gap-1 text-[10px] font-mono tabular-nums"
                          style={{ color: 'var(--text-muted)' }}
                          title="English Wikipedia pageviews, last 12 months"
                        >
                          <Eye className="w-3 h-3" /> {compact.format(o.w.views_12m!)}
                        </span>
                      )}
                      {live && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ color: 'var(--accent-crimson)', backgroundColor: 'var(--bg-subtle)' }}
                        >
                          <Radio className="w-3 h-3" /> Live
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null
          )}
          {query.trim() && (
            <div
              id={`${listId}-${options.length}`}
              role="option"
              aria-selected={active === options.length}
              onMouseEnter={() => setActive(options.length)}
              onClick={() => {
                setOpen(false);
                onBrowseAll();
              }}
              className="px-5 py-3 border-t flex items-center justify-between text-xs font-mono cursor-pointer"
              style={{
                borderColor: 'var(--border-hairline)',
                color: 'var(--accent-crimson)',
                backgroundColor: active === options.length ? 'var(--bg-subtle)' : undefined,
              }}
            >
              <span>
                {matches.length
                  ? `See all ${matches.length.toLocaleString('en-GB')} ${matches.length === 1 ? 'result' : 'results'}`
                  : `Nothing matches “${query.trim()}”, so browse the repertoire`}
              </span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------------------------ */

interface RepertoireCatalogueProps {
  /** The search bar's text (the bar itself lives above, in the Libretto tab). */
  query: string;
  pickedId: string | null;
  onPick: (w: RepertoireWork) => void;
  /** Title of the work open in the live libretto, shown until the listener picks another. */
  currentTitle: string;
  liveWorks: LiveWorkLink[];
  onOpenLive: (workId: string) => void;
  /** The Discover timetable's listings, matched to works to show London performances. */
  events: TimetableEvent[];
  /** Open Discover → Events filtered to this text, with every date shown. */
  onOpenTimetable: (query: string) => void;
  /** Open Discover → Events at a venue (Timetable venue id): its pin on the map and its listings matching `query`. */
  onOpenVenue: (venueId: string, query?: string) => void;
  /** Open the Journey Planner to a venue or one performance. */
  onPlanJourney: (request: JourneyRequest) => void;
}

export const RepertoireCatalogue: React.FC<RepertoireCatalogueProps> = ({
  query,
  pickedId,
  onPick,
  currentTitle,
  liveWorks,
  onOpenLive,
  events,
  onOpenTimetable,
  onOpenVenue,
  onPlanJourney,
}) => {
  const { index, error, searchable } = useRepertoire();
  const london = useLondon(index, events);
  const sortCtx = useMemo<SortCtx>(() => ({ london: london.count }), [london]);
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [reverse, setReverse] = useState(false);
  const [needSynopsis, setNeedSynopsis] = useState(false);
  const [needCast, setNeedCast] = useState(false);
  const [needAudio, setNeedAudio] = useState(false);
  const [needLondon, setNeedLondon] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<RepertoireDetail | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const search = useWorkSearch(query, index, searchable, kind);

  const listed = useMemo(() => {
    let rows = [...search.matches];
    if (needSynopsis) rows = rows.filter((w) => w.has_synopsis);
    if (needCast) rows = rows.filter((w) => w.roles_count > 0);
    if (needAudio) rows = rows.filter((w) => (w.audio_count ?? 0) > 0);
    if (needLondon) rows = rows.filter((w) => london.count(w.id) > 0);
    // Array.sort is stable, so ties keep the best-match / most-popular order.
    const cmp = SORTS.find((s) => s.id === sort)?.cmp;
    if (cmp) rows.sort((a, b) => cmp(a, b, sortCtx));
    if (reverse) rows.reverse();
    return rows;
  }, [search.matches, sort, reverse, needSynopsis, needCast, needAudio, needLondon, london, sortCtx]);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, opera: 0, operetta: 0, musical: 0 };
    for (const w of index?.works ?? []) {
      c.all++;
      c[w.kind]++;
    }
    return c;
  }, [index]);

  const picked = useMemo(() => {
    if (!index) return null;
    const byId = pickedId ? index.works.find((w) => w.id === pickedId) : undefined;
    // The index is most-staged first, so this finds Tosca the Puccini opera rather than a namesake.
    return byId ?? index.works.find((w) => fold(w.title) === fold(currentTitle)) ?? index.works[0];
  }, [index, pickedId, currentTitle]);

  useEffect(() => {
    if (!picked || !index) return;
    let live = true;
    setDetail(null);
    loadDetail(picked.id, index.shards).then((d) => live && setDetail(d ?? null));
    return () => {
      live = false;
    };
  }, [picked, index]);

  useEffect(() => setLimit(PAGE), [query, kind, sort, reverse, needSynopsis, needCast, needAudio, needLondon]);

  const pick = (w: RepertoireWork) => {
    onPick(w);
    // On one-column layouts the notes sit below the list, so bring them into view.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  if (error) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        The repertoire couldn’t be loaded ({error}). Run <code>npm run libretti</code> to build it.
      </p>
    );
  }
  if (!index) {
    return (
      <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
        Loading repertoire…
      </p>
    );
  }

  const sortDef = SORTS.find((s) => s.id === sort)!;
  const showMetric = sortDef.metric;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* List */}
      <div className="lg:col-span-5 space-y-3 min-w-0 lg:sticky lg:top-24">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Chip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
              <k.Icon className="w-3 h-3 inline -mt-0.5 mr-1" />
              {k.label} <span className="tabular-nums opacity-70">{counts[k.id].toLocaleString('en-GB')}</span>
            </Chip>
          ))}
        </div>

        {search.offer && (search.suggestions.length > 0 || search.thinking) && (
          <DidYouMean suggestions={search.suggestions} thinking={search.thinking} pickedId={picked?.id ?? null} onPick={pick} />
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-mono min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
            {listed.length.toLocaleString('en-GB')} {listed.length === 1 ? 'work' : 'works'}
            {query.trim() ? ` for “${query.trim()}”` : ''}
          </p>
          <SortMenu
            sort={sort}
            onSort={setSort}
            reverse={reverse}
            onReverse={setReverse}
            needSynopsis={needSynopsis}
            onNeedSynopsis={setNeedSynopsis}
            needCast={needCast}
            onNeedCast={setNeedCast}
            needAudio={needAudio}
            onNeedAudio={setNeedAudio}
            needLondon={needLondon}
            onNeedLondon={setNeedLondon}
            searching={!!query.trim()}
            hasViews={!!index.views_window}
            hasMedia={!!index.media_at}
          />
        </div>

        <ul
          className="space-y-1.5 max-h-[45vh] lg:max-h-[calc(100dvh-16rem)] overflow-y-auto pr-1 border-t pt-2"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          {listed.slice(0, limit).map((w) => {
            const active = picked?.id === w.id;
            const live = liveMatch(w, liveWorks);
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => pick(w)}
                  aria-current={active || undefined}
                  className="w-full text-left rounded-lg border p-2.5 flex gap-3 cursor-pointer hover:opacity-85 transition-opacity"
                  style={{
                    backgroundColor: active ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                    borderColor: active ? 'var(--accent-crimson)' : 'var(--border-hairline)',
                  }}
                >
                  <Thumb w={w} className="w-14 h-[4.5rem]" iconClass="w-6 h-6" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-fraunces text-[15px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {w.title}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {live ? <span style={{ color: 'var(--accent-crimson)' }}>● live · </span> : null}
                        {w.year ?? '—'}
                      </span>
                    </span>
                    <span
                      className="mt-0.5 flex items-center gap-x-3 gap-y-0.5 text-[11px] font-mono min-w-0"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <User className="w-3 h-3 shrink-0" />
                        <span className="truncate">{w.composers.join(', ') || 'Composer unknown'}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        {React.createElement(KIND_ICON[w.kind], { className: 'w-3 h-3' })}
                        {kindLabel(w)}
                      </span>
                    </span>
                    {w.summary && (
                      <span className="mt-1 block text-[12px] leading-snug line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                        {w.summary}
                      </span>
                    )}
                    <RowFacts w={w} metric={showMetric?.(w, sortCtx) ?? null} MetricIcon={sortDef.Icon} londonCount={london.count(w.id)} />
                  </span>
                </button>
              </li>
            );
          })}
          {listed.length === 0 && !search.thinking && (
            <li className="text-sm py-2" style={{ color: 'var(--text-secondary)' }}>
              Nothing matches “{query}”. Try a composer’s surname, fewer words, or describe the plot.
            </li>
          )}
          {listed.length > limit && (
            <li>
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE * 2)}
                className="w-full py-2 text-xs font-mono underline underline-offset-2 cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                Show more ({(listed.length - limit).toLocaleString('en-GB')} left)
              </button>
            </li>
          )}
        </ul>
      </div>

      {/* Detail */}
      <div ref={detailRef} className="lg:col-span-7 min-w-0 scroll-mt-24">
        {picked && (
          <WorkDetail
            work={picked}
            detail={detail}
            licenseNote={index.license_note}
            live={liveMatch(picked, liveWorks)}
            onOpenLive={onOpenLive}
            performances={london.byWork.get(picked.id) ?? []}
            onOpenTimetable={onOpenTimetable}
            onOpenVenue={onOpenVenue}
            onPlanJourney={onPlanJourney}
          />
        )}
      </div>
    </div>
  );
};

const VIA_LABEL: Record<WorkSuggestion['via'], string> = { spelling: 'close spelling', meaning: 'from your description', atlas: 'similar' };

/** "Are you referring to:" — works that a typo or a description might mean, as pills with a picture and a line on each. */
const DidYouMean: React.FC<{
  suggestions: WorkSuggestion[];
  thinking: boolean;
  pickedId: string | null;
  onPick: (w: RepertoireWork) => void;
}> = ({ suggestions, thinking, pickedId, onPick }) => (
  <section
    aria-label="Suggested works"
    className="rounded-xl border p-3"
    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
  >
    <p className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
      <ArgonTag pending={thinking}>Argon</ArgonTag>
      Are you referring to:
    </p>
    <ul className="mt-2 flex flex-wrap gap-2">
      {suggestions.map(({ w, why, via }) => (
        <li key={w.id} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onPick(w)}
            aria-current={pickedId === w.id || undefined}
            className="max-w-full text-left rounded-2xl border pl-1.5 pr-3 py-1.5 flex items-start gap-2.5 cursor-pointer hover:opacity-85 transition-opacity"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: pickedId === w.id ? 'var(--accent-crimson)' : 'var(--border-hairline)',
            }}
          >
            <Thumb w={w} className="w-9 h-9 rounded-full!" iconClass="w-4 h-4" />
            <span className="min-w-0">
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-fraunces text-[14px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {w.title}
                </span>
                <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--accent-crimson)' }}>
                  {VIA_LABEL[via]}
                </span>
              </span>
              <span className="block text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                {byline(w)}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                {via === 'meaning' && why ? why : w.tagline || w.summary}
              </span>
            </span>
          </button>
        </li>
      ))}
      {thinking && (
        <li
          className="rounded-2xl border px-3 py-2 text-[12px] font-mono animate-pulse"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}
        >
          Reading what you described…
        </li>
      )}
    </ul>
  </section>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; subtle?: boolean; children: React.ReactNode }> = ({
  active,
  onClick,
  subtle,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`px-2.5 py-1 rounded-md text-[11px] font-mono cursor-pointer border transition-colors ${
      active ? (subtle ? 'font-semibold' : 'bg-[#9E1B32] text-[#FAF6F0] border-[#9E1B32] font-semibold') : 'hover:opacity-90'
    }`}
    style={
      active
        ? subtle
          ? { backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--text-muted)' }
          : undefined
        : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)', borderColor: 'var(--border-hairline)' }
    }
  >
    {children}
  </button>
);

/** A quiet line of small icon facts under each card: the active sort's figure first, then language and cast/synopsis flags. */
const RowFacts: React.FC<{ w: RepertoireWork; metric: string | null; MetricIcon: LucideIcon; londonCount: number }> = ({
  w,
  metric,
  MetricIcon,
  londonCount,
}) => {
  const facts = [
    metric && { Icon: MetricIcon, text: metric, strong: true },
    !metric?.endsWith('in London') && londonCount > 0 && { Icon: MapPin, text: `${londonCount} in London`, strong: true },
    (w.audio_count ?? 0) > 0 && !metric?.endsWith('clips') && { Icon: Headphones, text: `${w.audio_count} ${w.audio_count === 1 ? 'clip' : 'clips'}` },
    w.languages.length > 0 && { Icon: Languages, text: w.languages.slice(0, 2).join(' / ') },
    w.has_synopsis && { Icon: FileText, text: 'Synopsis' },
    w.roles_count > 0 && { Icon: Mic2, text: 'Cast' },
  ].filter(Boolean) as { Icon: LucideIcon; text: string; strong?: boolean }[];
  if (!facts.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
      {facts.map(({ Icon, text, strong }) => (
        <span key={text} className="inline-flex items-center gap-1" style={strong ? { color: 'var(--accent-crimson)' } : undefined}>
          <Icon className="w-3 h-3" /> {text}
        </span>
      ))}
    </span>
  );
};

interface SortMenuProps {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  reverse: boolean;
  onReverse: (v: boolean) => void;
  needSynopsis: boolean;
  onNeedSynopsis: (v: boolean) => void;
  needCast: boolean;
  onNeedCast: (v: boolean) => void;
  needAudio: boolean;
  onNeedAudio: (v: boolean) => void;
  needLondon: boolean;
  onNeedLondon: (v: boolean) => void;
  searching: boolean;
  hasViews: boolean;
  hasMedia: boolean;
}

/** "Sort" button with a popover holding every sort order and the few extra filters, so the list header stays calm. */
const SortMenu: React.FC<SortMenuProps> = (p) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = SORTS.find((s) => s.id === p.sort)!;
  const currentLabel = p.sort === 'relevance' ? (p.searching ? 'Best match' : 'Popular') : current.label;
  const extras = Number(p.reverse) + Number(p.needSynopsis) + Number(p.needCast) + Number(p.needAudio) + Number(p.needLondon);
  const available = SORTS.filter(
    (s) => (p.hasViews || !['views', 'rising', 'depth'].includes(s.id)) && (p.hasMedia || s.id !== 'audio')
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono cursor-pointer hover:opacity-90"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: open ? 'var(--accent-crimson)' : 'var(--border-hairline)' }}
      >
        <ArrowUpDown className="w-3 h-3" style={{ color: 'var(--accent-crimson)' }} />
        <span className="hidden min-[400px]:inline" style={{ color: 'var(--text-muted)' }}>Sort</span>
        <span className="font-semibold">{currentLabel}</span>
        {extras > 0 && (
          <span className="rounded-full px-1.5 text-[9px] bg-[#9E1B32] text-[#FAF6F0]" aria-label={`${extras} extra options on`}>
            +{extras}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Sort and filter"
          className="absolute right-0 top-full mt-2 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border shadow-xl p-2 animate-folio-enter"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
        >
          {(['Popularity', 'Date & name'] as const).map((group) => (
            <div key={group} role="radiogroup" aria-label={group} className="py-1">
              <p className="px-3 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                {group}
              </p>
              {available
                .filter((s) => s.group === group)
                .map((s) => {
                  const on = p.sort === s.id;
                  const label = s.id === 'relevance' && p.searching ? 'Best match' : s.label;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => p.onSort(s.id)}
                      className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left cursor-pointer hover:bg-[var(--bg-subtle)]"
                    >
                      <s.Icon className="w-4 h-4 shrink-0" style={{ color: on ? 'var(--accent-crimson)' : 'var(--text-muted)' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-fraunces text-[14px] leading-tight" style={{ color: 'var(--text-primary)', fontWeight: on ? 600 : 400 }}>
                          {label}
                        </span>
                        <span className="block text-[10px] font-mono leading-tight" style={{ color: 'var(--text-muted)' }}>
                          {s.id === 'relevance' && p.searching ? 'Title matches first, then by popularity' : s.hint}
                        </span>
                      </span>
                      {on && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-crimson)' }} />}
                    </button>
                  );
                })}
            </div>
          ))}

          <div className="border-t mt-1 pt-2 px-1 space-y-0.5" style={{ borderColor: 'var(--border-hairline)' }}>
            <Toggle label="Reverse order" on={p.reverse} onChange={p.onReverse} />
            <Toggle label="Only with a synopsis" on={p.needSynopsis} onChange={p.onNeedSynopsis} />
            <Toggle label="Only with a cast list" on={p.needCast} onChange={p.onNeedCast} />
            {p.hasMedia && <Toggle label="Only with recordings" on={p.needAudio} onChange={p.onNeedAudio} />}
            <Toggle label="Only playing in London" on={p.needLondon} onChange={p.onNeedLondon} />
            {(p.sort !== 'relevance' || extras > 0) && (
              <button
                type="button"
                onClick={() => {
                  p.onSort('relevance');
                  p.onReverse(false);
                  p.onNeedSynopsis(false);
                  p.onNeedCast(false);
                  p.onNeedAudio(false);
                  p.onNeedLondon(false);
                }}
                className="mt-1 px-2 py-1 text-[11px] font-mono underline underline-offset-2 cursor-pointer"
                style={{ color: 'var(--accent-crimson)' }}
              >
                Reset
              </button>
            )}
          </div>
          {p.hasViews && (
            <p className="px-3 pt-2 pb-1 text-[10px] font-mono leading-snug" style={{ color: 'var(--text-muted)' }}>
              Popularity is a proxy from English Wikipedia (pageviews, language editions, article length), not box-office or ticket data.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const Toggle: React.FC<{ label: string; on: boolean; onChange: (v: boolean) => void }> = ({ label, on, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={() => onChange(!on)}
    className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-subtle)]"
  >
    <span className="font-fraunces text-[14px]" style={{ color: 'var(--text-primary)' }}>
      {label}
    </span>
    <span
      className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
      style={{ backgroundColor: on ? 'var(--accent-crimson)' : 'var(--border-hairline)' }}
    >
      <span
        className="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? 'translateX(14px)' : undefined }}
      />
    </span>
  </button>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[10px] font-mono uppercase tracking-[0.2em] block font-semibold" style={{ color: 'var(--text-muted)' }}>
    {children}
  </span>
);

const WorkDetail: React.FC<{
  work: RepertoireWork;
  detail: RepertoireDetail | null;
  licenseNote: string;
  live?: LiveWorkLink;
  onOpenLive: (workId: string) => void;
  performances: TimetableEvent[];
  onOpenTimetable: (query: string) => void;
  onOpenVenue: (venueId: string, query?: string) => void;
  onPlanJourney: (request: JourneyRequest) => void;
}> = ({ work, detail, licenseNote, live, onOpenLive, performances, onOpenTimetable, onOpenVenue, onPlanJourney }) => {
  const words = work.kind === 'musical' ? [...new Set([...work.librettists, ...work.lyricists])] : work.librettists;
  const facts: [string, string | null | undefined][] = [
    ['Music', work.composers.join(', ')],
    [work.kind === 'musical' ? 'Book & lyrics' : 'Libretto', words.join(', ')],
    ['Book', work.kind === 'musical' && !words.length ? detail?.book : null],
    ['Premiere', [detail?.premiere_date ?? work.year, work.premiere_venue].filter(Boolean).join(' · ')],
    ['Language', work.languages.join(', ')],
    ['Based on', work.based_on.join('; ')],
    ['Productions', detail?.productions],
    ['Awards', detail?.awards],
  ];

  const dock = useMediaDock();
  const trend = trendOf(work);
  const stats = [
    (work.views_12m ?? 0) > 0 && { Icon: Eye, text: `${compact.format(work.views_12m!)} views / yr`, title: 'English Wikipedia pageviews, last 12 months' },
    trend != null && {
      Icon: TrendingUp,
      text: `${trend >= 0 ? '+' : '−'}${Math.round(Math.abs(trend) * 100)}% recently`,
      title: 'Last 3 months vs. the 12-month average',
    },
    work.popularity > 1 && { Icon: Globe, text: `${work.popularity} Wikipedia languages`, title: 'Language editions with an article on this work' },
    work.roles_count > 0 && { Icon: Mic2, text: `${work.roles_count} roles` },
    (work.audio_count ?? 0) > 0 && { Icon: Headphones, text: `${work.audio_count} ${work.audio_count === 1 ? 'recording' : 'recordings'}` },
    performances.length > 0 && { Icon: MapPin, text: `${performances.length} in London`, title: 'Upcoming performances in Discover Events' },
  ].filter(Boolean) as { Icon: LucideIcon; text: string; title?: string }[];

  return (
    <article
      key={work.id}
      className="rounded-2xl border p-6 sm:p-8 space-y-7 animate-folio-enter"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
    >
      <header className="space-y-2 relative">
        {work.thumb && <Thumb w={work} width={320} className="float-right ml-4 mb-2 w-24 h-32 sm:w-28 sm:h-36 rounded-lg" iconClass="w-8 h-8" />}
        <p className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em]" style={{ color: 'var(--accent-crimson)' }}>
          {React.createElement(KIND_ICON[work.kind], { className: 'w-3.5 h-3.5' })}
          {kindLabel(work)}
          {work.year ? ` · ${work.year}` : ''}
        </p>
        <h3 className="font-chronicle text-4xl sm:text-5xl tracking-[-0.02em] leading-[1.02]" style={{ color: 'var(--text-primary)' }}>
          {work.title}
        </h3>
        {work.composers.length > 0 && (
          <p className="font-instrument italic text-2xl" style={{ color: 'var(--accent-crimson)' }}>
            {work.composers.join(' & ')}
          </p>
        )}
        {stats.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            {stats.map(({ Icon, text, title }) => (
              <li key={text} title={title} className="inline-flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent-gold)' }} /> {text}
              </li>
            ))}
          </ul>
        )}
        {live && (
          <button
            type="button"
            onClick={() => onOpenLive(live.work_id)}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#9E1B32] hover:bg-[#7F1527] text-[#FAF6F0] font-mono text-[11px] uppercase tracking-[0.12em] cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5" /> Follow the live libretto
          </button>
        )}
      </header>

      {detail?.media && detail.media.images.length > 0 && <Gallery title={work.title} images={detail.media.images} />}

      <dl
        className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border-y py-5"
        style={{ borderColor: 'var(--border-hairline)' }}
      >
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt>
                <Label>{k}</Label>
              </dt>
              <dd className="font-fraunces text-sm mt-0.5 break-words" style={{ color: 'var(--text-primary)' }}>
                {v}
              </dd>
            </div>
          ))}
      </dl>

      <LondonPanel
        work={work}
        performances={performances}
        onOpenTimetable={onOpenTimetable}
        onOpenVenue={onOpenVenue}
        onPlanJourney={onPlanJourney}
      />

      {!detail && (
        <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
          Loading notes…
        </p>
      )}

      {detail && (
        <>
          {detail.lead && <Paragraphs text={detail.lead} />}

          {detail.media && detail.media.audio.length > 0 && <Recordings clips={detail.media.audio} />}

          {detail.scores && detail.scores.files.length > 0 && <SheetMusic scores={detail.scores} />}

          {detail.roles.length > 0 && (
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                      <th className="py-1.5 pr-4 font-medium">Role</th>
                      <th className="py-1.5 pr-4 font-medium">Voice</th>
                      {detail.roles.some((r) => r.premiere_cast) && <th className="py-1.5 font-medium">Premiere cast</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.roles.map((r, i) => (
                      <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--border-hairline)' }}>
                        <td className="py-1.5 pr-4 font-fraunces" style={{ color: 'var(--text-primary)' }}>
                          {r.name}
                        </td>
                        <td className="py-1.5 pr-4 font-mono text-xs" style={{ color: 'var(--accent-gold)' }}>
                          {r.voice ?? '—'}
                        </td>
                        {detail.roles.some((x) => x.premiere_cast) && (
                          <td className="py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {r.premiere_cast ?? ''}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail.synopsis.length > 0 && (
            <div className="space-y-2">
              <Label>Synopsis</Label>
              {detail.synopsis.map((s, i) =>
                s.heading ? (
                  <details
                    key={i}
                    open={i === detail.synopsis.findIndex((x) => x.heading && /^(act|part|scene|prologue)\b/i.test(x.heading))}
                    className="border-t pt-2"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  >
                    <summary
                      className="cursor-pointer font-fraunces text-[15px] font-semibold py-1"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {s.heading}
                    </summary>
                    <Paragraphs text={s.text} />
                  </details>
                ) : (
                  <Paragraphs key={i} text={s.text} />
                )
              )}
            </div>
          )}

          {detail.numbers.length > 0 && (
            <details className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border-hairline)' }}>
              <summary className="cursor-pointer">
                <span className="inline-block align-middle">
                  <Label>Musical numbers ({detail.numbers.reduce((n, g) => n + g.items.length, 0)})</Label>
                </span>
              </summary>
              {detail.numbers.map((g, i) => (
                <div key={i} className="mt-2">
                  {g.heading && (
                    <p className="font-fraunces text-sm font-semibold mt-3 mb-1" style={{ color: 'var(--text-primary)' }}>
                      {g.heading}
                    </p>
                  )}
                  <ol className="space-y-0.5 text-sm list-none">
                    {g.items.map((item, j) => (
                      <li key={j} className="group flex items-start justify-between gap-3 font-fraunces" style={{ color: 'var(--text-secondary)' }}>
                        <span className="min-w-0">{item}</span>
                        <ListenButtons query={youtubeQuery(work, item)} title={item} subtitle={work.title} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </details>
          )}

          {!detail.synopsis.length && !detail.roles.length && !detail.numbers.length && !detail.media?.audio.length && (
            <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
              <BookOpen className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              No synopsis or cast list is available offline for this work yet.
            </p>
          )}
        </>
      )}

      <footer
        className="border-t pt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono"
        style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}
      >
        <span className="max-w-md">{licenseNote}</span>
        <a
          href={work.wikipedia_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2"
          style={{ color: 'var(--accent-gold)' }}
        >
          Wikipedia <ExternalLink className="w-3 h-3" />
        </a>
      </footer>
    </article>
  );
};

/**
 * What to search YouTube for to hear one musical number: the work, the composer's surname and the number's own name,
 * without the singers ("Habanera: L'amour est un oiseau rebelle (Carmen, chorus)" → "Carmen Bizet Habanera: L'amour est…").
 */
export function youtubeQuery(work: Pick<RepertoireWork, 'title' | 'composers'>, item: string): string {
  const name =
    item
      .replace(/\s+[–—-]\s+.*$/, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/^(?:no\.?\s*)?\d+[a-z]?[.:)]?\s+/i, '')
      .replace(/["“”]/g, '')
      .trim() || item;
  const composer = work.composers[0]?.split(/\s+/).at(-1) ?? '';
  return [work.title, composer, name].filter(Boolean).join(' ');
}

/** "from £15", "£15–£95": the cheapest and dearest tickets across some listings, or null when none gives a price. */
function priceSpan(events: TimetableEvent[]): string | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of events) {
    const p = parseListingPrice(e.price);
    if (!p) continue;
    lo = Math.min(lo, p.min);
    hi = Math.max(hi, p.max ?? p.min);
  }
  if (lo === Infinity) return null;
  return hi > lo ? `${gbp(lo)}–${gbp(hi)}` : `from ${gbp(lo)}`;
}

/**
 * Upcoming London performances of the work, from the Discover timetable: each venue (opens its pin and listings in
 * Discover, with a journey planner button) and each date, with prices, tickets and a planner button of its own.
 */
const LondonPanel: React.FC<{
  work: RepertoireWork;
  performances: TimetableEvent[];
  onOpenTimetable: (query: string) => void;
  onOpenVenue: (venueId: string, query?: string) => void;
  onPlanJourney: (request: JourneyRequest) => void;
}> = ({ work, performances, onOpenTimetable, onOpenVenue, onPlanJourney }) => {
  const [shown, setShown] = useState(8);
  useEffect(() => setShown(8), [work.id]);
  // Many listings (the Royal Opera House's among them) give no price: fall back to the venue's usual range.
  const [planIndex, setPlanIndex] = useState<SeatPlanSummary[]>([]);
  useEffect(() => {
    loadSeatPlanIndex().then(setPlanIndex);
  }, []);
  const usual = (e: TimetableEvent) => usualPriceAt(planIndex, { id: e.venue_id, name: e.venue_name, hall: e.hall });

  const venues = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; events: TimetableEvent[] }>();
    for (const e of performances) {
      const v = byId.get(e.venue_id) ?? byId.set(e.venue_id, { id: e.venue_id, name: e.venue_name, events: [] }).get(e.venue_id)!;
      v.events.push(e);
    }
    return [...byId.values()].sort((a, b) => b.events.length - a.events.length);
  }, [performances]);
  // The listing's own wording ("Phantom Of The Opera") is what the timetable's search box will find.
  const searchText = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of performances) n.set(e.title, (n.get(e.title) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? work.title;
  }, [performances, work.title]);
  const overall = useMemo(() => priceSpan(performances), [performances]);

  const last = performances.at(-1);
  return (
    <section className="space-y-3" aria-label="Performances in London">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>
          <MapPin className="w-3 h-3 inline -mt-0.5 mr-1" />
          In London
        </Label>
        <button
          type="button"
          onClick={() => onOpenTimetable(searchText)}
          data-href={`/discover/events?${new URLSearchParams({ q: searchText, exact: '1', range: 'all' })}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono underline underline-offset-2 cursor-pointer"
          style={{ color: 'var(--accent-crimson)' }}
        >
          {performances.length ? 'Open in Discover Events' : 'Search Discover Events'} <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {performances.length === 0 ? (
        <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
          No upcoming London performances of {work.title} in Events.
        </p>
      ) : (
        <>
          <p className="font-fraunces text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{performances.length.toLocaleString('en-GB')}</strong>{' '}
            {performances.length === 1 ? 'performance' : 'performances'} listed, from {shortDate(performances[0])}
            {last && last !== performances[0] ? ` to ${shortDate(last)}` : ''}
            {overall ? `, tickets ${overall}` : usual(performances[0]) ? `; tickets usually ${gbpRange(usual(performances[0])!)} there` : ''}.
          </p>

          <ul className="grid gap-2 sm:grid-cols-2">
            {venues.map((v) => {
              const range = priceSpan(v.events) ?? (usual(v.events[0]) && `usually ${gbpRange(usual(v.events[0])!)}`);
              return (
                <li
                  key={v.id}
                  className="flex items-center gap-2 rounded-lg border p-2.5"
                  style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenVenue(v.id, v.events[0].title)}
                    data-href={`/discover/events?${new URLSearchParams({ venue: v.id, q: v.events[0].title, exact: '1', range: 'all' })}`}
                    title={`Show ${v.name} on the Discover map, with its ${work.title} dates`}
                    className="min-w-0 flex-1 cursor-pointer text-left hover:opacity-80"
                  >
                    <span className="flex items-center gap-1.5 font-fraunces text-[15px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-crimson)' }} aria-hidden />
                      <span className="truncate underline decoration-dotted underline-offset-2">{v.name}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {v.events.length} {v.events.length === 1 ? 'date' : 'dates'}
                      {range && <span style={{ color: 'var(--accent-gold)' }}> · {range}</span>} · on the map
                    </span>
                  </button>
                  <a
                    href={venuePath(v.id)}
                    data-route
                    title={`Open the ${v.name} page`}
                    className="shrink-0 text-xs font-mono underline underline-offset-2"
                    style={{ color: 'var(--accent-crimson)' }}
                  >
                    Venue page
                  </a>
                  <PlanJourneyButton
                    title={`Plan your journey to ${v.name}`}
                    onPlan={(fromHere) => onPlanJourney({ venueId: v.id, fromHere })}
                  />
                </li>
              );
            })}
          </ul>

          <ul className="divide-y border-y" style={{ borderColor: 'var(--border-hairline)' }}>
            {performances.slice(0, shown).map((e) => (
              <li key={e.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                <a
                  href={eventPath(e.id)}
                  data-route
                  title={`Open the page for ${e.title} on ${shortDate(e)}`}
                  className="font-mono text-xs tabular-nums w-[8.5rem] shrink-0 hover:underline underline-offset-2"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {shortDate(e)} · {timeLabel(e)}
                </a>
                <span className="font-fraunces min-w-0 flex-1 basis-40 truncate" style={{ color: 'var(--text-secondary)' }}>
                  <a
                    href={venuePath(e.venue_id)}
                    data-route
                    title={`Open the ${e.venue_name} page`}
                    className="hover:underline underline-offset-2"
                  >
                    {e.venue_name}
                  </a>
                  {e.hall && e.hall !== e.venue_name ? ` · ${e.hall}` : ''}
                </span>
                <span
                  className="font-mono text-xs"
                  style={{ color: e.price ? 'var(--accent-gold)' : 'var(--text-muted)' }}
                  title={e.price ? undefined : 'No price listed: the venue’s usual range'}
                >
                  {e.price ?? (usual(e) ? `usually ${gbpRange(usual(e)!)}` : 'price TBC')}
                </span>
                <a
                  href={eventPath(e.id)}
                  data-route
                  className="text-xs font-mono underline underline-offset-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Event page
                </a>
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Tickets for ${e.title} at ${e.venue_name}`}
                    className="inline-flex items-center gap-1 text-xs font-mono underline underline-offset-2"
                    style={{ color: 'var(--accent-crimson)' }}
                  >
                    Tickets <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <PlanJourneyButton
                  compact
                  title={`Plan your journey to ${e.venue_name} for ${shortDate(e)}${e.time_known ? `, arriving before ${timeLabel(e)}` : ''}`}
                  onPlan={(fromHere) => onPlanJourney({ venueId: e.venue_id, eventId: e.id, fromHere })}
                />
              </li>
            ))}
          </ul>
          {performances.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + 20)}
              className="text-xs font-mono underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              Show more ({(performances.length - shown).toLocaleString('en-GB')} left)
            </button>
          )}
        </>
      )}
    </section>
  );
};

/** The recordings on the Wikipedia page, streamed from Wikipedia and Wikimedia Commons; starting one stops the others. */
const SheetMusic: React.FC<{ scores: NonNullable<RepertoireDetail['scores']> }> = ({ scores }) => (
  <div className="space-y-2">
    <Label>Sheet music ({scores.files.length})</Label>
    <ul className="space-y-1.5">
      {scores.files.map((s) => (
        <li key={s.file} className="rounded-lg border p-2.5 text-[13px]" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}>
          <a href={s.page} target="_blank" rel="noreferrer" className="font-fraunces font-medium underline underline-offset-2" style={{ color: 'var(--text-primary)' }}>
            {s.kind === 'vocal' ? 'Vocal score' : 'Full score'}
            {s.publisher && ` · ${s.publisher}`}
            {s.year && ` ${s.year}`}
          </a>
          <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {[s.lang, s.editor && `ed. ${s.editor}`, s.translator && `tr. ${s.translator}`].filter(Boolean).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
    <a href={scores.imslp} target="_blank" rel="noreferrer" className="text-[11px] font-mono underline underline-offset-2" style={{ color: 'var(--text-muted)' }}>
      All editions on IMSLP
    </a>
  </div>
);

const Recordings: React.FC<{ clips: RepertoireAudio[] }> = ({ clips }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const stopOthers = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    rootRef.current?.querySelectorAll('audio').forEach((a) => a !== e.currentTarget && a.pause());
  };
  return (
    <div ref={rootRef} className="space-y-2">
      <Label>
        <Headphones className="w-3 h-3 inline -mt-0.5 mr-1" />
        Listen ({clips.length})
      </Label>
      <ul className="space-y-2">
        {clips.map((c) => (
          <li key={c.f} className="rounded-lg border p-2.5" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}>
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-fraunces text-[14px] font-medium min-w-0" style={{ color: 'var(--text-primary)' }}>
                {c.t}
              </span>
              {c.d > 0 && (
                <span className="font-mono text-[11px] tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {clock(c.d)}
                </span>
              )}
            </p>
            <audio controls preload="none" src={commonsFile(c.f)} onPlay={stopOthers} className="w-full mt-1.5 h-9" aria-label={c.t} />
            <p className="mt-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {[c.by && `by ${c.by}`, c.lic].filter(Boolean).join(' · ')}
              {c.by || c.lic ? ' · ' : ''}
              <a href={commonsPage(c.f)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Wikipedia
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The pictures on the Wikipedia page, at the top of the work's pane: a scrolling strip that opens each one full size. */
const Gallery: React.FC<{ title: string; images: RepertoireImage[] }> = ({ title, images }) => (
  <div className="space-y-2">
    <Label>
      <Images className="w-3 h-3 inline -mt-0.5 mr-1" />
      Pictures ({images.length})
    </Label>
    <ul className="flex gap-3 overflow-x-auto pb-2 snap-x">
      {images.map((im) => (
        <li key={im.f} className="shrink-0 w-52 snap-start">
          <a href={commonsPage(im.f)} target="_blank" rel="noreferrer" title={[im.c, im.by && `by ${im.by}`, im.lic].filter(Boolean).join(' · ')}>
            <img
              src={commonsFile(im.f, 420)}
              alt={im.c || `${title}: ${im.f.replace(/\.\w+$/, '')}`}
              loading="lazy"
              decoding="async"
              className={`w-52 h-40 rounded-lg border ${im.w < 400 ? 'object-contain' : 'object-cover'}`}
              style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)' }}
            />
          </a>
          {im.c && (
            <p className="mt-1 text-[11px] leading-snug line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {im.c}
            </p>
          )}
        </li>
      ))}
    </ul>
  </div>
);

const Paragraphs: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-2.5 py-1">
    {text.split('\n').map((p, i) => (
      <p key={i} className="font-fraunces text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {p}
      </p>
    ))}
  </div>
);
