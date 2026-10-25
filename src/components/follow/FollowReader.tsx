import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArgonButton, ArgonMark } from '../ArgonButton';
import { ArrowLeft, ArrowLeftRight, ArrowRight, ListTree, Music2, Maximize2, Mic, Minimize2, ScanText, Settings2, Square } from 'lucide-react';
import type { WorkAndLibretto } from '../../types/sottovoce';
import { sceneDigest, searchDoc, sectionForStory, type DocEntry, type DocSection, type FollowDoc } from '../../utils/followDoc';
import { matchHeard } from '../../utils/lyricMatch';
import { isNativeShell } from '../../utils/nativeShell';
import { springScroller, type SpringScroller } from '../../utils/springScroll';
import { useLiveListener, type ListenSubject } from '../useLiveListener';
import { ArgonChat, useArgonChat, type ChatContext } from './ArgonChat';
import { CharacterInfo, SideTabs, useCharacterInfo, type SceneContext } from './CharacterInfo';
import { useCommentary } from './useCommentary';
import { CHAT_WIDTH, DEFAULT_PREFS, fontOf, FONTS, NAV_WIDTH, themeOf, useFollowPrefs, type FollowPrefs, type Theme } from './prefs';
import { ResizeHandle } from './ResizeHandle';
import { useArgonFill } from './useArgonFill';
import { SettingsPanel } from './SettingsPanel';
import { InlineScore, loadScore, type ScoreMap } from './ScorePanel';
import { Sidebar } from './Sidebar';
import { SubtitleScanner } from './SubtitleScanner';

interface Props {
  title: string;
  byline: string;
  /** Sections as built from the libretto or the synopsis. */
  doc: FollowDoc;
  subject: ListenSubject;
  /** The stored libretto, when there is one; `lineIdx` is then the shared position in it. */
  libretto?: WorkAndLibretto;
  lineIdx?: number;
  onLineChange?: (idx: number) => void;
  onChange: () => void;
}

/** One step of the reader: a section's summary, or a line. */
interface Slide {
  id: string;
  section: DocSection;
  entry?: DocEntry;
}

/** The first `n` sentences of a passage: Argon's notes stay short; the sidebar has the long answers. */
const sentences = (text: string, n: number) => (text.match(/.*?[.!?…](?=\s|$)/gs)?.slice(0, n).join('').trim() || text);

/** Seconds of quiet before a synced reader returns to the current line after being scrolled by hand. */
const BROWSE_MS = 3200;

const slideId = (s: { section: DocSection; entry?: DocEntry }) => (s.entry ? `e:${s.entry.id}` : `s:${s.section.id}`);

/** Keeps the phone awake while following, and locks the page behind the overlay in full screen. */
function useStageSession(fullscreen: boolean) {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    const prev = document.body.style.overflow;
    if (fullscreen) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.body.style.overflow = prev;
      lock?.release().catch(() => {});
    };
  }, [fullscreen]);
}

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const fullscreenElement = () => document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null;

/**
 * Full screen: always a fixed overlay above the rest of the app, plus the browser's own full screen where it is safe.
 * The Tauri webview gets the overlay only: Android's WebView turns the page black on an unhandled element full screen.
 */
function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  const native = useRef(false);
  const leaveNative = () => {
    if (!fullscreenElement()) return;
    const d = document as FsDocument;
    try {
      if (d.exitFullscreen) d.exitFullscreen().catch(() => {});
      else d.webkitExitFullscreen?.();
    } catch {
      /* already left */
    }
  };
  const enter = () => {
    setFullscreen(true);
    if (isNativeShell) return;
    const el = document.documentElement as FsElement;
    try {
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(() => (native.current = true)).catch(() => {});
      else if (el.webkitRequestFullscreen) (el.webkitRequestFullscreen(), (native.current = true));
    } catch {
      /* the overlay alone will do */
    }
  };
  const exit = () => {
    setFullscreen(false);
    native.current = false;
    leaveNative();
  };
  useEffect(() => {
    // Leaving the browser's full screen (Esc, the system back gesture) leaves ours too.
    const onChange = () => {
      if (fullscreenElement()) return;
      if (native.current) setFullscreen(false);
      native.current = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      leaveNative();
    };
  }, []);
  return { fullscreen, enter, exit };
}

/**
 * The follow-along reader. A work is a list of sections and lines; the reader shows them as a continuous scroll (like a
 * music player's lyrics) or one at a time, vertically or horizontally. Synced, the microphone and the subtitle scanner
 * move the place; manual, only you do. A contents list and a jump box let you skip straight to any part.
 *
 * The scrolling view borrows its feel from Spicy Lyrics: the current line is centred by a spring and the lines around it
 * fall away in size, opacity and blur. The code here is our own.
 */
