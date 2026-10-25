import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Layers, LocateFixed, PoundSterling, RotateCcw, Ticket, ExternalLink } from 'lucide-react';
import type { TimetableEvent } from '../../data/timetableCategories';
import { dayKey, eventDay, shortDate, timeLabel } from '../../utils/timetableFormat';
import { readParams, setParams } from '../../utils/urlState';
import {
  layoutPlan,
  loadSeatPlan,
  loadSeatPlanIndex,
  rowOrder,
  seatKey,
  seatLabel,
  seatSightline,
  type SeatPlan,
  plansFor,
  type SeatPlanSummary,
} from '../../utils/seatPlan';
import { bandColor, gbp, gbpRange, parseListingPrice, priceAtListing, planPriceRange, pricePlan, seatPrice } from '../../utils/seatPrices';
import { LEVEL_COLORS, SeatMap3D, type SeatMap3DHandle } from './SeatMap3D';
import { SeatAdvisor } from './SeatAdvisor';
import { VenuePicker } from './VenuePicker';

const chip = (active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0', borderColor: 'transparent' }
    : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)', borderColor: 'var(--border-hairline)' };

const selectStyle: React.CSSProperties = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' };

/**
 * The 3D viewer with tier filter, seat finder, sightline stats, prices and the advisor, for one plan. With `event`,
 * prices are for that performance (its listed price range) rather than the venue's usual ones.
 */
