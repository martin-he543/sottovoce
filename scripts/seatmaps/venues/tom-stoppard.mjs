// Tom Stoppard Theatre: the seating chart TodayTix draws for its bookings (RENT, show 46910).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py tom-stoppard=46910
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'tom-stoppard',
  name: 'Tom Stoppard Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Tom Stoppard Theatre'],
  mapVenueIds: ['tom-stoppard-theatre'],
  show: 46910,
  levels: ['Stalls', 'Royal Circle', 'Upper Circle'],
  skip: ['ON STAGE SEATING'],
  stage: { width: 9, depth: 10 },
});
