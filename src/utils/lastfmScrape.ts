import * as cheerio from 'cheerio';

/**
 * Scrapes a public Last.fm profile's all-time library (artists, albums, tracks).
 * Pure parsing lives in `parseLibraryPage` so it can be tested against saved HTML.
 */

export type LibraryKind = 'artists' | 'albums' | 'tracks';

export interface LibraryEntry {
  name: string;
  artist?: string;
  playcount: number;
  url: string;
}

export interface ScrapedLastFm {
  username: string;
  total_scrobbles: number;
  artists: LibraryEntry[];
  albums: LibraryEntry[];
  tracks: LibraryEntry[];
}

export class LastFmScrapeError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_username' | 'not_found' | 'blocked' | 'unavailable' | 'empty'
  ) {
    super(message);
  }
}

export const LASTFM_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,14}$/;

const toInt = (s: string) => Number.parseInt(s.replace(/[^\d]/g, ''), 10) || 0;

/** True when Last.fm served an anti-bot interstitial instead of the profile. */
export const isChallengePage = (html: string) =>
  /<title>\s*(Client Challenge|Just a moment|Attention Required)/i.test(html);

export function parseLibraryPage(html: string, kind: LibraryKind): LibraryEntry[] {
  const $ = cheerio.load(html);
  const rows: LibraryEntry[] = [];
  $('tr.chartlist-row').each((_, el) => {
    const row = $(el);
    const link = row.find('.chartlist-name a').first();
    const name = link.text().trim();
    if (!name) return;
    const href = link.attr('href') ?? '';
    rows.push({
      name,
      artist: kind === 'artists' ? undefined : row.find('.chartlist-artist a').first().text().trim() || undefined,
      playcount: toInt(row.find('.chartlist-count-bar-value').first().text()),
      url: href.startsWith('/') ? `https://www.last.fm${href}` : href,
    });
  });
  return rows;
}

export function parseTotalScrobbles(html: string): number {
  const $ = cheerio.load(html);
  let total = 0;
  $('.header-metadata-tnew-item, .header-metadata-item, .header-new-secondary-item').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!total && /scrobbles/i.test(text)) total = toInt(text);
  });
  return total;
}

async function fetchHtml(url: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { 'user-agent': 'sottovoce/1.0 (+taste-profile)', accept: 'text/html', 'accept-language': 'en' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new LastFmScrapeError('Could not reach last.fm.', 'unavailable');
  }
  if (resp.status === 404) throw new LastFmScrapeError('No Last.fm user with that name.', 'not_found');
  const html = await resp.text();
  if (resp.status === 403 || resp.status === 429 || isChallengePage(html)) {
    throw new LastFmScrapeError(
      'Last.fm blocks automated page reads. Set LASTFM_API_KEY (free at last.fm/api/account/create) in .env to read profiles through the official API.',
      'blocked'
    );
  }
  if (!resp.ok) throw new LastFmScrapeError(`Last.fm responded with ${resp.status}.`, 'unavailable');
  return html;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: ScrapedLastFm }>();

interface ApiRow {
  name: string;
  playcount: string;
  url: string;
  artist?: { name: string };
}

/** Official Last.fm API (https://www.last.fm/api) — the reliable route; needs a free LASTFM_API_KEY. */
async function fetchViaApi(username: string, apiKey: string, limit: number): Promise<ScrapedLastFm> {
  const call = async (method: string) => {
    let resp: Response;
    try {
      const qs = new URLSearchParams({ method, user: username, api_key: apiKey, format: 'json', period: 'overall', limit: String(limit) });
      resp = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`, { signal: AbortSignal.timeout(15000) });
    } catch {
      throw new LastFmScrapeError('Could not reach last.fm.', 'unavailable');
    }
    const json = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (json.error === 6) throw new LastFmScrapeError('No Last.fm user with that name.', 'not_found');
    if (json.error === 10) throw new LastFmScrapeError('LASTFM_API_KEY was rejected by Last.fm.', 'unavailable');
    if (json.error === 17) throw new LastFmScrapeError('That Last.fm profile is private.', 'not_found');
    if (!resp.ok || json.error) throw new LastFmScrapeError(json.message || `Last.fm responded with ${resp.status}.`, 'unavailable');
    return json;
  };
  const rows = (r: ApiRow[] | undefined): LibraryEntry[] =>
    (r ?? []).map((x) => ({ name: x.name, artist: x.artist?.name, playcount: toInt(x.playcount), url: x.url }));
  const [info, artists, albums, tracks] = await Promise.all([
    call('user.getinfo'),
    call('user.gettopartists'),
    call('user.gettopalbums'),
    call('user.gettoptracks'),
  ]);
  const a = rows(artists.topartists?.artist).map((x) => ({ ...x, artist: undefined }));
  const al = rows(albums.topalbums?.album);
  const t = rows(tracks.toptracks?.track);
  if (!a.length && !al.length && !t.length) throw new LastFmScrapeError('No public scrobbles found for that profile.', 'empty');
  return {
    username: info.user?.name || username,
    total_scrobbles: toInt(String(info.user?.playcount ?? '0')) || a.reduce((n, x) => n + x.playcount, 0),
    artists: a,
    albums: al,
    tracks: t,
  };
}

export async function scrapeLastFmProfile(username: string, limit = 50): Promise<ScrapedLastFm> {
  if (!LASTFM_USERNAME_RE.test(username)) {
    throw new LastFmScrapeError('That does not look like a Last.fm username.', 'invalid_username');
  }
  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const apiKey = process.env.LASTFM_API_KEY;
  if (apiKey) {
    try {
      const data = await fetchViaApi(username, apiKey, limit);
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch (err) {
      // Unknown/private users are definitive; anything else (rejected key, outage) falls through to reading the public pages,
      // and then to the last good copy, so a bad moment at Last.fm doesn't take the whole feature down.
      if (err instanceof LastFmScrapeError && (err.code === 'not_found' || err.code === 'empty')) throw err;
      try {
        return await scrapePages(username, limit, key);
      } catch (scrapeErr) {
        if (hit) return hit.data;
        throw err instanceof LastFmScrapeError && err.code !== 'unavailable' ? err : scrapeErr;
      }
    }
  }
  try {
    return await scrapePages(username, limit, key);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

async function scrapePages(username: string, limit: number, key: string): Promise<ScrapedLastFm> {

  const base = `https://www.last.fm/user/${encodeURIComponent(username)}`;
  const [profileHtml, artistsHtml, albumsHtml, tracksHtml] = await Promise.all([
    fetchHtml(base),
    fetchHtml(`${base}/library/artists?date_preset=ALL`),
    fetchHtml(`${base}/library/albums?date_preset=ALL`),
    fetchHtml(`${base}/library/tracks?date_preset=ALL`),
  ]);

  const artists = parseLibraryPage(artistsHtml, 'artists').slice(0, limit);
  const albums = parseLibraryPage(albumsHtml, 'albums').slice(0, limit);
  const tracks = parseLibraryPage(tracksHtml, 'tracks').slice(0, limit);
  if (!artists.length && !albums.length && !tracks.length) {
    throw new LastFmScrapeError('No public scrobbles found for that profile.', 'empty');
  }

  const data: ScrapedLastFm = {
    username,
    total_scrobbles: parseTotalScrobbles(profileHtml) || artists.reduce((n, a) => n + a.playcount, 0),
    artists,
    albums,
    tracks,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