export const SeatPlanExplorer: React.FC<{
  plan: SeatPlan;
  compact?: boolean;
  initialSeat?: string | null;
  onSeatKey?: (key: string | null) => void;
  event?: TimetableEvent | null;
}> = ({ plan, compact, initialSeat, onSeatKey, event }) => {
  const layout = useMemo(() => layoutPlan(plan), [plan]);
  const pricing = useMemo(() => pricePlan(plan, layout), [plan, layout]);
  const listing = parseListingPrice(event?.price);
  /** What a seat costs: at this performance when there is one with a price, else the venue's usual price. */
  const priceOf = (i: number) => {
    const p = pricing ? seatPrice(pricing, i) : null;
    return p == null || !pricing ? null : listing ? priceAtListing(p, pricing.range, listing) : p;
  };
  const bandPrices = pricing ? pricing.bands.map((p) => (listing ? priceAtListing(p, pricing.range, listing) : p)) : [];
  const [priceMode, setPriceMode] = useState(false);
  const tints = useMemo(
    () => (priceMode && pricing ? Array.from(pricing.band, (b) => (b >= 0 ? bandColor(b, pricing.bands.length) : '#6b6b6b')) : null),
    [priceMode, pricing]
  );
  /** Each seat's price (£, whole pounds) written on it while Prices is on. */
  const seatLabels = useMemo(
    () => (priceMode && pricing ? layout.seats.map((_, i) => { const p = priceOf(i); return p == null ? '' : `£${Math.round(p)}`; }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceMode, pricing, layout, event?.price]
  );
  const [bandPick, setBandPick] = useState<number | null>(null);
  const findSeat = (key: string | null | undefined) => {
    if (!key) return null;
    const i = layout.seats.findIndex((s) => seatKey(plan, s) === key);
    return i >= 0 ? i : null;
  };
  const [selected, setSelected] = useState<number | null>(() => findSeat(initialSeat));
  const [mode, setMode] = useState<'overview' | 'seat'>('overview');
  const [levelLimit, setLevelLimit] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<number[]>([]);

  useEffect(() => {
    const first = findSeat(initialSeat);
    setSelected(first);
    setMode('overview');
    setLevelLimit(first !== null && layout.seats[first].level < plan.levels.length - 1 ? layout.seats[first].level : null);
    setSuggested([]);
    setBandPick(null);
    // Let the scene build before flying to a seat from the URL.
    const t = first !== null ? setTimeout(() => mapRef.current?.focusSeat(first), 300) : undefined;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const mapRef = useRef<SeatMap3DHandle>(null);
  /** `fly` (seats picked outside the 3D view): show the seat's tier on top and move the camera to it. */
  const select = (i: number | null, fly = false) => {
    setSelected(i);
    if (i === null) setMode('overview');
    else if (fly) {
      setLevelLimit(layout.seats[i].level === plan.levels.length - 1 ? null : layout.seats[i].level);
      if (mode !== 'seat') mapRef.current?.focusSeat(i);
    } else if (levelLimit !== null && layout.seats[i].level > levelLimit) setLevelLimit(layout.seats[i].level);
    onSeatKey?.(i === null ? null : seatKey(plan, layout.seats[i]));
  };

  const seat = selected !== null ? layout.seats[selected] : null;
  const sight = seat ? seatSightline(seat) : null;

  // Seat finder: tier → row → seat, always in step with the 3D selection.
  const [findLevel, setFindLevel] = useState(0);
  const [findRow, setFindRow] = useState('');
  useEffect(() => {
    if (seat) {
      setFindLevel(seat.level);
      setFindRow(`${seat.section}|${seat.row}`);
    }
  }, [seat]);
  const rows = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    plan.levels[findLevel]?.sections.forEach((sec, si) =>
      [...sec.rows].sort((a, b) => rowOrder(a.row, b.row)).forEach((r) =>
        out.push({ key: `${si}|${r.row}`, label: sec.name === 'Boxes' ? r.row : sec.name === plan.levels[findLevel].name ? `Row ${r.row}` : `${sec.name} · Row ${r.row}` })
      )
    );
    return out;
  }, [plan, findLevel]);
  const rowSeats = useMemo(() => {
    const [si, row] = findRow.split('|');
    return layout.seats.flatMap((s, i) => (s.level === findLevel && String(s.section) === si && s.row === row ? [i] : []));
  }, [layout, findLevel, findRow]);

  const levelCounts = useMemo(() => plan.levels.map((_, li) => layout.seats.filter((s) => s.level === li).length), [plan, layout]);

  return (
    <div className={compact ? 'space-y-3' : 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]'}>
      <div className="min-w-0">
        <div className="relative overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-hairline)' }}>
          <SeatMap3D
            ref={mapRef}
            plan={plan}
            selected={selected}
            onSelect={select}
            highlighted={suggested}
            tints={tints}
            seatLabels={seatLabels}
            hoverNote={(i) => {
              const p = priceOf(i);
              return p == null ? null : `${pricing?.source === 'captured' && !listing ? '' : '≈ '}${gbp(p)}`;
            }}
            levelLimit={levelLimit}
            mode={mode}
            style={{ height: compact ? 340 : 'min(72vh, 680px)' }}
          />
          {/* Tier filter: showing a tier hides the ones above it, so you can see into the lower levels. */}
          <div className="absolute left-2 top-2 right-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setLevelLimit(null)} className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-mono backdrop-blur" style={chip(levelLimit === null)}>
              <Layers className="mr-1 inline h-3 w-3" aria-hidden />
              All tiers
            </button>
            {plan.levels.map((l, li) => (
              <button
                key={l.name}
                type="button"
                onClick={() => setLevelLimit(li)}
                aria-pressed={levelLimit === li}
                className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-mono backdrop-blur"
                style={chip(levelLimit === li)}
                title={`Show ${l.name} and below`}
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_COLORS[li % LEVEL_COLORS.length] }} />
                {l.name}
                {!compact && <span className="opacity-60"> · {levelCounts[li]}</span>}
              </button>
            ))}
            {pricing && (
              <button
                type="button"
                onClick={() => {
                  setPriceMode((v) => !v);
                  setBandPick(null);
                  setSuggested([]);
                }}
                aria-pressed={priceMode}
                className="ml-auto cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-mono backdrop-blur"
                style={chip(priceMode)}
                title="Colour the seats by price band"
              >
                <PoundSterling className="mr-1 inline h-3 w-3" aria-hidden />
                Prices
              </button>
            )}
          </div>
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-2">
            {mode === 'seat' ? (
              <button type="button" onClick={() => setMode('overview')} className="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold" style={chip(false)}>
                <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Back to the overview
              </button>
            ) : (
              seat && (
                <button type="button" onClick={() => setMode('seat')} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold" style={chip(true)}>
                  <Eye className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  View from {seat.row}
                  {seat.num}
                </button>
              )
            )}
            <span className="ml-auto rounded-md px-2 py-1 font-mono text-[10px]" style={{ background: 'rgba(15,11,10,0.7)', color: '#e8dccb' }}>
              {mode === 'seat' ? 'Drag to look around' : 'Drag to orbit · scroll to zoom · click a seat'}
            </span>
          </div>
        </div>
        {priceMode && pricing && (
          <PriceLegend
            prices={bandPrices}
            counts={pricing.counts}
            picked={bandPick}
            onPick={(b) => {
              setBandPick(b);
              setSuggested(b === null ? [] : layout.seats.flatMap((_, i) => (pricing.band[i] === b ? [i] : [])));
            }}
          />
        )}
        <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {plan.seated.toLocaleString('en-GB')} seats
          {plan.capacity > plan.seated ? ` + ${(plan.capacity - plan.seated).toLocaleString('en-GB')} standing` : ''} · seat positions{' '}
          {plan.source.method === 'extracted' ? 'from' : 'traced from'} the venue’s own {plan.source.plan ? 'seating plan' : 'booking map'} ({plan.source.system}), {plan.source.captured} · tier heights
          and rake are approximate{plan.source.note ? ` · ${plan.source.note}` : ''}
        </p>
      </div>

      <aside className="space-y-3">
        <section className="rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}>
          <h3 className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-crimson)' }}>
            <LocateFixed className="mr-1 inline h-3 w-3" aria-hidden />
            Find a seat
          </h3>
          <div className="grid grid-cols-3 gap-1.5">
            <select
              aria-label="Tier"
              value={findLevel}
              onChange={(e) => {
                setFindLevel(+e.target.value);
                setFindRow('');
              }}
              className="rounded-md border px-1.5 py-1.5 text-xs"
              style={selectStyle}
            >
              {plan.levels.map((l, li) => (
                <option key={l.name} value={li}>
                  {l.name}
                </option>
              ))}
            </select>
            <select aria-label="Row" value={findRow} onChange={(e) => setFindRow(e.target.value)} className="rounded-md border px-1.5 py-1.5 text-xs" style={selectStyle}>
              <option value="">Row…</option>
              {rows.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Seat"
              value={selected !== null && rowSeats.includes(selected) ? selected : ''}
              onChange={(e) => e.target.value !== '' && select(+e.target.value, true)}
              disabled={!rowSeats.length}
              className="rounded-md border px-1.5 py-1.5 text-xs"
              style={selectStyle}
            >
              <option value="">Seat…</option>
              {[...rowSeats]
                .sort((a, b) => (parseFloat(layout.seats[a].num) || 0) - (parseFloat(layout.seats[b].num) || 0))
                .map((i) => (
                  <option key={i} value={i}>
                    {layout.seats[i].num}
                  </option>
                ))}
            </select>
          </div>
          {seat && sight ? (
            <div className="mt-3 space-y-2">
              <p className="font-chronicle text-lg leading-snug" style={{ color: 'var(--text-primary)' }}>
                {seatLabel(plan, seat)}
              </p>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['to the stage', `${sight.distance.toFixed(0)} m`],
                  ['off centre', `${sight.offAxis.toFixed(0)}°`],
                  ['above it', `${Math.max(0, sight.height).toFixed(0)} m`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg py-1.5" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    <dd className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {v}
                    </dd>
                    <dt className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {k}
                    </dt>
                  </div>
                ))}
              </dl>
              {pricing && priceOf(selected!) != null && (
                <SeatPriceCard
                  price={priceOf(selected!)!}
                  usual={seatPrice(pricing, selected!)!}
                  band={pricing.band[selected!]}
                  bands={pricing.bands.length}
                  range={listing ? [bandPrices[0], bandPrices[bandPrices.length - 1]] : pricing.range}
                  source={pricing.source}
                  fees={pricing.fees}
                  captured={pricing.captured}
                  production={pricing.production}
                  event={event}
                  listed={!!listing}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setMode(mode === 'seat' ? 'overview' : 'seat')} className="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold" style={chip(mode === 'seat')}>
                  <Eye className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  {mode === 'seat' ? 'Leave the seat' : 'View from this seat'}
                </button>
                <a
                  href={event?.url ?? plan.source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' }}
                >
                  <Ticket className="h-3.5 w-3.5" aria-hidden />
                  {event?.url ? 'Book this performance' : 'Book at the venue'}
                  <ExternalLink className="h-3 w-3 opacity-80" aria-hidden />
                </a>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Prices here are a guide: the venue’s site has the live price and availability. sottovoce never books for you.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Click a seat in the 3D plan, or pick one here, to see its row, number and view of the stage.
            </p>
          )}
        </section>
        {!compact && (
          <SeatAdvisor
            plan={plan}
            layout={layout}
            listingPrice={listing ? event?.price : undefined}
            onSuggest={(seats) => {
              setBandPick(null);
              setSuggested(seats);
            }}
            onPick={(i) => select(i, true)}
          />
        )}
      </aside>
    </div>
  );
};

