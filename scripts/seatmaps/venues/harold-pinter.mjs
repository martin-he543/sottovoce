// Harold Pinter Theatre: the seating chart TodayTix draws for its bookings (The Cherry Orchard, show 46703).
// To recapture: python3 scripts/seatmaps/capture-todaytix.py harold-pinter=46703
import { todaytixVenue } from '../todaytix.mjs';

await todaytixVenue({
  id: 'harold-pinter',
  name: 'Harold Pinter Theatre',
  hall: 'Main Auditorium',
  venueNames: ['Harold Pinter Theatre'],
  mapVenueIds: ['harold-pinter-theatre'],
  show: 46703,
  levels: ['Stalls', 'Dress Circle', 'Royal Circle', 'Balcony'],
  rename: { ROYAL: 'Royal Circle' },
  stage: { width: 9, depth: 10 },
});
