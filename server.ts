import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';
import { MongoClient } from 'mongodb';
import { toNodeHandler } from 'better-auth/node';
import { createAuth } from './src/server/auth';
import { deleteUserData, initUserData, mountUserData } from './src/server/userData';
import { searchEvents, type Understanding } from './src/server/eventSearch';
import { atlasHybridSearch, atlasSimilar, embedDocument, type AtlasTarget } from './src/server/atlasSearch';
import { createServer as createViteServer } from 'vite';
import { LastFmScrapeError, scrapeLastFmProfile } from './src/utils/lastfmScrape';
import { buildCandidatePool, libraryArtists, type ScoredEvent } from './src/utils/tasteMatch';
import type { TimetableEvent, TimetableVenue } from './src/data/timetableCategories';
import { layoutPlan, seatKey, seatSightline, type SeatPlan } from './src/utils/seatPlan';
import { parseListingPrice, priceAtListing, pricePlan, seatPrice } from './src/utils/seatPrices';
import {
  DEFAULT_OPEN_LONDON_TELEMETRY,
  MONGODB_ATLAS_SPECS,
  SEED_CIVIC_NODES,
  SEED_LIVE_EVENTS,
  SEED_SAINT_HITL_TASKS,
  SEED_USER_TASTE_PROFILES,
  SEED_WORKS_AND_LIBRETTI,
} from './src/data/sottovoceData';
import {
  buildSaintHitlIngestionTask,
  computeCrossGenreRecommendations,
  findNearestCivicAmenities,
  resolveSceneFromContext,
  runHybridSearchRankFusion,
  validateSaintUrlIngestion,
} from './src/utils/sottovoceEngine';
import type {
  CivicNode,
  LiveEvent,
  OpenLondonLiveTelemetry,
  SaintHitlTask,
  TastePick,
  UserTasteProfile,
  WorkAndLibretto,
} from './src/types/sottovoce';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const GEMINI_TIMEOUT_MS = 25000;
// The one model every call uses, with no flash fallbacks. Argon's quickest setting is thinking_level "low";
// temperature, top_p, top_k and thinking_budget are not set on it.
const ARGON = 'gemini-4-argon';
let lastAiError: string | null = null;

function describeAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch (_e) {
    return raw;
  }
}

function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
}

// Single entry point for every Gemini call: bounded by a timeout, and failures are logged and
// recorded (surfaced via /api/state) instead of being silently replaced by canned answers.
async function askGemini(
  params: Parameters<typeof ai.models.generateContent>[0]
): Promise<Awaited<ReturnType<typeof ai.models.generateContent>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request =
      params.model === ARGON
        ? { ...params, config: { ...params.config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW, ...params.config?.thinkingConfig } } }
        : params;
    const result = await Promise.race([
      ai.models.generateContent(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini request timed out')), GEMINI_TIMEOUT_MS);
      }),
    ]);
    lastAiError = null;
    return result;
  } catch (err) {
    lastAiError = describeAiError(err);
    console.error(`[gemini] ${params.model} failed: ${lastAiError}`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TASTE_AI_TTL_MS = 30 * 60_000;
const tasteAiCache = new Map<string, { at: number; body: Record<string, unknown> }>();

const EVENT_SUMMARY_TTL_MS = 6 * 3600_000;
const eventSummaryCache = new Map<string, { at: number; value: unknown }>();

// Every event URL in the generated timetable, reloaded when `npm run timetable` rewrites the file.
const TIMETABLE_FILE = path.join(__dirname, 'src/data/timetable.generated.json');
let timetableUrlSet: { mtimeMs: number; urls: Set<string> } | null = null;
function timetableUrls(): Set<string> {
  try {
    const mtimeMs = fs.statSync(TIMETABLE_FILE).mtimeMs;
    if (!timetableUrlSet || timetableUrlSet.mtimeMs !== mtimeMs) {
      const data = JSON.parse(fs.readFileSync(TIMETABLE_FILE, 'utf8')) as { events: { url?: string }[] };
      timetableUrlSet = { mtimeMs, urls: new Set(data.events.map((e) => e.url).filter((u): u is string => !!u)) };
    }
    return timetableUrlSet.urls;
  } catch {
    return new Set();
  }
}

let timetableVenues = new Map<string, TimetableVenue>();
let timetableEvents: { mtimeMs: number; events: TimetableEvent[] } | null = null;
function venueById() {
  loadTimetableEvents();
  return timetableVenues;
}

function loadTimetableEvents(): TimetableEvent[] {
  try {
    const mtimeMs = fs.statSync(TIMETABLE_FILE).mtimeMs;
    if (!timetableEvents || timetableEvents.mtimeMs !== mtimeMs) {
      const data = JSON.parse(fs.readFileSync(TIMETABLE_FILE, 'utf8')) as { events: TimetableEvent[]; venues?: TimetableVenue[] };
      timetableEvents = { mtimeMs, events: data.events };
      timetableVenues = new Map((data.venues ?? []).map((v) => [v.id, v]));
    }
    return timetableEvents.events;
  } catch {
    return [];
  }
}

let worksStore: WorkAndLibretto[] = structuredClone(SEED_WORKS_AND_LIBRETTI);
let civicNodesStore: CivicNode[] = structuredClone(SEED_CIVIC_NODES);
let liveEventsStore: LiveEvent[] = structuredClone(SEED_LIVE_EVENTS);
let tasteProfilesStore: UserTasteProfile[] = structuredClone(SEED_USER_TASTE_PROFILES);
let hitlTasksStore: SaintHitlTask[] = structuredClone(SEED_SAINT_HITL_TASKS);
let cachedOpenLondonTelemetry: OpenLondonLiveTelemetry = structuredClone(
  DEFAULT_OPEN_LONDON_TELEMETRY
);
let mongoConnected = false;
let mongoClient: MongoClient | null = null;
let streamTickCounter = 0;

/** In-memory cache of TfL `/Place/Type/{type}` results, keyed by place type. TfL doesn't support bbox filtering on this endpoint, so each type is fetched once and cached city-wide. */
const tflPlacesCache = new Map<string, { fetchedAtMs: number; places: any[] }>();
const TFL_PLACES_TTL_MS = 5 * 60 * 1000;

async function initMongoAtlasIfConfigured() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return;
  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 3500 });
    await mongoClient.connect();
    const db = mongoClient.db('sottovoce_prod');
    const worksCol = db.collection<WorkAndLibretto>('works_and_libretti');
    const civicCol = db.collection<CivicNode>('civic_nodes');
    const eventsCol = db.collection<LiveEvent>('live_events');
    const tasteCol = db.collection<UserTasteProfile>('user_taste_profiles');

    if ((await worksCol.countDocuments()) === 0) await worksCol.insertMany(worksStore);
    if ((await civicCol.countDocuments()) === 0) await civicCol.insertMany(civicNodesStore);
    if ((await eventsCol.countDocuments()) === 0) await eventsCol.insertMany(liveEventsStore);
    if ((await tasteCol.countDocuments()) === 0) await tasteCol.insertMany(tasteProfilesStore);

    mongoConnected = true;
    console.log('Connected to MongoDB Atlas cluster (sottovoce_prod).');
  } catch (_err) {
    console.warn('MongoDB Atlas URI not reachable; running built-in $rankFusion & 2dsphere engine.');
    mongoConnected = false;
  }
}

/**
 * Fetches live zero-key open London data from Open-Meteo, Environment Agency Flood API, iNaturalist,
 * TfL Unified API, and MeteoAlarm/Met Office severe weather warnings.
 */
async function refreshOpenLondonTelemetry(lat = 51.5129, lng = -0.1222): Promise<OpenLondonLiveTelemetry> {
  const updated: OpenLondonLiveTelemetry = structuredClone(cachedOpenLondonTelemetry);
  updated.fetched_at_iso = new Date().toISOString();

  // 1. Open-Meteo Weather API (zero-key)
  try {
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (weatherRes.ok) {
      const wJson: any = await weatherRes.json();
      if (wJson?.current) {
        const temp = Number(wJson.current.temperature_2m ?? 13.4);
        const precip = Number(wJson.current.precipitation ?? 0.0);
        const wind = Number(wJson.current.wind_speed_10m ?? 11.2);
        updated.weather = {
          source: 'Open-Meteo API (Live Zero-Key Fetch)',
          temperature_c: temp,
          precipitation_mm: precip,
          wind_speed_kmh: wind,
          condition_summary:
            precip > 0.2
              ? `Light Rain (${precip}mm) — Use Covered Piazza Arcade`
              : `Dry & Clear (${temp}°C) — Ideal for ROH Amphitheatre Terrace`,
        };
      }
    }
  } catch (_e) {
    // Keep last known reading
  }

  // 2. Open-Meteo / LAQN Air Quality API (zero-key)
  try {
    const aqRes = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=european_aqi,pm2_5,nitrogen_dioxide`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (aqRes.ok) {
      const aqJson: any = await aqRes.json();
      if (aqJson?.current) {
        const aqi = Number(aqJson.current.european_aqi ?? 21);
        const pm25 = Number(aqJson.current.pm2_5 ?? 8.2);
        const no2 = Number(aqJson.current.nitrogen_dioxide ?? 19.4);
        updated.air_quality = {
          source: 'Open-Meteo / Breathe London & LAQN (Live Zero-Key Fetch)',
          pm2_5: pm25,
          no2,
          european_aqi: aqi,
          band: aqi <= 25 ? 'Low Pollution (Band 1 · Clean Walk Route)' : 'Moderate Urban Air',
        };
      }
    }
  } catch (_e) {
    // Keep last known reading
  }

  // 3. UK Environment Agency Flood-Monitoring API (zero-key)
  try {
    const eaRes = await fetch(
      `https://environment.data.gov.uk/flood-monitoring/id/FLOODS?lat=${lat}&long=${lng}&dist=5`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (eaRes.ok) {
      const eaJson: any = await eaRes.json();
      const warningsCount = Array.isArray(eaJson?.items) ? eaJson.items.length : 0;
      updated.flood_monitoring.tidal_status =
        warningsCount === 0
          ? 'Normal Tidal Range · 0 Active Flood Warnings (EA Verified)'
          : `${warningsCount} Active Tidal Alert(s) on Thames Embankment`;
    }
  } catch (_e) {
    // Keep last known reading
  }

  // 4. iNaturalist Open Biodiversity API (zero-key)
  try {
    const inatRes = await fetch(
      `https://api.inaturalist.org/v1/observations?lat=${lat}&lng=${lng}&radius=2&per_page=3&order=desc&order_by=created_at`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (inatRes.ok) {
      const inatJson: any = await inatRes.json();
      if (Array.isArray(inatJson?.results) && inatJson.results.length > 0) {
        updated.wildlife.recent_observations = inatJson.results
          .slice(0, 3)
          .map((obs: any) => ({
            species:
              obs?.taxon?.preferred_common_name ||
              obs?.species_guess ||
              'Peregrine Falcon',
            scientific_name: obs?.taxon?.name || 'Falco peregrinus',
            place_guess: obs?.place_guess || 'Covent Garden / Westminster',
            observed_on: obs?.observed_on || '2026-10-24',
          }));
      }
    }
  } catch (_e) {
    // Keep last known reading
  }

  // 5. TfL Unified API (https://api.tfl.gov.uk/Line/piccadilly,northern,bakerloo/Status & /StopPoint/{id}/placeTypes)
  try {
    const tflKeyParam = process.env.TFL_APP_KEY ? `?app_key=${process.env.TFL_APP_KEY}` : '';
    const lineRes = await fetch(
      `https://api.tfl.gov.uk/Line/piccadilly,northern,bakerloo/Status${tflKeyParam}`,
      {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(2500),
      }
    );
    if (lineRes.ok) {
      const lineJson: any = await lineRes.json();
      if (Array.isArray(lineJson) && lineJson.length > 0 && updated.tfl_unified) {
        updated.tfl_unified.lines_status = lineJson.map((l: any) => ({
          line_id: l.id || 'piccadilly',
          line_name: l.name || 'Piccadilly',
          status_severity:
            l.lineStatuses?.[0]?.statusSeverityDescription || 'Good Service',
          reason:
            l.lineStatuses?.[0]?.reason ||
            'Verified live via TfL Unified API (api.tfl.gov.uk)',
        }));
      }
    }
  } catch (_e) {
    // Keep last known TfL status
  }

  // 6. MeteoAlarm (official Met Office CAP feed, zero-key) — severe weather warnings for the UK
  try {
    const maRes = await fetch(
      'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-united-kingdom',
      { signal: AbortSignal.timeout(2500) }
    );
    if (maRes.ok) {
      const xml = await maRes.text();
      const entries = xml.split('<entry>').slice(1);
      const warnings = entries
        .map((entry) => {
          const areaDesc = entry.match(/<cap:areaDesc>([^<]*)<\/cap:areaDesc>/)?.[1] || '';
          const event = entry.match(/<cap:event>([^<]*)<\/cap:event>/)?.[1] || '';
          const severity = entry.match(/<cap:severity>([^<]*)<\/cap:severity>/)?.[1] || '';
          const expires = entry.match(/<cap:expires>([^<]*)<\/cap:expires>/)?.[1];
          const title = entry.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] || event || 'Weather Warning';
          return { severity, event: event || title, headline: title, area: areaDesc, expires_iso: expires };
        })
        .filter(
          (w) =>
            /london|south east|home counties/i.test(w.area) &&
            !/^no\s/i.test(w.headline || '') &&
            w.severity &&
            !/no warnings/i.test(w.headline || '')
        )
        .slice(0, 5);
      updated.weather_warnings = {
        source: 'MeteoAlarm / Met Office CAP Feed (Live Zero-Key Fetch)',
        warnings,
      };
    }
  } catch (_e) {
    // Keep last known warnings
  }

  // 7. Rail disruptions — derived from TfL Unified API line statuses fetched above
  if (updated.tfl_unified) {
    const lines = updated.tfl_unified.lines_status || [];
    const disrupted = lines.filter((l) => l.status_severity !== 'Good Service');
    updated.rail_disruptions = {
      source: 'TfL Unified API (Line/Status, Live Zero-Key Fetch)',
      disrupted_count: disrupted.length,
      total_count: lines.length,
      lines: disrupted.map((l) => ({
        line_name: l.line_name,
        status_severity: l.status_severity,
        reason: l.reason,
      })),
    };
  }

  cachedOpenLondonTelemetry = updated;
  return updated;
}

