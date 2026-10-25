import { ArgonButton } from './components/ArgonButton';
import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import {
  Radio,
  Mic,
  BookOpen,
  ArrowUpRight,
  Sun,
  Moon,
  Monitor,
  Layers,
} from 'lucide-react';
import { AccountButton } from './components/AccountButton';
import { MePage } from './components/MePage';
import type {
  WorkAndLibretto,
  RepertoireWork,
  CivicNode,
  LiveEvent,
  UserTasteProfile,
  CrossGenreRecommendation,
  SaintHitlTask,
  MultimodalContextOutput,
  HybridSearchResult,
  OpenLondonLiveTelemetry,
} from './types/sottovoce';
import {
  SEED_WORKS_AND_LIBRETTI,
  SEED_CIVIC_NODES,
  SEED_LIVE_EVENTS,
  SEED_USER_TASTE_PROFILES,
  SEED_SAINT_HITL_TASKS,
  DEFAULT_OPEN_LONDON_TELEMETRY,
  MONGODB_ATLAS_SPECS,
} from './data/sottovoceData';
import {
  resolveSceneFromContext,
  computeCrossGenreRecommendations,
  runHybridSearchRankFusion,
} from './utils/sottovoceEngine';
import { LeitmotifAudioSynth } from './components/LeitmotifAudioSynth';
import { LastFmTasteBridge } from './components/LastFmTasteBridge';
import { DiscoverSidebar, AccordionSection, type DiscoverView } from './components/DiscoverShell';
import {
  type DetailPage,
  type MeSection,
  type NavTab,
  canonicalizeUrl,
  immersePath,
  middleClickLinks,
  migrateLegacyMapUrl,
  navigateTo,
  pathFor,
  parseCount,
  readParams,
  routeFromPath,
  routeLinkClicks,
  routeUsesWork,
  setParams,
} from './utils/urlState';
import { TubeMapEmbed } from './components/TubeMapEmbed';
import { VenueIndex } from './components/VenueIndex';

// three.js is only loaded when the Seating page opens.
const SeatingView = lazy(() => import('./components/seatmap/SeatingView'));
const timetableEvents = (timetableData as unknown as TimetableData).events;
import { RepertoireCatalogue, RepertoireSearch, liveMatch, type LiveWorkLink } from './components/RepertoireCatalogue';
import { ImmerseView, type ImmerseTarget } from './components/ImmerseView';
import { LiveSheet } from './components/LiveSheet';
import { LibrettoIcon, DiscoverIcon, ImmerseIcon } from './components/NavIcons';
import { SavedEventsRail, TimetableView } from './components/TimetableView';
import { FeedView } from './components/FeedView';
import { EventPage } from './components/EventPage';
import { VenuePage } from './components/VenuePage';
import timetableData from './data/timetable.generated.json';
import type { TimetableData } from './data/timetableCategories';
import { SaintAgentConsole } from './components/SaintAgentConsole';
import {
  AtlasHybridSearchLab,
  type StreamTelemetryPayload,
} from './components/AtlasHybridSearchLab';
import {
  SpotlightSurface,
  BlurTextReveal,
  MagneticButton,
  KineticTelemetryRibbon,
} from './components/ui/TwentyFirstPrimitives';

const STAGE_CANVAS_W = 440;
const STAGE_CANVAS_H = 220;
const STAGE_CANVAS_SCALE = 2;

const STAGE_CONTEXT_PRESETS = [
  {
    id: 'tosca-roh',
    roman: 'I',
    label: 'Royal Opera House · Tosca (Act II, Bar 412)',
    lat: 51.5129,
    lng: -0.1222,
    preferredWorkId: SEED_WORKS_AND_LIBRETTI[0].work_id,
    audioSnippetText: 'Vissi d’arte, vissi d’amore, non feci mai male ad anima viva!',
    visualStageHint:
      'Palazzo Farnese candlelit chamber in Rome; soprano in crimson velvet gown kneeling before Baron Scarpia’s supper table.',
  },
  {
    id: 'les-mis-sondheim',
    roman: 'II',
    label: 'Sondheim Theatre · Les Misérables (Act I Finale)',
    lat: 51.5116,
    lng: -0.1319,
    preferredWorkId: SEED_WORKS_AND_LIBRETTI[1]?.work_id || SEED_WORKS_AND_LIBRETTI[0].work_id,
    audioSnippetText: 'One more dawn, one more day, one day more!',
    visualStageHint:
      'Paris 1832 timber barricade forming on revolving stage; red revolutionary banner raised under amber gaslight.',
  },
  {
    id: 'don-giovanni-coliseum',
    roman: 'III',
    label: 'London Coliseum · Don Giovanni (Act II Finale)',
    lat: 51.5099,
    lng: -0.1267,
    preferredWorkId: SEED_WORKS_AND_LIBRETTI[2]?.work_id || SEED_WORKS_AND_LIBRETTI[0].work_id,
    audioSnippetText: 'Don Giovanni, a cenar teco m’invitasti e son venuto!',
    visualStageHint:
      'Monumental marble Commendatore statue emerging through trapdoor smoke in Seville banquet hall.',
  },
];

type ThemePref = 'auto' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'sottovoce-theme';
const THEME_CYCLE: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

const DEFAULT_WORK_ID = SEED_WORKS_AND_LIBRETTI[0].work_id;

/** `?work=` if it names a known work, else the default. */
function workIdFromUrl(): string {
  const id = readParams().get('work');
  return id && SEED_WORKS_AND_LIBRETTI.some((w) => w.work_id === id) ? id : DEFAULT_WORK_ID;
}

/** What Immerse follows, from the URL: `?work=` (synced libretto), `?rep=` (repertoire work) or `?show=` (a listing by name). */
function immerseTargetFromUrl(onImmerse: boolean): ImmerseTarget | null {
  const params = readParams();
  if (params.get('work')) return { kind: 'libretto', id: workIdFromUrl() };
  const rep = params.get('rep');
  if (onImmerse && rep) return { kind: 'rep', id: rep, venue: params.get('at') ?? undefined };
  const show = params.get('show');
  if (onImmerse && show) return { kind: 'show', title: show, venue: params.get('at') ?? undefined };
  return null;
}

/** `?line=` is 1-based in the URL, 0-based in state. */
const lineIdxFromUrl = () => parseCount(readParams().get('line'), 1) - 1;

