import type { TimetableEvent } from '../data/timetableCategories';
import type { RepertoireWork } from '../types/sottovoce';
import { eventDay } from './timetableFormat';

/**
 * Links the Discover timetable's London listings to the repertoire catalogue by title. A listing counts for a work when
 * its title (or the part of it after "Composer:" / before " - the musical" and similar) is that work's title, the
 * listing's category fits the kind of work, and, where several works share a title, the composer or kind picks one.
 */

/** Lower-case, accent-free, punctuation-free, without a leading article, so "The Magic Flute" ≈ "Magic Flute". */
export function normTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an|il|la|le|les|lo|l|die|der|das|el|los|las|i|gli|un|une|ein|eine)\s+(?=\S)/, '');
}

const NOISE =
  /\b(the (?:new )?(?:west end |broadway |hit |smash )?(?:musical|opera|operetta|show)|a (?:new )?musical|in concert|live in concert|(?:london|original|uk|west end) (?:cast|production)|(?:matinee|evening|preview)s?|tickets?)\b/g;

/** The titles a listing might be going by: the whole thing, after "Composer: ", before a dash or bracket, inside brackets. */
export function titleCandidates(title: string): { key: string; partial: boolean }[] {
  const out = new Map<string, boolean>();
  let partial = false;
  const add = (s: string) => {
    const n = normTitle(s.replace(NOISE, ' ').replace(/\s+/g, ' '));
    if (n.length >= 3 && !out.has(n)) out.set(n, partial);
  };
  const t = title.replace(/\s+/g, ' ').trim();
  add(t);
  const afterColon = t.includes(': ') ? t.slice(t.indexOf(': ') + 2) : '';
  if (afterColon) add(afterColon);
  partial = true;
  for (const piece of [t, afterColon]) {
    if (!piece) continue;
    const head = piece.split(/\s+[-–—|]\s+|\s*\(|\s*\[/)[0];
    if (head && head !== piece) add(head);
    for (const m of piece.matchAll(/[([]([^)\]]+)[)\]]/g)) add(m[1]);
    // "Gianni Schicchi & The Zoo", "Trial by Jury & The Zoo": a double bill names each work.
    // One-word halves ("Chopin & Champagne by Candlelight") are far more often a concert than a double bill.
    if (/\s(?:&|\+|and)\s/.test(head)) for (const p of head.split(/\s+(?:&|\+|and)\s+/)) if (p.includes(' ')) add(p);
  }
  return [...out].map(([key, partial]) => ({ key, partial }));
}

const OPERATIC = new Set(['opera', 'classical']);
// The timetable files some musicals and plays with music under "drama" ("Harry Potter and the Cursed Child"), so a drama
// listing counts for a musical when its whole title is the work's title, or when it calls itself a musical.
const fits = (w: RepertoireWork, e: TimetableEvent, partial: boolean) =>
  w.kind === 'musical'
    ? e.category === 'musical' ||
      (e.category === 'drama' && (!partial || /\bmusical\b/i.test(`${e.title} ${e.blurb ?? ''}`)))
    : OPERATIC.has(e.category);

const surname = (c: string) => normTitle(c.split(/\s+/).at(-1) ?? '');

export interface LondonPerformances {
  /** Matched listings per work id, earliest first (upcoming only). */
  byWork: Map<string, TimetableEvent[]>;
  count: (workId: string) => number;
}

/** `works` must be most popular first: it is the tie-break between works that share a title. */
export function matchPerformances(works: RepertoireWork[], events: TimetableEvent[], today: string): LondonPerformances {
  const byTitle = new Map<string, RepertoireWork[]>();
  for (const w of works) {
    const key = normTitle(w.title);
    if (key.length < 3) continue;
    const list = byTitle.get(key);
    if (list) list.push(w);
    else byTitle.set(key, [w]);
  }

  const byWork = new Map<string, TimetableEvent[]>();
  for (const e of events) {
    if (eventDay(e) < today) continue;
    const context = normTitle(`${e.title} ${e.blurb ?? ''}`);
    // "Gluck: Orpheus and Eurydice": a short prefix names the composer, so it must be the work's composer.
    const prefix = /^([^:]{2,30}):\s/.exec(e.title)?.[1];
    const named = prefix && prefix.split(/\s+/).length <= 2 ? surname(prefix) : '';
    const whole = normTitle(e.title);
    let hit: RepertoireWork | undefined;
    for (const { key, partial } of titleCandidates(e.title)) {
      // "Chopin - The Cello Works" is a recital, not the opera Chopin.
      if (partial && e.category === 'classical' && !key.includes(' ')) continue;
      let pool = byTitle.get(key)?.filter((w) => fits(w, e, partial));
      if (pool?.length && named && key !== whole) pool = pool.filter((w) => w.composers.some((c) => surname(c) === named));
      if (!pool?.length) continue;
      hit =
        pool.length === 1
          ? pool[0]
          : (pool.find((w) => w.composers.some((c) => surname(c).length > 2 && context.includes(surname(c)))) ?? pool[0]);
      break;
    }
    if (!hit) continue;
    const list = byWork.get(hit.id);
    if (list) list.push(e);
    else byWork.set(hit.id, [e]);
  }
  for (const list of byWork.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return { byWork, count: (id) => byWork.get(id)?.length ?? 0 };
}
