import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Armchair, ExternalLink, Globe, MapPin } from 'lucide-react';
import { TIMETABLE_CATEGORIES, VENUE_KINDS, type TimetableCategory, type TimetableData } from '../data/timetableCategories';
import type { CivicNode } from '../types/sottovoce';
import { loadSeatPlan, loadSeatPlanIndex, plansFor, type SeatPlan, type SeatPlanSummary } from '../utils/seatPlan';
import { gbpRange, planPriceRange } from '../utils/seatPrices';
import { dayKey, eventDay } from '../utils/timetableFormat';
import { BackLink, DirectionsLinks, EventListRow, PlaceMap, SectionHeading, hasCoords, upcoming, useDocumentTitle } from './DetailParts';
import { recordHistory } from '../utils/history';
import { venueImage, venueImageIndex, venuePhotos } from '../utils/venueImage';
import { VenueThumb } from './TimetableView';
import { useMapVenues } from './TubeMapEmbed';

// three.js loads only on pages that have a seating plan.
const SeatPlanExplorer = lazy(() => import('./seatmap/SeatingView').then((m) => ({ default: m.SeatPlanExplorer })));

const planSkeleton = <div className="h-[340px] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />;

/** The venue's 3D seating plan(s), expanded; with several halls, a switch between them. */
const VenueSeating: React.FC<{ plans: SeatPlanSummary[] }> = ({ plans }) => {
  const [pick, setPick] = useState(plans[0].id);
  const [plan, setPlan] = useState<SeatPlan | null>(null);
  const id = plans.some((p) => p.id === pick) ? pick : plans[0].id;
  useEffect(() => {
    let live = true;
    loadSeatPlan(id).then((p) => live && setPlan(p)).catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <section aria-label="Seating plan" className="space-y-3">
      <SectionHeading>Seats &amp; prices</SectionHeading>
      {plans.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hall">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === id}
              onClick={() => setPick(p.id)}
              className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-mono font-semibold"
              style={p.id === id ? { backgroundColor: 'var(--text-primary)', borderColor: 'var(--text-primary)', color: 'var(--bg-surface)' } : { borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}
            >
              {p.hall || p.name}
            </button>
          ))}
        </div>
      )}
      {plan?.id === id ? (
        <Suspense fallback={planSkeleton}>
          <SeatPlanExplorer plan={plan} compact />
        </Suspense>
      ) : (
        planSkeleton
      )}
    </section>
  );
};