const capturedOn = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : '';

/** One chip per price band (cheapest first) with its seat count; picking one lights those seats up. */
const PriceLegend: React.FC<{ prices: number[]; counts: number[]; picked: number | null; onPick: (band: number | null) => void }> = ({
  prices,
  counts,
  picked,
  onPick,
}) => (
  <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Price bands">
    {prices.map((p, b) =>
      counts[b] ? (
        <button
          key={b}
          type="button"
          onClick={() => onPick(picked === b ? null : b)}
          aria-pressed={picked === b}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono"
          style={chip(picked === b)}
          title={`${counts[b].toLocaleString('en-GB')} seats at ${gbp(p)}: click to light them up`}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: bandColor(b, prices.length) }} />
          {gbp(p)}
          <span className="opacity-60">{counts[b].toLocaleString('en-GB')}</span>
        </button>
      ) : null
    )}
  </div>
);

/** The picked seat's price: captured or estimated, at the venue in general or at one performance. */
const SeatPriceCard: React.FC<{
  price: number;
  usual: number;
  band: number;
  bands: number;
  range: [number, number];
  source: 'captured' | 'typical';
  fees?: boolean;
  captured?: string;
  production?: string;
  event?: TimetableEvent | null;
  /** The performance lists a price, so `price` is rescaled to it. */
  listed?: boolean;
}> = ({ price, usual, band, bands, range, source, fees, captured, production, event, listed }) => {
  const exact = source === 'captured' && !listed;
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {exact ? '' : '≈ '}
          {gbp(price)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono" style={{ color: bandColor(band, bands), border: `1px solid ${bandColor(band, bands)}` }}>
          band {band + 1} of {bands}
        </span>
      </p>
      <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
        {event && listed ? (
          <>
            For <strong>{event.title}</strong>, {shortDate(event)} · {timeLabel(event)} (listed {event.price}). Seats here run {gbpRange(range)}
            {source === 'captured' ? `; this seat was ${gbp(usual)} at ${production ?? 'the captured performance'}` : `; usually about ${gbp(usual)}`}.
          </>
        ) : event ? (
          <>
            {event.title}, {shortDate(event)}, lists no price, so this is {source === 'captured' ? `the seat’s band at ${production ?? 'the captured performance'}` : 'an estimate from where the seat is and the venue’s usual range'}{' '}
            ({gbpRange(range)}).
          </>
        ) : source === 'captured' ? (
          <>
            Full price{fees ? ' incl. booking fee' : ''} for {production ?? 'the production'}, from the booking map on {capturedOn(captured)}. Seats run{' '}
            {gbpRange(range)}; prices change by date.
          </>
        ) : (
          <>
            Estimate from where the seat is and the venue’s usual range ({gbpRange(range)}). Pick a performance for its prices.
          </>
        )}
      </p>
    </div>
  );
};

