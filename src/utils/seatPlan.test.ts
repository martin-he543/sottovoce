import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { layoutPlan, plansFor, rowOrder, seatKey, type SeatPlan, type SeatPlanSummary } from './seatPlan';

const DIR = path.join(import.meta.dirname, '../../public/seatmaps');

// Two tiers drawn side by side in plan units (10 units per seat), stage at the top, rows as close as seats.
const plan = {
  id: 't', name: 'Test', hall: 'Main', capacity: 0, seated: 0,
  source: { system: 'x', url: '', captured: '', method: 'extracted' },
  stage: { type: 'proscenium', width: 10, depth: 8 },
  levels: [
    { name: 'Stalls', height: 0, rake: 0.1, front: 3, sections: [{ name: 'Stalls', rows: ['A', 'B', 'C'].map((row, r) => ({ row, seats: [1, 2, 3, 4, 5].map((n) => [String(n), n * 10, r * 10] as [string, number, number]) })) }] },
    { name: 'Circle', height: 4, rake: 0.4, front: 6, sections: [{ name: 'Circle', rows: ['A', 'B'].map((row, r) => ({ row, seats: [1, 2, 3].map((n) => [String(n), 500 + n * 10, 500 + r * 10] as [string, number, number]) })) }] },
  ],
} as SeatPlan;

test('lays tiers out on the stage at the right scale, depth and height', () => {
  const { seats, runs } = layoutPlan(plan);
  const at = (level: number, row: string, num: string) => seats.find((s) => s.level === level && s.row === row && s.num === num)!;
  assert.ok(Math.abs(at(0, 'A', '2').x - at(0, 'A', '1').x - 0.52) < 1e-6, 'seat pitch 0.52 m');
  assert.ok(Math.abs(at(0, 'B', '3').z - at(0, 'A', '3').z - 0.85) < 1e-6, 'rows stretched to 0.85 m');
  assert.ok(Math.abs(at(0, 'A', '3').x) < 1e-6 && Math.abs(at(0, 'A', '3').z - 3) < 1e-6, 'centred, front row 3 m back');
  assert.ok(Math.abs(at(1, 'A', '2').z - 6) < 1e-6 && at(1, 'A', '2').y === 4, 'circle front 6 m back, 4 m up');
  assert.ok(at(1, 'B', '2').y > at(1, 'A', '2').y, 'raked');
  assert.ok(Math.abs(Math.abs(at(0, 'A', '3').yaw) - Math.PI) < 1e-6, 'centre seat faces the stage (-z)');
  assert.equal(runs.length, 5);
});

test('a ringed tier rises with distance from the hall middle, not from the stage', () => {
  // One row of seats on a circle of radius 10 units * 10 about (100, 100), shared frame, stage edge at (100, 0).
  const seats = [0, 1, 2, 3].map((k) => [String(k + 1), 100 + 100 * Math.sin(k), 100 + 100 * Math.cos(k)] as [string, number, number]);
  const round = (ring?: [number, number]) =>
    layoutPlan({ ...plan, levels: [{ name: 'Circle', height: 5, rake: 0.5, scale: 0.05, origin: [100, 0], ring, sections: [{ name: 'Circle', rows: [{ row: '1', seats }, { row: '2', seats: seats.map(([n, x, y]) => [n, x * 1.1 - 10, y * 1.1 - 10] as [string, number, number]) }] }] }] });
  const flat = round(), ringed = round([100, 100]);
  assert.ok(flat.seats.slice(0, 4).some((s) => s.y > 5), 'rises away from the stage without a ring');
  assert.ok(ringed.seats.slice(0, 4).every((s) => Math.abs(s.y - 5) < 1e-6), 'the same radius is level');
  assert.ok(ringed.seats.slice(4).every((s) => s.y > 5), 'the next row out is higher');
});

test('rows sort A–Z, then AA, then boxes', () => {
  assert.deepEqual(['Box 10', 'AA', 'B', 'Box 9', 'A'].sort(rowOrder), ['A', 'B', 'AA', 'Box 9', 'Box 10']);
});

test('finds plans by venue id or name, and by hall', () => {
  const ix = [
    { id: 'olivier', venueNames: ['National Theatre'], mapVenueIds: ['nt'], halls: ['Olivier Theatre'] },
    { id: 'roh', venueNames: ['Royal Opera House'], mapVenueIds: ['roh'] },
  ] as SeatPlanSummary[];
  assert.deepEqual(plansFor(ix, { name: 'Royal Opera House' }).map((p) => p.id), ['roh']);
  assert.deepEqual(plansFor(ix, { id: 'nt', hall: 'Olivier Theatre' }).map((p) => p.id), ['olivier']);
  assert.deepEqual(plansFor(ix, { id: 'nt', hall: 'Dorfman Theatre' }), []);
});

test('every published plan lays out with unique seat keys and sane geometry', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')) as SeatPlanSummary[];
  assert.ok(index.length >= 10);
  for (const entry of index) {
    const p = JSON.parse(fs.readFileSync(path.join(DIR, `${entry.id}.json`), 'utf8')) as SeatPlan;
    const { seats } = layoutPlan(p);
    assert.equal(seats.length, p.seated, entry.id);
    assert.equal(new Set(seats.map((s) => seatKey(p, s))).size, seats.length, `${entry.id}: duplicate seat keys`);
    for (const s of seats) {
      assert.ok([s.x, s.y, s.z, s.yaw].every(Number.isFinite), `${entry.id}: bad seat ${seatKey(p, s)}`);
      assert.ok(Math.abs(s.x) < 40 && s.z > -15 && s.z < 60 && s.y >= -5 && s.y < 40, `${entry.id}: ${seatKey(p, s)} out of the building`);
    }
  }
});
