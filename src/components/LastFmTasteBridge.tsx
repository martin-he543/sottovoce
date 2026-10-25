import { ArgonButton } from './ArgonButton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Armchair, CalendarPlus, CalendarSearch, Disc3, ExternalLink, Info, Landmark, MapPin, Navigation, Ticket, TrainFront } from 'lucide-react';
import type { TastePick, UserTasteProfile } from '../types/sottovoce';
import { detectSource, SOURCE_META } from '../utils/eventSource';
import { loadSeatPlanIndex, plansFor, type SeatPlanSummary } from '../utils/seatPlan';
import { EventThumb } from './TimetableView';
import { SourceBadge, SourceLogo } from './SourceLogo';
import { eventPath, venuePath } from '../utils/urlState';

const DEFAULT_USER = 'martinhe543';
const USER_KEY = 'sottovoce.lastfm.user';

const fmtWhen = (p: TastePick) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(p.time_known ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(p.time_known ? p.start : `${p.start.slice(0, 10)}T12:00:00Z`));

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** Google Calendar "template" link: opens a prefilled event the listener can save (UTC stamps; all-day when the time is unknown). */
function calendarUrl(p: TastePick) {
  const start = new Date(p.time_known ? p.start : `${p.start.slice(0, 10)}T12:00:00Z`);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const end = p.event?.end && p.time_known ? new Date(p.event.end) : new Date(start.getTime() + 2.5 * 3600_000);
  const day = p.start.slice(0, 10).replace(/-/g, '');
  const next = new Date(`${p.start.slice(0, 10)}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `https://calendar.google.com/calendar/render?${q({
    action: 'TEMPLATE',
    text: p.title,
    dates: p.time_known ? `${stamp(start)}/${stamp(end)}` : `${day}/${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
    location: [p.venue_name, p.venue?.address].filter(Boolean).join(', '),
    details: `${p.why}${p.url ? `\n\nTickets: ${p.url}` : ''}`,
  })}`;
}

interface PickLink {
  key: string;
  label: string;
  href?: string;
  icon: React.ReactNode;
  external?: boolean;
  /** An in-app page: followed without a reload (see routeLinkClicks). */
  route?: boolean;
}

/** Every useful next step for a pick: booking, details, venue, directions, the in-app map / journey planner / 3D seats, calendar. */
function linksFor(p: TastePick, plans: SeatPlanSummary[]): { book?: PickLink; rest: PickLink[] } {
  const v = p.venue;
  const at = v?.lat != null && v?.lng != null ? `${v.lat},${v.lng}` : '';
  const place = [p.venue_name, v?.address].filter(Boolean).join(', ') || p.venue_name;
  const plan = p.event ? plansFor(plans, { id: p.event.venue_id, name: p.venue_name, hall: p.event.hall })[0] : undefined;
  const ic = 'w-3.5 h-3.5';
  const src = detectSource(p.url, p.source);
  const rest: PickLink[] = [];
  if (p.event) rest.push({ key: 'details', label: 'Event page', href: eventPath(p.event.id), icon: <Info className={ic} />, route: true });
  if (p.event) rest.push({ key: 'venuepage', label: 'Venue page', href: venuePath(p.event.venue_id), icon: <Landmark className={ic} />, route: true });
  // Timetable "site" is sometimes just one listing's page, so only real venue sites (not scraped ext_ venues) count as the venue's website.
  if (v?.site && !v.id.startsWith('ext_')) rest.push({ key: 'venue', label: 'Venue website', href: v.site, icon: <Landmark className={ic} />, external: true });
  else rest.push({ key: 'venue', label: 'Venue info', href: `https://www.google.com/search?${q({ q: `${p.venue_name} London venue` })}`, icon: <Landmark className={ic} />, external: true });
  rest.push({
    key: 'directions',
    label: 'Directions',
    href: `https://www.google.com/maps/dir/?${q({ api: '1', destination: at || place, travelmode: 'transit' })}`,
    icon: <Navigation className={ic} />,
    external: true,
  });
  if (at) {
    rest.push({
      key: 'map',
      label: 'Venue on map',
      href: `/discover/events?${q({ location: at, zoom: '17', ...(plan?.mapVenueIds?.[0] ? { pin: plan.mapVenueIds[0] } : {}) })}`,
      icon: <MapPin className={ic} />,
    });
    rest.push({ key: 'journey', label: 'Plan journey', href: `/discover/journey?${q({ jploc: at, jpzoom: '15' })}`, icon: <TrainFront className={ic} /> });
  }
  if (plan) rest.push({ key: 'seats', label: 'Seating plan', href: `/discover/seating?${q({ plan: plan.id })}`, icon: <Armchair className={ic} /> });
  rest.push({ key: 'cal', label: 'Add to calendar', href: calendarUrl(p), icon: <CalendarPlus className={ic} />, external: true });
  rest.push({ key: 'dates', label: 'All dates', href: `/discover/events?${q({ q: p.title, exact: '1', range: 'all' })}`, icon: <CalendarSearch className={ic} /> });
  const book = p.url
    ? { key: 'book', label: `Book tickets on ${SOURCE_META[src].label}`, href: p.url, icon: <Ticket className="w-3.5 h-3.5" />, external: true }
    : undefined;
  return { book, rest };
}

const linkClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[#1A1E2B] hover:bg-[#D4AF37] hover:text-[#0B0C10] text-[#ECE9E2] border border-[#2E3446] transition-colors whitespace-nowrap cursor-pointer';

const PickLinks: React.FC<{ pick: TastePick; plans: SeatPlanSummary[] }> = ({ pick, plans }) => {
  const { book, rest } = linksFor(pick, plans);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {book && (
        <a
          href={book.href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#D4AF37] hover:bg-[#E2C15A] text-[#0B0C10] transition-colors whitespace-nowrap"
        >
          {book.icon}
          {book.label}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {rest.map((l) => (
        <a
          key={l.key}
          href={l.href}
          {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
          {...(l.route ? { 'data-route': true } : {})}
          className={linkClass}
        >
          {l.icon}
          {l.label}
          {l.external && <ExternalLink className="w-3 h-3 opacity-60" />}
        </a>
      ))}
    </div>
  );
};

const LibraryList: React.FC<{ title: string; entries: { name: string; artist?: string; playcount: number }[] }> = ({ title, entries }) => (
  <div className="pt-3 border-t border-[#222634] space-y-1.5">
    <div className="text-xs font-semibold text-[#ECE9E2]">{title}</div>
    <ol className="space-y-1 max-h-64 overflow-y-auto pr-1">
      {entries.slice(0, 25).map((e, i) => (
        <li key={`${e.artist ?? ''}${e.name}${i}`} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-[#ECE9E2]">
            <span className="font-mono text-[#9E9A90] mr-1.5">{i + 1}</span>
            {e.name}
            {e.artist && <span className="text-[#9E9A90]"> — {e.artist}</span>}
          </span>
          <span className="font-mono tabular-nums text-[#9E9A90] shrink-0">{e.playcount.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  </div>
);

export const LastFmTasteBridge: React.FC = () => {
  const [usernameInput, setUsernameInput] = useState<string>(() => {
    try {
      return localStorage.getItem(USER_KEY) || DEFAULT_USER;
    } catch {
      return DEFAULT_USER;
    }
  });
  const [profile, setProfile] = useState<UserTasteProfile | null>(null);
  const [picks, setPicks] = useState<TastePick[]>([]);
  const [summary, setSummary] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [plans, setPlans] = useState<SeatPlanSummary[]>([]);

  useEffect(() => {
    void loadSeatPlanIndex().then(setPlans);
  }, []);

  const [upgrading, setUpgrading] = useState(false);
  const runId = useRef(0);

  const post = async (username: string, ai: boolean, ms: number) => {
    const resp = await fetch('/api/lastfm/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, ai }),
      signal: AbortSignal.timeout(ms),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Could not read that Last.fm profile.');
    return data;
  };

  const apply = (data: any) => {
    setProfile(data.profile);
    setPicks(data.picks ?? []);
    setSummary(data.taste_summary ?? '');
    setModel(data.model_used ?? '');
  };

  /** Two steps so the page never hangs on the slow AI call: profile + quick picks first, Gemini's picks swapped in when ready. */
  const load = useCallback(async (username: string) => {
    const id = ++runId.current;
    setErrorMsg('');
    setLoading(true);
    setUpgrading(false);
    try {
      const fast = await post(username, false, 30_000);
      if (id !== runId.current) return;
      apply(fast);
      try {
        localStorage.setItem(USER_KEY, username);
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      if (id !== runId.current) return;
      const timedOut = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
      setErrorMsg(timedOut ? 'Last.fm took too long to answer — try again.' : err instanceof TypeError ? 'Could not reach the server.' : (err as Error).message);
      setLoading(false);
      return;
    }
    setLoading(false);
    setUpgrading(true);
    try {
      const ai = await post(username, true, 120_000);
      if (id === runId.current && ai.picks?.length) apply(ai);
    } catch {
      /* keep the quick picks */
    } finally {
      if (id === runId.current) setUpgrading(false);
    }
  }, []);

  useEffect(() => {
    void load(usernameInput.trim() || DEFAULT_USER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSync = (e: React.FormEvent) => {
    e.preventDefault();
    const username = usernameInput.trim();
    if (!username) {
      setErrorMsg('Enter a Last.fm username.');
      return;
    }
    void load(username);
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#12151E] border border-[#232736] rounded-xl p-5">
        <div className="mb-4 flex items-center gap-3">
          <SourceLogo source="lastfm" size={28} />
          <div>
            <div className="text-xs text-[#9E9A90]">Last.fm · all-time library → upcoming London events</div>
            <h2 className="text-2xl font-serif-display font-semibold text-[#ECE9E2] mt-0.5">
              Picks for your taste
            </h2>
          </div>
        </div>

        <form onSubmit={handleSync} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="lastfm-username-input" className="block text-xs font-medium text-[#B8B4AA] mb-1">
              Last.fm username (public profile)
            </label>
            <input
              id="lastfm-username-input"
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              autoComplete="off"
              className="w-full px-3.5 py-2 text-sm bg-[#0B0C10] border border-[#262936] rounded-lg text-[#ECE9E2] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>
          <ArgonButton type="submit" label="Refresh my taste with Argon" busyLabel="Reading Last.fm…" busy={loading} className="h-[38px]" />
        </form>

        {upgrading && <p role="status" className="text-xs text-[#9E9A90] mt-2">Quick picks shown — Argon is refining them…</p>}
        {errorMsg && <p role="alert" className="text-xs text-[#F43F5E] mt-2">{errorMsg}</p>}
      </div>

      {loading && !profile && (
        <p className="text-sm text-[#9E9A90]" role="status">
          Reading your Last.fm library and matching it to what’s on in London…
        </p>
      )}

      {profile && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-4 bg-[#12151E] border border-[#232736] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#9E9A90]">
              <span className="inline-flex items-center gap-1.5 font-mono text-[#D4AF37]">
                <SourceLogo source="lastfm" size={14} /> last.fm · all time
              </span>
              <span className="font-mono tabular-nums">{profile.total_scrobbles.toLocaleString()} scrobbles</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Disc3 className="w-5 h-5 text-[#D4AF37] shrink-0" />
              <h3 className="text-base font-semibold text-[#ECE9E2]">{profile.display_name}</h3>
            </div>
            {summary && <p className="text-sm text-[#B8B4AA] leading-relaxed">{summary}</p>}
            {profile.dominant_mood_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profile.dominant_mood_tags.map((t) => (
                  <span key={t} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#1A1E2B] text-[#D4AF37]">{t}</span>
                ))}
              </div>
            )}
            <LibraryList title="Top artists" entries={profile.top_artists.map((a) => ({ name: a.name, playcount: a.playcount }))} />
            <LibraryList title="Top albums" entries={profile.top_albums ?? []} />
            <LibraryList title="Top songs" entries={profile.top_tracks ?? []} />
          </div>

          <div className="lg:col-span-8 space-y-3">
            {picks.map((p, index) => {
              const src = detectSource(p.url, p.source);
              return (
                <div
                  key={p.event_id}
                  className="bg-[#12151E] border border-[#232736] hover:border-[#D4AF37]/50 rounded-xl p-5 transition-colors flex gap-4"
                >
                  <EventThumb e={{ image: p.event?.image ?? p.image, sold_out: p.event?.sold_out, category: p.event?.category ?? p.category }} />
                  <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9E9A90]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[#D4AF37] font-semibold">
                        {String(index + 1).padStart(2, '0')}. {p.category.replace('_', ' ').toUpperCase()}
                      </span>
                      <span aria-hidden="true">·</span>
                      {p.event ? (
                        <a href={venuePath(p.event.venue_id)} data-route className="hover:text-[#D4AF37] hover:underline underline-offset-2">{p.venue_name}</a>
                      ) : (
                        <span>{p.venue_name}</span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{fmtWhen(p)}</span>
                    </div>
                    <SourceBadge source={src} />
                  </div>

                  <h3 className="text-xl font-serif-display font-semibold text-[#ECE9E2]">
                    {p.event ? (
                      <a href={eventPath(p.event.id)} data-route className="hover:text-[#D4AF37] hover:underline underline-offset-2">{p.title}</a>
                    ) : (
                      p.title
                    )}
                  </h3>

                  <p className="p-3.5 rounded-lg bg-[#0B0C10] border border-[#222634] text-sm text-[#ECE9E2] leading-relaxed">
                    {p.why}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#9E9A90]">
                    <span>
                      {p.matched.length > 0 && (
                        <>
                          Matched via: <strong className="text-[#ECE9E2]">{p.matched.join(', ')}</strong>
                        </>
                      )}
                      {p.price && <span className="ml-2">{p.price}</span>}
                    </span>
                  </div>

                  <PickLinks pick={p} plans={plans} />
                  </div>
                </div>
              );
            })}
            {picks.length === 0 && !loading && <p className="text-sm text-[#9E9A90]">No upcoming events matched yet — try refreshing.</p>}
            {model && <p className="text-[11px] font-mono text-[#9E9A90]">Picks by {model}</p>}
          </div>
        </div>
      )}
    </div>
  );
};
