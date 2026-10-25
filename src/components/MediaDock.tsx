import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArgonButton } from './ArgonButton';
import { Captions, Music2, ChevronDown, ChevronUp, ExternalLink, Pause, Play, Search, SkipBack, SkipForward, Volume2, VolumeX, X, Youtube } from 'lucide-react';

/**
 * A YouTube player that lives above the whole app, so what you start keeps playing while you move between the
 * Libretto, Discover and Immerse. `play({ query })` searches YouTube (via /api/youtube/search) and plays the first
 * result in an embedded player; the other results are listed to pick from, and the next one starts when a video ends.
 * It can be shrunk to a small bar that keeps playing, and closed to stop.
 */

export interface MediaRequest {
  /** What to search YouTube for. */
  query: string;
  /** Shown in the dock's header: the thing being listened to. */
  title: string;
  subtitle?: string;
  /** Search for the audio (YouTube Music style) rather than any video. */
  music?: boolean;
}

interface Result {
  id: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
}

interface Dock {
  play: (request: MediaRequest) => void;
  playSpotify: (request: MediaRequest) => void;
}

const DockContext = createContext<Dock>({ play: () => {}, playSpotify: () => {} });
export const useMediaDock = () => useContext(DockContext);

// ---------- the YouTube IFrame API, loaded once ----------

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number; PAUSED: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}
interface YTPlayer {
  loadVideoById: (id: string) => void;
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  mute: () => void;
  unMute: () => void;
  setPlaybackRate: (rate: number) => void;
  /** Undocumented but long-stable: the captions module draws and styles subtitles. */
  loadModule: (name: string) => void;
  unloadModule: (name: string) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null;
const loadYouTubeApi = () =>
  (apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('The YouTube player could not be loaded'));
    };
    document.head.appendChild(script);
  }));

const searchUrl = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const SPOTIFY_GREEN = '#1DB954';

/** Spotify's mark (simple-icons path), since lucide has none. */
export const SpotifyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14 4.38-1.32 9.78-.66 13.5 1.62.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z" />
  </svg>
);

const spotifySearchUrl = (q: string) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;

/** The YouTube + Spotify pair that sits beside a piece of music. */
export const ListenButtons: React.FC<{ query: string; title: string; subtitle?: string }> = ({ query, title, subtitle }) => {
  const dock = useMediaDock();
  const cls = 'cursor-pointer rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100';
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => dock.play({ query, title, subtitle })}
        aria-label={`Play ${title} from YouTube`}
        title="Find performances on YouTube and play them here"
        className={cls}
        style={{ color: '#FF0033' }}
      >
        <Youtube className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => dock.play({ query, title, subtitle, music: true })}
        aria-label={`Play ${title} from YouTube Music`}
        title="Find the audio on YouTube Music and play it here"
        className={cls}
        style={{ color: '#FF0033' }}
      >
        <Music2 className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => dock.playSpotify({ query, title, subtitle })}
        aria-label={`Search Spotify for ${title}`}
        title="Find it on Spotify and play it here"
        className={cls}
        style={{ color: SPOTIFY_GREEN }}
      >
        <SpotifyIcon className="h-4 w-4" />
      </button>
    </span>
  );
};

export const MediaDockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [request, setRequest] = useState<MediaRequest | null>(null);
  const [spotify, setSpotify] = useState<MediaRequest | null>(null);
  // Both docks sit in the bottom-right corner, so only one is open at a time.
  const play = useCallback((r: MediaRequest) => {
    setSpotify(null);
    setRequest({ ...r });
  }, []);
  const playSpotify = useCallback((r: MediaRequest) => {
    setRequest(null);
    setSpotify({ ...r });
  }, []);
  const dock = useMemo(() => ({ play, playSpotify }), [play, playSpotify]);
  return (
    <DockContext.Provider value={dock}>
      {children}
      {request && <DockPlayer key={`${request.music ? 'm:' : ''}${request.query}`} request={request} onSearch={(query) => setRequest({ ...request, query })} onClose={() => setRequest(null)} />}
      {spotify && <SpotifyDock key={spotify.query} request={spotify} onSearch={(query) => setSpotify({ ...spotify, query })} onClose={() => setSpotify(null)} />}
    </DockContext.Provider>
  );
};

