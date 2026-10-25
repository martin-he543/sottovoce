// Lyric Hammersmith: the seating chart TodayTix draws for its bookings (Jaja's African Hair Braiding, show 45247).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py lyric-hammersmith=45247
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'lyric-hammersmith',
  name: 'Lyric Hammersmith',
  hall: 'Main House',
  venueNames: ['Lyric Hammersmith'],
  mapVenueIds: ['lyric'],
  halls: ['Main House'],
  show: 45247,
  levels: ['Stalls', 'Circle', 'Upper Circle'],
  rename: { 'CIRCLE BOXES': 'Circle' },
  geometry: [[0, 0.08, 3], [4, 0.3, 9], [7.5, 0.42, 12]],
  stage: { width: 10, depth: 9, pit: 2 },
});