export const FollowReader: React.FC<Props> = ({ title, byline, doc, subject, libretto, lineIdx = 0, onLineChange, onChange }) => {
  const [prefs, setPrefs] = useFollowPrefs();
  const t = themeOf(prefs);
  const { fullscreen, enter, exit } = useFullscreen();
  useStageSession(fullscreen);

  // Lines that are not in the libretto (heard, typed, scanned) live here, keyed by section.
  const [extra, setExtra] = useState<Record<string, DocEntry[]>>({});
  const [explained, setExplained] = useState<Record<string, { subtext: string; cue: string } | 'loading'>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [navOpen, setNavOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState('');
  const jumpRef = useRef<HTMLInputElement>(null);

  // The synopsis can arrive after listening has begun, replacing the placeholder section: lines heard under a section
  // that no longer exists are kept, in the first one, rather than dropped.
  const base = useMemo<FollowDoc>(() => {
    const known = new Set(doc.sections.map((s) => s.id));
    const orphans = Object.entries(extra).flatMap(([id, es]) => (known.has(id) ? [] : es));
    return {
      ...doc,
      sections: doc.sections.map((s, i) => {
        const more = [...(i === 0 ? orphans : []), ...(extra[s.id] ?? [])];
        return more.length ? { ...s, entries: [...s.entries, ...more] } : s;
      }),
    };
  }, [doc, extra]);
  // Whatever the offline translations miss (lines, names, scene notes) Argon fills in, a few passages ahead of the reader.
  const [fillAt, setFillAt] = useState<string>();
  const fill = useArgonFill({
    doc: base,
    sectionId: fillAt,
    work: { title, composer: subject.composer, language: libretto?.language ?? subject.language },
    enabled: prefs.translation,
  });
  const merged = fill.doc;

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    for (const section of merged.sections) {
      if (section.summary || !section.entries.length) out.push({ id: `s:${section.id}`, section });
      for (const entry of section.entries) out.push({ id: `e:${entry.id}`, section, entry });
    }
    return out;
  }, [merged]);
  const index = useMemo(() => new Map(slides.map((s, i) => [s.id, i])), [slides]);

  const [cursor, setCursor] = useState<string>(() => (libretto ? `e:l${lineIdx}` : (slides[0]?.id ?? '')));
  const at = Math.max(0, index.get(cursor) ?? 0);
  const current = slides[at];
  const translated = useMemo(() => doc.sections.some((s) => s.entries.some((e) => e.translation)), [doc]);
  const curSectionId = current?.section.id ?? merged.sections[0]?.id;
  useEffect(() => setFillAt(curSectionId), [curSectionId]);
  const sectionOrder = useMemo(() => new Map(merged.sections.map((s, i) => [s.id, i])), [merged]);

  // The libretto line a slide stands for: its own, or for a heading, the first line under it.
  const lineOf = useCallback(
    (i: number) => {
      for (let j = i; j < slides.length && j < i + 400; j++) if (slides[j].entry?.libIdx != null) return slides[j].entry!.libIdx!;
      return undefined;
    },
    [slides]
  );
  const goTo = useCallback(
    (id: string) => {
      const i = index.get(id) ?? -1;
      if (!slides[i]) return;
      setCursor(id);
      const li = lineOf(i);
      if (libretto && li != null && li !== lineIdx) onLineChange?.(li);
    },
    [slides, index, libretto, lineIdx, onLineChange, lineOf]
  );
  const step = (d: number) => slides[at + d] && goTo(slides[at + d].id);

  // The libretto position moved from elsewhere (the microphone, another tab of the app): follow it.
  useEffect(() => {
    if (libretto && lineOf(at) !== lineIdx) setCursor(`e:l${lineIdx}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIdx, libretto]);

  const goSection = (id: string) => {
    const sec = merged.sections.find((s) => s.id === id);
    if (!sec) return;
    const first = slides.find((s) => s.section.id === id);
    first && goTo(first.id);
    if (window.innerWidth < 768) setNavOpen(false);
  };

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 4200);
  }, []);

  /* ---- Argon, in the sidebar on the right ---- */

  // Read when a question is sent: the place and the text around it, and the scenes to jump between.
  const chatContext = useRef<() => ChatContext>(() => ({ trail: '', lines: [], scenes: [] }));
  const jumpTo = useRef<(id: string) => void>(() => {});
  const chat = useArgonChat(
    subject,
    useCallback(() => chatContext.current(), []),
    useCallback((id: string) => jumpTo.current(id), [])
  );
  const chatInput = useRef<HTMLTextAreaElement>(null);
  // The vocal score, when one has been lined up with this libretto.
  const [score, setScore] = useState<ScoreMap | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  // Scores are lined up with the full libretto texts (`text:<id>`), not the short hand-made excerpts.
  const workId = libretto?.work_id.startsWith('text:') ? libretto.work_id.slice(5) : undefined;
  useEffect(() => {
    setScore(null);
    if (workId) void loadScore(workId).then(setScore);
  }, [workId]);
  // On a wide screen the sidebar opens as you last left it; on a phone it would cover the words, so it waits to be asked.
  const [chatOpen, setChatOpenState] = useState(() => prefs.chat && (typeof window === 'undefined' || window.innerWidth >= 768));
  const setChatOpen = (on: boolean) => {
    setChatOpenState(on);
    if (window.innerWidth >= 768) setPrefs({ chat: on });
  };
  // The Style panel's "Argon sidebar" switch (a change to it, not the saved value on arrival).
  const chatPref = useRef(prefs.chat);
  useEffect(() => {
    if (chatPref.current === prefs.chat) return;
    chatPref.current = prefs.chat;
    setChatOpenState(prefs.chat);
  }, [prefs.chat]);
  // Which panel the sidebar shows: the conversation with Argon, or the profile of a character.
  const [sideTab, setSideTab] = useState<'argon' | 'info'>('argon');
  const askArgon = (q: string, line?: { slideId: string; who?: string }) => {
    if (!chatOpen) setChatOpen(true);
    setSideTab('argon');
    void chat.ask(q, line);
  };
  // "Explain more": the line itself goes in as the question, and clicking it later comes back to the line.
  const explainMore = (entry: DocEntry) => {
    askArgon(`Explain this line: “${entry.text}”`, {
      slideId: `e:${entry.id}`,
      who: entry.who,
    });
  };

  /* ---- adding words that are not in a stored libretto ---- */

  const seq = useRef(0);
  const addEntry = useCallback(
    (sectionId: string, e: Omit<DocEntry, 'id'>) => {
      const entry: DocEntry = { ...e, id: `x${++seq.current}` };
      setExtra((m) => ({ ...m, [sectionId]: [...(m[sectionId] ?? []), entry] }));
      setCursor(`e:${entry.id}`);
      return entry.id;
    },
    []
  );

  const patchEntry = (sectionId: string, id: string, patch: Partial<DocEntry>) =>
    setExtra((m) => ({ ...m, [sectionId]: (m[sectionId] ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  /** Words someone typed or the camera read: shown at once, then translated and explained when the server can. */
  const addWords = useCallback(
    async (text: string, kind: 'typed' | 'scan') => {
      const sectionId = curSectionId;
      if (!sectionId) return;
      const id = addEntry(sectionId, { text, kind });
      try {
        const res = await fetch('/api/live/listen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, work: subject }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.ai) patchEntry(sectionId, id, { translation: String(data.translation ?? ''), subtext: String(data.explanation ?? '') });
      } catch {
        /* offline: the words stay as they were typed */
      }
    },
    [addEntry, curSectionId, subject]
  );

  /* ---- listening ---- */

  const listener = useLiveListener({
    subject,
    lines: libretto?.lines,
    lineIdx,
    onLine: (i) => prefs.sync && onLineChange?.(i),
  });
  const listening = listener.state === 'listening';
  // Manual means the room does not move the place.
  useEffect(() => {
    if (!prefs.sync && listening) listener.stop();
  }, [prefs.sync, listening, listener]);

  const lastHeard = useRef(0);
  const latestHeard = listener.heard[0];
  useEffect(() => {
    if (!latestHeard || latestHeard.id === lastHeard.current) return;
    lastHeard.current = latestHeard.id;
    if (libretto || !prefs.sync) return;
    // With no stored libretto, what was heard becomes the lines, filed under the part of the story it belongs to.
    const target = (latestHeard.where && sectionForStory(merged, latestHeard.where)) || merged.sections.find((s) => s.id === curSectionId);
    if (!target) return;
    addEntry(target.id, {
      text: latestHeard.text,
      translation: latestHeard.translation,
      subtext: latestHeard.explanation,
      kind: 'heard',
    });
  }, [latestHeard, libretto, prefs.sync, merged, curSectionId, addEntry]);

  /* ---- reading subtitles ---- */

  const onScan = useCallback(
    (text: string, _conf: number, auto: boolean) => {
      if (auto && !prefs.sync) return;
      if (libretto) {
        const m = matchHeard(text, libretto.lines, lineIdx, 0.45);
        if (m) {
          if (m.index !== lineIdx) onLineChange?.(m.index);
          flash(`Found line ${m.index + 1}`);
        } else if (!auto) flash('Read the words, but they are not in this libretto.');
        return;
      }
      const hit = searchDoc(merged, text, 1)[0];
      if (hit && hit.score >= 0.8) {
        hit.entryId ? goTo(`e:${hit.entryId}`) : goSection(hit.sectionId);
        return;
      }
      const newest = merged.sections.flatMap((s) => s.entries).filter((e) => e.kind === 'scan').pop();
      if (newest?.text !== text) addWords(text, 'scan');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libretto, lineIdx, merged, prefs.sync, onLineChange, flash, addWords]
  );

  /* ---- explanations on demand ---- */

  /** `quiet`: asked by live commentary rather than by a tap, so a failure isn't announced. */
  const explain = async (entry: DocEntry, quiet = false) => {
    if (!libretto || entry.libIdx == null) return;
    setExplained((m) => ({ ...m, [entry.id]: 'loading' }));
    try {
      const res = await fetch('/api/libretto/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId: libretto.work_id,
          lineIndex: entry.libIdx,
          title: libretto.title,
          composer: libretto.composer,
          line: { character: entry.who, original_text: entry.text, language: libretto.language, literal_english: entry.translation },
        }),
      });
      const d = await res.json();
      const plain = (v: unknown) => sentences(String(v ?? '').replace(/\*+/g, '').trim(), 1);
      setExplained((m) => ({ ...m, [entry.id]: { subtext: plain(d.dramatic_subtext), cue: plain(d.musical_cue) } }));
    } catch {
      setExplained((m) => {
        const { [entry.id]: _drop, ...rest } = m;
        return rest;
      });
      if (!quiet) flash('Could not reach the explainer.');
    }
  };

  // Live commentary also writes the note under each line: the one being read and, ahead of time, the next, each once.
  const explainLive = useRef({ explain, asked: new Set<string>() });
  explainLive.current.explain = explain;
  useEffect(() => {
    if (!prefs.commentary || !libretto) return;
    const timer = window.setTimeout(() => {
      const { explain: run, asked } = explainLive.current;
      for (const s of slides.slice(at, at + 2)) {
        const e = s.entry;
        if (!e || e.libIdx == null || e.subtext || asked.has(e.id)) continue;
        asked.add(e.id);
        run(e, true);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [prefs.commentary, libretto, at, slides]);

  /* ---- keys ---- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.('input, textarea');
      if (typing) return;
      const fwd = prefs.axis === 'horizontal' ? ['ArrowRight'] : ['ArrowDown'];
      const back = prefs.axis === 'horizontal' ? ['ArrowLeft'] : ['ArrowUp'];
      if (fwd.includes(e.key) || e.key === ' ' || e.key === 'PageDown') (e.preventDefault(), step(1));
      else if (back.includes(e.key) || e.key === 'PageUp') (e.preventDefault(), step(-1));
      else if (e.key === '/') (e.preventDefault(), setNavOpen(true), window.setTimeout(() => jumpRef.current?.focus(), 0));
      else if (e.key === 'Escape') fullscreen ? exit() : (setSettingsOpen(false), setScanning(false));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const set = setPrefs;
  const chip = 'px-2.5 sm:px-3 py-1.5 rounded-full border font-mono text-[11px] uppercase tracking-wider cursor-pointer flex items-center gap-1.5';
  const chipStyle = (on: boolean): React.CSSProperties => ({ borderColor: on ? t.gold : t.hair, color: on ? t.gold : t.dim });
  const total = libretto?.lines.length ?? 0;
  // Where we are comes from the sections themselves (act, scene), so every act of a full libretto is reported, not just one.
  const trail = (() => {
    const titles: string[] = [];
    for (const s of merged.sections) {
      if (s.level === 1) titles.length = 0;
      if (s.level === 2) titles.length = Math.min(titles.length, 1);
      if (s.level < 3) titles.push(s.title);
      if (s.id === curSectionId) break;
    }
    return titles.join(' · ');
  })();
  const where = libretto
    ? `${trail || `Act ${libretto.current_act} · Scene ${libretto.current_scene}`} · ${lineIdx + 1}/${total}`
    : current?.section.title || byline || 'Follow along';
  const noEntries = !merged.sections.some((s) => s.entries.length);
  const narrow = () => window.innerWidth < 768;

  jumpTo.current = (id: string) => {
    goSection(id);
    if (narrow()) setChatOpen(false);
  };
  chatContext.current = () => ({
    trail: where,
    lines: slides
      .slice(at, at + 10)
      .flatMap((x) => (x.entry ? [{ who: x.entry.whoEn ? `${x.entry.who} (${x.entry.whoEn})` : x.entry.who, text: x.entry.text, translation: x.entry.translation }] : [])),
    scenes: sceneDigest(merged),
  });
  const suggestions = merged.hasLibretto
    ? ['What’s happening right now?', 'Who is singing, and what do they want?', 'What should I listen for in the music?', 'Take me to the most famous moment']
    : ['What’s this work about, without spoilers?', 'Who are the main characters?', 'What should I listen for?', 'Where are we in the story?'];

  // The scene as the Info panel and the commentary see it: where we are, who is singing, and the words around the place.
  const scene: SceneContext = {
    id: curSectionId ?? '',
    trail: trail || current?.section.title || '',
    summary: current?.section.summaryTranslation || current?.section.summary,
    lines: chatContext.current().lines,
    cast: [...new Set((current?.section.entries ?? []).flatMap((e) => (e.who ? [e.who] : [])))].slice(0, 10),
  };
  const info = useCharacterInfo(subject, scene);
  const openCharacter = (name: string) => {
    if (!chatOpen) setChatOpen(true);
    setSideTab('info');
    info.open(name);
  };
  const commentary = useCommentary({ enabled: prefs.commentary, subject, slides, at, trail: scene.trail, onNote: chat.addNote });
  const changeWork = () => {
    if (fullscreen) exit();
    onChange();
  };

  return (
    <div
      // Above the phone tab bar (z-50) and the media dock (z-900) in full screen; inline, it fits between them.
      className={
        fullscreen
          ? 'fixed inset-0 z-[1000] flex flex-col select-none overflow-hidden'
          : 'flex flex-col select-none rounded-2xl overflow-hidden relative h-[calc(100dvh-12.5rem)] md:h-[78vh] min-h-[380px]'
      }
      style={{
        backgroundColor: t.bg,
        color: t.ink,
        ...(fullscreen && {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }),
      }}
    >
      <style>{`
        @keyframes follow-in-x { from { opacity: 0; transform: translateX(var(--dx, 24px)); } to { opacity: 1; transform: none; } }
        @keyframes follow-in-y { from { opacity: 0; transform: translateY(var(--dy, 24px)); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .follow-anim { animation: none !important; } }
      `}</style>

      {/* header */}
      {/* Change and the title lead on the left; on a phone the controls wrap onto a second row. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b" style={{ borderColor: t.hair }}>
        <div className="order-1 flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={changeWork}
            className="shrink-0 flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-xl font-mono text-[11px] sm:text-xs uppercase tracking-[0.12em] cursor-pointer shadow-sm transition-transform active:scale-95"
            style={{ backgroundColor: t.gold, color: t.bg }}
            title="Pick another opera or musical"
          >
            <ArrowLeftRight className="w-4 h-4" strokeWidth={2.25} />
            <span>Change<span className="hidden sm:inline"> opera</span></span>
          </button>
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? 'Hide contents' : 'Show contents'}
            aria-pressed={navOpen}
            title={navOpen ? 'Hide contents' : 'Show contents'}
            className="p-2 rounded-full cursor-pointer shrink-0"
            style={{ color: navOpen ? t.gold : t.dim }}
          >
            <ListTree className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <p className="flex items-center gap-2 min-w-0">
              <span className="text-xl truncate" style={{ fontFamily: FONTS[0].family, fontStyle: 'italic' }}>
                {title}
              </span>
              {translated && (
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wider"
                  style={{ color: t.gold, borderColor: t.gold }}
                  title="Every line has an English translation"
                >
                  Translated
                </span>
              )}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] truncate" style={{ color: t.dim }}>
              {where}
            </p>
          </div>
        </div>
        <div className="order-3 sm:order-2 w-full sm:w-auto flex items-center gap-2 flex-wrap sm:justify-end">
          <div role="group" aria-label="Follow mode" className="flex rounded-full border overflow-hidden" style={{ borderColor: t.hair }}>
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                aria-pressed={prefs.sync === on}
                onClick={() => set({ sync: on })}
                className="px-2.5 sm:px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider cursor-pointer"
                style={{ color: prefs.sync === on ? t.bg : t.dim, backgroundColor: prefs.sync === on ? t.gold : 'transparent' }}
                title={on ? 'The microphone and camera move the place' : 'Only you move the place'}
              >
                {on ? 'Synced' : 'Manual'}
              </button>
            ))}
          </div>
          {score && (
            <button type="button" onClick={() => setScoreOpen((v) => !v)} className={chip} style={chipStyle(scoreOpen)} aria-pressed={scoreOpen} aria-label={scoreOpen ? 'Hide the score' : 'Show the vocal score'}>
              <Music2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Score</span>
            </button>
          )}
          <button type="button" onClick={() => setScanning(true)} className={chip} style={chipStyle(scanning)} aria-label="Read subtitles with the camera">
            <ScanText className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Scan</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen((v) => !v)} className={chip} style={chipStyle(settingsOpen)} aria-label="Reading settings" aria-expanded={settingsOpen}>
            <Settings2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Style</span>
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            className={chip}
            style={chipStyle(chatOpen)}
            aria-pressed={chatOpen}
            aria-label={chatOpen ? 'Hide the Argon sidebar' : 'Show the Argon sidebar'}
            title={chatOpen ? 'Hide the Argon sidebar' : 'Ask Argon anything about this work'}
          >
            <ArgonMark className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Argon</span>
          </button>
        </div>
        <div className="order-2 sm:order-3 flex items-center gap-2">
          <button
            type="button"
            onClick={fullscreen ? exit : enter}
            className={chip}
            style={chipStyle(fullscreen)}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </button>
        </div>
      </div>

      {libretto && total > 0 && (
        <div className="h-0.5" style={{ backgroundColor: t.hair }}>
          <div className="h-full" style={{ width: `${((lineIdx + 1) / total) * 100}%`, backgroundColor: t.accent }} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex relative">
        {navOpen && (
          <button
            type="button"
            aria-label="Hide contents"
            onClick={() => setNavOpen(false)}
            className="md:hidden absolute inset-0 z-[9] cursor-default"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
        )}
        {navOpen && (
          <aside
            className="absolute md:relative inset-y-0 left-0 z-10 w-[min(18rem,85%)] md:w-[var(--nav-w)] shrink-0 border-r"
            style={{ backgroundColor: t.panel, borderColor: t.hair, ['--nav-w' as string]: `${prefs.navWidth}px` }}
          >
            <ResizeHandle
              theme={t}
              edge="right"
              width={prefs.navWidth}
              min={NAV_WIDTH.min}
              max={NAV_WIDTH.max}
              reset={DEFAULT_PREFS.navWidth}
              onWidth={(w) => set({ navWidth: w })}
              label="Resize the contents"
            />
            <Sidebar
              theme={t}
              doc={merged}
              currentSection={curSectionId}
              onSection={goSection}
              onEntry={(_, entryId) => {
                goTo(`e:${entryId}`);
                if (window.innerWidth < 768) setNavOpen(false);
              }}
              onAddTyped={libretto ? undefined : (text) => addWords(text, 'typed')}
              onAsk={askArgon}
              focusRef={jumpRef}
            />
          </aside>
        )}

        <main className="flex-1 min-w-0 flex flex-col relative">
          <div className="flex-1 min-h-0 relative">
            {prefs.layout === 'scroll' ? (
              <ScrollStage
                key={prefs.axis}
                slides={slides}
                at={at}
                prefs={prefs}
                t={t}
                sectionOrder={sectionOrder}
                curOrder={sectionOrder.get(curSectionId) ?? 0}
                hasLibretto={merged.hasLibretto}
                revealed={revealed}
                onReveal={(id) => setRevealed((r) => new Set(r).add(id))}
                explained={explained}
                onExplain={libretto ? explain : undefined}
                onExplainMore={explainMore}
                onCharacter={openCharacter}
                onGo={goTo}
                emptyHint={!libretto && noEntries}
                translating={fill.pending}
                score={scoreOpen ? score : null}
              />
            ) : (
              <TapStage
                slides={slides}
                at={at}
                prefs={prefs}
                t={t}
                revealed={revealed}
                curOrder={sectionOrder.get(curSectionId) ?? 0}
                sectionOrder={sectionOrder}
                hasLibretto={merged.hasLibretto}
                onReveal={(id) => setRevealed((r) => new Set(r).add(id))}
                explained={explained}
                onExplain={libretto ? explain : undefined}
                onExplainMore={explainMore}
                onCharacter={openCharacter}
                onStep={step}
                emptyHint={!libretto && noEntries}
                translating={fill.pending}
                score={scoreOpen ? score : null}
              />
            )}
            {notice && (
              <p className="absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded-full border font-mono text-[11px]" style={{ backgroundColor: t.panel, borderColor: t.hair, color: t.ink }}>
                {notice}
              </p>
            )}
          </div>

          {(listening || listener.error || listener.busy) && (
            <div className="px-4 py-2 border-t text-center space-y-1" style={{ borderColor: t.hair }} aria-live="polite">
              {listener.error && (
                <p className="text-sm" style={{ color: t.accent }}>
                  {listener.error}
                </p>
              )}
              {listening && !listener.aiOn && (
                <p className="text-[11px] font-mono" style={{ color: t.dim }}>
                  Argon isn’t available on the server, so the room can’t be followed by ear.
                </p>
              )}
              {listening && (
                <p className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: t.dim }}>
                  {listener.busy ? 'Working out where we are…' : 'Listening…'}
                  {libretto && listener.synced && ` · ${listener.synced.via === 'correct' ? 'corrected to' : 'synced to'} line ${listener.synced.line + 1}`}
                </p>
              )}
            </div>
          )}

          <div className="px-3 sm:px-4 pt-3 pb-4 border-t space-y-3" style={{ borderColor: t.hair }}>
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              {listener.supported ? (
                <button
                  type="button"
                  onClick={() => {
                    if (listening) return listener.stop();
                    // Listening is what syncing is for: pressing it in Manual switches to Synced.
                    if (!prefs.sync) set({ sync: true });
                    void listener.start();
                  }}
                  disabled={listener.state === 'starting'}
                  aria-pressed={listening}
                  title={listening ? 'Stop listening' : 'Listen to the performance and keep the words in step with it'}
                  className="relative flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full font-mono text-xs sm:text-sm uppercase tracking-[0.14em] cursor-pointer text-white shadow-lg transition-transform active:scale-95 disabled:opacity-70"
                  style={{
                    backgroundColor: listening ? '#B3122E' : '#D7263D',
                    boxShadow: listening ? `0 0 0 ${3 + Math.round(listener.level * 10)}px rgba(215,38,61,0.28)` : '0 6px 18px rgba(215,38,61,0.35)',
                    transition: 'box-shadow 120ms linear, transform 120ms ease',
                  }}
                >
                  {listening ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Mic className="w-4 h-4" />}
                  {listening ? 'Listening · stop' : listener.state === 'starting' ? 'Starting…' : 'Listen'}
                  {listening && (
                    <span aria-hidden className="flex items-end gap-[2px] h-3.5 ml-0.5">
                      {[0.55, 1, 0.75].map((k, i) => (
                        <span key={i} className="w-[3px] rounded-full bg-white" style={{ height: `${Math.max(18, Math.min(100, listener.level * 140 * k))}%`, transition: 'height 100ms linear' }} />
                      ))}
                    </span>
                  )}
                </button>
              ) : (
                <span className="text-xs font-mono" style={{ color: t.dim }}>
                  This browser can’t use the microphone.
                </span>
              )}
              {libretto && listening && listener.guess != null && listener.guess > lineIdx && (
                <button
                  type="button"
                  onClick={listener.jump}
                  title={`Move to line ${listener.guess + 1}, where Argon thinks the room is`}
                  className={chip}
                  style={chipStyle(false)}
                >
                  Jump to sync
                </button>
              )}
              {libretto && listening && (
                <button
                  type="button"
                  onClick={() => {
                    listener.correct();
                    flash(`Sync corrected to line ${lineIdx + 1}`);
                  }}
                  title="The line shown now is where the performance is: Argon carries on from here and won’t go back to its earlier guess"
                  className={chip}
                  style={chipStyle(listener.synced?.via === 'correct' && Date.now() - listener.synced.at < 4000)}
                >
                  Correct sync
                </button>
              )}
              <button type="button" className={chip} style={chipStyle(prefs.translation)} aria-pressed={prefs.translation} onClick={() => set({ translation: !prefs.translation })}>
                Translation
              </button>
              <button type="button" className={chip} style={chipStyle(prefs.explanation)} aria-pressed={prefs.explanation} onClick={() => set({ explanation: !prefs.explanation })}>
                <ArgonMark className="w-3.5 h-3.5" /> Explain · Argon
              </button>
              <button
                type="button"
                className={`${chip} hidden sm:flex`}
                style={chipStyle(false)}
                onClick={() => set({ size: prefs.size >= 1.6 ? 0.8 : Math.round((prefs.size + 0.2) * 10) / 10 })}
                aria-label="Change text size"
              >
                Aa
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={at === 0}
                className={`${prefs.layout === 'tap' ? 'py-4' : 'py-2.5'} rounded-xl border font-mono text-sm uppercase tracking-wider cursor-pointer disabled:opacity-30 flex items-center justify-center gap-2`}
                style={{ borderColor: t.hair }}
              >
                <ArrowLeft className="w-4 h-4" style={prefs.axis === 'vertical' ? { transform: 'rotate(90deg)' } : undefined} /> Back
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={at >= slides.length - 1}
                className={`${prefs.layout === 'tap' ? 'py-4' : 'py-2.5'} rounded-xl font-mono text-sm uppercase tracking-wider cursor-pointer disabled:opacity-30 flex items-center justify-center gap-2`}
                style={{ backgroundColor: t.accent, color: t.id === 'contrast' || t.id === 'page' ? t.bg : '#fff' }}
              >
                Next <ArrowRight className="w-4 h-4" style={prefs.axis === 'vertical' ? { transform: 'rotate(90deg)' } : undefined} />
              </button>
            </div>
          </div>

          {settingsOpen && <SettingsPanel theme={t} prefs={prefs} set={set} onClose={() => setSettingsOpen(false)} />}
        </main>

        {chatOpen && (
          <>
            <button
              type="button"
              aria-label="Hide the Argon sidebar"
              onClick={() => setChatOpen(false)}
              className="md:hidden absolute inset-0 z-[9] cursor-default"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            />
            <aside
              className="absolute md:relative inset-y-0 right-0 z-10 w-[min(22rem,92%)] md:w-[var(--chat-w)] shrink-0 border-l"
              style={{ backgroundColor: t.panel, borderColor: t.hair, ['--chat-w' as string]: `${prefs.chatWidth}px` }}
            >
              <ResizeHandle
                theme={t}
                edge="left"
                width={prefs.chatWidth}
                min={CHAT_WIDTH.min}
                max={CHAT_WIDTH.max}
                reset={DEFAULT_PREFS.chatWidth}
                onWidth={(w) => set({ chatWidth: w })}
                label="Resize the Argon sidebar"
              />
              <div className="flex flex-col h-full min-h-0">
              <SideTabs theme={t} tab={sideTab} onTab={setSideTab} />
              <div className="flex-1 min-h-0">
              {sideTab === 'info' ? (
                <CharacterInfo
                  theme={t}
                  who={info.who}
                  profile={info.profile}
                  status={info.status}
                  scene={scene}
                  onPick={openCharacter}
                  onRetry={info.retry}
                  onClose={() => setChatOpen(false)}
                />
              ) : (
              <ArgonChat
                theme={t}
                title={title}
                messages={chat.messages}
                busy={chat.busy}
                onAsk={(q) => void chat.ask(q)}
                onJump={(id) => jumpTo.current(id)}
                onLine={(slideId) => {
                  goTo(slideId);
                  if (narrow()) setChatOpen(false);
                }}
                onClear={chat.clear}
                onClose={() => setChatOpen(false)}
                commentary={prefs.commentary}
                commentaryBusy={commentary.busy}
                onCommentary={(on) => set({ commentary: on })}
                suggestions={suggestions}
                inputRef={chatInput}
              />
              )}
              </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {scanning && <SubtitleScanner theme={t} language={subject.language} onRead={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------------------------ */

interface StageProps {
  slides: Slide[];
  at: number;
  prefs: FollowPrefs;
  t: Theme;
  sectionOrder: Map<string, number>;
  curOrder: number;
  hasLibretto: boolean;
  revealed: Set<string>;
  onReveal: (sectionId: string) => void;
  explained: Record<string, { subtext: string; cue: string } | 'loading'>;
  onExplain?: (e: DocEntry) => void;
  /** Hand the line to Argon's sidebar for a longer answer. */
  onExplainMore?: (e: DocEntry) => void;
  /** Open a character's profile in the Info panel. */
  onCharacter?: (name: string) => void;
  emptyHint: boolean;
  /** Argon is fetching English the offline translations lack. */
  translating: boolean;
  /** The vocal score, shown under the line being read. */
  score?: ScoreMap | null;
}

/** Type sizes in rem, before the reader's size setting. */
const BASE = { original: 2.1, translation: 1.1, explain: 0.92 };

/** The original, its translation and the explanation, in the reader's font and colours. */
const SlideBody: React.FC<
  Pick<StageProps, 't' | 'prefs' | 'hasLibretto' | 'revealed' | 'onReveal' | 'explained' | 'onExplain' | 'onExplainMore' | 'onCharacter' | 'translating' | 'score'> & {
    slide: Slide;
    active: boolean;
    curOrder: number;
    order: number;
    scale?: number;
  }
> = ({ slide, active, t, prefs, hasLibretto, revealed, onReveal, explained, onExplain, onExplainMore, onCharacter, translating, score, curOrder, order, scale = 1 }) => {
  const f = fontOf(prefs);
  const bodyFont = f.italic ? FONTS[1].family : f.family;
  const px = (n: number) => `${n * prefs.size * scale}rem`;
  const { section, entry } = slide;

  // Original and English together: stacked, or in two columns with English on the chosen side. Side by side holds its
  // columns even while the English is still coming, so the layout doesn't jump when it lands.
  const columns = prefs.sideBySide && prefs.original && prefs.translation;
  const waiting = (
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] pt-2" style={{ color: t.faint }}>
      {translating ? 'Translating…' : '—'}
    </p>
  );
  const pair = (original: React.ReactNode | null, english: React.ReactNode | null) => {
    if (original && columns && !english) english = waiting;
    if (original && english && prefs.sideBySide) {
      const cols = prefs.englishSide === 'right' ? [original, english] : [english, original];
      return (
        <div className="grid grid-cols-2 gap-x-5 sm:gap-x-10 text-left items-start">
          {cols.map((c, i) => (
            <div key={i} className="min-w-0 space-y-1">
              {c}
            </div>
          ))}
        </div>
      );
    }
    return (
      <>
        {original}
        {english}
      </>
    );
  };

  if (!entry) {
    // A synopsis can give the story away, so a part that has not been reached stays closed until asked for.
    const locked = !hasLibretto && section.id !== 'overview' && order > curOrder && !revealed.has(section.id);
    const showEnglish = !!section.summaryTranslation && prefs.translation;
    const showOriginal = !showEnglish || prefs.original;
    const summaryStyle = { color: active ? t.ink : t.dim, opacity: active ? 0.85 : 1, fontFamily: bodyFont, fontSize: px(0.98), fontStyle: 'italic' } as const;
    return (
      <div className="space-y-2 text-center">
        <p
          className={section.level === 1 ? 'font-mono uppercase tracking-[0.2em]' : 'italic'}
          style={section.level === 1 ? { color: t.accent, fontSize: '0.8rem' } : { color: t.accent, fontFamily: bodyFont, fontSize: px(1.15) }}
        >
          {section.title}
        </p>
        {section.summary && !locked && (
          <div className={`${columns && showOriginal ? 'max-w-4xl' : 'max-w-2xl'} mx-auto space-y-2`}>
            {pair(
              showOriginal ? (
                <p className="leading-relaxed" style={summaryStyle}>
                  {section.summary}
                </p>
              ) : null,
              showEnglish ? (
                <p className="leading-relaxed" style={{ ...summaryStyle, ...(showOriginal ? { fontStyle: 'normal', opacity: active ? 0.7 : 0.8, fontSize: px(0.88) } : {}) }}>
                  {section.summaryTranslation}
                </p>
              ) : null
            )}
          </div>
        )}
        {locked && (
          <button type="button" onClick={() => onReveal(section.id)} className="font-mono text-[10px] uppercase tracking-[0.18em] cursor-pointer underline underline-offset-4" style={{ color: t.dim }}>
            Contains spoilers · tap to read
          </button>
        )}
      </div>
    );
  }

  const ex = explained[entry.id];
  // Live commentary brings the explanations with it.
  const showExplain = (prefs.explanation || prefs.commentary) && active;
  // Who sings, in each language: over each column side by side ("DIAVOLO" | "Devil"), or together when stacked.
  const nameStyle = { color: t.accent } as const;
  // A name opens that character in the Info panel.
  const who = (text: string, extra?: React.ReactNode, cls = '') =>
    onCharacter && entry.who ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCharacter(entry.who!);
        }}
        className={`${cls} cursor-pointer underline-offset-4 hover:underline focus-visible:underline`}
        style={nameStyle}
        title={`Who is ${entry.whoEn || entry.who}?`}
      >
        {text}
        {extra}
      </button>
    ) : (
      <span className={cls} style={nameStyle}>
        {text}
        {extra}
      </span>
    );
  const name = (text: string, english?: boolean) => (
    <p className={`font-mono text-xs uppercase tracking-[0.2em] ${english ? 'opacity-80' : ''}`}>{who(text)}</p>
  );
  const showNames = prefs.names && !!entry.who;
  const enName = entry.whoEn || entry.who || '';
  const split = columns;
  return (
    <div className="space-y-3 text-center">
      {showNames && !split && (
        <p className="font-mono text-xs uppercase tracking-[0.2em]">
          {who(entry.who!, prefs.translation && entry.whoEn ? <span className="opacity-70 normal-case tracking-[0.12em]"> · {entry.whoEn}</span> : undefined)}
        </p>
      )}
      {pair(
        prefs.original ? (
          <>
            {showNames && split && name(entry.who!)}
            <p className="leading-[1.18]" style={{ fontFamily: f.family, fontStyle: f.italic ? 'italic' : 'normal', fontSize: px(prefs.sideBySide ? BASE.original * 0.8 : BASE.original) }}>
              {entry.kind === 'line' ? `“${entry.text}”` : entry.text}
            </p>
          </>
        ) : null,
        prefs.translation && entry.translation ? (
          <>
            {showNames && split && name(enName, true)}
            <p className="leading-relaxed" style={{ color: t.ink, opacity: 0.8, fontFamily: bodyFont, fontSize: px(prefs.sideBySide && prefs.original ? BASE.translation * 1.2 : BASE.translation) }}>
              {entry.translation}
            </p>
          </>
        ) : showNames && split ? (
          <>
            {name(enName, true)}
            {waiting}
          </>
        ) : null
      )}
      {showExplain && entry.subtext && (
        <p className="leading-relaxed italic" style={{ color: t.gold, fontFamily: bodyFont, fontSize: px(BASE.explain) }}>
          {sentences(entry.subtext, 2)}
        </p>
      )}
      {showExplain && ex && ex !== 'loading' && (
        <div className="space-y-1">
          {ex.subtext && ex.subtext !== entry.subtext && (
            <p className="leading-relaxed italic" style={{ color: t.gold, fontFamily: bodyFont, fontSize: px(BASE.explain) }}>
              {ex.subtext}
            </p>
          )}
          {ex.cue && (
            <p className="leading-relaxed" style={{ color: t.dim, fontFamily: bodyFont, fontSize: px(BASE.explain) }}>
              {ex.cue}
            </p>
          )}
        </div>
      )}
      {score && entry.libIdx != null && (active || score.boxes?.[entry.libIdx]) && <InlineScore theme={t} score={score} line={entry.libIdx} active={active} />}
      {showExplain && onExplain && !ex && !prefs.commentary && (
        <ArgonButton label="Ask Argon to explain this line" onClick={() => onExplain(entry)} />
      )}
      {showExplain && onExplainMore && ex !== 'loading' && (ex || entry.subtext || !onExplain) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExplainMore(entry);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-mono text-[10px] uppercase tracking-wider cursor-pointer"
          style={{ borderColor: t.gold, color: t.gold }}
        >
          <ArgonMark className="w-3 h-3" /> Explain more
        </button>
      )}
      {showExplain && ex === 'loading' && (
        <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: t.dim }}>
          Thinking…
        </p>
      )}
    </div>
  );
};

const EmptyHint: React.FC<{ t: Theme }> = ({ t }) => (
  <div className="text-center space-y-2 py-4 max-w-md mx-auto">
    <p className="text-2xl italic" style={{ fontFamily: FONTS[0].family }}>
      Hold the phone towards the stage.
    </p>
    <p className="text-sm leading-relaxed" style={{ color: t.dim, fontFamily: FONTS[1].family }}>
      Press Listen and the words are written out as they are sung, with an English translation and a line on what is happening. You can
      also type some of the words into the box on the left, or scan the subtitles. This work has no stored libretto, so everything shown
      is what was actually heard.
    </p>
  </div>
);

/**
 * Falls off from the current line: how faint, small and blurred a slide is at a given distance. Only the near
 * neighbours are blurred: a filter on every line makes phones (Safari above all) composite each one, and with a long
 * work that is enough to drop frames or paint the reader black.
 */
const falloff = (d: number, focus: boolean) => {
  if (d === 0) return { opacity: 1, scale: 1, blur: 0 };
  if (!focus) return { opacity: 0.55, scale: 1, blur: 0 };
  const k = Math.min(d, 4);
  return { opacity: Math.max(0.16, 0.5 - (k - 1) * 0.12), scale: Math.max(0.82, 0.94 - (k - 1) * 0.03), blur: d <= 3 ? k * 0.7 : 0 };
};

/**
 * Continuous scroll, vertical like a lyrics view or horizontal like a carousel. The current slide is spring-centred; the
 * rest fall away. Scrolling by hand browses (synced: it returns to the place after a pause; manual: it moves the place).
 */
const ScrollStage: React.FC<StageProps & { onGo: (id: string) => void }> = (props) => {
  const { slides, at, prefs, t, onGo } = props;
  const horizontal = prefs.axis === 'horizontal';
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const spring = useRef<SpringScroller | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const browseRef = useRef(false);
  const timer = useRef(0);
  const first = useRef(true);

  // Centred, unless the slide is taller (or wider) than the stage: then its start, so a long synopsis reads from the top.
  const target = useCallback(
    (el: HTMLElement) => {
      const c = box.current;
      if (!c) return 0;
      const view = horizontal ? c.clientWidth : c.clientHeight;
      const size = horizontal ? el.offsetWidth : el.offsetHeight;
      const start = horizontal ? el.offsetLeft : el.offsetTop;
      return size > view * 0.9 ? start - view * 0.05 : start - (view - size) / 2;
    },
    [horizontal]
  );

  useEffect(() => {
    if (!box.current) return;
    spring.current = springScroller(box.current, horizontal ? 'x' : 'y');
    first.current = true;
    return () => spring.current?.stop();
  }, [horizontal]);

  const center = useCallback(
    (snap: boolean) => {
      const el = els.current.get(slides[at]?.id ?? '');
      if (!el || !spring.current) return;
      snap ? spring.current.snap(target(el)) : spring.current.to(target(el));
    },
    [slides, at, target]
  );

  // Glide to the current slide whenever it changes, unless the person is looking around.
  useEffect(() => {
    if (browseRef.current) return;
    center(first.current);
    first.current = false;
  }, [center]);

  // Keep it centred when the box or the current slide changes size (web fonts arriving, an explanation opening).
  useEffect(() => {
    const c = box.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => !browseRef.current && center(true));
    ro.observe(c);
    const cur = els.current.get(slides[at]?.id ?? '');
    if (cur) ro.observe(cur);
    return () => ro.disconnect();
  }, [center, slides, at]);

  const nearest = () => {
    const c = box.current;
    if (!c) return '';
    const mid = horizontal ? c.scrollLeft + c.clientWidth / 2 : c.scrollTop + c.clientHeight / 2;
    let best = '';
    let bestD = Infinity;
    els.current.forEach((el, id) => {
      const m = horizontal ? el.offsetLeft + el.clientWidth / 2 : el.offsetTop + el.clientHeight / 2;
      const d = Math.abs(m - mid);
      if (d < bestD) (bestD = d), (best = id);
    });
    return best;
  };

  // The browse timer fires seconds later, by when the room may have moved the place: read the latest, not this render's.
  const latest = useRef({ slides, at, center, onGo, sync: prefs.sync });
  latest.current = { slides, at, center, onGo, sync: prefs.sync };

  // A finger or a wheel takes over from the spring at once, instead of fighting it until the glide ends.
  const takeOver = () => spring.current?.stop();

  const onScroll = () => {
    if (spring.current?.active()) return;
    if (!browseRef.current) {
      browseRef.current = true;
      setBrowsing(true);
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        browseRef.current = false;
        setBrowsing(false);
        const { slides: ss, at: now, center: recenter, onGo: go, sync } = latest.current;
        const id = nearest();
        // Still on the current slide (reading down a long one): stay put. Otherwise, manual: where you stopped is the
        // place; synced: back to where the room is.
        if (id === ss[now]?.id) return;
        if (!sync && id) go(id);
        else recenter(false);
      },
      prefs.sync ? BROWSE_MS : 160
    );
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const gap = horizontal ? 'gap-6' : 'gap-8';
  const pad = horizontal ? 'calc((100% - min(80%, 42rem)) / 2)' : '44%';
  return (
    <div
      ref={box}
      onScroll={onScroll}
      onWheel={takeOver}
      onTouchStart={takeOver}
      className={`absolute inset-0 flex ${horizontal ? 'flex-row items-center overflow-x-auto' : 'flex-col overflow-y-auto'} ${gap}`}
      style={{ scrollbarWidth: 'none' }}
    >
      <div aria-hidden style={{ flex: `0 0 ${pad}` }} />
      {slides.map((s, i) => {
        const f = falloff(Math.abs(i - at), prefs.focus && !browsing);
        return (
          <div
            key={s.id}
            ref={(el) => {
              el ? els.current.set(s.id, el) : els.current.delete(s.id);
            }}
            role="button"
            tabIndex={-1}
            aria-current={i === at ? 'true' : undefined}
            onClick={() => i !== at && onGo(s.id)}
            className={`shrink-0 px-6 cursor-pointer ${horizontal ? '' : 'w-full max-w-3xl mx-auto'}`}
            style={{
              flexBasis: horizontal ? 'min(80%, 42rem)' : undefined,
              opacity: browsing ? Math.max(f.opacity, 0.6) : f.opacity,
              transform: `scale(${f.scale})`,
              filter: f.blur ? `blur(${f.blur}px)` : undefined,
              transition: 'opacity 400ms ease, transform 400ms ease, filter 400ms ease',
            }}
          >
            <SlideBody {...props} slide={s} active={i === at} order={props.sectionOrder.get(s.section.id) ?? 0} />
          </div>
        );
      })}
      {props.emptyHint && (
        <div className="shrink-0 px-6" style={{ flexBasis: horizontal ? 'min(80%, 42rem)' : undefined }}>
          <EmptyHint t={t} />
        </div>
      )}
      <div aria-hidden style={{ flex: `0 0 ${pad}` }} />
    </div>
  );
};

/** One slide at a time, big, with the neighbours faint beside it; swipe or tap Back/Next. */
const TapStage: React.FC<Omit<StageProps, 'onExplain'> & { onExplain?: StageProps['onExplain']; onStep: (d: number) => void }> = (props) => {
  const { slides, at, prefs, t, onStep } = props;
  const horizontal = prefs.axis === 'horizontal';
  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = useRef(at);
  const dir = at >= last.current ? 1 : -1;
  useEffect(() => {
    last.current = at;
  }, [at]);
  const slide = slides[at];
  const prev = slides[at - 1];
  const next = slides[at + 1];
  const peek = (s?: Slide) => (s?.entry ? s.entry.text : s ? s.section.title : '');
  const peekStyle: React.CSSProperties = { color: t.faint, fontFamily: fontOf(prefs).family, fontStyle: fontOf(prefs).italic ? 'italic' : 'normal' };

  return (
    <div
      className="absolute inset-0 flex flex-col justify-center gap-6 px-6 py-6 overflow-y-auto"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        const d = horizontal ? dx : dy;
        if (Math.abs(d) > 60 && Math.abs(d) > Math.abs(horizontal ? dy : dx)) onStep(d < 0 ? 1 : -1);
      }}
    >
      {!slide && props.emptyHint && <EmptyHint t={t} />}
      {prev && !horizontal && <p className="text-lg truncate text-center max-w-3xl w-full mx-auto">{<span style={peekStyle}>{peek(prev)}</span>}</p>}
      <div
        key={slide?.id}
        className="follow-anim max-w-3xl w-full mx-auto"
        style={{
          animation: `${horizontal ? 'follow-in-x' : 'follow-in-y'} 320ms ease both`,
          ['--dx' as string]: `${dir * 28}px`,
          ['--dy' as string]: `${dir * 28}px`,
        }}
      >
        {slide && <SlideBody {...props} slide={slide} active order={props.sectionOrder.get(slide.section.id) ?? 0} scale={1.2} />}
        {props.emptyHint && slide && !slide.entry && <div className="pt-8"><EmptyHint t={t} /></div>}
      </div>
      {next && !horizontal && <p className="text-lg truncate text-center max-w-3xl w-full mx-auto">{<span style={peekStyle}>{peek(next)}</span>}</p>}
    </div>
  );
};