/** The search box shared by the three players, with gemini-4-argon's better guesses when the title looks mis-scraped. */
const SearchBar: React.FC<{
  source: 'youtube' | 'youtube music' | 'spotify';
  request: MediaRequest;
  /** Titles of what the search found so far (null while searching). */
  found: string[] | null;
  failed: boolean;
  href: string;
  hrefLabel: string;
  onSearch: (query: string) => void;
}> = ({ source, request, found, failed, href, hrefLabel, onSearch }) => {
  const [draft, setDraft] = useState(request.query);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const settled = found !== null || failed;
  const empty = failed || (found !== null && found.length === 0);

  const suggest = useCallback(() => {
    setAsking(true);
    setAskError(null);
    fetch('/api/media/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: request.query, title: request.title, subtitle: request.subtitle, source, found: found ?? [] }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        setSuggestions(body.suggestions as string[]);
      })
      .catch((e) => setAskError(String(e.message ?? e)))
      .finally(() => setAsking(false));
  }, [request.query, request.title, request.subtitle, source, found]);

  // A search that finds nothing is the clearest sign the title was read wrongly, so offer better queries unasked.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (settled && empty && !autoAsked.current) {
      autoAsked.current = true;
      suggest();
    }
  }, [settled, empty, suggest]);

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-hairline)' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && draft.trim() !== request.query) onSearch(draft.trim());
        }}
        className="flex items-center gap-1.5 px-3 py-1.5"
      >
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Search ${hrefLabel}…`}
          aria-label={`Search ${hrefLabel}`}
          className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1"
          style={{ color: 'var(--text-primary)', borderColor: 'var(--border-hairline)' }}
        />
        <ArgonButton label="Better searches" busyLabel="Thinking…" busy={asking} onClick={suggest} />
        <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] font-mono underline underline-offset-2" style={{ color: 'var(--text-secondary)' }}>
          {hrefLabel} <ExternalLink className="inline h-2.5 w-2.5" aria-hidden />
        </a>
      </form>
      {(asking || askError || suggestions) && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} aria-live="polite">
          {asking && <span>Thinking of better searches…</span>}
          {askError && !asking && <span>Suggestions unavailable.</span>}
          {!asking && suggestions && !suggestions.length && <span>No better search found.</span>}
          {!asking &&
            suggestions?.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSearch(q)}
                className="max-w-full cursor-pointer truncate rounded-full border px-2 py-0.5 text-[11px] hover:bg-[var(--bg-subtle)]"
                style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
              >
                {q}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: string;
}

/** Same corner, frame and header as the YouTube dock, with Spotify's embedded player and a list of tracks to pick from. */
const SpotifyDock: React.FC<{ request: MediaRequest; onSearch: (query: string) => void; onClose: () => void }> = ({ request, onSearch, onClose }) => {
  const [results, setResults] = useState<SpotifyTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [index, setIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/spotify/search?q=${encodeURIComponent(request.query)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        setResults(body.results as SpotifyTrack[]);
      })
      .catch((e) => e?.name !== 'AbortError' && setError(String(e.message ?? e)));
    return () => ctrl.abort();
  }, [request.query]);

  const track = results?.[index];
  const btn = 'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[var(--bg-subtle)] disabled:cursor-default disabled:opacity-30';

  return (
    <aside
      aria-label="Spotify player"
      className={`fixed z-[900] right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4 md:right-4 flex flex-col overflow-hidden rounded-2xl border shadow-2xl animate-folio-enter ${
        minimized ? 'w-[min(20rem,calc(100vw-1rem))]' : 'w-[min(26rem,calc(100vw-1rem))]'
      }`}
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
    >
      <header className="flex items-center gap-1 px-3 py-1.5">
        <SpotifyIcon className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-fraunces text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {request.title}
          </p>
          <p className="truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {track ? `${track.title} · ${track.artist}` : notConfigured ? 'Search on Spotify' : error ? 'Unavailable' : 'Searching Spotify…'}
          </p>
        </div>
        <button type="button" className={btn} onClick={() => setIndex((i) => i - 1)} disabled={!results || index <= 0} aria-label="Previous result" style={{ color: 'var(--text-secondary)' }}>
          <SkipBack className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => setIndex((i) => i + 1)} disabled={!results || index >= results.length - 1} aria-label="Next result" style={{ color: 'var(--text-secondary)' }}>
          <SkipForward className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => setMinimized((m) => !m)} aria-label={minimized ? 'Show the results' : 'Shrink the player'} aria-expanded={!minimized} style={{ color: 'var(--text-secondary)' }}>
          {minimized ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        <button type="button" className={btn} onClick={onClose} aria-label="Close the player and stop" style={{ color: 'var(--text-secondary)' }}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {!minimized && <SearchBar source="spotify" request={request} found={results ? results.map((r) => `${r.title} · ${r.artist}`) : null} failed={!!error || notConfigured} href={spotifySearchUrl(request.query)} hrefLabel="Spotify" onSearch={onSearch} />}

      {/* Spotify's own player (it supplies play, seek and volume); kept mounted when shrunk so it keeps playing. */}
      <div className={minimized ? 'h-0 overflow-hidden' : 'border-t'} style={{ borderColor: 'var(--border-hairline)' }}>
        {track ? (
          <iframe
            key={track.id}
            title={`${track.title} on Spotify`}
            src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`}
            width="100%"
            height="152"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="block border-0"
          />
        ) : (
          <div className="grid h-24 place-items-center gap-1 p-4 text-center text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {notConfigured ? (
              <>
                <span>Spotify search isn’t set up here.</span>
                <a href={spotifySearchUrl(request.query)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Open the search on Spotify <ExternalLink className="inline h-2.5 w-2.5" aria-hidden />
                </a>
              </>
            ) : (
              (error ?? 'Searching Spotify…')
            )}
          </div>
        )}
      </div>

      {!minimized && (
        <div className="flex max-h-[24vh] flex-col border-t md:max-h-[38vh]" style={{ borderColor: 'var(--border-hairline)' }}>
          <ul className="overflow-y-auto pb-1">
            {(results ?? []).map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === index || undefined}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--bg-subtle)]"
                  style={{ backgroundColor: i === index ? 'var(--bg-subtle)' : undefined }}
                >
                  {r.image ? <img src={r.image} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="h-9 w-9 shrink-0 rounded" style={{ backgroundColor: 'var(--bg-subtle)' }} />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12px] leading-snug" style={{ color: 'var(--text-primary)', fontWeight: i === index ? 600 : 400 }}>
                      {r.title}
                    </span>
                    <span className="block truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {[r.artist, r.album, r.duration].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
};