/**
 * Discover → Seating: every venue with a plan, and the explorer for the chosen one (?plan=<id>&seat=<level|row|num>),
 * priced for one of its upcoming performances when one is picked (&event=<timetable event id>).
 */
export const SeatingView: React.FC<{ events?: TimetableEvent[] }> = ({ events = [] }) => {
  const [index, setIndex] = useState<SeatPlanSummary[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(() => readParams().get('plan'));
  const [plan, setPlan] = useState<SeatPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialSeat = useRef(readParams().get('seat'));
  const [eventId, setEventId] = useState<string | null>(() => readParams().get('event'));

  // Upcoming performances in the chosen plan's hall, soonest first.
  const performances = useMemo(() => {
    const summary = index?.find((p) => p.id === planId);
    if (!summary || !index) return [];
    const today = dayKey(new Date());
    return events
      .filter((e) => eventDay(e) >= today && plansFor(index, { id: e.venue_id, name: e.venue_name, hall: e.hall }).some((p) => p.id === summary.id))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, index, planId]);
  const event = performances.find((e) => e.id === eventId) ?? null;
  const pickEvent = (id: string | null) => {
    setEventId(id);
    setParams({ event: id });
  };

  useEffect(() => {
    loadSeatPlanIndex().then((ix) => {
      setIndex(ix);
      setPlanId((id) => (id && ix.some((p) => p.id === id) ? id : (ix.find((p) => p.id === 'roh') ?? ix[0])?.id ?? null));
    });
  }, []);

  useEffect(() => {
    if (!planId) return;
    let live = true;
    setError(null);
    loadSeatPlan(planId)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [planId]);

  const choose = (id: string) => {
    initialSeat.current = null;
    setPlanId(id);
    setEventId(null);
    setParams({ plan: id, seat: null, event: null });
  };

  if (index && !index.length) return <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No seating plans have been built yet.</p>;

  return (
    <div className="space-y-4">
      <VenuePicker plans={index ?? []} selected={planId} onPick={choose} />
      {error && <p className="text-sm" style={{ color: 'var(--accent-crimson)' }}>Couldn’t load this plan ({error}).</p>}
      {performances.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <PoundSterling className="h-3.5 w-3.5" style={{ color: 'var(--accent-crimson)' }} aria-hidden />
          Prices for
          <select
            value={event?.id ?? ''}
            onChange={(e) => pickEvent(e.target.value || null)}
            className="min-w-0 max-w-full rounded-md border px-2 py-1.5 text-xs"
            style={selectStyle}
          >
            <option value="">Usual prices at this venue</option>
            {performances.slice(0, 200).map((e) => (
              <option key={e.id} value={e.id}>
                {shortDate(e)} · {timeLabel(e)} · {e.title}
                {e.price ? ` · ${e.price}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {plan && plan.id === planId ? (
        <SeatPlanExplorer plan={plan} event={event} initialSeat={initialSeat.current} onSeatKey={(key) => setParams({ plan: plan.id, seat: key })} />
      ) : (
        !error && <div className="h-[60vh] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />
      )}
    </div>
  );
};

export default SeatingView;
