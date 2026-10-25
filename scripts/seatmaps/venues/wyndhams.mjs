// Wyndham's Theatre: the seating chart TodayTix draws for its bookings (Hay Fever, show 46793).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py wyndhams=46793
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'wyndhams',
  name: 'Wyndham\'s Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Wyndham\'s Theatre'],
  mapVenueIds: ['wyndhams-theatre'],
  show: 46793,
  levels: ['Stalls', 'Royal Circle', 'Grand Circle'],
  stage: { width: 8.5, depth: 9 },
});
