import React from 'react';

/** The Argon mark: a nucleus with two electron orbits. */
export const ArgonMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <ellipse cx="12" cy="12" rx="10" ry="4" />
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </svg>
);

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** What the button does, e.g. "Find this moment". */
  label: string;
  /** Label while the model is working. */
  busyLabel?: string;
  busy?: boolean;
  /** Mark only (for tight spots); the label becomes the tooltip. */
  iconOnly?: boolean;
};

/** Every action that calls the Argon model uses this button, so AI features are always obvious. */
export const ArgonButton: React.FC<Props> = ({ label, busyLabel, busy, iconOnly, className = '', title, disabled, ...rest }) => (
  <button
    type="button"
    title={title ?? `${label} — powered by Argon`}
    aria-label={iconOnly ? `${label} (Argon)` : undefined}
    disabled={disabled || busy}
    className={`argon-btn ${busy ? 'argon-btn--busy' : ''} ${iconOnly ? 'argon-btn--icon' : ''} ${className}`}
    {...rest}
  >
    <span className="argon-btn__mark">
      <ArgonMark />
    </span>
    {!iconOnly && (
      <>
        <span>{busy && busyLabel ? busyLabel : label}</span>
        <span className="argon-btn__tag">Argon</span>
      </>
    )}
  </button>
);

/** A small non-interactive "powered by Argon" label for headers and credits. */
export const ArgonTag: React.FC<{ pending?: boolean; children?: React.ReactNode }> = ({ pending, children = 'Powered by Argon' }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
    <span className={`argon-btn__mark ${pending ? 'argon-btn--busy' : ''}`} style={{ width: '1rem', height: '1rem' }}>
      <ArgonMark />
    </span>
    {children}
  </span>
);
