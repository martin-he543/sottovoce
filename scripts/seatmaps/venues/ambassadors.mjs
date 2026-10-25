// Ambassadors Theatre: the seating chart TodayTix draws for its bookings (Paranormal Activity, show 45604).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py ambassadors=45604
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'ambassadors',
  name: 'Ambassadors Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Ambassadors Theatre'],
  mapVenueIds: ['ambassadors-theatre'],
  show: 45604,
  levels: ['Stalls', 'Circle'],
  geometry: [[0, 0.07, 2.5], [3.2, 0.3, 8]],
  stage: { width: 7.5, depth: 7, pit: 0 },
});
