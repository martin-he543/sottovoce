import { DISCOVER_VIEWS, type DiscoverView } from '../components/DiscoverShell';

/**
 * Hard URLs for every page, so a refresh (or a shared link) lands on the exact same view:
 *
 *   /libretto                      Libretto            ?work=<id>&line=<n>  (live libretto)
 *                                                      ?view=repertoire&rep=<wikidata id>  (repertoire browser)
 *   /immerse                       Immerse             ?work=<id>&line=<n>
 *   /discover/events            Events              ?category=opera,dance&range=month&group=venue&order=price_asc&pmin=10&pmax=60&unpriced=0&venue=<id>&q=<text>&exact=1&kind=&source=&map=0
 *                                  + its map           &location=<lat>,<lng>&zoom=<z>&pin=<map venue id>&venues=0&amenities=0&layers=bike,carpark,taxi,weather
 *   /discover/journey              Journey Planner     ?station=<code>&jploc=<lat>,<lng>&jpzoom=<z>&jpvenue=<id>&jpvenues=0&jpamenities=0
 *   /discover/seating              Seating             ?plan=<seat plan id>&seat=<tier>|<row>|<number>
 *   /discover/taste                Taste
 *   /discover/agent                Saint agent & Atlas search
 *   /event/<event id>              One performance: details, booking, venue map & directions, other dates
 *   /venue/<venue id>              One venue (Timetable or map venue id): map & directions, everything coming up
 *   /me/likes | /me/history | /me/activity   Your liked events (with CSV export), recent searches and views, and both on one timeline
 */

export type NavTab = 'companion' | 'discover' | 'immerse';

/** A standalone page for one event or venue, or one of your own pages (likes, history, activity), shown inside Discover. */
export interface DetailPage {
  kind: 'event' | 'venue' | 'me';
  id: string;
}

export type MeSection = 'likes' | 'history' | 'activity';
export const ME_SECTIONS: MeSection[] = ['likes', 'history', 'activity'];
export const mePath = (section: MeSection) => `/me/${section}`;

export interface Route {
  tab: NavTab;
  view: DiscoverView;
  page?: DetailPage;
}

export const DEFAULT_DISCOVER_VIEW: DiscoverView = 'events';

const DISCOVER_VIEW_IDS = new Set<string>(DISCOVER_VIEWS.map((v) => v.id));

/** Pathname → route. Unknown paths fall back to the Libretto. */
export function routeFromPath(pathname: string): Route {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second] = segments.map((s) => s.toLowerCase());
  // Ids keep their case, so only the section names are lowercased.
  if ((first === 'event' || first === 'venue') && segments[1]) {
    let id = segments[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* malformed escape: use it as written */
    }
    return { tab: 'discover', view: DEFAULT_DISCOVER_VIEW, page: { kind: first, id } };
  }
  if (first === 'me') {
    const id = ME_SECTIONS.includes(second as MeSection) ? second : 'likes';
    return { tab: 'discover', view: DEFAULT_DISCOVER_VIEW, page: { kind: 'me', id } };
  }
  if (first === 'immerse') return { tab: 'immerse', view: DEFAULT_DISCOVER_VIEW };
  if (first === 'discover') {
    return { tab: 'discover', view: second && DISCOVER_VIEW_IDS.has(second) ? (second as DiscoverView) : DEFAULT_DISCOVER_VIEW };
  }
  return { tab: 'companion', view: DEFAULT_DISCOVER_VIEW };
}

export const eventPath = (id: string) => `/event/${encodeURIComponent(id)}`;
export const venuePath = (id: string) => `/venue/${encodeURIComponent(id)}`;

export function pathFor({ tab, view, page }: Route): string {
  if (page) return page.kind === 'event' ? eventPath(page.id) : page.kind === 'me' ? mePath(page.id as MeSection) : venuePath(page.id);
  if (tab === 'immerse') return '/immerse';
  if (tab === 'discover') return `/discover/${view}`;
  return '/libretto';
}

/** Whether the route shows the selected work / libretto line, and so carries `work` and `line` in the URL. */
export const routeUsesWork = ({ tab }: Route) => tab === 'companion' || tab === 'immerse';

export const readParams = () => new URLSearchParams(window.location.search);

// Commas and colons are fine in a query string; leaving them readable keeps ?location=51.51,-0.12 shareable by eye.
const serialize = (params: URLSearchParams) => params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');

const withQuery = (path: string, params: URLSearchParams) => {
  const qs = serialize(params);
  return qs ? `${path}?${qs}` : path;
};

