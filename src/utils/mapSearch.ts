import type { LiveEvent } from '../types/sottovoce';
import type { TimetableEvent } from '../data/timetableCategories';
import { haversineDistanceMeters } from './sottovoceEngine';
import { normTitle } from './londonPerformances';
import { dayKey, eventDay } from './timetableFormat';
import { venueImage, venueImageIndex } from './venueImage';

/** The slice of a map venue that search needs (TubeMapEmbed's MapVenue satisfies it). */
export interface SearchableVenue {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  address?: string;
  icon?: string;
  /** Ids of the Timetable venues at this spot. */
  ttIds?: string[];
}

export interface PlaceVenueResult {
  type: 'venue';
  venueId: string;
  name: string;
  sub: string;
  icon: string;
  lat: number;
  lon: number;
  /** A poster from one of its listings, when it has one. */
  image?: string;
}

export interface PlaceShow {
  eventId: string;
  venueId?: string;
  venue: string;
  lat: number;
  lon: number;
  /** "Sat 24 Oct · 19:30", London time. */
  label: string;
  /** London wall-clock date (YYYYMMDD) and time (HH:MM), the form the journey planner takes. */
  ymd: string;
  hhmm: string;
}

export interface PlaceProductionResult {
  type: 'production';
  title: string;
  icon: string;
  shows: PlaceShow[];
}

export type PlaceResult = PlaceVenueResult | PlaceProductionResult;

const KIND_LABEL: Record<string, string> = { opera: 'Opera house', theatre: 'Theatre', concert: 'Concert hall' };
const CATEGORY_LABEL: Record<LiveEvent['event_category'], string> = {
  opera: 'opera',
  musical_theatre: 'musical theatre west end',
  bandsintown_gig: 'gig concert live music',
  chamber_luma: 'chamber recital concert',
};
const CATEGORY_ICON: Record<LiveEvent['event_category'], string> = {
  opera: 'mic-vocal',
  musical_theatre: 'drama',
  bandsintown_gig: 'guitar',
  chamber_luma: 'music-4',
};
const KIND_ICON: Record<string, string> = { opera: 'mic-vocal', theatre: 'drama', concert: 'music-4' };

/** An event that began more than this long ago is over, whatever its status says. */
const STILL_RELEVANT_MS = 3 * 3600_000;
const MAX_VENUES = 5;
const MAX_PRODUCTIONS = 8;
/** Planner "arrive by" time for a listing whose start time isn't known. */
const UNKNOWN_TIME = '18:00';
const TT_CATEGORY_LABEL: Record<TimetableEvent['category'], string> = {
  opera: 'opera',
  classical: 'classical orchestral concert recital',
  live_music: 'gig concert live music',
  drama: 'play theatre drama',
  musical: 'musical theatre west end',
  dance: 'dance ballet',
};
const TT_CATEGORY_ICON: Record<TimetableEvent['category'], string> = {
  opera: 'mic-vocal',
  classical: 'music-4',
  live_music: 'guitar',
  drama: 'drama',
  musical: 'sparkles',
  dance: 'person-standing',
};

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function londonStamp(iso: string): { label: string; ymd: string; hhmm: string } | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of londonFmt.formatToParts(t)) p[part.type] = part.value;
  const mm = String(new Date(`${p.day} ${p.month} ${p.year} UTC`).getUTCMonth() + 1).padStart(2, '0');
  const hhmm = `${p.hour}:${p.minute}`;
  return {
    label: `${p.weekday} ${p.day} ${p.month} · ${hhmm}`,
    ymd: `${p.year}${mm}${p.day.padStart(2, '0')}`,
    hhmm,
  };
}

/** The venue an event is at: within 200 m of a pin, else a name match. */
export function venueForEvent<V extends SearchableVenue>(e: LiveEvent, venues: V[]): V | undefined {
  const [lng, lat] = e.location.coordinates;
  const near = venues
    .map((v) => ({ v, d: haversineDistanceMeters(v.lat, v.lng, lat, lng) }))
    .filter((x) => x.d < 200)
    .sort((a, b) => a.d - b.d)[0];
  if (near) return near.v;
  const name = e.venue_name.toLowerCase();
  return venues.find((v) => name.includes(v.name.toLowerCase().slice(0, 12)));
}

const terms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (hay: string, ts: string[]) => ts.every((t) => hay.includes(t));

/**
 * Venues, and productions grouped with every date they play, that match `q`.
 * Dates are chronological; past events are dropped.
 */
