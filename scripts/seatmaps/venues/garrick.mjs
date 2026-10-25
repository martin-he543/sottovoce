// Garrick Theatre: the seating chart TodayTix draws for its bookings (Cirque Berserk!, show 23465).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py garrick=23465
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'garrick',
  name: 'Garrick Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Garrick Theatre'],
  mapVenueIds: ['garrick-theatre'],
  show: 23465,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 9, depth: 9 },
});
