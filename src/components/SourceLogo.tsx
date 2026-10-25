import React from 'react';
import { SOURCE_META, type EventSourceId } from '../utils/eventSource';

/** Simplified brand marks (not the official artwork) so each listing source is recognisable at 16px. */
const Glyph: React.FC<{ id: EventSourceId }> = ({ id }) => {
  const white = { fill: '#fff' };
  switch (id) {
    case 'bandsintown':
      return (
        <g {...white}>
          <rect x="5" y="9" width="3" height="10" rx="1" />
          <rect x="10.5" y="5" width="3" height="18" rx="1" />
          <rect x="16" y="9" width="3" height="10" rx="1" />
        </g>
      );
    case 'ticketmaster':
      // ticket stub with notches
      return (
        <path
          {...white}
          fillRule="evenodd"
          d="M5 8h18v3.2a2.8 2.8 0 0 0 0 5.6V20H5v-3.2a2.8 2.8 0 0 0 0-5.6V8zm9 2.5v7h2v-7h-2z"
        />
      );
    case 'viagogo':
      return <path {...white} d="M6 8h3.4l4.6 9 4.6-9H22l-6.3 12h-3.4L6 8z" />;
    case 'eventbrite':
      return (
        <path
          {...white}
          d="M8 8h12v3H11.4v2.2h7.3v3H11.4V17H20v3H8V8z"
        />
      );
    case 'seatgeek':
      // pin
      return <path {...white} d="M14 5a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.500 6-12a6 6 0 0 0-6-6zm0 8.200a2.200 2.200 0 1 1 0-4.400 2.200 2.200 0 0 1 0 4.400z" />;
    case 'skiddle':
      return <path {...white} d="M9 7h10v3.200h-6.800v2.400H19V21H9v-3.200h6.800v-2.400H9V7z" />;
    case 'olt':
      // two theatre masks, simplified as a pair of overlapping drops
      return <g {...white}><path d="M5 7h10v6a5 5 0 0 1-10 0V7z" /><path opacity=".7" d="M13 11h10v6a5 5 0 0 1-10 0v-6z" /></g>;
    case 'luma':
      return <path {...white} d="M14 5l2.2 6.8L23 14l-6.8 2.2L14 23l-2.2-6.8L5 14l6.8-2.2L14 5z" />;
    case 'studentpulse':
      // mortarboard
      return <path {...white} d="M14 6L3 11.500l11 5.500 8-4v5h2v-6.500L14 6zm-6 10v3.500c0 1.400 2.700 3 6 3s6-1.600 6-3V16l-6 3-6-3z" />;
    case 'lastfm':
      return (
        <g {...white}>
          <circle cx="9" cy="14" r="2.6" />
          <circle cx="19" cy="14" r="2.6" />
          <rect x="9" y="12.7" width="10" height="2.6" />
        </g>
      );
    default:
      // venue: a small proscenium arch
      return <path {...white} d="M6 21V12a8 8 0 0 1 16 0v9h-3v-9a5 5 0 0 0-10 0v9H6z" />;
  }
};

export const SourceLogo: React.FC<{ source: EventSourceId; size?: number; className?: string }> = ({
  source,
  size = 16,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    role="img"
    aria-label={SOURCE_META[source].label}
    className={className}
    style={{ flexShrink: 0 }}
  >
    <rect width="28" height="28" rx="6" fill={SOURCE_META[source].color} />
    <Glyph id={source} />
  </svg>
);

/** Logo + name pill; pass `prefix` for wording like "via". */
export const SourceBadge: React.FC<{ source: EventSourceId; prefix?: string; className?: string }> = ({
  source,
  prefix,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide whitespace-nowrap ${className}`}
    style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}
  >
    <SourceLogo source={source} size={14} />
    {prefix ? `${prefix} ` : ''}
    {SOURCE_META[source].label}
  </span>
);
