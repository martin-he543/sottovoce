// Trafalgar Theatre: the seating chart TodayTix draws for its bookings (Oh, Mary!, show 45447).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py trafalgar=45447
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'trafalgar',
  name: 'Trafalgar Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Trafalgar Theatre'],
  mapVenueIds: ['trafalgar-theatre'],
  show: 45447,
  levels: ['Stalls', 'Dress Circle'],
  geometry: [[0, 0.08, 3], [3.8, 0.3, 10]],
  stage: { width: 9, depth: 9, pit: 1.5 },
});
