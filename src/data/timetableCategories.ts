import {
  Drama,
  Guitar,
  MicVocal,
  Music4,
  PersonStanding,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/** Mirrors scripts/timetable/categories.mjs — keep the ids in sync. */
export type TimetableCategory = 'opera' | 'classical' | 'live_music' | 'drama' | 'musical' | 'dance';

export interface CategoryMeta {
  id: TimetableCategory;
  label: string;
  /** One-line gloss shown in the legend. */
  blurb: string;
  icon: LucideIcon;
  /** CSS colour (theme-aware variable defined in index.css). */
  color: string;
}

export const TIMETABLE_CATEGORIES: CategoryMeta[] = [
  { id: 'opera', label: 'Opera', blurb: 'Staged and concert opera', icon: MicVocal, color: 'var(--cat-opera)' },
  { id: 'classical', label: 'Classical & orchestral', blurb: 'Orchestras, recitals, chamber, choral, early music', icon: Music4, color: 'var(--cat-classical)' },
  { id: 'live_music', label: 'Live music', blurb: 'Gigs: jazz, folk, pop, rock, singer-songwriters', icon: Guitar, color: 'var(--cat-live_music)' },
  { id: 'drama', label: 'Drama', blurb: 'Plays, new writing, Shakespeare', icon: Drama, color: 'var(--cat-drama)' },
  { id: 'musical', label: 'Musical theatre', blurb: 'West End and touring musicals', icon: Sparkles, color: 'var(--cat-musical)' },
  { id: 'dance', label: 'Dance & ballet', blurb: 'Ballet, contemporary and world dance', icon: PersonStanding, color: 'var(--cat-dance)' },
];

export const CATEGORY_BY_ID = Object.fromEntries(TIMETABLE_CATEGORIES.map((c) => [c.id, c])) as Record<
  TimetableCategory,
  CategoryMeta
>;

export interface TimetableVenue {
  id: string;
  name: string;
  kind: 'opera' | 'theatre' | 'concert';
  address?: string;
  lat?: number;
  lng?: number;
  site?: string;
}

export interface TimetableEvent {
  id: string;
  title: string;
  category: TimetableCategory;
  /** ISO 8601 with Europe/London offset, or YYYY-MM-DD when the time is unknown. */
  start: string;
  end?: string;
  time_known: boolean;
  venue_id: string;
  venue_name: string;
  hall?: string;
  url?: string;
  price?: string;
  blurb?: string;
  /** Poster image resolved from the event page (scripts/timetable/images.mjs). */
  image?: string;
  /** Discounted student ticket (Student Pulse London). */
  student?: boolean;
  /** Listing says no tickets are left; shown as a red "Sold out" tag over the image. */
  sold_out?: boolean;
  source: 'venue' | 'studentpulse' | 'luma' | 'eventbrite' | 'bandsintown' | 'ticketmaster' | 'seatgeek' | 'skiddle' | 'viagogo' | 'venue-pattern';
}

export interface TimetableData {
  generated_at: string;
  venues: TimetableVenue[];
  events: TimetableEvent[];
  sources: Record<string, { ok: boolean; count?: number; error?: string; at: string }>;
}

export type VenueKind = TimetableVenue['kind'];

export const VENUE_KINDS: { id: VenueKind; label: string; hint: string }[] = [
  { id: 'opera', label: 'Opera house', hint: 'ROH, ENO, Holland Park…' },
  { id: 'theatre', label: 'Theatre', hint: 'Playhouses, West End, fringe' },
  { id: 'concert', label: 'Concert & music venue', hint: 'Halls, churches, clubs, pop-ups' },
];
