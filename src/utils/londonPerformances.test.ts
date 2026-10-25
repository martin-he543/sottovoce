import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimetableEvent } from '../data/timetableCategories';
import type { RepertoireWork } from '../types/sottovoce';
import { matchPerformances, normTitle, titleCandidates } from './londonPerformances';

const work = (id: string, title: string, kind: RepertoireWork['kind'], composers: string[]): RepertoireWork =>
  ({ id, title, kind, genre: kind, composers, librettists: [], lyricists: [], year: null, premiere_venue: null, languages: [], based_on: [],
    popularity: 1, summary: '', has_synopsis: false, roles_count: 0, wikipedia_url: '' }) as RepertoireWork;

const ev = (id: string, title: string, category: TimetableEvent['category'], day = '2026-11-01', extra: Partial<TimetableEvent> = {}): TimetableEvent =>
  ({ id, title, category, start: `${day}T19:30:00+00:00`, time_known: true, venue_id: 'v', venue_name: 'Venue', source: 'venue', ...extra }) as TimetableEvent;

const works = [
  work('Q1', 'Tosca', 'opera', ['Giacomo Puccini']),
  work('Q2', 'Hamlet', 'opera', ['Ambroise Thomas']),
  work('Q3', 'Orfeo ed Euridice', 'opera', ['Christoph Willibald Gluck']),
  work('Q4', 'Orpheus and Eurydice', 'opera', ['Alexander Zhurbin']),
  work('Q5', 'Chopin', 'opera', ['Giacomo Orefice']),
  work('Q6', 'Cats', 'musical', ['Andrew Lloyd Webber']),
  work('Q7', 'Hamilton', 'musical', ['Lin-Manuel Miranda']),
  work('Q8', 'Hamlet', 'musical', ['Somebody Else']),
];

test('normTitle drops accents, punctuation and a leading article', () => {
  assert.equal(normTitle('The Magic Flute'), 'magic flute');
  assert.equal(normTitle('Così fan tutte'), 'cosi fan tutte');
  assert.equal(normTitle("L'incoronazione di Poppea"), 'incoronazione di poppea');
});

test('titleCandidates finds the work name inside decorated listing titles', () => {
  const keys = titleCandidates('Puccini: Tosca').map((c) => c.key);
  assert.ok(keys.includes('tosca'));
  assert.ok(titleCandidates('Un ballo in maschera (A Masked Ball)').some((c) => c.key === 'ballo in maschera'));
  assert.ok(titleCandidates('Cats - The Musical').some((c) => c.key === 'cats'));
});

test('counts upcoming listings by work and category', () => {
  const r = matchPerformances(
    works,
    [
      ev('a', 'Tosca', 'opera'),
      ev('b', 'Puccini: Tosca', 'classical', '2026-11-02'),
      ev('c', 'Tosca', 'opera', '2026-10-01'), // past
      ev('d', 'Cats', 'musical'),
      ev('e', 'Cats', 'drama'), // a play, not the musical
      ev('f', 'Hamilton', 'musical'),
    ],
    '2026-10-24'
  );
  assert.equal(r.count('Q1'), 2);
  assert.equal(r.count('Q6'), 1);
  assert.equal(r.count('Q7'), 1);
  assert.deepEqual(r.byWork.get('Q1')!.map((e) => e.id), ['a', 'b']);
});

test('the kind of listing decides between works that share a title', () => {
  const r = matchPerformances(works, [ev('a', 'Hamlet', 'opera'), ev('b', 'Hamlet', 'musical')], '2026-10-24');
  assert.equal(r.count('Q2'), 1);
  assert.equal(r.count('Q8'), 1);
});

test('a composer prefix must be the work’s composer', () => {
  const r = matchPerformances(works, [ev('a', 'Gluck: Orpheus and Eurydice', 'opera')], '2026-10-24');
  assert.equal(r.count('Q4'), 0);
});

test('a recital named after a composer is not an opera of that name', () => {
  const r = matchPerformances(works, [ev('a', 'Chopin - The Cello Works', 'classical'), ev('b', 'Chopin & Champagne by Candlelight', 'classical')], '2026-10-24');
  assert.equal(r.count('Q5'), 0);
});
