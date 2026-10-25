// Prince of Wales Theatre: the seating chart TodayTix draws for its bookings (The Book of Mormon, show 287).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py prince-of-wales=287
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'prince-of-wales',
  name: 'Prince of Wales Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Prince of Wales Theatre'],
  mapVenueIds: ['prince-of-wales-theatre'],
  show: 287,
  levels: ['Stalls', 'Circle'],
  geometry: [[0, 0.08, 3], [4.5, 0.3, 11]],
  stage: { width: 12, depth: 14, pit: 3 },
});
