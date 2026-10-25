import React from 'react';

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Open libretto book with verse lines on each page. */
export const LibrettoIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 6.5C10.2 5.2 7.6 4.7 4 5v13c3.6-.3 6.2.2 8 1.5 1.8-1.3 4.4-1.8 8-1.5V5c-3.6-.3-6.2.2-8 1.5Z" />
    <path d="M12 6.5v13" />
    <path d="M6.5 9c1.2 0 2.3.2 3.2.6M6.5 12c1.2 0 2.3.2 3.2.6M14.3 9.6c.9-.4 2-.6 3.2-.6M14.3 12.6c.9-.4 2-.6 3.2-.6" />
  </svg>
);

/** Compass rose: find what's on. */
export const DiscoverIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" />
    <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
  </svg>
);

/** Proscenium arch with curtains and a spotlight: in-the-theatre mode. */
export const ImmerseIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M3 20V9a9 6 0 0 1 18 0v11" />
    <path d="M6.5 20c0-4 .8-7 2.5-9M17.5 20c0-4-.8-7-2.5-9" />
    <path d="M3 20h18" />
    <path d="M12 4v2.5" />
    <path d="m9.5 20 1-4h3l1 4" />
  </svg>
);
