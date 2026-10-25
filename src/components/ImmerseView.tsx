import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import type { LibrettoText, LibrettoTextIndex, RepertoireDetail, RepertoireIndex, RepertoireWork, WorkAndLibretto } from '../types/sottovoce';
import { loadDetail, Thumb, useRepertoire } from './RepertoireCatalogue';
import { WorkPicker } from './WorkPicker';
import type { ListenSubject } from './useLiveListener';
import { buildLibrettoDoc, buildSynopsisDoc } from '../utils/followDoc';
import { buildTextDoc, loadText, loadTextIndex } from '../utils/librettoText';
import { lyricTokens } from '../utils/lyricMatch';
import { FollowReader } from './follow/FollowReader';
import { immersePath } from '../utils/urlState';

/** What Immerse is following: a work with a synced libretto, a repertoire work (listen-only), or a show known only by name. */
export type ImmerseTarget =
  | { kind: 'libretto'; id: string }
  | { kind: 'rep'; id: string; venue?: string }
  | { kind: 'show'; title: string; venue?: string };

interface ImmerseViewProps {
  target: ImmerseTarget | null;
  works: WorkAndLibretto[];
  lineIdx: number;
  onLineChange: (idx: number) => void;
  onPick: (target: ImmerseTarget | null) => void;
  /** The repertoire work (if any) that has a libretto of its own here, by title. */
  libretto: (w: RepertoireWork) => string | undefined;
  onOpenLive: () => void;
}

const DIM = 'rgba(250,246,240,0.55)';
const GOLD = '#C9A24B';

const chip = 'px-3 py-1.5 rounded-full border font-mono text-[11px] uppercase tracking-wider cursor-pointer';
const chipStyle = (on: boolean): React.CSSProperties => ({
  borderColor: on ? GOLD : 'rgba(250,246,240,0.25)',
  color: on ? GOLD : 'rgba(250,246,240,0.7)',
});

/**
 * Immerse: low-light follow-along for use during a performance. Pick a work (or let Live find it), then follow it line by
 * line, or just listen: the microphone is transcribed, translated and explained as it goes.
 */
export const ImmerseView: React.FC<ImmerseViewProps> = (props) => (
  <ImmerseBoundary resetKey={JSON.stringify(props.target)} onReset={() => props.onPick(null)}>
    <ImmerseContent {...props} />
  </ImmerseBoundary>
);

/**
 * A failure inside the reader (a browser API that throws, unexpected data) must not take the whole app down with it:
 * the page would go blank on its dark background. Show what happened and a way back instead.
 */
class ImmerseBoundary extends React.Component<{ resetKey: string; onReset: () => void; children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Immerse failed', error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl p-6 space-y-4" style={{ backgroundColor: '#050406', color: '#FAF6F0' }}>
        <p className="font-instrument italic text-2xl">Immerse hit a problem.</p>
        <p className="text-xs font-mono" style={{ color: DIM }}>
          {this.state.error.message || 'Something went wrong while showing this work.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className={chip} style={chipStyle(true)}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
            className={chip}
            style={chipStyle(false)}
          >
            Pick another work
          </button>
        </div>
      </div>
    );
  }
}

const ImmerseContent: React.FC<ImmerseViewProps> = ({ target, works, lineIdx, onLineChange, onPick, libretto, onOpenLive }) => {
  if (target?.kind === 'libretto') {
    const work = works.find((w) => w.work_id === target.id);
    if (work) return <LibrettoImmerse work={work} works={works} lineIdx={lineIdx} onLineChange={onLineChange} onChange={() => onPick(null)} />;
  }
  if (target?.kind === 'rep') {
    return <RepImmerse id={target.id} venue={target.venue} libretto={libretto} onPick={onPick} onChange={() => onPick(null)} />;
  }
  if (target?.kind === 'show') {
    return <ListenImmerse subject={{ title: target.title, venue: target.venue }} byline={target.venue ?? ''} onChange={() => onPick(null)} />;
  }
  return <ImmerseHome works={works} onPick={onPick} libretto={libretto} onOpenLive={onOpenLive} />;
};

