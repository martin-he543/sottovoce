/**
 * The document the Follow reader shows: a work cut into sections (acts, scenes, passages) that hold lines. A synced
 * libretto fills them up front; a work known only by its synopsis gets its sections from the synopsis headings and
 * collects lines as they are heard, typed or scanned.
 */
import type { RepertoireDetail, WorkAndLibretto } from '../types/sottovoce';
import { lineScore, lyricTokens } from './lyricMatch';
import { roleInEnglish } from './roleNames';

export interface DocEntry {
  id: string;
  text: string;
  who?: string;
  /** The character's name in English, when it is a part named by what it is ("Diavolo" → "Devil"). */
  whoEn?: string;
  translation?: string;
  subtext?: string;
  /** Where it came from: the stored libretto, the microphone, the keyboard or the camera. */
  kind: 'line' | 'heard' | 'typed' | 'scan';
  /** Index into the libretto's lines, when it is one. */
  libIdx?: number;
}

export interface DocSection {
  id: string;
  title: string;
  /** 1 = act/part, 2 = scene, 3 = passage. */
  level: 1 | 2 | 3;
  /** What is happening here (the synopsis text, or the libretto's scene note). */
  summary?: string;
  /** The summary in English, when it is written in another language. */
  summaryTranslation?: string;
  entries: DocEntry[];
}

export interface FollowDoc {
  sections: DocSection[];
  /** True when the lines are stored, so position can be followed line by line. */
  hasLibretto: boolean;
}

const PASSAGE = 8;

