import type { TimetableEvent } from '../data/timetableCategories';
import curated from '../data/venues.images.json';

export interface VenuePhoto {
  image: string;
  /** The Wikipedia / Commons page it comes from, for credit. */
  page: string;
  title: string;
}

/** Photos of every venue from Wikipedia / Wikimedia Commons, best first (scripts/timetable/venue-images.mjs). */
const PHOTOS = curated as Record<string, VenuePhoto[]>;

/** Every photo of a venue (by its Timetable listings' ids), up to `max`. */
export function venuePhotos(ttIds: string[] | undefined, max = 4): VenuePhoto[] {
  const out: VenuePhoto[] = [];
  for (const id of ttIds ?? []) for (const p of PHOTOS[id] ?? []) if (out.length < max && !out.some((o) => o.image === p.image)) out.push(p);
  return out;
}

/** Timetable venue id → its Wikimedia photo, else the poster of its soonest performance that has one (events arrive soonest first). */
export function venueImageIndex(events: TimetableEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, list] of Object.entries(PHOTOS)) if (list[0]) m.set(id, list[0].image);
  for (const e of events) if (e.image && !m.has(e.venue_id)) m.set(e.venue_id, e.image);
  return m;
}

/** A venue's picture: the first of its Timetable listings (`ttIds`) that has one. */
export function venueImage(ttIds: string[] | undefined, index: Map<string, string>): string | undefined {
  for (const id of ttIds ?? []) {
    const img = index.get(id);
    if (img) return img;
  }
  return undefined;
}
