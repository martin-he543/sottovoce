import {
  CATEGORY_BY_ID,
  TIMETABLE_CATEGORIES,
  VENUE_KINDS,
  type TimetableCategory,
  type TimetableEvent,
  type TimetableVenue,
} from '../data/timetableCategories';
import { shortDate, timeLabel } from './timetableFormat';
import { haversineDistanceMeters } from './sottovoceEngine';
import { eventPath, venuePath } from './urlState';

/** HTML-string builders for Leaflet markers, tooltips and popups, shared by the Timetable map and the Journey Planner embed. */

export type CategoryCounts = Partial<Record<TimetableCategory, number>>;

export const esc = (s: string | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? esc(u) : '');

export const catCounts = (events: TimetableEvent[]) => {
  const c: Partial<Record<TimetableCategory, number>> = {};
  for (const e of events) c[e.category] = (c[e.category] ?? 0) + 1;
  return c;
};
export const dominant = (c: Partial<Record<TimetableCategory, number>>) =>
  (Object.entries(c) as [TimetableCategory, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'classical';

let bubbleSeq = 0;
const mix = (c: string, other: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, ${other})`;

/** An iridescent glass bubble whose ring segments are the category mix (percentages in the tooltips, and printed on the big segments); the serif number in the pearl centre is the event count. */
export function donut(c: Partial<Record<TimetableCategory, number>>, total: number, size: number, opts: { selected?: boolean; cluster?: boolean } = {}) {
  const id = `bb${++bubbleSeq}`;
  const r = size / 2;
  const ring = Math.max(6, Math.round(size * 0.23));
  const rad = r - ring / 2 - 1.5;
  const circ = 2 * Math.PI * rad;
  const cats = TIMETABLE_CATEGORIES.filter((k) => c[k.id]);
  const grads = cats
    .map(
      (k) =>
        `<linearGradient id="${id}-${k.id}" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" style="stop-color:${mix(k.color, '#fff', 72)}"/><stop offset=".45" style="stop-color:${k.color}"/><stop offset="1" style="stop-color:${mix(k.color, '#1a0a20', 62)}"/></linearGradient>`
    )
    .join('');
  const gap = cats.length > 1 ? Math.min(1.6, circ * 0.01) : 0;
  const showPct = size >= 46;
  let offset = 0;
  const segs = cats
    .map((k) => {
      const share = c[k.id]! / total;
      const len = share * circ;
      const pct = Math.round(share * 100);
      const seg = `<circle r="${rad}" cx="${r}" cy="${r}" fill="none" stroke="url(#${id}-${k.id})" stroke-width="${ring}" stroke-dasharray="${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}" stroke-dashoffset="${-(offset + gap / 2)}" transform="rotate(-90 ${r} ${r})"><title>${k.label}: ${c[k.id]} (${pct}%)</title></circle>`;
      let txt = '';
      if (showPct && share >= 0.2) {
        const a = ((offset + len / 2) / circ) * 2 * Math.PI - Math.PI / 2;
        txt = `<text x="${(r + rad * Math.cos(a)).toFixed(1)}" y="${(r + rad * Math.sin(a)).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, monospace" font-weight="700" font-size="${Math.max(6, Math.round(ring * 0.62))}" fill="#fff" stroke="rgba(20,5,30,.55)" stroke-width="1.6" paint-order="stroke" pointer-events="none">${pct}%</text>`;
      }
      offset += len;
      return seg + txt;
    })
    .join('');
  const empty = total ? '' : `<circle r="${rad}" cx="${r}" cy="${r}" fill="none" stroke="#9a9aa4" stroke-opacity=".55" stroke-width="${ring}"/>`;
  const label = total > 999 ? `${Math.round(total / 100) / 10}k` : String(total);
  const ir = r - ring - 1.5; // radius of the pearl centre
  const d = ir * 2;
  const fs = Math.round(Math.min(d * 0.82, (d * 2.0) / Math.max(label.length, 2)));
  const halo = opts.selected
    ? `<circle r="${r - 0.5}" cx="${r}" cy="${r}" fill="none" stroke="var(--accent-crimson)" stroke-width="2.5" stroke-dasharray="4 3"/>`
    : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${total} events" style="overflow:visible">
    <defs>${grads}
      <radialGradient id="${id}-sph" cx=".35" cy=".28" r=".85"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#e9e3f3"/><stop offset="1" stop-color="#b9aed0"/></radialGradient>
      <linearGradient id="${id}-iri" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9" stop-opacity=".55"/><stop offset=".3" stop-color="#7af0ff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff59a" stop-opacity=".35"/><stop offset=".8" stop-color="#b48cff" stop-opacity=".5"/><stop offset="1" stop-color="#6affc8" stop-opacity=".4"/></linearGradient>
      <radialGradient id="${id}-pearl" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#fffefb"/><stop offset=".7" stop-color="#f6f0ea"/><stop offset="1" stop-color="#e2d8d4"/></radialGradient>
      <radialGradient id="${id}-spec" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".6"/></linearGradient>
      <radialGradient id="${id}-glow" cx=".5" cy="1" r=".6"><stop offset="0" stop-color="#8fe8ff" stop-opacity=".6"/><stop offset="1" stop-color="#8fe8ff" stop-opacity="0"/></radialGradient>
    </defs>
    <circle r="${r - 0.5}" cx="${r}" cy="${r}" fill="url(#${id}-sph)"/>
    ${empty}${segs}
    <circle r="${r - 0.5}" cx="${r}" cy="${r}" fill="url(#${id}-iri)" style="mix-blend-mode:soft-light"/>
    <circle r="${ir}" cx="${r}" cy="${r}" fill="url(#${id}-pearl)" stroke="rgba(60,30,50,.28)" stroke-width="1"/>
    <circle r="${r - 0.5}" cx="${r}" cy="${r}" fill="url(#${id}-glow)"/>
    <ellipse cx="${r - r * 0.32}" cy="${r - r * 0.62}" rx="${r * 0.46}" ry="${r * 0.2}" fill="url(#${id}-spec)" transform="rotate(-28 ${r - r * 0.32} ${r - r * 0.62})"/>
    <circle cx="${r + r * 0.5}" cy="${r + r * 0.6}" r="${Math.max(1.2, r * 0.07)}" fill="#fff" opacity=".7"/>
    <circle r="${r - 1}" cx="${r}" cy="${r}" fill="none" stroke="url(#${id}-rim)" stroke-width="1.3"/>
    <circle r="${r - 0.2}" cx="${r}" cy="${r}" fill="none" stroke="rgba(40,20,60,.35)" stroke-width=".6"/>
    ${halo}
    <text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" dy=".04em" font-family="'Instrument Serif', 'Fraunces', Georgia, serif" font-size="${fs}" fill="#22121a" stroke="#fffdf9" stroke-width="${Math.max(1, fs * 0.05).toFixed(1)}" paint-order="stroke" letter-spacing="-.01em">${label}</text>
  </svg>`;
}

export const sizeFor = (n: number) => Math.round(Math.min(66, 34 + Math.sqrt(n) * 4));

export const chips = (c: Partial<Record<TimetableCategory, number>>) =>
  TIMETABLE_CATEGORIES.filter((k) => c[k.id])
    .map(
      (k) =>
        `<span class="tm-chip" style="--c:${k.color}"><i></i>${esc(k.label.split(' ')[0])} <b>${c[k.id]}</b></span>`
    )
    .join('');

export const kmBetween = (a: [number, number], b: [number, number]) => haversineDistanceMeters(a[0], a[1], b[0], b[1]) / 1000;

export function tooltipHtml(v: TimetableVenue, evs: TimetableEvent[], dist?: number, image?: string) {
  const next = evs[0];
  const pic = safeUrl(image ?? evs.find((e) => e.image)?.image);
  const kind = VENUE_KINDS.find((k) => k.id === v.kind)?.label ?? '';
  return `<div class="tm-tip">
    ${pic ? `<div class="tm-tip-pic"><img src="${pic}" alt="" loading="lazy" referrerpolicy="no-referrer"/></div>` : ''}
    <div class="tm-tip-h"><strong>${esc(v.name)}</strong><span>${esc(kind)}${dist != null ? ` · ${dist < 10 ? dist.toFixed(1) : Math.round(dist)} km away` : ''}</span></div>
    <div class="tm-chips">${chips(catCounts(evs))}</div>
    ${next ? `<div class="tm-tip-n">Next: <b>${esc(shortDate(next))} ${esc(timeLabel(next))}</b> — ${esc(next.title)}</div>` : ''}
    <div class="tm-tip-f">${evs.length ? `${evs.length} performance${evs.length === 1 ? '' : 's'}` : 'Nothing listed'} · click for details</div>
  </div>`;
}

export interface PopupAction { act: string; label: string; id?: string }

/** `primary` is the crimson button: the Timetable map filters the list, the Journey Planner embed opens the venue in the Timetable. */
export function popupHtml(v: TimetableVenue, evs: TimetableEvent[], dist?: number, primary: PopupAction = { act: 'filter', label: 'Show only this venue' }, extra: { body?: string; actions?: string; image?: string } = {}) {
  const counts = catCounts(evs);
  const hero = evs.filter((e) => e.image).slice(0, 3).map((e) => e.image as string);
  // No poster among these performances: the venue's own picture.
  if (!hero.length && extra.image) hero.push(extra.image);
  const prices = evs.map((e) => e.price).filter(Boolean) as string[];
  const kind = VENUE_KINDS.find((k) => k.id === v.kind)?.label ?? '';
  const days = new Set(evs.map((e) => e.start.slice(0, 10))).size;
  const rows = evs.slice(0, 8)
    .map((e) => {
      const m = CATEGORY_BY_ID[e.category];
      // Each performance links to its own page (a data-route link is followed in-app, see routeLinkClicks).
      const title = `<a href="${esc(eventPath(e.id))}" data-route>${esc(e.title)}</a>`;
      return `<li style="--c:${m.color}">
        ${e.image ? `<img src="${safeUrl(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<span class="tm-noimg"></span>`}
        <div><div class="tm-ev-t">${title}</div>
        <div class="tm-ev-m"><b>${esc(shortDate(e))} · ${esc(timeLabel(e))}</b>${e.hall ? ` · ${esc(e.hall)}` : ''}${e.price ? ` · ${esc(e.price)}` : ''}</div>
        <div class="tm-ev-c"><i></i>${esc(m.label)}</div></div></li>`;
    })
    .join('');
  const more = evs.length > 8 ? `<div class="tm-more">+ ${evs.length - 8} more on the <a href="${esc(venuePath(v.id))}" data-route>venue page</a></div>` : '';
  const site = safeUrl(v.site);
  return `<div class="tm-pop">
    ${hero.length ? `<div class="tm-hero n${hero.length}">${hero.map((src) => `<img src="${safeUrl(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`).join('')}</div>` : ''}
    <div class="tm-pop-b">
      <div class="tm-kind">${esc(kind)}</div>
      <h4><a href="${esc(venuePath(v.id))}" data-route>${esc(v.name)}</a></h4>
      ${v.address ? `<div class="tm-addr">${esc(v.address)}</div>` : ''}
      <div class="tm-stats">${evs.length ? `<b>${evs.length}</b> performance${evs.length === 1 ? '' : 's'} over <b>${days}</b> day${days === 1 ? '' : 's'}` : 'No upcoming performances listed'}${dist != null ? ` · <b>${dist < 10 ? dist.toFixed(1) : Math.round(dist)} km</b> from you` : ''}${prices.length ? ` · ${esc(prices[0])}` : ''}</div>
      <div class="tm-chips">${chips(counts)}</div>
      <ul class="tm-evs">${rows}</ul>${more}${extra.body ?? ''}
      <div class="tm-acts">
        ${extra.actions ?? ''}
        ${primary.act ? `<button type="button" data-act="${esc(primary.act)}"${primary.id ? ` data-id="${esc(primary.id)}"` : ''}>${esc(primary.label)}</button>` : ''}
        <a href="${esc(venuePath(v.id))}" data-route>Venue page</a>
        <a href="https://www.openstreetmap.org/directions?to=${v.lat}%2C${v.lng}" target="_blank" rel="noreferrer noopener">Directions</a>
        <a href="https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lng}#map=18/${v.lat}/${v.lng}" target="_blank" rel="noreferrer noopener">Open in OSM</a>
        ${site && v.site && !/eventbrite/.test(v.site) ? `<a href="${site}" target="_blank" rel="noreferrer noopener">Venue site</a>` : ''}
      </div>
    </div></div>`;
}

