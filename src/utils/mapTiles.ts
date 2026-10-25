/**
 * The basemap the Journey Planner uses (public/tube/index.html): OpenStreetMap standard tiles, darkened with a CSS filter
 * in the dark theme. Third-party "dark_all"/"light_all" tile sets can start demanding an API key, so standalone maps use this too.
 */
export const BASEMAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors';
export const BASEMAP_MAX_ZOOM = 19;
export const BASEMAP_CLASS = 'tt-basemap';
