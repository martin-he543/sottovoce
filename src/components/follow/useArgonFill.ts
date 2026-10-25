import { useEffect, useMemo, useRef, useState } from 'react';
import type { FollowDoc } from '../../utils/followDoc';
import { roleInEnglish } from '../../utils/roleNames';

interface Filled {
  lines: Record<string, string>;
  names: Record<string, string>;
  notes: Record<string, string>;
}

/** What Argon has translated, by work and text, kept for the visit so going back over a passage costs nothing. */
const cache = new Map<string, Filled>();
const bucket = (work: string) => {
  let b = cache.get(work);
  if (!b) cache.set(work, (b = { lines: {}, names: {}, notes: {} }));
  return b;
};

interface Options {
  doc: FollowDoc;
  /** The section the reader is on, and the ones after it to prepare. */
  sectionId: string | undefined;
  work: { title: string; composer?: string; language?: string };
  enabled: boolean;
}

/** Sections ahead of the current one whose missing English is fetched with it, so reading on never waits. */
const AHEAD = 3;
const MAX_LINES = 40;

/**
 * The offline translations cover most of every libretto, but not all of it (a text re-scraped since, a scene note, a
 * part named by what it is). For whatever the reader is about to show without English, this asks Argon, a few passages
 * at a time, and returns the document with the gaps filled.
 */
export function useArgonFill({ doc, sectionId, work, enabled }: Options): { doc: FollowDoc; pending: boolean; failed: boolean } {
  const key = `${work.title}|${work.composer ?? ''}`;
  const [filled, setFilled] = useState<Filled>(() => bucket(key));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const asked = useRef(new Set<string>());
  const english = !work.language || /^english/i.test(work.language);

  useEffect(() => {
    setFilled({ ...bucket(key) });
    asked.current = new Set();
    setFailed(false);
  }, [key]);

  useEffect(() => {
    if (!enabled || english || !sectionId) return;
    const at = doc.sections.findIndex((s) => s.id === sectionId);
    if (at < 0) return;
    const b = bucket(key);
    // From the scene (and act) heading the reader is under, whose note shows above its lines, to a few passages on.
    let from = at;
    while (from > 0 && doc.sections[from].level > 1 && (doc.sections[from].level === 3 || doc.sections[from - 1].level === 1)) from--;
    const ahead = doc.sections.slice(from, at + 1 + AHEAD);
    const lines: { id: string; who?: string; text: string }[] = [];
    const notes: { id: string; text: string }[] = [];
    const names = new Set<string>();
    for (const [k, s] of ahead.entries()) {
      if (s.summary && !s.summaryTranslation && !b.notes[s.id] && !asked.current.has(`n:${s.id}`)) notes.push({ id: s.id, text: s.summary });
      // Lines from the current passage on: the headings above it only lend their notes.
      if (from + k < at) continue;
      for (const e of s.entries) {
        if (e.kind === 'line' && !e.translation && !b.lines[e.id] && !asked.current.has(`l:${e.id}`) && lines.length < MAX_LINES) {
          lines.push({ id: e.id, who: e.who, text: e.text });
        }
        if (e.who && !e.whoEn && !roleInEnglish(e.who) && !(e.who in b.names) && !asked.current.has(`w:${e.who}`)) names.add(e.who);
      }
    }
    if (!lines.length && !notes.length && !names.size) return;
    // Wait for the reader to settle: skimming through the contents shouldn't fire a request per section.
    const timer = window.setTimeout(async () => {
      lines.forEach((l) => asked.current.add(`l:${l.id}`));
      notes.forEach((n) => asked.current.add(`n:${n.id}`));
      names.forEach((n) => asked.current.add(`w:${n}`));
      setPending(true);
      try {
        const res = await fetch('/api/libretto/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: work.title, composer: work.composer, language: work.language, lines, notes, names: [...names] }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Partial<Filled>;
        Object.assign(b.lines, data.lines ?? {});
        Object.assign(b.notes, data.notes ?? {});
        // A proper name comes back as it went: remember it as needing nothing.
        for (const n of names) {
          const en = data.names?.[n]?.trim() ?? '';
          b.names[n] = en && en.toLowerCase() !== n.toLowerCase() ? en : '';
        }
        setFilled({ ...b });
        setFailed(false);
      } catch {
        // Let a later visit try again.
        lines.forEach((l) => asked.current.delete(`l:${l.id}`));
        notes.forEach((n) => asked.current.delete(`n:${n.id}`));
        names.forEach((n) => asked.current.delete(`w:${n}`));
        setFailed(true);
      } finally {
        setPending(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [doc, sectionId, key, enabled, english, work.title, work.composer, work.language]);

  const out = useMemo<FollowDoc>(() => {
    if (english) return doc;
    const hasAny = Object.keys(filled.lines).length || Object.keys(filled.notes).length || Object.keys(filled.names).length;
    return {
      ...doc,
      sections: doc.sections.map((s) => {
        const note = !s.summaryTranslation && filled.notes[s.id];
        const entries = s.entries.map((e) => {
          const t = !e.translation && hasAny ? filled.lines[e.id] : undefined;
          const w = e.who && !e.whoEn ? roleInEnglish(e.who) || (hasAny ? filled.names[e.who] : '') : '';
          return t || w ? { ...e, ...(t ? { translation: t } : {}), ...(w ? { whoEn: w } : {}) } : e;
        });
        return note || entries.some((e, i) => e !== s.entries[i]) ? { ...s, ...(note ? { summaryTranslation: note } : {}), entries } : s;
      }),
    };
  }, [doc, filled, english]);

  return { doc: out, pending, failed };
}
