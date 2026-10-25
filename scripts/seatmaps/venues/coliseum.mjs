// London Coliseum (ENO): the Spektrix plan behind booking.eno.org's "Select a seat" map.
import { fetchCached, spektrixLevels, writePlan } from '../lib.mjs';

const URL = 'https://booking.eno.org/wp-content/uploads/cog-wp-spektrix/plans/572AVQCJHTTTLJVNQQQQCLRSMCSVGPBRT.json';
const raw = JSON.parse(await fetchCached('coliseum.spektrix.json', URL));

const LEVELS = {
  Stalls: { height: 0, rake: 0.06, front: 5 },
  'Dress Circle': { height: 4.5, rake: 0.3, front: 13 },
  'Upper Circle': { height: 9, rake: 0.4, front: 17 },
  Balcony: { height: 13.5, rake: 0.5, front: 21 },
};

await writePlan({
  id: 'coliseum',
  name: 'London Coliseum',
  hall: 'Main Auditorium',
  venueNames: ['London Coliseum', 'English National Opera (London Coliseum)'],
  mapVenueIds: ['eno', 'ext_london-coliseum'],
  source: { system: 'Spektrix', url: 'https://booking.eno.org/book-online/75002', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 16.5, depth: 24, pit: 4 },
  levels: spektrixLevels(raw).map((l) => ({ ...l, ...LEVELS[l.name] })),
});
