// Peacock Theatre (Sadler's Wells): the seating chart TodayTix draws for its bookings (The Snowman, show 26625).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py peacock=26625
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'peacock',
  name: 'Peacock Theatre (Sadler\'s Wells)',
  hall: 'Main Auditorium',
  venueNames: ['Peacock Theatre (Sadler\'s Wells)'],
  mapVenueIds: ['sadlers-peacock'],
  show: 26625,
  levels: ['Stalls', 'Dress Circle'],
  geometry: [[0, 0.1, 3], [4, 0.3, 11]],
  stage: { width: 12, depth: 12, pit: 2 },
});
