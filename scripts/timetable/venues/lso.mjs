// London Symphony Orchestra: /whats-on/ is paginated (/page/N/) with one card per performance
// ("Sunday 25 October 2026 • 7pm", venue in the image caption). The LSO plays at the Barbican and LSO St Luke's,
// plus occasional guest dates (e.g. Royal Albert Hall). Dates abroad / on tour are skipped.
// Barbican dates are NOT emitted here: barbican.mjs already lists every LSO concert there (same start times, different titles).
import { fetchDoc, clean, abs, londonISO, parseTime, monthNum, makeEvent } from '../lib.mjs';

const stLukes = {
  id: 'lso-st-lukes',
  name: "LSO St Luke's",
  kind: 'concert',
  address: '161 Old Street, London EC1V 9NG',
  lat: 51.5257,
  lng: -0.0919,
  site: 'https://www.lso.co.uk/whats-on/',
};
const rah = {
  id: 'rah',
  name: 'Royal Albert Hall',
  kind: 'concert',
  address: 'Kensington Gore, London SW7 2AP',
  lat: 51.501,
  lng: -0.1774,
  site: 'https://www.royalalberthall.com/',
};
export const venues = [stLukes, rah];
const BY_NAME = [[/st luke/i, stLukes, undefined], [/royal albert hall/i, rah, undefined]];
const SKIP = /\b(under-5s|workshops?|masterclass|scheme|talk|lecture series|discovery day|family)\b/i;

export async function scrape() {
  const out = [];
  const seen = new Set();
  let first = true;
  for (let page = 1; page <= 14; page++) {
    const url = page === 1 ? 'https://www.lso.co.uk/whats-on/' : `https://www.lso.co.uk/whats-on/page/${page}/`;
    let $;
    try { $ = await fetchDoc(url); } catch (e) { if (first) throw e; break; }
    const cards = $('.c-event-card');
    if (!cards.length) { if (first) throw new Error('LSO: card structure changed'); break; }
    first = false;
    let fresh = 0;
    cards.each((_, el) => {
      const c = $(el);
      const title = clean(c.find('.c-event-card__title').first().text());
      const sub = clean(c.find('.c-event-card__subtitle').first().text());
      const where = clean(c.find('.c-col-image__caption').first().text());
      const dateText = clean(c.find('.c-event-card__date').first().text());
      const key = `${title}|${dateText}|${where}`;
      if (seen.has(key)) return;
      seen.add(key);
      fresh++;
      const hit = BY_NAME.find(([re]) => re.test(where));
      if (!hit || !title || SKIP.test(`${title} ${sub}`)) return;
      const m = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*[•·]\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm))\s*$/i);
      if (!m) return; // multi-day / multi-time / no time
      const t = parseTime(m[4]);
      const mo = monthNum(m[2]);
      if (!t || !mo) return;
      const learn = c.find('a.c-btn--more').attr('href') || c.find('a.c-btn--book').attr('href');
      const text = `${title} ${sub}`;
      const category = /\b(jazz|folk|qawwali|world music|pop|rock|electronic|film music|video game|zelda)\b/i.test(text) ? 'live_music'
        : /\b(opera|operatic)\b/i.test(text) ? 'opera' : 'classical';
      out.push(makeEvent(hit[1], {
        title,
        category,
        start: londonISO(+m[3], mo, +m[1], t[0], t[1]),
        hall: hit[2],
        url: learn ? abs(learn, url) : undefined,
        blurb: [sub, clean(c.find('.c-event-card__excerpt').first().text())].filter(Boolean).join(' – '),
        venue_name: `${hit[1].name}`,
      }));
    });
    if (!fresh) break;
  }
  return out;
}