const DockPlayer: React.FC<{ request: MediaRequest; onSearch: (query: string) => void; onClose: () => void }> = ({ request, onSearch, onClose }) => {
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [minimized, setMinimized] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ at: 0, total: 0 });
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [captionsOn, setCaptionsOn] = useState(() => {
    try {
      return localStorage.getItem('sottovoce:captions') === '1';
    } catch {
      return false;
    }
  });
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const captionsRef = useRef(captionsOn);
  captionsRef.current = captionsOn;
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/youtube/search?q=${encodeURIComponent(request.query)}${request.music ? '&music=1' : ''}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        setResults(body.results as Result[]);
      })
      .catch((e) => e?.name !== 'AbortError' && setError(String(e.message ?? e)));
    return () => ctrl.abort();
  }, [request.query]);

  const video = results?.[index];

  // Next playable result after `from` (videos the owner won't allow embedding are skipped).
  const advance = useRef<(from: number, step: 1 | -1) => void>(() => {});
  advance.current = (from, step) => {
    if (!results) return;
    for (let i = from + step; i >= 0 && i < results.length; i += step) {
      if (!skipped.has(results[i].id)) return setIndex(i);
    }
  };

  // One player for the dock's whole life: created for the first video, then switched with loadVideoById.
  useEffect(() => {
    if (!video) return;
    if (playerRef.current) {
      playerRef.current.loadVideoById(video.id);
      return;
    }
    let live = true;
    loadYouTubeApi().then(
      (YT) => {
        if (!live || !hostRef.current || playerRef.current) return;
        const mount = document.createElement('div');
        hostRef.current.appendChild(mount);
        playerRef.current = new YT.Player(mount, {
          videoId: video.id,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, cc_load_policy: captionsRef.current ? 1 : 0, origin: window.location.origin },
          events: {
            onStateChange: (e: { data: number }) => {
              setPlaying(e.data === YT.PlayerState.PLAYING);
              if (e.data === YT.PlayerState.PLAYING) {
                const p = playerRef.current;
                if (captionsRef.current) p?.loadModule('captions');
                p?.setPlaybackRate(speedRef.current);
              }
              if (e.data === YT.PlayerState.ENDED) setIndexAfterEnd();
            },
            onError: () => setIndexAfterError(),
          },
        });
      },
      (e) => live && setError(String(e.message ?? e))
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  // The player's callbacks outlive renders, so they go through refs to see the current list and position.
  const indexRef = useRef(index);
  indexRef.current = index;
  const videoIdRef = useRef(video?.id);
  videoIdRef.current = video?.id;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // The player has no change events for position, so read it a few times a second (not while dragging the bar).
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (p?.getDuration) setTime({ at: p.getCurrentTime() || 0, total: p.getDuration() || 0 });
    }, 250);
    return () => clearInterval(t);
  }, []);

  const togglePlay = () => (playing ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo());
  const toggleCaptions = () => {
    const on = !captionsOn;
    setCaptionsOn(on);
    try {
      localStorage.setItem('sottovoce:captions', on ? '1' : '0');
    } catch {
      /* private mode: the choice just lasts this session */
    }
    if (on) playerRef.current?.loadModule('captions');
    else playerRef.current?.unloadModule('captions');
  };
  const toggleMute = () => {
    if (muted) playerRef.current?.unMute();
    else playerRef.current?.mute();
    setMuted(!muted);
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    playerRef.current?.setPlaybackRate(next);
  };
  const shown = scrubbing ?? time.at;
  const pct = time.total ? Math.min(100, (shown / time.total) * 100) : 0;

  const setIndexAfterEnd = () => advance.current(indexRef.current, 1);
  const setIndexAfterError = () => {
    const id = videoIdRef.current;
    if (!id) return;
    setSkipped((s) => new Set(s).add(id));
    // Move on once the skip is recorded.
    setTimeout(() => advance.current(indexRef.current, 1), 0);
  };

  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    []
  );

  const btn = 'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[var(--bg-subtle)] disabled:cursor-default disabled:opacity-30';
  const canPrev = !!results && results.slice(0, index).some((r) => !skipped.has(r.id));
  const canNext = !!results && results.slice(index + 1).some((r) => !skipped.has(r.id));

  return (
    <aside
      aria-label={request.music ? 'YouTube Music player' : 'YouTube player'}
      className={`fixed z-[900] right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4 md:right-4 flex flex-col overflow-hidden rounded-2xl border shadow-2xl animate-folio-enter ${
        minimized ? 'w-[min(20rem,calc(100vw-1rem))]' : 'w-[min(26rem,calc(100vw-1rem))]'
      }`}
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)' }}
    >
      <header className="flex items-center gap-1 px-3 py-1.5">
        {request.music ? <Music2 className="h-4 w-4 shrink-0" style={{ color: '#FF0033' }} aria-hidden /> : <Youtube className="h-4 w-4 shrink-0" style={{ color: '#FF0033' }} aria-hidden />}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-fraunces text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {request.title}
          </p>
          <p className="truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {video ? `${video.title} · ${video.channel}` : error ? 'Unavailable' : 'Searching YouTube…'}
          </p>
        </div>
        <button type="button" className={btn} onClick={() => advance.current(index, -1)} disabled={!canPrev} aria-label="Previous result" style={{ color: 'var(--text-secondary)' }}>
          <SkipBack className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => advance.current(index, 1)} disabled={!canNext} aria-label="Next result" style={{ color: 'var(--text-secondary)' }}>
          <SkipForward className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => setMinimized((m) => !m)} aria-label={minimized ? 'Show the results' : 'Shrink the player'} aria-expanded={!minimized} style={{ color: 'var(--text-secondary)' }}>
          {minimized ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        <button type="button" className={btn} onClick={onClose} aria-label="Close the player and stop" style={{ color: 'var(--text-secondary)' }}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {!minimized && <SearchBar source={request.music ? 'youtube music' : 'youtube'} request={request} found={results ? results.map((r) => `${r.title} · ${r.channel}`) : null} failed={!!error} href={request.music ? `https://music.youtube.com/search?q=${encodeURIComponent(request.query)}` : searchUrl(request.query)} hrefLabel={request.music ? 'YouTube Music' : 'YouTube'} onSearch={onSearch} />}

      {/* The video stays mounted at all times (a small picture when shrunk) so it keeps playing. */}
      <div className={`relative bg-black ${minimized ? 'h-0 pb-0' : 'aspect-video'}`} style={minimized ? { height: 0 } : undefined}>
        <div ref={hostRef} className={minimized ? 'absolute -left-[9999px] h-[180px] w-[320px]' : 'absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full'} />
        {!video && (
          <p className="absolute inset-0 grid place-items-center p-4 text-center text-xs font-mono" style={{ color: '#e8dccb' }}>
            {error ?? 'Searching YouTube…'}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 border-t px-2 py-1" style={{ borderColor: 'var(--border-hairline)' }}>
        <button type="button" className={btn} onClick={togglePlay} disabled={!video} aria-label={playing ? 'Pause' : 'Play'} style={{ color: 'var(--accent-crimson)' }}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {clock(shown)}
        </span>
        <input
          type="range"
          className="dock-seek min-w-0 flex-1"
          min={0}
          max={Math.max(1, Math.floor(time.total))}
          step={1}
          value={Math.floor(shown)}
          disabled={!time.total}
          aria-label="Seek"
          aria-valuetext={`${clock(shown)} of ${clock(time.total)}`}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing !== null) playerRef.current?.seekTo(scrubbing, true);
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing !== null) playerRef.current?.seekTo(scrubbing, true);
            setScrubbing(null);
          }}
        />
        <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {clock(time.total)}
        </span>
        <button
          type="button"
          className={btn}
          onClick={toggleCaptions}
          aria-pressed={captionsOn}
          aria-label="Subtitles"
          title={captionsOn ? 'Subtitles on (where the video has them)' : 'Subtitles off'}
          style={{ color: captionsOn ? 'var(--accent-crimson)' : 'var(--text-muted)' }}
        >
          <Captions className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} style={{ color: muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
        <button type="button" onClick={cycleSpeed} aria-label={`Speed ${speed}×, change`} title="Playback speed" className="h-8 min-w-9 shrink-0 cursor-pointer rounded-full px-1.5 font-mono text-[10px] hover:bg-[var(--bg-subtle)]" style={{ color: speed === 1 ? 'var(--text-secondary)' : 'var(--accent-crimson)' }}>
          {speed}×
        </button>
      </div>

      {!minimized && (
        <div className="flex max-h-[24vh] flex-col border-t md:max-h-[38vh]" style={{ borderColor: 'var(--border-hairline)' }}>
          <ul className="overflow-y-auto pb-1">
            {(results ?? []).map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  disabled={skipped.has(r.id)}
                  aria-current={i === index || undefined}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--bg-subtle)] disabled:cursor-default disabled:opacity-40"
                  style={{ backgroundColor: i === index ? 'var(--bg-subtle)' : undefined }}
                >
                  <img src={`https://i.ytimg.com/vi/${r.id}/default.jpg`} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12px] leading-snug" style={{ color: 'var(--text-primary)', fontWeight: i === index ? 600 : 400 }}>
                      {r.title}
                    </span>
                    <span className="block truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {[r.channel, r.duration, skipped.has(r.id) ? 'embedding disabled' : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {results && !results.length && (
              <li className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Nothing found.
              </li>
            )}
          </ul>
        </div>
      )}
    </aside>
  );
};
