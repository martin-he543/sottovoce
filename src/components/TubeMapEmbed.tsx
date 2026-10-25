import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Bike, CarTaxiFront, CircleParking, CloudSun, Droplets, Landmark, RefreshCw, TrainFront, Waves } from 'lucide-react';
import type { CivicNode, LiveEvent, OpenLondonLiveTelemetry, WorkAndLibretto } from '../types/sottovoce';
import { haversineDistanceMeters } from '../utils/sottovoceEngine';
import { londonStamp, searchPlaces } from '../utils/mapSearch';
import { venueImage, venueImageIndex } from '../utils/venueImage';
import { formatLocation, parseLocation, readParams, routeLinkClicks, setParams } from '../utils/urlState';
import { SvgIcon, svgIconHtml } from '../utils/svgIcons';
import {
  CATEGORY_BY_ID,
  TIMETABLE_CATEGORIES,
  type TimetableCategory,
  type TimetableData,
  type TimetableEvent,
  type TimetableVenue,
} from '../data/timetableCategories';
import { dayKey, eventDay } from '../utils/timetableFormat';
import { catCounts, donut, esc as escHtml, popupHtml, sizeFor, tooltipHtml } from '../utils/timetableMapHtml';
import timetableMapCss from '../timetableMap.css?inline';

/**
 * Embeds the Journey Planner (served verbatim from public/tube/)
 * and layers sottovoce's opera / theatre / concert venues on top of its Leaflet map as big
 * icons. The tube page is untouched: it runs in a same-origin iframe (its stylesheet and
 * 11k-line script are written against document-level globals, so an iframe is what keeps
 * both apps' CSS and ids from colliding) and this component reaches in after load to
 *   - sync the theme with the app,
 *   - neutralise chrome that doesn't make sense embedded (the logo's href="/"),
 *   - add a marker for every venue on the Timetable (plus the app's own venues and civic locations) via the page's
 *     own Leaflet instance, drawn as the Timetable map's donut with the upcoming-performance count in the middle and
 *     only shown once zoomed right in,
 *   - give the page window.svPlaces so its station search and journey planner also find
 *     venues, operas and shows (a show's date sets the planner's "arrive by"),
 *   - mirror the view into the address bar while the planner is open
 *     (?jploc=lat,lng&jpzoom=&jpvenue=&station=&jpvenues=0&jpamenities=0 — prefixed so they don't clash with the
 *     Timetable map's own ?location=&zoom=) and restore it on load.
 */

export type MapVenueKind = 'opera' | 'theatre' | 'concert';

export interface MapVenue {
  id: string;
  name: string;
  kind: MapVenueKind;
  lat: number;
  lng: number;
  address?: string;
  /** Icon id (see utils/svgIconData) unique to this venue; falls back to the category glyph. */
  icon?: string;
  /** True for venues that come from the app's civic_nodes (they can have events and libretti). */
  fromApp?: boolean;
  /** Ids of the Timetable venues at this spot (several listings can share one building). */
  ttIds?: string[];
  site?: string;
}

/** Venue and location pins only appear from this zoom, when there's room for the icon and its label. */
export const VENUE_MIN_ZOOM = 15;
/** Zoom used when flying to a venue. */
const VENUE_FLY_ZOOM = 16;

/** Well-known London venues, so the map isn't limited to the three seeded in civic_nodes. */
export const EXTRA_LONDON_VENUES: MapVenue[] = [
  { id: 'x_albert_hall', name: 'Royal Albert Hall', kind: 'concert', lat: 51.501, lng: -0.1774, address: 'Kensington Gore, SW7', icon: 'landmark' },
  { id: 'x_barbican', name: 'Barbican Centre', kind: 'concert', lat: 51.52, lng: -0.0936, address: 'Silk Street, EC2Y', icon: 'building-2' },
  { id: 'x_sadlers', name: "Sadler's Wells", kind: 'theatre', lat: 51.5294, lng: -0.1058, address: 'Rosebery Avenue, EC1R', icon: 'person-standing' },
  { id: 'x_rfh', name: 'Southbank Centre · Royal Festival Hall', kind: 'concert', lat: 51.5055, lng: -0.1166, address: 'Belvedere Road, SE1', icon: 'music-4' },
  { id: 'x_nt', name: 'National Theatre', kind: 'theatre', lat: 51.5072, lng: -0.1148, address: 'Upper Ground, SE1', icon: 'drama' },
  { id: 'x_wigmore', name: 'Wigmore Hall', kind: 'concert', lat: 51.5176, lng: -0.1493, address: 'Wigmore Street, W1U', icon: 'piano' },
  { id: 'x_palace', name: 'Palace Theatre', kind: 'theatre', lat: 51.5133, lng: -0.1308, address: 'Shaftesbury Avenue, W1D', icon: 'hat-glasses' },
  { id: 'x_hmt', name: "His Majesty's Theatre", kind: 'theatre', lat: 51.5088, lng: -0.1318, address: 'Haymarket, SW1Y', icon: 'ghost' },
  { id: 'x_globe', name: "Shakespeare's Globe", kind: 'theatre', lat: 51.5081, lng: -0.0972, address: 'New Globe Walk, SE1', icon: 'globe' },
  { id: 'x_vpt', name: 'Victoria Palace Theatre', kind: 'theatre', lat: 51.4966, lng: -0.1427, address: 'Victoria Street, SW1E', icon: 'star' },
  { id: 'x_ohp', name: 'Opera Holland Park', kind: 'opera', lat: 51.503, lng: -0.203, address: 'Holland Park, W8', icon: 'tree-pine' },
  { id: 'x_cadogan', name: 'Cadogan Hall', kind: 'concert', lat: 51.4924, lng: -0.1583, address: 'Sloane Terrace, SW1X', icon: 'megaphone' },
  { id: 'x_hackney', name: 'Hackney Empire', kind: 'theatre', lat: 51.5457, lng: -0.0553, address: 'Mare Street, E8', icon: 'spade' },
  { id: 'x_o2', name: 'The O2', kind: 'concert', lat: 51.503, lng: 0.0032, address: 'Peninsula Square, SE10', icon: 'guitar' },
];

