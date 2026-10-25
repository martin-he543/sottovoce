import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrettoDoc, buildSynopsisDoc, headingLevel, searchDoc, sectionForStory } from './followDoc';
import type { RepertoireDetail, WorkAndLibretto } from '../types/sottovoce';

const detail = {
  lead: 'Berlioz’s dramatic legend.',
  synopsis: [
    { heading: 'Part 1', text: 'Faust wanders the plains of Hungary at dawn.' },
    { heading: 'Part 2', text: 'Faust in his study in Germany; Mephistopheles appears.' },
    { heading: 'Scene 3', text: 'Auerbach’s cellar, where students drink.' },
  ],
} as unknown as RepertoireDetail;

test('headings are levelled', () => {
  assert.equal(headingLevel('Act 1'), 1);
  assert.equal(headingLevel('Scene 2'), 2);
  assert.equal(headingLevel('Act 1, Scene 2'), 2);
});

test('a synopsis becomes sections, with an overview first', () => {
  const doc = buildSynopsisDoc(detail);
  assert.deepEqual(doc.sections.map((s) => s.title), ['Overview', 'Part 1', 'Part 2', 'Scene 3']);
  assert.equal(doc.hasLibretto, false);
});

test('typed section names and roman numerals find the section', () => {
  const doc = buildSynopsisDoc(detail);
  assert.equal(searchDoc(doc, 'part 2')[0].sectionId, 's1');
  assert.equal(searchDoc(doc, 'Part II')[0].sectionId, 's1');
  assert.equal(searchDoc(doc, 'cellar students')[0].sectionId, 's2');
  assert.equal(sectionForStory(doc, 'Part 2, in the study')?.id, 's1');
});

test('typed lyrics find their line in a libretto', () => {
  const lines = ['Vissi d’arte, vissi d’amore', 'Non feci mai male ad anima viva', 'Sempre con fè sincera', 'Diedi fiori agli altar', 'Nell’ora del dolore', 'Perché, perché, Signor', 'Me ne rimuneri così', 'Ah', 'Tosca finale', 'Spoletta'].map(
    (original_text, line_index) => ({ line_index, original_text, character: 'Tosca', literal_english: '', dramatic_subtext: '' })
  );
  const doc = buildLibrettoDoc({ current_act: 2, current_scene: 1, scene_title: '', lines } as unknown as WorkAndLibretto);
  const hit = searchDoc(doc, 'sempre con fe sincera').find((h) => h.entryId);
  assert.equal(hit?.entryId, 'l2');
  assert.ok(doc.sections.some((s) => s.level === 3));
});

test('a full libretto gets every act and scene, with seed translations kept on matching lines', async () => {
  const { buildTextDoc } = await import('./librettoText');
  const text = {
    id: 'Q1',
    title: 'Tosca',
    language: 'Italian',
    form: null,
    source: 's',
    source_url: 'u',
    acts: [
      { heading: 'Atto primo', scenes: [{ title: 'Scena prima', description: 'Una chiesa.', lines: [['ANGELOTTI', 'Ah! Finalmente!', 'sung'], ['', '(si nasconde)', 'dir']] }] },
      { heading: 'Atto secondo', scenes: [{ title: 'Scena quinta', description: '', lines: [['TOSCA', 'Vissi d’arte', 'sung']] }] },
    ],
  } as unknown as Parameters<typeof buildTextDoc>[0];
  const seed = { lines: [{ original_text: 'Vissi d’arte', literal_english: 'I lived for art', dramatic_subtext: 'prayer', character: 'Floria Tosca', bar_number: 7 }] } as unknown as WorkAndLibretto;
  const { doc, work } = buildTextDoc(text, {}, seed);
  assert.deepEqual(doc.sections.filter((s) => s.level < 3).map((s) => s.title), ['Act 1', 'Scene 1', 'Act 2', 'Scene 5']);
  assert.equal(work.lines.length, 2);
  assert.equal(work.lines[1].literal_english, 'I lived for art');
  assert.equal(work.lines[0].character, 'Angelotti');
  assert.equal(doc.sections.at(-1)!.entries[0].libIdx, 1);
});
