// Phoenix Theatre: the seating chart TodayTix draws for its bookings (Stranger Things: The First Shadow, show 29263).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py phoenix=29263
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'phoenix',
  name: 'Phoenix Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Phoenix Theatre'],
  mapVenueIds: ['phoenix-theatre'],
  show: 29263,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 10, depth: 10 },
});
