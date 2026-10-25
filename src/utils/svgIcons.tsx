import React from 'react';
import { ICON_NODES } from './svgIconData';

/** Icon ids available as strings (venue pins, search results, saved-event hearts…). Add more in scripts/gen-icons.mjs. */
export type IconName = keyof typeof ICON_NODES | (string & {});

const nodeFor = (name: string) => ICON_NODES[name] ?? ICON_NODES.theater;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Inline `<svg>` markup, for places that build HTML strings (Leaflet divIcons). Inherits the current text colour. */
export const svgIconHtml = (name: IconName, size: number | string = '1em', fill = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${nodeFor(name)
    .map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}/>`)
    .join('')}</svg>`;

/** The same icons as a React component. */
export const SvgIcon: React.FC<{ name: IconName; size?: number | string; fill?: boolean; className?: string }> = ({
  name,
  size = '1em',
  fill = false,
  className,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {nodeFor(name).map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
  </svg>
);
