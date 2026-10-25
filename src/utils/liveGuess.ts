import type { TimetableEvent, TimetableVenue } from '../data/timetableCategories';
import { dayKey, eventDay } from './timetableFormat';

/**
 * "Live": where is this person, and what are they probably watching? Ranks today's listings at venues around a position
 * by how close the venue is and how well the listing's time fits now.
 */

export type LiveStatus = 'on-now' | 'starting-soon' | 'later' | 'earlier';

export interface LiveCandidate {
  event: TimetableEvent;
  venue: TimetableVenue;
  /** Metres from the position to the venue. */
  distance: number;
  status: LiveStatus;
  score: number;
}

export interface LiveGuess {
  candidates: LiveCandidate[];
  /** The listing to open straight away, when one clearly stands out. */
  confident: LiveCandidate | null;
  /** The nearest venue within walking distance, even with nothing listed on it (for "You're near …"). */
  nearestVenue: { venue: TimetableVenue; distance: number } | null;
}

const MIN = 60_000;
const SEARCH_RADIUS_M = 1500;
const CONFIDENT_RADIUS_M = 300;

/** Great-circle distance in metres. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How long a performance usually runs when the listing has no end time. */
const RUN_MINUTES: Record<TimetableEvent['category'], number> = {
  opera: 180,
  musical: 165,
  dance: 150,
  drama: 150,
  classical: 120,
  live_music: 120,
};

/** The listings that are about the stage rather than a gig count for more when a place has both. */
const CATEGORY_WEIGHT: Record<TimetableEvent['category'], number> = {
  opera: 1,
  musical: 1,
  dance: 0.9,
  drama: 0.9,
  classical: 0.85,
  live_music: 0.5,
};

export function liveStatus(e: TimetableEvent, now: Date): LiveStatus | null {
  if (!e.time_known) return eventDay(e) === dayKey(now) ? 'later' : null;
  const start = new Date(e.start).getTime();
  const end = e.end ? new Date(e.end).getTime() : start + RUN_MINUTES[e.category] * MIN;
  const t = now.getTime();
  if (t >= start - 15 * MIN && t <= end) return 'on-now';
  if (t < start) return start - t <= 75 * MIN ? 'starting-soon' : eventDay(e) === dayKey(now) ? 'later' : null;
  return t - end <= 4 * 60 * MIN && eventDay(e) === dayKey(now) ? 'earlier' : null;
}

/** One row per show per venue: a matinee and an evening of the same production are the same answer, so the likelier one stays. */
function bestPerShow(list: LiveCandidate[]): LiveCandidate[] {
  const seen = new Map<string, LiveCandidate>();
  for (const c of list) {
    const key = `${c.venue.id}|${c.event.title.toLowerCase()}`;
    const have = seen.get(key);
    if (!have || c.score > have.score) seen.set(key, c);
  }
  return [...seen.values()];
}

const STATUS_WEIGHT: Record<LiveStatus, number> = { 'on-now': 1, 'starting-soon': 0.8, later: 0.25, earlier: 0.12 };

export function guessLive(
  at: { lat: number; lng: number; accuracy?: number },
  events: TimetableEvent[],
  venues: TimetableVenue[],
  now = new Date(),
  limit = 8
): LiveGuess {
  // Within the fix's own uncertainty (at least a building's width) venues are equally near, so they tie.
  const certain = Math.min(150, Math.max(30, at.accuracy ?? 30));
  const located = new Map<string, { venue: TimetableVenue; distance: number }>();
  for (const v of venues) {
    if (v.lat == null || v.lng == null) continue;
    const distance = metresBetween(at.lat, at.lng, v.lat, v.lng);
    if (distance <= SEARCH_RADIUS_M) located.set(v.id, { venue: v, distance });
  }
  const nearestVenue = [...located.values()].sort((a, b) => a.distance - b.distance)[0] ?? null;

  const candidates: LiveCandidate[] = [];
  for (const event of events) {
    const where = located.get(event.venue_id);
    if (!where) continue;
    const status = liveStatus(event, now);
    if (!status) continue;
    const proximity = Math.exp(-Math.max(0, where.distance - certain) / 80);
    candidates.push({
      event,
      venue: where.venue,
      distance: where.distance,
      status,
      score: proximity * STATUS_WEIGHT[status] * CATEGORY_WEIGHT[event.category],
    });
  }
  candidates.splice(0, candidates.length, ...bestPerShow(candidates));
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);

  const [top, next] = candidates;
  // Two things on at once in the same building (main stage and studio) is a coin flip, so the list decides.
  const clear =
    !!top &&
    top.distance <= CONFIDENT_RADIUS_M &&
    (top.status === 'on-now' || top.status === 'starting-soon') &&
    top.score >= 0.45 &&
    (!next || next.score < top.score * 0.6 || next.event.title === top.event.title);
  return { candidates: candidates.slice(0, limit), confident: clear ? top : null, nearestVenue };
}

/** With no location to go on: what is on (or about to start) across London right now, soonest first. */
export function liveAnywhere(events: TimetableEvent[], venues: TimetableVenue[], now = new Date(), limit = 8): LiveCandidate[] {
  const byId = new Map(venues.map((v) => [v.id, v]));
  const out: LiveCandidate[] = [];
  for (const event of events) {
    const venue = byId.get(event.venue_id);
    const status = liveStatus(event, now);
    if (!venue || (status !== 'on-now' && status !== 'starting-soon') || CATEGORY_WEIGHT[event.category] < 0.8) continue;
    out.push({ event, venue, distance: NaN, status, score: STATUS_WEIGHT[status] * CATEGORY_WEIGHT[event.category] });
  }
  return bestPerShow(out)
    .sort((a, b) => b.score - a.score || a.event.start.localeCompare(b.event.start))
    .slice(0, limit);
}