/** The full-libretto index, once loaded (null when none is deployed). */
function useTextIndex(): LibrettoTextIndex | null | undefined {
  const [idx, setIdx] = useState<LibrettoTextIndex | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadTextIndex().then((i) => live && setIdx(i));
    return () => {
      live = false;
    };
  }, []);
  return idx;
}

/** The repertoire entry a hand-made libretto belongs to: same title, and a composer with the same surname. */
function catalogueIdFor(work: WorkAndLibretto, index: RepertoireIndex | null): string | undefined {
  const surname = norm(work.composer).split(' ').at(-1) ?? '';
  return index?.works.find((w) => norm(w.title) === norm(work.title) && w.composers.some((c) => norm(c).endsWith(surname)))?.id;
}

/** "Antonio CALDARA" → "Antonio Caldara". */
const unshout = (s: string) => s.replace(/\b(\p{Lu})(\p{Lu}+)\b/gu, (_, a: string, b: string) => a + b.toLowerCase());

interface Card {
  key: string;
  title: string;
  byline: string;
  detail?: string;
  /** Repertoire work, for the thumbnail. */
  rep?: RepertoireWork;
  translated?: boolean;
  target: ImmerseTarget;
}

const ImmerseHome: React.FC<Pick<ImmerseViewProps, 'works' | 'onPick' | 'libretto' | 'onOpenLive'>> = ({ works, onPick, libretto, onOpenLive }) => {
  const { index, error } = useRepertoire();
  const texts = useTextIndex();
  const targetFor = (w: RepertoireWork): ImmerseTarget => {
    const live = libretto(w);
    return live ? { kind: 'libretto', id: live } : { kind: 'rep', id: w.id };
  };

  // Works with every line stored come first: the hand-made ones (translated and annotated) that also have the whole
  // text, then the rest by how widely staged they are, then the texts missing from the catalogue. Excerpts follow.
  const { complete, excerpts, withText, withTranslation } = useMemo(() => {
    const stored = texts?.works ?? {};
    const byId = new Map(index?.works.map((w) => [w.id, w] as const) ?? []);
    const size = (id: string) => (stored[id] ? `${stored[id].acts} acts · ${stored[id].lines.toLocaleString()} lines` : undefined);
    const covered = new Set<string>();
    const translated: Card[] = [];
    const excerpts: Card[] = [];
    for (const w of works) {
      const id = catalogueIdFor(w, index);
      const card: Card = { key: w.work_id, title: w.title, byline: `${w.composer} · ${w.language}`, rep: id ? byId.get(id) : undefined, target: { kind: 'libretto', id: w.work_id } };
      if (id && stored[id]) {
        covered.add(id);
        translated.push({ ...card, translated: true, detail: size(id) });
      } else excerpts.push({ ...card, detail: `${w.lines.length} lines · excerpt` });
    }
    const catalogued: Card[] = [];
    const uncatalogued: Card[] = [];
    for (const [id, t] of Object.entries(stored)) {
      if (covered.has(id)) continue;
      const rep = byId.get(id);
      if (rep) {
        catalogued.push({ key: id, title: rep.title, byline: [rep.composers.join(', ') || 'Composer unknown', rep.year].filter(Boolean).join(' · '), detail: size(id), rep, translated: t.language !== 'English', target: { kind: 'rep', id } });
      } else if (t.title) {
        uncatalogued.push({ key: id, title: t.title, byline: unshout(t.composer ?? 'Composer unknown'), detail: size(id), translated: t.language !== 'English', target: { kind: 'rep', id } });
      }
    }
    catalogued.sort((a, b) => (b.rep?.popularity ?? 0) - (a.rep?.popularity ?? 0));
    uncatalogued.sort((a, b) => a.title.localeCompare(b.title));
    const complete = [...translated, ...catalogued, ...uncatalogued];
    return { complete, excerpts, withText: new Set(Object.keys(stored)), withTranslation: new Set([...Object.entries(stored)].filter(([id, t]) => t.language !== 'English' || covered.has(id)).map(([id]) => id)) };
  }, [works, index, texts]);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-instrument italic text-2xl">Immerse</p>
        <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
          Follow a performance with synced words, translation and explanations, by ear or by hand.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenLive}
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[#FAF6F0] bg-[#9E1B32] hover:bg-[#7F1527] font-mono text-xs uppercase tracking-[0.14em] cursor-pointer"
      >
        <Radio className="w-4 h-4" /> Live · find what I’m watching
      </button>
      {texts === undefined || (texts && !index && !error) ? (
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          Loading libretti…
        </p>
      ) : (
        complete.length > 0 && (
          <Carousel title="Complete libretti" note={`${complete.length} works · every act and scene`} cards={complete} onPick={onPick} />
        )
      )}
      {complete.length > 0 && <Downloaded cards={complete} onPick={onPick} />}
      {excerpts.length > 0 && <Carousel title="Excerpts, translated" note="Key scenes with translation and notes" cards={excerpts} onPick={onPick} />}
      <section className="space-y-3 max-w-xl">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          Any opera or musical, by ear
        </h2>
        <WorkPicker
          prefer={withText}
          translated={withTranslation}
          onPick={(w) => onPick(targetFor(w))}
          hrefFor={(w) => immersePath(targetFor(w))}
        />
      </section>
    </div>
  );
};

