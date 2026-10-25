import React, { useEffect, useState } from 'react';
import { ArgonButton, ArgonMark } from '../ArgonButton';
import { seatKey, type PlanLayout, type SeatPlan } from '../../utils/seatPlan';

interface Suggestion {
  seats: string[];
  title: string;
  reason: string;
}

const EXAMPLES = ['Best view of the whole stage for under £50 each', 'Aisle seat, I’m tall and need legroom', 'Close enough to see faces, not craning up'];

/**
 * Ask Gemini for seats in plain words. The whole plan (every seat with its sightline) goes to the model; its picks
 * light up green on the 3D plan and the person decides what, if anything, to book on the venue's own site.
 */
export const SeatAdvisor: React.FC<{
  plan: SeatPlan;
  layout: PlanLayout;
  /** The performance's listed price ("from £15"), so the advisor prices seats for it. */
  listingPrice?: string;
  onSuggest: (seats: number[]) => void;
  onPick: (seat: number) => void;
}> = ({ plan, layout, listingPrice, onSuggest, onPick }) => {
  const [wish, setWish] = useState('');
  const [party, setParty] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ suggestions: Suggestion[]; note?: string; model?: string } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    setResult(null);
    setActive(null);
  }, [plan]);

  const indexOf = (key: string) => layout.seats.findIndex((s) => seatKey(plan, s) === key);
  const show = (k: number, list = result?.suggestions ?? []) => {
    const seats = list[k].seats.map(indexOf).filter((i) => i >= 0);
    setActive(k);
    onSuggest(seats);
    if (seats.length) onPick(seats[0]);
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wish.trim()) return;
    setBusy(true);
    setActive(null);
    onSuggest([]);
    try {
      const r = await fetch('/api/seatmaps/advise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, wish, party, listingPrice }),
      });
      const data = r.ok ? await r.json() : { suggestions: [], note: `The advisor is unavailable (HTTP ${r.status}).` };
      setResult(data);
      if (data.suggestions?.length) show(0, data.suggestions);
    } catch {
      setResult({ suggestions: [], note: 'The advisor is unavailable right now.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}>
      <h3 className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-crimson)' }}>
        <ArgonMark className="mr-1 inline h-3 w-3" />
        Seat advisor · Argon
      </h3>
      <form onSubmit={ask} className="space-y-2">
        <textarea
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          rows={2}
          maxLength={600}
          placeholder={EXAMPLES[plan.id.length % EXAMPLES.length]}
          aria-label="What matters to you in a seat?"
          className="w-full resize-none rounded-md border px-2 py-1.5 text-xs"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Seats
            <input
              type="number"
              min={1}
              max={10}
              value={party}
              onChange={(e) => setParty(Math.min(10, Math.max(1, +e.target.value || 1)))}
              className="w-12 rounded-md border px-1.5 py-1 text-xs"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
            />
          </label>
          <ArgonButton type="submit" label="Suggest seats" busyLabel="Reading the house…" busy={busy} disabled={!wish.trim()} className="ml-auto" />
        </div>
      </form>
      {result && (
        <div className="mt-3 space-y-1.5" aria-live="polite">
          {result.suggestions.map((sg, k) => (
            <button
              key={k}
              type="button"
              onClick={() => show(k)}
              className="block w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: active === k ? '#39D98A' : 'var(--border-hairline)' }}
            >
              <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                {sg.title} <span className="font-mono font-normal opacity-70">· {sg.seats.map((s) => s.split('|').slice(1).join('')).join(', ')}</span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                {sg.reason}
              </span>
            </button>
          ))}
          {result.note && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {result.note}
            </p>
          )}
          {result.model && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Suggested by {result.model} from all {layout.seats.length.toLocaleString('en-GB')} seats. Check prices and availability on the venue’s site.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
