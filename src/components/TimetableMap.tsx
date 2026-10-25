import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '../timetableMap.css';
import { Bike, CarTaxiFront, CircleParking, CloudSun, Crosshair, Droplets, Landmark, Layers, Maximize2, Minimize2, RefreshCw, ScanSearch, Settings2, Shrink } from 'lucide-react';
import {
  CATEGORY_BY_ID,
  TIMETABLE_CATEGORIES,
  type TimetableCategory,
  type TimetableEvent,
  type TimetableVenue,
  type VenueKind,
} from '../data/timetableCategories';
import type { CivicNode, LiveEvent, OpenLondonLiveTelemetry, WorkAndLibretto } from '../types/sottovoce';
import { catCounts, chips, dominant, donut, esc, kmBetween, popupHtml, sizeFor, tooltipHtml } from '../utils/timetableMapHtml';
import { haversineDistanceMeters } from '../utils/sottovoceEngine';
import { venueImage, venueImageIndex } from '../utils/venueImage';
import { svgIconHtml } from '../utils/svgIcons';
import { dayKey, eventDay } from '../utils/timetableFormat';
import { formatLocation, parseLocation, readParams, setParams } from '../utils/urlState';
import {
  LOCATION_META,
  LondonTelemetryStrip,
  TFL_LAYERS,
  VENUE_MIN_ZOOM,
  WEATHER_SAMPLE_POINT,
  useMapVenues,
  useTflPlaces,
  type MapVenue,
  type TflLayerType,
} from './TubeMapEmbed';

// leaflet.markercluster is a UMD plugin that looks for a global `L`; set it before the plugin is imported (lazily, below).
(window as unknown as { L: typeof L }).L = L;

