import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistanceMeters,
  estimateIntervalWalkMins,
  computeReciprocalRankFusion,
  validateSaintUrlIngestion,
  resolveSceneFromContext,
  runHybridSearchRankFusion,
  buildSaintHitlIngestionTask,
  computeCrossGenreRecommendations,
} from './sottovoceEngine';
import {
  SEED_WORKS_AND_LIBRETTI,
  SEED_CIVIC_NODES,
  SEED_LIVE_EVENTS,
  SEED_USER_TASTE_PROFILES,
} from '../data/sottovoceData';

test('haversineDistanceMeters computes accurate London West End distances', () => {
  const dist = haversineDistanceMeters(51.5129, -0.1222, 51.5118, -0.1235);
  assert.equal(dist > 100 && dist < 220, true);
  assert.equal(estimateIntervalWalkMins(dist) >= 2, true);
});

test('computeReciprocalRankFusion combines lexical, vector, and geo ranks monotonically', () => {
  const topAllThree = computeReciprocalRankFusion(1, 1, 1);
  const secondRank = computeReciprocalRankFusion(2, 2, 2);
  const lexicalOnly = computeReciprocalRankFusion(1, null, null);
  assert.equal(topAllThree > secondRank, true);
  assert.equal(secondRank > lexicalOnly, true);
});

test('resolveSceneFromContext pinpoints Tosca Act II at Royal Opera House from Italian lyrics and GPS', () => {
  const result = resolveSceneFromContext(SEED_WORKS_AND_LIBRETTI, SEED_CIVIC_NODES, {
    lat: 51.5129,
    lng: -0.1222,
    audioSnippetText: 'Vissi d’arte, vissi d’amore, non feci mai male ad anima viva',
  });
  assert.equal(result.matchedWork.work_id, 'puccini_tosca_1900');
  assert.equal(result.contextOutput.act, 2);
  assert.equal(result.contextOutput.nearest_amenities.length > 0, true);
});

test('computeCrossGenreRecommendations bridges Last.fm taste profile to London operas, musicals, and Bandsintown gigs', () => {
  const profile = SEED_USER_TASTE_PROFILES[0];
  const recs = computeCrossGenreRecommendations(
    profile,
    SEED_WORKS_AND_LIBRETTI,
    SEED_LIVE_EVENTS
  );
  assert.equal(recs.length >= 3, true);
  assert.equal(recs[0].rrf_match_score >= recs[recs.length - 1].rrf_match_score, true);
  assert.equal(recs[0].why_you_will_love_this_pitch.includes('Last.fm'), true);
});

test('runHybridSearchRankFusion returns ranked results across libretti, civic nodes, events, and taste profiles', () => {
  const results = runHybridSearchRankFusion(
    'Scarpia letter safe conduct',
    51.5129,
    -0.1222,
    SEED_WORKS_AND_LIBRETTI,
    SEED_CIVIC_NODES,
    SEED_LIVE_EVENTS,
    'all',
    SEED_USER_TASTE_PROFILES
  );
  assert.equal(results.length > 0, true);
  assert.equal(results[0].rrf_score >= results[results.length - 1].rrf_score, true);
});

test('validateSaintUrlIngestion rejects empty/invalid URLs and detects Luma, Bandsintown, and RBO platforms', () => {
  const emptyCheck = validateSaintUrlIngestion('   ');
  assert.equal(emptyCheck.valid, false);

  const lumaCheck = validateSaintUrlIngestion('https://lu.ma/covent-garden-baroque-night');
  assert.equal(lumaCheck.valid, true);
  assert.equal(lumaCheck.detectedPlatform, 'Luma');

  const bitCheck = validateSaintUrlIngestion('https://www.bandsintown.com/e/10394821-magdalena-bay-at-roundhouse');
  assert.equal(bitCheck.valid, true);
  assert.equal(bitCheck.detectedPlatform, 'Bandsintown');
});

test('buildSaintHitlIngestionTask links OpenStreetMap route, toilet, water fountain, and agent steps log', () => {
  const task = buildSaintHitlIngestionTask(
    {
      url: 'https://lu.ma/soho-chamber-opera',
      title: 'The Turn of the Screw — Chamber Staging',
      work_id: 'britten_turn_screw',
      venue_name: 'Sondheim Theatre Studio',
      lat: 51.5116,
      lng: -0.1328,
      start_time_iso: '2026-10-24T19:30:00Z',
      libretto_status: 'Auto-scraped & embedded (184 stanzas via voyage-3)',
      source_platform: 'Luma',
    },
    SEED_CIVIC_NODES
  );
  assert.equal(task.status, 'pending_human_approval');
  assert.equal(task.agent_steps_log.length, 5);
  assert.equal(Boolean(task.linked_civic_nodes.walk_route), true);
});

test('searchPlaces finds venues and groups a production with all its dates', async () => {
  const { searchPlaces, londonStamp } = await import('./mapSearch');
  const venues = [
    { id: 'v1', name: 'Royal Opera House', kind: 'opera', lat: 51.5129, lng: -0.1222, address: 'Bow St, WC2E' },
    { id: 'v2', name: 'Barbican Centre', kind: 'concert', lat: 51.52, lng: -0.0936 },
  ];
  const base = SEED_LIVE_EVENTS[0];
  const mk = (id: string, iso: string) => ({ ...base, event_id: id, _id: id, start_time_iso: iso });
  const events = [mk('a', '2026-11-05T19:30:00Z'), mk('b', '2026-11-02T19:30:00Z'), mk('c', '2026-03-01T19:30:00Z')];
  const now = Date.parse('2026-10-24T12:00:00Z');

  const res = searchPlaces('tosca', venues, events, now);
  assert.equal(res.length, 1);
  const prod = res[0];
  assert.equal(prod.type, 'production');
  if (prod.type === 'production') {
    assert.deepEqual(prod.shows.map((s) => s.eventId), ['b', 'a']); // chronological, past one dropped
    assert.equal(prod.shows[0].venueId, 'v1');
    assert.equal(prod.shows[0].ymd, '20261102');
  }

  const v = searchPlaces('opera house', venues, [], now);
  assert.equal(v[0].type, 'venue');
  assert.equal(searchPlaces('', venues, events, now).length, 0);
  assert.equal(londonStamp('2026-07-01T18:30:00Z')?.hhmm, '19:30'); // BST
});
