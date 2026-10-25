// Roundhouse: /whats-on/ is server-rendered with ?/page/N/ pagination (9 cards per page). Cards for the Autumn Term
// youth programme / drop-ins / cancelled / moved events are skipped; for every other card we read the event page,
// which carries one schema.org Event node (JSON-LD) per performance with an exact startDate (local offset) and lowPrice.
// (/wp-json/ is disallowed by robots.txt so it is not used.)
import { fetchDoc, jsonLd, clean, makeEvent, parseTime } from '../lib.mjs';

export const venue = {
  id: 'roundhouse',
  name: 'Roundhouse',
  kind: 'concert',
  address: 'Chalk Farm Road, London NW1 8EH',
  lat: 51.5433,
  lng: -0.1523,
  site: 'https://www.roundhouse.org.uk/whats-on/',
};

const BASE = 'https://www.roundhouse.org.uk/whats-on/';
const SKIP_TITLE = /\b(drop.?in|workshop|masterclass|studio 101|financial literacy|how to use|ideas lab|screen talks|self made|club|networking|exhibition|open mic|comedy|stand.?up|quiz|tour of)\b/i;
const SKIP_NOTE = /cancel|rescheduled|will now take place|postponed|no need to book/i;

export async function scrape() {
  const cards = [];
  for (let p = 1; p <= 20; p++) {
    let $;
    try { $ = await fetchDoc(p === 1 ? BASE : `${BASE}page/${p}/`); } catch (e) { if (p === 1) throw e; break; }
    const found = $('.event-card');
    if (!found.length) { if (p === 1) throw new Error('roundhouse: no event cards'); break; }
    found.each((_, c) => {
      const url = $(c).find('a.event-card__link').attr('href');
      if (!url) return;
      cards.push({
        url,
        title: clean($(c).find('.event-card__title').text()),
        subtitle: clean($(c).find('.event-card__subtitle').text()),
        season: clean($(c).find('.event-card__season-label').text()),
        note: clean($(c).find('.event-card__additional').text()),
      });
    });
    if (!$('.infinite-list__pagination a.next').length) break;
  }

  const out = [];
  const now = Date.now() - 6 * 3600e3;
  const seen = new Set();
  for (const c of cards) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    if (/autumn term|spring term|summer term/i.test(c.season) || SKIP_TITLE.test(c.title) || SKIP_NOTE.test(c.note)) continue;
    let $;
    try { $ = await fetchDoc(c.url); } catch { continue; }
    const events = jsonLd($).filter((n) => n['@type'] === 'Event' && /EventScheduled/.test(n.eventStatus ?? 'EventScheduled'));
    if (!events.length) continue;
    const hall = clean($('.listing-content__venue').first().text()).replace(/^Roundhouse\s+/i, '');
    const blurb = clean($('.text-with-title__text-wrapper p').first().text());
    const pageTitle = clean($('title').text());
    const rising = /rising/i.test(c.season);
    // Main Space (and anything outside the studios) is gigs/club nights => live_music. Rising showcases in the studios
    // are theatre/physical-theatre/performance pieces (subtitle "by <artist>" or theatre-ish copy) unless the copy says music.
    const studio = rising || /studio|bar & cafe/i.test(hall);
    const text = `${c.title} ${c.subtitle} ${blurb}`;
    let category = 'live_music';
    if (studio) {
      if (/\b(podcast|poetry collection)\b/i.test(text) || /^rising poetry/i.test(c.subtitle) || /^rising poetry/i.test(blurb)) continue; // not a staged performance
      if (/\bdance\b|choreograph/i.test(text) && !/electronic|dj|selectors/i.test(text)) category = 'dance';
      else if (/bar & cafe/i.test(hall) || /^by /i.test(c.subtitle) || /theatre|play\b|showgirl|scratch night|immersive|performance/i.test(text)) category = /\b(ep|album|electronic|selectors|live music)\b/i.test(text) ? 'live_music' : 'drama';
    }
    const title = c.title;
    for (const e of events) {
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(e.startDate ?? '')) continue;
      if (Date.parse(e.startDate) < now) continue;
      const low = e.offers?.lowPrice;
      out.push(makeEvent(venue, {
        title, category, start: e.startDate, hall: hall || undefined, url: c.url,
        price: low ? `from £${Number(low).toFixed(Number(low) % 1 ? 2 : 0)}` : undefined,
        blurb: [c.subtitle, blurb].filter(Boolean).join(' – '),
      }));
    }
  }
  return out;
}
