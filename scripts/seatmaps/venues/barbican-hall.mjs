// Barbican Hall: the Spektrix plan behind tickets.barbican.org.uk's "Choose seats" map (e.g. /choose-seats/3643201).
import { fetchCached, spektrixLevels, writePlan } from '../lib.mjs';

const URL = 'https://spektrix.barbican.org.uk/barbicancentre/api/v3/plans/1811AQSSVVDCLHBQBNGBGQBVHMNSQDQBR';
const raw = JSON.parse(await fetchCached('barbican-hall.spektrix.json', URL));

const LEVELS = {
  Stalls: { height: 0, rake: 0.1, front: 2 },
  Circle: { height: 5, rake: 0.35, front: 15 },
  Balcony: { height: 9.5, rake: 0.45, front: 20 },
};

// The booking map draws the platform at the bottom: turn it 180° so the stage is at the top.
const turn = (l) => ({ ...l, sections: l.sections.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, seats: r.seats.map(([n, x, y]) => [n, -x, -y]) })) })) });

await writePlan({
  id: 'barbican-hall',
  name: 'Barbican Centre',
  hall: 'Barbican Hall',
  venueNames: ['Barbican Centre', 'Barbican Hall', 'Barbican'],
  mapVenueIds: ['barbican', 'ext_barbican-centre'],
  source: { system: 'Spektrix', url: 'https://tickets.barbican.org.uk/choose-seats/3643201', captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'platform', width: 20, depth: 12 },
  levels: spektrixLevels(raw).map((l) => ({ ...turn(l), ...LEVELS[l.name] })),
});
