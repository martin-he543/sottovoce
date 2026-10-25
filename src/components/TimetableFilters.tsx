import React, { useEffect, useState } from 'react';
import { ArgonMark } from './ArgonButton';
import { ArrowDownUp, CalendarDays, Globe, Landmark, Layers, MapPin, PoundSterling, Search, Tags, X, type LucideIcon } from 'lucide-react';
import { RANGE_PRESETS, SLIDER_DAYS, describeRange, keyAtOffset, offsetOf, type RangeId } from '../utils/dateRanges';

export const PRICE_CAP = 100;

const Section: React.FC<{ title: string; icon?: LucideIcon; badge?: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, icon: Icon, badge, children, defaultOpen = true }) => (
  <details open={defaultOpen} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--border-hairline)' }}>
    <summary className="cursor-pointer flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
      <span>{title}</span>
      {badge && <span className="ml-auto normal-case tracking-normal font-normal text-[10px] rounded-full px-1.5" style={{ backgroundColor: 'var(--bg-elevated, var(--border-hairline))', color: 'var(--text-secondary)' }}>{badge}</span>}
    </summary>
    {children}
  </details>
);

export interface CheckItem {
  id: string;
  label: string;
  count: number;
  color?: string;
  icon?: LucideIcon;
  checked: boolean;
}

export const CheckList: React.FC<{ items: CheckItem[]; onToggle: (id: string) => void; label: string }> = ({ items, onToggle, label }) => (
  <ul className="space-y-1" aria-label={label}>
    {items.map((i) => (
      <li key={i.id}>
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ opacity: i.count || i.checked ? 1 : 0.45 }}>
          <input type="checkbox" checked={i.checked} onChange={() => onToggle(i.id)} style={{ accentColor: i.color ?? 'var(--accent-crimson)' }} />
          {i.icon ? <i.icon className="w-3.5 h-3.5 shrink-0" style={{ color: i.color ?? 'var(--text-muted)' }} aria-hidden /> : i.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: i.color }} />}
          <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{i.label}</span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{i.count}</span>
        </label>
      </li>
    ))}
  </ul>
);

interface PriceProps {
  min: number;
  /** null = no upper limit. */
  max: number | null;
  includeUnpriced: boolean;
  onChange: (min: number, max: number | null) => void;
  onIncludeUnpriced: (v: boolean) => void;
}