export function App() {
  // The URL is the source of truth for which page is open (/libretto, /immerse, /discover/<view>).
  const [initialRoute] = useState(() => {
    migrateLegacyMapUrl();
    return routeFromPath(window.location.pathname);
  });
  const [activeTab, setActiveTab] = useState<NavTab>(initialRoute.tab);
  const [discoverView, setDiscoverView] = useState<DiscoverView>(initialRoute.view);
  // A standalone event or venue page (/event/<id>, /venue/<id>) shown in place of the Discover views.
  const [detailPage, setDetailPage] = useState<DetailPage | null>(initialRoute.page ?? null);
  // Requests passed between the Timetable and Journey Planner views — fly the Timetable map to a venue, filter the
  // list to a venue, open the planner at a venue. Each is consumed by the view it targets when it mounts.
  const [mapFocus, setMapFocus] = useState<{ id: string; n: number } | null>(null);
  const [venueRequest, setVenueRequest] = useState<{ id: string; n: number } | null>(null);
  const [plannerFocus, setPlannerFocus] = useState<{ id: string; nonce: number; plan?: { eventId?: string; fromHere: boolean } } | null>(null);
  // Theme preference persists in localStorage; "auto" (the default) follows the system theme.
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const themeMode: 'light' | 'dark' = themePref === 'auto' ? (systemDark ? 'dark' : 'light') : themePref;
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePref);
    } catch {
      /* storage unavailable: preference lasts for this session only */
    }
  }, [themePref]);
  const [oledDimMode, setOledDimMode] = useState(false);

  // Sync data-theme attribute on document root for global CSS tokens
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    // Tint the OS status bar / webview chrome to match the app canvas.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeMode === 'light' ? '#FAF6F0' : '#0C0A0E');
  }, [themeMode]);

  // Switch page: push a history entry for the new URL, then show it. Without a view, Discover reopens
  // whichever of its views was last open.
  const go = (tab: NavTab, view: DiscoverView = discoverView) => {
    navigateTo({ tab, view });
    setDetailPage(null);
    setActiveTab(tab);
    if (tab === 'discover') setDiscoverView(view);
    // Drop requests aimed at the page being left, so they don't replay when it's next opened.
    setMapFocus(null);
    setVenueRequest(null);
    setPlannerFocus(null);
  };

  // Libretto → Discover: the Timetable filtered to one work's title, across every date.
  const openTimetableFor = (q: string) => {
    go('discover', 'events');
    setParams({ q, exact: '1', range: 'all' });
  };

  // Anywhere → Discover: a Timetable venue's listings over every date (only those matching `q`, if given), with the
  // map flown to its pin.
  // `filters` are the Timetable's own URL params (e.g. `category`), carrying over a filter set on the page it's opened from.
  const openVenueInTimetable = (venueId: string, q?: string, filters?: Record<string, string>) => {
    go('discover', 'events');
    setParams({ ...filters, ...(q ? { q, exact: '1' } : {}) });
    setVenueRequest({ id: venueId, n: Date.now() });
    setMapFocus({ id: venueId, n: Date.now() });
    window.scrollTo({ top: 0 });
  };

  // Anywhere → Journey Planner at a venue (map or Timetable venue id); with `plan`, a trip there, e.g. to one performance.
  const planJourneyTo = (venueId: string, plan?: { eventId?: string; fromHere: boolean }) => {
    go('discover', 'journey');
    setPlannerFocus({ id: venueId, nonce: Date.now(), plan });
    window.scrollTo({ top: 0 });
  };

  // Tidy aliases (/, /discover) once, then follow the browser's back / forward buttons.
  useEffect(() => {
    canonicalizeUrl();
    const onPopState = () => {
      const route = routeFromPath(window.location.pathname);
      setActiveTab(route.tab);
      setDetailPage(route.page ?? null);
      if (route.tab === 'discover') setDiscoverView(route.view);
      if (routeUsesWork(route)) {
        setSelectedWorkId(workIdFromUrl());
        setSelectedLineIdx(lineIdxFromUrl());
        if (route.tab === 'immerse') setImmerseTarget(immerseTargetFromUrl(true));
      }
    };
    window.addEventListener('popstate', onPopState);
    // <a data-route> links to event / venue pages navigate in-app.
    const stopRouteLinks = routeLinkClicks(document);
    // Middle-click on buttons carrying a data-href opens that page in a new tab.
    const stopMiddleClicks = middleClickLinks(document);
    return () => {
      stopMiddleClicks();
      window.removeEventListener('popstate', onPopState);
      stopRouteLinks();
    };
  }, []);

  // Publish the pinned header's height so sticky children (timetable day headings, discover rail)
  // can sit just below it. 0 when the header is un-pinned (landscape phones).
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const publish = () => {
      const pinned = getComputedStyle(header).position === 'sticky';
      document.documentElement.style.setProperty(
        '--app-header-h',
        pinned ? `${header.getBoundingClientRect().height}px` : '0px'
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(header);
    window.addEventListener('orientationchange', publish);
    window.addEventListener('resize', publish);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', publish);
      window.removeEventListener('resize', publish);
    };
  }, []);

  // Core state hydrated from /api/state with instant seed fallback
  const [works, setWorks] = useState<WorkAndLibretto[]>(SEED_WORKS_AND_LIBRETTI);
  const [civicNodes, setCivicNodes] = useState<CivicNode[]>(SEED_CIVIC_NODES);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(SEED_LIVE_EVENTS);
  const [tasteProfiles, setTasteProfiles] = useState<UserTasteProfile[]>(SEED_USER_TASTE_PROFILES);
  const [recommendations, setRecommendations] = useState<CrossGenreRecommendation[]>(() =>
    computeCrossGenreRecommendations(
      SEED_USER_TASTE_PROFILES[0],
      SEED_WORKS_AND_LIBRETTI,
      SEED_LIVE_EVENTS
    )
  );
  const [saintTasks, setSaintTasks] = useState<SaintHitlTask[]>(SEED_SAINT_HITL_TASKS);
  const [openLondonTelemetry, setOpenLondonTelemetry] = useState<OpenLondonLiveTelemetry>(
    DEFAULT_OPEN_LONDON_TELEMETRY
  );
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [hybridSource, setHybridSource] = useState<'atlas' | 'in-memory' | null>(null);
  const [atlasStream, setAtlasStream] = useState<StreamTelemetryPayload | null>(null);
  const [atlasSpecs, setAtlasSpecs] = useState<Record<string, unknown> | null>(
    MONGODB_ATLAS_SPECS as unknown as Record<string, unknown>
  );

  // Active Live Performance Context
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
  const [selectedWorkId, setSelectedWorkId] = useState<string>(() => workIdFromUrl());
  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(() => lineIdxFromUrl());
  // Immerse follows nothing until a work is picked (or named in the URL / sent over from the Libretto / found by Live).
  const [immerseTarget, setImmerseTarget] = useState<ImmerseTarget | null>(() => immerseTargetFromUrl(initialRoute.tab === 'immerse'));
  // The header's Live button: locate the user, guess the performance, open Immerse on it.
  const [liveOpen, setLiveOpen] = useState(false);
  const [isScanningContext, setIsScanningContext] = useState(false);

  // Libretto tab (the home page): the Feed, the live companion or the offline repertoire (?view=live|repertoire&rep=<wikidata id>),
  // with one shared search. The Feed is the default; a link carrying ?work= / ?line= keeps opening the live libretto.
  const [librettoView, setLibrettoView] = useState<'feed' | 'live' | 'repertoire'>(() => {
    const params = readParams();
    const view = params.get('view');
    if (view === 'feed' || view === 'live' || view === 'repertoire') return view;
    return params.get('work') || params.get('line') ? 'live' : 'feed';
  });
  const [repId, setRepId] = useState<string | null>(() => readParams().get('rep'));
  const [repQuery, setRepQuery] = useState('');
  const pickRepertoireWork = (w: RepertoireWork) => {
    setRepId(w.id);
    setLibrettoView('repertoire');
  };

  const currentWork = works.find((w) => w.work_id === selectedWorkId) || works[0];
  const currentLine = currentWork.lines[selectedLineIdx] || currentWork.lines[0];

  // Keep ?work= and ?line= on pages that show the libretto (omitted at their defaults). Immerse names what it follows:
  // ?work= for a synced libretto, ?rep= for a repertoire work, ?show= (with ?at= the venue) for a listing by name.
  const resolvedLineIdx = currentWork.lines[selectedLineIdx] ? selectedLineIdx : 0;
  useEffect(() => {
    const shown = routeUsesWork({ tab: activeTab, view: discoverView });
    const browsing = activeTab === 'companion' && librettoView === 'repertoire';
    const onImmerse = activeTab === 'immerse';
    const librettoOnImmerse = onImmerse && immerseTarget?.kind === 'libretto';
    const work = onImmerse
      ? librettoOnImmerse
        ? currentWork.work_id
        : null
      : shown && currentWork.work_id !== DEFAULT_WORK_ID
        ? currentWork.work_id
        : null;
    const line = shown && (!onImmerse || librettoOnImmerse) && resolvedLineIdx > 0 ? String(resolvedLineIdx + 1) : null;
    setParams({
      work,
      line,
      // The Feed is the default view, so it only needs naming when ?work= / ?line= would otherwise open the live libretto.
      view: activeTab !== 'companion' ? null : librettoView === 'feed' ? (work || line ? 'feed' : null) : librettoView,
      rep: browsing ? repId : onImmerse && immerseTarget?.kind === 'rep' ? immerseTarget.id : null,
      show: onImmerse && immerseTarget?.kind === 'show' ? immerseTarget.title : null,
      at: onImmerse && immerseTarget && immerseTarget.kind !== 'libretto' ? (immerseTarget.venue ?? null) : null,
    });
  }, [activeTab, discoverView, currentWork.work_id, resolvedLineIdx, librettoView, repId, immerseTarget]);

  const [contextDetection, setContextDetection] = useState<MultimodalContextOutput>(() => {
    const resolved = resolveSceneFromContext(SEED_WORKS_AND_LIBRETTI, SEED_CIVIC_NODES, {
      lat: STAGE_CONTEXT_PRESETS[0].lat,
      lng: STAGE_CONTEXT_PRESETS[0].lng,
      audioSnippetText: STAGE_CONTEXT_PRESETS[0].audioSnippetText,
      visualStageHint: STAGE_CONTEXT_PRESETS[0].visualStageHint,
      preferredWorkId: STAGE_CONTEXT_PRESETS[0].preferredWorkId,
    });
    return resolved.contextOutput;
  });

  // Subtext & Leitmotif Deep-Dive state
  const [subtextExplanation, setSubtextExplanation] = useState<{
    literal_translation: string;
    dramatic_subtext: string;
    musical_cue: string;
  } | null>(null);
  const [isExplainingLine, setIsExplainingLine] = useState(false);

  // Sotto Voce Whispered Voice / Bone-Conduction Query state
  const [whisperQuestion, setWhisperQuestion] = useState(
    'Why is Tosca singing to God right in front of Baron Scarpia?'
  );
  const [whisperResponse, setWhisperResponse] = useState<{
    answer: string;
    aside: string | null;
    model_used: string;
  } | null>(null);
  const [isWhispering, setIsWhispering] = useState(false);

  // Saint AI Ingestion loading state
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);

  // Initial Hybrid Search Results
  const [initialHybridResults] = useState<HybridSearchResult[]>(() =>
    runHybridSearchRankFusion(
      'Vissi d’arte tragic prayer & Baron Scarpia brass chords',
      51.5129,
      -0.1222,
      SEED_WORKS_AND_LIBRETTI,
      SEED_CIVIC_NODES,
      SEED_LIVE_EVENTS,
      'all',
      SEED_USER_TASTE_PROFILES
    )
  );

  // Procedural Theatrical Stage & Acoustic Waveform Canvas for Zero-Click Scanner
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = stageCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw in a fixed 440×220 design space; the backing store is 2× so it stays sharp on retina / phone screens
    // and CSS scales the canvas to its column (aspect-ratio keeps the proportions).
    const width = STAGE_CANVAS_W;
    const height = STAGE_CANVAS_H;
    ctx.setTransform(STAGE_CANVAS_SCALE, 0, 0, STAGE_CANVAS_SCALE, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isLight = themeMode === 'light';

    // Stage proscenium background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    if (isLight) {
      bgGrad.addColorStop(0, '#F6EFE4');
      bgGrad.addColorStop(0.65, '#EDE2D0');
      bgGrad.addColorStop(1, '#E5D6C0');
    } else {
      bgGrad.addColorStop(0, '#0C0A0E');
      bgGrad.addColorStop(0.65, '#191420');
      bgGrad.addColorStop(1, '#0C0A0E');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Stage spotlight cone
    const spotGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.18,
      10,
      width * 0.5,
      height * 0.58,
      width * 0.5
    );
    if (currentWork.stage_design_style === 'baroque_palazzo') {
      spotGrad.addColorStop(0, isLight ? 'rgba(158, 27, 50, 0.22)' : 'rgba(200, 35, 60, 0.48)');
      spotGrad.addColorStop(0.6, isLight ? 'rgba(154, 107, 19, 0.12)' : 'rgba(229, 184, 75, 0.16)');
    } else if (currentWork.stage_design_style === 'revolving_barricade') {
      spotGrad.addColorStop(0, isLight ? 'rgba(180, 83, 9, 0.24)' : 'rgba(217, 119, 6, 0.42)');
      spotGrad.addColorStop(0.6, isLight ? 'rgba(158, 27, 50, 0.14)' : 'rgba(200, 35, 60, 0.2)');
    } else {
      spotGrad.addColorStop(0, isLight ? 'rgba(21, 128, 61, 0.2)' : 'rgba(52, 211, 153, 0.36)');
      spotGrad.addColorStop(0.6, isLight ? 'rgba(154, 107, 19, 0.12)' : 'rgba(229, 184, 75, 0.16)');
    }
    spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, width, height);

    // Architectural proscenium arch framing lines
    ctx.strokeStyle = isLight ? 'rgba(158, 27, 50, 0.35)' : 'rgba(229, 184, 75, 0.38)';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, width - 28, height - 28);

    // Stage floor perspective grid
    ctx.strokeStyle = isLight ? 'rgba(24, 19, 16, 0.12)' : 'rgba(247, 243, 235, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const x = (width / 6) * i;
      ctx.beginPath();
      ctx.moveTo(width * 0.5 + (x - width * 0.5) * 0.35, height * 0.56);
      ctx.lineTo(x, height - 14);
      ctx.stroke();
    }

    // Actor blocking markers from active libretto line
    currentLine.stage_blocking.forEach((b, idx) => {
      const px = width * 0.5 + b.x * 26;
      const py = height * 0.65 + b.z * 14;
      const charColor = currentWork.characters[idx]?.color || (isLight ? '#9E1B32' : '#E5B84B');

      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = charColor;
      ctx.fill();
      ctx.strokeStyle = isLight ? '#FAF6F0' : '#181310';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isLight ? '#181310' : '#F7F3EB';
      ctx.font = '600 10px "Fira Code", monospace';
      ctx.fillText(b.actor, px - 22, py - 12);
    });

    // Acoustic spectrogram bars at bottom
    ctx.fillStyle = isLight ? 'rgba(158, 27, 50, 0.68)' : 'rgba(229, 184, 75, 0.68)';
    for (let i = 0; i < 38; i++) {
      const barH = 3 + Math.abs(Math.sin(i * 0.45 + selectedLineIdx * 1.3)) * 18;
      ctx.fillRect(22 + i * 9.8, height - 18 - barH, 4, barH);
    }
    // The canvas is unmounted on other tabs and in the repertoire view, so redraw when it comes back.
  }, [currentWork, currentLine, selectedLineIdx, themeMode, activeTab, librettoView]);

  // Fetch backend state & live zero-key London telemetry on mount
  useEffect(() => {
    let mounted = true;
    const loadInitialData = async () => {
      try {
        const [stateRes, londonRes, streamRes] = await Promise.all([
          fetch('/api/state'),
          fetch('/api/open-london/live-feeds'),
          fetch('/api/atlas/stream-telemetry'),
        ]);
        if (stateRes.ok && mounted) {
          const data = await stateRes.json();
          if (data.works?.length) setWorks(data.works);
          if (data.civicNodes?.length) setCivicNodes(data.civicNodes);
          if (data.liveEvents?.length) setLiveEvents(data.liveEvents);
          if (data.tasteProfiles?.length) setTasteProfiles(data.tasteProfiles);
          if (data.recommendations?.length) setRecommendations(data.recommendations);
          if (data.hitlTasks?.length) setSaintTasks(data.hitlTasks);
          if (data.atlasSpecs) setAtlasSpecs(data.atlasSpecs);
        }
        if (londonRes.ok && mounted) {
          const telemetry = await londonRes.json();
          setOpenLondonTelemetry(telemetry);
        }
        if (streamRes.ok && mounted) {
          const stream = await streamRes.json();
          setAtlasStream(stream);
        }
      } catch {
        // Fallback seed state already active
      }
    };
    loadInitialData();
    return () => {
      mounted = false;
    };
  }, []);

  /** Open a work's live libretto (from a venue popup on the maps, or the Libretto search). */
  const openWork = (workId: string) => {
    setSelectedWorkId(workId);
    setSelectedLineIdx(0);
    setLibrettoView('live');
    setRepQuery('');
    go('companion');
  };

  /** Live → Immerse: follow the performance the Live sheet settled on. */
  const openImmerse = (target: ImmerseTarget) => {
    if (target.kind === 'libretto') {
      setSelectedWorkId(target.id);
      setSelectedLineIdx(0);
    }
    setImmerseTarget(target);
    setLiveOpen(false);
    go('immerse');
    window.scrollTo({ top: 0 });
  };

  /** The works with a full live libretto, offered first by the Libretto search. */
  const liveWorkLinks: LiveWorkLink[] = works.map(({ work_id, title, composer }) => ({ work_id, title, composer }));

  const handleRefreshOpenFeeds = async () => {
    setRefreshingFeeds(true);
    try {
      const res = await fetch('/api/open-london/live-feeds');
      if (res.ok) {
        const telemetry = await res.json();
        setOpenLondonTelemetry(telemetry);
      }
    } finally {
      setRefreshingFeeds(false);
    }
  };

  // Zero-Click Multimodal Stage Scan handler
  const handleScanStageContext = async (presetIndex = selectedPresetIdx) => {
    const preset = STAGE_CONTEXT_PRESETS[presetIndex] || STAGE_CONTEXT_PRESETS[0];
    setSelectedPresetIdx(presetIndex);
    setIsScanningContext(true);

    try {
      const res = await fetch('/api/context/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: preset.lat,
          lng: preset.lng,
          audioSnippetText: preset.audioSnippetText,
          visualStageHint: preset.visualStageHint,
          preferredWorkId: preset.preferredWorkId,
        }),
      });
      if (res.ok) {
        const detected: MultimodalContextOutput = await res.json();
        setContextDetection(detected);
        setSelectedWorkId(detected.work_id);
        setSelectedLineIdx(detected.current_line_index || 0);
        setSubtextExplanation(null);
      } else {
        const fallback = resolveSceneFromContext(works, civicNodes, {
          lat: preset.lat,
          lng: preset.lng,
          audioSnippetText: preset.audioSnippetText,
          visualStageHint: preset.visualStageHint,
          preferredWorkId: preset.preferredWorkId,
        });
        setContextDetection(fallback.contextOutput);
        setSelectedWorkId(fallback.matchedWork.work_id);
        setSelectedLineIdx(fallback.matchedLineIndex);
      }
    } catch {
      const fallback = resolveSceneFromContext(works, civicNodes, {
        lat: preset.lat,
        lng: preset.lng,
        audioSnippetText: preset.audioSnippetText,
        visualStageHint: preset.visualStageHint,
        preferredWorkId: preset.preferredWorkId,
      });
      setContextDetection(fallback.contextOutput);
      setSelectedWorkId(fallback.matchedWork.work_id);
      setSelectedLineIdx(fallback.matchedLineIndex);
    } finally {
      setIsScanningContext(false);
    }
  };

  // Click-to-explain Libretto Line handler
  const handleExplainLine = async (idx: number) => {
    setSelectedLineIdx(idx);
    const line = currentWork.lines[idx];
    if (!line) return;

    setIsExplainingLine(true);
    try {
      const res = await fetch('/api/libretto/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId: currentWork.work_id,
          lineIndex: idx,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSubtextExplanation({
          literal_translation: data.literal_translation || line.literal_english,
          dramatic_subtext: data.dramatic_subtext || line.dramatic_subtext,
          musical_cue: data.musical_cue || line.musical_leitmotif,
        });
      } else {
        setSubtextExplanation({
          literal_translation: line.literal_english,
          dramatic_subtext: line.dramatic_subtext,
          musical_cue: line.musical_leitmotif,
        });
      }
    } catch {
      setSubtextExplanation({
        literal_translation: line.literal_english,
        dramatic_subtext: line.dramatic_subtext,
        musical_cue: line.musical_leitmotif,
      });
    } finally {
      setIsExplainingLine(false);
    }
  };

  // Whispered Voice / Bone-Conduction Query handler (two gemini-4-argon replies, text only)
  const handleWhisperQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whisperQuestion.trim()) return;
    setIsWhispering(true);
    try {
      const res = await fetch('/api/sottovoce/whisper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: whisperQuestion.trim(),
          workId: currentWork.work_id,
          lineIndex: selectedLineIdx,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWhisperResponse({
          answer: data.answer,
          aside: data.aside || null,
          model_used: `${data.model_used || 'gemini-4-argon'}${data.latency_ms ? ` · ${data.latency_ms}ms` : ''}`,
        });
      }
    } finally {
      setIsWhispering(false);
    }
  };

  // Saint AI URL Ingestion handler
  const handleSaintIngestUrl = async (url: string) => {
    setIsIngestingUrl(true);
    try {
      const res = await fetch('/api/saint/ingest-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.task) {
          setSaintTasks((prev) => [data.task, ...prev]);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || 'Saint AI could not ingest that URL.');
      }
    } finally {
      setIsIngestingUrl(false);
    }
  };

  // Saint AI 1-Click HITL Approval/Rejection handler
  const handleResolveHitlTask = async (taskId: string, decision: 'approve' | 'reject') => {
    const res = await fetch('/api/saint/approve-hitl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, decision }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.task) {
        setSaintTasks((prev) => prev.map((t) => (t.task_id === taskId ? data.task : t)));
      }
      if (data.liveEvents) {
        setLiveEvents(data.liveEvents);
      }
    }
  };

  // MongoDB Atlas $rankFusion Hybrid Search handler
  const handleRunHybridSearch = async (
    query: string,
    collectionFilter:
      | 'all'
      | 'works_and_libretti'
      | 'live_events'
      | 'civic_nodes'
      | 'user_taste_profiles'
  ): Promise<HybridSearchResult[]> => {
    try {
      const res = await fetch('/api/atlas/hybrid-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          collectionFilter,
          lat: 51.5129,
          lng: -0.1222,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setHybridSource(data.source === 'atlas' ? 'atlas' : 'in-memory');
        return data.results;
      }
    } catch {
      // Fallback to local engine
    }
    return runHybridSearchRankFusion(
      query,
      51.5129,
      -0.1222,
      works,
      civicNodes,
      liveEvents,
      collectionFilter,
      tasteProfiles
    );
  };

  const pendingHitlCount = saintTasks.filter((t) => t.status === 'pending_human_approval').length;
  const nearestFountain =
    contextDetection.nearest_amenities.find((a) => a.category === 'water_fountain') ||
    contextDetection.nearest_amenities[0];
  const nearestToilet =
    contextDetection.nearest_amenities.find((a) => a.category === 'public_toilet') ||
    contextDetection.nearest_amenities[1] ||
    contextDetection.nearest_amenities[0];

  // Simplified, clear editorial navigation tabs
  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'companion', label: 'Libretto', icon: <LibrettoIcon className="w-5 h-5" /> },
    { id: 'discover', label: 'Discover', icon: <DiscoverIcon className="w-5 h-5" /> },
    { id: 'immerse', label: 'Immerse', icon: <ImmerseIcon className="w-5 h-5" /> },
  ];

  const ribbonTelemetry = [
    {
      label: 'ACTIVE STAGE',
      value: `${currentWork.title.toUpperCase()} · ACT ${currentWork.current_act} BAR ${currentLine.bar_number}`,
    },
    {
      label: 'TFL UNIFIED API (940GZZLUCOV)',
      value:
        openLondonTelemetry.tfl_unified?.lines_status
          ?.map((l) => `${l.line_name}: ${l.status_severity}`)
          .slice(0, 2)
          .join(' · ') || 'Piccadilly & Northern: Good Service',
    },
    {
      label: 'OPEN-METEO COVENT GARDEN',
      value: `${openLondonTelemetry.weather.temperature_c.toFixed(1)}°C · AQI ${openLondonTelemetry.air_quality.european_aqi}`,
    },
    {
      label: 'ENVIRONMENT AGENCY THAMES',
      value: `${openLondonTelemetry.flood_monitoring.water_level_m.toFixed(2)}m AOD`,
    },
    {
      label: 'INATURALIST WESTMINSTER',
      value:
        openLondonTelemetry.wildlife.recent_observations[0]?.species || 'Peregrine Falcon',
    },
  ];

  return (
    <div
      data-theme={themeMode}
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="min-h-dvh transition-colors duration-300"
    >
      {oledDimMode && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] bg-black/30" />
      )}

      {/* Top Bar: 1. Brand Wordmark | 2. Simple 4-Item Editorial Nav | 3. Theme Toggle & Scan Action */}
      <header
        ref={headerRef}
        className="app-header sticky top-0 z-40 backdrop-blur-xl border-b transition-colors"
        style={{
          backgroundColor:
            themeMode === 'light' ? 'rgba(250, 246, 240, 0.92)' : 'rgba(12, 10, 14, 0.92)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Element 1: Editorial Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => go('companion')}
              data-href="/libretto"
              className="text-left group cursor-pointer flex items-center gap-3"
            >
              <img
                src="/logo.png"
                alt="sottovoce — the stage in your pocket"
                className="brand-logo h-11 sm:h-14 w-auto rounded-lg"
                style={{ backgroundColor: '#FBF4E8' }}
              />
              <span
                className="hidden xl:inline-block text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{ color: 'var(--accent-crimson)' }}
              >
                COVENT GARDEN PLAYBILL
              </span>
            </button>
          </div>

          {/* Element 2: Simplified Clean Typographic Navigation Links (Libretto · Discover · Immerse) */}
          <nav
            aria-label="Main Navigation"
            className="hidden md:flex order-2 items-center justify-center gap-6 lg:gap-8"
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  data-href={pathFor({ tab: item.id, view: discoverView })}
                  className={`relative py-1.5 text-sm sm:text-base whitespace-nowrap shrink-0 transition-colors cursor-pointer border-b-2 ${
                    isActive ? 'font-semibold' : 'border-transparent hover:opacity-80'
                  }`}
                  style={
                    isActive
                      ? {
                          color: 'var(--accent-crimson)',
                          borderColor: 'var(--accent-crimson)',
                        }
                      : {
                          color: 'var(--text-secondary)',
                        }
                  }
                >
                  <span className="flex items-center gap-2">
                    {item.icon}
                    <span className="font-fraunces tracking-tight">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Element 3: Light/Dark Theme Switcher + Stage Scan Action */}
          <div className="order-2 md:order-3 flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setThemePref((prev) => THEME_CYCLE[prev])}
              aria-label={`Theme: ${themePref}. Switch to ${THEME_CYCLE[themePref]}`}
              title={`Theme: ${themePref}`}
              className="px-3 py-2 rounded-lg border font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
                color: 'var(--text-primary)',
              }}
            >
              {themePref === 'auto' ? (
                <Monitor className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              ) : themePref === 'light' ? (
                <Sun className="w-3.5 h-3.5" style={{ color: 'var(--accent-gold)' }} />
              ) : (
                <Moon className="w-3.5 h-3.5" style={{ color: 'var(--accent-crimson)' }} />
              )}
              <span>{themePref}</span>
            </button>

            <AccountButton />

            <MagneticButton
              onClick={() => setLiveOpen(true)}
              title="Find what you're watching and follow it in Immerse"
              className="px-4 py-2 rounded-lg bg-[#9E1B32] hover:bg-[#7F1527] text-[#FAF6F0] font-mono text-[11px] uppercase tracking-[0.12em] flex items-center gap-2 whitespace-nowrap cursor-pointer shadow-sm"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Live</span>
            </MagneticButton>
          </div>
        </div>
      </header>

      {/* 21st.dev Kinetic Architectural Telemetry Ribbon */}
      <KineticTelemetryRibbon items={ribbonTelemetry} />

      {liveOpen && (
        <LiveSheet
          data={timetableData as unknown as TimetableData}
          libretto={(w) => liveMatch(w, liveWorkLinks)?.work_id}
          onOpen={openImmerse}
          onClose={() => setLiveOpen(false)}
        />
      )}

      {/* Main Content Container */}
      <main className={`app-main mx-auto space-y-12 ${activeTab === 'immerse' ? 'max-w-[max(1440px,90vw)]' : 'max-w-[1440px]'}`}>
        {/* TAB 1: LIBRETTO. One search bar for the whole repertoire, then either the live companion (synchronised
            libretto, line meaning, questions, leitmotifs) or the offline repertoire browser. */}
        {activeTab === 'companion' && (
          <div key="tab-companion" className="space-y-10 animate-folio-enter">
            <div className="flex flex-col-reverse lg:flex-row lg:items-center gap-3">
              <div
                role="tablist"
                aria-label="Libretto view"
                className="inline-flex self-start lg:self-auto shrink-0 rounded-xl border p-1"
                style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
              >
                {(
                  [
                    ['feed', 'Feed'],
                    ['live', 'Live libretto'],
                    ['repertoire', 'Repertoire'],
                  ] as const
                ).map(([id, label]) => {
                  const on = librettoView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setLibrettoView(id)}
                      data-href={`/libretto?${new URLSearchParams(id === 'repertoire' && repId ? { view: id, rep: repId } : { view: id })}`}
                      className={`px-4 py-2 rounded-lg font-fraunces text-sm cursor-pointer transition-colors ${on ? 'shadow-sm font-semibold' : 'hover:opacity-80'}`}
                      style={{
                        backgroundColor: on ? 'var(--bg-surface)' : 'transparent',
                        color: on ? 'var(--accent-crimson)' : 'var(--text-secondary)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1 min-w-0">
                <RepertoireSearch
                  query={repQuery}
                  onQuery={setRepQuery}
                  suggest={librettoView !== 'repertoire'}
                  events={timetableEvents}
                  liveWorks={liveWorkLinks}
                  onPick={pickRepertoireWork}
                  onOpenLive={openWork}
                  onBrowseAll={() => setLibrettoView('repertoire')}
                />
              </div>
            </div>

            {librettoView === 'feed' && (
              <FeedView
                data={timetableData as unknown as TimetableData}
                onOpenTaste={() => go('discover', 'taste')}
                onOpenTimetable={() => go('discover', 'events')}
              />
            )}

            {librettoView === 'repertoire' && (
              <RepertoireCatalogue
                query={repQuery}
                pickedId={repId}
                onPick={pickRepertoireWork}
                currentTitle={currentWork.title}
                liveWorks={liveWorkLinks}
                onOpenLive={openWork}
                events={timetableEvents}
                onOpenTimetable={openTimetableFor}
                onOpenVenue={openVenueInTimetable}
                onPlanJourney={({ venueId, eventId, fromHere }) => planJourneyTo(venueId, { eventId, fromHere })}
              />
            )}

            {librettoView === 'live' && (
              <>
                {/* Now playing: where we are in the work, a spoiler-safe catch-up, and the stage */}
                <SpotlightSurface withBorderBeam className="rounded-2xl border p-6 sm:p-8 transition-colors">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    <div className="lg:col-span-7 space-y-5">
                      <div>
                        <p
                          className="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <span style={{ color: 'var(--accent-crimson)' }}>● {currentWork.venue_name}</span>
                          {' · '}Act {currentWork.current_act}, Scene {currentWork.current_scene} · Bar{' '}
                          {currentLine.bar_number}
                        </p>
                        <h1
                          className="font-chronicle text-5xl sm:text-6xl lg:text-[64px] tracking-[-0.03em] leading-[0.98] font-normal"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <BlurTextReveal key={currentWork.work_id} text={currentWork.title} />
                          <span
                            className="block sm:inline font-instrument italic font-normal sm:ml-3 text-4xl sm:text-5xl"
                            style={{ color: 'var(--accent-crimson)' }}
                          >
                            {currentWork.composer}
                          </span>
                        </h1>
                        <p className="font-fraunces italic text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                          {currentWork.scene_title}
                        </p>
                      </div>

                      <div
                        className="grid grid-cols-1 sm:grid-cols-2 gap-6 border-t pt-5"
                        style={{ borderColor: 'var(--border-hairline)' }}
                      >
                        <div className="space-y-1.5">
                          <span
                            className="text-[10px] font-mono uppercase tracking-[0.2em] block font-semibold"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            So far (spoiler-free)
                          </span>
                          <p className="font-fraunces text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {currentWork.synopsis_5min_ago}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <span
                            className="text-[10px] font-mono uppercase tracking-[0.2em] block font-semibold"
                            style={{ color: 'var(--accent-crimson)' }}
                          >
                            On stage now
                          </span>
                          <p className="font-fraunces text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                            {currentWork.happening_now}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-5 space-y-3">
                      <div
                        className="rounded-xl overflow-hidden border"
                        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }}
                      >
                        <canvas
                          ref={stageCanvasRef}
                          width={STAGE_CANVAS_W * STAGE_CANVAS_SCALE}
                          height={STAGE_CANVAS_H * STAGE_CANVAS_SCALE}
                          className="w-full h-auto aspect-[2/1] block"
                        />
                        <div
                          className="px-4 py-2 border-t flex items-center justify-between text-[11px] font-mono"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-hairline)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <span>Stage &amp; audio · {currentLine.timestamp_sec}s</span>
                          <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-emerald)' }}>
                            {Math.round(contextDetection.confidence * 100)}% match
                          </span>
                        </div>
                      </div>

                      {(nearestFountain || nearestToilet) && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {[
                            { label: 'Water refill', node: nearestFountain, color: 'var(--accent-emerald)' },
                            { label: 'Interval WC', node: nearestToilet, color: 'var(--accent-gold)' },
                          ].map(
                            ({ label, node, color }) =>
                              node && (
                                <div key={label} className="min-w-0">
                                  <span
                                    className="text-[10px] font-mono uppercase tracking-[0.16em] block"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    {label}
                                  </span>
                                  <p className="font-fraunces text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                                    {node.name}
                                  </p>
                                  <p className="font-mono text-[11px] tabular-nums" style={{ color }}>
                                    {node.distance_meters}m · {node.walking_mins} min walk
                                  </p>
                                </div>
                              )
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Which auditorium feed the companion is listening to, and the auditorium dimmer */}
                  <div
                    className="mt-6 pt-4 border-t flex flex-wrap items-center gap-2"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  >
                    <span
                      className="text-[10px] font-mono uppercase tracking-[0.18em] mr-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Listening at
                    </span>
                    {STAGE_CONTEXT_PRESETS.map((preset, idx) => {
                      const on = selectedPresetIdx === idx;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          title={preset.label}
                          onClick={() => handleScanStageContext(idx)}
                          className={`px-3 py-1.5 rounded-full text-xs font-mono cursor-pointer border transition-colors ${
                            on ? 'bg-[#9E1B32] text-[#FAF6F0] border-[#9E1B32] font-semibold' : 'hover:opacity-90'
                          }`}
                          style={
                            on
                              ? undefined
                              : {
                                  backgroundColor: 'var(--bg-subtle)',
                                  color: 'var(--text-secondary)',
                                  borderColor: 'var(--border-hairline)',
                                }
                          }
                        >
                          {preset.label.split(' · ')[0]}
                        </button>
                      );
                    })}
                    {isScanningContext && (
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        Listening…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setOledDimMode((v) => !v)}
                      aria-pressed={oledDimMode}
                      className="ml-auto text-[11px] font-mono underline underline-offset-4 cursor-pointer"
                      style={{ color: 'var(--accent-gold)' }}
                    >
                      {oledDimMode ? 'Undim screen' : 'Dim for the auditorium'}
                    </button>
                  </div>
                </SpotlightSurface>

                {/* The synchronised libretto, with the selected line's meaning and questions alongside */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                  <section className="lg:col-span-7 space-y-4 min-w-0">
                    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                      <div>
                        <h2
                          className="font-chronicle text-3xl sm:text-4xl tracking-tight"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          Libretto
                        </h2>
                        <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
                          {currentWork.language} with English · tap a line for its meaning
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setImmerseTarget({ kind: 'libretto', id: currentWork.work_id });
                          go('immerse');
                        }}
                        data-href={immersePath({ kind: 'libretto', id: currentWork.work_id })}
                        className="inline-flex items-center gap-1 text-xs font-mono underline underline-offset-4 cursor-pointer"
                        style={{ color: 'var(--accent-gold)' }}
                      >
                        Full screen <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <ol
                      className="divide-y rounded-xl overflow-hidden border"
                      style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      {currentWork.lines.map((line, idx) => {
                        const isActive = idx === selectedLineIdx;
                        return (
                          <li key={line.line_index} style={{ borderColor: 'var(--border-hairline)' }}>
                            <button
                              type="button"
                              onClick={() => handleExplainLine(idx)}
                              aria-current={isActive || undefined}
                              className="w-full text-left py-5 px-4 sm:px-6 cursor-pointer grid grid-cols-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] gap-x-6 gap-y-2 transition-colors hover:opacity-95"
                              style={{
                                backgroundColor: isActive ? 'var(--bg-subtle)' : 'transparent',
                                borderLeft: `3px solid ${isActive ? 'var(--accent-crimson)' : 'transparent'}`,
                              }}
                            >
                              <span className="font-mono text-xs space-y-0.5">
                                <span
                                  className="uppercase tracking-wider block text-[11px] font-semibold"
                                  style={{ color: isActive ? 'var(--accent-crimson)' : 'var(--text-primary)' }}
                                >
                                  {line.character}
                                </span>
                                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  {line.voice_type} · bar {line.bar_number}
                                </span>
                              </span>
                              <span className="space-y-1.5 min-w-0">
                                <span
                                  className="block font-instrument italic text-2xl sm:text-[28px] leading-[1.18] tracking-[-0.01em]"
                                  style={{ color: 'var(--text-primary)' }}
                                >
                                  “{line.original_text}”
                                </span>
                                <span
                                  className="block font-fraunces text-[15px] leading-relaxed"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {line.literal_english}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>

                  <aside className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
                    {/* What the selected line means */}
                    <SpotlightSurface className="rounded-2xl border p-6 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-crimson)' }} />
                          <h3 className="font-fraunces text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {currentLine.character}, bar {currentLine.bar_number}
                          </h3>
                        </span>
                        {isExplainingLine && (
                          <span className="text-[11px] font-mono" style={{ color: 'var(--accent-gold)' }}>
                            Analysing…
                          </span>
                        )}
                      </div>

                      <div key={`${currentWork.work_id}-${currentLine.bar_number}`} className="space-y-4 animate-folio-enter">
                        <div className="space-y-1">
                          <span
                            className="text-[10px] font-mono uppercase tracking-[0.18em] block font-semibold"
                            style={{ color: 'var(--accent-crimson)' }}
                          >
                            What’s really going on
                          </span>
                          <p className="font-fraunces text-[15px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                            {subtextExplanation?.dramatic_subtext || currentLine.dramatic_subtext}
                          </p>
                        </div>
                        <div className="border-t pt-4 space-y-1" style={{ borderColor: 'var(--border-hairline)' }}>
                          <span
                            className="text-[10px] font-mono uppercase tracking-[0.18em] block"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            In the orchestra
                          </span>
                          <p className="font-instrument italic text-xl leading-snug" style={{ color: 'var(--accent-crimson)' }}>
                            {subtextExplanation?.musical_cue || currentLine.musical_leitmotif}
                          </p>
                          <p className="font-fraunces text-xs leading-relaxed pt-1" style={{ color: 'var(--text-secondary)' }}>
                            {currentWork.character_motivations}
                          </p>
                        </div>
                      </div>
                    </SpotlightSurface>

                    {/* Ask a quiet question (answered by gemini-4-argon) */}
                    <SpotlightSurface className="rounded-2xl border p-6 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <Mic className="w-4 h-4" style={{ color: 'var(--accent-crimson)' }} />
                          <h3 className="font-fraunces text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Ask quietly
                          </h3>
                        </span>
                      </div>

                      <form onSubmit={handleWhisperQuery} className="flex gap-2">
                        <input
                          type="text"
                          value={whisperQuestion}
                          onChange={(e) => setWhisperQuestion(e.target.value)}
                          placeholder="Ask about the plot or the music…"
                          aria-label="Your question"
                          className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg border text-sm font-fraunces focus:outline-none"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            borderColor: 'var(--border-hairline)',
                            color: 'var(--text-primary)',
                          }}
                        />
                        <ArgonButton type="submit" label="Ask" busyLabel="Asking…" busy={isWhispering} className="shrink-0" />
                      </form>

                      {whisperResponse && (
                        <div className="border-t pt-3 space-y-1 animate-folio-enter" style={{ borderColor: 'var(--border-hairline)' }}>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                            Reply · {whisperResponse.model_used}
                          </span>
                          <p className="font-instrument italic text-xl leading-snug" style={{ color: 'var(--text-primary)' }}>
                            “{whisperResponse.answer}”
                          </p>
                          {whisperResponse.aside && (
                            <p className="font-instrument italic text-sm leading-snug pt-1" style={{ color: 'var(--text-secondary)' }}>
                              {whisperResponse.aside}
                            </p>
                          )}
                        </div>
                      )}
                    </SpotlightSurface>
                  </aside>
                </div>

                {/* Leitmotif synthesizer, tucked away until wanted */}
                <details className="group rounded-2xl border" style={{ borderColor: 'var(--border-hairline)' }}>
                  <summary
                    className="cursor-pointer list-none px-6 py-4 flex items-center justify-between gap-3"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span>
                      <span className="font-fraunces text-base font-semibold">Hear the leitmotifs</span>
                      <span className="block text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {currentWork.leitmotifs.length} musical themes from {currentWork.title}, synthesised
                      </span>
                    </span>
                    <span
                      className="text-xs font-mono transition-transform group-open:rotate-90"
                      style={{ color: 'var(--accent-crimson)' }}
                    >
                      ▶
                    </span>
                  </summary>
                  <div className="px-2 pb-2 sm:px-4 sm:pb-4">
                    <LeitmotifAudioSynth work={currentWork} />
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {/* IMMERSE: follow-along for use during a performance (inline, with a full-screen option) */}
        {activeTab === 'immerse' && (
          <ImmerseView
            target={immerseTarget}
            works={works}
            lineIdx={selectedLineIdx}
            onLineChange={setSelectedLineIdx}
            onPick={(t) => {
              setImmerseTarget(t);
              if (t?.kind === 'libretto') {
                setSelectedWorkId(t.id);
                setSelectedLineIdx(0);
              }
            }}
            libretto={(w) => liveMatch(w, liveWorkLinks)?.work_id}
            onOpenLive={() => setLiveOpen(true)}
          />
        )}

        {/* DISCOVER: sidebar (Events · Taste · Agent), each view built from accordion sections */}
        {activeTab === 'discover' && (
          detailPage ? (
            <div key={`page-${detailPage.kind}-${detailPage.id}`} className="animate-folio-enter">
              {detailPage.kind === 'event' ? (
                <EventPage id={detailPage.id} data={timetableData as unknown as TimetableData} themeMode={themeMode} onPlanJourney={planJourneyTo} onShowInTimetable={openVenueInTimetable} />
              ) : detailPage.kind === 'me' ? (
                <MePage section={detailPage.id as MeSection} />
              ) : (
                <VenuePage
                  id={detailPage.id}
                  data={timetableData as unknown as TimetableData}
                  civicNodes={civicNodes}
                  themeMode={themeMode}
                  onPlanJourney={planJourneyTo}
                  onShowInTimetable={openVenueInTimetable}
                />
              )}
            </div>
          ) : (
          <div key="tab-discover" className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-6 lg:gap-8 animate-folio-enter">
            <DiscoverSidebar
              active={discoverView}
              onChange={(v) => go('discover', v)}
            />

            <div className="min-w-0">
              {/* TIMETABLE (scraped venue listings + Luma / Eventbrite on one map with every venue, civic locations, TfL &
                  weather layers and live conditions; and the venue index) */}
              {discoverView === 'events' && (
                <div key="view-events" className="space-y-6 animate-folio-enter">
                  <AccordionSection id="events" eyebrow="Opera · classical · live music · drama · musicals · dance" title="London events">
                    <TimetableView
                      data={timetableData as unknown as TimetableData}
                      civicNodes={civicNodes}
                      liveEvents={liveEvents}
                      works={works}
                      activeVenueId={currentWork.venue_id}
                      openLondonTelemetry={openLondonTelemetry}
                      onRefreshTelemetry={handleRefreshOpenFeeds}
                      refreshingTelemetry={refreshingFeeds}
                      onOpenWork={openWork}
                      onPlanJourney={planJourneyTo}
                      focusRequest={mapFocus}
                      venueRequest={venueRequest}
                    />
                  </AccordionSection>

                  <AccordionSection eyebrow="On the map" title="Opera houses, theatres & venues">
                    <VenueIndex
                      civicNodes={civicNodes}
                      timetable={timetableData as unknown as TimetableData}
                      onPick={(id) => setMapFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))}
                    />
                  </AccordionSection>
                </div>
              )}

              {/* JOURNEY PLANNER (the full tube / rail / bus map from public/tube/ — drawer, lines, stations, live trains,
                  route planning — with every venue and its upcoming shows pinned on top, live London conditions, and a
                  venue index that flies the planner to a pin) */}
              {discoverView === 'journey' && (
                <div key="view-journey" className="space-y-6 animate-folio-enter">
                  <AccordionSection id="journey-planner" eyebrow="Tube, rail & bus · venues & shows in search" title="Journey Planner">
                    <TubeMapEmbed
                      civicNodes={civicNodes}
                      liveEvents={liveEvents}
                      works={works}
                      activeVenueId={currentWork.venue_id}
                      themeMode={themeMode}
                      focus={plannerFocus}
                      timetable={timetableData as unknown as TimetableData}
                      openLondonTelemetry={openLondonTelemetry}
                      onRefreshOpenLondonTelemetry={handleRefreshOpenFeeds}
                      refreshingOpenLondonTelemetry={refreshingFeeds}
                      onOpenTimetable={(venueId) => openVenueInTimetable(venueId)}
                      onOpenWork={openWork}
                    />
                  </AccordionSection>

                  <AccordionSection eyebrow="On the map" title="Opera houses, theatres & venues">
                    <VenueIndex
                      civicNodes={civicNodes}
                      timetable={timetableData as unknown as TimetableData}
                      onPick={(id) => {
                        setPlannerFocus({ id, nonce: Date.now() });
                        document.getElementById('journey-planner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    />
                  </AccordionSection>
                </div>
              )}

              {/* TASTE (saved events + Last.fm taste-profiling & cross-genre event recommender) */}
              {/* SEATING (3D seat plans built from each venue's own booking seat map, with a seat finder, the view from any
                  seat, and the Gemini seat advisor) */}
              {discoverView === 'seating' && (
                <div key="view-seating" className="space-y-6 animate-folio-enter">
                  <AccordionSection eyebrow="Row letters & seat numbers from each venue's booking map" title="Seating plans in 3D">
                    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }} />}>
                      <SeatingView events={timetableEvents} />
                    </Suspense>
                  </AccordionSection>
                </div>
              )}

              {discoverView === 'taste' && (
                <div key="view-taste" className="space-y-6 animate-folio-enter">
                  <AccordionSection eyebrow="Hearted events" title="Taste Profile · saved events">
                    <SavedEventsRail />
                  </AccordionSection>
                  <AccordionSection eyebrow="Last.fm" title="Taste & cross-genre picks">
                    <LastFmTasteBridge />
                  </AccordionSection>
                </div>
              )}

              {/* AGENT (Saint AI autonomous agent & MongoDB Atlas hybrid search lab) */}
              {discoverView === 'agent' && (
                <div key="view-agent" className="space-y-6 animate-folio-enter">
                  <AccordionSection eyebrow="Human-in-the-loop" title="Saint AI event-ingestion agent">
                    <SaintAgentConsole
                      tasks={saintTasks}
                      liveEvents={liveEvents}
                      civicNodes={civicNodes}
                      onIngestUrl={handleSaintIngestUrl}
                      onResolveHitlTask={handleResolveHitlTask}
                      isIngesting={isIngestingUrl}
                    />

                  </AccordionSection>

                  <AccordionSection eyebrow="MongoDB Atlas" title="Hybrid search lab ($rankFusion)">
                    <AtlasHybridSearchLab
                      initialResults={initialHybridResults}
                      streamTelemetry={atlasStream}
                      atlasSpecs={atlasSpecs}
                      searchSource={hybridSource}
                      onRunHybridSearch={handleRunHybridSearch}
                    />
                  </AccordionSection>
                </div>
              )}
            </div>
          </div>
          )
        )}
      </main>

      {/* Phones: primary navigation lives in a thumb-reach bottom tab bar (the header nav shows from md up). */}
      <nav
        aria-label="Main Navigation"
        className="app-tabbar md:hidden fixed bottom-0 inset-x-0 z-50 grid grid-flow-col auto-cols-fr border-t backdrop-blur-xl"
        style={{
          backgroundColor:
            themeMode === 'light' ? 'rgba(250, 246, 240, 0.94)' : 'rgba(12, 10, 14, 0.94)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                go(item.id);
                window.scrollTo({ top: 0 });
              }}
              data-href={pathFor({ tab: item.id, view: discoverView })}
              aria-current={isActive ? 'page' : undefined}
              className="flex flex-col items-center justify-center gap-0.5 py-2 cursor-pointer transition-colors"
              style={{ color: isActive ? 'var(--accent-crimson)' : 'var(--text-secondary)' }}
            >
              {item.icon}
              <span
                className={`text-[11px] font-mono uppercase tracking-wider ${isActive ? 'font-semibold' : ''}`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default App;
