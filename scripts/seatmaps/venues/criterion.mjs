// Criterion Theatre: the seating chart TodayTix draws for its bookings (Titanique, show 40903).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py criterion=40903
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'criterion',
  name: 'Criterion Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Criterion Theatre'],
  mapVenueIds: ['criterion-theatre'],
  show: 40903,
  levels: ['Stalls', 'Dress Circle', 'Upper Circle'],
  geometry: [[0, 0.08, 2.5], [3.5, 0.3, 9], [6.5, 0.4, 12]],
  stage: { width: 8, depth: 7, pit: 0 },
});