const ACT_RE = /^(act|part|book|prologue|epilogue|overture|prelude|interlude|intermezzo|entr'?acte|finale|first|second|third|fourth|fifth)\b/i;
const SCENE_RE = /^(scene|tableau|section|chapter|number|no\.)\b/i;
const BOTH_RE = /\b(act|part)\s+[\divx]+\b.*\b(scene|tableau)\b/i;

/** The depth of a synopsis heading: "Act 1" is a top-level part, "Scene 2" sits under it. */
export function headingLevel(heading: string): 1 | 2 {
  const h = heading.trim();
  if (BOTH_RE.test(h)) return 2;
  if (SCENE_RE.test(h)) return 2;
  if (ACT_RE.test(h)) return 1;
  return 1;
}

const preview = (s: string) => {
  const words = s.replace(/\s+/g, ' ').trim().split(' ');
  return `“${words.slice(0, 5).join(' ')}${words.length > 5 ? '…' : ''}”`;
};

/** A work with a stored libretto: its act and scene as headings, its lines in passages of a few at a time. */
export function buildLibrettoDoc(work: WorkAndLibretto): FollowDoc {
  const sections: DocSection[] = [
    { id: 'act', title: `Act ${work.current_act}`, level: 1, summary: work.setting_description, entries: [] },
    {
      id: 'scene',
      title: `Scene ${work.current_scene}${work.scene_title ? ` · ${work.scene_title}` : ''}`,
      level: 2,
      summary: work.happening_now,
      entries: [],
    },
  ];
  for (let i = 0; i < work.lines.length; i += PASSAGE) {
    const chunk = work.lines.slice(i, i + PASSAGE);
    sections.push({
      id: `p${i}`,
      title: preview(chunk[0].original_text),
      level: 3,
      entries: chunk.map((l, k) => ({
        id: `l${i + k}`,
        text: l.original_text,
        who: l.character,
        whoEn: work.language === 'English' ? undefined : roleInEnglish(l.character) || undefined,
        translation: l.literal_english,
        subtext: l.dramatic_subtext,
        kind: 'line' as const,
        libIdx: i + k,
      })),
    });
  }
  return { sections, hasLibretto: true };
}

/** A work known by its synopsis: each heading becomes a section, ready to collect what is heard under it. */
export function buildSynopsisDoc(detail: RepertoireDetail | null | undefined, lead?: string): FollowDoc {
  const sections: DocSection[] = [];
  const overview = lead || detail?.lead;
  if (overview) sections.push({ id: 'overview', title: 'Overview', level: 1, summary: overview, entries: [] });
  detail?.synopsis.forEach((s, i) => {
    if (!s.heading) {
      const last = sections[sections.length - 1];
      if (last && last.id !== 'overview') last.summary = [last.summary, s.text].filter(Boolean).join('\n\n');
      else sections.push({ id: `s${i}`, title: 'Synopsis', level: 1, summary: s.text, entries: [] });
      return;
    }
    sections.push({ id: `s${i}`, title: s.heading, level: headingLevel(s.heading), summary: s.text, entries: [] });
  });
  if (!sections.length) sections.push({ id: 'live', title: 'Performance', level: 1, entries: [] });
  return { sections, hasLibretto: false };
}

export interface DocHit {
  sectionId: string;
  entryId?: string;
  label: string;
  snippet: string;
  score: number;
}

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const ordinals = (toks: string[]) => toks.map((t) => ROMAN[t] ?? t);

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/**
 * Finds where typed text belongs: sections whose title or summary say it ("act 2 scene 1", "the garden"), and lines that
 * contain it, even when it is only part of the line or spelled a little differently.
 */
export function searchDoc(doc: FollowDoc, query: string, limit = 8): DocHit[] {
  const raw = lyricTokens(query);
  if (!raw.length) return [];
  const q = ordinals(raw);
  const hits: DocHit[] = [];
  let parent = '';
  for (const sec of doc.sections) {
    if (sec.level === 1) parent = sec.title;
    const titleToks = ordinals(lyricTokens(`${parent} ${sec.title}`));
    const inTitle = q.filter((t) => titleToks.includes(t)).length / q.length;
    // "act 2" should find Act 2 itself, not every scene beneath it: the heading's own words count most.
    const own = ordinals(lyricTokens(sec.title));
    const inOwn = q.filter((t) => own.includes(t)).length / q.length;
    const sumToks = sec.summary ? ordinals(lyricTokens(sec.summary)) : [];
    const inSummary = sumToks.length && q.length > 1 ? q.filter((t) => sumToks.includes(t)).length / q.length : 0;
    const secScore = Math.max(inTitle * 0.85 + inOwn * 0.15, inSummary * 0.7);
    if (secScore >= 0.6) {
      hits.push({
        sectionId: sec.id,
        label: sec.title,
        snippet: inSummary > inTitle && sec.summary ? clip(sec.summary) : parent && sec.level > 1 ? parent : '',
        score: secScore,
      });
    }
    for (const e of sec.entries) {
      const toks = lyricTokens(e.text);
      const s = lineScore(raw, toks);
      const sub = q.length >= 2 && ` ${toks.join(' ')} `.includes(` ${raw.join(' ')} `) ? 1 : 0;
      const score = Math.max(s, sub);
      if (score >= 0.45) hits.push({ sectionId: sec.id, entryId: e.id, label: clip(e.text, 70), snippet: e.who ?? sec.title, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The section that holds a given libretto line. */
export function sectionOfLine(doc: FollowDoc, libIdx: number): DocSection | undefined {
  return doc.sections.find((s) => s.entries.some((e) => e.libIdx === libIdx));
}

/**
 * The section a story position ("Act II, scene 1: the garden") most likely refers to, for moving a synopsis-only work
 * along as the AI places each heard line in the story. Null when nothing matches clearly.
 */
export function sectionForStory(doc: FollowDoc, where: string): DocSection | null {
  const q = new Set(ordinals(lyricTokens(where)));
  let best: DocSection | null = null;
  let bestLen = 0;
  let parent = '';
  for (const sec of doc.sections) {
    if (sec.level === 1) parent = sec.title;
    // A heading is named when all its words are there ("Part 2" in "Part 2, in the study"); a scene also needs its act.
    const own = ordinals(lyricTokens(sec.title));
    const need = sec.level > 1 && !/\b(act|part)\b/i.test(sec.title) ? [...own, ...ordinals(lyricTokens(parent))] : own;
    if (need.length && need.every((t) => q.has(t)) && need.length > bestLen) {
      best = sec;
      bestLen = need.length;
    }
  }
  return best;
}

/**
 * The scenes of a document in the short form the "find this moment" request sends: heading, note, who sings and a few
 * lines spread across the scene (translated where there is a translation). A work with no scenes sends its acts.
 */
export function sceneDigest(doc: FollowDoc): { id: string; title: string; note?: string; who?: string; lines: string[] }[] {
  const groups: { section: DocSection; act: string; entries: DocEntry[] }[] = [];
  let act = '';
  const hasScenes = doc.sections.some((s) => s.level === 2);
  for (const s of doc.sections) {
    if (s.level === 1) act = s.title;
    const head = hasScenes ? s.level === 2 : s.level === 1;
    if (head) groups.push({ section: s, act, entries: [...s.entries] });
    else if (s.level === 3 && groups.length) groups[groups.length - 1].entries.push(...s.entries);
    else if (!head && groups.length && s.level === 2) groups[groups.length - 1].entries.push(...s.entries);
  }
  return groups.map(({ section, act, entries }) => {
    const pick = [0, 0.25, 0.5, 0.75, 0.95].map((f) => entries[Math.floor(f * entries.length)]).filter((e, i, a) => e && a.indexOf(e) === i);
    const who = [...new Set(entries.map((e) => e.who).filter((w): w is string => !!w))].slice(0, 8).join(', ');
    return {
      id: section.id,
      title: [act && act !== section.title ? act : '', section.title].filter(Boolean).join(' · '),
      note: section.summary || undefined,
      who: who || undefined,
      lines: pick.map((e) => (e.translation ? `${e.text} (${e.translation})` : e.text)),
    };
  });
}
