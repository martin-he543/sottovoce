import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimetableEvent, TimetableVenue } from '../data/timetableCategories';
import { literalEventMatch, localEventSearch } from './eventSearch';

const venues = new Map<string, TimetableVenue>([
  ['wig', { id: 'wig', name: 'Wigmore Hall', kind: 'concert', address: '36 Wigmore Street, London W1U 2BP' }],
  ['roh', { id: 'roh', name: 'Royal Opera House', kind: 'opera', address: 'Bow Street, London WC2E 9DD' }],
]);
const ev = (id: string, title: string, venue: string, extra: Partial<TimetableEvent> = {}): TimetableEvent => ({
  id, title, venue_id: venue, venue_name: venues.get(venue)!.name, category: 'classical', start: '2026-11-07T19:30:00+00:00', time_known: true, source: 'venue', ...extra,
});
const events = [
  ev('a', 'Ignas Maknickas piano', 'wig', { blurb: 'Chopin: Ballade No. 1 in G minor Op. 23; Liszt: Sonata in B minor' }),
  ev('b', 'Carmen', 'roh', { category: 'opera', hall: 'Linbury Theatre', price: 'from £28' }),
  ev('c', 'Swan Lake', 'roh', { category: 'dance', start: '2026-11-08T14:00:00+00:00' }),
];

test('finds a piece named only in the description', () => {
  assert.deepEqual([...localEventSearch(events, venues, 'ballade no 1').keys()], ['a']);
});

test('matches venue, hall, address, price and spoken dates', () => {
  assert.ok(localEventSearch(events, venues, 'linbury').has('b'));
  assert.ok(localEventSearch(events, venues, 'wigmore street').has('a'));
  assert.ok(localEventSearch(events, venues, 'bow street').has('c'));
  assert.ok(localEventSearch(events, venues, '£28').has('b') || localEventSearch(events, venues, '28').has('b'));
  assert.deepEqual([...localEventSearch(events, venues, 'sunday november').keys()], ['c']);
});

test('forgives typos and half-typed words', () => {
  assert.ok(localEventSearch(events, venues, 'carmem').has('b'));
  assert.ok(localEventSearch(events, venues, 'swa').has('c'));
  assert.ok(localEventSearch(events, venues, 'swan la').has('c'));
});

test('every word must match when some listing has them all; title hits outrank description hits', () => {
  assert.deepEqual([...localEventSearch(events, venues, 'chopin ballade').keys()], ['a']);
  const s = localEventSearch(events, venues, 'opera');
  assert.ok((s.get('b') ?? 0) > 0);
});

test('with no listing holding every word, those holding most of them come back, scored lower', () => {
  const partial = localEventSearch(events, venues, 'carmen chopin');
  assert.deepEqual([...partial.keys()].sort(), ['a', 'b']);
  assert.ok(partial.get('b')! < localEventSearch(events, venues, 'carmen').get('b')!);
  assert.equal(localEventSearch(events, venues, 'carmen zzzz qqqq').size, 0);
});

test('little words in a sentence need not match', () => {
  assert.deepEqual([...localEventSearch(events, venues, 'a ballade by Chopin').keys()], ['a']);
});

test('literal match is plain substring on title, venue and hall', () => {
  assert.ok(literalEventMatch(events[1], 'carmen'));
  assert.ok(!literalEventMatch(events[1], 'chopin'));
});