export function searchPlaces(
  q: string,
  venues: SearchableVenue[],
  events: LiveEvent[],
  now: number = Date.now(),
  timetable: TimetableEvent[] = []
): PlaceResult[] {
  const ts = terms(q);
  if (!ts.length) return [];

  const images = venueImageIndex(timetable);
  const venueHits = venues
    .filter((v) => matches(`${v.name} ${v.address ?? ''} ${KIND_LABEL[v.kind] ?? v.kind}`.toLowerCase(), ts))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(ts[0])) - Number(a.name.toLowerCase().startsWith(ts[0])))
    .slice(0, MAX_VENUES)
    .map<PlaceVenueResult>((v) => ({
      type: 'venue',
      venueId: v.id,
      name: v.name,
      sub: `${KIND_LABEL[v.kind] ?? v.kind}${v.address ? ` · ${v.address}` : ''}`,
      icon: v.icon ?? KIND_ICON[v.kind] ?? 'drama',
      lat: v.lat,
      lon: v.lng,
      image: venueImage(v.ttIds, images),
    }));

  type Group = PlaceProductionResult & { titleHit: boolean };
  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  const add = (title: string, icon: string, titleHit: boolean, show: PlaceShow, key: string) => {
    // The live feed and the Timetable often list the same night; show it once.
    const dedupe = `${key}|${show.venueId ?? show.venue}|${show.ymd}|${show.hhmm}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { type: 'production', title, icon, shows: [], titleHit }));
    g.titleHit ||= titleHit;
    g.shows.push(show);
  };

  for (const e of events) {
    if (new Date(e.start_time_iso).getTime() < now - STILL_RELEVANT_MS) continue;
    const stamp = londonStamp(e.start_time_iso);
    if (!stamp) continue;
    const venue = venueForEvent(e, venues);
    const hay = `${e.title} ${CATEGORY_LABEL[e.event_category] ?? ''} ${e.venue_name} ${venue?.name ?? ''} ${e.source_platform}`.toLowerCase();
    if (!matches(hay, ts)) continue;
    add(
      e.title,
      CATEGORY_ICON[e.event_category] ?? 'drama',
      matches(e.title.toLowerCase(), ts),
      {
        eventId: e.event_id,
        venueId: venue?.id,
        venue: venue?.name ?? e.venue_name,
        lat: venue?.lat ?? e.location.coordinates[1],
        lon: venue?.lng ?? e.location.coordinates[0],
        ...stamp,
      },
      normTitle(e.title) || e.title
    );
  }

  const today = dayKey(new Date(now));
  const byTt = new Map<string, SearchableVenue>();
  for (const v of venues) for (const id of v.ttIds ?? []) byTt.set(id, v);
  for (const e of timetable) {
    const day = eventDay(e);
    if (day < today) continue;
    const venue = byTt.get(e.venue_id);
    if (!venue) continue; // no coordinates to route to
    const stamp = e.time_known ? londonStamp(e.start) : null;
    const ymd = stamp?.ymd ?? day.replace(/-/g, '');
    const hhmm = stamp?.hhmm ?? UNKNOWN_TIME;
    if (e.time_known && new Date(e.start).getTime() < now - STILL_RELEVANT_MS) continue;
    const hay = `${e.title} ${TT_CATEGORY_LABEL[e.category]} ${e.venue_name} ${venue.name}`.toLowerCase();
    if (!matches(hay, ts)) continue;
    const label =
      stamp?.label ??
      SHORT_DAY.format(new Date(`${day}T12:00:00Z`));
    add(
      e.title,
      TT_CATEGORY_ICON[e.category] ?? 'drama',
      matches(e.title.toLowerCase(), ts),
      { eventId: e.id, venueId: venue.id, venue: venue.name, lat: venue.lat, lon: venue.lng, label, ymd, hhmm },
      normTitle(e.title) || e.title
    );
  }

  const first = (g: Group) => g.shows[0].ymd + g.shows[0].hhmm;
  const eventHits = [...groups.values()]
    .map((g) => {
      g.shows.sort((a, b) => (a.ymd + a.hhmm).localeCompare(b.ymd + b.hhmm));
      return g;
    })
    // Productions whose title matches come before ones that merely play at a matching venue.
    .sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || first(a).localeCompare(first(b)))
    .slice(0, MAX_PRODUCTIONS)
    .map(({ titleHit: _titleHit, ...g }) => g);

  return [...venueHits, ...eventHits];
}
