// Sadler's Wells: the seating chart TodayTix draws for its bookings (Singin' in the Rain, show 22731).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py sadlers=22731
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'sadlers',
  name: 'Sadler\'s Wells',
  hall: 'Sadler\'s Wells Theatre',
  venueNames: ['Sadler\'s Wells'],
  mapVenueIds: ['sadlers'],
  halls: ['Sadler\'s Wells Theatre'],
  show: 22731,
  levels: ['Stalls', 'First Circle', 'Second Circle'],
  stage: { width: 16, depth: 16, pit: 3 },
});
