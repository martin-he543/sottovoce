// Vaudeville Theatre: the seating chart TodayTix draws for its bookings (SIX the Musical, show 12201).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py vaudeville=12201
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'vaudeville',
  name: 'Vaudeville Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Vaudeville Theatre'],
  mapVenueIds: ['vaudeville-theatre'],
  show: 12201,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 8, depth: 8, pit: 1.5 },
});
