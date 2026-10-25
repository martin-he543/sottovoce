import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, GalleryHorizontal, Search, X } from 'lucide-react';
import type { SeatPlanSummary } from '../../utils/seatPlan';
import { gbpRange, planPriceRange } from '../../utils/seatPrices';
import { fold, wordDistance } from '../../utils/fuzzy';
import { venuePhotos } from '../../utils/venueImage';

const planHref = (id: string) => `/discover/seating?plan=${encodeURIComponent(id)}`;

type Mode = 'gallery' | 'index';
const MODE_KEY = 'sottovoce.seating.pickerMode';

const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'index' ? 'index' : 'gallery';
  } catch {
    return 'gallery';
  }
};

const photoOf = (p: SeatPlanSummary) => venuePhotos(p.mapVenueIds, 1)[0]?.image;
const detail = (p: SeatPlanSummary) => {
  const range = planPriceRange(p);
  return `${p.hall} · ${p.capacity.toLocaleString('en-GB')}${range ? ` · ${gbpRange(range)}` : ''}`;
};

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
/** Typos allowed in a query word of this length (none while it is short, so "ro" only finds words starting "ro"). */
const typos = (len: number) => (len < 4 ? 0 : len < 8 ? 1 : 2);

/**
 * Plans whose name, hall or alternative names contain every query word, allowing typos and half-typed words. Exact
 * substrings rank first, then prefix matches, then typo matches; ties keep the incoming (alphabetical) order.
 */
export function searchPlans(plans: SeatPlanSummary[], query: string, limit = 8): SeatPlanSummary[] {
  const terms = words(query);
  if (!terms.length) return [];
  const hits: { p: SeatPlanSummary; score: number }[] = [];
  for (const p of plans) {
    const text = [p.name, p.hall, ...(p.venueNames ?? [])];
    const hay = words(text.join(' '));
    const title = fold(p.name);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      let best = Infinity;
      for (const w of hay) {
        const d = w.includes(t) ? (w.startsWith(t) ? 0 : 0.25) : wordDistance(t, w);
        if (d < best) best = d;
      }
      if (best > Math.max(typos(t.length), 0.25)) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    if (title.startsWith(fold(query.trim()))) score -= 1;
    if (terms.every((t) => title.includes(t))) score -= 0.5;
    hits.push({ p, score });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.p);
}

/** The matching part of `text` in bold, so a suggestion shows why it came up. */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const terms = words(query).filter((t) => t.length > 1);
  const folded = fold(text);
  const mark = new Array(text.length).fill(false);
  for (const t of terms) {
    let at = folded.indexOf(t);
    while (at >= 0) {
      for (let i = at; i < at + t.length; i++) mark[i] = true;
      at = folded.indexOf(t, at + t.length);
    }
  }
  if (folded.length !== text.length || !mark.some(Boolean)) return <>{text}</>;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && mark[j] === mark[i]) j++;
    const piece = text.slice(i, j);
    out.push(mark[i] ? <mark key={i} className="bg-transparent font-bold" style={{ color: 'var(--accent-crimson)' }}>{piece}</mark> : piece);
    i = j;
  }
  return <>{out}</>;
};

const Thumb: React.FC<{ plan: SeatPlanSummary; className?: string }> = ({ plan, className }) => {
  const src = photoOf(plan);
  const [bad, setBad] = useState(false);
  return src && !bad ? (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className={`object-cover ${className ?? ''}`} />
  ) : (
    <div className={`flex items-center justify-center font-chronicle text-lg ${className ?? ''}`} style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }} aria-hidden>
      {plan.name.charAt(0)}
    </div>
  );
};

