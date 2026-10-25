import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { layoutPlan, seatKey, type SeatPlan } from './seatPlan';
import { bandColor, estimateBands, parseListingPrice, priceAtListing, pricePlan, seatPrice, TYPICAL_PRICES } from './seatPrices';

const DIR = path.join(import.meta.dirname, '../../public/seatmaps');
const load = (id: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')) as SeatPlan;

test('reads listing prices', () => {
  assert.deepEqual(parseListingPrice('from £28'), { min: 28, max: null });
  assert.deepEqual(parseListingPrice('from £15-£48'), { min: 15, max: 48 });
  assert.deepEqual(parseListingPrice('from £18 (up to £45)'), { min: 18, max: 45 });
  assert.deepEqual(parseListingPrice('£65, £25, £45'), { min: 25, max: 65 });
  assert.equal(parseListingPrice('Free entry'), null);
  assert.equal(parseListingPrice(undefined), null);
});

test('estimated bands run from the cheapest to the dearest seat in box-office steps', () => {
  const b = estimateBands([12, 290]);
  assert.equal(b[0], 12);
  assert.equal(b.at(-1), 290);
  assert.ok(b.every((x, i) => i === 0 || x > b[i - 1]));
  assert.ok(b.slice(1, -1).every((x) => x < 20 || x % 5 === 0));
});

test('carries a seat over to a listing’s range', () => {
  assert.equal(priceAtListing(12, [12, 290], { min: 15, max: null }), 15);
  assert.equal(priceAtListing(290, [12, 290], { min: 15, max: null }), 290);
  assert.equal(priceAtListing(290, [12, 290], { min: 15, max: 95 }), 95);
  assert.equal(priceAtListing(151, [12, 290], { min: 10, max: 110 }), 60);
});

test('estimates put the dearest seats close and central, the cheapest far away', () => {
  const plan = load('roh');
  const layout = layoutPlan(plan);
  const pricing = pricePlan(plan, layout)!;
  assert.equal(pricing.source, 'typical');
  assert.deepEqual(pricing.range, TYPICAL_PRICES.roh);
  assert.ok(pricing.band.every((b) => b >= 0), 'every seat priced');
  const byKey = (k: string) => seatPrice(pricing, layout.seats.findIndex((s) => seatKey(plan, s) === k))!;
  const stalls = layout.seats.find((s) => s.level === 0 && s.row === 'F')!;
  const top = layout.seats.reduce((a, s) => (s.y > a.y ? s : a));
  assert.ok(byKey(seatKey(plan, stalls)) > byKey(seatKey(plan, top)));
});

test('captured plans price every seat from the booking map’s bands', () => {
  for (const id of ['apollo-victoria', 'lyceum', 'palace']) {
    const plan = load(id);
    const layout = layoutPlan(plan);
    const pricing = pricePlan(plan, layout)!;
    assert.equal(pricing.source, 'captured', id);
    assert.equal(pricing.band.length, layout.seats.length);
    assert.ok(pricing.band.every((b) => b >= 0 && b < pricing.bands.length), `${id}: every seat has a band`);
    assert.equal(pricing.counts.reduce((a, b) => a + b, 0), layout.seats.length);
  }
});

test('band colours are distinct hex shades', () => {
  const c = Array.from({ length: 11 }, (_, i) => bandColor(i, 11));
  assert.ok(c.every((x) => /^#[0-9a-f]{6}$/.test(x)));
  assert.equal(new Set(c).size, 11);
});
