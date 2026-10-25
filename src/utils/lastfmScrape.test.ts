import test from 'node:test';
import assert from 'node:assert/strict';
import { isChallengePage, parseLibraryPage, parseTotalScrobbles } from './lastfmScrape';

const row = (name: string, artist: string | null, count: string) => `
<tr class="chartlist-row"><td class="chartlist-name"><a href="/music/x">${name}</a></td>
${artist ? `<td class="chartlist-artist"><a href="/music/y">${artist}</a></td>` : ''}
<td class="chartlist-bar"><span class="chartlist-count-bar-link"><span class="chartlist-count-bar-value">${count} <span class="stat-name">scrobbles</span></span></span></td></tr>`;

test('parses artists and tracks', () => {
  assert.deepEqual(parseLibraryPage(`<table>${row('Caroline Polachek', null, '1,234')}</table>`, 'artists').map((r) => [r.name, r.playcount]), [['Caroline Polachek', 1234]]);
  const t = parseLibraryPage(`<table>${row('Gone', 'Charli', '42')}</table>`, 'tracks')[0];
  assert.equal(t.artist, 'Charli');
  assert.equal(t.url, 'https://www.last.fm/music/x');
});

test('reads total scrobbles', () => {
  assert.equal(parseTotalScrobbles('<div class="header-metadata-tnew-item"><h4>Scrobbles</h4><p>98,765</p></div>'), 98765);
});

test('detects bot-check page', () => {
  assert.ok(isChallengePage('<html><head><title>Client Challenge</title>'));
  assert.ok(!isChallengePage('<title>rj’s Library</title>'));
});
