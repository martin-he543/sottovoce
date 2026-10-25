import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { RepertoireWork } from '../types/sottovoce';
import { rank, useRepertoire } from './RepertoireCatalogue';

interface WorkPickerProps {
  onPick: (w: RepertoireWork) => void;
  autoFocus?: boolean;
  /** Dark surfaces (Immerse) or the app's themed surfaces. */
  dark?: boolean;
  /** Works to list first (Immerse: those with a complete libretto), marked as such. */
  prefer?: Set<string>;
  /** Ids (a subset of `prefer`) whose libretto also has an English translation. */
  translated?: Set<string>;
  /** Where picking a work leads, so middle-click can open it in a new tab. */
  hrefFor?: (w: RepertoireWork) => string;
}

/** Search the whole repertoire (≈5,500 operas, operettas and musicals) and pick one. */
export const WorkPicker: React.FC<WorkPickerProps> = ({ onPick, autoFocus, dark, prefer, translated, hrefFor }) => {
  const { index, error, searchable } = useRepertoire();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const all = q.trim() ? rank(searchable, q) : (index?.works ?? []);
    const first = prefer?.size ? [...all.filter((w) => prefer.has(w.id)), ...all.filter((w) => !prefer.has(w.id))] : all;
    return first.slice(0, q.trim() ? 8 : 6);
  }, [searchable, q, index, prefer]);
  const muted = dark ? 'rgba(250,246,240,0.55)' : 'var(--text-muted)';
  const border = dark ? 'rgba(250,246,240,0.18)' : 'var(--border-hairline)';

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border" style={{ borderColor: border, backgroundColor: dark ? 'rgba(250,246,240,0.04)' : 'var(--bg-subtle)' }}>
        <Search className="w-4 h-4 shrink-0" style={{ color: muted }} />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search an opera or musical…"
          aria-label="Search the repertoire"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm"
          style={{ color: 'inherit' }}
        />
      </label>
      {error && <p className="text-xs font-mono" style={{ color: muted }}>The repertoire could not be loaded.</p>}
      {!index && !error && <p className="text-xs font-mono" style={{ color: muted }}>Loading the repertoire…</p>}
      {!q.trim() && index && (
        <p className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: muted }}>
          {prefer?.size ? 'Most staged, complete libretti first' : 'Most staged'}
        </p>
      )}
      <ul className="space-y-1.5">
        {results.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onPick(w)}
              data-href={hrefFor?.(w)}
              className="w-full text-left px-3 py-2 rounded-lg border cursor-pointer flex items-baseline justify-between gap-3"
              style={{ borderColor: border }}
            >
              <span className="min-w-0">
                <span className="block font-instrument italic text-lg truncate">{w.title}</span>
                <span className="block font-mono text-[11px] uppercase tracking-wider truncate" style={{ color: muted }}>
                  {[w.composers.join(', ') || 'Composer unknown', w.year, w.languages[0]].filter(Boolean).join(' · ')}
                </span>
              </span>
              {prefer?.has(w.id) && (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-right" style={{ color: '#C9A24B' }}>
                  Full libretto
                  {translated?.has(w.id) && (
                    <>
                      <br />
                      Translated
                    </>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
        {q.trim() && index && !results.length && (
          <li className="text-sm px-1" style={{ color: muted }}>
            Nothing in the repertoire matches “{q}”.
          </li>
        )}
      </ul>
    </div>
  );
};
