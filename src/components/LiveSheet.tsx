import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Radio, X } from 'lucide-react';
import type { RepertoireWork } from '../types/sottovoce';
import type { TimetableData } from '../data/timetableCategories';
import { CATEGORY_BY_ID } from '../data/timetableCategories';
import { guessLive, liveAnywhere, type LiveCandidate, type LiveGuess, type LiveStatus } from '../utils/liveGuess';
import { dayKey, timeLabel } from '../utils/timetableFormat';
import { matchPerformances } from '../utils/londonPerformances';
import { useRepertoire } from './RepertoireCatalogue';
import { WorkPicker } from './WorkPicker';
import type { ImmerseTarget } from './ImmerseView';
import { immersePath } from '../utils/urlState';

interface LiveSheetProps {
  data: TimetableData;
  /** The libretto work id for a repertoire work that has a synced libretto here, if any. */
  libretto: (w: RepertoireWork) => string | undefined;
  onOpen: (target: ImmerseTarget) => void;
  onClose: () => void;
}

type Fix = { lat: number; lng: number; accuracy: number };
type Phase = { s: 'locating' } | { s: 'fixed'; fix: Fix } | { s: 'unavailable'; why: string };

const STATUS_LABEL: Record<LiveStatus, string> = {
  'on-now': 'On now',
  'starting-soon': 'Starting soon',
  later: 'Later today',
  earlier: 'Earlier today',
};

