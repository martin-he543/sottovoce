// Savoy Theatre: the seating chart TodayTix draws for its bookings (Paddington The Musical, show 44232).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py savoy=44232
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'savoy',
  name: 'Savoy Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Savoy Theatre'],
  mapVenueIds: ['savoy-theatre'],
  show: 44232,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 10, depth: 10 },
});
