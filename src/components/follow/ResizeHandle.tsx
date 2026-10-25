import React, { useRef } from 'react';
import type { Theme } from './prefs';

interface Props {
  theme: Theme;
  /** Which edge of its panel the handle sits on: dragging away from the panel widens it. */
  edge: 'right' | 'left';
  width: number;
  min: number;
  max: number;
  onWidth: (w: number) => void;
  /** Double-click puts the width back. */
  reset: number;
  label: string;
}

/** A thin bar on a panel's edge: drag to resize, arrow keys to nudge, double-click to reset. */
export const ResizeHandle: React.FC<Props> = ({ theme: t, edge, width, min, max, onWidth, reset, label }) => {
  const start = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${label} (double-click to reset)`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        onWidth(clamp(s.w + (edge === 'right' ? dx : -dx)));
      }}
      onPointerUp={(e) => {
        start.current = null;
        document.body.style.cursor = '';
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={() => onWidth(reset)}
      onKeyDown={(e) => {
        const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
        const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
        if (e.key === grow || e.key === shrink) {
          e.preventDefault();
          e.stopPropagation();
          onWidth(clamp(width + (e.key === grow ? 24 : -24)));
        }
      }}
      className={`hidden md:block absolute inset-y-0 ${edge === 'right' ? '-right-1.5' : '-left-1.5'} z-20 w-3 cursor-col-resize group touch-none outline-none`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px group-hover:w-[3px] group-focus-visible:w-[3px] group-active:w-[3px] transition-all"
        style={{ backgroundColor: t.gold, opacity: 0.6 }}
      />
    </div>
  );
};
