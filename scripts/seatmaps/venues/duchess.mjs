// Duchess Theatre: the seating chart TodayTix draws for its bookings (The Play That Goes Wrong, show 345).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py duchess=345
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'duchess',
  name: 'Duchess Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Duchess Theatre'],
  mapVenueIds: ['duchess-theatre'],
  show: 345,
  levels: ['Stalls', 'Dress Circle'],
  geometry: [[0, 0.07, 2.5], [3.5, 0.3, 9]],
  stage: { width: 8, depth: 8, pit: 1.5 },
});