/** `color` is the category colour: the disc border and ring on the map, the list and the popup. */
export const KIND_META: Record<MapVenueKind, { glyph: string; label: string; color: string }> = {
  opera: { glyph: 'mic-vocal', label: 'Opera house', color: '#E5384F' },
  theatre: { glyph: 'drama', label: 'Theatre', color: '#F2B531' },
  concert: { glyph: 'music-4', label: 'Concert hall', color: '#3FA7E0' },
};

/** Unique icons for the venues seeded in civic_nodes (the extras carry theirs inline). */
const APP_VENUE_ICONS: Record<string, string> = {
  node_venue_roh: 'crown',
  node_venue_sondheim: 'mic',
  node_venue_coliseum: 'landmark',
};

export const venueGlyph = (v: Pick<MapVenue, 'kind' | 'icon'>) => v.icon ?? KIND_META[v.kind].glyph;

/** The map pin as a React element (the Timetable donut with the count in the middle), so lists match the map. */
export const CountBadge: React.FC<{ events: TimetableEvent[]; size?: number }> = ({ events, size = 36 }) => (
  <span
    className="shrink-0 inline-block leading-none"
    style={{ width: size, height: size }}
    role="img"
    aria-label={`${events.length} upcoming performances`}
    dangerouslySetInnerHTML={{ __html: donut(catCounts(events), events.length, size) }}
  />
);

const kindFromNode = (n: CivicNode): MapVenueKind =>
  /opera|coliseum/i.test(n.name) ? 'opera' : 'theatre';

const esc = escHtml;

/** Civic locations other than venues, drawn as small icons: [icon id, label]. */
export const LOCATION_META: Record<string, [string, string]> = {
  water_fountain: ['droplet', 'Drinking fountain'],
  public_toilet: ['toilet', 'Public toilet'],
  air_weather_station: ['cloud-sun', 'Air & weather station'],
  thames_flood_gauge: ['waves', 'Thames flood gauge'],
  wildlife_sanctuary: ['leaf', 'Wildlife sanctuary'],
};

/** A TfL Unified API `/Place/Type/{type}` entity, trimmed to what the map layers use. */
export interface TflPlace {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  additionalProperties?: { key: string; value: string }[];
}

/** TfL Unified API place layers, off by default: toggled on from the tray, fetched lazily on first use. */
export type TflLayerType = 'BikePoint' | 'CarPark' | 'TaxiRank';
export const TFL_LAYERS: { type: TflLayerType; icon: string; label: string; statKeys: RegExp }[] = [
  { type: 'BikePoint', icon: 'bike', label: 'Santander Cycles docking stations', statKeys: /^Nb(Bikes|EmptyDocks|Docks|StandardBikes|EBikes)$/ },
  { type: 'CarPark', icon: 'circle-parking', label: 'Car parks', statKeys: /Capacity|Spaces|Bay/i },
  { type: 'TaxiRank', icon: 'car-taxi-front', label: 'Taxi ranks', statKeys: /Spaces|NumberOfSpaces/i },
];

/** Where the weather layer's Open-Meteo reading is sampled (Covent Garden — matches the server's default). */
export const WEATHER_SAMPLE_POINT: [number, number] = [51.5129, -0.1222];

/** Styles injected into the tube page for the sottovoce layers. */
const ADAPTER_CSS = `
.sv-venue,.sv-amenity{background:none!important;border:0!important;display:none}
.sv-zoomed .sv-venue,.sv-zoomed .sv-amenity{display:block}
.sv-venue .sv-pin{position:absolute;left:0;top:0;transform:translate(-50%,-50%);cursor:pointer}
.sv-venue .sv-name{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:3px;padding:2px 7px;border-radius:6px;
  font:600 11px/1.25 'Overpass',system-ui,sans-serif;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis;
  color:var(--text-primary);background:color-mix(in srgb,var(--bg-surface) 92%,transparent);border:1px solid var(--border-hairline);
  box-shadow:0 1px 4px rgba(0,0,0,.25)}
.sv-venue .sv-pin:hover .sv-name{max-width:none}
.sv-venue:hover{z-index:9999!important}
.sv-venue.sv-none .tm-pin{opacity:.85}
.sv-amenity .sv-dot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#8fd0f2;background:#15121A;border:2px solid #4aa3d6;
  transform:translate(-50%,-50%);box-shadow:0 2px 6px rgba(0,0,0,.5)}
.sv-more{margin-top:6px}
.sv-live{margin:6px 0 0;padding:5px 8px;border-radius:8px;background:var(--bg-subtle);font-size:11.5px}
.sv-live b{display:block;font-weight:600}
.sv-live span{color:var(--text-secondary)}
.tm-popup .leaflet-popup-content{font-family:'Overpass',system-ui,sans-serif}
${timetableMapCss}
`;

/** Theme variables the Timetable styles use, copied from the app into the tube page whenever the theme changes. */
const THEME_VARS = [
  '--bg-surface', '--bg-subtle', '--text-primary', '--text-secondary', '--text-muted',
  '--border-hairline', '--border-strong', '--accent-crimson',
  ...TIMETABLE_CATEGORIES.map((c) => `--cat-${c.id}`),
];

