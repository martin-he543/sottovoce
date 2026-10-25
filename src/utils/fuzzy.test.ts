import test from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, fuzzyRank, toFuzzyDoc, wordDistance } from './fuzzy';

const docs = [
  toFuzzyDoc('carmen', 'Carmen', ['Georges Bizet']),
  toFuzzyDoc('boheme', 'La bohème', ['Giacomo Puccini']),
  toFuzzyDoc('tosca', 'Tosca', ['Giacomo Puccini']),
  toFuzzyDoc('phantom', 'The Phantom of the Opera', ['Andrew Lloyd Webber']),
];

test('editDistance counts substitutions, swaps and gives up past the cap', () => {
  assert.equal(editDistance('carmem', 'carmen', 2), 1);
  assert.equal(editDistance('carmne', 'carmen', 2), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
});

test('wordDistance forgives typos in a half-typed word', () => {
  assert.equal(wordDistance('carm', 'carmen'), 0);
  assert.equal(wordDistance('carmem', 'carmen'), 1);
  assert.ok(wordDistance('cat', 'cut') > 0, 'short words match exactly');
});

test('fuzzyRank finds works through typos in title and people', () => {
  assert.deepEqual(fuzzyRank(docs, 'carmem').map((h) => h.item), ['carmen']);
  assert.deepEqual(fuzzyRank(docs, 'bohem').map((h) => h.item), ['boheme']);
  assert.deepEqual(fuzzyRank(docs, 'puchini').map((h) => h.item), ['boheme', 'tosca']);
  assert.deepEqual(fuzzyRank(docs, 'phantum opra').map((h) => h.item), ['phantom']);
});

test('fuzzyRank returns nothing for descriptions or tiny words', () => {
  assert.deepEqual(fuzzyRank(docs, 'play about bull fighter'), []);
  assert.deepEqual(fuzzyRank(docs, 'of'), []);
});
