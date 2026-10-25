// St Martin's Theatre: the seating chart TodayTix draws for its bookings (The Mousetrap, show 333).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py st-martins=333
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'st-martins',
  name: 'St Martin\'s Theatre',
  hall: 'Main Auditorium',
  venueNames: ['St Martin\'s Theatre'],
  mapVenueIds: ['st-martins-theatre'],
  show: 333,
  levels: ['Stalls', 'Dress Circle', 'Upper Circle'],
  rename: { 'ORCHESTRA STALLS': 'Stalls' },
  geometry: [[0, 0.07, 2.5], [3.5, 0.3, 9], [6.5, 0.42, 12]],
  stage: { width: 7.5, depth: 7, pit: 0 },
});
