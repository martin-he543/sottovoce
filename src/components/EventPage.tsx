import { ArgonTag } from './ArgonButton';
import { useAtlasSimilar } from '../utils/atlasClient';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CalendarSearch, ExternalLink, Globe, MapPin, Ticket } from 'lucide-react';
import { CATEGORY_BY_ID, type TimetableData, type TimetableEvent } from '../data/timetableCategories';
import { detectSource, SOURCE_META } from '../utils/eventSource';
import { useSavedEvents } from '../utils/savedEvents';
import { recordHistory } from '../utils/history';
import { loadSeatPlan, loadSeatPlanIndex, plansFor, type SeatPlan, type SeatPlanSummary } from '../utils/seatPlan';
import { gbp, gbpRange, parseListingPrice, planPriceRange } from '../utils/seatPrices';
import { SvgIcon } from '../utils/svgIcons';
import { dayKey, eventDay, timeLabel } from '../utils/timetableFormat';
import { venuePath } from '../utils/urlState';
import { ListenButtons } from './MediaDock';
import { SourceLogo } from './SourceLogo';
import { SoldOutOverlay, StudentTag } from './TimetableView';
import { BackLink, DirectionsLinks, EventListRow, PlaceMap, SectionHeading, hasCoords, upcoming, useDocumentTitle } from './DetailParts';

// three.js loads only on pages that have a seating plan.
const SeatPlanExplorer = lazy(() => import('./seatmap/SeatingView').then((m) => ({ default: m.SeatPlanExplorer })));

interface EventSummary {
  ai: boolean;
  summary: string;
  sections: { title: string; items: string[] }[];
  note?: string;
}

// Summaries are slow (page scrape + Gemini), so keep the ones already fetched this session.
const summaryCache = new Map<string, EventSummary>();

/** A scraped, Gemini-parsed summary of the listing's own page. */
function useEventSummary(e: TimetableEvent | undefined) {
  const url = e?.url;
  const [summary, setSummary] = useState<EventSummary | null>(() => (url ? summaryCache.get(url) ?? null : null));
  const [loading, setLoading] = useState(!!url && !summary);
  useEffect(() => {
    if (!e || !url) {
      setSummary(null);
      setLoading(false);
      return;
    }
    const cached = summaryCache.get(url);
    if (cached) {
      setSummary(cached);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setSummary(null);
    setLoading(true);
    fetch('/api/timetable/event-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ url, title: e.title, venue: e.venue_name, start: e.start, price: e.price, blurb: e.blurb }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<EventSummary>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s) => {
        if (s.ai) summaryCache.set(url, s); // a fallback may just mean Gemini was briefly unavailable, so retry next visit
        setSummary(s);
      })
      .catch((err) => err?.name !== 'AbortError' && setSummary(null))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id]);
  return { summary, loading };
}

