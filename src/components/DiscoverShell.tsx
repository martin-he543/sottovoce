import React, { useState } from 'react';
import { Armchair, Bot, CalendarDays, ChevronDown, Heart, TrainFront } from 'lucide-react';

export type DiscoverView = 'events' | 'journey' | 'seating' | 'taste' | 'agent';

export const DISCOVER_VIEWS: { id: DiscoverView; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'events', label: 'Events', hint: 'What’s on & venue map', icon: <CalendarDays className="w-4 h-4" /> },
  { id: 'journey', label: 'Journey Planner', hint: 'Tube, rail & bus with venues & shows', icon: <TrainFront className="w-4 h-4" /> },
  { id: 'seating', label: 'Seating', hint: '3D seat plans of the main venues', icon: <Armchair className="w-4 h-4" /> },
  { id: 'taste', label: 'Taste', hint: 'Last.fm profile & cross-genre picks', icon: <Heart className="w-4 h-4" /> },
  { id: 'agent', label: 'Agent', hint: 'Saint agent & Atlas search', icon: <Bot className="w-4 h-4" /> },
];

interface DiscoverSidebarProps {
  active: DiscoverView;
  onChange: (view: DiscoverView) => void;
}

/** Left rail on desktop, horizontally scrolling pill row on small screens. */
export const DiscoverSidebar: React.FC<DiscoverSidebarProps> = ({ active, onChange }) => (
  <nav
    aria-label="Discover sections"
    className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible lg:sticky lg:top-[calc(var(--app-header-h,0px)+1rem)] lg:self-start pb-2 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0"
  >
    {DISCOVER_VIEWS.filter((v) => v.id !== 'agent').map((v) => {
      const isActive = v.id === active;
      return (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          data-href={`/discover/${v.id}`}
          aria-current={isActive ? 'page' : undefined}
          className={`shrink-0 lg:w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
            isActive ? 'bg-[#9E1B32] text-[#FAF6F0] border-transparent shadow-sm' : 'hover:opacity-90'
          }`}
          style={
            isActive
              ? undefined
              : {
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                  color: 'var(--text-primary)',
                }
          }
        >
          <span style={isActive ? undefined : { color: 'var(--accent-crimson)' }}>{v.icon}</span>
          <span className="flex flex-col">
            <span className="font-fraunces text-base leading-tight whitespace-nowrap">{v.label}</span>
            <span
              className="hidden lg:block text-[11px] font-mono mt-0.5"
              style={{ opacity: isActive ? 0.85 : 0.7 }}
            >
              {v.hint}
            </span>
          </span>
        </button>
      );
    })}
  </nav>
);

interface AccordionSectionProps {
  title: string;
  eyebrow?: string;
  defaultOpen?: boolean;
  /** Controlled open state (with onOpenChange); otherwise the section keeps its own, starting at defaultOpen. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Don't mount the children until the section is first opened (for heavy embeds). */
  lazy?: boolean;
  id?: string;
  children: React.ReactNode;
}

/**
 * Collapsible page section with a header. Children stay mounted while collapsed
 * (just hidden) so embedded maps / canvases keep their state; `lazy` ones mount on first open.
 */
export const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  eyebrow,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  lazy = false,
  id,
  children,
}) => {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (fn: (o: boolean) => boolean) => {
    const next = fn(open);
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [visited, setVisited] = useState(open);
  if (open && !visited) setVisited(true);
  return (
    <section
      id={id}
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-surface)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 sm:px-6 py-4 text-left cursor-pointer"
      >
        <span>
          {eyebrow && (
            <span
              className="block text-[10px] font-mono uppercase tracking-[0.18em] font-semibold"
              style={{ color: 'var(--accent-crimson)' }}
            >
              {eyebrow}
            </span>
          )}
          <span className="font-chronicle text-xl sm:text-2xl" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
        </span>
        <ChevronDown
          className={`w-5 h-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-secondary)' }}
        />
      </button>
      <div hidden={!open} className="px-3 sm:px-5 pb-5 pt-1">
        {(!lazy || visited) && children}
      </div>
    </section>
  );
};
