import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricTokens, matchHeard } from './lyricMatch';

const lines = [
  { original_text: 'Già, mi dicon venal, ma a donna bella non mi vendo a prezzo di moneta!' },
  { original_text: 'Vissi d’arte, vissi d’amore, non feci mai male ad anima viva!' },
  { original_text: 'Sempre con fè sincera diedi fiori agli altar… Nell’ora del dolore perché, perché, Signor, me ne rimuneri così?' },
  { original_text: 'Spoletta! Come facemmo col Conte Palmieri… Hai ben compreso?' },
];

test('tokens drop accents, case and punctuation', () => {
  assert.deepEqual(lyricTokens('Vissi d’arte, già!'), ['vissi', 'd', 'arte', 'gia']);
});

test('a clean fragment finds its line', () => {
  assert.equal(matchHeard('vissi darte vissi damore', lines)?.index, 1);
});

test('recogniser near-misses still match', () => {
  assert.equal(matchHeard('visi d arte vissi d amor non fechi mai male', lines)?.index, 1);
  assert.equal(matchHeard('sempre con fe sincera diedi fiori', lines)?.index, 2);
});

test('unrelated speech matches nothing', () => {
  assert.equal(matchHeard('please turn off your mobile phones', lines), null);
  assert.equal(matchHeard('ah', lines), null);
});

test('later lines win when two lines are heard together', () => {
  assert.equal(matchHeard('vissi d arte vissi d amore non feci mai male ad anima viva sempre con fe sincera diedi fiori', lines, 1)?.index, 2);
});

test('a transcript covering several short lines lands on the last of them', () => {
  const lines = [
    'Der Vogelfänger bin ich ja,',
    'stets lustig heißa hopsassa!',
    'Ich Vogelfänger bin bekannt',
    'bei Alt und Jung im ganzen Land.',
    'Weiß mit dem Locken umzugehn',
    'und mich aufs Pfeifen zu verstehn.',
  ].map((original_text) => ({ original_text }));
  const m = matchHeard('der vogelfänger bin ich ja stets lustig heißa hopsassa ich vogelfänger bin bekannt', lines, 0);
  assert.equal(m?.index, 2);
});
