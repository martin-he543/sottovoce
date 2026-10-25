// Gielgud Theatre: the seating chart TodayTix draws for its bookings (Oliver!, show 40713).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py gielgud=40713
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'gielgud',
  name: 'Gielgud Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Gielgud Theatre'],
  mapVenueIds: ['gielgud-theatre'],
  show: 40713,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 8.5, depth: 9 },
});
