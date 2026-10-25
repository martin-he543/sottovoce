import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LocateFixed, Route, Search } from 'lucide-react';

/** Where a "Plan" button sends the Journey Planner: to a venue, or to one performance there (arriving early). */
export interface JourneyRequest {
  /** Timetable venue id or map venue id. */
  venueId: string;
  eventId?: string;
  /** Start from the device's location and search at once; otherwise the planner waits for a From. */
  fromHere: boolean;
}

/** "Plan" with a small menu: from my location, or from a station / address chosen in the planner. */
export const PlanJourneyButton: React.FC<{
  onPlan: (fromHere: boolean) => void;
  label?: string;
  /** Icon-only trigger, for dense rows. */
  compact?: boolean;
  title?: string;
  /** Open the menu above the button (for footers near the bottom of a clipped box). */
  up?: boolean;
}> = ({ onPlan, label = 'Plan', compact, title = 'Plan your journey here', up }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (fromHere: boolean) => {
    setOpen(false);
    onPlan(fromHere);
  };

  return (
    <div ref={rootRef} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={compact ? title : undefined}
        title={title}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-md border font-mono text-[11px] hover:opacity-85 ${compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1'}`}
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--accent-crimson)', borderColor: open ? 'var(--accent-crimson)' : 'var(--border-hairline)' }}
      >
        <Route className="h-3.5 w-3.5" aria-hidden />
        {!compact && label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute right-0 z-30 w-60 ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} rounded-xl border p-1 shadow-xl animate-folio-enter`}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
        >
          {[
            { fromHere: true, Icon: LocateFixed, text: 'From my location', hint: 'Uses your device’s location, then finds routes' },
            { fromHere: false, Icon: Search, text: 'From somewhere else', hint: 'Pick a station or address in the planner' },
          ].map(({ fromHere, Icon, text, hint }) => (
            <button
              key={text}
              type="button"
              role="menuitem"
              onClick={() => choose(fromHere)}
              className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-subtle)]"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent-crimson)' }} aria-hidden />
              <span>
                <span className="block font-fraunces text-[14px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {text}
                </span>
                <span className="block text-[10px] font-mono leading-tight" style={{ color: 'var(--text-muted)' }}>
                  {hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
