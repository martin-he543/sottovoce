import React, { useMemo, useState } from 'react';
import type { CivicNode } from '../types/sottovoce';
import { CountBadge, useMapVenues, useVenueEvents, KIND_META } from './TubeMapEmbed';
import { MapPin } from 'lucide-react';
import type { TimetableData } from '../data/timetableCategories';
import { venuePath } from '../utils/urlState';
import { venueImage, venueImageIndex } from '../utils/venueImage';
import { VenueThumb } from './TimetableView';

interface VenueIndexProps {
  civicNodes: CivicNode[];
  timetable: TimetableData;
  /** Show this venue (a map venue id) on the Timetable map. */
  onPick: (mapVenueId: string) => void;
}

/** Every opera house, theatre and venue on the map, busiest first, searchable; each links to its venue page, with a button to fly the map to its pin. */
const LIST_PREVIEW = 60;

export const VenueIndex: React.FC<VenueIndexProps> = ({ civicNodes, timetable, onPick }) => {
  const venues = useMapVenues(civicNodes, timetable.venues);
  const venueEvents = useVenueEvents(venues, timetable);
  const images = useMemo(() => venueImageIndex(timetable.events), [timetable.events]);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const listed = useMemo(
    () =>
      venues
        .filter((v) => !q || `${v.name} ${v.address ?? ''} ${KIND_META[v.kind].label}`.toLowerCase().includes(q))
        // Venues with something coming up first, busiest at the top.
        .sort((a, b) => (venueEvents.get(b.id)?.length ?? 0) - (venueEvents.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name)),
    [venues, venueEvents, q]
  );
  const rows = showAll || q ? listed : listed.slice(0, LIST_PREVIEW);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${venues.length} venues…`}
        aria-label="Search venues"
        className="w-full mb-3 rounded-lg border px-3 py-2 text-sm"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
      />
      <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {rows.map((v) => (
          <li
            key={v.id}
            className="relative rounded-lg border px-3.5 py-2.5 hover:opacity-85 transition-opacity flex items-center gap-3"
            style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
          >
            <VenueThumb kind={v.kind} image={venueImage(v.ttIds, images)} className="w-[52px] h-[52px]" />
            <CountBadge events={venueEvents.get(v.id) ?? []} size={38} />
            <span className="min-w-0 flex-1">
              <a
                href={venuePath(v.id)}
                data-route
                className="block text-sm font-semibold hover:underline underline-offset-2 after:absolute after:inset-0 after:content-['']"
                style={{ color: 'var(--text-primary)' }}
              >
                {v.name}
              </a>
              <span className="block text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {KIND_META[v.kind].label}
                {v.address ? ` · ${v.address}` : ''}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onPick(v.id)}
              data-href={`/discover/journey?jpvenue=${encodeURIComponent(v.id)}`}
              aria-label={`Show ${v.name} on the map`}
              title="Show on the map"
              className="relative z-10 shrink-0 cursor-pointer rounded-md p-1.5"
              style={{ color: 'var(--accent-crimson)' }}
            >
              <MapPin className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {!q && listed.length > LIST_PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-3 text-xs font-mono underline underline-offset-2 cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          {showAll ? 'Show fewer' : `Show all ${listed.length} venues`}
        </button>
      )}
      {q && listed.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No venues match “{query}”.</p>
      )}
    </div>
  );
};