/** A toolbar button that opens a small panel beneath it; closes on outside click or Escape. */
function MapPopover({ label, Icon, btnCls, btnStyle, title, children }: {
  label: string; Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; btnCls: string; btnStyle: React.CSSProperties; title: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className={btnCls}
        style={open ? { ...btnStyle, borderColor: 'var(--accent-crimson)' } : btnStyle} title={title}>
        <Icon className="w-3.5 h-3.5" aria-hidden /> {label}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="absolute right-0 top-full mt-1.5 z-[1100] w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border p-2.5 shadow-lg"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export interface MapBounds { south: number; west: number; north: number; east: number }

interface TimetableMapProps {
  /** Events after every filter (category, range, venue, kind, search) — the map plots exactly these. */
  events: TimetableEvent[];
  venues: TimetableVenue[];
  active: Set<TimetableCategory>;
  toggleCategory: (c: TimetableCategory) => void;
  resetCategories: () => void;
  venueId: string;
  onPickVenue: (id: string) => void;
  /** Set by the list ("show on map"); `n` changes on every request so the same venue can be refocused. */
  focus: { venueId: string; n: number } | null;
  syncView: boolean;
  setSyncView: (v: boolean) => void;
  onBounds: (b: MapBounds | null) => void;
  /** Changes whenever a filter changes; the map refits to the results when it does (unless the list is synced to the view). */
  fitKey: string;
  /** Every listing, unfiltered: a venue focused from the venue index still shows what's on there when filters hide it. */
  allEvents: TimetableEvent[];
  /**
   * Which venues with nothing in the results still get a (grey) pin when the "all venues" layer is on — null while a
   * filter that is about the performances themselves (category, venue, source, text) is narrowing the list.
   */
  emptyKinds: Set<VenueKind> | null;
  /** The app's own venues and civic locations (fountains, toilets, …), its live events and libretti. */
  civicNodes: CivicNode[];
  liveEvents: LiveEvent[];
  works: WorkAndLibretto[];
  /** The current libretto's venue (a civic node id), ringed on the map. */
  activeVenueId?: string;
  openLondonTelemetry?: OpenLondonLiveTelemetry;
  onRefreshTelemetry?: () => void;
  refreshingTelemetry?: boolean;
  onOpenWork?: (workId: string) => void;
  /** Open the Journey Planner at this map venue. */
  onPlanJourney?: (mapVenueId: string) => void;
}

interface BaseLayer { id: string; label: string; url: string; attribution: string; maxZoom: number; subdomains?: string }

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors';
const BASE_LAYERS: BaseLayer[] = [
  { id: 'osm', label: 'Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxZoom: 19 },
  {
    id: 'light', label: 'Light', maxZoom: 20, subdomains: 'abcd',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer noopener">CARTO</a>`,
  },
  {
    id: 'dark', label: 'Dark', maxZoom: 20, subdomains: 'abcd',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer noopener">CARTO</a>`,
  },
  {
    id: 'hot', label: 'Humanitarian', maxZoom: 19, subdomains: 'abc',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTR}, tiles <a href="https://www.hotosm.org/" target="_blank" rel="noreferrer noopener">HOT</a>`,
  },
];

/** One pin: a map venue (several Timetable listings can share a building) and its performances in the results. */
type Group = { venue: MapVenue; events: TimetableEvent[] };

/** Zoom for showing one venue: clustering is off from here (disableClusteringAtZoom), so its own pin is on the map. */
const FOCUS_ZOOM = 16;

const asTimetableVenue = (v: MapVenue): TimetableVenue => ({ id: v.id, name: v.name, kind: v.kind, address: v.address, lat: v.lat, lng: v.lng, site: v.site });

/** Optional overlays: the venue/amenity ones are on unless the URL turns them off, TfL and weather are opt-in (?layers=). */
const OVERLAYS = ['bike', 'carpark', 'taxi', 'weather'] as const;
type Overlay = (typeof OVERLAYS)[number];
const TFL_OVERLAY: Record<TflLayerType, Overlay> = { BikePoint: 'bike', CarPark: 'carpark', TaxiRank: 'taxi' };
const OVERLAY_BUTTONS: { id: Overlay; label: string; Icon: typeof Bike }[] = [
  { id: 'bike', label: 'Bike points', Icon: Bike },
  { id: 'carpark', label: 'Car parks', Icon: CircleParking },
  { id: 'taxi', label: 'Taxi ranks', Icon: CarTaxiFront },
  { id: 'weather', label: 'Weather', Icon: CloudSun },
];

/** The map's own URL state, read once: ?location=lat,lng&zoom=&pin=<map venue>&venues=0&amenities=0&layers=bike,weather */
const readMapUrl = () => {
  const p = readParams();
  const zoom = Number(p.get('zoom'));
  return {
    location: parseLocation(p.get('location')),
    zoom: p.get('zoom') && Number.isFinite(zoom) && zoom > 0 ? zoom : null,
    pin: p.get('pin'),
    venues: p.get('venues') !== '0',
    amenities: p.get('amenities') !== '0',
    layers: new Set((p.get('layers') ?? '').split(',').filter((l): l is Overlay => (OVERLAYS as readonly string[]).includes(l))),
  };
};

/** The app's live events at (or named after) a venue, soonest first. */
const liveEventsAt = (v: MapVenue, liveEvents: LiveEvent[]) =>
  liveEvents
    .filter(
      (e) =>
        haversineDistanceMeters(v.lat, v.lng, e.location.coordinates[1], e.location.coordinates[0]) < 200 ||
        e.venue_name.toLowerCase().includes(v.name.toLowerCase().slice(0, 12))
    )
    .sort((a, b) => a.start_time_iso.localeCompare(b.start_time_iso))
    .slice(0, 8);

export const TimetableMap: React.FC<TimetableMapProps> = ({
  events, venues, active, toggleCategory, resetCategories, venueId, onPickVenue, focus, syncView, setSyncView, onBounds, fitKey,
  allEvents, emptyKinds, civicNodes, liveEvents, works, activeVenueId, openLondonTelemetry, onRefreshTelemetry, refreshingTelemetry, onOpenWork, onPlanJourney,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const vImages = useMemo(() => venueImageIndex(allEvents), [allEvents]);
  const vImagesRef = useRef(vImages);
  vImagesRef.current = vImages;
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const plainRef = useRef<L.LayerGroup | null>(null);
  const userRef = useRef<L.LayerGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const emptyRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const [ready, setReady] = useState(false);
  const [baseId, setBaseId] = useState('osm');
  const [clustered, setClustered] = useState(true);
  const [tall, setTall] = useState(false);
  const [user, setUser] = useState<[number, number] | null>(null);
  const [locError, setLocError] = useState('');
  const [initial] = useState(readMapUrl);
  const [showAllVenues, setShowAllVenues] = useState(initial.venues);
  const [showAmenities, setShowAmenities] = useState(initial.amenities);
  const [overlays, setOverlays] = useState<Set<Overlay>>(initial.layers);
  const [zoom, setZoom] = useState(initial.zoom ?? 12);
  const tflOn = useMemo(
    () => Object.fromEntries(TFL_LAYERS.map((l) => [l.type, overlays.has(TFL_OVERLAY[l.type])])) as Record<TflLayerType, boolean>,
    [overlays]
  );
  const tflPlaces = useTflPlaces(tflOn);
  const openPin = useRef<string | null>(initial.pin); // map venue whose popup is open (?pin=)
  const rebuilding = useRef(false); // true while markers are torn down, so their popupclose isn't the user's
  const pinRestored = useRef(false); // the first marker build centres on ?pin= when there's no ?location=
  // Callbacks used from Leaflet event handlers go through refs so the map is created once.
  const pick = useRef(onPickVenue); pick.current = onPickVenue;
  const boundsCb = useRef(onBounds); boundsCb.current = onBounds;
  const syncRef = useRef(syncView); syncRef.current = syncView;
  const userPos = useRef(user); userPos.current = user;
  const openWork = useRef(onOpenWork); openWork.current = onOpenWork;
  const planJourney = useRef(onPlanJourney); planJourney.current = onPlanJourney;

  // Every venue the app knows: its own, the well-known extras and each Timetable venue with coordinates (shared buildings merged).
  const mapVenues = useMapVenues(civicNodes, venues);
  const byListing = useMemo(() => {
    const m = new Map<string, MapVenue>();
    for (const v of mapVenues) for (const id of v.ttIds ?? []) m.set(id, v);
    return m;
  }, [mapVenues]);
  /** A map venue id or a Timetable venue id → its map venue. */
  const venueFor = (id: string) => mapVenues.find((v) => v.id === id) ?? byListing.get(id);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const e of events) {
      const v = byListing.get(e.venue_id);
      if (!v) continue;
      (m.get(v.id) ?? m.set(v.id, { venue: v, events: [] }).get(v.id)!).events.push(e);
    }
    return [...m.values()];
  }, [events, byListing]);
  // Venues with nothing in the results, drawn grey when the "all venues" layer is on and no filter is narrowing the performances.
  // They stay out of the clusters and, as on the Journey Planner, only show zoomed right in.
  const emptyGroups = useMemo<Group[]>(() => {
    if (!showAllVenues || !emptyKinds) return [];
    const busy = new Set(groups.map((g) => g.venue.id));
    return mapVenues.filter((v) => !busy.has(v.id) && (!emptyKinds.size || emptyKinds.has(v.kind))).map((v) => ({ venue: v, events: [] }));
  }, [showAllVenues, emptyKinds, groups, mapVenues]);

  const unplotted = useMemo(() => events.reduce((n, e) => n + (byListing.has(e.venue_id) ? 0 : 1), 0), [events, byListing]);

  /** Everything coming up at a venue, whatever the filters (for pins the results leave empty). */
  const upcomingAt = (v: MapVenue) => {
    const today = dayKey(new Date());
    return allEvents.filter((e) => v.ttIds?.includes(e.venue_id) && eventDay(e) >= today).sort((a, b) => a.start.localeCompare(b.start));
  };

  /**
   * Popup for a venue: its performances, plus the app's live events and libretti there and a Journey Planner hand-off.
   * `inResults` false: the performances are everything upcoming rather than the filtered list, so there's nothing to filter to.
   */
  const venuePopup = (v: MapVenue, evs: TimetableEvent[], dist?: number, inResults = true) => {
    const live = v.fromApp ? liveEventsAt(v, liveEvents) : [];
    const liveHtml = live
      .map(
        (e) =>
          `<div class="tm-live"><b>${esc(e.title)}</b><span>${esc(e.source_platform)} · ${new Date(e.start_time_iso).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}</span></div>`
      )
      .join('');
    const worksHtml = (v.fromApp ? works.filter((w) => w.venue_id === v.id) : [])
      .map((w) => `<button type="button" data-work="${esc(w.work_id)}">Open ${esc(w.title)} libretto</button>`)
      .join('');
    const planHtml = onPlanJourney ? `<button type="button" data-act="plan">Plan journey</button>` : '';
    // "Show only this venue" filters to the listing that has the performances (a building can have several).
    const listing = inResults ? evs[0]?.venue_id : undefined;
    const popup = L.popup({ maxWidth: 360, minWidth: 280, className: 'tm-popup', autoPanPadding: [30, 30] }).setContent(
      popupHtml(asTimetableVenue(v), evs, dist, listing ? undefined : { act: '', label: '' }, { body: liveHtml, actions: worksHtml + planHtml, image: venueImage(v.ttIds, vImagesRef.current) })
    );
    Object.assign(popup, { _venueId: listing, _mapVenueId: v.id });
    return popup;
  };

  // Create the map (and load the cluster plugin) once.
  useEffect(() => {
    let cancelled = false;
    let map: L.Map | undefined;
    import('leaflet.markercluster').then(() => {
      if (cancelled || !hostRef.current) return;
      const center: [number, number] = initial.location ? [initial.location.lat, initial.location.lng] : [51.5128, -0.1198];
      map = L.map(hostRef.current, { center, zoom: initial.zoom ?? 12, maxZoom: 19, zoomControl: false, worldCopyJump: true, preferCanvas: false });
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
      userRef.current = L.layerGroup().addTo(map);
      plainRef.current = L.layerGroup();
      overlayRef.current = L.layerGroup().addTo(map);
      emptyRef.current = L.layerGroup().addTo(map);
      // Fountains, bike points and the like crowd the city view; like venue labels on the Journey Planner they appear zoomed in.
      const syncZoom = () => {
        map!.getContainer().classList.toggle('tm-zoomed', map!.getZoom() >= VENUE_MIN_ZOOM);
        setZoom(map!.getZoom());
      };
      map.on('zoomend', syncZoom);
      syncZoom();

      clusterRef.current = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 52,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: FOCUS_ZOOM,
        iconCreateFunction: (cl) => {
          const counts: Partial<Record<TimetableCategory, number>> = {};
          let total = 0;
          for (const mk of cl.getAllChildMarkers()) {
            const g = (mk.options as { group?: Group }).group;
            if (!g) continue;
            for (const e of g.events) counts[e.category] = (counts[e.category] ?? 0) + 1;
            total += g.events.length;
          }
          const size = Math.min(72, 46 + Math.sqrt(cl.getChildCount()) * 5);
          return L.divIcon({
            html: `<div class="tm-cluster" title="${cl.getChildCount()} venues">${donut(counts, total, size, { cluster: true })}<span class="tm-cl-n">${cl.getChildCount()} venues</span></div>`,
            className: 'tm-icon',
            iconSize: [size, size],
          });
        },
      });
      clusterRef.current.on('clustermouseover', (raw) => {
        const ev = raw as unknown as { layer: L.MarkerCluster };
        const venuesIn = ev.layer.getAllChildMarkers().map((mk: L.Marker) => (mk.options as { group?: Group }).group!).filter(Boolean);
        const counts: Partial<Record<TimetableCategory, number>> = {};
        let total = 0;
        for (const g of venuesIn) for (const e of g.events) { counts[e.category] = (counts[e.category] ?? 0) + 1; total++; }
        const top = [...venuesIn].sort((a, b) => b.events.length - a.events.length).slice(0, 5);
        ev.layer.bindTooltip(
          `<div class="tm-tip tm-tip-cl"><div class="tm-tip-h"><strong>${venuesIn.length} venues · ${total} performances</strong><span>Click to zoom in</span></div>
           <div class="tm-chips">${chips(counts)}</div>
           <div class="tm-tip-n">${top.map((g) => `<div>${esc(g.venue.name)} <b>${g.events.length}</b></div>`).join('')}${venuesIn.length > 5 ? `<div>+ ${venuesIn.length - 5} more</div>` : ''}</div></div>`,
          { direction: 'top', className: 'tm-tooltip', sticky: false, offset: [0, -8] }
        ).openTooltip();
      });
      map.addLayer(clusterRef.current);

      const emit = () => {
        if (!syncRef.current) return;
        const b = map!.getBounds();
        boundsCb.current({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      };
      map.on('moveend', emit);
      // Mirror the view into the address bar so a refresh or a shared link reopens it.
      map.on('moveend', () => {
        const c = map!.getCenter();
        setParams({ location: formatLocation(c.lat, c.lng), zoom: String(+map!.getZoom().toFixed(2)) });
      });
      map.on('popupopen', (ev) => {
        const root = ev.popup.getElement();
        if (!root) return;
        root.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
          const holder = img.parentElement;
          img.remove();
          if (holder?.classList.contains('tm-hero') && !holder.querySelector('img')) holder.remove();
        }));
        const { _venueId: listing, _mapVenueId: mapVenueId } = ev.popup as unknown as { _venueId?: string; _mapVenueId?: string };
        root.querySelector('[data-act="filter"]')?.addEventListener('click', () => {
          if (listing) pick.current(listing);
          map!.closePopup();
        });
        root.querySelector('[data-act="plan"]')?.addEventListener('click', () => mapVenueId && planJourney.current?.(mapVenueId));
        root.querySelectorAll<HTMLElement>('[data-work]').forEach((b) => b.addEventListener('click', () => openWork.current?.(b.dataset.work!)));
        if (mapVenueId) {
          openPin.current = mapVenueId;
          setParams({ pin: mapVenueId });
        }
      });
      map.on('popupclose', (ev) => {
        const id = (ev.popup as unknown as { _mapVenueId?: string })._mapVenueId;
        if (rebuilding.current || !id || openPin.current !== id) return;
        openPin.current = null;
        setParams({ pin: null });
      });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  // Base tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const b = BASE_LAYERS.find((x) => x.id === baseId)!;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, subdomains: b.subdomains ?? 'abc', detectRetina: true }).addTo(map);
    tileRef.current.bringToBack();
  }, [ready, baseId]);

  // Markers follow the filtered events.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const plain = plainRef.current;
    const empty = emptyRef.current;
    if (!ready || !map || !cluster || !plain || !empty) return;
    rebuilding.current = true;
    map.closePopup();
    cluster.clearLayers();
    plain.clearLayers();
    empty.clearLayers();
    rebuilding.current = false;
    markersRef.current.clear();
    const markers: L.Marker[] = [];
    for (const g of [...groups, ...emptyGroups]) {
      const evs = [...g.events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const counts = catCounts(evs);
      const size = sizeFor(evs.length);
      // Ringed: the venue the list is filtered to, or the current libretto's house.
      const selected = (!!venueId && !!g.venue.ttIds?.includes(venueId)) || (!!activeVenueId && g.venue.id === activeVenueId);
      const dist = userPos.current ? kmBetween(userPos.current, [g.venue.lat, g.venue.lng]) : undefined;
      const mk = L.marker([g.venue.lat, g.venue.lng], {
        icon: L.divIcon({
          html: `<div class="tm-pin${selected ? ' sel' : ''}${evs.length ? '' : ' none'}" style="--c:${CATEGORY_BY_ID[dominant(counts)].color}">${donut(counts, evs.length, size, { selected })}</div>`,
          className: evs.length ? 'tm-icon' : 'tm-icon tm-empty',
          iconSize: [size, size],
        }),
        alt: g.venue.name,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : evs.length,
        group: { ...g, events: evs },
      } as L.MarkerOptions);
      mk.bindTooltip(tooltipHtml(asTimetableVenue(g.venue), evs, dist, venueImage(g.venue.ttIds, vImagesRef.current)), { direction: 'top', className: 'tm-tooltip', offset: [0, -size / 2] });
      mk.bindPopup(evs.length ? venuePopup(g.venue, evs, dist) : venuePopup(g.venue, upcomingAt(g.venue), dist, false));
      markersRef.current.set(g.venue.id, mk);
      if (evs.length) markers.push(mk);
      else empty.addLayer(mk);
    }
    if (clustered) {
      if (map.hasLayer(plain)) map.removeLayer(plain);
      cluster.addLayers(markers);
      if (!map.hasLayer(cluster)) map.addLayer(cluster);
    } else {
      if (map.hasLayer(cluster)) map.removeLayer(cluster);
      markers.forEach((m) => plain.addLayer(m));
      if (!map.hasLayer(plain)) map.addLayer(plain);
    }
    // A rebuild closes the open popup; put it back (this is also how ?pin= is restored on load).
    // (Opened on the map rather than the marker, which may be inside a cluster.)
    const reopen = openPin.current ? markersRef.current.get(openPin.current) : undefined;
    if (reopen) {
      if (!pinRestored.current && !initial.location) map.setView(reopen.getLatLng(), initial.zoom ?? FOCUS_ZOOM, { animate: false });
      reopen.getPopup()?.setLatLng(reopen.getLatLng()).openOn(map);
    }
    pinRestored.current = true;
  }, [ready, groups, emptyGroups, venueId, activeVenueId, clustered, user, liveEvents, works]); // eslint-disable-line react-hooks/exhaustive-deps

  // Amenities (fountains, toilets, …), TfL places and the weather reading: small icons on their own layer.
  useEffect(() => {
    const layer = overlayRef.current;
    if (!ready || !layer) return;
    layer.clearLayers();
    const dot = (icon: string, cls = 'tm-amenity') => L.divIcon({ className: cls, html: `<div class="tm-dot">${svgIconHtml(icon, 14)}</div>`, iconSize: [0, 0] });
    const tip = (title: string, sub: string, rows: string[] = []) =>
      `<div class="tm-tip"><div class="tm-tip-h"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>${rows.map((r) => `<div>${r}</div>`).join('')}</div>`;
    const tipOpts: L.TooltipOptions = { direction: 'top', className: 'tm-tooltip', offset: [0, -12] };
    if (showAmenities) {
      for (const n of civicNodes) {
        const meta = LOCATION_META[n.category];
        if (!meta) continue;
        L.marker([n.location.coordinates[1], n.location.coordinates[0]], { icon: dot(meta[0]), title: n.name, keyboard: false })
          .bindTooltip(tip(n.name, `${meta[1]}${n.address ? ` · ${n.address}` : ''}`), tipOpts)
          .addTo(layer);
      }
    }
    for (const t of TFL_LAYERS) {
      if (!tflOn[t.type]) continue;
      for (const p of tflPlaces[t.type] ?? []) {
        const stats = (p.additionalProperties ?? []).filter((pr) => t.statKeys.test(pr.key)).slice(0, 4);
        L.marker([p.lat, p.lon], { icon: dot(t.icon), title: p.commonName, keyboard: false })
          .bindTooltip(tip(p.commonName, t.label, stats.map((s) => `${esc(s.key.replace(/^Nb/, ''))}: ${esc(String(s.value))}`)), tipOpts)
          .addTo(layer);
      }
    }
    const w = openLondonTelemetry?.weather;
    if (overlays.has('weather') && w) {
      // A single reading, so it shows at every zoom.
      L.marker(WEATHER_SAMPLE_POINT, { icon: dot('cloud-sun', 'tm-amenity tm-always'), title: 'Weather' })
        .bindTooltip(
          tip(`${w.temperature_c.toFixed(1)}°C`, w.condition_summary, [`Precipitation: ${w.precipitation_mm}mm`, `Wind: ${w.wind_speed_kmh.toFixed(0)}km/h`]),
          tipOpts
        )
        .addTo(layer);
    }
  }, [ready, showAmenities, civicNodes, tflOn, tflPlaces, overlays, openLondonTelemetry]);

  // The layer toggles live in the URL too.
  useEffect(() => {
    setParams({
      venues: showAllVenues ? null : '0',
      amenities: showAmenities ? null : '0',
      layers: OVERLAYS.filter((o) => overlays.has(o)).join(',') || null,
    });
  }, [showAllVenues, showAmenities, overlays]);
  // Hiding the map takes its view out of the address bar.
  useEffect(() => () => setParams({ location: null, zoom: null, pin: null, venues: null, amenities: null, layers: null }), []);

  // Refit when filters change (not while the list is following the map view, or it would chase itself).
  const lastFit = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (lastFit.current === fitKey) return;
    const first = lastFit.current === '';
    lastFit.current = fitKey;
    if (syncRef.current && !first) return;
    // A view (or open pin) from the URL wins over fitting to the results on load.
    if (first && (initial.location || initial.pin)) return;
    if (!groups.length) return;
    const b = L.latLngBounds(groups.map((g) => [g.venue.lat, g.venue.lng] as [number, number]));
    if (groups.length === 1) map.flyTo(b.getCenter(), 16, { duration: 0.6 });
    else map.flyToBounds(b.pad(0.12), { maxZoom: 15, duration: 0.6 });
  }, [ready, fitKey, groups]);

  // Report the current view when sync is switched on/off.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!syncView) return boundsCb.current(null);
    const b = map.getBounds();
    boundsCb.current({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
  }, [ready, syncView]);

  // "Show on map" from the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const v = venueFor(focus.venueId);
    if (!v) return;
    hostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Fly in past the clustering zoom, then look the marker up afresh: the markers may be rebuilt on the way.
    map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.5 });
    map.once('moveend', () => {
      // A venue the filters hide still gets a popup, with everything coming up at it.
      const popup = markersRef.current.get(v.id)?.getPopup() ?? venuePopup(v, upcomingAt(v), undefined, false);
      popup.setLatLng([v.lat, v.lng]).openOn(map);
    });
  }, [ready, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize after switching height.
  useEffect(() => { mapRef.current?.invalidateSize(); }, [tall, ready]);

  const locate = () => {
    setLocError('');
    if (!navigator.geolocation) return setLocError('Location is not available in this browser.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here: [number, number] = [p.coords.latitude, p.coords.longitude];
        setUser(here);
        const layer = userRef.current!;
        layer.clearLayers();
        L.circle(here, { radius: p.coords.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08 }).addTo(layer);
        L.circleMarker(here, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('You are here').addTo(layer);
        mapRef.current?.flyTo(here, 14, { duration: 0.6 });
      },
      () => setLocError('Could not get your location (permission denied?).'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const fit = () => {
    const map = mapRef.current;
    if (!map || !groups.length) return;
    map.flyToBounds(L.latLngBounds(groups.map((g) => [g.venue.lat, g.venue.lng] as [number, number])).pad(0.12), { maxZoom: 15, duration: 0.6 });
  };

  // Legend numbers: venues and performances per category among the plotted results.
  const legend = useMemo(() => {
    const venueSets: Record<string, Set<string>> = {};
    const perfs: Record<string, number> = {};
    for (const g of groups) for (const e of g.events) {
      (venueSets[e.category] ??= new Set()).add(g.venue.id);
      perfs[e.category] = (perfs[e.category] ?? 0) + 1;
    }
    return TIMETABLE_CATEGORIES.map((c) => ({ ...c, venues: venueSets[c.id]?.size ?? 0, perfs: perfs[c.id] ?? 0 }));
  }, [groups]);

  const btn = (on: boolean): React.CSSProperties =>
    on ? { backgroundColor: 'var(--accent-crimson)', color: '#FAF6F0', borderColor: 'var(--accent-crimson)' } : { backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)', borderColor: 'var(--border-hairline)' };
  const btnCls = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono cursor-pointer';

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)' }}
      aria-label="Map of venues"
    >
      {openLondonTelemetry && <LondonTelemetryStrip telemetry={openLondonTelemetry} className="p-2.5 sm:p-3 border-b" />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5 sm:p-3 border-b" style={{ borderColor: 'var(--border-hairline)' }}>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] font-semibold" style={{ color: 'var(--accent-crimson)' }}>
          Map · {groups.length} venue{groups.length === 1 ? '' : 's'}
          {emptyGroups.length > 0 && <span style={{ color: 'var(--text-muted)' }}> + {emptyGroups.length} with nothing listed</span>}
        </span>

        <div className="inline-flex items-center gap-1 ml-auto flex-wrap" role="group" aria-label="Map options">
          <MapPopover label="Layers" Icon={Layers} btnCls={btnCls} btnStyle={btn(false)} title="Choose what is pinned on the map">
            <div className="flex flex-col gap-1.5 items-stretch" role="group" aria-label="Map layers">
              <button type="button" aria-pressed={showAllVenues} onClick={() => setShowAllVenues((v) => !v)} className={btnCls} style={btn(showAllVenues)}
                title="Also pin opera houses, theatres and venues with nothing in the results (hidden while a category, venue, source or text filter is on)">
                <Landmark className="w-3.5 h-3.5" aria-hidden /> All venues
              </button>
              <button type="button" aria-pressed={showAmenities} onClick={() => setShowAmenities((v) => !v)} className={btnCls} style={btn(showAmenities)} title="Drinking fountains, public toilets, weather stations and more">
                <Droplets className="w-3.5 h-3.5" aria-hidden /> Fountains, toilets &amp; more
              </button>
              {OVERLAY_BUTTONS.map(({ id, label, Icon }) => (
                <button key={id} type="button" aria-pressed={overlays.has(id)} className={btnCls} style={btn(overlays.has(id))}
                  onClick={() => setOverlays((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}>
                  <Icon className="w-3.5 h-3.5" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </MapPopover>
          <MapPopover label="Settings" Icon={Settings2} btnCls={btnCls} btnStyle={btn(false)} title="Map style and behaviour">
            <div className="flex flex-col gap-1.5 items-stretch" role="group" aria-label="Map settings">
              <label className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Map style
                <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" aria-label="Map style"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}>
                  {BASE_LAYERS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </label>
              <button type="button" aria-pressed={clustered} onClick={() => setClustered((c) => !c)} className={btnCls} style={btn(clustered)} title="Group nearby venues into one marker">
                Cluster
              </button>
              <button type="button" aria-pressed={syncView} onClick={() => setSyncView(!syncView)} className={btnCls} style={btn(syncView)} title="Only list performances at venues visible on the map">
                <ScanSearch className="w-3.5 h-3.5" aria-hidden /> List follows map
              </button>
            </div>
          </MapPopover>
          <button type="button" onClick={fit} className={btnCls} style={btn(false)} title="Zoom to all results"><Shrink className="w-3.5 h-3.5" aria-hidden /> Fit</button>
          <button type="button" onClick={locate} className={btnCls} style={btn(!!user)} title="Show my location and distances"><Crosshair className="w-3.5 h-3.5" aria-hidden /> Near me</button>
          {onRefreshTelemetry && (
            <button type="button" onClick={onRefreshTelemetry} disabled={refreshingTelemetry} className={`${btnCls} disabled:opacity-50 disabled:cursor-wait`} style={btn(false)} title="Refresh weather, air quality and TfL status">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingTelemetry ? 'animate-spin' : ''}`} aria-hidden /> Refresh
            </button>
          )}
          <button type="button" onClick={() => setTall((t) => !t)} className={btnCls} style={btn(false)} aria-label={tall ? 'Shrink map' : 'Enlarge map'}>
            {tall ? <Minimize2 className="w-3.5 h-3.5" aria-hidden /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden />}
          </button>
        </div>
      </div>

      <div className="relative">
        <div ref={hostRef} className="w-full" style={{ height: tall ? 'min(78vh, 760px)' : 'clamp(320px, 52vh, 480px)', backgroundColor: 'var(--bg-surface)' }} />
        {!ready && <div className="absolute inset-0 grid place-items-center text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Loading map…</div>}
        {ready && zoom < VENUE_MIN_ZOOM && (showAmenities || emptyGroups.length > 0 || TFL_LAYERS.some((t) => tflOn[t.type])) && (
          <div className="absolute left-1/2 -translate-x-1/2 top-2 z-[900] w-max max-w-[calc(100%-5rem)] text-center rounded-lg px-3 py-1.5 text-xs font-mono pointer-events-none shadow-md"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}>
            Zoom in to see {[
              ...(emptyGroups.length ? [`${emptyGroups.length} venues with nothing listed`] : []),
              ...TFL_LAYERS.filter((t) => tflOn[t.type]).map((t) => t.label.toLowerCase()),
              ...(showAmenities ? ['fountains, toilets & more'] : []),
            ].join(', ')}
          </div>
        )}
        {ready && groups.length === 0 && emptyGroups.length === 0 && (
          <div className="absolute inset-0 z-[500] grid place-items-center pointer-events-none">
            <p className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}>
              No venues match these filters.
            </p>
          </div>
        )}

        <details className="tm-legend absolute left-2 bottom-7 z-[1000] max-w-[min(17rem,calc(100%-1rem))] rounded-lg border text-xs shadow-md" open={typeof window !== 'undefined' && window.innerWidth >= 768}
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-surface) 94%, transparent)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}>
          <summary className="cursor-pointer px-2.5 py-1.5 font-mono font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--accent-crimson)' }}>Legend · click to filter</summary>
          <ul className="px-1.5 pb-1.5 space-y-0.5">
            {legend.map((c) => {
              const on = active.size === 0 || active.has(c.id);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => toggleCategory(c.id)} aria-pressed={active.has(c.id)}
                    className="w-full flex items-center gap-2 rounded px-1.5 py-1 text-left cursor-pointer" style={{ opacity: on ? 1 : 0.45 }}>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }} title={`${c.venues} venues · ${c.perfs} performances`}>{c.venues}v · {c.perfs}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t px-2.5 py-1.5 space-y-1" style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}>
            <div className="flex items-center gap-2">
              <span className="inline-block w-5 h-5 rounded-full shrink-0" style={{ background: 'conic-gradient(var(--cat-opera) 0 40%, var(--cat-classical) 40% 70%, var(--cat-drama) 70% 100%)', mask: 'radial-gradient(circle, transparent 38%, #000 40%)', WebkitMask: 'radial-gradient(circle, transparent 38%, #000 40%)' }} />
              Ring = mix of categories; number = performances; bigger = more.
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-dashed shrink-0" style={{ borderColor: 'var(--accent-crimson)' }} />
              Dashed = venue you filtered to, or the current libretto’s house.
            </div>
            {emptyGroups.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 rounded-full border-[3px] shrink-0 opacity-70" style={{ borderColor: 'var(--text-muted)' }} />
                Grey = nothing in the results (its popup lists all upcoming).
              </div>
            )}
            {user && <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#2563eb' }} />Your location</div>}
          </div>
          {active.size > 0 && (
            <button type="button" onClick={resetCategories} className="w-full border-t px-2.5 py-1.5 text-left underline underline-offset-2 cursor-pointer" style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}>
              Show all categories
            </button>
          )}
        </details>
      </div>

      <div className="px-3 py-1.5 text-[11px] flex flex-wrap gap-x-3" style={{ color: 'var(--text-muted)' }}>
        <span>Hover a marker for a preview, click for the programme. Venue positions come from OpenStreetMap geocoding.</span>
        {unplotted > 0 && <span>{unplotted} performance{unplotted === 1 ? '' : 's'} at venues without coordinates aren’t on the map.</span>}
        {locError && <span style={{ color: 'var(--accent-crimson)' }}>{locError}</span>}
      </div>
    </section>
  );
};

export default TimetableMap;
