import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, PenLine, Search } from 'lucide-react';
import { ArgonButton } from '../ArgonButton';
import { searchDoc, type FollowDoc } from '../../utils/followDoc';
import type { Theme } from './prefs';

interface Props {
  theme: Theme;
  doc: FollowDoc;
  currentSection: string;
  onSection: (id: string) => void;
  onEntry: (sectionId: string, entryId: string) => void;
  /** Adds the typed words as a line (for works with no stored libretto). */
  onAddTyped?: (text: string) => void;
  /** Hands a question or a described moment ("the bit where the Toreador dies") to Argon, in the chat sidebar. */
  onAsk?: (q: string) => void;
  focusRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * A contents list like an encyclopedia's (act, scene, passage), with a box above it: type a section ("act 2 scene 1")
 * or some words from the text and jump straight there.
 */
export const Sidebar: React.FC<Props> = ({ theme: t, doc, currentSection, onSection, onEntry, onAddTyped, onAsk, focusRef }) => {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(0);
  const hits = useMemo(() => searchDoc(doc, q), [doc, q]);
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => setPick(0), [q]);
  // Keep the current section in view in a long contents list.
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' });
  }, [currentSection]);

  // Two words or more can be a description of a moment or a question: Argon answers it in the sidebar, and moves the
  // reader when it names a scene. A near-exact hit in the text still wins on Enter.
  const canAsk = !!onAsk && q.trim().split(/\s+/).length >= 2;
  const strong = hits.length > 0 && hits[0].score >= 0.8;
  const ask = () => {
    if (!canAsk) return;
    onAsk!(q.trim());
    setQ('');
  };

  const go = (i: number) => {
    const h = hits[i];
    if (!h) return;
    h.entryId ? onEntry(h.sectionId, h.entryId) : onSection(h.sectionId);
    setQ('');
  };
  const add = () => {
    if (q.trim() && onAddTyped) {
      onAddTyped(q.trim());
      setQ('');
    }
  };

  return (
    <nav className="flex flex-col h-full min-h-0" aria-label="Contents">
      <div className="p-3 border-b space-y-2" style={{ borderColor: t.hair }}>
        <label className="flex items-center gap-2 px-2.5 py-2 rounded-lg border" style={{ borderColor: t.hair }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: t.dim }} />
          <input
            ref={focusRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setPick((p) => Math.min(hits.length - 1, p + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setPick((p) => Math.max(0, p - 1)));
              else if (e.key === 'Enter') strong || (hits.length && pick > 0) ? go(pick) : canAsk ? ask() : hits.length ? go(pick) : add();
              else if (e.key === 'Escape') setQ('');
              e.stopPropagation();
            }}
            placeholder={onAsk ? 'Jump: “act 2”, words, or ask Argon' : doc.hasLibretto ? 'Jump: “act 2”, or some words' : 'Jump: “act 2”, or type the words'}
            aria-label="Jump to a section or type some of the words"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm"
            style={{ color: t.ink }}
          />
        </label>
        {q.trim() && (
          <ul className="space-y-0.5" role="listbox">
            {hits.map((h, i) => (
              <li key={`${h.sectionId}/${h.entryId ?? ''}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === pick}
                  onClick={() => go(i)}
                  className="w-full text-left px-2 py-1.5 rounded-md cursor-pointer"
                  style={{ backgroundColor: i === pick ? t.hair : 'transparent' }}
                >
                  <span className="block text-sm leading-snug truncate">{h.label}</span>
                  {h.snippet && (
                    <span className="block font-mono text-[10px] uppercase tracking-wider truncate" style={{ color: t.dim }}>
                      {h.snippet}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {canAsk && (
              <li className={hits.length ? 'pt-1' : ''}>
                <ArgonButton label={strong ? 'Ask Argon instead' : 'Ask Argon · find this'} onClick={ask} className="w-full justify-center" />
              </li>
            )}
            {!hits.length && !canAsk && (
              <li className="px-2 py-1 text-xs font-mono" style={{ color: t.dim }}>
                No match in the contents{doc.hasLibretto ? '.' : ' or the story so far.'}
              </li>
            )}
            {onAddTyped && (
              <li>
                <button
                  type="button"
                  onClick={add}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-left"
                  style={{ color: t.gold }}
                >
                  <PenLine className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs font-mono uppercase tracking-wider flex-1">Add as a line here</span>
                  <CornerDownLeft className="w-3 h-3" />
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      <ol className="flex-1 overflow-y-auto py-2" role="list">
        {doc.sections.map((s) => {
          const on = s.id === currentSection;
          return (
            <li key={s.id}>
              <button
                ref={on ? active : undefined}
                type="button"
                onClick={() => onSection(s.id)}
                aria-current={on ? 'true' : undefined}
                className="w-full text-left py-1.5 pr-3 flex items-baseline gap-2 cursor-pointer border-l-2"
                style={{
                  paddingLeft: 12 + (s.level - 1) * 14,
                  borderColor: on ? t.accent : 'transparent',
                  color: on ? t.ink : s.level === 1 ? t.ink : t.dim,
                  backgroundColor: on ? t.hair : 'transparent',
                }}
              >
                <span className={`flex-1 min-w-0 truncate ${s.level === 1 ? 'font-mono text-[11px] uppercase tracking-[0.14em]' : s.level === 2 ? 'font-serif italic text-sm' : 'text-xs'}`}>{s.title}</span>
                {!doc.hasLibretto && s.entries.length > 0 && (
                  <span className="font-mono text-[10px]" style={{ color: t.dim }}>
                    {s.entries.length}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
