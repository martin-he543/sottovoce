import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTextDoc, tidy } from './librettoText';
import type { LibrettoText } from '../types/sottovoce';

const text = (language: LibrettoText['language'], acts: LibrettoText['acts'], scenesEn?: LibrettoText['scenesEn']): LibrettoText => ({
  id: 'x',
  title: 'X',
  language,
  form: null,
  source: '',
  source_url: '',
  acts,
  scenesEn,
});
const scene = (title: string, description: string) => ({ title, description, lines: [['A', 'Ciao', 'sung']] as [string, string, 'sung'][] });

test('tidy puts the space back between run-together sentences', () => {
  assert.equal(tidy("La chiesa di Sant'Andrea della Valle.A destra la cappella."), "La chiesa di Sant'Andrea della Valle. A destra la cappella.");
  assert.equal(tidy('S.A. Smith'), 'S.A. Smith');
});

test('scene settings carry their English translation', () => {
  const t = text('Italian', [{ heading: 'Atto primo', scenes: [scene('Scena prima', 'Una chiesa.A destra un altare.')] }], {
    a: ['First act'],
    t: ['First scene'],
    d: ['A church. On the right an altar.'],
  });
  const s = buildTextDoc(t, {}).doc.sections.find((x) => x.level === 2)!;
  assert.equal(s.summary, 'Una chiesa. A destra un altare.');
  assert.equal(s.summaryTranslation, 'A church. On the right an altar.');
});

test('German and French headings are normalised, unknown ones shown in English first', () => {
  const t = text(
    'German',
    [
      { heading: 'ZWEITER AKT', scenes: [scene('ERSTER AUFTRITT', ''), scene('SCÈNE III', '')] },
      { heading: 'Il sortilegio', scenes: [scene('Vorspiel zur Anbetung', '')] },
    ],
    { a: ['Act Two', 'The spell'], t: ['First entrance', 'Scene III', 'Prelude to the adoration'], d: ['', '', ''] }
  );
  const titles = buildTextDoc(t, {}).doc.sections.filter((x) => x.level < 3).map((x) => x.title);
  assert.deepEqual(titles, ['Act 2', 'Scene 1', 'Scene 3', 'The spell · Il sortilegio', 'Prelude to the adoration · Vorspiel zur Anbetung']);
});

test('English texts get no translated settings', () => {
  const t = text('English', [{ heading: 'Act 1', scenes: [scene('Scene 1', 'A church.')] }], { a: [''], t: [''], d: ['A church.'] });
  assert.equal(buildTextDoc(t, {}).doc.sections.find((x) => x.level === 2)!.summaryTranslation, undefined);
});

const titles = (t: LibrettoText) => buildTextDoc(t, {}).doc.sections.filter((s) => s.level < 3).map((s) => s.title);
const sung = (who: string, line: string): [string, string, 'sung'] => [who, line, 'sung'];

test('Italian ordinals past ten, fused or spaced, and final scenes', () => {
  const t = text('Italian', [
    { heading: 'Atto secondo', scenes: ['Scena tredicesima', 'Scena decima terza', 'Scena decimaquarta', 'Scena ventesimaprima', 'Scena ultima', 'Scena quarta e ultima'].map((x) => scene(x, '')) },
    { heading: 'Parte seconda', scenes: [scene('Parte prima', '')] },
  ]);
  assert.deepEqual(titles(t), ['Act 2', 'Scene 13', 'Scene 13', 'Scene 14', 'Scene 21', 'Final scene', 'Scene 4 (final)', 'Part 2', 'Part 1']);
});

test('French, German and Spanish act and scene words', () => {
  const t = text('French', [
    { heading: 'DEUXIÈME PARTIE', scenes: [scene('SCÈNE III', '')] },
    { heading: 'Dritter Aufzug', scenes: [scene('Vierter Auftritt', '')] },
    { heading: 'Acto segundo', scenes: [scene('Escena primera', '')] },
  ]);
  assert.deepEqual(titles(t), ['Part 2', 'Scene 3', 'Act 3', 'Scene 4', 'Act 2', 'Scene 1']);
});

test('an act with no scene divisions is cut at its numbered pieces, in any language', () => {
  const act = (marks: string[]) => ({
    heading: 'ERSTER AKT',
    scenes: [{ title: '', description: '', lines: [['', 'Ein Platz.', 'dir'], ...marks.flatMap((m, i) => [['', m, 'dir'], sung('A', `La ${i}`)])] as [string, string, 'sung' | 'dir'][] }],
  });
  assert.deepEqual(titles(text('German', [act(['Nr. 1 - Chor', 'Nr. 2 - Arie'])])), ['Act 1', 'No. 1 · Chor', 'No. 2 · Arie']);
  assert.deepEqual(titles(text('French', [act(['1bis - Choeur', 'Nº 2 - Air'])])), ['Act 1', 'No. 1bis · Choeur', 'No. 2 · Air']);
  assert.deepEqual(titles(text('French', [act(['SCÈNE II', 'SCÈNE III'])])), ['Act 1', 'Scene 2', 'Scene 3']);
  // No divisions: named by where it is set (its first stage direction) rather than "Scene 1".
  assert.deepEqual(titles(text('German', [act([])])).slice(0, 2), ['Act 1', 'Ein Platz']);
});
