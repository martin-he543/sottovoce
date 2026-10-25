import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Landmark, MapPin } from 'lucide-react';
import { ArgonButton } from './ArgonButton';
import type { TimetableData, TimetableEvent, TimetableVenue } from '../data/timetableCategories';
import { useSavedEvents } from '../utils/savedEvents';
import { eventPath, venuePath } from '../utils/urlState';
import { shortDate, timeLabel } from '../utils/timetableFormat';
import { SvgIcon } from '../utils/svgIcons';
import { venueImageIndex } from '../utils/venueImage';
import { CategoryPill, EventThumb, SavedEventsRail, VenueThumb } from './TimetableView';

const LASTFM_USER_KEY = 'sottovoce.lastfm.user';

interface FeedResponse {
  events: { id: string; why: string; basis: 'ai' | 'match' | 'category' }[];
  venues: { id: string; why: string }[];
  summary: string;
  tags: string[];
  model_used: string;
  signals: { saved: number; lastfm: string | null };
}

const lastfmUser = () => {
  try {
    return localStorage.getItem(LASTFM_USER_KEY) ?? '';
  } catch {
    return '';
  }
};

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-mono uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
    {children}
  </p>
);

const PickCard: React.FC<{ event: TimetableEvent; why: string }> = ({ event: e, why }) => {
  const { isSaved, toggle } = useSavedEvents();
  const saved = isSaved(e.id);
  return (
    <li
      className="relative flex flex-col gap-3 rounded-xl border p-4"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
    >
      <div className="flex gap-3">
        <EventThumb e={e} />
        <div className="min-w-0 flex-1">
          <a
            href={eventPath(e.id)}
            data-route
            className="font-fraunces text-base font-semibold leading-snug hover:underline underline-offset-2 after:absolute after:inset-0 after:content-['']"
            style={{ color: 'var(--text-primary)' }}
          >
            {e.title}
          </a>
          <div className="mt-1 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
            {shortDate(e)} · {timeLabel(e)}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <a href={venuePath(e.venue_id)} data-route className="relative z-10 hover:underline underline-offset-2">
              {e.venue_name}
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={() => toggle(e)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${e.title} from Taste Profile` : `Save ${e.title} to Taste Profile`}
          className="relative z-10 self-start cursor-pointer leading-none"
          style={{ color: saved ? 'var(--accent-crimson)' : 'var(--text-muted)' }}
        >
          <SvgIcon name="heart" size={20} fill={saved} />
        </button>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {why}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <CategoryPill category={e.category} />
        {e.price && (
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            {e.price}
          </span>
        )}
      </div>
    </li>
  );
};

const VenueCard: React.FC<{ venue: TimetableVenue; why: string; upcoming: number; image?: string }> = ({ venue, why, upcoming, image }) => (
  <li
    className="relative flex flex-col gap-2 rounded-xl border p-4"
    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
  >
    <VenueThumb kind={venue.kind} image={image} className="w-full h-28" iconClass="w-8 h-8" />
    <div className="flex items-center gap-2" style={{ color: 'var(--accent-crimson)' }}>
      <Landmark className="w-4 h-4" aria-hidden />
      <a
        href={venuePath(venue.id)}
        data-route
        className="font-fraunces text-base font-semibold hover:underline underline-offset-2 after:absolute after:inset-0 after:content-['']"
        style={{ color: 'var(--text-primary)' }}
      >
        {venue.name}
      </a>
    </div>
    {venue.address && (
      <div className="flex items-start gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <MapPin className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
        {venue.address}
      </div>
    )}
    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
      {why}
    </p>
    <span className="mt-auto inline-flex items-center gap-1 text-xs font-mono" style={{ color: 'var(--accent-crimson)' }}>
      {upcoming} coming up <ArrowRight className="w-3 h-3" aria-hidden />
    </span>
  </li>
);

/**
 * Home feed: gemini-4-argon's picks (events and venues) from what the listener saved and their linked Last.fm library,
 * then the saved events themselves. Picks appear instantly from a heuristic, then Argon's replace them.
 */
export const FeedView: React.FC<{ data: TimetableData; onOpenTaste: () => void; onOpenTimetable: () => void }> = ({
  data,
  onOpenTaste,
  onOpenTimetable,
}) => {
  const { saved } = useSavedEvents();
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState('');
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const runId = useRef(0);

  const eventsById = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const imagesByVenue = useMemo(() => venueImageIndex(data.events), [data.events]);
  const venuesById = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  const upcomingByVenue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    for (const e of data.events) if (e.start.slice(0, 10) >= today) counts.set(e.venue_id, (counts.get(e.venue_id) ?? 0) + 1);
    return counts;
  }, [data.events]);

  const post = async (ai: boolean, ms: number): Promise<FeedResponse> => {
    const resp = await fetch('/api/feed/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ai,
        username: lastfmUser(),
        saved: savedRef.current.map((s) => ({ id: s.id, title: s.title, category: s.category, venue_name: s.venue_name })),
      }),
      signal: AbortSignal.timeout(ms),
    });
    if (!resp.ok) throw new Error('The feed is unavailable right now.');
    return resp.json();
  };

  const load = useCallback(async () => {
    const id = ++runId.current;
    setError('');
    try {
      const fast = await post(false, 30_000);
      if (id !== runId.current) return;
      setFeed(fast);
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof TypeError ? 'Could not reach the server.' : (err as Error).message);
      return;
    }
    setRefining(true);
    try {
      const ai = await post(true, 120_000);
      if (id === runId.current && ai.events.length) setFeed(ai);
    } catch {
      /* keep the quick picks */
    } finally {
      if (id === runId.current) setRefining(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const picks = (feed?.events ?? []).flatMap((p) => {
    const event = eventsById.get(p.id);
    return event ? [{ event, why: p.why }] : [];
  });
  const venuePicks = (feed?.venues ?? []).flatMap((p) => {
    const venue = venuesById.get(p.id);
    return venue ? [{ venue, why: p.why, upcoming: upcomingByVenue.get(venue.id) ?? 0 }] : [];
  });
  const aiPicks = feed?.events.some((p) => p.basis === 'ai');

  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="feed-for-you">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Eyebrow>Recommended for you</Eyebrow>
            <h2 id="feed-for-you" className="font-fraunces text-2xl sm:text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your feed
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <ArgonButton label="Ask Argon to refresh" busyLabel="Argon is refining…" busy={refining} onClick={() => void load()} />
          </div>
        </div>

        {feed?.summary && (
          <p className="max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {feed.summary}
          </p>
        )}
        {!!feed?.tags?.length && (
          <div className="flex flex-wrap gap-1.5">
            {feed.tags.map((t) => (
              <span key={t} className="rounded-full px-2 py-0.5 text-[11px] font-mono" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent-crimson)' }}>
                {t}
              </span>
            ))}
          </div>
        )}
        {refining && (
          <p role="status" className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Quick picks shown — Argon is refining them…
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs" style={{ color: 'var(--accent-crimson)' }}>
            {error}
          </p>
        )}
        {feed && !saved.length && !feed.signals.lastfm && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Heart a few events to teach the feed your taste, or{' '}
            <button type="button" onClick={onOpenTaste} data-href="/discover/taste" className="underline underline-offset-2 cursor-pointer" style={{ color: 'var(--accent-crimson)' }}>
              link your Last.fm
            </button>
            . Until then, these are highlights.
          </p>
        )}

        {!feed && !error && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />
            ))}
          </div>
        )}
        {picks.length > 0 && (
          <>
            <Eyebrow>Events</Eyebrow>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {picks.map(({ event, why }) => (
                <PickCard key={event.id} event={event} why={why} />
              ))}
            </ul>
          </>
        )}
        {venuePicks.length > 0 && (
          <>
            <Eyebrow>Venues to try</Eyebrow>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {venuePicks.map(({ venue, why, upcoming }) => (
                <VenueCard key={venue.id} venue={venue} why={why} upcoming={upcoming} image={imagesByVenue.get(venue.id)} />
              ))}
            </ul>
          </>
        )}
        {feed && !aiPicks && !refining && feed.model_used && (
          <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {feed.model_used}
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="feed-saved">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Eyebrow>Hearted events</Eyebrow>
            <h2 id="feed-saved" className="font-fraunces text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your saved events
            </h2>
          </div>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={onOpenTimetable} data-href="/discover/events" className="underline underline-offset-2 cursor-pointer" style={{ color: 'var(--accent-crimson)' }}>
              Browse events
            </button>
            <button type="button" onClick={onOpenTaste} data-href="/discover/taste" className="underline underline-offset-2 cursor-pointer" style={{ color: 'var(--accent-crimson)' }}>
              Taste profile
            </button>
          </div>
        </div>
        <SavedEventsRail />
      </section>
    </div>
  );
};
