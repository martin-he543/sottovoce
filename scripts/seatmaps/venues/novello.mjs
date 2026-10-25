// Novello Theatre: the seating chart TodayTix draws for its bookings (Mamma Mia!, show 304).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py novello=304
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'novello',
  name: 'Novello Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Novello Theatre'],
  mapVenueIds: ['novello-theatre'],
  show: 304,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle', 'Balcony'],
  stage: { width: 10, depth: 11 },
});
