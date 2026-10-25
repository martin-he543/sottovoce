export type EventSourceId =
  | 'venue'
  | 'bandsintown'
  | 'ticketmaster'
  | 'viagogo'
  | 'seatgeek'
  | 'skiddle'
  | 'olt'
  | 'eventbrite'
  | 'luma'
  | 'lastfm'
  | 'studentpulse';

export const SOURCE_META: Record<EventSourceId, { label: string; color: string }> = {
  venue: { label: 'Venue', color: '#6B5B4B' },
  olt: { label: 'Official London Theatre', color: '#B3122D' },
  bandsintown: { label: 'Bandsintown', color: '#00A5A0' },
  ticketmaster: { label: 'Ticketmaster', color: '#026CDF' },
  viagogo: { label: 'Viagogo', color: '#5C9A1E' },
  seatgeek: { label: 'SeatGeek', color: '#1B2A41' },
  skiddle: { label: 'Skiddle', color: '#E6007E' },
  eventbrite: { label: 'Eventbrite', color: '#F05537' },
  luma: { label: 'Luma', color: '#1F1F1F' },
  lastfm: { label: 'Last.fm', color: '#D51007' },
  studentpulse: { label: 'Student Pulse', color: '#5B3FD0' },
};

const HOSTS: [RegExp, EventSourceId][] = [
  [/(^|\.)bandsintown\.com$/, 'bandsintown'],
  [/(^|\.)ticketmaster\.[a-z.]+$/, 'ticketmaster'],
  [/(^|\.)officiallondontheatre\.com$/, 'olt'],
  [/(^|\.)seatgeek\.com$/, 'seatgeek'],
  [/(^|\.)skiddle\.com$/, 'skiddle'],
  [/(^|\.)viagogo\.[a-z.]+$/, 'viagogo'],
  [/(^|\.)eventbrite\.[a-z.]+$/, 'eventbrite'],
  [/(^|\.)(lu\.ma|luma\.com)$/, 'luma'],
  [/(^|\.)last\.fm$/, 'lastfm'],
  [/(^|\.)studentpulselondon\.co\.uk$/, 'studentpulse'],
];

/** Work out which ticketing/listing platform an event came from, by link first, then by label. */
export function detectSource(url?: string, hint?: string): EventSourceId {
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      for (const [re, id] of HOSTS) if (re.test(host)) return id;
    } catch {
      /* not a URL */
    }
  }
  const h = (hint ?? '').toLowerCase();
  for (const id of Object.keys(SOURCE_META) as EventSourceId[]) {
    if (id !== 'venue' && id !== 'olt' && h.includes(id === 'lastfm' ? 'last.fm' : id)) return id;
  }
  return 'venue';
}
