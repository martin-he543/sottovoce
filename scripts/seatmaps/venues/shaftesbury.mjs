// Shaftesbury Theatre: the seating chart TodayTix draws for its bookings (Avenue Q, show 45732).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py shaftesbury=45732
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'shaftesbury',
  name: 'Shaftesbury Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Shaftesbury Theatre'],
  mapVenueIds: ['shaftesbury-theatre'],
  show: 45732,
  levels: ['Stalls', 'Royal Circle', 'Grand Circle'],
  stage: { width: 10, depth: 11 },
});
