// Sadler's Wells East: the seating chart TodayTix draws for its bookings (Ebony Scrooge, show 44904).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py sadlers-east=44904
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'sadlers-east',
  name: 'Sadler\'s Wells East',
  hall: 'Main Auditorium',
  venueNames: ['Sadler\'s Wells East'],
  mapVenueIds: ['sadlers-east'],
  show: 44904,
  levels: ['Stalls'],
  rename: { THEATRE: 'Stalls' },
  geometry: [[0, 0.25, 3]],
  stage: { width: 14, depth: 12, pit: 0 },
});