/** The map view encoded in the URL, read once when the map mounts. */
interface MapUrlState {
  location: { lat: number; lng: number } | null;
  zoom: number | null;
  venue: string | null;
  station: string | null;
  venues: boolean;
  amenities: boolean;
}

const readMapUrl = (): MapUrlState => {
  const p = readParams();
  const zoom = Number(p.get('jpzoom'));
  return {
    location: parseLocation(p.get('jploc')),
    zoom: p.get('jpzoom') && Number.isFinite(zoom) && zoom > 0 ? zoom : null,
    venue: p.get('jpvenue'),
    station: p.get('station'),
    venues: p.get('jpvenues') !== '0',
    amenities: p.get('jpamenities') !== '0',
  };
};

interface TubeMapEmbedProps {
  civicNodes: CivicNode[];
  liveEvents: LiveEvent[];
  works: WorkAndLibretto[];
  activeVenueId?: string;
  themeMode: 'light' | 'dark';
  /** True while the map page is the one on screen; only then does the map write to the address bar. */
  active?: boolean;
  /**
   * Fly to this venue (a MapVenue.id or a Timetable venue id) and open its popup. With `plan`, open the journey planner
   * to it instead: to one performance (arriving before curtain up) when `eventId` is given, from the device's location
   * when `fromHere`. Change the object to re-trigger.
   */
  focus?: { id: string; nonce: number; plan?: { eventId?: string; fromHere: boolean } } | null;
  /** The Timetable's venues and performances: every venue gets a pin counting its upcoming shows. */
  timetable: TimetableData;
  /** Open-Meteo weather reading, for the (off-by-default) weather layer. */
  openLondonTelemetry?: OpenLondonLiveTelemetry;
  /** Re-fetches openLondonTelemetry (weather + TfL line status) — for the layer tray's refresh button. */
  onRefreshOpenLondonTelemetry?: () => void;
  refreshingOpenLondonTelemetry?: boolean;
  /** Show the live-conditions tiles above the map (off where the page already shows them). */
  showTelemetry?: boolean;
  onOpenWork?: (workId: string) => void;
  /** Open a Timetable venue (by Timetable venue id) in the Timetable page. */
  onOpenTimetable?: (venueId: string) => void;
  className?: string;
}

/** Venues within this distance of each other are the same place (a Timetable listing is matched to the known venue). */
const SAME_PLACE_M = 120;

/**
 * Every venue on the map: the app's own, the well-known extras, and every venue on the Timetable that has coordinates.
 * A Timetable venue that sits on a known venue is attached to it (`ttIds`) rather than pinned twice.
 */
export function useMapVenues(civicNodes: CivicNode[], timetableVenues: TimetableVenue[] = []): MapVenue[] {
  return useMemo(() => {
    const fromApp: MapVenue[] = civicNodes
      .filter((n) => n.category === 'theatre_venue')
      .map((n) => ({
        id: n.node_id,
        name: n.name.replace(/\s*\(.*\)\s*$/, ''),
        kind: kindFromNode(n),
        lat: n.location.coordinates[1],
        lng: n.location.coordinates[0],
        address: n.address,
        icon: APP_VENUE_ICONS[n.node_id],
        fromApp: true,
      }));
    // Don't double up a venue the app already knows about.
    const extras = EXTRA_LONDON_VENUES.filter(
      (x) => !fromApp.some((a) => haversineDistanceMeters(a.lat, a.lng, x.lat, x.lng) < 150)
    );
    const all: MapVenue[] = [...fromApp, ...extras];
    const known = all.length;
    for (const t of timetableVenues) {
      if (t.lat == null || t.lng == null) continue;
      // Prefer the known venue with the same name, then whichever is nearest.
      let host: MapVenue | undefined;
      let best = SAME_PLACE_M;
      for (let i = 0; i < all.length; i++) {
        const v = all[i];
        const d = haversineDistanceMeters(v.lat, v.lng, t.lat, t.lng);
        const sameName = i < known && v.name.toLowerCase().slice(0, 10) === t.name.toLowerCase().slice(0, 10);
        if (sameName ? d < 400 : d < best) {
          host = v;
          best = sameName ? 0 : d;
        }
      }
      if (host) {
        (host.ttIds ??= []).push(t.id);
        host.site ??= t.site;
      } else {
        all.push({ id: `tt_${t.id}`, name: t.name, kind: t.kind, lat: t.lat, lng: t.lng, address: t.address, site: t.site, ttIds: [t.id] });
      }
    }
    return all;
  }, [civicNodes, timetableVenues]);
}

/** Upcoming Timetable performances per map venue (id → events, soonest first). */
export function useVenueEvents(venues: MapVenue[], timetable: TimetableData, cats?: Set<TimetableCategory>) {
  return useMemo(() => {
    const today = dayKey(new Date());
    const byTt = new Map<string, TimetableEvent[]>();
    for (const e of timetable.events) {
      if (eventDay(e) < today || (cats?.size && !cats.has(e.category))) continue;
      (byTt.get(e.venue_id) ?? byTt.set(e.venue_id, []).get(e.venue_id)!).push(e);
    }
    const out = new Map<string, TimetableEvent[]>();
    for (const v of venues) {
      const evs = (v.ttIds ?? []).flatMap((id) => byTt.get(id) ?? []);
      evs.sort((a, b) => a.start.localeCompare(b.start));
      out.set(v.id, evs);
    }
    return out;
  }, [venues, timetable, cats]);
}

