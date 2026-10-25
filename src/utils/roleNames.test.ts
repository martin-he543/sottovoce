import test from 'node:test';
import assert from 'node:assert/strict';
import { roleInEnglish } from './roleNames';

test('parts named by what they are come out in English', () => {
  assert.equal(roleInEnglish('DIAVOLO'), 'Devil');
  assert.equal(roleInEnglish('CORO DI DONNE'), 'Chorus of women');
  assert.equal(roleInEnglish('GIOVE'), 'Jupiter');
  assert.equal(roleInEnglish('ALLE DREI'), 'All three');
  assert.equal(roleInEnglish('LE CHŒUR'), 'Chorus');
  assert.equal(roleInEnglish('CONTE ALMAVIVA'), 'Count Almaviva');
});

test('proper names and English names are left alone', () => {
  assert.equal(roleInEnglish('RODRIGO'), '');
  assert.equal(roleInEnglish('DON ALVARO'), '');
  assert.equal(roleInEnglish('Chorus'), '');
  assert.equal(roleInEnglish(''), '');
});