/** Add, change or (with null / '') remove query params on the current entry without adding history. */
export function setParams(patch: Record<string, string | null | undefined>) {
  const params = readParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  const next = withQuery(window.location.pathname, params) + window.location.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/** Push a new history entry for a page change. Page-specific query params are dropped; the page re-adds its own. */
export function navigateTo(route: Route) {
  const next = pathFor(route);
  if (window.location.pathname === next && !window.location.search) return;
  window.history.pushState(null, '', next);
}

/** Open an in-app path (a standalone event / venue page) as a new history entry; the app follows it like Back / Forward. */
export function openPage(path: string) {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

/**
 * Make `<a href="/event/…" data-route>` links navigate inside the app (keeping real hrefs for open-in-new-tab, copy link
 * and crawlers). Listens in the capture phase because Leaflet stops clicks bubbling out of popups; also used on the
 * Journey Planner's iframe document.
 */
export function routeLinkClicks(doc: Document) {
  const onClick = (ev: MouseEvent) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = (ev.target as Element | null)?.closest?.('a[data-route]') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href');
    if (!a || !href || (a.target && a.target !== '_self')) return;
    ev.preventDefault();
    openPage(href);
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

/**
 * Middle-click (open in a new tab) for in-app controls that aren't real links, e.g. the nav buttons: give the element a
 * `data-href` and middle-clicking opens that URL in a new tab. Real `<a href>` links already get this from the browser.
 * Also stops the middle-button autoscroll cursor starting on such an element.
 */
export function middleClickLinks(doc: Document) {
  const find = (ev: MouseEvent) => {
    const el = (ev.target as Element | null)?.closest?.('[data-href]') as HTMLElement | null;
    return el && !el.matches(':disabled') ? el : null;
  };
  const onDown = (ev: MouseEvent) => {
    if (ev.button === 1 && find(ev)) ev.preventDefault();
  };
  const onAux = (ev: MouseEvent) => {
    if (ev.button !== 1) return;
    const href = find(ev)?.dataset.href;
    if (!href) return;
    ev.preventDefault();
    // window.open would focus the new tab. A modifier-click on a throwaway anchor is what the browser treats as
    // "open in background tab" (ctrl on Windows / Linux, cmd on Mac), the same as middle-clicking a real link.
    const a = doc.createElement('a');
    a.href = href;
    a.rel = 'noopener';
    // Firefox only follows anchors that are in the document.
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.dispatchEvent(new MouseEvent('click', { ctrlKey: true, metaKey: true, bubbles: false, cancelable: true, view: window }));
    a.remove();
  };
  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('auxclick', onAux, true);
  return () => {
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('auxclick', onAux, true);
  };
}

/** URL of the Immerse page following `target` (the inverse of how App reads ?work= / ?rep= / ?show= / ?at=). */
export function immersePath(target: { kind: 'libretto'; id: string } | { kind: 'rep'; id: string; venue?: string } | { kind: 'show'; title: string; venue?: string } | null): string {
  const params = new URLSearchParams();
  if (target?.kind === 'libretto') params.set('work', target.id);
  else if (target?.kind === 'rep') params.set('rep', target.id);
  else if (target?.kind === 'show') params.set('show', target.title);
  if (target && target.kind !== 'libretto' && target.venue) params.set('at', target.venue);
  return withQuery('/immerse', params);
}

/** The Journey Planner's own query params (prefixed so they don't clash with the Events map's). */
const PLANNER_PARAMS = ['station', 'jploc', 'jpzoom', 'jpvenue', 'jpvenues', 'jpamenities'];

/**
 * Old links to the Journey Planner. The legacy Map page (/discover/map, unprefixed ?location=&zoom=&venue=&venues=&amenities=)
 * and Events (formerly Timetable, /discover/timetable) while it hosted the planner (/discover/events?station=&jp…=) both now open /discover/journey.
 * Call before anything reads the URL.
 */
export function migrateLegacyMapUrl() {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const params = readParams();
  if (path === '/discover/map') {
    const renamed: Record<string, string> = { location: 'jploc', zoom: 'jpzoom', venue: 'jpvenue', venues: 'jpvenues', amenities: 'jpamenities' };
    const next = new URLSearchParams();
    params.forEach((value, key) => next.set(renamed[key] ?? key, value));
    window.history.replaceState(window.history.state, '', withQuery('/discover/journey', next) + window.location.hash);
  } else if (path === '/discover/timetable') {
    // The Timetable tab is now Events: old links keep their filters, and planner params still go to the Journey Planner.
    const planner = PLANNER_PARAMS.some((k) => params.has(k));
    const next = new URLSearchParams();
    params.forEach((value, key) => {
      if (planner === PLANNER_PARAMS.includes(key)) next.set(key, value);
    });
    window.history.replaceState(window.history.state, '', withQuery(planner ? '/discover/journey' : '/discover/events', next) + window.location.hash);
  } else if (path === '/discover/events' && PLANNER_PARAMS.some((k) => params.has(k))) {
    const next = new URLSearchParams();
    for (const k of PLANNER_PARAMS) if (params.has(k)) next.set(k, params.get(k)!);
    window.history.replaceState(window.history.state, '', withQuery('/discover/journey', next) + window.location.hash);
  }
}

/** Rewrite `/`, `/discover` and other aliases to the canonical path, keeping the query and hash. */
export function canonicalizeUrl() {
  const canonical = pathFor(routeFromPath(window.location.pathname));
  if (window.location.pathname !== canonical) {
    window.history.replaceState(window.history.state, '', canonical + window.location.search + window.location.hash);
  }
}

/** `lat,lng` → coordinates, or null if it isn't a plausible pair. */
export function parseLocation(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const [lat, lng] = raw.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Five decimals is about a metre; trailing zeros are dropped. */
export const formatLocation = (lat: number, lng: number) => `${+lat.toFixed(5)},${+lng.toFixed(5)}`;

/** Positive integer from a query value, else the fallback. */
export function parseCount(raw: string | null, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