const distanceLabel = (m: number) => (Number.isNaN(m) ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * The header's Live button: take the device's location, work out which listing is probably under way at the nearest venue,
 * and open Immerse on it. When there is no clear answer, the likeliest listings are offered to pick from, and any opera or
 * musical in the repertoire can be picked by name.
 */
export const LiveSheet: React.FC<LiveSheetProps> = ({ data, libretto, onOpen, onClose }) => {
  const targetFor = (w: RepertoireWork): ImmerseTarget => {
    const live = libretto(w);
    return live ? { kind: 'libretto', id: live } : { kind: 'rep', id: w.id };
  };
  const [phase, setPhase] = useState<Phase>({ s: 'locating' });
  const [declined, setDeclined] = useState(false);
  const [now] = useState(() => new Date());
  const { index } = useRepertoire();

  useEffect(() => {
    if (!navigator.geolocation) {
      setPhase({ s: 'unavailable', why: 'This device can’t share its location.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPhase({ s: 'fixed', fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (e) =>
        setPhase({
          s: 'unavailable',
          why: e.code === e.PERMISSION_DENIED ? 'Location access was blocked, so here is what is on across London.' : 'Couldn’t get a location fix, so here is what is on across London.',
        }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const guess = useMemo<LiveGuess | null>(
    () => (phase.s === 'fixed' ? guessLive(phase.fix, data.events, data.venues, now) : null),
    [phase, data, now]
  );
  const list = useMemo<LiveCandidate[]>(
    () => (phase.s === 'unavailable' ? liveAnywhere(data.events, data.venues, now) : (guess?.candidates ?? [])),
    [phase, guess, data, now]
  );

  // Which repertoire work each candidate listing is, by title.
  const workOf = useMemo(() => {
    const out = new Map<string, RepertoireWork>();
    if (!index) return out;
    const events = [...list, ...(guess?.confident ? [guess.confident] : [])].map((c) => c.event);
    const { byWork } = matchPerformances(index.works, events, dayKey(now));
    const byId = new Map(index.works.map((w) => [w.id, w]));
    for (const [id, evs] of byWork) for (const e of evs) out.set(e.id, byId.get(id)!);
    return out;
  }, [index, list, guess, now]);

  const open = (c: LiveCandidate) => {
    const w = workOf.get(c.event.id);
    if (!w) return onOpen({ kind: 'show', title: c.event.title, venue: c.venue.name });
    const live = libretto(w);
    onOpen(live ? { kind: 'libretto', id: live } : { kind: 'rep', id: w.id, venue: c.venue.name });
  };

  const confident = guess?.confident && !declined ? guess.confident : null;
  const sure = confident ? workOf.get(confident.event.id) : undefined;

  const hair = { borderColor: 'var(--border-hairline)' };
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Live">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" style={{ backgroundColor: 'rgba(5,4,6,0.6)' }} />
      <div
        className="relative w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border p-5 sm:p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', ...hair }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-chronicle text-3xl tracking-tight flex items-center gap-2">
              <Radio className="w-5 h-5" style={{ color: 'var(--accent-crimson)' }} /> Live
            </h2>
            <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
              Find what you’re watching and follow it in Immerse.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase.s === 'locating' && (
          <p className="flex items-center gap-2 text-sm font-fraunces" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Finding where you are…
          </p>
        )}

        {phase.s === 'unavailable' && (
          <p className="text-sm font-fraunces" style={{ color: 'var(--text-secondary)' }}>
            {phase.why}
          </p>
        )}

        {confident && (
          <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--accent-crimson)' }}>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] flex items-center gap-1.5" style={{ color: 'var(--accent-crimson)' }}>
              <MapPin className="w-3.5 h-3.5" /> You’re at {confident.venue.name}
            </p>
            <div>
              <p className="font-instrument italic text-2xl leading-tight">{sure?.title ?? confident.event.title}</p>
              <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
                {STATUS_LABEL[confident.status]} · {timeLabel(confident.event)}
                {sure?.composers.length ? ` · ${sure.composers.join(', ')}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => open(confident)}
                className="px-4 py-2.5 rounded-lg bg-[#9E1B32] hover:bg-[#7F1527] text-[#FAF6F0] font-mono text-xs uppercase tracking-[0.12em] cursor-pointer"
              >
                Yes, follow this
              </button>
              <button
                type="button"
                onClick={() => setDeclined(true)}
                className="px-4 py-2.5 rounded-lg border font-mono text-xs uppercase tracking-[0.12em] cursor-pointer"
                style={hair}
              >
                Not this
              </button>
            </div>
          </section>
        )}

        {!confident && phase.s !== 'locating' && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-mono uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              {phase.s === 'fixed'
                ? list.length
                  ? guess?.nearestVenue
                    ? `Most likely, near ${guess.nearestVenue.venue.name}`
                    : 'Most likely, near you'
                  : 'Nothing listed near you today'
                : 'On now across London'}
            </h3>
            {phase.s === 'fixed' && phase.fix.accuracy > 150 && (
              <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                Location is only accurate to about {Math.round(phase.fix.accuracy)} m, so check the venue.
              </p>
            )}
            <ul className="space-y-2">
              {list.map((c) => {
                const meta = CATEGORY_BY_ID[c.event.category];
                const w = workOf.get(c.event.id);
                return (
                  <li key={c.event.id}>
                    <button type="button" onClick={() => open(c)} className="w-full text-left px-3 py-2.5 rounded-xl border cursor-pointer flex items-start gap-3" style={hair}>
                      <meta.icon className="w-4 h-4 mt-1 shrink-0" style={{ color: meta.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-fraunces text-[15px] leading-snug truncate">{w?.title ?? c.event.title}</span>
                        <span className="block text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                          {c.venue.name} · {timeLabel(c.event)}
                          {distanceLabel(c.distance) && ` · ${distanceLabel(c.distance)}`}
                        </span>
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider shrink-0 mt-1" style={{ color: c.status === 'on-now' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {phase.s !== 'locating' && (
          <section className="space-y-2 border-t pt-4" style={hair}>
            <h3 className="text-[11px] font-mono uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              Or pick the opera or musical
            </h3>
            <WorkPicker
              onPick={(w) => onOpen(targetFor(w))}
              hrefFor={(w) => immersePath(targetFor(w))}
            />
          </section>
        )}
      </div>
    </div>
  );
};
