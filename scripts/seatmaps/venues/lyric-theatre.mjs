// Lyric Theatre: the seating chart TodayTix draws for its bookings (Hadestown, show 24465).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py lyric-theatre=24465
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'lyric-theatre',
  name: 'Lyric Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Lyric Theatre'],
  mapVenueIds: ['lyric-theatre'],
  show: 24465,
  levels: ['Stalls', 'Dress Circle', 'Grand Circle', 'Balcony'],
  stage: { width: 10, depth: 11 },
});
