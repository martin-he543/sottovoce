// Cadogan Hall (Sloane Terrace, Chelsea). /whats-on/?results=all lists every event; each event page has a
// "Performances" list with machine-readable start times (add-to-calendar blocks, Europe/London).
import { fetchDoc, clean, abs, londonISO, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

export const venue = {
  id: 'cadogan',
  name: 'Cadogan Hall',
  kind: 'concert',
  address: '5 Sloane Terrace, London SW1X 9DQ',
  lat: 51.4934,
  lng: -0.1587,
  site: 'https://cadoganhall.com/whats-on/',
};

const SKIP = /\b(comedy|comedian|an audience with|in conversation|a life of two halves|my royal life|talking b|talking gib|filthy|electoral dysfunction|life behind the lens|embrace the chaos|looking for trouble|leaders and lunatics|exclusive evening with|film screening|zog and the flying|rat pack)\b/i;
const JAZZ = /\b(jazz|big band|swing|glenn miller|benny goodman|nyjo|cotton club|clare teal|trio|gospel)\b/i;
const CLASSICAL = /\b(sixteen|tallis|voces8|carols?|choir|choral|mozartists|firebird|salomon|bach|messiah|elijah|oratorio|stabat|polyphony|violin|cello|piano|symphon\w*|philharmonic|orchestra|beethoven|chamber|requiem|fanfare|academy of st martin|dona nobis)\b/i;
const OPERA = /\b(opera|don carlo|madama butterfly|hamlet|verdi|puccini)\b/i;

function categorise(title, sub) {
  const t = `${title} ${sub}`;
  if (JAZZ.test(t)) return 'live_music';
  if (/\b(candlelight|snowman|ballet nights)\b/i.test(t)) return 'classical';
  if (OPERA.test(t) && !/\bsong of\b/i.test(t)) return 'opera';
  if (CLASSICAL.test(t)) return 'classical';
  return guessCategory(t, 'live_music');
}

export async function scrape() {
  const $ = await fetchDoc('https://cadoganhall.com/whats-on/?results=all');
  const items = $('.c-event-item');
  if (!items.length) throw new Error('Cadogan: listing structure changed');
  const seen = new Map();
  items.each((_, el) => {
    const e = $(el);
    const url = e.find('a.c-event-item__link-wrap, a[data-button="more-info"]').first().attr('href');
    if (!url || seen.has(url)) return;
    seen.set(url, {
      title: clean(e.find('.c-event-item__heading').first().text()),
      sub: clean(e.find('.c-event-item__subheading').first().text()),
      blurb: clean(e.find('.c-event-item__excerpt').first().text()).replace(/\.\.\.$/, '…'),
    });
  });

  const out = [];
  for (const [url, m] of seen) {
    if (!m.title || SKIP.test(`${m.title} ${m.sub}`)) continue;
    if (/opera holland park/i.test(m.sub)) continue; // covered by the ohp adapter
    let p;
    try { p = await fetchDoc(url); } catch { continue; }
    const prices = [];
    const priceText = clean(p('.ticket-panel__info').first().text()).split(/All prices|Ticket Information/i).filter((x) => /£/.test(x))[0] ?? '';
    for (const mm of priceText.matchAll(/£\s?(\d+(?:\.\d+)?)/g)) prices.push(+mm[1]);
    const category = categorise(m.title, m.sub);
    const title = m.sub && !/^(plus|\+|with|support|&|featuring|in aid|film screening)/i.test(m.sub) && m.title.length < 30 && /orchestra|choir|sixteen|philharmonic|tallis|voces8/i.test(m.title) ? `${m.title}: ${m.sub}` : m.title;
    const starts = new Set(p('.atc_date_start').map((_, x) => p(x).text().trim()).get());
    for (const raw of starts) {
      const mt = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
      if (!mt) continue;
      const [y, mo, d, hh, mm] = mt.slice(1).map(Number);
      out.push(makeEvent(venue, {
        title,
        category,
        start: londonISO(y, mo, d, hh, mm),
        url,
        price: prices.length ? `from £${Math.min(...prices)}` : undefined,
        blurb: [m.sub && title === m.sub ? '' : (title === m.title ? m.sub : ''), m.blurb].filter(Boolean).join(' – '),
      }));
    }
  }
  return out;
}
