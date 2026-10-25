// Aldwych Theatre: the seating chart TodayTix draws for its bookings (Sinatra The Musical, show 46142).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py aldwych=46142
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'aldwych',
  name: 'Aldwych Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Aldwych Theatre'],
  mapVenueIds: ['aldwych-theatre'],
  show: 46142,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle'],
  stage: { width: 9.5, depth: 10 },
});