/** A row of work cards that scrolls sideways: swipe on touch, arrows on wider screens. */
/** Every opera whose whole libretto is stored on the site (so it reads offline from the first line), A to Z, with a filter. */
const Downloaded: React.FC<{ cards: Card[]; onPick: ImmerseViewProps['onPick'] }> = ({ cards, onPick }) => {
  const [q, setQ] = useState('');
  const sorted = useMemo(() => [...cards].sort((a, b) => a.title.localeCompare(b.title)), [cards]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? sorted.filter((c) => `${c.title} ${c.byline}`.toLowerCase().includes(n)) : sorted;
  }, [sorted, q]);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          All downloaded operas
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {cards.length} full libretti, each with an English translation, stored on the site and ready to read offline
        </p>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by title or composer"
        aria-label="Filter downloaded operas"
        className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
      />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              onClick={() => onPick(c.target)}
              data-href={immersePath(c.target)}
              className="w-full text-left rounded-lg border px-3 py-2 cursor-pointer transition-colors hover:border-[#C9A24B] flex items-center gap-2.5"
              style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <BookOpen className="w-4 h-4 shrink-0" strokeWidth={1.5} style={{ color: GOLD }} aria-hidden />
              <span className="min-w-0">
                <span className="block font-instrument italic text-base leading-tight truncate">{c.title}</span>
                <span className="block font-mono text-[10px] uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }}>
                  {c.byline}
                  {c.detail ? ` · ${c.detail}` : ''}
                </span>
              </span>
              {c.translated && (
                <span className="shrink-0 ml-auto font-mono text-[9px] uppercase tracking-wider" style={{ color: GOLD }}>
                  Translated
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          Nothing matches “{q}”.
        </p>
      )}
    </section>
  );
};