/** TfL place layers, each fetched lazily the first time it's switched on (an empty list if the fetch fails). */
export function useTflPlaces(layersOn: Partial<Record<TflLayerType, boolean>>): Record<string, TflPlace[]> {
  const [tflPlaces, setTflPlaces] = useState<Record<string, TflPlace[]>>({});
  useEffect(() => {
    const missing = TFL_LAYERS.map((l) => l.type).filter((t) => layersOn[t] && !(t in tflPlaces));
    if (!missing.length) return;
    let cancelled = false;
    fetch(`/api/tfl/places?types=${missing.join(',')}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTflPlaces((prev) => ({ ...prev, ...(data?.places_by_type ?? {}) }));
      })
      .catch(() => {
        if (cancelled) return;
        setTflPlaces((prev) => ({ ...prev, ...Object.fromEntries(missing.map((t) => [t, []])) }));
      });
    return () => {
      cancelled = true;
    };
  }, [layersOn, tflPlaces]);

  return tflPlaces;
}

/** Live London conditions (weather, air quality, flood risk, Met Office warnings, tube & rail status) as a row of tiles. */
export const LondonTelemetryStrip: React.FC<{ telemetry: OpenLondonLiveTelemetry; className?: string }> = ({ telemetry, className = '' }) => {
  const worstWarningSeverity = (
    telemetry?.weather_warnings?.warnings ?? []
  ).reduce<string | null>((worst, w) => {
    const rank: Record<string, number> = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
    if (!worst) return w.severity;
    return (rank[w.severity] ?? 0) > (rank[worst] ?? 0) ? w.severity : worst;
  }, null);
  const warningColor =
    worstWarningSeverity === 'Extreme' || worstWarningSeverity === 'Severe'
      ? '#F87171'
      : worstWarningSeverity === 'Moderate'
        ? '#FBBF24'
        : worstWarningSeverity === 'Minor'
          ? '#FDE68A'
          : 'var(--text-secondary)';
  const disrupted = telemetry?.rail_disruptions;
  const floodWarningsActive = !/0 Active/i.test(telemetry?.flood_monitoring?.tidal_status ?? '0 Active');

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-5 gap-2 ${className}`}>
      <div
        className="rounded-lg border px-3 py-2"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Weather</span>
          <CloudSun className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </div>
        <div className="text-sm font-semibold font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-primary)' }}>
          {telemetry.weather.temperature_c.toFixed(1)}°C
        </div>
      </div>

      <div
        className="rounded-lg border px-3 py-2"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Air quality</span>
          <span className="font-mono tabular-nums" style={{ color: '#6EE7B7' }}>
            AQI {telemetry.air_quality.european_aqi}
          </span>
        </div>
        <div className="text-sm font-semibold font-mono tabular-nums mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
          PM2.5 {telemetry.air_quality.pm2_5.toFixed(1)}
        </div>
      </div>

      <div
        className="rounded-lg border px-3 py-2"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
        title={telemetry.flood_monitoring.tidal_status}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Flood risk</span>
          <Waves className="w-3.5 h-3.5" style={{ color: floodWarningsActive ? '#38BDF8' : 'var(--text-secondary)' }} />
        </div>
        <div className="text-sm font-semibold mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
          {floodWarningsActive ? 'Flood alert' : 'Normal'}
        </div>
      </div>

      <div
        className="rounded-lg border px-3 py-2"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
        title={
          telemetry.weather_warnings?.warnings
            .map((w) => `${w.severity} ${w.event} — ${w.area}`)
            .join('\n') || 'No active Met Office warnings'
        }
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Met Office</span>
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: warningColor }} />
        </div>
        <div className="text-sm font-semibold mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
          {telemetry.weather_warnings?.warnings.length
            ? `${telemetry.weather_warnings.warnings.length} warning${telemetry.weather_warnings.warnings.length > 1 ? 's' : ''}`
            : 'No warnings'}
        </div>
      </div>

      <div
        className="rounded-lg border px-3 py-2"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
        title={disrupted?.lines.map((l) => `${l.line_name}: ${l.status_severity}${l.reason ? ' — ' + l.reason : ''}`).join('\n') || 'All lines reporting good service'}
      >
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Tube &amp; rail</span>
          <TrainFront className="w-3.5 h-3.5" style={{ color: disrupted && disrupted.disrupted_count > 0 ? '#F87171' : 'var(--text-secondary)' }} />
        </div>
        <div className="text-sm font-semibold mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
          {disrupted && disrupted.disrupted_count > 0
            ? `${disrupted.disrupted_count} line${disrupted.disrupted_count > 1 ? 's' : ''} disrupted`
            : 'Good service'}
        </div>
      </div>
    </div>
  );
};