const SearchBox: React.FC<{ plans: SeatPlanSummary[]; onPick: (id: string) => void }> = ({ plans, onPick }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchPlans(plans, q), [plans, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const away = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (p: SeatPlanSummary) => {
    onPick(p.id);
    setQ('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && !!q.trim()}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
        aria-label="Search venues"
        placeholder="Search venues, e.g. “covent garden”, “lyseum”…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            if (!q) (e.target as HTMLInputElement).blur();
            setQ('');
          }
        }}
        className="w-full rounded-full border py-2 pl-9 pr-9 text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-crimson)_22%,transparent)]"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
      />
      {q && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setQ('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && q.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[22rem] overflow-auto rounded-xl border p-1 shadow-xl"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
        >
          {results.length ? (
            results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${p.id}`}
                role="option"
                data-href={planHref(p.id)}
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-1.5"
                style={{ backgroundColor: i === active ? 'var(--bg-subtle)' : undefined }}
              >
                <Thumb plan={p} className="h-11 w-14 shrink-0 rounded-md" />
                <span className="min-w-0">
                  <span className="block truncate font-chronicle text-[15px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <Highlight text={p.name} query={q} />
                  </span>
                  <span className="block truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    <Highlight text={detail(p)} query={q} />
                  </span>
                </span>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No venue matches “{q.trim()}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

const Carousel: React.FC<{ plans: SeatPlanSummary[]; selected: string | null; onPick: (id: string) => void }> = ({ plans, selected, onPick }) => {
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = () => {
    const el = rail.current;
    if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  };
  useEffect(measure, [plans]);

  // Bring the chosen venue into view (after a search pick or a shared link), centred.
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const r = rail.current;
    if (el && r) r.scrollTo({ left: el.offsetLeft - (r.clientWidth - el.clientWidth) / 2, behavior: 'smooth' });
  }, [selected, plans]);

  const page = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: 'smooth' });
  const arrow = (dir: 1 | -1, hidden: boolean) => (
    <button
      type="button"
      aria-label={dir > 0 ? 'Next venues' : 'Previous venues'}
      onClick={() => page(dir)}
      tabIndex={hidden ? -1 : 0}
      className={`absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border shadow-lg backdrop-blur transition-opacity sm:flex ${dir > 0 ? 'right-1' : 'left-1'} ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
    >
      {dir > 0 ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
    </button>
  );

  return (
    <div className="relative -mx-1">
      {arrow(-1, edge.start)}
      {arrow(1, edge.end)}
      <div
        ref={rail}
        onScroll={measure}
        role="tablist"
        aria-label="Venues"
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {plans.map((p) => {
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onPick(p.id)}
              data-href={planHref(p.id)}
              className="group relative h-44 w-60 shrink-0 cursor-pointer snap-start overflow-hidden rounded-2xl border text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:h-48 sm:w-64"
              style={{
                borderColor: on ? 'var(--accent-crimson)' : 'var(--border-hairline)',
                boxShadow: on ? '0 0 0 2px var(--accent-crimson), 0 10px 24px -12px rgba(0,0,0,0.5)' : undefined,
              }}
            >
              <Thumb plan={p} className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105" />
              <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(15,11,10,0.88) 0%, rgba(15,11,10,0.35) 45%, rgba(15,11,10,0) 70%)' }} aria-hidden />
              {on && (
                <span className="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' }}>
                  Viewing
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 p-3">
                <span className="block font-chronicle text-lg leading-tight" style={{ color: '#FAF6F0' }}>
                  {p.name}
                </span>
                <span className="mt-0.5 block truncate text-[10px] font-mono" style={{ color: 'rgba(250,246,240,0.78)' }}>
                  {detail(p)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const chip = (active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0', borderColor: 'transparent' }
    : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', borderColor: 'var(--border-hairline)' };

const Index: React.FC<{ plans: SeatPlanSummary[]; selected: string | null; onPick: (id: string) => void }> = ({ plans, selected, onPick }) => (
  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Venues">
    {plans.map((p) => (
      <button key={p.id} type="button" role="tab" aria-selected={p.id === selected} onClick={() => onPick(p.id)} data-href={planHref(p.id)} className="cursor-pointer rounded-lg border px-3 py-1.5 text-left" style={chip(p.id === selected)}>
        <span className="block text-sm font-semibold leading-tight">{p.name}</span>
        <span className="block text-[10px] font-mono opacity-75">{detail(p)}</span>
      </button>
    ))}
  </div>
);

/** Venue chooser for the seating view: a photo carousel or an A–Z index (remembered), with fuzzy search over both. */
export const VenuePicker: React.FC<{ plans: SeatPlanSummary[]; selected: string | null; onPick: (id: string) => void }> = ({ plans, selected, onPick }) => {
  const [mode, setMode] = useState<Mode>(readMode);
  const setAndRemember = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  const toggle = (m: Mode, Icon: typeof LayoutGrid, label: string) => (
    <button
      type="button"
      onClick={() => setAndRemember(m)}
      aria-pressed={mode === m}
      title={label}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-mono transition-colors"
      style={mode === m ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' } : { color: 'var(--text-secondary)' }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox plans={plans} onPick={onPick} />
        <div className="ml-auto inline-flex rounded-full border p-0.5" style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)' }} role="group" aria-label="Venue layout">
          {toggle('gallery', GalleryHorizontal, 'Gallery')}
          {toggle('index', LayoutGrid, 'Index')}
        </div>
      </div>
      {mode === 'gallery' ? <Carousel plans={plans} selected={selected} onPick={onPick} /> : <Index plans={plans} selected={selected} onPick={onPick} />}
    </div>
  );
};

export default VenuePicker;