/** Amazon-style price filter: a two-handle slider plus min / max boxes (a blank max means no limit). */
const PriceFilter: React.FC<PriceProps> = ({ min, max, includeUnpriced, onChange, onIncludeUnpriced }) => {
  const [minText, setMinText] = useState(String(min || ''));
  const [maxText, setMaxText] = useState(max == null ? '' : String(max));
  useEffect(() => setMinText(min ? String(min) : ''), [min]);
  useEffect(() => setMaxText(max == null ? '' : String(max)), [max]);

  const hi = max ?? PRICE_CAP;
  const commit = () => {
    const lo = Math.max(0, Number(minText) || 0);
    const up = maxText.trim() === '' ? null : Math.max(0, Number(maxText) || 0);
    if (up != null && up < lo) onChange(up, lo);
    else onChange(lo, up);
  };
  const box = 'w-full rounded-md border px-2 py-1 text-xs font-mono bg-transparent';
  const boxStyle = { borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-2">
      <div className="tt-range" style={{ ['--lo' as string]: `${(Math.min(min, PRICE_CAP) / PRICE_CAP) * 100}%`, ['--hi' as string]: `${(Math.min(hi, PRICE_CAP) / PRICE_CAP) * 100}%` }}>
        <input
          type="range" min={0} max={PRICE_CAP} step={1} value={Math.min(min, PRICE_CAP)} aria-label="Minimum price"
          onChange={(e) => onChange(Math.min(Number(e.target.value), hi), max)}
        />
        <input
          type="range" min={0} max={PRICE_CAP} step={1} value={Math.min(hi, PRICE_CAP)} aria-label="Maximum price"
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(Math.min(min, v), v >= PRICE_CAP ? null : v);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          Min £
          <input className={box} style={boxStyle} inputMode="decimal" placeholder="0" value={minText} onChange={(e) => setMinText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
        <label className="flex-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          Max £
          <input className={box} style={boxStyle} inputMode="decimal" placeholder={`${PRICE_CAP}+`} value={maxText} onChange={(e) => setMaxText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Matches on the “from” price.</p>
      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-primary)' }}>
        <input type="checkbox" checked={includeUnpriced} onChange={(e) => onIncludeUnpriced(e.target.checked)} style={{ accentColor: 'var(--accent-crimson)' }} />
        Include events with no price listed
      </label>
    </div>
  );
};

/** Preset dropdown + quick chips + a two-handle day slider + custom date boxes. */
const WhenFilter: React.FC<{ range: RangeId; from: string; to: string; onRange: (r: RangeId, from?: string, to?: string) => void; seg: (on: boolean) => React.CSSProperties; field: string; fieldStyle: React.CSSProperties }> = ({ range, from, to, onRange, seg, field, fieldStyle }) => {
  const lo = Math.max(0, offsetOf(from));
  const hi = to === '9999-12-31' ? SLIDER_DAYS : Math.min(SLIDER_DAYS, offsetOf(to));
  const setSlider = (a: number, b: number) => onRange('custom', keyAtOffset(a), b >= SLIDER_DAYS ? '' : keyAtOffset(b));
  const quick: RangeId[] = ['today', 'tomorrow', 'weekend', 'week', 'month', 'all'];
  const label = (id: RangeId) => RANGE_PRESETS.find((r) => r.id === id)!.label;
  const todayKey = keyAtOffset(0);
  const dateBox = `${field} font-mono`;

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <CalendarDays className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} aria-hidden />
        <select value={range} onChange={(e) => onRange(e.target.value as RangeId, from, to === '9999-12-31' ? '' : to)} className={`${field} pl-8`} style={fieldStyle} aria-label="Date range preset">
          {RANGE_PRESETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-hairline)' }} role="group" aria-label="Quick date ranges">
        {quick.map((id) => (
          <button key={id} type="button" onClick={() => onRange(id)} aria-pressed={range === id} className="px-1.5 py-1.5 text-[11px] font-mono cursor-pointer truncate" style={seg(range === id)}>
            {id === 'all' ? 'Anytime' : label(id).replace('Next ', '').replace('This ', '')}
          </button>
        ))}
      </div>

      <div className="tt-range" style={{ ['--lo' as string]: `${(lo / SLIDER_DAYS) * 100}%`, ['--hi' as string]: `${(hi / SLIDER_DAYS) * 100}%` }}>
        <input type="range" min={0} max={SLIDER_DAYS} step={1} value={lo} aria-label="Range start (days from today)" onChange={(e) => setSlider(Math.min(Number(e.target.value), hi), hi)} />
        <input type="range" min={0} max={SLIDER_DAYS} step={1} value={hi} aria-label="Range end (days from today)" onChange={(e) => setSlider(lo, Math.max(Number(e.target.value), lo))} />
      </div>
      <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
        <span>Today</span><span>3 mo</span><span>6 mo</span><span>1 yr+</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          From
          <input type="date" min={todayKey} value={from} onChange={(e) => e.target.value && onRange('custom', e.target.value, to === '9999-12-31' ? '' : to)} className={`${dateBox} mt-1`} style={fieldStyle} />
        </label>
        <label className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          To
          <input type="date" min={from} value={to === '9999-12-31' ? '' : to} onChange={(e) => onRange('custom', from, e.target.value)} className={`${dateBox} mt-1`} style={fieldStyle} />
        </label>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{describeRange(from, to)}</p>
    </div>
  );
};

/** What the search box is doing, shown under it. */
export interface SearchStatus {
  /** Searching by meaning (Atlas + Argon), as opposed to a literal title match. */
  semantic: boolean;
  /** Matching the text literally (a quoted search, or a link that means one title). */
  literal: boolean;
  atlas: 'idle' | 'pending' | 'done' | 'unavailable';
  argon: 'idle' | 'pending' | 'done' | 'unavailable';
  understood: { intent: string; terms: string[]; works: string[] } | null;
  /** Listings matching with every filter applied. */
  matches: number;
  /** More matches on dates outside the chosen range. */
  outsideRange: number;
  onAnyDate: () => void;
  onSearchEverything: () => void;
}

const linkBtn = 'underline underline-offset-2 cursor-pointer';

