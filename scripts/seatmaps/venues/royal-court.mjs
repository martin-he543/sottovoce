// Royal Court Theatre: the seating chart TodayTix draws for its bookings (The Afronauts, show 45692).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py royal-court=45692
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'royal-court',
  name: 'Royal Court Theatre',
  hall: 'Jerwood Theatre Downstairs',
  venueNames: ['Royal Court Theatre'],
  mapVenueIds: ['royalcourt'],
  halls: ['Jerwood Theatre Downstairs'],
  show: 45692,
  levels: ['Stalls', 'Circle', 'Balcony'],
  geometry: [[0, 0.08, 2.5], [3.5, 0.3, 8], [6.8, 0.42, 11]],
  stage: { width: 8, depth: 8, pit: 0 },
});
