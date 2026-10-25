// Copy this file to venues/<id>.mjs. Files starting with "_" are ignored by the runner.
import { fetchDoc, fetchJson, clean, abs, londonISO, parseTime, monthNum, inferYear, jsonLd, makeEvent } from '../lib.mjs';
import { guessCategory } from '../categories.mjs';

/** Static facts about the venue (coordinates are WGS84). `kind` drives the map icon: opera | theatre | concert. */
export const venue = {
  id: 'example',
  name: 'Example Hall',
  kind: 'concert',
  address: '1 Example Street, London W1',
  lat: 51.5,
  lng: -0.12,
  site: 'https://example.org/whats-on',
};

/**
 * Return an array of makeEvent(venue, {...}) — ONE ENTRY PER PERFORMANCE (date+time), not per production.
 * Raw fields: title, category (see categories.mjs), start (londonISO(...) or 'YYYY-MM-DD'), end?, hall?, url?, price?, blurb?
 */
export async function scrape() {
  return [];
}
