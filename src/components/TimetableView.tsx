import { detectSource, SOURCE_META, type EventSourceId } from '../utils/eventSource';
import { PRICE_CAP, TimetableFilters, type CheckItem } from './TimetableFilters';
import { SourceBadge } from './SourceLogo';
import React, { Suspense, lazy, useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import { CalendarDays, Landmark, MapPin, Music, SlidersHorizontal, Theater, Ticket, type LucideIcon } from 'lucide-react';
import type { MapBounds } from './TimetableMap';
import type { CivicNode, LiveEvent, OpenLondonLiveTelemetry, WorkAndLibretto } from '../types/sottovoce';
import {
  CATEGORY_BY_ID,
  TIMETABLE_CATEGORIES,
  VENUE_KINDS,
  type TimetableCategory,
  type TimetableData,
  type TimetableEvent,
  type VenueKind,
} from '../data/timetableCategories';
import { eventPath, readParams, setParams, venuePath } from '../utils/urlState';
import { LEGACY_RANGES, RANGE_PRESETS, resolveRange, type RangeId } from '../utils/dateRanges';
import { useSavedEvents } from '../utils/savedEvents';
import { recordHistory } from '../utils/history';
import { literalEventMatch } from '../utils/eventSearch';
import { useEventSearch } from '../utils/useEventSearch';
import { dayKey, eventDay, minPrice, shortDate, timeLabel } from '../utils/timetableFormat';
import { SvgIcon } from '../utils/svgIcons';
import { loadSeatPlanIndex, type SeatPlanSummary } from '../utils/seatPlan';
import { gbpRange, usualPriceAt } from '../utils/seatPrices';

const TimetableMap = lazy(() => import('./TimetableMap'));

interface TimetableViewProps {
  data: TimetableData;
  /** What the map layers on top of the listings: the app's venues and civic locations, live events, libretti and live conditions. */
  civicNodes: CivicNode[];
  liveEvents: LiveEvent[];
  works: WorkAndLibretto[];
  activeVenueId?: string;
  openLondonTelemetry?: OpenLondonLiveTelemetry;
  onRefreshTelemetry?: () => void;
  refreshingTelemetry?: boolean;
  onOpenWork?: (workId: string) => void;
  /** Open the Journey Planner at a venue (map or Timetable venue id); with `plan`, plan a trip there (to one performance). */
  onPlanJourney?: (venueId: string, plan?: { eventId?: string; fromHere: boolean }) => void;
  /** Show this venue (a map venue or Timetable venue id) on the map; `n` changes on every request. */
  focusRequest?: { id: string; n: number } | null;
  /** Filter the list to this Timetable venue, over all dates; `n` changes on every request. */
  venueRequest?: { id: string; n: number } | null;
}

type Grouping = 'day' | 'venue' | 'source' | 'none';
type Order = 'relevance' | 'time' | 'price_asc' | 'price_desc' | 'title';

const GROUPINGS: [Grouping, string][] = [['day', 'Day'], ['venue', 'Venue'], ['source', 'Source'], ['none', 'No grouping']];
const RELEVANCE: [Order, string] = ['relevance', 'Best match'];
const ORDERS: [Order, string][] = [['time', 'Soonest first'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['title', 'Title A–Z']];

const DAY_HEADING = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayHeading = (key: string) => DAY_HEADING.format(new Date(`${key}T12:00:00Z`));

export const CategoryPill: React.FC<{ category: TimetableCategory; compact?: boolean }> = ({ category, compact }) => {
  const meta = CATEGORY_BY_ID[category];
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold whitespace-nowrap"
      style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
    >
      <Icon className="w-3 h-3" aria-hidden />
      {compact ? null : meta.label}
    </span>
  );
};

const VENUE_THUMB: Record<VenueKind, { Icon: LucideIcon; color: string }> = {
  opera: { Icon: Landmark, color: '#E5384F' },
  theatre: { Icon: Theater, color: '#F2B531' },
  concert: { Icon: Music, color: '#3FA7E0' },
};

/** A venue's picture (a poster from one of its listings), with a kind-coloured placeholder when there is none or it fails to load. `className` sets the size. */
export const VenueThumb: React.FC<{ kind: VenueKind; image?: string; className?: string; iconClass?: string }> = ({ kind, image, className = 'w-[56px] h-[56px]', iconClass = 'w-5 h-5' }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  const { Icon, color } = VENUE_THUMB[kind];
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md grid place-items-center ${className}`}
      style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 30%, var(--bg-surface)), color-mix(in srgb, ${color} 10%, var(--bg-surface)))`, color }}
    >
      <Icon className={`${iconClass} opacity-70`} aria-hidden />
      {image && !failed && (
        <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
      )}
    </div>
  );
};