const fullDate = (e: TimetableEvent) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${eventDay(e)}T12:00:00Z`)
  );

/** Google Calendar "template" link: a prefilled event to save (UTC stamps; all-day when the time is unknown). */
function calendarUrl(e: TimetableEvent, address?: string) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = eventDay(e);
  let dates: string;
  if (e.time_known) {
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : new Date(start.getTime() + 2.5 * 3600_000);
    dates = `${stamp(start)}/${stamp(end)}`;
  } else {
    const next = new Date(`${day}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    dates = `${day.replace(/-/g, '')}/${next.toISOString().slice(0, 10).replace(/-/g, '')}`;
  }
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    location: [e.venue_name, address].filter(Boolean).join(', '),
    details: e.url ? `Tickets: ${e.url}` : '',
  })}`;
}

/** Summary sections that list pieces of music, which get listen buttons. */
const PROGRAMME_RE = /programme|program|repertoire|works|pieces|setlist|set list|music|songs|tracks/i;

const btn = 'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:opacity-85';
const btnStyle = { borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' };

/** Standalone page for one performance: what it is, when and where, how to book and get there, and the other dates. */
export const EventPage: React.FC<{
  id: string;
  data: TimetableData;
  themeMode: 'light' | 'dark';
  /** Open the Journey Planner at this venue, to this performance. */
  onPlanJourney?: (venueId: string, plan?: { eventId?: string; fromHere: boolean }) => void;
  /** Open the Timetable on this performance's venue, filtered to its title and category. */
  onShowInTimetable?: (venueId: string, q?: string, filters?: Record<string, string>) => void;
}> = ({ id, data, themeMode, onPlanJourney, onShowInTimetable }) => {
  const e = useMemo(() => data.events.find((x) => x.id === id), [data.events, id]);
  const venue = useMemo(() => data.venues.find((v) => v.id === e?.venue_id), [data.venues, e?.venue_id]);
  const { isSaved, toggle } = useSavedEvents();
  const { summary, loading } = useEventSummary(e);
  const similar = useAtlasSimilar('events', e?.id);
  const similarEvents = useMemo(() => {
    const byId = new Map(data.events.map((x) => [x.id, x]));
    return similar.flatMap((s) => byId.get(s.id) ?? []).slice(0, 6);
  }, [similar, data.events]);
  useDocumentTitle(e ? `${e.title} at ${e.venue_name}` : 'Event not found');
  useEffect(() => {
    if (e) recordHistory('event', e.id, `${e.title} at ${e.venue_name}`);
  }, [e?.id]);

  // The venue's 3D seating plan, when we have one: found by venue and hall, loaded on demand.
  const [planSummary, setPlanSummary] = useState<SeatPlanSummary | null>(null);
  const [plan, setPlan] = useState<SeatPlan | null>(null);
  const planId = planSummary?.id ?? null;
  useEffect(() => {
    let live = true;
    if (!e) return;
    loadSeatPlanIndex().then((ix) => live && setPlanSummary(plansFor(ix, { id: e.venue_id, name: e.venue_name, hall: e.hall })[0] ?? null));
    return () => {
      live = false;
    };
  }, [e?.venue_id, e?.venue_name, e?.hall]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (planId && plan?.id !== planId) loadSeatPlan(planId).then(setPlan).catch(() => setPlanSummary(null));
  }, [planId, plan]);

  const today = dayKey(new Date());
  // The same show on its other dates (at this venue first, then anywhere).
  const otherDates = useMemo(() => {
    if (!e) return [];
    const same = data.events.filter((x) => x.id !== e.id && x.title === e.title);
    return upcoming(same, today)
      .sort((a, b) => Number(b.venue_id === e.venue_id) - Number(a.venue_id === e.venue_id) || a.start.localeCompare(b.start))
  }, [data.events, e, today]);
  // More at the same venue, other productions.
  const moreHere = useMemo(() => {
    if (!e) return [];
    return upcoming(data.events.filter((x) => x.venue_id === e.venue_id && x.title !== e.title), today);
  }, [data.events, e, today]);
  const [allDates, setAllDates] = useState(false);
  const [allHere, setAllHere] = useState(false);

  if (!e) {
    return (
      <div className="space-y-3 py-8 text-center">
        <h1 className="font-chronicle text-2xl" style={{ color: 'var(--text-primary)' }}>We can’t find that event</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          It may have been removed from the listings, or the link is out of date.
        </p>
        <a href="/discover/events" data-route className="inline-block underline underline-offset-2" style={{ color: 'var(--accent-crimson)' }}>
          Back to Events
        </a>
      </div>
    );
  }

  const meta = CATEGORY_BY_ID[e.category];
  const Icon = meta.icon;
  const saved = isSaved(e.id);
  const past = eventDay(e) < today;
  const text = summary?.summary || e.blurb;
  const listing = parseListingPrice(e.price);
  const usual = planSummary ? planPriceRange(planSummary) : null;
  const place = { name: e.venue_name, address: venue?.address, lat: venue?.lat, lng: venue?.lng };
  const source = detectSource(e.url, e.source);
  const venueLink = venuePath(e.venue_id);
  const onPlan = onPlanJourney && ((fromHere: boolean) => onPlanJourney(e.venue_id, { eventId: e.id, fromHere }));

  return (
    <article className="mx-auto max-w-4xl space-y-6" aria-labelledby="event-title">
      <BackLink href="/discover/events">Events</BackLink>

      <header className="flex flex-col gap-4 sm:flex-row" style={{ borderTop: `4px solid ${meta.color}`, paddingTop: '1rem' }}>
        <div
          className="relative grid h-44 w-full shrink-0 place-items-center overflow-hidden rounded-xl sm:h-56 sm:w-56"
          style={{ background: `color-mix(in srgb, ${meta.color} 20%, var(--bg-surface))`, color: meta.color }}
        >
          <Icon className="h-10 w-10 opacity-70" aria-hidden />
          {e.image && <img src={e.image} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={(ev) => (ev.currentTarget.style.display = 'none')} />}
          {e.sold_out && <SoldOutOverlay large />}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold" style={{ color: meta.color }}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {meta.label}
            </span>
            {e.student && <StudentTag />}
          </div>
          <h1 id="event-title" className="font-chronicle text-3xl leading-tight" style={{ color: 'var(--text-primary)' }}>
            {e.title}
          </h1>
          <p className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
            {fullDate(e)} · {e.time_known ? timeLabel(e) : 'time TBC'}
            {eventDay(e) === today && ' · today'}
          </p>
          {past && (
            <p className="inline-block rounded-md px-2 py-0.5 text-xs font-mono" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
              This performance has passed
            </p>
          )}
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            <a href={venueLink} data-route className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--text-primary)' }}>
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {e.venue_name}
            </a>
            {e.hall ? ` · ${e.hall}` : ''}
            {venue?.address && <span className="block text-xs">{venue.address}</span>}
          </p>
          {e.price ? (
            <p className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Ticket className="h-3.5 w-3.5" aria-hidden />
              {e.price}
              {listing && !listing.max && usual && usual[1] > listing.min && (
                <span style={{ color: 'var(--text-muted)' }}> · top seats usually up to {gbp(usual[1])}</span>
              )}
            </p>
          ) : (
            usual && (
              <p className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Ticket className="h-3.5 w-3.5" aria-hidden />
                Usually {gbpRange(usual)} at this venue
              </p>
            )
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold"
                style={{ backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0' }}
              >
                <Ticket className="h-4 w-4" aria-hidden />
                Book on <SourceLogo source={source} size={16} />
                {SOURCE_META[source].label}
                <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
              </a>
            )}
            <button type="button" onClick={() => toggle(e)} aria-pressed={saved} className={btn} style={{ ...btnStyle, color: saved ? 'var(--accent-crimson)' : btnStyle.color }}>
              <SvgIcon name="heart" size={16} fill={saved} />
              {saved ? 'Saved' : 'Save'}
            </button>
            {onShowInTimetable && (
              <button type="button" onClick={() => onShowInTimetable(e.venue_id)} className={btn} style={btnStyle}>
                <CalendarSearch className="h-4 w-4" aria-hidden />
                Show in Events
              </button>
            )}
            {!past && (
              <a href={calendarUrl(e, venue?.address)} target="_blank" rel="noreferrer noopener" className={btn} style={btnStyle}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Add to calendar
              </a>
            )}
          </div>
        </div>
      </header>

      <section aria-label="About this event" aria-live="polite" className="space-y-4 text-sm" style={{ color: 'var(--text-primary)' }}>
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Summarising event page">
            {[100, 92, 60].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded" style={{ width: `${w}%`, backgroundColor: 'var(--bg-subtle)' }} />
            ))}
            <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>Reading the event page…</p>
          </div>
        ) : (
          <>
            {text ? <p className="max-w-prose leading-relaxed">{text}</p> : <p style={{ color: 'var(--text-secondary)' }}>No description is available for this event yet.</p>}
            {summary?.sections.map((s) => {
              const music = PROGRAMME_RE.test(s.title);
              return (
              <section key={s.title}>
                <SectionHeading>{s.title}</SectionHeading>
                <ul className={music ? 'list-none space-y-0.5' : 'list-disc space-y-0.5 pl-5'} style={{ color: 'var(--text-secondary)' }}>
                  {s.items.map((it, i) => (
                    <li key={i} className={music ? 'group flex items-start justify-between gap-3' : undefined}>
                      <span className="min-w-0">{it}</span>
                      {music && <ListenButtons query={it.replace(/\s*\([^)]*\)\s*$/, '')} title={it} subtitle={e.title} />}
                    </li>
                  ))}
                </ul>
              </section>
              );
            })}
            {summary?.ai && (
              <p className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <ArgonTag>Argon</ArgonTag> Summarised by Argon from the venue’s page — check the booking page for final details.
              </p>
            )}
          </>
        )}
      </section>

      {hasCoords(place) && (
        <section aria-label="Getting there" className="space-y-3">
          <SectionHeading>Getting there</SectionHeading>
          <PlaceMap place={place} color={meta.color} themeMode={themeMode} />
          <DirectionsLinks place={place} onPlan={onPlan} />
        </section>
      )}

      {planId && (
        <section aria-label="Seating plan" className="space-y-3">
          <SectionHeading>Seats &amp; prices</SectionHeading>
          {plan?.id === planId ? (
            <Suspense fallback={<div className="h-[340px] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />}>
              <SeatPlanExplorer plan={plan} event={e} compact />
            </Suspense>
          ) : (
            <div className="h-[340px] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />
          )}
        </section>
      )}

      {otherDates.length > 0 && (
        <section aria-label="Other dates">
          <SectionHeading count={otherDates.length}>Other dates</SectionHeading>
          <ul className="space-y-1.5">
            {(allDates ? otherDates : otherDates.slice(0, 12)).map((x) => (
              <EventListRow key={x.id} e={x} showVenue={x.venue_id !== e.venue_id} />
            ))}
          </ul>
          {otherDates.length > 12 && !allDates && (
            <button type="button" onClick={() => setAllDates(true)} className="mt-2 mr-3 cursor-pointer text-xs font-mono underline underline-offset-2" style={{ color: 'var(--text-secondary)' }}>
              Show all {otherDates.length}
            </button>
          )}
          <a href={`/discover/events?${new URLSearchParams({ q: e.title, exact: '1', range: 'all' })}`} data-route className="mt-2 inline-flex items-center gap-1 text-xs font-mono underline underline-offset-2" style={{ color: 'var(--text-secondary)' }}>
            <CalendarSearch className="h-3.5 w-3.5" aria-hidden />
            All dates in Events
          </a>
        </section>
      )}

      {similarEvents.length > 0 && (
        <section aria-label="Similar in London">
          <SectionHeading count={similarEvents.length}>Similar in London</SectionHeading>
          <ul className="space-y-1.5">
            {similarEvents.map((x) => (
              <EventListRow key={x.id} e={x} />
            ))}
          </ul>
          <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            Nearest by meaning · MongoDB Atlas Vector Search (Voyage embeddings)
          </p>
        </section>
      )}

      {moreHere.length > 0 && (
        <section aria-label={`More at ${e.venue_name}`}>
          <SectionHeading count={moreHere.length}>More at {e.venue_name}</SectionHeading>
          <ul className="space-y-1.5">
            {(allHere ? moreHere : moreHere.slice(0, 6)).map((x) => (
              <EventListRow key={x.id} e={x} />
            ))}
          </ul>
          {moreHere.length > 6 && !allHere && (
            <button type="button" onClick={() => setAllHere(true)} className="mt-2 mr-3 cursor-pointer text-xs font-mono underline underline-offset-2" style={{ color: 'var(--text-secondary)' }}>
              Show all {moreHere.length}
            </button>
          )}
          <a href={venueLink} data-route className="mt-2 inline-flex items-center gap-1 text-xs font-mono underline underline-offset-2" style={{ color: 'var(--text-secondary)' }}>
            <Globe className="h-3.5 w-3.5" aria-hidden />
            Everything at {e.venue_name}
          </a>
        </section>
      )}
    </article>
  );
};
