import { ArgonButton } from './ArgonButton';
import React, { useEffect, useState } from 'react';
import {
  Database,
  Search,
  Code2,
  Copy,
  Check,
  Layers,
} from 'lucide-react';
import type { HybridSearchResult } from '../types/sottovoce';

export interface StreamTelemetryPayload {
  window_timestamp_iso: string;
  tumbling_window_sec: number;
  events: {
    event_id: string;
    title: string;
    venue_name: string;
    current_act: number;
    current_scene: number;
    current_bar: number;
    active_companions: number;
  }[];
  toilets: {
    node_id: string;
    name: string;
    interval_queue_mins: number;
    accessible_step_free: boolean;
  }[];
}

interface AtlasHybridSearchLabProps {
  initialResults: HybridSearchResult[];
  streamTelemetry: StreamTelemetryPayload | null;
  atlasSpecs: Record<string, unknown> | null;
  /** Which engine answered the last search: the live Atlas cluster or the in-memory fallback. */
  searchSource?: 'atlas' | 'in-memory' | null;
  onRunHybridSearch: (
    query: string,
    collectionFilter:
      | 'all'
      | 'works_and_libretti'
      | 'live_events'
      | 'civic_nodes'
      | 'user_taste_profiles'
  ) => Promise<HybridSearchResult[]>;
}

const SAMPLE_HYBRID_QUERIES = [
  {
    label: 'Vissi d’arte tragic prayer & Baron Scarpia brass chords',
    collection: 'works_and_libretti' as const,
  },
  {
    label: 'Step-free drinking water fountain & interval toilet near Covent Garden',
    collection: 'civic_nodes' as const,
  },
  {
    label: 'Choral barricade revolution & redemption in 1832 Paris',
    collection: 'works_and_libretti' as const,
  },
  {
    label: 'Peregrine falcon wildlife & River Thames flood gauge',
    collection: 'civic_nodes' as const,
  },
];

interface ChangeEventPayload {
  at: string;
  collection: string;
  op: string;
  id: string;
  title?: string;
  venue?: string;
}