/** Red diagonal "Sold out" tag, laid over a poster image (parent must be `relative overflow-hidden`). */
export const SoldOutOverlay: React.FC<{ large?: boolean }> = ({ large }) => (
  <div className="pointer-events-none absolute inset-0 z-[1] grid place-items-center" style={{ backgroundColor: 'rgb(0 0 0 / 0.35)' }} aria-hidden>
    <span
      className={`-rotate-12 whitespace-nowrap rounded-sm border-2 border-white/90 font-mono font-bold uppercase tracking-wider text-white shadow-md ${large ? 'px-4 py-1.5 text-xl' : 'px-1.5 py-0.5 text-[11px]'}`}
      style={{ backgroundColor: '#D4161C' }}
    >
      Sold out
    </span>
  </div>
);

/** "Student" tag for events with discounted student tickets. */
export const StudentTag: React.FC = () => (
  <span
    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide whitespace-nowrap text-white"
    style={{ backgroundColor: SOURCE_META.studentpulse.color }}
  >
    Student
  </span>
);

/** Poster image with a category-coloured placeholder when there is none or it fails to load. */
export const EventThumb: React.FC<{ e: Pick<TimetableEvent, 'image' | 'sold_out'> & { category: string } }> = ({ e }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [e.image]);
  const meta = CATEGORY_BY_ID[e.category as TimetableEvent['category']] ?? CATEGORY_BY_ID.live_music;
  const Icon = meta.icon;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md w-[72px] h-[72px] sm:w-[92px] sm:h-[92px] grid place-items-center"
      style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${meta.color} 30%, var(--bg-surface)), color-mix(in srgb, ${meta.color} 10%, var(--bg-surface)))`, color: meta.color }}
    >
      <Icon className="w-6 h-6 opacity-70" aria-hidden />
      {e.image && !failed && (
        <img
          src={e.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {e.sold_out && <SoldOutOverlay />}
    </div>
  );
};

const EventRow: React.FC<{
  e: TimetableEvent;
  showDate?: boolean;
  onShowOnMap?: (venueId: string) => void;
  hasCoords?: boolean;
  /** The venue's usual price range, shown when the listing gives no price. */
  usual?: [number, number] | null;
}> = ({ e, showDate, onShowOnMap, hasCoords, usual }) => {
  const meta = CATEGORY_BY_ID[e.category];
  const { isSaved, toggle: toggleSaved } = useSavedEvents();
  const saved = isSaved(e.id);
  // The card's default action is its event page (the title link stretches over the card); the heart, venue and map links sit above it.
  const title = (
    <a href={eventPath(e.id)} data-route className="text-left hover:underline underline-offset-2 after:absolute after:inset-0 after:content-['']">
      {e.title}
    </a>
  );
  return (
    <li
      className="relative flex gap-3 rounded-lg border p-2.5"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border-hairline)',
        borderLeft: `4px solid ${meta.color}`,
      }}
    >
      <EventThumb e={e} />
      <div className="grid min-w-0 flex-1 grid-cols-[56px_minmax(0,1fr)] sm:grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 gap-y-1">
      <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {timeLabel(e)}
        {showDate && (
          <span className="block text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
            {shortDate(e)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" aria-hidden />
            <a href={venuePath(e.venue_id)} data-route className="relative z-10 hover:underline underline-offset-2">
              {e.venue_name}
            </a>
            {e.hall ? ` · ${e.hall}` : ''}
          </span>
          {hasCoords && onShowOnMap && (
            <button
              type="button"
              onClick={() => onShowOnMap(e.venue_id)}
              className="relative z-10 underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--accent-crimson)' }}
            >
              Show on map
            </button>
          )}
          {e.price ? (
            <span className="inline-flex items-center gap-1">
              <Ticket className="w-3 h-3" aria-hidden />
              {e.price}
            </span>
          ) : (
            usual && (
              <span className="inline-flex items-center gap-1" style={{ opacity: 0.75 }} title="No price listed: the venue's usual range">
                <Ticket className="w-3 h-3" aria-hidden />
                usually {gbpRange(usual)}
              </span>
            )
          )}
        </div>
      </div>
      <div className="col-start-2 sm:col-start-auto flex flex-wrap sm:flex-col sm:items-end gap-1.5">
        <button
          type="button"
          onClick={() => toggleSaved(e)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${e.title} from Taste Profile` : `Save ${e.title} to Taste Profile`}
          title={saved ? 'Saved to your Taste Profile' : 'Save to your Taste Profile'}
          className="relative z-10 cursor-pointer leading-none sm:order-last"
          style={{ color: saved ? 'var(--accent-crimson)' : 'var(--text-muted)' }}
        >
          <SvgIcon name="heart" size={20} fill={saved} />
        </button>
        <CategoryPill category={e.category} />
        {e.student && <StudentTag />}
        <SourceBadge source={detectSource(e.url, e.source)} prefix="via" />
      </div>
      </div>
    </li>
  );
};

