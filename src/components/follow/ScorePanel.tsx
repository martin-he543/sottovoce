import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Theme } from './prefs';

/** public/libretti/scores/<id>.json, written by scripts/libretto/scores-align.mjs. */
export interface ScoreMap {
  source: { archive: string; pdf: string };
  /** Page image URL with `{n}` for the zero-padded PDF page, when the pages are hosted here instead of on the Internet Archive. */
  images?: string;
  credit: string;
  link: string;
  /** Printed page 1 is this many PDF pages in. */
  offset: number;
  pieces: { no: number; title: string; page: number }[];
  /** The PDF page each sung line sits on, in libretto order. */
  lines: number[];
  /** Page height over width, and for each sung line the top and bottom of its system as fractions of the page height. */
  ratio?: number;
  boxes?: ([number, number] | null)[];
  /** Uncropped page images (`{n}` = zero-padded PDF page) that `boxes` are measured on; the Internet Archive's when absent. */
  pageImages?: string;
}

const cache = new Map<string, Promise<ScoreMap | null>>();
/** The score for a work, or null when none has been lined up. */
export const loadScore = (id: string) => {
  if (!cache.has(id)) {
    cache.set(
      id,
      fetch(`/libretti/scores/${id}.json`)
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<ScoreMap>) : null))
        .catch(() => null)
    );
  }
  return cache.get(id)!;
};

/** The page of the vocal score under the line being read, full width beneath both columns, with arrows to turn pages by hand. */
export const InlineScore: React.FC<{ theme: Theme; score: ScoreMap; line: number; active: boolean }> = ({ theme: t, score, line, active }) => {
  const page = score.lines[Math.min(line, score.lines.length - 1)] ?? score.pieces[0].page;
  const box = score.ratio ? score.boxes?.[line] : null;
  if (box && score.ratio) {
    const [top, bottom] = box;
    const src = score.pageImages ? score.pageImages.replace('{n}', String(page).padStart(3, '0')) : `https://archive.org/download/${score.source.archive}/page/n${page - 1}_w900.jpg`;
    return (
      <div
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-sm"
        style={{ backgroundColor: '#e9e4d8', aspectRatio: `${1 / ((bottom - top) * score.ratio)}`, opacity: active ? 1 : 0.7 }}
        title={`Vocal score, p. ${page - score.offset}`}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={`Vocal score, page ${page - score.offset}`} loading="lazy" className="absolute left-0 w-full h-auto max-w-none" style={{ top: `${(-top / (bottom - top)) * 100}%` }} />
      </div>
    );
  }
  const [turn, setTurn] = useState(0);
  useEffect(() => setTurn(0), [page]);
  const shown = Math.max(1, page + turn);
  const piece = [...score.pieces].reverse().find((p) => p.page <= shown);
  // Internet Archive leaves count from 0.
  const src = score.images ? score.images.replace('{n}', String(shown).padStart(3, '0')) : `https://archive.org/download/${score.source.archive}/page/n${shown - 1}_w900.jpg`;
  const btn = 'p-1.5 rounded-full border cursor-pointer';
  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border overflow-hidden text-left" style={{ borderColor: t.hair, backgroundColor: '#e9e4d8' }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b" style={{ borderColor: t.hair, backgroundColor: t.panel }}>
        <p className="text-xs truncate" style={{ color: t.dim }}>
          {piece && piece.no < 99 ? `No. ${piece.no}${piece.title ? ` · ${piece.title}` : ''} · ` : ''}p. {shown - score.offset}
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} style={{ borderColor: t.hair, color: t.dim }} onClick={() => setTurn(turn - 1)} disabled={shown <= 1} aria-label="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" className={btn} style={{ borderColor: t.hair, color: t.dim }} onClick={() => setTurn(turn + 1)} aria-label="Next page">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <img key={src} src={src} alt={`Vocal score, page ${shown - score.offset}`} className="w-full h-auto" />
      <p className="px-3 py-1 text-[10px] font-mono" style={{ color: '#555' }}>
        <a href={score.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {score.credit}
        </a>
      </p>
    </div>
  );
};