/** Live MongoDB change stream (server-sent events) plus a form that inserts an embedded listing, so the stream visibly fires. */
const AtlasLivePanel: React.FC = () => {
  const [changes, setChanges] = useState<ChangeEventPayload[]>([]);
  const [live, setLive] = useState(false);
  const [title, setTitle] = useState('Midnight fado and port tasting');
  const [blurb, setBlurb] = useState('Portuguese guitar, wine and candlelight in a basement room.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/atlas/changes');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      try {
        setChanges((prev) => [JSON.parse(m.data) as ChangeEventPayload, ...prev].slice(0, 6));
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch('/api/atlas/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, blurb, venue_id: 'roh', category: 'live_music' }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-[#D4AF37]">
        <span className="flex items-center gap-2">
          <Database className="w-4 h-4" />
          Change stream · events &amp; live_events
        </span>
        <span className={live ? 'text-[#2E8B57]' : 'text-[#6E6A61]'}>{live ? '● live' : '○ offline'}</span>
      </div>
      <form onSubmit={add} className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New listing title"
          className="w-full px-3 py-2 rounded-lg bg-[#0B0C10] border border-[#F4F0EA]/15 text-xs text-[#F4F0EA]"
        />
        <input
          value={blurb}
          onChange={(e) => setBlurb(e.target.value)}
          aria-label="New listing description"
          className="w-full px-3 py-2 rounded-lg bg-[#0B0C10] border border-[#F4F0EA]/15 text-xs text-[#F4F0EA]"
        />
        <button
          type="submit"
          disabled={busy || !live}
          className="w-full py-2 rounded-lg bg-[#1B1E28] text-[#F4F0EA] text-xs font-mono cursor-pointer disabled:opacity-50"
        >
          {busy ? 'Embedding with Voyage…' : 'Insert listing (embeds on write, expires in 15 min)'}
        </button>
      </form>
      <ul className="space-y-1 text-[11px] font-mono text-[#A39E93]">
        {changes.length === 0 && <li>Waiting for changes…</li>}
        {changes.map((c, i) => (
          <li key={`${c.at}-${i}`} className="truncate">
            <span className="text-[#2E8B57]">{c.op}</span> {c.collection} · {c.title ?? c.id}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const AtlasHybridSearchLab: React.FC<AtlasHybridSearchLabProps> = ({
  initialResults,
  streamTelemetry,
  atlasSpecs,
  searchSource,
  onRunHybridSearch,
}) => {
  const [query, setQuery] = useState(SAMPLE_HYBRID_QUERIES[0].label);
  const [collection, setCollection] = useState<
    'all' | 'works_and_libretti' | 'live_events' | 'civic_nodes' | 'user_taste_profiles'
  >('all');
  const [results, setResults] = useState<HybridSearchResult[]>(initialResults);
  const [isSearching, setIsSearching] = useState(false);
  const [copiedSpec, setCopiedSpec] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'atlas' | 'fastapi' | 'reactnative'>('atlas');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    try {
      const res = await onRunHybridSearch(query.trim(), collection);
      setResults(res);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePresetClick = async (
    presetQuery: string,
    presetCollection:
      | 'all'
      | 'works_and_libretti'
      | 'live_events'
      | 'civic_nodes'
      | 'user_taste_profiles'
  ) => {
    setQuery(presetQuery);
    setCollection(presetCollection);
    setIsSearching(true);
    try {
      const res = await onRunHybridSearch(presetQuery, presetCollection);
      setResults(res);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopySpecs = () => {
    navigator.clipboard.writeText(JSON.stringify(atlasSpecs, null, 2));
    setCopiedSpec(true);
    setTimeout(() => setCopiedSpec(false), 2000);
  };

  const totalActiveCompanions =
    streamTelemetry?.events.reduce((acc, ev) => acc + ev.active_companions, 0) || 184;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#F4F0EA]/10 pb-6">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#D4AF37]">
            MongoDB Atlas Challenge · Unified Multimodal &amp; Geospatial Platform
          </p>
          <h2 className="mt-1 font-display text-3xl sm:text-4xl text-[#F4F0EA] tracking-tight">
            Hybrid Search over London's listings and libretti
          </h2>
          <p className="mt-2 text-sm text-[#A39E93] max-w-3xl leading-relaxed">
            Atlas <span className="font-mono text-[#F4F0EA]">$search</span> (fuzzy, boosted BM25) and{' '}
            <span className="font-mono text-[#F4F0EA]">$vectorSearch</span> over{' '}
            <span className="font-mono text-[#F4F0EA]">voyage-4</span> embeddings of 11,903 events and 5,537 works, plus a
            distance rank from the 2dsphere venue location, fused with reciprocal rank fusion. A change stream pushes new
            listings to every open page.
          </p>
        </div>

        <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl px-4 py-3 flex items-center gap-5 text-xs font-mono shrink-0">
          <div>
            <span className="text-[#6E6A61] block text-[10px]">LAST SEARCH SERVED BY</span>
            <span className={searchSource === 'atlas' ? 'text-[#2E8B57] font-semibold' : 'text-[#D4AF37] font-semibold'}>
              {searchSource === 'atlas' ? 'MongoDB Atlas' : searchSource === 'in-memory' ? 'In-memory fallback' : 'Run a query'}
            </span>
          </div>
          <span className="text-[#F4F0EA]/15">·</span>
          <div>
            <span className="text-[#6E6A61] block text-[10px]">INDEXED DOCUMENTS</span>
            <span className="text-[#D4AF37] font-semibold tabular-nums">17,894</span>
          </div>
        </div>
      </div>

      {/* Interactive $rankFusion Search Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F4F0EA]">
                  Interactive $rankFusion Query Runner
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[#A39E93]">RRF k=60</span>
            </div>

            <form onSubmit={handleSearch} className="space-y-4">
              <div>
                <label
                  htmlFor="atlas-collection-select"
                  className="block text-xs font-mono uppercase tracking-wider text-[#A39E93] mb-1.5"
                >
                  Target MongoDB Collection
                </label>
                <select
                  id="atlas-collection-select"
                  value={collection}
                  onChange={(e) =>
                    setCollection(
                      e.target.value as
                        | 'all'
                        | 'works_and_libretti'
                        | 'live_events'
                        | 'civic_nodes'
                        | 'user_taste_profiles'
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0C10] border border-[#F4F0EA]/15 text-xs font-mono text-[#F4F0EA] focus:outline-none focus:border-[#D4AF37]"
                >
                  <option value="all">All 4 Collections ($rankFusion Cross-Collection)</option>
                  <option value="works_and_libretti">
                    works_and_libretti (Libretto + Plot + Leitmotif Embeddings)
                  </option>
                  <option value="civic_nodes">
                    civic_nodes (OSM + London Datastore + Flood + Air + Biodiversity)
                  </option>
                  <option value="live_events">
                    live_events (London Operas, West End &amp; Bandsintown Gigs)
                  </option>
                  <option value="user_taste_profiles">
                    user_taste_profiles (Last.fm Sonic DNA &amp; Voyage-3 Vectors)
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="atlas-query-input"
                  className="block text-xs font-mono uppercase tracking-wider text-[#A39E93] mb-1.5"
                >
                  Multimodal Semantic + Lexical Query
                </label>
                <input
                  id="atlas-query-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0C10] border border-[#F4F0EA]/15 text-xs text-[#F4F0EA] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <ArgonButton type="submit" label="Hybrid search with Argon" busyLabel="Searching Atlas…" busy={isSearching} className="w-full justify-center py-2.5" />
            </form>

            <div className="space-y-2 pt-2 border-t border-[#F4F0EA]/8">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6E6A61]">
                Sample Hybrid Queries
              </span>
              <div className="space-y-1.5">
                {SAMPLE_HYBRID_QUERIES.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePresetClick(preset.label, preset.collection)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-[#0B0C10] hover:bg-[#1B1E28] border border-[#F4F0EA]/8 text-xs text-[#A39E93] hover:text-[#F4F0EA] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span className="truncate">{preset.label}</span>
                    <span className="font-mono text-[10px] text-[#D4AF37] shrink-0">
                      {preset.collection}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <AtlasLivePanel />

          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4AF37]">
              <Layers className="w-4 h-4" />
              <span>What runs on MongoDB Atlas</span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-[#A39E93]">
              <div>
                <strong className="text-[#F4F0EA] font-mono">Atlas Search:</strong> fuzzy, field-boosted lexical
                search behind the Events and Libretto boxes, filtered to upcoming dates.
              </div>
              <div>
                <strong className="text-[#F4F0EA] font-mono">Atlas Vector Search:</strong> cosine search over{' '}
                <span className="font-mono text-[#D4AF37]">voyage-4</span> (1024-d) vectors, and "Similar in London" on
                event pages from a stored embedding.
              </div>
              <div>
                <strong className="text-[#F4F0EA] font-mono">Hybrid search:</strong> lexical + vector + 2dsphere
                distance, fused with RRF in the app (cluster is 8.0, so no native{' '}
                <span className="font-mono">$rankFusion</span>).
              </div>
              <div>
                <strong className="text-[#F4F0EA] font-mono">Voyage AI:</strong> query and document embeddings through
                the MongoDB Model API, including on write.
              </div>
              <div>
                <strong className="text-[#F4F0EA] font-mono">Change streams &amp; TTL:</strong> live feed above; demo
                listings expire on their own.
              </div>
              <div className="text-[#6E6A61]">
                Not real: the live-theatre bar telemetry is simulated, and civic nodes and taste profiles are in memory.
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: $rankFusion Ranked Results & Monorepo Architecture Inspector */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F4F0EA]">
                  Reciprocal Rank Fusion Breakdown
                </h3>
              </div>
              <span className="text-xs font-mono text-[#A39E93]">
                Showing top <strong className="text-[#F4F0EA]">{results.length}</strong> fused hits
              </span>
            </div>

            <div className="space-y-3">
              {results.slice(0, 6).map((item, index) => (
                <div
                  key={item.id}
                  className="bg-[#0B0C10] border border-[#F4F0EA]/10 rounded-lg p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs text-[#D4AF37] font-semibold">
                        #{index + 1}
                      </span>
                      <h4 className="font-display text-xl text-[#F4F0EA]">{item.title}</h4>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-mono tabular-nums">
                      <span className="text-[#2E8B57]">
                        RRF: {item.rrf_score.toFixed(4)}
                      </span>
                      <span className="text-[#6E6A61]">·</span>
                      <span className="text-[#A39E93]">
                        Vec #{item.vector_rank ?? '—'}
                      </span>
                      <span className="text-[#6E6A61]">·</span>
                      <span className="text-[#A39E93]">
                        Lex #{item.lexical_rank ?? '—'}
                      </span>
                      {item.distance_meters !== null && (
                        <>
                          <span className="text-[#6E6A61]">·</span>
                          <span className="text-[#D4AF37]">{item.distance_meters}m</span>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[#A39E93]">{item.subtitle}</p>
                  <p className="text-xs text-[#F4F0EA]/90 font-mono bg-[#13151C] px-3 py-2 rounded border border-[#F4F0EA]/6">
                    {item.snippet}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Monorepo Code & Atlas Index Definition Inspector */}
          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F4F0EA]">
                  Unified Monorepo Specs (Atlas JSON · FastAPI Python · React Native)
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveCodeTab('atlas')}
                  className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${
                    activeCodeTab === 'atlas'
                      ? 'bg-[#D4AF37] text-[#0B0C10] font-semibold'
                      : 'bg-[#0B0C10] text-[#A39E93]'
                  }`}
                >
                  Atlas $rankFusion JSON
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCodeTab('fastapi')}
                  className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${
                    activeCodeTab === 'fastapi'
                      ? 'bg-[#D4AF37] text-[#0B0C10] font-semibold'
                      : 'bg-[#0B0C10] text-[#A39E93]'
                  }`}
                >
                  python_backend/main.py
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCodeTab('reactnative')}
                  className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${
                    activeCodeTab === 'reactnative'
                      ? 'bg-[#D4AF37] text-[#0B0C10] font-semibold'
                      : 'bg-[#0B0C10] text-[#A39E93]'
                  }`}
                >
                  mobile_companion/SottoVoce.tsx
                </button>
                <button
                  type="button"
                  onClick={handleCopySpecs}
                  className="px-2.5 py-1 rounded bg-[#1B1E28] text-[#F4F0EA] text-xs font-mono flex items-center gap-1 cursor-pointer"
                >
                  {copiedSpec ? (
                    <Check className="w-3.5 h-3.5 text-[#2E8B57]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedSpec ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <pre className="bg-[#0B0C10] border border-[#F4F0EA]/10 rounded-lg p-4 text-[11px] font-mono text-[#A39E93] overflow-x-auto max-h-72 leading-relaxed">
              {activeCodeTab === 'atlas' &&
                JSON.stringify(
                  atlasSpecs || {
                    index_name: 'sottovoce_hybrid_index',
                    embedding_model: 'voyage-3 (1024-dim) + voyage-multimodal-3',
                    pipeline: '$rankFusion (vectorPipeline + lexicalAndGeoPipeline)',
                  },
                  null,
                  2
                )}
              {activeCodeTab === 'fastapi' &&
                `# /python_backend/main.py — FastAPI + PyMongo + Google GenAI SDK
from fastapi import FastAPI
from google import genai
from pymongo import MongoClient

app = FastAPI(title="sottovoce Multimodal & MongoDB Atlas Engine")
ai_client = genai.Client() # Uses GEMINI_API_KEY
# Never set thinking_budget, temperature, top_p, or top_k on gemini-4-argon
@app.post("/api/context/detect")
async def detect_stage_context(lat: float, lng: float, lyric_snippet: str):
    response = ai_client.models.generate_content(
        model="gemini-4-argon",
        contents=f"GPS ({lat}, {lng}) | Lyric: {lyric_snippet}"
    )
    return {"analysis": response.text}`}
              {activeCodeTab === 'reactnative' &&
                `// /mobile_companion/SottoVoceCompanion.tsx — React Native OLED Theatre Buddy
// Streams 16kHz PCM whisper audio to /ws/live (gemini-3.8-live)
// Renders zero-glare #0B0C10 OLED cards for bone-conduction earpieces
export const SottoVoceMobileCompanion = () => {
  // Zero-Click GPS + Camera Frame + 5s Audio Snippet -> /api/context/detect
  // 1-Click Saint AI Interval Drink & Route HITL Approval
};`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