/** Horizontally scrolling rail of hearted events (shown in the Taste tab). */
export const SavedEventsRail: React.FC = () => {
  const { saved, toggle } = useSavedEvents();
  const sorted = useMemo(() => [...saved].sort((a, b) => a.start.localeCompare(b.start)), [saved]);
  if (!sorted.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Nothing saved yet. Tap the heart on a Timetable listing to add it here (<SvgIcon name="heart" size={14} className="inline align-[-2px]" />).
      </p>
    );
  }
  return (
    <>
    <ul className="flex gap-3 overflow-x-auto snap-x pb-2 -mx-1 px-1" aria-label="Saved events">
      {sorted.map((e) => {
        const meta = CATEGORY_BY_ID[e.category];
        return (
          <li
            key={e.id}
            className="relative snap-start shrink-0 w-64 rounded-lg border p-2.5 flex flex-col gap-2"
            style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', borderTop: `4px solid ${meta.color}` }}
          >
            <button
              type="button"
              onClick={() => toggle(e)}
              aria-label={`Remove ${e.title} from Taste Profile`}
              title="Remove from Taste Profile"
              className="absolute top-2 right-2 z-10 cursor-pointer leading-none"
              style={{ color: 'var(--accent-crimson)' }}
            >
              <SvgIcon name="heart" size={18} fill />
            </button>
            <EventThumb e={e} />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                <a href={eventPath(e.id)} data-route className="text-left hover:underline underline-offset-2 after:absolute after:inset-0 after:content-['']">
                  {e.title}
                </a>
              </div>
              <div className="mt-1 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                {shortDate(e)} · {timeLabel(e)}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <a href={venuePath(e.venue_id)} data-route className="relative z-10 hover:underline underline-offset-2">{e.venue_name}</a>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <CategoryPill category={e.category} />
              {e.student && <StudentTag />}
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
};

const KIND_ICONS: Record<string, LucideIcon> = { opera: Landmark, theatre: Theater, concert: Music };

export const TimetableView: React.FC<TimetableViewProps> = ({
  data, civicNodes, liveEvents, works, activeVenueId, openLondonTelemetry, onRefreshTelemetry, refreshingTelemetry, onOpenWork, onPlanJourney,
  focusRequest, venueRequest,
}) => {
  // Filters live in the URL (?category=opera,dance&range=month&sort=venue,source&source=luma&venue=<id>&q=<text>) so a link reopens the same list.
  const [fromUrl] = useState(readParams);
  const [active, setActive] = useState<Set<TimetableCategory>>(
    () => new Set((fromUrl.get('category') ?? '').split(',').filter((c): c is TimetableCategory => c in CATEGORY_BY_ID))
  );
  const [range, setRange] = useState<RangeId>(() => {
    const r = fromUrl.get('range') ?? '';
    return LEGACY_RANGES[r] ?? RANGE_PRESETS.find((p) => p.id === r)?.id ?? 'week';
  });
  const [customFrom, setCustomFrom] = useState(fromUrl.get('from') ?? '');
  const [customTo, setCustomTo] = useState(fromUrl.get('to') ?? '');
  const [group, setGroup] = useState<Grouping>(() => {
    const g = (fromUrl.get('group') ?? fromUrl.get('sort') ?? '').split(',')[0];
    return GROUPINGS.find(([id]) => id === g)?.[0] ?? 'day';
  });
  const [order, setOrder] = useState<Order>(() => [RELEVANCE, ...ORDERS].find(([id]) => id === fromUrl.get('order'))?.[0] ?? 'time');
  const [priceMin, setPriceMin] = useState(() => Math.max(0, Number(fromUrl.get('pmin')) || 0));
  const [priceMax, setPriceMax] = useState<number | null>(() => (fromUrl.get('pmax') ? Number(fromUrl.get('pmax')) : null));
  const [includeUnpriced, setIncludeUnpriced] = useState(fromUrl.get('unpriced') !== '0');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sources, setSources] = useState<Set<EventSourceId>>(
    () => new Set((fromUrl.get('source') ?? '').split(',').filter((k): k is EventSourceId => k in SOURCE_META))
  );
  const [venueId, setVenueId] = useState(() => {
    const id = fromUrl.get('venue') ?? '';
    return data.venues.some((v) => v.id === id) ? id : '';
  });
  const [query, setQuery] = useState(fromUrl.get('q') ?? '');
  // Links that mean one title ("All dates" on an event, a work's listings) match it literally rather than by meaning.
  const [exact, setExact] = useState(fromUrl.get('exact') === '1');
  const [kinds, setKinds] = useState<Set<VenueKind>>(
    () => new Set((fromUrl.get('kind') ?? '').split(',').filter((k): k is VenueKind => VENUE_KINDS.some((x) => x.id === k)))
  );
  const [showMap, setShowMap] = useState(fromUrl.get('map') !== '0');
  const [syncView, setSyncView] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [focus, setFocus] = useState<{ venueId: string; n: number } | null>(null);
  const [limit, setLimit] = useState(200);

  const todayKey = dayKey(new Date());
  const [startKey, endKey] = useMemo(() => {
    const [a, b] = resolveRange(range, customFrom, customTo);
    return [a < todayKey ? todayKey : a, b];
  }, [range, customFrom, customTo, todayKey]);

  const venueById = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  // Seating plans, for the usual price at venues whose listings give none.
  const [planIndex, setPlanIndex] = useState<SeatPlanSummary[]>([]);
  useEffect(() => {
    loadSeatPlanIndex().then(setPlanIndex);
  }, []);

  // Filtering runs on a deferred copy so typing stays responsive.
  const deferredQuery = useDeferredValue(query);
  // The search matches by meaning (Atlas + Argon) unless the text is "quoted" or came from a link that means one title.
  const quoted = /^"(.+)"$/.exec(deferredQuery.trim());
  const needle = quoted ? quoted[1].trim() : deferredQuery.trim();
  const literal = exact || !!quoted;
  const semantic = !literal && needle.length >= 2;
  const search = useEventSearch(semantic ? needle : '', data.events, venueById);
  // A search counts once the typing settles.
  useEffect(() => {
    const t = setTimeout(() => recordHistory('search', query), 1500);
    return () => clearTimeout(t);
  }, [query]);

  // One predicate for every facet; `skip` leaves a facet out so its checklist counts reflect the other filters.
  const passes = useCallback(
    (e: TimetableEvent, skip?: 'category' | 'kind' | 'source' | 'date') => {
      const d = eventDay(e);
      if (skip === 'date' ? d < todayKey : d < startKey || d > endKey) return false;
      if (venueId && e.venue_id !== venueId) return false;
      if (skip !== 'category' && active.size && !active.has(e.category)) return false;
      if (skip !== 'kind' && kinds.size && !kinds.has(venueById.get(e.venue_id)?.kind as VenueKind)) return false;
      if (skip !== 'source' && sources.size && !sources.has(detectSource(e.url, e.source))) return false;
      if (needle && (semantic ? !search.scores?.has(e.id) : !literalEventMatch(e, needle))) return false;
      if (priceMin > 0 || priceMax != null) {
        const p = minPrice(e);
        if (p == null ? !includeUnpriced : p < priceMin || (priceMax != null && p > priceMax)) return false;
      }
      return true;
    },
    [startKey, endKey, todayKey, venueId, active, kinds, sources, needle, semantic, search.scores, priceMin, priceMax, includeUnpriced, venueById]
  );

  const visible = useMemo(() => data.events.filter((e) => passes(e)), [data.events, passes]);
  // Matches the search found on dates outside the chosen range, so a narrow range never hides that something is on.
  const outsideRange = useMemo(
    () => (semantic && range !== 'all' ? data.events.reduce((n, e) => n + (passes(e, 'date') && !passes(e) ? 1 : 0), 0) : 0),
    [semantic, range, data.events, passes]
  );
  // A search is a ranked list: switch to best match with no grouping, and put the old view back when it is cleared.
  const beforeSearch = useRef<{ order: Order; group: Grouping } | null>(null);
  useEffect(() => {
    if (semantic && !beforeSearch.current && order === 'time' && group === 'day') {
      beforeSearch.current = { order, group };
      setOrder('relevance');
      setGroup('none');
    } else if (!semantic) {
      if (order === 'relevance') setOrder(beforeSearch.current?.order ?? 'time');
      if (beforeSearch.current && group === 'none') setGroup(beforeSearch.current.group);
      beforeSearch.current = null;
    }
  }, [semantic]); // eslint-disable-line react-hooks/exhaustive-deps
  const facetCounts = useMemo(() => {
    const count = (skip: 'category' | 'kind' | 'source', key: (e: TimetableEvent) => string) => {
      const m = new Map<string, number>();
      for (const e of data.events) if (passes(e, skip)) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
      return m;
    };
    return {
      category: count('category', (e) => e.category),
      kind: count('kind', (e) => venueById.get(e.venue_id)?.kind ?? ''),
      source: count('source', (e) => detectSource(e.url, e.source)),
    };
  }, [data.events, passes, venueById]);
  // "List follows map": drop events whose venue is outside the current map view.
  const inView = useMemo(() => {
    if (!syncView || !bounds) return visible;
    return visible.filter((e) => {
      const v = venueById.get(e.venue_id);
      return v?.lat != null && v.lng != null && v.lat >= bounds.south && v.lat <= bounds.north && v.lng >= bounds.west && v.lng <= bounds.east;
    });
  }, [visible, syncView, bounds, venueById]);

  // Rows are ordered by the chosen sort (ties by start time) and then bucketed under the chosen heading.
  const groups = useMemo(() => {
    const keyOf = (e: TimetableEvent) =>
      group === 'day' ? eventDay(e) : group === 'source' ? SOURCE_META[detectSource(e.url, e.source)].label : group === 'venue' ? e.venue_name : 'All performances';
    const price = (e: TimetableEvent, missing: number) => minPrice(e) ?? missing;
    const cmp: Record<Order, (a: TimetableEvent, b: TimetableEvent) => number> = {
      relevance: (a, b) => (search.scores?.get(b.id) ?? 0) - (search.scores?.get(a.id) ?? 0),
      time: (a, b) => a.start.localeCompare(b.start),
      title: (a, b) => a.title.localeCompare(b.title),
      price_asc: (a, b) => price(a, Infinity) - price(b, Infinity),
      price_desc: (a, b) => price(b, -1) - price(a, -1),
    };
    // Sort everything first so "show more" paginates the right rows, not just the first 200 by date.
    const sorted = [...inView].sort((a, b) => cmp[order](a, b) || a.start.localeCompare(b.start));
    const m = new Map<string, TimetableEvent[]>();
    for (const e of sorted.slice(0, limit)) {
      const k = keyOf(e);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    const entries = [...m.entries()];
    if (group === 'venue' || group === 'source') entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [inView, group, order, limit, search.scores]);
  const shownCount = groups.reduce((n, [, l]) => n + l.length, 0);
  const grouping = group;

  const venueOptions = useMemo(() => {
    const used = new Set(data.events.map((e) => e.venue_id));
    return data.venues.filter((v) => used.has(v.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  useEffect(() => {
    setParams({
      category: [...active].sort().join(',') || null,
      range: range === 'week' ? null : range,
      from: range === 'custom' ? customFrom || null : null,
      to: range === 'custom' ? customTo || null : null,
      group: group === 'day' ? null : group,
      order: order === 'time' ? null : order,
      pmin: priceMin > 0 ? String(priceMin) : null,
      pmax: priceMax != null ? String(priceMax) : null,
      unpriced: includeUnpriced ? null : '0',
      sort: null,
      source: [...sources].sort().join(',') || null,
      venue: venueId || null,
      q: deferredQuery.trim() || null,
      exact: exact && deferredQuery.trim() ? '1' : null,
      kind: [...kinds].sort().join(',') || null,
      map: showMap ? null : '0',
    });
  }, [active, range, customFrom, customTo, group, order, priceMin, priceMax, includeUnpriced, sources, venueId, deferredQuery, kinds, showMap, exact]);

  const toggleKind = (k: VenueKind) =>
    setKinds((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const showOnMap = (id: string) => {
    setShowMap(true);
    setFocus((f) => ({ venueId: id, n: (f?.n ?? 0) + 1 }));
  };
  // Requests from the venue index and the Journey Planner view's "Open in Events".
  useEffect(() => {
    if (focusRequest) showOnMap(focusRequest.id);
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!venueRequest || !venueById.has(venueRequest.id)) return;
    setVenueId(venueRequest.id);
    setRange('all');
  }, [venueRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  // Grey pins for venues with nothing listed only make sense while no filter is about the performances themselves.
  const priceOn = priceMin > 0 || priceMax != null;
  const emptyKinds = active.size || venueId || query.trim() || sources.size || priceOn ? null : kinds;
  const fitKey = [venueId, deferredQuery.trim(), range, customFrom, customTo, [...active].sort().join(), [...kinds].sort().join(), [...sources].sort().join(), priceMin, priceMax, includeUnpriced, search.scores?.size ?? 0].join('|');

  const toggle = (c: TimetableCategory) =>
    setActive((prev) => {
      const n = new Set(prev);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const toggleIn = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  };
  const sourceOptions = useMemo(() => {
    const seen = new Set<EventSourceId>();
    for (const e of data.events) seen.add(detectSource(e.url, e.source));
    return (Object.keys(SOURCE_META) as EventSourceId[]).filter((k) => seen.has(k));
  }, [data.events]);

  const categoryItems: CheckItem[] = TIMETABLE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon, count: facetCounts.category.get(c.id) ?? 0, checked: active.has(c.id) }));
  const kindItems: CheckItem[] = VENUE_KINDS.map((k) => ({ id: k.id, label: k.label, icon: KIND_ICONS[k.id], count: facetCounts.kind.get(k.id) ?? 0, checked: kinds.has(k.id) }));
  const sourceItems: CheckItem[] = sourceOptions.map((k) => ({ id: k, label: SOURCE_META[k].label, color: SOURCE_META[k].color, count: facetCounts.source.get(k) ?? 0, checked: sources.has(k) }));
  const activeCount = active.size + kinds.size + sources.size + (venueId ? 1 : 0) + (query.trim() ? 1 : 0) + (priceOn ? 1 : 0);
  const clearAll = () => {
    setActive(new Set());
    setKinds(new Set());
    setSources(new Set());
    setVenueId('');
    setQuery('');
    setExact(false);
    setPriceMin(0);
    setPriceMax(null);
    setIncludeUnpriced(true);
  };

  const controlStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)',
    borderColor: 'var(--border-hairline)',
    color: 'var(--text-primary)',
  };
  const seg = (on: boolean): React.CSSProperties =>
    on ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' } : { color: 'var(--text-secondary)' };

  if (!data.events.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        No listings available right now.
      </p>
    );
  }

  const filters = (
    <TimetableFilters
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setExact(false);
      }}
      search={{
        semantic,
        literal: literal && !!needle,
        atlas: search.atlas,
        argon: search.argon,
        understood: search.understood,
        matches: visible.length,
        outsideRange,
        onAnyDate: () => setRange('all'),
        onSearchEverything: () => {
          setExact(false);
          setQuery(needle);
        },
      }}
      range={range}
      from={startKey}
      to={endKey}
      onRange={(r, f, t) => {
        setRange(r);
        if (r === 'custom') {
          setCustomFrom(f ?? '');
          setCustomTo(t ?? '');
        }
      }}
      order={order}
      orders={semantic ? [RELEVANCE, ...ORDERS] : ORDERS}
      onOrder={(o) => setOrder(o as Order)}
      group={group}
      groups={GROUPINGS}
      onGroup={(g) => setGroup(g as Grouping)}
      categories={categoryItems}
      onCategory={(id) => toggle(id as TimetableCategory)}
      kinds={kindItems}
      onKind={(id) => toggleKind(id as VenueKind)}
      sources={sourceItems}
      onSource={(id) => setSources((p) => toggleIn(p, id as EventSourceId))}
      venues={venueOptions}
      venueId={venueId}
      onVenue={setVenueId}
      price={{
        min: priceMin,
        max: priceMax,
        includeUnpriced,
        onChange: (lo, hi) => {
          setPriceMin(lo);
          setPriceMax(hi);
        },
        onIncludeUnpriced: setIncludeUnpriced,
      }}
      activeCount={activeCount}
      onClear={clearAll}
      resultCount={inView.length}
    />
  );

  return (
    <div className="xl:grid xl:grid-cols-[17rem_minmax(0,1fr)] xl:gap-6 xl:items-start">
      {/* Wide screens: filters stay in view beside the results. Narrower: a toggle above them. */}
      <aside
        className="hidden xl:block sticky top-[calc(var(--app-header-h,0px)+0.5rem)] max-h-[calc(100vh-var(--app-header-h,0px)-1rem)] overflow-y-auto rounded-xl border p-3"
        style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-surface)' }}
        aria-label="Filters"
      >
        {filters}
      </aside>
      <div className="xl:hidden mb-3">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-mono cursor-pointer"
          style={controlStyle}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
          Filters &amp; sort{activeCount ? ` · ${activeCount}` : ''}
        </button>
        {filtersOpen && (
          <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-surface)' }}>
            {filters}
          </div>
        )}
      </div>

    <div className="space-y-4 min-w-0">
      {showMap && (
        <Suspense fallback={<div className="rounded-xl border h-64 grid place-items-center text-xs font-mono" style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}>Loading map…</div>}>
          <TimetableMap
            events={visible}
            venues={data.venues}
            active={active}
            toggleCategory={toggle}
            resetCategories={() => setActive(new Set())}
            venueId={venueId}
            onPickVenue={setVenueId}
            focus={focus}
            syncView={syncView}
            setSyncView={setSyncView}
            onBounds={setBounds}
            fitKey={fitKey}
            allEvents={data.events}
            emptyKinds={emptyKinds}
            civicNodes={civicNodes}
            liveEvents={liveEvents}
            works={works}
            activeVenueId={activeVenueId}
            openLondonTelemetry={openLondonTelemetry}
            onRefreshTelemetry={onRefreshTelemetry}
            refreshingTelemetry={refreshingTelemetry}
            onOpenWork={onOpenWork}
            onPlanJourney={onPlanJourney}
          />
        </Suspense>
      )}

      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
        <CalendarDays className="w-3.5 h-3.5" aria-hidden />
        {inView.length} performance{inView.length === 1 ? '' : 's'}
        {syncView && inView.length !== visible.length && <span>(in map view · {visible.length} match filters)</span>}
        <button type="button" onClick={() => setShowMap((m) => !m)} className="ml-auto underline underline-offset-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          {showMap ? 'Hide map' : 'Show map'}
        </button>
      </div>

      {groups.length === 0 && (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Nothing matches these filters. Try a wider date range or clear some filters.
        </p>
      )}

      {groups.map(([key, events]) => (
        <section key={key} aria-label={key}>
          <h3
            className="sticky top-[var(--app-header-h,0px)] z-10 py-1.5 mb-2 font-chronicle text-lg backdrop-blur-sm"
            style={{ color: 'var(--text-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)' }}
          >
            {grouping === 'day' ? (key === todayKey ? `Today · ${dayHeading(key)}` : dayHeading(key)) : key}
            <span className="ml-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{events.length}</span>
          </h3>
          <ul className="space-y-1.5">
            {events.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                showDate={grouping !== 'day'}
                onShowOnMap={showOnMap}
                hasCoords={venueById.get(e.venue_id)?.lat != null}
                usual={!e.price && planIndex.length ? usualPriceAt(planIndex, { id: e.venue_id, name: e.venue_name, hall: e.hall }) : null}
              />
            ))}
          </ul>
        </section>
      ))}

      {inView.length > shownCount && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 200)}
          className="w-full rounded-lg border py-2 text-sm cursor-pointer"
          style={controlStyle}
        >
          Show more ({inView.length - shownCount} remaining)
        </button>
      )}
    </div>
    </div>
  );
};

