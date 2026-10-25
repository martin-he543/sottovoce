import { useEffect, useRef, useState } from 'react';
import type { DocEntry, DocSection } from '../../utils/followDoc';
import type { ListenSubject } from '../useLiveListener';

interface SlideLike {
  id: string;
  section: DocSection;
  entry?: DocEntry;
}

/** Lines the reader must move through before Argon says something. */
const EVERY = 4;
/** Quiet time after the last move, so scrolling through a stretch by hand gets one note, not several. The first note
 * goes out almost at once. */
const SETTLE_MS = 1400;

/**
 * Live commentary: switched on, Argon at once writes a note on the lines leading up to the reader's place, then another
 * every few lines it moves forward, which `onNote` puts in the sidebar. A jump backwards starts counting afresh from the
 * new place. A failure is reported once (`error`), not on every attempt.
 */
export function useCommentary(opts: {
  enabled: boolean;
  subject: ListenSubject;
  slides: SlideLike[];
  at: number;
  trail: string;
  onNote: (text: string, note: { label: string; slideId: string }, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const live = useRef(opts);
  live.current = opts;
  // The slide the last note was written at; null until the first note.
  const base = useRef<number | null>(null);
  const flying = useRef(false);
  const failed = useRef(false);
  const notes = useRef<string[]>([]);
  const title = opts.subject.title;

  // A new work, or switching it off, starts over.
  useEffect(() => {
    base.current = null;
    notes.current = [];
    failed.current = false;
  }, [title, opts.enabled]);

  const { enabled, at } = opts;
  useEffect(() => {
    if (!enabled) return;
    if (base.current != null && at < base.current) {
      base.current = at;
      return;
    }
    const timer = window.setTimeout(async () => {
      const { slides, subject, trail, onNote } = live.current;
      const from = base.current;
      const now = live.current.at;
      if (flying.current) return;
      const lines = (a: number, b: number) => slides.slice(a, b).flatMap((s) => (s.entry ? [s.entry] : []));
      // The first note sets the scene from the lines up to here; after that, what has gone by since the last one.
      const passed = from == null ? lines(Math.max(0, now - 7), now + 1) : lines(from + 1, now + 1);
      if (!passed.length || (from != null && passed.length < EVERY)) return;
      const here = slides[now];
      const label = trail || here?.section.title || 'Commentary';
      flying.current = true;
      setBusy(true);
      try {
        const res = await fetch('/api/immerse/commentary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work: { title: subject.title, composer: subject.composer, synopsis: subject.synopsis },
            where: { trail, scene: here?.section.summaryTranslation || here?.section.summary },
            lines: passed.slice(-8).map((e) => ({ who: e.whoEn ? `${e.who} (${e.whoEn})` : e.who, text: e.text, translation: e.translation })),
            before: notes.current,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
        if (res.ok && data.note) {
          failed.current = false;
          notes.current = [...notes.current, data.note].slice(-3);
          onNote(data.note, { label, slideId: here?.id ?? '' });
        } else if (!failed.current) {
          failed.current = true;
          const why =
            res.status === 501
              ? 'Argon isn’t set up on this server (no Gemini key).'
              : res.status === 404
                ? 'This server has no live commentary yet: restart it to pick up the latest code.'
                : `Argon couldn’t comment just now${data.error ? `: ${data.error}` : '.'}`;
          onNote(why, { label: 'Live commentary', slideId: '' }, true);
        }
      } catch {
        if (!failed.current) {
          failed.current = true;
          onNote('Couldn’t reach Argon for commentary. Check the connection.', { label: 'Live commentary', slideId: '' }, true);
        }
      } finally {
        // Count on from where this note was written, success or not, so a failure doesn't fire again at once.
        base.current = now;
        flying.current = false;
        setBusy(false);
      }
    }, base.current == null ? 300 : SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, at]);

  return { busy };
}
