// Theatre Royal Haymarket: the seating chart TodayTix draws for its bookings (Peppa Pig’s Big Family Show!, show 44411).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py haymarket=44411
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'haymarket',
  name: 'Theatre Royal Haymarket',
  hall: 'Main Auditorium',
  venueNames: ['Theatre Royal Haymarket'],
  mapVenueIds: ['theatre-royal-haymarket'],
  show: 44411,
  levels: ['Stalls', 'Royal Circle', 'Upper Circle'],
  stage: { width: 10, depth: 13, pit: 3 },
});