const dayHeading = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00Z`));

const PAGE_SIZE = 40;

/** Standalone page for one venue: where it is and how to get there, and everything coming up. `id` is a Timetable or map venue id. */
export const VenuePage: React.FC<{
  id: string;
  data: TimetableData;
  civicNodes: CivicNode[];
  themeMode: 'light' | 'dark';
  /** Open the Journey Planner at this venue. */
  onPlanJourney?: (venueId: string, plan?: { eventId?: string; fromHere: boolean }) => void;
  /** Open this venue on the Timetable's map and list. */
  onShowInTimetable?: (venueId: string, q?: string, filters?: Record<string, string>) => void;
}> = ({ id, data, civicNodes, themeMode, onPlanJourney, onShowInTimetable }) => {
  const mapVenues = useMapVenues(civicNodes, data.venues);
  const venue = useMemo(() => {
    const mv = mapVenues.find((v) => v.id === id) ?? mapVenues.find((v) => v.ttIds?.includes(id));
    const ttIds = mv?.ttIds ?? (data.venues.some((v) => v.id === id) ? [id] : []);
    const tt = data.venues.find((v) => v.id === id) ?? data.venues.find((v) => ttIds.includes(v.id));
    const base = mv ?? tt;
    if (!base) return null;
    // A scraped (ext_) venue's "site" is just one listing's page, so only the curated venues' sites count as a website.
    const site = data.venues.find((v) => ttIds.includes(v.id) && !v.id.startsWith('ext_') && v.site)?.site;
    return {
      id: mv?.id ?? id,
      name: base.name,
      kind: base.kind,
      address: base.address,
      lat: base.lat,
      lng: base.lng,
      site,
      ttIds,
    };
  }, [mapVenues, data.venues, id]);
  useDocumentTitle(venue ? venue.name : 'Venue not found');
  useEffect(() => {
    if (venue) recordHistory('venue', id, venue.name);
  }, [id, venue?.name]);

  const [planIndex, setPlanIndex] = useState<SeatPlanSummary[]>([]);
  useEffect(() => {
    loadSeatPlanIndex().then(setPlanIndex);
  }, []);

  const today = dayKey(new Date());
  const all = useMemo(() => (venue ? upcoming(data.events.filter((e) => venue.ttIds.includes(e.venue_id)), today) : []), [data.events, venue, today]);
  const [category, setCategory] = useState<TimetableCategory | ''>('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => {
    setCategory('');
    setLimit(PAGE_SIZE);
  }, [id]);
  const counts = useMemo(() => {
    const m = new Map<TimetableCategory, number>();
    for (const e of all) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [all]);
  const shown = category ? all.filter((e) => e.category === category) : all;
  const days = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const e of shown.slice(0, limit)) {
      const k = eventDay(e);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return [...m.entries()];
  }, [shown, limit]);

  if (!venue) {
    return (
      <div className="space-y-3 py-8 text-center">
        <h1 className="font-chronicle text-2xl" style={{ color: 'var(--text-primary)' }}>We can’t find that venue</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>The link may be out of date.</p>
        <a href="/discover/events" data-route className="inline-block underline underline-offset-2" style={{ color: 'var(--accent-crimson)' }}>
          Back to Events
        </a>
      </div>
    );
  }

  const kind = VENUE_KINDS.find((k) => k.id === venue.kind)?.label ?? '';
  const image = venueImage(venue.ttIds, venueImageIndex(data.events));
  const photos = venuePhotos(venue.ttIds);
  const plans = plansFor(planIndex, { id: venue.ttIds[0] ?? venue.id, name: venue.name });
  const usual = plans[0] ? planPriceRange(plans[0]) : null;
  const place = { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng };
  const onPlan = onPlanJourney && ((fromHere: boolean) => onPlanJourney(venue.id, { fromHere }));
  const link = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:opacity-85';
  const linkStyle = { borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' };

  return (
    <article className="mx-auto max-w-4xl space-y-6" aria-labelledby="venue-title">
      <BackLink href="/discover/events">Events</BackLink>

      <header className="space-y-1.5" style={{ borderTop: '4px solid var(--accent-crimson)', paddingTop: '1rem' }}>
        <VenueThumb kind={venue.kind} image={image} className="w-full h-48 sm:h-64 mb-3 rounded-xl" iconClass="w-12 h-12" />
        {photos.length > 1 && (
          <ul className="mb-3 flex gap-2 overflow-x-auto" aria-label="Photos">
            {photos.map((p) => (
              <li key={p.image} className="shrink-0">
                <a href={p.page} target="_blank" rel="noreferrer noopener" title={`${p.title} · Wikimedia`}>
                  <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-28 rounded-md object-cover" onError={(ev) => (ev.currentTarget.style.display = 'none')} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {photos.length > 0 && (
          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            Photo: <a href={photos[0].page} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">Wikimedia</a>
          </p>
        )}
        <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent-crimson)' }}>{kind}</span>
        <h1 id="venue-title" className="font-chronicle text-3xl leading-tight" style={{ color: 'var(--text-primary)' }}>
          {venue.name}
        </h1>
        {venue.address && (
          <p className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {venue.address}
          </p>
        )}
        <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          {all.length ? `${all.length} upcoming performance${all.length === 1 ? '' : 's'}` : 'Nothing upcoming is listed'}
          {usual && ` · usually ${gbpRange(usual)}`}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {venue.site && (
            <a href={venue.site} target="_blank" rel="noreferrer noopener" className={link} style={linkStyle}>
              <Globe className="h-4 w-4" aria-hidden />
              Venue website
              <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
            </a>
          )}
          {plans.map((p) => (
            <a key={p.id} href={`/discover/seating?plan=${encodeURIComponent(p.id)}`} data-route className={link} style={linkStyle}>
              <Armchair className="h-4 w-4" aria-hidden />
              Seating plan{plans.length > 1 ? ` · ${p.hall || p.name}` : ''}
            </a>
          ))}
          {onShowInTimetable && hasCoords(place) && (
            <button type="button" onClick={() => onShowInTimetable(venue.id, undefined, category ? { category } : undefined)} className={`${link} cursor-pointer`} style={linkStyle}>
              <MapPin className="h-4 w-4" aria-hidden />
              Show on the Events map
            </button>
          )}
        </div>
      </header>

      {hasCoords(place) && (
        <section aria-label="Getting there" className="space-y-3">
          <SectionHeading>Getting there</SectionHeading>
          <PlaceMap place={place} themeMode={themeMode} />
          <DirectionsLinks place={place} onPlan={onPlan} />
        </section>
      )}

      {plans.length > 0 && <VenueSeating plans={plans} />}

      <section aria-label="What’s on">
        <SectionHeading count={all.length}>What’s on</SectionHeading>
        {all.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No upcoming performances are listed for this venue right now.
          </p>
        ) : (
          <>
            {counts.size > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
                {[{ id: '' as const, label: 'All', color: 'var(--text-primary)', n: all.length }, ...TIMETABLE_CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({ id: c.id, label: c.label, color: c.color, n: counts.get(c.id)! }))].map((c) => {
                  const on = category === c.id;
                  return (
                    <button
                      key={c.id || 'all'}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setCategory(c.id);
                        setLimit(PAGE_SIZE);
                      }}
                      className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-mono font-semibold"
                      style={on ? { backgroundColor: c.color, borderColor: c.color, color: '#FAF6F0' } : { borderColor: 'var(--border-hairline)', color: c.color }}
                    >
                      {c.label} {c.n}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="space-y-4">
              {days.map(([day, events]) => (
                <div key={day}>
                  <h3 className="mb-1.5 font-chronicle text-lg" style={{ color: 'var(--text-primary)' }}>
                    {day === today ? `Today · ${dayHeading(day)}` : dayHeading(day)}
                  </h3>
                  <ul className="space-y-1.5">
                    {events.map((e) => (
                      <EventListRow key={e.id} e={e} showDate={false} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {shown.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className="mt-3 w-full cursor-pointer rounded-lg border py-2 text-sm"
                style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}
              >
                Show more ({shown.length - limit} remaining)
              </button>
            )}
          </>
        )}
      </section>
    </article>
  );
};
