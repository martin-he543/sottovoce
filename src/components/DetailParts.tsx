import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronLeft, LocateFixed, MapPin, Navigation, Route as RouteIcon, Ticket } from 'lucide-react';
import { CATEGORY_BY_ID, type TimetableEvent } from '../data/timetableCategories';
import { haversineDistanceMeters } from '../utils/sottovoceEngine';
import { eventDay, shortDate, timeLabel } from '../utils/timetableFormat';
import { BASEMAP_ATTRIBUTION, BASEMAP_CLASS, BASEMAP_MAX_ZOOM, BASEMAP_URL } from '../utils/mapTiles';
import { eventPath } from '../utils/urlState';
import { PlanJourneyButton } from './PlanJourneyButton';

/** Shared building blocks of the standalone event and venue pages. */

/** Where a page's map and directions point. */
export interface Place {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export const hasCoords = (p: Place): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null;

/** A small map with one pin, and a "from me" button that shows how far away it is. */
export const PlaceMap: React.FC<{ place: Place & { lat: number; lng: number }; color?: string; themeMode: 'light' | 'dark' }> = ({ place, color = 'var(--accent-crimson)', themeMode }) => {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const youRef = useRef<L.CircleMarker | null>(null);
  const [away, setAway] = useState<{ km: number } | { error: string } | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, { center: [place.lat, place.lng], zoom: 16, scrollWheelZoom: false });
    mapRef.current = map;
    L.marker([place.lat, place.lng], {
      title: place.name,
      icon: L.divIcon({
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #FAF6F0;box-shadow:0 1px 6px rgba(0,0,0,.45)"></div>`,
      }),
    }).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      youRef.current = null;
    };
  }, [place.lat, place.lng, place.name, color]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(BASEMAP_URL, { attribution: BASEMAP_ATTRIBUTION, maxZoom: BASEMAP_MAX_ZOOM, className: BASEMAP_CLASS }).addTo(map);
    tileRef.current.bringToBack();
  }, [themeMode, place.lat, place.lng, place.name, color]);

  const locate = () => {
    if (!navigator.geolocation) return setAway({ error: 'This device can’t share its location.' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const map = mapRef.current;
        const km = haversineDistanceMeters(coords.latitude, coords.longitude, place.lat, place.lng) / 1000;
        setAway({ km });
        if (!map) return;
        youRef.current?.remove();
        youRef.current = L.circleMarker([coords.latitude, coords.longitude], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563EB', fillOpacity: 1 }).addTo(map);
        map.fitBounds(L.latLngBounds([[coords.latitude, coords.longitude], [place.lat, place.lng]]).pad(0.3), { maxZoom: 16 });
      },
      () => setAway({ error: 'Location permission was denied.' }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div>
      <div ref={elRef} className="place-map h-64 sm:h-72 w-full overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-hairline)' }} role="region" aria-label={`Map of ${place.name}`} />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
        <button type="button" onClick={locate} className="inline-flex cursor-pointer items-center gap-1 underline underline-offset-2">
          <LocateFixed className="h-3.5 w-3.5" aria-hidden /> How far am I?
        </button>
        {away && ('km' in away ? <span>{away.km < 10 ? away.km.toFixed(1) : Math.round(away.km)} km in a straight line</span> : <span>{away.error}</span>)}
      </div>
    </div>
  );
};

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

const outLink =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:opacity-85';

/** Ways to get there: the in-app Journey Planner, and the usual map apps. */
export const DirectionsLinks: React.FC<{
  place: Place & { lat: number; lng: number };
  onPlan?: (fromHere: boolean) => void;
}> = ({ place, onPlan }) => {
  const at = `${place.lat},${place.lng}`;
  const style = { borderColor: 'var(--border-hairline)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onPlan && <PlanJourneyButton label="Plan in Journey Planner" title="Tube, rail and bus routes here" onPlan={onPlan} />}
      <a className={outLink} style={style} target="_blank" rel="noreferrer noopener" href={`https://www.google.com/maps/dir/?${q({ api: '1', destination: at, travelmode: 'transit' })}`}>
        <Navigation className="h-4 w-4" aria-hidden /> Google Maps
      </a>
      <a className={outLink} style={style} target="_blank" rel="noreferrer noopener" href={`https://citymapper.com/directions?${q({ endcoord: at, endname: place.name })}`}>
        <RouteIcon className="h-4 w-4" aria-hidden /> Citymapper
      </a>
      <a className={outLink} style={style} target="_blank" rel="noreferrer noopener" href={`https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lng}`}>
        <MapPin className="h-4 w-4" aria-hidden /> OpenStreetMap
      </a>
    </div>
  );
};

/** One performance as a row that links to its page (the whole row is the link; the title is its accessible name). */
export const EventListRow: React.FC<{ e: TimetableEvent; showVenue?: boolean; showDate?: boolean }> = ({ e, showVenue, showDate = true }) => {
  const meta = CATEGORY_BY_ID[e.category];
  const Icon = meta.icon;
  return (
    <li
      className="relative flex items-center gap-3 rounded-lg border p-2.5 hover:opacity-90"
      style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', borderLeft: `4px solid ${meta.color}` }}
    >
      <div className="w-[88px] shrink-0 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
        {showDate && <span className="block font-semibold">{shortDate(e)}</span>}
        <span className={showDate ? '' : 'font-semibold'} style={showDate ? { color: 'var(--text-secondary)' } : undefined}>{timeLabel(e)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <a
          href={eventPath(e.id)}
          data-route
          className="text-[15px] font-semibold leading-snug after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {e.title}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {showVenue && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden />
              {e.venue_name}
            </span>
          )}
          {e.hall && <span>{e.hall}</span>}
          {e.student && <span className="rounded-full px-1.5 py-px text-[10px] font-mono font-semibold uppercase text-white" style={{ backgroundColor: '#5B3FD0' }}>Student</span>}
          {e.sold_out && <span className="rounded-full px-1.5 py-px text-[10px] font-mono font-semibold uppercase text-white" style={{ backgroundColor: '#D4161C' }}>Sold out</span>}
          {e.price && (
            <span className="inline-flex items-center gap-1">
              <Ticket className="h-3 w-3" aria-hidden />
              {e.price}
            </span>
          )}
        </div>
      </div>
      <span className="hidden items-center gap-1 text-[11px] font-mono font-semibold sm:inline-flex" style={{ color: meta.color }}>
        <Icon className="h-3 w-3" aria-hidden />
        {meta.label}
      </span>
    </li>
  );
};

/** Upcoming first, soonest first. */
export const upcoming = (events: TimetableEvent[], today: string) =>
  events.filter((e) => eventDay(e) >= today).sort((a, b) => a.start.localeCompare(b.start));

export const BackLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} data-route className="inline-flex items-center gap-1 text-xs font-mono underline-offset-2 hover:underline" style={{ color: 'var(--text-secondary)' }}>
    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
    {children}
  </a>
);

export const SectionHeading: React.FC<{ children: React.ReactNode; count?: number }> = ({ children, count }) => (
  <h2 className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-crimson)' }}>
    {children}
    {count != null && <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{count}</span>}
  </h2>
);

/** Page title for the browser tab and shared links, restored when the page closes. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · sottovoce`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
