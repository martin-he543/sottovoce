// Hampstead Theatre: the seating chart TodayTix draws for its bookings (Kimberly Akimbo, show 45917).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py hampstead=45917
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'hampstead',
  name: 'Hampstead Theatre',
  hall: 'Hampstead Theatre',
  venueNames: ['Hampstead Theatre'],
  mapVenueIds: ['hampstead'],
  halls: ['Hampstead Theatre'],
  show: 45917,
  levels: ['Stalls', 'Dress Circle'],
  geometry: [[0, 0.1, 2.5], [3.3, 0.35, 7]],
  stage: { width: 9, depth: 7, pit: 0 },
});
