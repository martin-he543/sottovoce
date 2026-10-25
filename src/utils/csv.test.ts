import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './csv';

test('quotes what needs quoting and keeps formulas as text', () => {
  const csv = toCsv([{ a: 'Carmen, Bizet', b: 'He said "bravo"', c: '=SUM(A1)' }], [
    ['Title', (r) => r.a],
    ['Note', (r) => r.b],
    ['Odd', (r) => r.c],
  ]);
  assert.equal(csv, '﻿Title,Note,Odd\r\n"Carmen, Bizet","He said ""bravo""",\'=SUM(A1)\r\n');
});
