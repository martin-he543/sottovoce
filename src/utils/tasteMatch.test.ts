import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidatePool, libraryArtists, upcomingUnique } from './tasteMatch';
import type { TimetableEvent } from '../data/timetableCategories';

const ev = (id: string, title: string, category: TimetableEvent['category'], start: string, blurb = 'x'): TimetableEvent => ({
  id, title, category, start, time_known: true, venue_id: 'v', venue_name: 'V', blurb, source: 'venue',
});
const lib = {
  artists: [{ name: 'Magdalena Bay', playcount: 1450 }],
  albums: [{ name: 'Imaginal Disk', artist: 'Magdalena Bay', playcount: 500 }],
  tracks: [],
};

test('ranks artist mentions first and drops past / duplicate events', () => {
  const events = [
    ev('1', 'Tosca', 'opera', '2099-01-02T19:00:00Z'),
    ev('2', 'Magdalena Bay live', 'live_music', '2099-01-03T19:00:00Z'),
    ev('3', 'Old show', 'opera', '2000-01-01T19:00:00Z'),
    ev('4', 'Tosca', 'opera', '2099-01-09T19:00:00Z'),
  ];
  assert.equal(upcomingUnique(events).length, 2);
  const pool = buildCandidatePool(events, lib);
  assert.equal(pool[0].event.id, '2');
  assert.deepEqual(pool[0].matched, ['Magdalena Bay']);
});

test('libraryArtists merges artists from albums and tracks', () => {
  assert.deepEqual(libraryArtists(lib), ['Magdalena Bay']);
});