async function startServer() {
  await initMongoAtlasIfConfigured();
  refreshOpenLondonTelemetry().catch(() => {});

  const app = express();

  // CORS for the Tauri native shells (macOS/iOS: tauri://localhost, Android: http(s)://tauri.localhost).
  // Add more origins, comma-separated, with CORS_ALLOWED_ORIGINS.
  const corsOrigins = new Set([
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ]);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'set-auth-token');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Accounts + synced user data (better-auth on MongoDB). Needs MONGODB_URI; without it the client sees
  // `enabled: false` and hides the sign-in UI. The auth handler must be mounted before express.json().
  let accountsEnabled = false;
  let googleEnabled = false;
  if (mongoConnected && mongoClient) {
    try {
      const db = mongoClient.db('sottovoce_prod');
      const userCols = await initUserData(db);
      const auth = createAuth(db, [...corsOrigins], (userId) => deleteUserData(userCols, userId));
      app.all('/api/auth/*', toNodeHandler(auth));
      app.use(express.json({ limit: '15mb' }));
      mountUserData(app, auth, userCols);
      accountsEnabled = true;
      googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    } catch (err) {
      console.error('[auth] accounts disabled:', err);
    }
  }
  if (!accountsEnabled) app.use(express.json({ limit: '15mb' }));
  app.get('/api/me/config', (_req, res) => res.json({ enabled: accountsEnabled, google: googleEnabled }));

  const server = http.createServer(app);

  // 1. GET /api/state — Initial Hydration
  // GET /api/youtube/search?q=… — the first videos YouTube finds for a query, read off its public results page (there is
  // no API key), for the in-app player. Cached for an hour per query.
  const youtubeCache = new Map<string, { at: number; results: unknown[] }>();
  app.get('/api/youtube/search', async (req, res) => {
    const music = req.query.music === '1';
    const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 160) + (music ? ' topic audio' : '');
    if (q.length === (music ? 12 : 0)) return res.status(400).json({ error: 'q is required' });
    const hit = youtubeCache.get(q.toLowerCase());
    if (hit && Date.now() - hit.at < 3600_000) return res.json({ results: hit.results });
    try {
      const page = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36',
          'accept-language': 'en-GB,en;q=0.9',
          cookie: 'CONSENT=YES+1; SOCS=CAI',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!page.ok) throw new Error(`HTTP ${page.status}`);
      const html = await page.text();
      const raw = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html)?.[1];
      if (!raw) throw new Error('no results data');
      const results: { id: string; title: string; channel: string; duration: string; views: string }[] = [];
      const walk = (o: any) => {
        if (!o || typeof o !== 'object' || results.length >= 14) return;
        if (o.videoRenderer?.videoId) {
          const v = o.videoRenderer;
          results.push({
            id: v.videoId,
            title: (v.title?.runs ?? []).map((r: any) => r.text).join('') || 'Untitled',
            channel: v.ownerText?.runs?.[0]?.text ?? '',
            duration: v.lengthText?.simpleText ?? '',
            views: v.shortViewCountText?.simpleText ?? '',
          });
          return;
        }
        for (const x of Array.isArray(o) ? o : Object.values(o)) walk(x);
      };
      walk(JSON.parse(raw));
      if (!results.length) throw new Error('no videos found');
      youtubeCache.set(q.toLowerCase(), { at: Date.now(), results });
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: `YouTube search failed: ${err instanceof Error ? err.message : err}` });
    }
  });

  // GET /api/spotify/search?q=… — tracks Spotify finds for a query, for the in-app Spotify dock. Needs a free app's
  // SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (client-credentials flow); without them it answers 501 and the dock links out.
  let spotifyToken: { value: string; until: number } | null = null;
  const spotifyCache = new Map<string, { at: number; results: unknown[] }>();
  app.get('/api/spotify/search', async (req, res) => {
    const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!q) return res.status(400).json({ error: 'q is required' });
    const id = process.env.SPOTIFY_CLIENT_ID?.trim();
    const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
    const hit = spotifyCache.get(q.toLowerCase());
    if (hit && Date.now() - hit.at < 3600_000) return res.json({ results: hit.results });
    try {
      if (!id || !secret) {
        // No API credentials: read the track links a web search finds on open.spotify.com.
        const page = await fetch('https://html.duckduckgo.com/html/', {
          method: 'POST',
          headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ q: `site:open.spotify.com/track ${q}` }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!page.ok) throw new Error(`HTTP ${page.status}`);
        const html = await page.text();
        const decode = (t: string) => t.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const seen = new Set<string>();
        const results: unknown[] = [];
        for (const m of html.matchAll(/result__a"[^>]*href="[^"]*open\.spotify\.com(?:%2F|\/)track(?:%2F|\/)([A-Za-z0-9]{22})[^"]*"[^>]*>([^<]*)</g)) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          const t = decode(m[2]).replace(/\s*-\s*Spotify$/, '');
          const by = /^(.*?)\s+-\s+(?:song|single)(?: and lyrics)? by\s+(.*?)(?:\s*\|.*)?$/i.exec(t);
          results.push({ id: m[1], title: (by?.[1] ?? t).replace(/\s*\.\.\.$/, ''), artist: (by?.[2] ?? '').replace(/\s*\.\.\.$/, ''), album: '', image: '', duration: '' });
        }
        if (!results.length) throw new Error('no tracks found');
        spotifyCache.set(q.toLowerCase(), { at: Date.now(), results });
        return res.json({ results });
      }
      if (!spotifyToken || spotifyToken.until < Date.now() + 30_000) {
        const t = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
          signal: AbortSignal.timeout(10_000),
        });
        if (!t.ok) throw new Error(`token HTTP ${t.status}`);
        const body: any = await t.json();
        spotifyToken = { value: body.access_token, until: Date.now() + body.expires_in * 1000 };
      }
      const r = await fetch(`https://api.spotify.com/v1/search?type=track&limit=12&q=${encodeURIComponent(q)}`, {
        headers: { authorization: `Bearer ${spotifyToken.value}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? " — Spotify requires the app owner to have an active Premium subscription" : ""}`);
      const data: any = await r.json();
      const results = (data.tracks?.items ?? []).map((t: any) => ({
        id: t.id as string,
        title: t.name as string,
        artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
        album: t.album?.name ?? '',
        image: t.album?.images?.at(-1)?.url ?? '',
        duration: `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
      }));
      if (!results.length) throw new Error('no tracks found');
      spotifyCache.set(q.toLowerCase(), { at: Date.now(), results });
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: `Spotify search failed: ${err instanceof Error ? err.message : err}` });
    }
  });

  // POST /api/media/suggest — better search queries for a piece of music whose title was probably scraped wrong or whose
  // search found nothing useful, from gemini-4-argon. Body: { query, title?, subtitle?, source?, found? (titles of the top results) }.
  const suggestCache = new Map<string, { at: number; suggestions: string[] }>();
  app.post('/api/media/suggest', async (req, res) => {
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const query = str(req.body?.query, 160);
    if (!query) return res.status(400).json({ error: 'query is required' });
    const title = str(req.body?.title, 160);
    const subtitle = str(req.body?.subtitle, 160);
    const source = ['youtube', 'youtube music', 'spotify'].includes(str(req.body?.source, 20)) ? str(req.body?.source, 20) : 'youtube';
    const found = (Array.isArray(req.body?.found) ? req.body.found : []).slice(0, 5).map((t: unknown) => str(t, 120)).filter(Boolean);
    const key = JSON.stringify([query, title, subtitle, source, found]).toLowerCase();
    const hit = suggestCache.get(key);
    if (hit && Date.now() - hit.at < 3600_000) return res.json({ suggestions: hit.suggestions });
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    try {
      const response = await askGemini({
        model: ARGON,
        contents: `A listener is trying to find a piece of classical, opera, ballet or musical-theatre music on ${source}.
Item as listed: "${title || query}"${subtitle ? ` (from "${subtitle}")` : ''}
Search that was run: "${query}"
${found.length ? `The top results it found were: ${found.map((t: string) => `"${t}"`).join('; ')}\n` : 'It found nothing useful.\n'}The listing text may be scraped wrongly (stray punctuation, a role or scene note instead of the piece's name, a missing composer or work). Suggest up to 4 better search queries, best first: each 2-8 words, naming the piece's real title, its composer, and where helpful the work it comes from or a well-known performer. Use the form people type into ${source}. Do not repeat the search that was run. Return JSON: { "suggestions": string[] }.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: Type.OBJECT, properties: { suggestions: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['suggestions'] },
        },
      });
      const parsed = JSON.parse(response.text || '{}') as { suggestions?: unknown };
      const seen = new Set([query.toLowerCase()]);
      const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
        .map((s) => str(s, 100))
        .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
        .slice(0, 4);
      suggestCache.set(key, { at: Date.now(), suggestions });
      res.json({ suggestions });
    } catch (err) {
      res.status(502).json({ error: `Suggestions unavailable: ${err instanceof Error ? err.message : err}` });
    }
  });

  // POST /api/works/interpret — "a play about a bullfighter and love being like a bird" → the operas, operettas and
  // musicals it most likely describes, from gemini-4-argon. Body: { query }. The browser matches the answers to its own
  // repertoire index, so each one is just a title and composer plus why it fits.
  const interpretCache = new Map<string, { at: number; works: { title: string; composer: string; why: string }[] }>();
  app.post('/api/works/interpret', async (req, res) => {
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const query = str(req.body?.query, 300);
    if (query.length < 3) return res.status(400).json({ error: 'query is required' });
    const key = query.toLowerCase();
    const hit = interpretCache.get(key);
    if (hit && Date.now() - hit.at < 3600_000) return res.json({ works: hit.works });
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    try {
      const response = await askGemini({
        model: ARGON,
        contents: `Someone is searching a catalogue of operas, operettas and stage musicals and typed this, which may be a misspelling, half-remembered title, a plot, a character, a famous song or a mood:
"${query}"
Name up to 10 works it plausibly means, including the famous ones and every work that fits, not just the single best. Only real, well-documented works. For each give the title as the work is listed in opera house and catalogue listings (the original-language title for operas, e.g. \"La damnation de Faust\"), the composer's full name, and "why": one short sentence (under 20 words) tying the work to what they typed. If nothing fits, return an empty list. Return JSON: { "works": [{ "title": string, "composer": string, "why": string }] }.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              works: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { title: { type: Type.STRING }, composer: { type: Type.STRING }, why: { type: Type.STRING } },
                  required: ['title', 'composer', 'why'],
                },
              },
            },
            required: ['works'],
          },
        },
      });
      const parsed = JSON.parse(response.text || '{}') as { works?: { title?: unknown; composer?: unknown; why?: unknown }[] };
      const works = (Array.isArray(parsed.works) ? parsed.works : [])
        .map((w) => ({ title: str(w?.title, 120), composer: str(w?.composer, 120), why: str(w?.why, 200) }))
        .filter((w) => w.title)
        .slice(0, 10);
      interpretCache.set(key, { at: Date.now(), works });
      res.json({ works });
    } catch (err) {
      res.status(502).json({ error: `Interpretation unavailable: ${err instanceof Error ? err.message : err}` });
    }
  });

  app.get('/api/state', (_req, res) => {
    const initialRecs = computeCrossGenreRecommendations(
      tasteProfilesStore[0],
      worksStore,
      liveEventsStore
    );
    res.json({
      works: worksStore,
      civicNodes: civicNodesStore,
      liveEvents: liveEventsStore,
      tasteProfiles: tasteProfilesStore,
      recommendations: initialRecs,
      hitlTasks: hitlTasksStore,
      openLondonTelemetry: cachedOpenLondonTelemetry,
      atlasSpecs: MONGODB_ATLAS_SPECS,
      mongoConnected,
      ai: { configured: geminiConfigured(), lastError: lastAiError },
    });
  });

  // 2. GET /api/open-london/live-feeds — Live Zero-Key Open Data + TfL Unified API Refresh
  app.get('/api/open-london/live-feeds', async (req, res) => {
    const lat = Number(req.query.lat || 51.5129);
    const lng = Number(req.query.lng || -0.1222);
    const telemetry = await refreshOpenLondonTelemetry(lat, lng);
    res.json(telemetry);
  });

  // 2b. GET /api/tfl/stoppoint-places — Direct proxy for TfL Unified API /StopPoint/{id}/placeTypes?placeTypes={placeTypes}
  app.get('/api/tfl/stoppoint-places', async (req, res) => {
    const stopId = String(req.query.id || '940GZZLUCOV').trim();
    const placeTypes = String(req.query.placeTypes || 'TaxiRank,CarPark,BikePoint').trim();
    try {
      const keySuffix = process.env.TFL_APP_KEY ? `&app_key=${process.env.TFL_APP_KEY}` : '';
      const tflUrl = `https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stopId)}/placeTypes?placeTypes=${encodeURIComponent(placeTypes)}${keySuffix}`;
      const resp = await fetch(tflUrl, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const places = await resp.json();
        if (Array.isArray(places) && places.length > 0) {
          return res.json({
            stop_point_id: stopId,
            place_types_requested: placeTypes,
            source: 'https://api.tfl.gov.uk/StopPoint/{id}/placeTypes (Live)',
            places,
          });
        }
      }
    } catch (_err) {
      // Fallback to curated TfL Presentation Entities Place[] schema
    }

    return res.json({
      stop_point_id: stopId,
      place_types_requested: placeTypes,
      source: 'https://api.tfl.gov.uk/StopPoint/{id}/placeTypes (TfL Presentation Entities Schema)',
      places: [
        {
          $type: 'Tfl.Api.Presentation.Entities.Place, Tfl.Api.Presentation.Entities',
          id: `TaxiRank_${stopId}_ROH`,
          url: `https://api.tfl.gov.uk/Place/TaxiRank_${stopId}_ROH`,
          commonName: 'Bow Street / Royal Opera House Taxi Rank',
          distance: 115.0,
          placeType: 'TaxiRank',
          additionalProperties: [
            {
              category: 'Address',
              key: 'Street',
              sourceSystemKey: 'TfL',
              value: 'Bow Street & Russell Street WC2E',
            },
            {
              category: 'Description',
              key: 'NumberOfSpaces',
              sourceSystemKey: 'TfL',
              value: '5',
            },
          ],
          lat: 51.5127,
          lon: -0.1221,
        },
        {
          $type: 'Tfl.Api.Presentation.Entities.Place, Tfl.Api.Presentation.Entities',
          id: 'BikePoints_102',
          url: 'https://api.tfl.gov.uk/Place/BikePoints_102',
          commonName: 'Drury Lane, Covent Garden',
          distance: 185.0,
          placeType: 'BikePoint',
          additionalProperties: [
            { category: 'Description', key: 'NbBikes', sourceSystemKey: 'BikePoints', value: '14' },
            { category: 'Description', key: 'NbEmptyDocks', sourceSystemKey: 'BikePoints', value: '9' },
            { category: 'Description', key: 'NbDocks', sourceSystemKey: 'BikePoints', value: '23' },
          ],
          lat: 51.5138,
          lon: -0.1204,
        },
      ],
    });
  });

  // 2c. GET /api/tfl/places?types=BikePoint,CarPark,TaxiRank — city-wide TfL Unified API /Place/Type/{type}
  // feeds for the Map layer tray (each type cached in memory, since the endpoint has no bbox filter).
  app.get('/api/tfl/places', async (req, res) => {
    const requested = String(req.query.types || 'BikePoint')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const keySuffix = process.env.TFL_APP_KEY ? `?app_key=${process.env.TFL_APP_KEY}` : '';
    const byType: Record<string, any[]> = {};
    await Promise.all(
      requested.map(async (placeType) => {
        const cached = tflPlacesCache.get(placeType);
        if (cached && Date.now() - cached.fetchedAtMs < TFL_PLACES_TTL_MS) {
          byType[placeType] = cached.places;
          return;
        }
        try {
          const resp = await fetch(`https://api.tfl.gov.uk/Place/Type/${encodeURIComponent(placeType)}${keySuffix}`, {
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) {
            const places = await resp.json();
            if (Array.isArray(places)) {
              tflPlacesCache.set(placeType, { fetchedAtMs: Date.now(), places });
              byType[placeType] = places;
              return;
            }
          }
        } catch (_err) {
          // fall through to stale cache (if any) below
        }
        byType[placeType] = cached?.places ?? [];
      })
    );
    res.json({
      source: 'https://api.tfl.gov.uk/Place/Type/{placeType} (Live, cached 5 min per type)',
      types_requested: requested,
      places_by_type: byType,
    });
  });

  // 3. GET /api/atlas/stream-telemetry — Live Atlas Stream Processing window simulator
  app.get('/api/atlas/stream-telemetry', (_req, res) => {
    streamTickCounter += 1;
    const activeEvents = liveEventsStore.map((ev) => ({
      event_id: ev.event_id,
      title: ev.title,
      venue_name: ev.venue_name,
      current_act: ev.current_act,
      current_scene: ev.current_scene,
      current_bar: ev.current_bar + (streamTickCounter % 4),
      active_companions: Math.round(ev.attendee_count * 0.34) + (streamTickCounter % 7),
    }));

    const toiletTelemetry = civicNodesStore
      .filter((n) => n.category === 'public_toilet')
      .map((n) => ({
        node_id: n.node_id,
        name: n.name,
        interval_queue_mins: Math.max(1, (n.interval_queue_mins || 2) + ((streamTickCounter % 3) - 1)),
        accessible_step_free: n.accessible_step_free,
      }));

    res.json({
      window_timestamp_iso: new Date().toISOString(),
      tumbling_window_sec: 5,
      events: activeEvents,
      toilets: toiletTelemetry,
      open_london: cachedOpenLondonTelemetry,
    });
  });

  // 4. POST /api/context/detect — Module 1: Zero-Click Context Detection via gemini-4-argon
  app.post('/api/context/detect', async (req, res) => {
    try {
      const {
        lat = 51.5129,
        lng = -0.1222,
        audioSnippetText = '',
        visualStageHint = '',
        imageBase64,
        imageMimeType = 'image/jpeg',
        preferredWorkId,
        targetBar,
      } = req.body || {};

      const baseline = resolveSceneFromContext(worksStore, civicNodesStore, {
        lat: Number(lat),
        lng: Number(lng),
        audioSnippetText,
        visualStageHint,
        preferredWorkId,
        targetBar: targetBar !== undefined ? Number(targetBar) : undefined,
      });

      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
        return res.json({
          ...baseline.contextOutput,
          model_used: 'offline fallback — GEMINI_API_KEY not set',
          ai_error: 'GEMINI_API_KEY not set',
        });
      }

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageBase64 && typeof imageBase64 === 'string') {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        parts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: cleanBase64,
          },
        });
      }

      const catalogSummary = worksStore.map((w) => ({
        work_id: w.work_id,
        title: w.title,
        composer: w.composer,
        venue_name: w.venue_name,
        act: w.current_act,
        scene: w.current_scene,
        lines: w.lines.map((l) => ({
          line_index: l.line_index,
          bar_number: l.bar_number,
          character: l.character,
          original_text: l.original_text,
          literal_english: l.literal_english,
        })),
      }));

      parts.push({
        text: `You are sottovoce, an in-theatre multimodal opera and musical theatre recognition engine in London.
Device GPS: [${lat}, ${lng}]
Timestamp: ${new Date().toISOString()}
Heard 5s Audio Snippet / Lyric / Motif: "${audioSnippetText || baseline.matchedWork.lines[baseline.matchedLineIndex].original_text}"
Visual Stage / Playbill Observation: "${visualStageHint || baseline.matchedWork.setting_description}"
Candidate MongoDB Atlas works_and_libretti catalog: ${JSON.stringify(catalogSummary)}

Pinpoint the exact production, Act, Scene, current_bar, and current_line_index. Generate a spoiler-safe "Where We Are Right Now" summary (synopsis_so_far from 5 minutes ago, happening_now on stage, character_motivations, and plain British English subtext_explanation for the active line).`,
      });

      const response = await askGemini({
          model: ARGON,
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                work_id: { type: Type.STRING },
                production_title: { type: Type.STRING },
                venue_name: { type: Type.STRING },
                act: { type: Type.INTEGER },
                scene: { type: Type.INTEGER },
                current_bar: { type: Type.INTEGER },
                current_line_index: { type: Type.INTEGER },
                confidence: { type: Type.NUMBER },
                acoustic_fingerprint_match: { type: Type.STRING },
                visual_stage_match: { type: Type.STRING },
                synopsis_so_far: { type: Type.STRING },
                happening_now: { type: Type.STRING },
                character_motivations: { type: Type.STRING },
                subtext_explanation: { type: Type.STRING },
              },
              required: [
                'work_id',
                'production_title',
                'venue_name',
                'act',
                'scene',
                'current_bar',
                'current_line_index',
                'synopsis_so_far',
                'happening_now',
                'character_motivations',
                'subtext_explanation',
              ],
            },
          },
        });

      const parsed = JSON.parse(response.text || '{}');
      const nearest_amenities = findNearestCivicAmenities(
        civicNodesStore,
        Number(lat),
        Number(lng),
        5
      );

      return res.json({
        ...baseline.contextOutput,
        ...parsed,
        nearest_amenities,
        model_used: ARGON,
      });
    } catch (_error: any) {
      const {
        lat = 51.5129,
        lng = -0.1222,
        audioSnippetText = '',
        visualStageHint = '',
        preferredWorkId,
        targetBar,
      } = req.body || {};
      const fallback = resolveSceneFromContext(worksStore, civicNodesStore, {
        lat: Number(lat),
        lng: Number(lng),
        audioSnippetText,
        visualStageHint,
        preferredWorkId,
        targetBar: targetBar !== undefined ? Number(targetBar) : undefined,
      });
      return res.json({
        ...fallback.contextOutput,
        model_used: `offline fallback — ${lastAiError || 'Gemini unavailable'}`,
        ai_error: lastAiError,
      });
    }
  });

  // 5. POST /api/libretto/explain — Tap any line for deep British-English translation, subtext & leitmotif analysis
  app.post('/api/libretto/explain', async (req, res) => {
    const { workId, lineIndex = 0, line: sent, title: sentTitle, composer: sentComposer } = req.body || {};
    const stored = worksStore.find((w) => w.work_id === workId);
    const work = {
      ...(stored || worksStore[0]),
      ...(!stored && sentTitle ? { title: String(sentTitle), composer: String(sentComposer ?? ''), current_act: '' } : {}),
    };
    // A full libretto sends the line itself (its positions are not the store's); the store's own works are looked up by index.
    const line =
      sent?.original_text
        ? {
            line_index: Number(lineIndex),
            bar_number: 0,
            character: String(sent.character ?? ''),
            voice_type: '',
            original_text: String(sent.original_text),
            language: String(sent.language ?? ''),
            literal_english: String(sent.literal_english ?? ''),
            dramatic_subtext: '',
            musical_leitmotif: '',
          }
        : work.lines[Number(lineIndex)] || work.lines[0];

    try {
      const response = await askGemini({
          model: ARGON,
          contents: `You are sottovoce, a witty and erudite Royal Opera House & West End dramaturg writing in crisp British English.
Explain this specific line from "${work.title}" (${work.composer}), Act ${work.current_act}, Bar ${line.bar_number}:
Character: ${line.character} (${line.voice_type})
Original (${line.language}): "${line.original_text}"
Literal translation: "${line.literal_english}"

Return JSON with:
1. literal_translation: A short note on any archaic or poetic words (empty if there are none).
2. dramatic_subtext: One sentence on what the character is truly hiding or plotting beneath the surface (spoiler-safe beyond this scene).
3. musical_cue: One sentence on how the orchestra${line.musical_leitmotif ? ` (${line.musical_leitmotif})` : ''} reveals their inner psychology.
Two sentences in total across dramatic_subtext and musical_cue, no more. Plain text only: no markdown, asterisks or lists. The listener can ask for more detail afterwards.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                literal_translation: { type: Type.STRING },
                dramatic_subtext: { type: Type.STRING },
                musical_cue: { type: Type.STRING },
              },
              required: ['literal_translation', 'dramatic_subtext', 'musical_cue'],
            },
          },
        });

      const data = JSON.parse(response.text || '{}');
      // The prompt asks for one sentence each; the model doesn't always listen, so hold it to that.
      const firstSentence = (v: unknown) => (String(v ?? '').replace(/\*+/g, '').trim().match(/^.*?[.!?…](?=\s|$)/s)?.[0] ?? String(v ?? '').replace(/\*+/g, '').trim());
      data.dramatic_subtext = firstSentence(data.dramatic_subtext);
      data.musical_cue = firstSentence(data.musical_cue);
      return res.json({
        line_index: line.line_index,
        bar_number: line.bar_number,
        character: line.character,
        original_text: line.original_text,
        ...data,
        model_used: ARGON,
      });
    } catch (_err) {
      return res.json({
        line_index: line.line_index,
        bar_number: line.bar_number,
        character: line.character,
        original_text: line.original_text,
        literal_translation: line.literal_english,
        dramatic_subtext: line.dramatic_subtext,
        musical_cue: line.musical_leitmotif,
        model_used: `offline fallback — ${lastAiError || 'Gemini unavailable'}`,
        ai_error: lastAiError,
      });
    }
  });

  // 5a. POST /api/libretto/locate — "the bit where the Toreador dies": given a description and the work's scenes (title,
  // note, speakers and a few translated lines each), say which scene it is. The client jumps to the returned id.
  app.post('/api/libretto/locate', async (req, res) => {
    const { query, title, composer, scenes } = req.body || {};
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    const q = String(query ?? '').trim().slice(0, 300);
    if (!q || !Array.isArray(scenes) || !scenes.length) return res.status(400).json({ error: 'query and scenes are required' });
    const list = scenes
      .slice(0, 400)
      .map((s: { id: string; title: string; note?: string; who?: string; lines?: string[] }) =>
        [`[${String(s.id)}] ${String(s.title)}`, s.note && `note: ${String(s.note).slice(0, 200)}`, s.who && `speakers: ${String(s.who).slice(0, 120)}`, ...(s.lines ?? []).slice(0, 5).map((l) => `- ${String(l).slice(0, 140)}`)]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
    try {
      const response = await askGemini({
        model: ARGON,
        contents: `A listener is following "${String(title ?? '')}"${composer ? ` by ${String(composer)}` : ''} and wants to jump to a moment.
They said: "${q}"
Below are the scenes, each as [id] heading, a note, who sings, and some translated lines. Use your knowledge of the plot as well as the text. Pick the single scene where the moment happens (the first one, if it spans several). Listeners often misremember: if they name the wrong character or detail, still return the closest scene and say so in \"why\" (for example, that it is Carmen who dies, not the Toreador). Return an empty id only if nothing in the work is remotely close.

${list}

Return JSON: { "id": the scene id exactly as written inside the brackets, "why": one short sentence on what happens there, correcting the listener if needed }`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, why: { type: Type.STRING } }, required: ['id', 'why'] },
        },
      });
      const data = JSON.parse(response.text || '{}');
      const known = scenes.some((s: { id: string }) => s.id === data.id);
      return res.json({ id: known ? data.id : '', why: String(data.why ?? ''), model_used: ARGON });
    } catch (_err) {
      return res.status(502).json({ error: lastAiError || 'Gemini unavailable' });
    }
  });

  // 5c. POST /api/libretto/translate — Immerse fills in whatever the offline translations miss, a passage at a time: sung
  // lines, characters' names (the parts named by what they are: "Diavolo" → "Devil"; proper names come back unchanged)
  // and scene notes. Body: { title, composer?, language, lines: [{ id, who?, text }], names?: string[], notes?: [{ id, text }] }.
  app.post('/api/libretto/translate', async (req, res) => {
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    const { title, composer, language } = req.body || {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const items = (v: unknown, n: number) =>
      (Array.isArray(v) ? v : [])
        .slice(0, n)
        .map((x: { id?: unknown; who?: unknown; text?: unknown }) => ({ id: str(x?.id, 40), who: str(x?.who, 80), text: str(x?.text, 600) }))
        .filter((x) => x.id && x.text);
    const lines = items(req.body?.lines, 60);
    const notes = items(req.body?.notes, 12);
    const names = (Array.isArray(req.body?.names) ? req.body.names : []).slice(0, 40).map((n: unknown) => str(n, 80)).filter(Boolean);
    if (!lines.length && !notes.length && !names.length) return res.status(400).json({ error: 'Nothing to translate' });
    try {
      const response = await askGemini({
        model: ARGON,
        contents: `Translate parts of the libretto of "${str(title, 160)}"${composer ? ` (${str(composer, 120)})` : ''}, written in ${str(language, 40) || 'its original language'}, into natural, faithful British English for a surtitle reader. Keep each line's meaning and register; do not add commentary.
${lines.length ? `\nSung lines (id | character | text):\n${lines.map((l) => `${l.id} | ${l.who} | ${l.text}`).join('\n')}\n` : ''}${notes.length ? `\nStage notes (id | text):\n${notes.map((n) => `${n.id} | ${n.text}`).join('\n')}\n` : ''}${names.length ? `\nCharacter names: ${names.join('; ')}\nFor each name: if it describes a part (a chorus, a god, a priest, "the others", an allegory), give the English ("Diavolo" -> "Devil", "Coro di ninfe" -> "Chorus of nymphs", "Giove" -> "Jupiter"); if it is a proper name, return it unchanged.\n` : ''}
Return JSON: { "lines": [{ "id", "en" }], "notes": [{ "id", "en" }], "names": [{ "name", "en" }] }, one entry for every item given.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lines: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, en: { type: Type.STRING } }, required: ['id', 'en'] } },
              notes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, en: { type: Type.STRING } }, required: ['id', 'en'] } },
              names: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, en: { type: Type.STRING } }, required: ['name', 'en'] } },
            },
            required: ['lines', 'notes', 'names'],
          },
        },
      });
      const data = JSON.parse(response.text || '{}') as { lines?: { id: string; en: string }[]; notes?: { id: string; en: string }[]; names?: { name: string; en: string }[] };
      const pairs = (list: { id: string; en: string }[] | undefined, known: Set<string>) =>
        Object.fromEntries((list ?? []).filter((x) => known.has(x.id) && typeof x.en === 'string').map((x) => [x.id, x.en.trim()]));
      return res.json({
        lines: pairs(data.lines, new Set(lines.map((l) => l.id))),
        notes: pairs(data.notes, new Set(notes.map((n) => n.id))),
        names: Object.fromEntries((data.names ?? []).filter((x) => names.includes(x.name)).map((x) => [x.name, String(x.en ?? '').trim()])),
        model_used: ARGON,
      });
    } catch (_err) {
      return res.status(502).json({ error: lastAiError || 'Gemini unavailable' });
    }
  });

  // 5d. POST /api/immerse/chat — the Argon sidebar in Immerse: answers anything about the work and where the listener is
  // in it, and can move the reader ("take me to the duel", "the bit where she dies"). Body: { messages: [{ role: 'user' |
  // 'argon', text }], work: { title, composer?, language?, lead?, synopsis? }, where?: { trail, lines: [{ who, text,
  // translation }] }, scenes?: sceneDigest(doc) }. Replies { reply, jump (a scene id or ''), jumpLabel }.
  app.post('/api/immerse/chat', async (req, res) => {
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    const { messages, work = {}, where = {}, scenes } = req.body || {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const history = (Array.isArray(messages) ? messages : [])
      .slice(-16)
      .map((m: { role?: unknown; text?: unknown }) => ({ role: m?.role === 'argon' ? 'model' : 'user', text: str(m?.text, 2000) }))
      .filter((m) => m.text);
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'Send a question' });
    const sceneList = (Array.isArray(scenes) ? scenes : [])
      .slice(0, 300)
      .map((s: { id: string; title: string; note?: string; who?: string; lines?: string[] }) =>
        [`[${str(s.id, 40)}] ${str(s.title, 160)}`, s.note && `note: ${str(s.note, 160)}`, s.who && `speakers: ${str(s.who, 120)}`, ...(s.lines ?? []).slice(0, 3).map((l) => `- ${str(l, 120)}`)]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n');
    const nearby = (Array.isArray(where.lines) ? where.lines : [])
      .slice(0, 12)
      .map((l: { who?: unknown; text?: unknown; translation?: unknown }) => `${str(l.who, 60) ? `${str(l.who, 60)}: ` : ''}${str(l.text, 300)}${str(l.translation, 300) ? ` (${str(l.translation, 300)})` : ''}`)
      .join('\n');
    const system = `You are Argon, the companion in sottovoce's Immerse reader: a warm, erudite opera and theatre dramaturg writing crisp British English. The listener is following "${str(work.title, 160) || 'a stage work'}"${work.composer ? ` by ${str(work.composer, 120)}` : ''}${work.language ? `, sung in ${str(work.language, 40)}` : ''}.
${work.lead ? `About the work: ${str(work.lead, 900)}\n` : ''}${work.synopsis ? `Synopsis: ${str(work.synopsis, 3000)}\n` : ''}${where.trail ? `They are at: ${str(where.trail, 200)}\n` : ''}${nearby ? `The text around them (current line marked first):\n${nearby}\n` : ''}
Answer whatever they ask: the plot, who someone is, what a line means, the music, the history, staging, what to listen for. Write plain text with no markdown or asterisks. When asked to explain a line, quote nothing back and go deeper than a quick gloss: the situation, what the words really mean, what the music is doing. Be concise (under 120 words unless they ask for more), concrete and spoiler-aware: do not reveal what happens later unless asked. Use their place in the text when it helps.
If they ask to go somewhere, or describe a moment to find ("the bit where the Toreador dies"), pick the scene from the list below and put its id in "jump" (the first scene, if the moment spans several); listeners misremember, so pick the closest and gently correct them in the reply. Otherwise leave "jump" empty.
${sceneList ? `Scenes ([id] heading, note, speakers, sample lines):\n${sceneList}` : 'There is no scene list for this work, so leave "jump" empty.'}
Return JSON: { "reply": your answer, "jump": a scene id exactly as written in the brackets or "", "jumpLabel": a few words naming that moment or "" }`;
    try {
      const response = await askGemini({
        model: ARGON,
        contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: { reply: { type: Type.STRING }, jump: { type: Type.STRING }, jumpLabel: { type: Type.STRING } },
            required: ['reply', 'jump', 'jumpLabel'],
          },
        },
      });
      const data = JSON.parse(response.text || '{}') as { reply?: string; jump?: string; jumpLabel?: string };
      const known = (Array.isArray(scenes) ? scenes : []).some((s: { id: string }) => s.id === data.jump);
      return res.json({ reply: String(data.reply ?? '').trim(), jump: known ? data.jump : '', jumpLabel: known ? String(data.jumpLabel ?? '') : '', model_used: ARGON });
    } catch (_err) {
      return res.status(502).json({ error: lastAiError || 'Gemini unavailable' });
    }
  });

  // 5c. POST /api/immerse/commentary — the Argon sidebar's live commentary: a short note every few lines on what has just
  // been sung. Body: { work, where: { trail, scene? }, lines: [{ who, text, translation }] (what just went by), before?:
  // [earlier notes] }. Replies { note }. Spoiler-safe: nothing beyond the lines given.
  app.post('/api/immerse/commentary', async (req, res) => {
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    const { work = {}, where = {}, lines, before } = req.body || {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const just = (Array.isArray(lines) ? lines : [])
      .slice(-10)
      .map((l: { who?: unknown; text?: unknown; translation?: unknown }) => `${str(l?.who, 60) ? `${str(l.who, 60)}: ` : ''}${str(l?.text, 300)}${str(l?.translation, 300) ? ` (${str(l.translation, 300)})` : ''}`)
      .filter(Boolean)
      .join('\n');
    if (!just) return res.status(400).json({ error: 'Send the lines just heard' });
    const earlier = (Array.isArray(before) ? before : []).slice(-3).map((b: unknown) => `- ${str(b, 400)}`).join('\n');
    const prompt = `You are Argon, the live commentator in sottovoce's Immerse reader: a warm, erudite opera and theatre dramaturg writing crisp British English, murmuring to someone mid-performance of "${str(work.title, 160) || 'a stage work'}"${work.composer ? ` by ${str(work.composer, 120)}` : ''}.
${work.synopsis ? `Synopsis (orientation only): ${str(work.synopsis, 2000)}\n` : ''}${where.trail ? `Now at: ${str(where.trail, 200)}\n` : ''}${where.scene ? `This scene: ${str(where.scene, 400)}\n` : ''}${earlier ? `Your previous notes (do not repeat their points):\n${earlier}\n` : ''}
The lines that have just gone by:
${just}

Write ONE short commentary note (two sentences, 45 words at most) on what is happening in these lines: the dramatic turn, what a character wants or hides, or what to notice in the music or staging. Plain text, no markdown, no quoting the lines back, and no spoilers beyond what has been sung so far. Return JSON: { "note": the note }.`;
    try {
      const response = await askGemini({
        model: ARGON,
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema: { type: Type.OBJECT, properties: { note: { type: Type.STRING } }, required: ['note'] } },
      });
      const data = JSON.parse(response.text || '{}') as { note?: string };
      const note = String(data.note ?? '').replace(/\*+/g, '').trim();
      if (!note) return res.status(502).json({ error: 'Empty note' });
      return res.json({ note, model_used: ARGON });
    } catch (_err) {
      return res.status(502).json({ error: lastAiError || 'Gemini unavailable' });
    }
  });

  // 5e. POST /api/immerse/character — the Info panel: a character profile, then what they are doing at the listener's place.
  // Body: { work: { title, composer?, language?, synopsis? }, character, where?: { trail, scene?, lines: [{ who, text,
  // translation }] }, cast?: [names in this scene] }. Replies a profile; spoiler-safe up to the place given.
  app.post('/api/immerse/character', async (req, res) => {
    if (!geminiConfigured()) return res.status(501).json({ error: 'Gemini is not configured' });
    const { work = {}, character, where = {}, cast } = req.body || {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const who = str(character, 120).trim();
    if (!who) return res.status(400).json({ error: 'Name a character' });
    const nearby = (Array.isArray(where.lines) ? where.lines : [])
      .slice(0, 12)
      .map((l: { who?: unknown; text?: unknown; translation?: unknown }) => `${str(l?.who, 60) ? `${str(l.who, 60)}: ` : ''}${str(l?.text, 300)}${str(l?.translation, 300) ? ` (${str(l.translation, 300)})` : ''}`)
      .join('\n');
    const others = (Array.isArray(cast) ? cast : []).slice(0, 12).map((c: unknown) => str(c, 80)).filter(Boolean).join(', ');
    const prompt = `You are Argon, in sottovoce's Immerse reader, writing a character profile in the manner of a good programme note or an IMDb cast page: crisp, factual, British English. The work is "${str(work.title, 160) || 'a stage work'}"${work.composer ? ` by ${str(work.composer, 120)}` : ''}${work.language ? `, sung in ${str(work.language, 40)}` : ''}.
${work.synopsis ? `Synopsis: ${str(work.synopsis, 2500)}\n` : ''}The character: "${who}". (If it names a group such as a chorus or a pair, profile the group.)
${where.trail ? `The listener is at: ${str(where.trail, 200)}\n` : ''}${where.scene ? `This scene: ${str(where.scene, 400)}\n` : ''}${others ? `Others on stage in this scene: ${others}\n` : ''}${nearby ? `The text around the listener now:\n${nearby}\n` : ''}
Fill in the profile. Plain text everywhere: no markdown or asterisks. NO SPOILERS: say nothing about what happens after the listener's place (so no fates, deaths or twists that have not yet been reached), except in "knownFor" which may name famous arias or numbers without saying what happens.
- name: the character's name as the opera spells it. nameEn: an English rendering only if the name is a translatable word ("Diavolo" → "The Devil"), else "".
- voice: the voice type as written or conventionally cast ("Mezzo-soprano"), "" if not applicable or unsure.
- role: a one-line description ("A fiery cigarette-factory worker in Seville").
- summary: 2 to 3 sentences on who they are and what drives them, up to the listener's place only.
- facts: 3 to 5 label/value pairs of core facts (e.g. Voice, Occupation, Allegiance, Age, First appears, Relationship to X). Short values. Omit what you are unsure of rather than guess.
- nowDoing: 2 to 3 sentences placing them in THIS moment and scene: what they are doing, wanting or hiding in the text around the listener, and why it matters. If they are not in this scene, say where they are in the story right now and what they are up to, or "Not on stage in this scene." with a line on what the listener has seen of them.
- relationships: up to 4 { name, relation } for the people closest to them so far (a few words each; name exactly as the opera spells it).
- knownFor: the famous music or moments tied to this character (one short sentence), or "".
- listenFor: one sentence on what to listen for in how they sing or are scored.`;
    const field = { type: Type.STRING };
    try {
      const response = await askGemini({
        model: ARGON,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: field,
              nameEn: field,
              voice: field,
              role: field,
              summary: field,
              facts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: field, value: field }, required: ['label', 'value'] } },
              nowDoing: field,
              relationships: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: field, relation: field }, required: ['name', 'relation'] } },
              knownFor: field,
              listenFor: field,
            },
            required: ['name', 'role', 'summary', 'facts', 'nowDoing'],
          },
        },
      });
      const d = JSON.parse(response.text || '{}');
      const plain = (v: unknown, max: number) => str(String(v ?? '').replace(/\*+/g, '').trim(), max);
      const pairs = (v: unknown, a: string, b: string) =>
        (Array.isArray(v) ? v : []).slice(0, 6).map((x: Record<string, unknown>) => ({ [a]: plain(x?.[a], 60), [b]: plain(x?.[b], 140) })).filter((x) => x[a] && x[b]);
      return res.json({
        name: plain(d.name, 120) || who,
        nameEn: plain(d.nameEn, 120),
        voice: plain(d.voice, 60),
        role: plain(d.role, 200),
        summary: plain(d.summary, 700),
        facts: pairs(d.facts, 'label', 'value'),
        nowDoing: plain(d.nowDoing, 700),
        relationships: pairs(d.relationships, 'name', 'relation'),
        knownFor: plain(d.knownFor, 300),
        listenFor: plain(d.listenFor, 300),
        model_used: ARGON,
      });
    } catch (_err) {
      return res.status(502).json({ error: lastAiError || 'Gemini unavailable' });
    }
  });

  // 5b. POST /api/live/listen — Immerse: hear a few seconds of the performance (audio, or text a speech recogniser already
  // produced), transcribe it, translate it and say what is going on. Works for any work in the repertoire, not just the
  // annotated libretti; `lines` (the libretto around the current position, when there is one) steadies the transcription.
  app.post('/api/live/listen', async (req, res) => {
    const { audio, mimeType = 'audio/webm', text, work = {}, lines, heardBefore, candidates } = req.body || {};
    const heardText = typeof text === 'string' ? text.trim().slice(0, 1200) : '';
    const hasAudio = typeof audio === 'string' && audio.length > 0;
    if (!hasAudio && !heardText) return res.status(400).json({ error: 'Send audio or text.' });
    if (hasAudio && audio.length > 6_000_000) return res.status(413).json({ error: 'Audio clip too long.' });

    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const title = str(work.title, 160);
    if (!geminiConfigured()) {
      return res.json({ ai: false, transcript: heardText, note: 'GEMINI_API_KEY not set: listening on-device only.' });
    }

    const hint = Array.isArray(lines)
      ? lines
          .slice(0, 8)
          .map((l: unknown) => str(l, 300))
          .filter(Boolean)
      : [];
    // The stored libretto around the listener's place, numbered, so the model can say which line it heard even when its
    // spelling of the transcript differs from the printed text.
    const cands = (Array.isArray(candidates) ? candidates : [])
      .slice(0, 80)
      .map((c: { i?: unknown; text?: unknown }) => ({ i: Number(c?.i), text: str(c?.text, 200) }))
      .filter((c) => Number.isInteger(c.i) && c.i >= 0 && c.text);
    // Fast path for keeping the place in real time: Argon at its lowest thinking level, a tiny prompt and a tiny answer.
    // Translation and explanation come from a second, text-only call once the place has moved.
    if (req.body?.fast === true && hasAudio) {
      try {
        const lang = work.language ? `, sung in ${str(work.language, 60)}` : '';
        const fastPrompt = `Transcribe the few seconds of "${title || 'a stage work'}"${lang} in the audio, verbatim, in the original language. Never invent words. Set instrumental true and transcript "" if there is no singing or speech.${
          cands.length ? `\nIf it is sung from these numbered lines, set line to the number of the LAST one heard, else -1:\n${cands.map((c) => `#${c.i} ${c.text}`).join('\n')}` : ''
        }\nconfidence: 0 to 1.`;
        const response = await askGemini({
          model: ARGON,
          contents: { parts: [{ inlineData: { mimeType: str(mimeType, 60).split(';')[0] || 'audio/webm', data: audio } }, { text: fastPrompt }] },
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: 200,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                transcript: { type: Type.STRING },
                instrumental: { type: Type.BOOLEAN },
                confidence: { type: Type.NUMBER },
                line: { type: Type.INTEGER },
              },
              required: ['transcript', 'instrumental', 'confidence', ...(cands.length ? ['line'] : [])],
            },
          },
        });
        const data = JSON.parse(response.text || '{}');
        if (!cands.some((c) => c.i === data.line)) delete data.line;
        return res.json({ ai: true, ...data, model_used: ARGON });
      } catch (_err) {
        return res.json({ ai: false, transcript: heardText, note: lastAiError || 'Gemini unavailable' });
      }
    }
    const prompt = `You are sottovoce, a discreet in-theatre dramaturg writing crisp British English. Someone is watching "${title || 'a stage work'}"${work.composer ? ` (${str(work.composer, 120)})` : ''}${work.venue ? ` at ${str(work.venue, 120)}` : ''}${work.language ? `, sung in ${str(work.language, 60)}` : ''}.
${work.lead ? `About the work: ${str(work.lead, 700)}\n` : ''}${work.synopsis ? `Synopsis (for orientation only): ${str(work.synopsis, 2500)}\n` : ''}${hint.length ? `The libretto around where they probably are:\n${hint.map((l: string, i: number) => `${i + 1}. ${l}`).join('\n')}\n` : ''}${heardBefore ? `Heard just before: "${str(heardBefore, 300)}"\n` : ''}
${hasAudio ? 'Listen to the attached few seconds of audio from the auditorium.' : `A speech recogniser heard this (it may be ragged): "${heardText}"`}
${cands.length ? `Numbered lines of the libretto near where they are:\n${cands.map((c) => `#${c.i} ${c.text}`).join('\n')}\nIf what you hear is sung from these lines, set line to the number of the LAST of them you hear (the latest sung); otherwise -1.\n` : ''}Return JSON. transcript: the words sung or spoken, in their original language (empty if the audio is purely instrumental or inaudible, and then set instrumental true). translation: a natural English translation of the transcript (empty if it is already English). explanation: one or two sentences, spoiler-safe beyond what is being sung, on what this moment means dramatically or musically. where_in_story: the act and scene this most likely is, from the synopsis if given (empty when unsure). confidence: 0 to 1 that the transcript is right and belongs to this work. Never invent words you did not hear.`;

    try {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (hasAudio) parts.push({ inlineData: { mimeType: str(mimeType, 60).split(';')[0] || 'audio/webm', data: audio } });
      parts.push({ text: prompt });
      const response = await askGemini({
        model: ARGON,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: { type: Type.STRING },
              language: { type: Type.STRING },
              instrumental: { type: Type.BOOLEAN },
              translation: { type: Type.STRING },
              explanation: { type: Type.STRING },
              where_in_story: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              line: { type: Type.INTEGER },
            },
            required: ['transcript', 'instrumental', 'translation', 'explanation', 'confidence', ...(cands.length ? ['line'] : [])],
          },
        },
      });
      const data = JSON.parse(response.text || '{}');
      if (!cands.some((c) => c.i === data.line)) delete data.line;
      return res.json({ ai: true, ...data, model_used: ARGON });
    } catch (_err) {
      return res.json({ ai: false, transcript: heardText, note: lastAiError || 'Gemini unavailable' });
    }
  });

  // 6. POST /api/sottovoce/whisper — In-Theatre Query: two replies from gemini-4-argon
  app.post('/api/sottovoce/whisper', async (req, res) => {
    const startedAt = Date.now();
    const { question, workId, lineIndex = 0 } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'Please enter or whisper a question.' });
    }

    const work = worksStore.find((w) => w.work_id === workId) || worksStore[0];
    const line = work.lines[Number(lineIndex)] || work.lines[0];

    const context = `You are sottovoce ("under the voice"), an unobtrusive in-theatre companion for an audience member currently watching "${work.title}" (${work.composer}) at ${work.venue_name}, Act ${work.current_act}, Scene ${work.current_scene}, Bar ${line.bar_number}.
Current line on stage: ${line.character}: "${line.original_text}" (${line.literal_english}).
Context so far: ${work.synopsis_5min_ago} ${work.happening_now}

The user asks quietly: "${question}"`;
    const ask = async (instruction: string) => {
      const resp = await askGemini({ model: ARGON, contents: `${context}\n${instruction}`, config: { maxOutputTokens: 400 } });
      const text = resp.text?.trim() || '';
      if (!text) throw new Error('Gemini returned an empty answer');
      return text;
    };

    // Two independent gemini-4-argon replies: the answer itself, then a smaller aside on the music or staging.
    const [main, aside] = await Promise.allSettled([
      ask('Reply in 2 concise, illuminating sentences in plain British English without spoiling future acts.'),
      ask('Write only a short aside (1-2 sentences, plain British English, plain text with no labels or markdown, no spoilers) about what the music or staging is doing at this moment. Do not answer the question or restate who anyone is.'),
    ]);
    const aiOk = main.status === 'fulfilled';
    const answerText = aiOk
      ? main.value
      : `At Bar ${line.bar_number} of ${work.title}, ${line.dramatic_subtext} ${work.character_motivations}`;
    const asideText = aside.status === 'fulfilled' ? aside.value : null;

    return res.json({
      question,
      answer: answerText,
      aside: asideText,
      work_title: work.title,
      bar_number: line.bar_number,
      latency_ms: Date.now() - startedAt,
      model_used: aiOk ? ARGON : `offline fallback — ${lastAiError || 'Gemini unavailable'}`,
      ai_error: aiOk ? null : lastAiError,
    });
  });

  // 7. POST /api/lyria/leitmotif — Fast Orchestral Leitmotif Stem Synthesis via gemini-4-argon
  app.post('/api/lyria/leitmotif', async (req, res) => {
    const startedAt = Date.now();
    const { workId, motifId, customPrompt } = req.body || {};
    const work = worksStore.find((w) => w.work_id === workId) || worksStore[0];
    const motif =
      work.leitmotifs.find((m) => m.id === motifId) || work.leitmotifs[0];
    const promptToUse = customPrompt || motif.lyria_prompt;

    try {
      const response = await askGemini({
          model: ARGON,
          contents: `You are sottovoce's orchestral leitmotif synthesizer for "${work.title}" (${work.composer}).
Target Motif: "${motif.name}" in ${motif.key_signature} (${motif.tempo_bpm} BPM).
Orchestration: ${motif.orchestration}.
Prompt: ${promptToUse}

Generate an 8-note harmonic sequence (frequencies in Hz between 196 and 660, and durations in seconds between 0.35 and 0.95) and a 1-sentence British English performance note explaining how the brass, strings, and woodwinds voice this motif.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                notes_hz: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
                rhythm_sec: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
                performance_note: { type: Type.STRING },
              },
              required: ['notes_hz', 'rhythm_sec', 'performance_note'],
            },
          },
        });

      const parsed = JSON.parse(response.text || '{}');
      return res.json({
        motif_id: motif.id,
        motif_name: motif.name,
        audio_base64: null,
        mime_type: 'audio/wav',
        notes_hz:
          Array.isArray(parsed.notes_hz) && parsed.notes_hz.length > 0
            ? parsed.notes_hz
            : motif.notes_hz,
        rhythm_sec:
          Array.isArray(parsed.rhythm_sec) && parsed.rhythm_sec.length > 0
            ? parsed.rhythm_sec
            : motif.rhythm_sec,
        lyria_notes: parsed.performance_note || motif.dramatic_meaning,
        latency_ms: Date.now() - startedAt,
        model_used: ARGON,
      });
    } catch (_err: any) {
      return res.json({
        motif_id: motif.id,
        motif_name: motif.name,
        audio_base64: null,
        mime_type: 'audio/wav',
        notes_hz: motif.notes_hz,
        rhythm_sec: motif.rhythm_sec,
        lyria_notes: motif.dramatic_meaning,
        latency_ms: Date.now() - startedAt,
        model_used: `offline fallback — ${lastAiError || 'Gemini unavailable'}`,
        ai_error: lastAiError,
      });
    }
  });

  // 8. POST /api/lastfm/recommend — scrape the listener's Last.fm library (artists, albums, tracks) and have Gemini
  // pick upcoming London events from the scraped timetable (opera, classical, gigs, musicals…) that suit that taste.
  app.post('/api/lastfm/recommend', async (req, res) => {
    const cleanUser = String(req.body?.username ?? '').trim() || process.env.LASTFM_DEFAULT_USER || 'martinhe543';

    let profile: UserTasteProfile;
    let library: { artists: any[]; albums: any[]; tracks: any[] };
    try {
      const scraped = await scrapeLastFmProfile(cleanUser);
      library = scraped;
      profile = {
        _id: `taste_${cleanUser.toLowerCase()}`,
        lastfm_username: scraped.username,
        display_name: `@${scraped.username}`,
        total_scrobbles: scraped.total_scrobbles,
        source: 'lastfm',
        top_artists: scraped.artists.map((a) => ({ name: a.name, playcount: a.playcount, mbid: '', tags: [] })),
        top_albums: scraped.albums.map((a) => ({ name: a.name, artist: a.artist ?? '', playcount: a.playcount, url: a.url })),
        top_tracks: scraped.tracks.map((t) => ({ name: t.name, artist: t.artist ?? '', playcount: t.playcount, url: t.url })),
        loved_tracks: [],
        sonic_dna: { harmonic_complexity: 0, orchestral_density: 0, dramatic_intensity: 0, tempo_volatility: 0 },
        dominant_mood_tags: [],
        voyage_taste_embedding_model: 'voyage-3',
      };
    } catch (err) {
      if (err instanceof LastFmScrapeError) {
        const status = err.code === 'invalid_username' ? 400 : err.code === 'not_found' || err.code === 'empty' ? 404 : 502;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: 'Unexpected error reading Last.fm.' });
    }

    const pool = buildCandidatePool(loadTimetableEvents(), library as any);
    const byId = new Map(pool.map((p) => [p.event.id, p]));
    const toPick = (p: ScoredEvent, why: string, matched: string[], basis: TastePick['basis']): TastePick => ({
      event_id: p.event.id,
      title: p.event.title,
      category: p.event.category,
      venue_name: p.event.venue_name,
      start: p.event.start,
      time_known: p.event.time_known,
      url: p.event.url,
      image: p.event.image,
      price: p.event.price,
      source: p.event.source,
      why,
      matched,
      basis,
      event: p.event,
      venue: venueById().get(p.event.venue_id),
    });

    let picks: TastePick[] = [];
    let tasteSummary = '';
    let aiOk = false;
    // ai:false is the page's fast first paint: literal matches now, Gemini's picks in a second request.
    const useAi = req.body?.ai !== false;
    const cachedAi = useAi ? tasteAiCache.get(cleanUser.toLowerCase()) : undefined;
    if (cachedAi && Date.now() - cachedAi.at < TASTE_AI_TTL_MS) {
      return res.json({ ...cachedAi.body, profile });
    }
    if (useAi && geminiConfigured() && pool.length) {
      try {
        const top = (xs: { name: string; artist?: string; playcount: number }[], n: number) =>
          xs.slice(0, n).map((x) => `${x.artist ? `${x.artist} — ` : ''}${x.name} (${x.playcount})`);
        const ask = (model: string) => askGemini({
          model,
          contents: `You recommend live events in London to a listener based on their all-time Last.fm library.
Top artists: ${top(library.artists, 25).join('; ')}
Top albums: ${top(library.albums, 15).join('; ')}
Top tracks: ${top(library.tracks, 15).join('; ')}

Upcoming events (JSON, from the sottovoce timetable of venue sites, Eventbrite and Luma):
${JSON.stringify(
  pool.map(({ event: e }) => ({ id: e.id, title: e.title, category: e.category, venue: e.venue_name, date: e.start.slice(0, 10), blurb: (e.blurb ?? '').slice(0, 140) }))
)}

First characterise the listener's taste (sound, mood, vocal style, era). Then choose exactly 8 events from the list above that this person would most enjoy — mix in operas, classical and musicals that share the DNA of their music (e.g. dramatic vocals, cinematic orchestration, art-pop theatricality) as well as live gigs that are close in sound or by the same/related artists. Use only the ids given. For each, write a "why" of 1-2 specific sentences in British English that names the listener's artists or tracks and explains the connection; never invent facts about the event beyond its title and blurb.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                taste_summary: { type: Type.STRING },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                picks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      why: { type: Type.STRING },
                      matched_artists: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['id', 'why'],
                  },
                },
              },
              required: ['taste_summary', 'picks'],
            },
          },
        });
        // Two Argon retries: a transient Gemini hiccup shouldn't drop the user to keyword matching.
        const response = await ask(ARGON).catch(() => ask(ARGON)).catch(() => ask(ARGON));
        const parsed = JSON.parse(response.text || '{}');
        const seen = new Set<string>();
        for (const p of parsed.picks ?? []) {
          const hit = byId.get(p.id);
          if (!hit || seen.has(p.id) || !p.why) continue;
          seen.add(p.id);
          picks.push(toPick(hit, String(p.why), (p.matched_artists ?? []).map(String).slice(0, 4), 'ai'));
        }
        tasteSummary = String(parsed.taste_summary ?? '');
        profile.dominant_mood_tags = (parsed.tags ?? []).map(String).slice(0, 8);
        aiOk = picks.length > 0;
      } catch (_e) {
        picks = [];
      }
    }

    if (!aiOk) {
      // No Gemini: literal artist/title matches first, then the soonest opera / classical / gig listings.
      const direct = pool.filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      picks = direct.map((p) => toPick(p, `Mentions ${p.matched.join(', ')} from your Last.fm library.`, p.matched, 'match'));
      const used = new Set(picks.map((p) => p.event_id));
      const artists = libraryArtists(library as any, 3).join(', ');
      for (const cat of ['opera', 'classical', 'live_music', 'musical']) {
        for (const p of pool.filter((x) => x.event.category === cat && !used.has(x.event.id)).slice(0, 2)) {
          if (picks.length >= 8) break;
          used.add(p.event.id);
          picks.push(toPick(p, `A ${cat.replace('_', ' ')} pick for a library built around ${artists}. Enable Gemini for personalised reasons.`, [], 'category'));
        }
      }
    }

    const body = {
      profile,
      picks,
      taste_summary: tasteSummary,
      model_used: aiOk ? ARGON : 'no Gemini — literal matches only',
      ai_error: aiOk ? null : lastAiError || (geminiConfigured() ? null : 'GEMINI_API_KEY not set'),
    };
    if (useAi && aiOk) tasteAiCache.set(cleanUser.toLowerCase(), { at: Date.now(), body });
    return res.json(body);
  });

  // 8b. POST /api/feed/recommend — the home Feed: gemini-4-argon picks upcoming events and venues from what the
  // listener saved (and, if they have linked one, their Last.fm library). `ai:false` is the instant heuristic version.
  app.post('/api/feed/recommend', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const saved: { id: string; title: string; category: string; venue_name: string }[] = (Array.isArray(req.body?.saved) ? req.body.saved : [])
      .slice(0, 40)
      .map((s: any) => ({ id: String(s?.id ?? ''), title: String(s?.title ?? '').slice(0, 120), category: String(s?.category ?? ''), venue_name: String(s?.venue_name ?? '').slice(0, 80) }))
      .filter((s: { id: string; title: string }) => s.id && s.title);
    const useAi = req.body?.ai !== false;

    const cacheKey = `feed|${username.toLowerCase()}|${saved.map((s) => s.id).sort().join(',')}`;
    const cached = useAi ? tasteAiCache.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < TASTE_AI_TTL_MS) return res.json(cached.body);

    let library: { artists: any[]; albums: any[]; tracks: any[] } = { artists: [], albums: [], tracks: [] };
    let lastfmUser: string | null = null;
    if (username) {
      try {
        library = await scrapeLastFmProfile(username);
        lastfmUser = username;
      } catch (_e) {
        /* the feed still works from saved events alone */
      }
    }

    const savedIds = new Set(saved.map((s) => s.id));
    const savedTitles = new Set(saved.map((s) => s.title.toLowerCase()));
    const savedCats = new Map<string, number>();
    saved.forEach((s) => savedCats.set(s.category, (savedCats.get(s.category) ?? 0) + 1));
    const savedVenueNames = new Set(saved.map((s) => s.venue_name));

    const all = loadTimetableEvents();
    const venues = venueById();
    const pool = buildCandidatePool(all, library as any, 120).filter((p) => !savedIds.has(p.event.id) && !savedTitles.has(p.event.title.toLowerCase()));
    const byId = new Map(pool.map((p) => [p.event.id, p]));

    // Venues worth recommending: the busiest upcoming ones, with a flavour of what each has on.
    const today = new Date().toISOString().slice(0, 10);
    const venueStats = new Map<string, { id: string; name: string; kind?: string; count: number; cats: Map<string, number>; titles: string[] }>();
    for (const e of all) {
      if (e.start.slice(0, 10) < today) continue;
      const v = venues.get(e.venue_id);
      if (!v) continue;
      const st = venueStats.get(v.id) ?? { id: v.id, name: v.name, kind: v.kind, count: 0, cats: new Map<string, number>(), titles: [] as string[] };
      st.count++;
      st.cats.set(e.category, (st.cats.get(e.category) ?? 0) + 1);
      if (st.titles.length < 3 && !st.titles.includes(e.title)) st.titles.push(e.title);
      venueStats.set(v.id, st);
    }
    const venueCandidates = [...venueStats.values()].filter((v) => v.count >= 2).sort((a, b) => b.count - a.count).slice(0, 30);
    const venueIds = new Set(venueCandidates.map((v) => v.id));

    type FeedEvent = { id: string; why: string; basis: 'ai' | 'match' | 'category' };
    type FeedVenue = { id: string; why: string };
    let eventPicks: FeedEvent[] = [];
    let venuePicks: FeedVenue[] = [];
    let summary = '';
    let tags: string[] = [];
    let model = '';
    let aiOk = false;

    if (useAi && geminiConfigured() && pool.length && (saved.length || library.artists.length)) {
      try {
        const top = (xs: { name: string; artist?: string }[], n: number) => xs.slice(0, n).map((x) => `${x.artist ? `${x.artist} — ` : ''}${x.name}`);
        const ask = (m: string) => askGemini({
          model: m,
          contents: `You curate the home feed of sottovoce, a London live-performance guide (opera, classical, gigs, musicals, drama, dance).
${saved.length ? `Events the listener has saved (their strongest signal): ${JSON.stringify(saved.map((s) => ({ title: s.title, category: s.category, venue: s.venue_name })))}` : ''}
${library.artists.length ? `Their Last.fm taste — artists: ${top(library.artists, 20).join('; ')}. Albums: ${top(library.albums, 10).join('; ')}.` : ''}

Upcoming events to choose from (JSON):
${JSON.stringify(pool.map(({ event: e }) => ({ id: e.id, title: e.title, category: e.category, venue: e.venue_name, date: e.start.slice(0, 10), blurb: (e.blurb ?? '').slice(0, 140) })))}

Venues to choose from (JSON):
${JSON.stringify(venueCandidates.map((v) => ({ id: v.id, name: v.name, kind: v.kind, upcoming: v.count, categories: Object.fromEntries(v.cats), examples: v.titles })))}

First, in 1-2 sentences of British English, describe what this listener seems to love. Then choose exactly 6 events and up to 4 venues they would enjoy next: favour things that share the spirit of what they saved, but include one or two pleasant surprises. Use only the ids given and never pick an event that is already saved. For each, write a "why" of one specific sentence in British English that names a saved event or artist where it applies; never invent facts about an event or venue beyond what is listed.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                events: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, why: { type: Type.STRING } }, required: ['id', 'why'] } },
                venues: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, why: { type: Type.STRING } }, required: ['id', 'why'] } },
              },
              required: ['summary', 'events', 'venues'],
            },
          },
        });
        // Two Argon retries, so a transient failure doesn't drop to heuristics.
        const response = await ask(ARGON).catch(() => ask(ARGON)).catch(() => ask(ARGON));
        const parsed = JSON.parse(response.text || '{}');
        const seen = new Set<string>();
        for (const p of parsed.events ?? []) {
          if (!byId.has(p.id) || seen.has(p.id) || !p.why) continue;
          seen.add(p.id);
          eventPicks.push({ id: p.id, why: String(p.why), basis: 'ai' });
        }
        const seenVenues = new Set<string>();
        for (const p of parsed.venues ?? []) {
          if (!venueIds.has(p.id) || seenVenues.has(p.id) || !p.why) continue;
          seenVenues.add(p.id);
          venuePicks.push({ id: p.id, why: String(p.why) });
        }
        summary = String(parsed.summary ?? '');
        tags = (parsed.tags ?? []).map(String).slice(0, 6);
        model = ARGON;
        aiOk = eventPicks.length > 0;
      } catch (_e) {
        eventPicks = [];
        venuePicks = [];
      }
    }

    if (!aiOk) {
      // Heuristic: literal Last.fm matches, then upcoming events in the categories the listener saved most.
      const used = new Set<string>();
      const add = (p: ScoredEvent, why: string, basis: FeedEvent['basis']) => {
        if (used.has(p.event.id) || eventPicks.length >= 6) return;
        used.add(p.event.id);
        eventPicks.push({ id: p.event.id, why, basis });
      };
      pool.filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
        .forEach((p) => add(p, `Mentions ${p.matched.join(', ')} from your Last.fm library.`, 'match'));
      const cats = [...savedCats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
      for (const cat of cats.length ? cats : ['opera', 'classical', 'live_music', 'musical']) {
        pool.filter((p) => p.event.category === cat).slice(0, 2)
          .forEach((p) => add(p, cats.length ? `More ${cat.replace('_', ' ')}, which you tend to save.` : `A ${cat.replace('_', ' ')} highlight coming up.`, 'category'));
      }
      for (const cat of ['opera', 'classical', 'live_music', 'musical', 'dance', 'drama']) {
        pool.filter((p) => p.event.category === cat).slice(0, 1).forEach((p) => add(p, `A ${cat.replace('_', ' ')} highlight coming up.`, 'category'));
      }
      const liked = venueCandidates.filter((v) => savedVenueNames.has(v.name));
      const similar = venueCandidates.filter((v) => !savedVenueNames.has(v.name) && cats.some((c) => v.cats.has(c)));
      [...liked, ...similar, ...venueCandidates]
        .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
        .slice(0, 4)
        .forEach((v) =>
          venuePicks.push({
            id: v.id,
            why: liked.includes(v) ? `You have saved events here, and ${v.count} more are coming up.` : `${v.count} upcoming performances${v.titles.length ? `, including ${v.titles[0]}` : ''}.`,
          })
        );
      model = 'no Gemini — based on your saved events';
    }

    const body = {
      events: eventPicks,
      venues: venuePicks,
      summary,
      tags,
      model_used: model,
      signals: { saved: saved.length, lastfm: lastfmUser },
      ai_error: aiOk ? null : lastAiError || (geminiConfigured() ? null : 'GEMINI_API_KEY not set'),
    };
    if (useAi && aiOk) tasteAiCache.set(cacheKey, { at: Date.now(), body });
    return res.json(body);
  });

  // GET /api/atlas/search?q=&scope=events|works&limit= — ranked ids from Atlas $search + $vectorSearch for the Timetable / Libretto boxes.
  app.get('/api/atlas/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const scope: AtlasTarget = req.query.scope === 'works' ? 'works' : 'events';
    if (!mongoConnected || !mongoClient || !process.env.VOYAGE_API_KEY || q.length < 2) return res.json({ source: 'none', hits: [] });
    try {
      const results = await atlasHybridSearch(mongoClient.db('sottovoce_prod'), {
        query: q,
        targets: [scope],
        upcomingOnly: scope === 'events',
        keepShowings: true,
        limit: Math.min(Number(req.query.limit) || 40, 100),
      });
      res.json({
        source: 'atlas',
        hits: results.map((r) => ({ id: r.id, score: r.rrf_score, lexical_rank: r.lexical_rank, vector_rank: r.vector_rank })),
      });
    } catch (err) {
      console.warn('[atlas] search failed:', (err as Error).message);
      res.json({ source: 'none', hits: [] });
    }
  });

  // What gemini-4-argon thinks an Events search means (cached an hour): the piece's composer, what a performer is known
  // for, a listing that would satisfy it. Feeds the "related" and "concept" lists of searchEvents.
  const understandCache = new Map<string, { at: number; value: Understanding | null }>();
  const CATEGORY_IDS = ['opera', 'classical', 'live_music', 'drama', 'musical', 'dance'];
  async function understandEventQuery(query: string): Promise<Understanding | null> {
    const key = query.toLowerCase();
    const hit = understandCache.get(key);
    if (hit && Date.now() - hit.at < 3600_000) return hit.value;
    if (!geminiConfigured()) return null;
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const response = await askGemini({
      model: ARGON,
      contents: `Someone is searching listings of London events (opera, classical concerts and recitals, gigs, plays, musicals, ballet and dance). Each listing has a title, venue, hall and a short description, often naming the pieces, cast or artists. They typed:
"${query}"
It may be a piece of music (even one the listing never names in its title: "ballade no 1" is Chopin), a composer, a performer, actor, conductor, band or comedian (even if no listing names them, the shows and genres they are known for), a character, a plot, a mood, a venue, a time of day, or a misspelling.
Return JSON:
- "intent": under 14 words, the topic as a noun phrase ("Chopin's first piano ballade", "bullfighter operas"), never starting "The user".
- "terms": up to 14 short strings likely to appear literally in the title or description of a listing that fits: the composer or artist behind a piece, the canonical title, other works, shows or tours the person is known for, character or role names, and the genre words a listing would use. Only things you are confident are real and related; no guessing.
- "description": one or two sentences written like the listing that would satisfy them.
- "categories": which of ${CATEGORY_IDS.join(', ')} fit (empty if unclear).`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING },
            terms: { type: Type.ARRAY, items: { type: Type.STRING } },
            description: { type: Type.STRING },
            categories: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['intent', 'terms', 'description', 'categories'],
        },
      },
    });
    const p = JSON.parse(response.text || '{}') as Record<string, unknown>;
    const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, n) : []);
    const value: Understanding = {
      intent: str(p.intent, 200),
      terms: list(p.terms, 14),
      description: str(p.description, 400),
      categories: list(p.categories, 6).filter((c) => CATEGORY_IDS.includes(c)),
    };
    understandCache.set(key, { at: Date.now(), value });
    if (understandCache.size > 300) understandCache.delete(understandCache.keys().next().value!);
    return value;
  }

  // GET /api/events/search?q=&deep=1 — the Events search box. Without `deep`: Atlas keyword ($search over every field) +
  // meaning ($vectorSearch). With `deep`: also what Argon says the query relates to. Ranked ids (all upcoming dates);
  // the browser applies the date, price and category filters on top.
  app.get('/api/events/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!mongoConnected || !mongoClient || !process.env.VOYAGE_API_KEY || q.length < 2) return res.json({ source: 'none', hits: [], understood: null });
    try {
      const out = await searchEvents(mongoClient.db('sottovoce_prod'), { query: q, understand: req.query.deep === '1' ? understandEventQuery : undefined });
      res.json({ source: 'atlas', ...out });
    } catch (err) {
      console.warn('[atlas] event search failed:', (err as Error).message);
      res.json({ source: 'none', hits: [], understood: null });
    }
  });

  // GET /api/atlas/similar?scope=events|works&id= — vector neighbours of a stored document.
  app.get('/api/atlas/similar', async (req, res) => {
    const scope: AtlasTarget = req.query.scope === 'works' ? 'works' : 'events';
    if (!mongoConnected || !mongoClient) return res.json({ source: 'none', results: [] });
    try {
      res.json({ source: 'atlas', results: await atlasSimilar(mongoClient.db('sottovoce_prod'), scope, String(req.query.id ?? '')) });
    } catch (err) {
      console.warn('[atlas] similar failed:', (err as Error).message);
      res.json({ source: 'none', results: [] });
    }
  });

  // GET /api/atlas/changes — Server-Sent Events fed by MongoDB change streams on events and live_events.
  app.get('/api/atlas/changes', async (req, res) => {
    if (!mongoConnected || !mongoClient) return res.status(503).json({ error: 'Atlas not connected' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const db = mongoClient.db('sottovoce_prod');
    const streams = ['events', 'live_events'].map((name) => {
      const cs = db.collection(name).watch([], { fullDocument: 'updateLookup' });
      cs.on('change', (c: any) => {
        const d = c.fullDocument ?? {};
        res.write(
          `data: ${JSON.stringify({
            at: new Date().toISOString(),
            collection: name,
            op: c.operationType,
            id: c.documentKey?._id,
            title: d.title,
            venue: d.venue_name,
          })}\n\n`
        );
      });
      cs.on('error', () => undefined);
      return cs;
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      streams.forEach((s) => s.close().catch(() => undefined));
    });
  });

  // POST /api/atlas/listing — add a listing to Atlas: embedded with Voyage on insert, so it is searchable at once, and the
  // change stream announces it. Expires after 15 minutes (TTL index on expires_at) so demos never pollute the timetable.
  app.post('/api/atlas/listing', async (req, res) => {
    if (!mongoConnected || !mongoClient || !process.env.VOYAGE_API_KEY) return res.status(503).json({ error: 'Atlas not connected' });
    const { title, venue_id, blurb = '', category = 'live_music' } = req.body || {};
    if (!String(title ?? '').trim()) return res.status(400).json({ error: 'title required' });
    try {
      const venue = venueById().get(String(venue_id ?? ''));
      const embedText = [title, category, venue?.name, blurb].filter(Boolean).join('. ').slice(0, 1500);
      const now = Date.now();
      const doc = {
        _id: `demo_${now}` as any,
        title: String(title).slice(0, 140),
        category: String(category),
        start: new Date(now + 2 * 3600 * 1000),
        time_known: true,
        venue_id: venue?.id,
        venue_name: venue?.name ?? 'Demo venue',
        blurb: String(blurb).slice(0, 500),
        source: 'live-demo',
        location: venue && Number.isFinite(venue.lat) ? { type: 'Point', coordinates: [venue.lng, venue.lat] } : undefined,
        embed_text: embedText,
        embedding: await embedDocument(embedText),
        expires_at: new Date(now + 15 * 60 * 1000),
      };
      const events = mongoClient.db('sottovoce_prod').collection('events');
      await events.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
      await events.insertOne(doc as any);
      res.json({ id: doc._id, title: doc.title, venue_name: doc.venue_name });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 9. POST /api/atlas/hybrid-search — Module 3: MongoDB Atlas $rankFusion Hybrid Search
  app.post('/api/atlas/hybrid-search', async (req, res) => {
    const {
      query = '',
      lat = 51.5129,
      lng = -0.1222,
      collectionFilter = 'all',
      category,
      upcomingOnly = true,
    } = req.body || {};

    // Real Atlas path: events + works live in MongoDB (scripts/atlas/ingest.mjs). civic_nodes and taste profiles stay in memory.
    const atlasTargets: AtlasTarget[] | null =
      collectionFilter === 'all'
        ? ['events', 'works']
        : collectionFilter === 'live_events'
          ? ['events']
          : collectionFilter === 'works_and_libretti'
            ? ['works']
            : null;
    if (mongoConnected && mongoClient && atlasTargets && process.env.VOYAGE_API_KEY && String(query).trim()) {
      try {
        const results = await atlasHybridSearch(mongoClient.db('sottovoce_prod'), {
          query: String(query),
          targets: atlasTargets,
          lat: Number(lat),
          lng: Number(lng),
          upcomingOnly: !!upcomingOnly,
          category: category ? String(category) : undefined,
        });
        return res.json({
          query,
          source: 'atlas',
          origin_coordinates: [Number(lng), Number(lat)],
          pipeline_stage:
            'Atlas $search (lexical) + $vectorSearch (voyage-4, 1024-d) + geo distance rank, fused with reciprocal rank fusion',
          results,
        });
      } catch (err) {
        console.warn('[atlas] hybrid search failed, using in-memory engine:', (err as Error).message);
      }
    }

    const results = runHybridSearchRankFusion(
      String(query),
      Number(lat),
      Number(lng),
      worksStore,
      civicNodesStore,
      liveEventsStore,
      collectionFilter,
      tasteProfilesStore
    );

    res.json({
      query,
      source: 'in-memory',
      origin_coordinates: [Number(lng), Number(lat)],
      pipeline_stage: '$rankFusion (vectorPipeline: voyage-multimodal-3 + lexicalAndGeoPipeline: 2dsphere) — in-memory fallback',
      results,
    });
  });

  // POST /api/timetable/event-summary — scrape a timetable listing's page and have Gemini summarise it into key sections.
  // Only URLs that appear in the generated timetable are fetched, so this can't be used as an open proxy.
  app.post('/api/timetable/event-summary', async (req, res) => {
    const { url, title, venue, start, price, blurb } = req.body || {};
    const target = String(url || '');
    if (!timetableUrls().has(target)) return res.status(400).json({ error: 'Unknown event URL' });

    const cached = eventSummaryCache.get(target);
    if (cached && Date.now() - cached.at < EVENT_SUMMARY_TTL_MS) return res.json(cached.value);

    let pageText = '';
    let metaDescription = '';
    try {
      const pageResp = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sottovoce-timetable/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!pageResp.ok) throw new Error(`HTTP ${pageResp.status}`);
      const html = (await pageResp.text()).slice(0, 1_500_000);
      metaDescription =
        html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]*)"/i)?.[1] ??
        html.match(/<meta[^>]+content="([^"]*)"[^>]+(?:property="og:description"|name="description")/i)?.[1] ??
        '';
      const ldJson = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((m) => m[1].trim())
        .join('\n')
        .slice(0, 3000);
      const bodyText = html
        .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');
      pageText = `${ldJson}\n${bodyText}`.slice(0, 9000);
    } catch (fetchErr) {
      console.error(`[timetable] could not fetch ${target}: ${describeAiError(fetchErr)}`);
    }

    const decode = (s: string) =>
      s
        .replace(/&lt;[\s\S]*?&gt;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&rsquo;/g, "'")
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s+/g, ' ');
    const fallbackSummary = decode(metaDescription || String(blurb || '')).trim();
    const base = { url: target, ai: false, summary: fallbackSummary, sections: [] as { title: string; items: string[] }[] };

    if (!geminiConfigured() || !pageText) {
      return res.json({ ...base, note: pageText ? 'Gemini is not configured.' : 'The event page could not be read.' });
    }

    try {
      const response = await askGemini({
        model: ARGON,
        contents: `You summarise London event listings for a timetable pop-up. Use ONLY the facts below; never invent details. Omit any section you have no facts for.
Listing: "${title}" at ${venue}${start ? `, starting ${start}` : ''}${price ? `, price ${price}` : ''}.
Page content scraped from ${target}:
"""${pageText}"""
Return JSON with:
- summary: 2-3 plain sentences describing what the event is.
- sections: array of { title, items } where title is one of "When & where", "Tickets & price", "Duration", "Performers & creatives", "Programme", "Good to know" (age guidance, accessibility, dress, interval, language/surtitles), and items is 1-5 short bullet strings.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { title: { type: Type.STRING }, items: { type: Type.ARRAY, items: { type: Type.STRING } } },
                  required: ['title', 'items'],
                },
              },
            },
            required: ['summary', 'sections'],
          },
        },
      });
      const ai_ = JSON.parse(response.text || '{}');
      const value = {
        url: target,
        ai: true,
        summary: String(ai_.summary || fallbackSummary),
        sections: (Array.isArray(ai_.sections) ? ai_.sections : [])
          .map((s: { title?: unknown; items?: unknown }) => ({
            title: String(s.title || ''),
            items: (Array.isArray(s.items) ? s.items : []).map(String).filter(Boolean).slice(0, 6),
          }))
          .filter((s: { title: string; items: string[] }) => s.title && s.items.length),
      };
      eventSummaryCache.set(target, { at: Date.now(), value });
      return res.json(value);
    } catch (_err) {
      return res.json({ ...base, note: `Gemini could not summarise this page: ${lastAiError || 'unavailable'}` });
    }
  });

  // POST /api/seatmaps/advise — pick seats from a whole 3D seating plan for a plain-language wish ("2 seats on an aisle,
  // see the dancers' feet, under the overhang is fine"). Every seat goes into the prompt with its sightline, so the model
  // reasons over the full house; it only suggests: the client highlights the seats and booking stays with the venue.
  const SEAT_ADVISOR_MODELS = [ARGON, ARGON];
  app.post('/api/seatmaps/advise', async (req, res) => {
    const { planId, wish, party, listingPrice } = req.body || {};
    const id = String(planId || '');
    const want = String(wish || '').trim().slice(0, 600);
    const size = Math.min(10, Math.max(1, Number(party) || 1));
    if (!/^[a-z0-9-]+$/.test(id) || !want) return res.status(400).json({ error: 'planId and wish are required' });
    let plan: SeatPlan;
    try {
      plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/seatmaps', `${id}.json`), 'utf8'));
    } catch (_e) {
      return res.status(404).json({ error: 'Unknown seating plan' });
    }
    if (!geminiConfigured()) return res.json({ ai: false, suggestions: [], note: 'Gemini is not configured.' });

    const layout = layoutPlan(plan);
    const aisle = new Set(layout.runs.flatMap((r) => [r.seats[0], r.seats[r.seats.length - 1]]));
    const pricing = pricePlan(plan, layout);
    const listing = parseListingPrice(typeof listingPrice === 'string' ? listingPrice.slice(0, 80) : null);
    const priceOf = (i: number) => {
      const p = pricing ? seatPrice(pricing, i) : null;
      return p == null || !pricing ? '' : String(listing ? priceAtListing(p, pricing.range, listing) : p);
    };
    const priceNote = !pricing
      ? 'Prices are unknown, so never claim them; you may say "usually cheaper/pricier".'
      : pricing.source === 'captured' && !listing
        ? `Prices (£) are the full-price bands from the venue's booking map for ${pricing.production ?? 'one performance'}; they vary by date, so call them "about".`
        : `Prices (£) are estimates${listing ? ` for this performance (listed ${listingPrice})` : ''} from seat position and the venue's usual range; call them "about", and respect any budget in the wish.`;
    const table = layout.seats
      .map((s, i) => {
        const v = seatSightline(s);
        const lv = plan.levels[s.level];
        return [seatKey(plan, s), lv.sections[s.section].name, v.distance.toFixed(1), v.offAxis.toFixed(0), v.height.toFixed(1), aisle.has(i) ? 'aisle' : '', priceOf(i)].join(',');
      })
      .join('\n');
    const prompt = `You are a seasoned London theatre-goer helping someone choose seats at ${plan.name} (${plan.hall}, ${plan.stage.type} stage, tiers: ${plan.levels.map((l) => l.name).join(', ')}).
They want ${size} seat${size > 1 ? 's' : ''} together (adjacent numbers in one row, same run unless across an aisle is acceptable). Their wish: """${want}"""
Use what you know about this auditorium (overhangs, restricted views, slips, sound, legroom) together with the geometry below. Availability is unknown, so never claim it. ${priceNote}
Every seat, one per line: key (tier|row|number), section, metres to stage front centre, degrees off the centre line, metres above the stage, aisle flag, price per seat in £.
${table}
Return JSON { suggestions: [{ seats: [keys exactly as given], title: short label, reason: 1-2 sentences }] } with 3 or 4 distinct options, best first.`;

    for (const model of SEAT_ADVISOR_MODELS) {
      try {
        const response = await askGemini({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suggestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { seats: { type: Type.ARRAY, items: { type: Type.STRING } }, title: { type: Type.STRING }, reason: { type: Type.STRING } },
                    required: ['seats', 'title', 'reason'],
                  },
                },
              },
              required: ['suggestions'],
            },
          },
        });
        const known = new Set(layout.seats.map((s) => seatKey(plan, s)));
        const parsed = JSON.parse(response.text || '{}');
        const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
          .map((sg: { seats?: unknown; title?: unknown; reason?: unknown }) => ({
            seats: (Array.isArray(sg.seats) ? sg.seats : []).map(String).filter((k: string) => known.has(k)).slice(0, size),
            title: String(sg.title || '').trim(),
            reason: String(sg.reason || '').trim(),
          }))
          .filter((sg: { seats: string[] }) => sg.seats.length)
          .slice(0, 4);
        return res.json({ ai: true, model, suggestions });
      } catch (_err) {
        // Retry once.
      }
    }
    return res.json({ ai: false, suggestions: [], note: `Gemini could not suggest seats: ${lastAiError || 'unavailable'}` });
  });

  // 10. POST /api/saint/ingest-url — Module 4: Saint AI Zero-Friction URL Event Ingestion with HITL Gate
  app.post('/api/saint/ingest-url', async (req, res) => {
    const { url } = req.body || {};
    const validation = validateSaintUrlIngestion(String(url || ''));
    if (!validation.valid || !validation.normalizedUrl) {
      return res.status(400).json({ error: validation.error });
    }

    const normalizedUrl = validation.normalizedUrl;
    const detectedPlatform = validation.detectedPlatform || 'Saint URL Drop';

    // Fetch the real page so the model extracts details instead of inventing them from a bare URL.
    let pageContext = '';
    try {
      const pageResp = await fetch(normalizedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sottovoce-saint/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      const html = await pageResp.text();
      const meta = [...html.matchAll(/<(?:title|meta)[^>]*?(?:property="og:[^"]*"|name="description")?[^>]*>[^<]*/gi)]
        .map((m) => m[0])
        .filter((t) => /<title|og:|description/i.test(t))
        .join('\n');
      const ldJson = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((m) => m[1].trim())
        .join('\n');
      const bodyText = html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      pageContext = `${meta}\n${ldJson}\n${bodyText}`.slice(0, 6000);
    } catch (fetchErr) {
      console.error(`[saint] could not fetch ${normalizedUrl}: ${describeAiError(fetchErr)}`);
    }

    let extracted: {
      url: string;
      title: string;
      work_id: string;
      venue_name: string;
      lat: number;
      lng: number;
      start_time_iso: string;
      libretto_status: string;
      source_platform: typeof detectedPlatform;
    };

    try {
      const response = await askGemini({
        model: ARGON,
        contents: `You are Saint AI, an autonomous London cultural event ingestion agent integrated with sottovoce, OpenStreetMap, and martinhe.co.uk/tube/.
An event organiser submitted this URL: ${normalizedUrl} (Platform: ${detectedPlatform}).
${pageContext ? `Page content fetched from the URL (use it as the source of truth):\n"""${pageContext}"""` : 'The page could not be fetched; infer plausible details from the URL alone.'}
Return JSON with:
- title: Production title and composer/ensemble
- work_id: id from this catalogue if the production matches one, else empty string: ${worksStore.map((w) => w.work_id).join(', ')}
- venue_name: Specific London venue name
- lat: Latitude of the venue in London
- lng: Longitude of the venue in London
- start_time_iso: ISO 8601 start timestamp
- libretto_status: Summary of libretto or setlist availability in MongoDB works_and_libretti & Voyage-3 auto-embedding.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              work_id: { type: Type.STRING },
              venue_name: { type: Type.STRING },
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER },
              start_time_iso: { type: Type.STRING },
              libretto_status: { type: Type.STRING },
            },
            required: ['title', 'work_id', 'venue_name', 'lat', 'lng', 'start_time_iso', 'libretto_status'],
          },
        },
      });
      const aiData = JSON.parse(response.text || '{}');
      if (!aiData.title || !aiData.venue_name) throw new Error('Gemini returned no event details');
      extracted = {
        ...aiData,
        work_id: worksStore.some((w) => w.work_id === aiData.work_id)
          ? aiData.work_id
          : worksStore[0].work_id,
        url: normalizedUrl,
        source_platform: detectedPlatform,
      };
    } catch (_err) {
      return res.status(502).json({
        error: `Saint AI could not extract event details: ${lastAiError || 'Gemini unavailable'}`,
      });
    }

    const hitlTask = buildSaintHitlIngestionTask(extracted, civicNodesStore);
    hitlTasksStore = [hitlTask, ...hitlTasksStore];

    return res.json({
      task: hitlTask,
      message: 'Saint AI extracted event metadata and staged a Human-in-the-Loop (HITL) approval diff.',
    });
  });

  // 11. POST /api/saint/approve-hitl — 1-Click Human-in-the-Loop Confirmation Gate
  app.post('/api/saint/approve-hitl', async (req, res) => {
    const { taskId, decision } = req.body || {};
    const taskIndex = hitlTasksStore.findIndex((t) => t.task_id === taskId);
    if (taskIndex < 0) {
      return res.status(404).json({ error: 'HITL task not found.' });
    }

    const task = hitlTasksStore[taskIndex];
    const nextStatus = decision === 'reject' ? 'rejected' : 'approved_live';
    const updatedTask: SaintHitlTask = {
      ...task,
      status: nextStatus,
    };
    hitlTasksStore[taskIndex] = updatedTask;

    let publishedEvent: LiveEvent | null = null;
    if (nextStatus === 'approved_live' && task.draft_event) {
      publishedEvent = {
        ...task.draft_event,
        status: 'live_on_map',
      };
      liveEventsStore = [publishedEvent, ...liveEventsStore];
      if (mongoConnected && mongoClient) {
        try {
          await mongoClient
            .db('sottovoce_prod')
            .collection<LiveEvent>('live_events')
            .insertOne(publishedEvent);
        } catch (_e) {
          // ignore write error on fallback
        }
      }
    }

    return res.json({
      task: updatedTask,
      publishedEvent,
      liveEvents: liveEventsStore,
    });
  });

  // 12. WebSocket Server at /ws/live for low-latency gemini-4-argon whispered stream
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs) => {
    clientWs.send(JSON.stringify({ status: 'connected', model: ARGON }));

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.text) {
          const resp = await askGemini({
            model: ARGON,
            contents: `You are sottovoce, a hushed in-theatre London opera & West End companion. Reply in 1-2 short British English sentences to: "${msg.text}"`,
          });
          clientWs.send(
            JSON.stringify({
              text: resp.text || 'Listening in sotto voce mode.',
              model: ARGON,
            })
          );
        }
      } catch (_e) {
        clientWs.send(
          JSON.stringify({
            text: `Sorry — the whisper channel could not reach Gemini: ${lastAiError || 'unknown error'}`,
            error: lastAiError,
            model: 'offline fallback',
          })
        );
      }
    });
  });

  // The embedded tube map (public/tube/) probes these same-origin helpers on localhost and
  // falls back to remote mirrors; a 404 (not the SPA's index.html) lets it do that cleanly.
  app.use(['/darwin', '/proxy'], (_req, res) => {
    res.status(404).end();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      // Share the HTTP server for HMR so Vite doesn't bind a separate port (24678).
      server: {
        middlewareMode: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or run with PORT=<free port> npm run dev.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`sottovoce full-stack server listening on http://0.0.0.0:${PORT}`);
    // Warm Argon's connection so the first real request isn't a cold start.
    if (geminiConfigured()) void askGemini({ model: ARGON, contents: 'Reply with: ok', config: { maxOutputTokens: 8 } }).catch(() => {});
  });
}

startServer();