/** Under the search box: what was searched, what Argon understood, and a way to widen the dates when matches lie beyond them. */
const SearchNote: React.FC<{ s: SearchStatus }> = ({ s }) => {
  const mono = 'text-[10px] font-mono uppercase tracking-[0.14em]';
  const muted: React.CSSProperties = { color: 'var(--text-muted)' };
  if (s.literal) {
    return (
      <p className="text-[11px] -mt-2" style={muted}>
        Exact match on title, venue and hall.{' '}
        <button type="button" onClick={s.onSearchEverything} className={linkBtn} style={{ color: 'var(--accent-crimson)' }}>Search everything instead</button>
      </p>
    );
  }
  if (!s.semantic) return null;
  const terms = (s.understood?.terms ?? []).slice(0, 8);
  const settled = s.argon === 'done' || s.argon === 'unavailable';
  return (
    <div className="space-y-1.5 -mt-2" aria-live="polite">
      <p className={`${mono} flex items-center gap-1.5`} style={muted}>
        {settled ? (
          s.atlas === 'unavailable' ? 'Searched every field in your browser' : 'Searched every field · MongoDB Atlas'
        ) : (
          <>
            <ArgonMark className={`w-3 h-3 ${s.atlas === 'done' ? 'animate-spin' : ''}`} />
            {s.atlas === 'done' ? 'Argon is working out what you mean…' : 'Searching every field…'}
          </>
        )}
      </p>
      {s.understood?.intent && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1 mr-1" style={{ color: 'var(--accent-crimson)' }}><ArgonMark className="w-3 h-3" />Argon read this as</span>
          <em>{s.understood.intent.replace(/[.\s]+$/, '')}</em>
          {terms.length > 0 && <span style={muted}> · also searched {terms.join(', ')}</span>}
        </p>
      )}
      {s.outsideRange > 0 && (
        <p className="text-[11px]" style={muted}>
          {s.matches === 0 ? 'Nothing in these dates, but ' : ''}
          {s.outsideRange} more match{s.outsideRange === 1 ? '' : 'es'} on other dates.{' '}
          <button type="button" onClick={s.onAnyDate} className={linkBtn} style={{ color: 'var(--accent-crimson)' }}>Show all dates</button>
        </p>
      )}
    </div>
  );
};

export interface TimetableFiltersProps {
  query: string;
  onQuery: (q: string) => void;
  search: SearchStatus;
  range: RangeId;
  /** Resolved inclusive day keys of the current range. */
  from: string;
  to: string;
  onRange: (r: RangeId, from?: string, to?: string) => void;
  order: string;
  orders: [string, string][];
  onOrder: (o: string) => void;
  group: string;
  groups: [string, string][];
  onGroup: (g: string) => void;
  categories: CheckItem[];
  onCategory: (id: string) => void;
  kinds: CheckItem[];
  onKind: (id: string) => void;
  sources: CheckItem[];
  onSource: (id: string) => void;
  venues: { id: string; name: string }[];
  venueId: string;
  onVenue: (id: string) => void;
  price: PriceProps;
  activeCount: number;
  onClear: () => void;
  resultCount: number;
}

/** Left-hand filter / sort panel for Events. */
export const TimetableFilters: React.FC<TimetableFiltersProps> = (p) => {
  const field = 'w-full rounded-md border px-2 py-1.5 text-xs';
  const fieldStyle: React.CSSProperties = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' };
  const seg = (on: boolean): React.CSSProperties => (on ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' } : { color: 'var(--text-secondary)' });

  return (
    <div className="space-y-4">
      {p.activeCount > 0 && (
        <button type="button" onClick={p.onClear} className="w-full rounded-lg border py-1.5 text-xs cursor-pointer" style={fieldStyle}>
          Clear {p.activeCount} filter{p.activeCount === 1 ? '' : 's'}
        </button>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} aria-hidden />
        <input
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && p.onQuery('')}
          placeholder="Search anything: piece, artist, plot, venue…"
          aria-label="Search events"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          className={`${field} pl-8 pr-7 [&::-webkit-search-cancel-button]:appearance-none`}
          style={fieldStyle}
        />
        {p.query && (
          <button type="button" onClick={() => p.onQuery('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <SearchNote s={p.search} />

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1"><ArrowDownUp className="w-3 h-3" aria-hidden />Sort by</span>
          <select value={p.order} onChange={(e) => p.onOrder(e.target.value)} className={`${field} mt-1 normal-case tracking-normal`} style={fieldStyle}>
            {p.orders.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3" aria-hidden />Group by</span>
          <select value={p.group} onChange={(e) => p.onGroup(e.target.value)} className={`${field} mt-1 normal-case tracking-normal`} style={fieldStyle}>
            {p.groups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>

      <Section title="When" icon={CalendarDays} badge={describeRange(p.from, p.to)}>
        <WhenFilter range={p.range} from={p.from} to={p.to} onRange={p.onRange} seg={seg} field={field} fieldStyle={fieldStyle} />
      </Section>

      <Section title="Price" icon={PoundSterling}>
        <PriceFilter {...p.price} />
      </Section>

      <Section title="Category" icon={Tags}>
        <CheckList items={p.categories} onToggle={p.onCategory} label="Category" />
      </Section>

      <Section title="Venue type" icon={Landmark}>
        <CheckList items={p.kinds} onToggle={p.onKind} label="Venue type" />
      </Section>

      <Section title="Venue" icon={MapPin}>
        <select value={p.venueId} onChange={(e) => p.onVenue(e.target.value)} className={field} style={fieldStyle} aria-label="Venue">
          <option value="">All venues</option>
          {p.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Section>

      <Section title="Source" icon={Globe}>
        <CheckList items={p.sources} onToggle={p.onSource} label="Source" />
      </Section>

    </div>
  );
};
