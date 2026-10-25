// Piccadilly Theatre: the seating chart TodayTix draws for its bookings (Moulin Rouge! The Musical, show 23350).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py piccadilly=23350
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'piccadilly',
  name: 'Piccadilly Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Piccadilly Theatre'],
  mapVenueIds: ['piccadilly-theatre'],
  show: 23350,
  levels: ['Stalls', 'Royal Circle', 'Grand Circle'],
  stage: { width: 11, depth: 12 },
});
