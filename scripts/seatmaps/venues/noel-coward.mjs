// Noël Coward Theatre: the seating chart TodayTix draws for its bookings (Into The Woods, show 47065).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py noel-coward=47065
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'noel-coward',
  name: 'Noël Coward Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Noël Coward Theatre'],
  mapVenueIds: ['noel-coward-theatre'],
  show: 47065,
  levels: ['Stalls', 'Royal Circle', 'Grand Circle', 'Balcony'],
  stage: { width: 9.5, depth: 10 },
});