const Carousel: React.FC<{ title: string; note: string; cards: Card[]; onPick: ImmerseViewProps['onPick'] }> = ({ title, note, cards, onPick }) => {
  const row = useRef<HTMLUListElement>(null);
  const page = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  const arrow = 'hidden sm:flex w-8 h-8 items-center justify-center rounded-full border cursor-pointer';
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
            {title}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => page(-1)} aria-label={`Scroll ${title} back`} className={arrow} style={{ borderColor: 'var(--border-hairline)' }}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => page(1)} aria-label={`Scroll ${title} forward`} className={arrow} style={{ borderColor: 'var(--border-hairline)' }}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <ul ref={row} className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 [scrollbar-width:thin]">
        {cards.map((c) => (
          <li key={c.key} className="snap-start shrink-0 w-40 sm:w-44">
            <button
              type="button"
              onClick={() => onPick(c.target)}
              data-href={immersePath(c.target)}
              className="w-full h-full text-left rounded-xl border overflow-hidden cursor-pointer flex flex-col transition-colors hover:border-[#C9A24B]"
              style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <span className="relative block aspect-[4/3] overflow-hidden">
                {c.rep ? (
                  <Thumb w={c.rep} width={320} className="absolute inset-0 w-full h-full !rounded-none !border-0" iconClass="w-7 h-7" />
                ) : (
                  <span aria-hidden className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                    <BookOpen className="w-7 h-7" strokeWidth={1.5} />
                  </span>
                )}
                {c.translated && (
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider bg-black/70" style={{ color: GOLD }}>
                    Translated
                  </span>
                )}
              </span>
              <span className="block p-3 space-y-1 min-w-0">
                <span className="block font-instrument italic text-base leading-tight line-clamp-2">{c.title}</span>
                <span className="block font-mono text-[10px] uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }}>
                  {c.byline}
                </span>
                {c.detail && (
                  <span className="block font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {c.detail}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

interface LibrettoImmerseProps {
  work: WorkAndLibretto;
  works: WorkAndLibretto[];
  lineIdx: number;
  onLineChange: (idx: number) => void;
  onChange: () => void;
}

/** The full libretto for a catalogue work, if one is stored: undefined while loading, null when there is none. */
function useFullText(id: string | undefined): LibrettoText | null | undefined {
  const [text, setText] = useState<LibrettoText | null | undefined>(undefined);
  useEffect(() => {
    setText(undefined);
    if (!id) return setText(null);
    let live = true;
    loadTextIndex()
      .then((idx) => (idx?.works[id] ? loadText(id) : null))
      .then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [id]);
  return text;
}

const norm = (s: string) => lyricTokens(s).join(' ');

/** A work with a stored libretto: its lines in the reader, followed by hand or by ear. */
const LibrettoImmerse: React.FC<LibrettoImmerseProps> = ({ work, lineIdx, onLineChange, onChange }) => {
  // The hand-made libretto is an excerpt; when the whole text is stored, it fills out every act and scene.
  const { index } = useRepertoire();
  const catalogueId = catalogueIdFor(work, index);
  const full = useFullText(index ? catalogueId : undefined);
  const [localIdx, setLocalIdx] = useState(0);
  const built = useMemo(() => (full ? buildTextDoc(full, { composer: work.composer, librettist: work.librettist }, work) : null), [full, work]);
  const doc = useMemo(() => built?.doc ?? buildLibrettoDoc(work), [built, work]);
  const shown = built?.work ?? work;
  const subject = useMemo<ListenSubject>(
    () => ({
      title: work.title,
      composer: work.composer,
      venue: work.venue_name,
      language: work.language,
      lead: work.happening_now,
      synopsis: work.synopsis_5min_ago,
    }),
    [work]
  );
  if (!index || full === undefined) return <ReaderLoading />;
  return (
    <FollowReader
      key={`${work.work_id}:${built ? 'full' : 'excerpt'}`}
      title={work.title}
      byline={`${work.composer} · ${work.language}`}
      doc={doc}
      subject={subject}
      libretto={shown}
      lineIdx={built ? localIdx : lineIdx}
      onLineChange={built ? setLocalIdx : onLineChange}
      onChange={onChange}
    />
  );
};

const ReaderLoading: React.FC = () => (
  <div className="rounded-2xl p-6 text-sm font-mono" style={{ backgroundColor: '#050406', color: DIM }}>
    Loading…
  </div>
);

/** A catalogue work whose whole libretto is stored: every act and scene, followed by ear or by hand. */
const TextImmerse: React.FC<{ text: LibrettoText; composer?: string; librettist?: string; byline: string; lead?: string; onChange: () => void }> = ({
  text,
  composer,
  librettist,
  byline,
  lead,
  onChange,
}) => {
  const { doc, work } = useMemo(() => buildTextDoc(text, { composer, librettist }), [text, composer, librettist]);
  const [lineIdx, setLineIdx] = useState(0);
  const subject = useMemo<ListenSubject>(
    () => ({ title: text.title, composer, language: text.language, lead }),
    [text, composer, lead]
  );
  return (
    <FollowReader
      key={text.id}
      title={text.title}
      byline={byline}
      doc={doc}
      subject={subject}
      libretto={work}
      lineIdx={lineIdx}
      onLineChange={setLineIdx}
      onChange={onChange}
    />
  );
};

/** A repertoire work: its background from Wikipedia, then the listen-only view. */
const RepImmerse: React.FC<{
  id: string;
  venue?: string;
  libretto: ImmerseViewProps['libretto'];
  onPick: ImmerseViewProps['onPick'];
  onChange: () => void;
}> = ({ id, venue, libretto, onPick, onChange }) => {
  const { index, error } = useRepertoire();
  const work = index?.works.find((w) => w.id === id);
  const [detail, setDetail] = useState<RepertoireDetail | null>(null);
  useEffect(() => {
    if (!index || !work) return;
    let live = true;
    loadDetail(work.id, index.shards).then((d) => live && setDetail(d ?? null));
    return () => {
      live = false;
    };
  }, [index, work]);

  // Some repertoire works do have a synced libretto: use it.
  const withLibretto = work && libretto(work);
  useEffect(() => {
    if (withLibretto) onPick({ kind: 'libretto', id: withLibretto });
  }, [withLibretto, onPick]);

  const full = useFullText(withLibretto ? undefined : id);
  if (!withLibretto && full === undefined) return <ReaderLoading />;
  if (work && full) {
    return (
      <TextImmerse
        text={full}
        composer={work.composers.join(', ') || undefined}
        librettist={work.librettists.join(', ') || undefined}
        byline={[work.composers.join(', '), work.year, full.language, venue && `at ${venue}`].filter(Boolean).join(' · ')}
        lead={detail?.lead ?? work.summary}
        onChange={onChange}
      />
    );
  }
  // A stored libretto the repertoire doesn't list: the text names itself and its composer.
  if (!work && full) {
    const composer = full.composer && unshout(full.composer);
    return <TextImmerse text={full} composer={composer} byline={[composer, full.language, venue && `at ${venue}`].filter(Boolean).join(' · ')} onChange={onChange} />;
  }
  if (!work) {
    return (
      <div className="rounded-2xl p-6 text-sm font-mono" style={{ backgroundColor: '#050406', color: DIM }}>
        {error ? 'The repertoire could not be loaded.' : index ? 'That work is not in the repertoire.' : 'Loading…'}
        {index && (
          <button type="button" onClick={onChange} className={`${chip} ml-3`} style={chipStyle(false)}>
            Pick another
          </button>
        )}
      </div>
    );
  }
  const subject: ListenSubject = {
    title: work.title,
    composer: work.composers.join(', ') || undefined,
    venue,
    language: work.languages.join(', ') || undefined,
    lead: detail?.lead ?? work.summary,
    synopsis: detail?.synopsis.map((s) => (s.heading ? `${s.heading}: ${s.text}` : s.text)).join('\n'),
  };
  return (
    <ListenImmerse
      subject={subject}
      byline={[work.composers.join(', '), work.year, work.languages[0], venue && `at ${venue}`].filter(Boolean).join(' · ')}
      detail={detail}
      onChange={onChange}
    />
  );
};
/**
 * Any work without a stored libretto: the reader's sections come from its synopsis, and the lines are whatever is heard,
 * typed or scanned. Nothing is made up: what you see is what the microphone or camera actually read.
 */
const ListenImmerse: React.FC<{ subject: ListenSubject; byline: string; detail?: RepertoireDetail | null; onChange: () => void }> = ({
  subject,
  byline,
  detail,
  onChange,
}) => {
  const doc = useMemo(() => buildSynopsisDoc(detail, subject.lead), [detail, subject.lead]);
  // Keyed by the work only: the synopsis loads after the work is picked, and remounting then would cut the microphone off
  // mid-listen and lose what was already heard. The reader takes the new sections in place.
  return <FollowReader key={subject.title} title={subject.title} byline={byline} doc={doc} subject={subject} onChange={onChange} />;
};