export const TubeMapEmbed: React.FC<TubeMapEmbedProps> = ({
  civicNodes,
  liveEvents,
  works,
  activeVenueId,
  themeMode,
  active = true,
  focus,
  timetable,
  openLondonTelemetry,
  onRefreshOpenLondonTelemetry,
  refreshingOpenLondonTelemetry,
  showTelemetry = true,
  onOpenWork,
  onOpenTimetable,
  className = '',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const layerRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [mapWin, setMapWin] = useState<any>(null); // the iframe's window once its Leaflet map exists
  const initialRef = useRef<MapUrlState | null>(null);
  if (!initialRef.current) initialRef.current = readMapUrl();
  const initial = initialRef.current;
  // The tube page opens a station from its own #hash, so hand it ours (it reads the hash once, at load).
  const [iframeSrc] = useState(() =>
    initial.station ? `/tube/index.html#${encodeURIComponent(initial.station)}` : '/tube/index.html'
  );
  const [showVenues, setShowVenues] = useState(initial.venues);
  const [showAmenities, setShowAmenities] = useState(initial.amenities);
  const [cats, setCats] = useState<Set<TimetableCategory>>(() => new Set());
  // TfL Unified API place layers (bike points / car parks / taxi ranks) and the weather layer: all off by default.
  const [tflLayersOn, setTflLayersOn] = useState<Record<string, boolean>>({});
  const [showWeather, setShowWeather] = useState(false);
  const tflPlaces = useTflPlaces(tflLayersOn);
  const [zoom, setZoom] = useState<number | null>(null);
  const openVenueRef = useRef<string | null>(initial.venue); // venue whose popup is open
  const rebuildingRef = useRef(false); // true while the marker layer is torn down, so popupclose isn't a user action
  const urlReadyRef = useRef(false); // false until the URL's view has been applied to the map
  const venueRestoredRef = useRef(false); // the first marker build centres on ?venue= when there's no ?location=
  const mapWinRef = useRef<any>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Mirror the map into the address bar (replaceState: panning shouldn't flood the back button).
  const writeUrlRef = useRef(() => {});
  writeUrlRef.current = () => {
    const win = mapWinRef.current;
    const map = win && getMap(win);
    if (!map || !activeRef.current || !urlReadyRef.current) return;
    const c = map.getCenter();
    let station: string | null = null;
    try {
      station = decodeURIComponent(win.location.hash.slice(1)) || null;
    } catch {
      /* malformed hash */
    }
    setParams({
      jploc: formatLocation(c.lat, c.lng),
      jpzoom: String(+map.getZoom().toFixed(2)),
      station,
      jpvenue: showVenues ? openVenueRef.current : null,
      jpvenues: showVenues ? null : '0',
      jpamenities: showAmenities ? null : '0',
    });
  };

  const venues = useMapVenues(civicNodes, timetable.venues);
  const venueEvents = useVenueEvents(venues, timetable, cats);
  const timetableRef = useRef(timetable);
  timetableRef.current = timetable;
  const vImages = useMemo(() => venueImageIndex(timetable.events), [timetable.events]);

  // Keep the latest callback without rebuilding markers every render.
  const onOpenWorkRef = useRef(onOpenWork);
  onOpenWorkRef.current = onOpenWork;
  const onOpenTimetableRef = useRef(onOpenTimetable);
  onOpenTimetableRef.current = onOpenTimetable;

  // The tube script is an IIFE, so its Leaflet map isn't a global. Leaflet re-validates its
  // size on every window resize, so borrow the instance from that call (and put the method back).
  const captureMap = (win: any): Promise<any> =>
    new Promise((resolve) => {
      if (win.__svMap) return resolve(win.__svMap);
      const proto = win.L?.Map?.prototype;
      if (!proto) return resolve(null);
      const original = proto.invalidateSize;
      proto.invalidateSize = function (this: any, ...args: any[]) {
        win.__svMap = this;
        return original.apply(this, args);
      };
      win.dispatchEvent(new win.Event('resize'));
      let waited = 0;
      const poll = window.setInterval(() => {
        waited += 50;
        if (win.__svMap || waited >= 2000) {
          window.clearInterval(poll);
          proto.invalidateSize = original;
          resolve(win.__svMap || null);
        }
      }, 50);
    });
  const getMap = (win: any) => win.__svMap || null;

  // Attach to the tube page once its script has built the Leaflet map.
  const handleLoad = useCallback(() => {
    const win: any = iframeRef.current?.contentWindow;
    if (!win) return;
    let tries = 0;
    const attach = async () => {
      let map: any = null;
      try {
        // #train-count is part of the page's markup, but the script wiring the map runs after Leaflet loads.
        if (win.L?.Map && win.document.getElementById('train-count')) map = await captureMap(win);
      } catch {
        /* not ready */
      }
      if (!map) {
        if (tries++ < 60) window.setTimeout(attach, 150);
        return;
      }
      const doc: Document = win.document;
      if (!doc.getElementById('sv-adapter-css')) {
        const style = doc.createElement('style');
        style.id = 'sv-adapter-css';
        style.textContent = ADAPTER_CSS;
        doc.head.appendChild(style);
      }
      // The logo links to "/" — inside the embed that would load the whole app in the frame.
      const logo = doc.querySelector('a.logo');
      if (logo) {
        logo.removeAttribute('href');
        (logo as HTMLElement).style.cursor = 'default';
      }
      // Start with the layer tray folded away so the map (and our venue icons) get the room.
      const tray = doc.getElementById('line-filter');
      if (tray && !tray.classList.contains('collapsed')) doc.getElementById('lf-seg-toggle')?.click();
      if (!map.getPane('sottovoce-venues')) {
        map.createPane('sottovoce-venues').style.zIndex = '640';
      }
      if (!map.getPane('sottovoce-tfl')) {
        map.createPane('sottovoce-tfl').style.zIndex = '645';
      }
      // Popup links to event / venue pages open in the app, not inside this frame.
      routeLinkClicks(doc);
      // Popup buttons: Leaflet stops click bubbling inside popups, so listen in the capture phase.
      doc.addEventListener(
        'click',
        (ev) => {
          const target = ev.target as Element | null;
          const work = target?.closest?.('.tm-popup button[data-work]') as HTMLElement | null;
          if (work?.dataset.work) onOpenWorkRef.current?.(work.dataset.work);
          const tt = target?.closest?.('.tm-popup button[data-act="events"]') as HTMLElement | null;
          if (tt?.dataset.id) onOpenTimetableRef.current?.(tt.dataset.id);
        },
        true
      );
      // Hundreds of pins and their names crowd each other at city scale; they only appear once zoomed right in.
      const syncZoom = () => {
        map.getContainer().classList.toggle('sv-zoomed', map.getZoom() >= VENUE_MIN_ZOOM);
        setZoom(map.getZoom());
      };
      map.on('zoomend', syncZoom);
      syncZoom();

      // Restore the view from the URL, then start mirroring changes back into it.
      const applyUrlView = () => {
        const here = map.getCenter();
        map.setView(
          initial.location ? [initial.location.lat, initial.location.lng] : here,
          initial.zoom ?? map.getZoom(),
          { animate: false }
        );
      };
      if (initial.location || initial.zoom) applyUrlView();
      if (initial.station && (initial.location || initial.zoom)) {
        // The page flies to the station named in its hash once its data is in; put the view back after that settles,
        // unless the user has already taken over.
        let touched = false;
        map.getContainer().addEventListener('pointerdown', () => (touched = true), { once: true });
        window.setTimeout(() => {
          if (!touched) applyUrlView();
          urlReadyRef.current = true;
          writeUrlRef.current();
        }, 2000);
      } else {
        urlReadyRef.current = true;
      }
      map.on('moveend', () => writeUrlRef.current());
      // The station panel (and the hash that goes with it) opens and closes without moving the map.
      const detailPanel = doc.getElementById('detail-panel');
      if (detailPanel) {
        new win.MutationObserver(() => writeUrlRef.current()).observe(detailPanel, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }

      mapWinRef.current = win;
      setMapWin(win);
    };
    attach();
  }, []);

  // Theme sync: drive the tube page's own theme menu (its 'light' and 'dark' themes match ours).
  useEffect(() => {
    if (!mapWin) return;
    try {
      mapWin.document.querySelector(`.theme-opt[data-theme="${themeMode}"]`)?.click();
    } catch {
      /* ignore */
    }
  }, [mapWin, themeMode]);

  // The Timetable styles read the app's theme variables; the iframe has none of its own, so copy the current values over.
  useEffect(() => {
    if (!mapWin) return;
    const id = window.requestAnimationFrame(() => {
      try {
        const css = getComputedStyle(document.documentElement);
        const decls = THEME_VARS.map((v) => `${v}:${css.getPropertyValue(v).trim()}`).join(';');
        const doc: Document = mapWin.document;
        let style = doc.getElementById('sv-theme-vars');
        if (!style) {
          style = doc.createElement('style');
          style.id = 'sv-theme-vars';
          doc.head.appendChild(style);
        }
        style.textContent = `:root{${decls}}`;
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [mapWin, themeMode]);

  useEffect(() => {
    writeUrlRef.current();
  }, [mapWin, active, showVenues, showAmenities]);

  // Folded away, the planner's view no longer belongs in the address bar.
  useEffect(() => {
    if (!active) setParams({ jploc: null, jpzoom: null, jpvenue: null, station: null, jpvenues: null, jpamenities: null });
  }, [active]);

  // The iframe can be resized or shown after being hidden (accordion / sidebar): tell Leaflet.
  useEffect(() => {
    const el = iframeRef.current;
    if (!el || !mapWin || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        getMap(mapWin)?.invalidateSize({ pan: false });
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapWin]);

  const eventsForVenue = useCallback(
    (v: MapVenue) =>
      liveEvents
        .filter(
          (e) =>
            haversineDistanceMeters(v.lat, v.lng, e.location.coordinates[1], e.location.coordinates[0]) < 200 ||
            e.venue_name.toLowerCase().includes(v.name.toLowerCase().slice(0, 12))
        )
        .sort((a, b) => a.start_time_iso.localeCompare(b.start_time_iso))
        .slice(0, 8),
    [liveEvents]
  );

  // (Re)build the sottovoce marker layer.
  useEffect(() => {
    if (!mapWin) return;
    const L = mapWin.L;
    const map = getMap(mapWin);
    if (!L || !map) return;

    rebuildingRef.current = true;
    layerRef.current?.remove();
    rebuildingRef.current = false;
    markersRef.current = new Map();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;

    if (showVenues) {
      for (const v of venues) {
        const evs = venueEvents.get(v.id) ?? [];
        // With a category filter on, only venues that have something in those categories stay.
        if (cats.size && !evs.length) continue;
        const active = !!activeVenueId && v.id === activeVenueId;
        const size = sizeFor(evs.length);
        const icon = L.divIcon({
          className: `sv-venue sv-${v.kind}${evs.length ? '' : ' sv-none'}`,
          html: `<div class="sv-pin"><div class="tm-pin${active ? ' sel' : ''}">${donut(catCounts(evs), evs.length, size, { selected: active })}</div><div class="sv-name">${esc(v.name)}</div></div>`,
          iconSize: [0, 0],
        });
        const marker = L.marker([v.lat, v.lng], {
          icon,
          pane: 'sottovoce-venues',
          zIndexOffset: active ? 1000 : evs.length,
          title: v.name,
        });

        const asTimetableVenue: TimetableVenue = { id: v.id, name: v.name, kind: v.kind, address: v.address, lat: v.lat, lng: v.lng, site: v.site };
        const live = v.fromApp ? eventsForVenue(v) : [];
        const venueWorks = v.fromApp ? works.filter((w) => w.venue_id === v.id) : [];
        const liveHtml = live.length
          ? live
              .map(
                (e) =>
                  `<div class="sv-live"><b>${esc(e.title)}</b><span>${esc(e.source_platform)} · ${new Date(
                    e.start_time_iso
                  ).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>`
              )
              .join('')
          : '';
        const worksHtml = venueWorks
          .map((w) => `<button type="button" data-work="${esc(w.work_id)}">Open ${esc(w.title)} libretto</button>`)
          .join('');
        const ttId = v.ttIds?.find((id) => timetableRef.current.events.some((e) => e.venue_id === id)) ?? v.ttIds?.[0];
        const popup = L.popup({ className: 'tm-popup', maxWidth: 360, minWidth: 280, autoPanPadding: [30, 30], offset: [0, -size / 2] }).setContent(
          popupHtml(
            asTimetableVenue,
            evs,
            undefined,
            ttId ? { act: 'events', label: 'Open in Events', id: ttId } : { act: '', label: '' },
            { body: liveHtml, actions: worksHtml, image: venueImage(v.ttIds, vImages) }
          )
        );
        marker.bindTooltip(tooltipHtml(asTimetableVenue, evs, undefined, venueImage(v.ttIds, vImages)), { direction: 'top', className: 'tm-tooltip', offset: [0, -size / 2] });
        marker.bindPopup(popup);
        marker.on('popupopen', (ev: any) => {
          openVenueRef.current = v.id;
          writeUrlRef.current();
          // A poster that fails to load shouldn't leave a hole in the popup.
          ev.popup.getElement()?.querySelectorAll('img').forEach((img: HTMLImageElement) =>
            img.addEventListener('error', () => {
              const holder = img.parentElement;
              img.remove();
              if (holder?.classList.contains('tm-hero') && !holder.querySelector('img')) holder.remove();
            })
          );
        });
        marker.on('popupclose', () => {
          if (rebuildingRef.current || openVenueRef.current !== v.id) return;
          openVenueRef.current = null;
          writeUrlRef.current();
        });
        marker.addTo(group);
        markersRef.current.set(v.id, marker);
      }
    }

    if (showAmenities) {
      for (const n of civicNodes) {
        const meta = LOCATION_META[n.category];
        if (!meta) continue;
        const icon = L.divIcon({
          className: 'sv-amenity',
          html: `<div class="sv-dot">${svgIconHtml(meta[0], 14)}</div>`,
          iconSize: [0, 0],
        });
        L.marker([n.location.coordinates[1], n.location.coordinates[0]], {
          icon,
          pane: 'sottovoce-venues',
          title: n.name,
        })
          .bindTooltip(
            `<div class="tm-tip"><div class="tm-tip-h"><strong>${esc(n.name)}</strong><span>${esc(meta[1])}${n.address ? ' · ' + esc(n.address) : ''}</span></div></div>`,
            { direction: 'top', className: 'tm-tooltip', offset: [0, -12] }
          )
          .addTo(group);
      }
    }

    for (const layer of TFL_LAYERS) {
      if (!tflLayersOn[layer.type]) continue;
      for (const p of tflPlaces[layer.type] ?? []) {
        const stats = (p.additionalProperties ?? []).filter((pr) => layer.statKeys.test(pr.key)).slice(0, 4);
        const icon = L.divIcon({
          className: 'sv-amenity',
          html: `<div class="sv-dot">${svgIconHtml(layer.icon, 14)}</div>`,
          iconSize: [0, 0],
        });
        L.marker([p.lat, p.lon], { icon, pane: 'sottovoce-tfl', title: p.commonName })
          .bindTooltip(
            `<div class="tm-tip"><div class="tm-tip-h"><strong>${esc(p.commonName)}</strong><span>${esc(layer.label)}</span></div>${stats
              .map((s) => `<div>${esc(s.key.replace(/^Nb/, ''))}: ${esc(String(s.value))}</div>`)
              .join('')}</div>`,
            { direction: 'top', className: 'tm-tooltip', offset: [0, -12] }
          )
          .addTo(group);
      }
    }

    if (showWeather && openLondonTelemetry?.weather) {
      const w = openLondonTelemetry.weather;
      const icon = L.divIcon({
        className: 'sv-amenity',
        html: `<div class="sv-dot">${svgIconHtml('cloud-sun', 14)}</div>`,
        iconSize: [0, 0],
      });
      L.marker(WEATHER_SAMPLE_POINT, { icon, pane: 'sottovoce-tfl', title: 'Weather' })
        .bindTooltip(
          `<div class="tm-tip"><div class="tm-tip-h"><strong>${w.temperature_c.toFixed(1)}°C</strong><span>${esc(w.condition_summary)}</span></div><div>Precipitation: ${w.precipitation_mm}mm</div><div>Wind: ${w.wind_speed_kmh.toFixed(0)}km/h</div></div>`,
          { direction: 'top', className: 'tm-tooltip', offset: [0, -12] }
        )
        .addTo(group);
    }

    // A rebuild closes the open popup; put it back (this is also how ?venue= is restored on load).
    const reopen = openVenueRef.current ? markersRef.current.get(openVenueRef.current) : null;
    if (reopen) {
      if (!initial.location && !venueRestoredRef.current) {
        const v = venues.find((x) => x.id === openVenueRef.current);
        if (v) map.setView([v.lat, v.lng], initial.zoom ?? VENUE_FLY_ZOOM, { animate: false });
      }
      reopen.openPopup();
    }
    venueRestoredRef.current = true;

    return () => {
      rebuildingRef.current = true;
      group.remove();
      rebuildingRef.current = false;
    };
  }, [mapWin, venues, venueEvents, cats, civicNodes, works, activeVenueId, showVenues, showAmenities, eventsForVenue, tflLayersOn, tflPlaces, showWeather, openLondonTelemetry, vImages]); // eslint-disable-line react-hooks/exhaustive-deps

  const flyToVenue = useCallback(
    (v: { id?: string; lat: number; lng: number }) => {
      const map = getMap(mapWin);
      if (!map) return;
      if (!showVenues) setShowVenues(true);
      map.flyTo([v.lat, v.lng], VENUE_FLY_ZOOM, { duration: 1.1 });
      if (!v.id) return;
      const open = () => markersRef.current.get(v.id!)?.openPopup();
      map.once('moveend', open);
      window.setTimeout(open, 1400); // moveend may not fire when already at the target
    },
    [mapWin, showVenues]
  );

  // Fly to a venue, or plan a journey to it, on request.
  useEffect(() => {
    if (!mapWin || !focus) return;
    const v = venues.find((x) => x.id === focus.id) ?? venues.find((x) => x.ttIds?.includes(focus.id));
    if (!v) return;
    // Planning: just centre the venue, without its popup covering the map beside the planner.
    flyToVenue(focus.plan ? { lat: v.lat, lng: v.lng } : v);
    if (!focus.plan || typeof mapWin.svPlanJourney !== 'function') return;
    const e = focus.plan.eventId ? timetableRef.current.events.find((x) => x.id === focus.plan!.eventId) : undefined;
    const stamp = e?.time_known ? londonStamp(e.start) : null;
    const target = { venueId: v.id, name: v.name, venue: v.name, lat: v.lat, lon: v.lng };
    mapWin.svPlanJourney(
      e && stamp ? { ...target, kind: 'show', title: e.title, label: stamp.label, ymd: stamp.ymd, hhmm: stamp.hhmm } : { ...target, kind: 'venue' },
      { fromHere: focus.plan.fromHere }
    );
  }, [focus, mapWin, venues]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tube page's station search and journey planner call these for venues, operas and shows.
  useEffect(() => {
    if (!mapWin) return;
    mapWin.svPlaces = {
      search: (q: string) => searchPlaces(q, venues, liveEvents, Date.now(), timetableRef.current.events),
      pick: (t: { venueId?: string; lat: number; lon: number }) =>
        flyToVenue({ id: t.venueId, lat: t.lat, lng: t.lon }),
    };
    return () => {
      delete mapWin.svPlaces;
    };
  }, [mapWin, venues, liveEvents, flyToVenue]);

  const venueCount = cats.size ? venues.filter((v) => venueEvents.get(v.id)?.length).length : venues.length;

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-[11px] uppercase tracking-wider cursor-pointer transition-colors ${
      on ? 'bg-[#9E1B32] text-[#FAF6F0] border-transparent' : ''
    }`;
  const chipStyle = (on: boolean): React.CSSProperties =>
    on
      ? {}
      : {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-hairline)',
          color: 'var(--text-secondary)',
        };

  return (
    <div className={className}>
      {showTelemetry && openLondonTelemetry && <LondonTelemetryStrip telemetry={openLondonTelemetry} className="mb-3" />}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" className={chip(showVenues)} style={chipStyle(showVenues)} onClick={() => setShowVenues((v) => !v)}>
          <Landmark className="w-3.5 h-3.5" /> Opera, theatre &amp; venues
        </button>
        <button type="button" className={chip(showAmenities)} style={chipStyle(showAmenities)} onClick={() => setShowAmenities((v) => !v)}>
          <Droplets className="w-3.5 h-3.5" /> Fountains, toilets &amp; more
        </button>
        {TIMETABLE_CATEGORIES.map((c) => {
          const on = cats.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              title={c.blurb}
              className={chip(false)}
              style={{ ...chipStyle(false), ...(on ? { borderColor: c.color, color: 'var(--text-primary)', backgroundColor: `color-mix(in srgb, ${c.color} 16%, transparent)` } : {}), opacity: cats.size && !on ? 0.55 : 1 }}
              onClick={() =>
                setCats((prev) => {
                  const next = new Set(prev);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  return next;
                })
              }
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              {c.label.split(' ')[0]}
            </button>
          );
        })}
        <a
          href="/tube/"
          target="_blank"
          rel="noopener"
          className="ml-auto inline-flex items-center gap-1 py-2 font-mono text-[11px] uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Open full page <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-wider shrink-0" style={{ color: 'var(--text-muted)' }}>
          TfL &amp; weather layers
        </span>
        {([
          { type: 'BikePoint' as const, Icon: Bike, label: 'Bike points' },
          { type: 'CarPark' as const, Icon: CircleParking, label: 'Car parks' },
          { type: 'TaxiRank' as const, Icon: CarTaxiFront, label: 'Taxi ranks' },
        ]).map(({ type, Icon, label }) => {
          const on = !!tflLayersOn[type];
          return (
            <button
              key={type}
              type="button"
              aria-pressed={on}
              className={chip(on)}
              style={chipStyle(on)}
              onClick={() => setTflLayersOn((prev) => ({ ...prev, [type]: !prev[type] }))}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
        <button type="button" aria-pressed={showWeather} className={chip(showWeather)} style={chipStyle(showWeather)} onClick={() => setShowWeather((v) => !v)}>
          <CloudSun className="w-3.5 h-3.5" /> Weather
        </button>
        {onRefreshOpenLondonTelemetry && (
          <button
            type="button"
            onClick={onRefreshOpenLondonTelemetry}
            disabled={refreshingOpenLondonTelemetry}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-[11px] uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-wait"
            style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingOpenLondonTelemetry ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      </div>
      <div
        className="relative rounded-xl overflow-hidden border"
        style={{ borderColor: 'var(--border-hairline)', backgroundColor: '#0a0a0e' }}
      >
        {mapWin && zoom != null && zoom < VENUE_MIN_ZOOM && (
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-8 z-10 rounded-lg px-3 py-1.5 text-xs font-mono pointer-events-none shadow-md"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}
          >
            Zoom in to see {venueCount} venues and their performances
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="Journey Planner"
          src={iframeSrc}
          onLoad={handleLoad}
          allow="geolocation"
          className="block w-full h-[calc(100dvh-9rem)] min-h-[440px] md:min-h-[620px] border-0"
        />
      </div>
    </div>
  );
};
