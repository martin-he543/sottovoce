import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimetableEvent, TimetableVenue } from '../data/timetableCategories';
import { guessLive, liveAnywhere, liveStatus, metresBetween } from './liveGuess';

const venues: TimetableVenue[] = [
  { id: 'roh', name: 'Royal Opera House', kind: 'opera', lat: 51.5129, lng: -0.1222 },
  { id: 'coliseum', name: 'London Coliseum', kind: 'opera', lat: 51.5099, lng: -0.1267 },
  { id: 'far', name: 'Far Away Hall', kind: 'concert', lat: 51.6, lng: -0.3 },
];
const ev = (id: string, venue_id: string, start: string, category: TimetableEvent['category'] = 'opera'): TimetableEvent => ({
  id,
  title: id,
  category,
  start,
  time_known: true,
  venue_id,
  venue_name: venue_id,
  source: 'venue',
});

// A fixed instant (19:00 UTC); the listings below carry explicit offsets, so the tests don't depend on the clock change.
const now = new Date('2026-10-25T19:00:00Z');

test('distance is metres', () => {
  assert.ok(Math.abs(metresBetween(51.5129, -0.1222, 51.5099, -0.1267) - 440) < 40);
});

test('a show under way is on now; one far off is not', () => {
  assert.equal(liveStatus(ev('a', 'roh', '2026-10-25T19:30:00+01:00'), now), 'on-now');
  assert.equal(liveStatus(ev('b', 'roh', '2026-10-25T20:30:00+01:00'), now), 'starting-soon');
  assert.equal(liveStatus(ev('c', 'roh', '2026-10-25T14:00:00+01:00', 'drama'), now), 'earlier');
  assert.equal(liveStatus(ev('d', 'roh', '2026-10-26T19:30:00+01:00'), now), null);
});

test('standing at the opera house with one show on is a confident guess', () => {
  const g = guessLive({ lat: 51.5129, lng: -0.1222 }, [ev('tosca', 'roh', '2026-10-25T19:30:00+01:00'), ev('x', 'coliseum', '2026-10-25T19:30:00+01:00')], venues, now);
  assert.equal(g.confident?.event.id, 'tosca');
  assert.equal(g.candidates[0].event.id, 'tosca');
  assert.equal(g.nearestVenue?.venue.id, 'roh');
});

test('two shows in the same house at once fall back to the list', () => {
  const g = guessLive({ lat: 51.5129, lng: -0.1222 }, [ev('main', 'roh', '2026-10-25T19:30:00+01:00'), ev('studio', 'roh', '2026-10-25T19:45:00+01:00')], venues, now);
  assert.equal(g.confident, null);
  assert.equal(g.candidates.length, 2);
});

test('between two venues is not confident, and far away finds nothing', () => {
  const mid = guessLive({ lat: 51.5114, lng: -0.12445 }, [ev('a', 'roh', '2026-10-25T19:30:00+01:00'), ev('b', 'coliseum', '2026-10-25T19:30:00+01:00')], venues, now);
  assert.equal(mid.confident, null);
  const nowhere = guessLive({ lat: 52.5, lng: -1.9 }, [ev('a', 'roh', '2026-10-25T19:30:00+01:00')], venues, now);
  assert.deepEqual(nowhere.candidates, []);
});

test('without a location, shows what is on across London', () => {
  const list = liveAnywhere(
    [ev('a', 'roh', '2026-10-25T19:30:00+01:00'), ev('gig', 'far', '2026-10-25T19:30:00+01:00', 'live_music'), ev('later', 'roh', '2026-10-25T23:30:00+01:00')],
    venues,
    now
  );
  assert.deepEqual(list.map((c) => c.event.id), ['a']);
});

test('a matinee and an evening of the same show are one row', () => {
  const g = guessLive({ lat: 51.5129, lng: -0.1222 }, [ev('Show', 'roh', '2026-10-25T14:00:00+01:00', 'drama'), ev('Show', 'roh', '2026-10-25T19:30:00+01:00', 'drama')], venues, now);
  assert.equal(g.candidates.length, 1);
  assert.equal(g.candidates[0].status, 'on-now');
});

test('a neighbouring house 120 m away does not stop a confident guess, but a poor fix does', () => {
  const near: TimetableVenue[] = [...venues, { id: 'next', name: 'Next Door', kind: 'theatre', lat: 51.5129 + 0.00108, lng: -0.1222 }];
  const shows = [ev('here', 'roh', '2026-10-25T19:30:00+01:00'), ev('there', 'next', '2026-10-25T19:30:00+01:00')];
  assert.equal(guessLive({ lat: 51.5129, lng: -0.1222, accuracy: 15 }, shows, near, now).confident?.event.id, 'here');
  assert.equal(guessLive({ lat: 51.5129, lng: -0.1222, accuracy: 140 }, shows, near, now).confident, null);
});
