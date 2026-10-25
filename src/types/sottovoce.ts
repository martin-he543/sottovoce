export type CivicNodeType =
  | 'tfl_station'
  | 'public_toilet'
  | 'water_fountain'
  | 'theatre_venue'
  | 'air_weather_station'
  | 'thames_flood_gauge'
  | 'wildlife_sanctuary';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat] per MongoDB 2dsphere specification
}

export interface LibrettoLine {
  line_index: number;
  bar_number: number;
  timestamp_sec: number;
  character: string;
  voice_type: string;
  original_text: string;
  language: 'Italian' | 'French' | 'German' | 'Latin' | 'English';
  literal_english: string;
  dramatic_subtext: string;
  musical_leitmotif: string;
  leitmotif_id: string;
  stage_blocking: {
    actor: string;
    x: number;
    z: number;
    posture: string;
  }[];
}

export interface LeitmotifStem {
  id: string;
  name: string;
  character: string;
  key_signature: string;
  tempo_bpm: number;
  orchestration: string;
  dramatic_meaning: string;
  lyria_prompt: string;
  notes_hz: number[];
  rhythm_sec: number[];
}

export interface CharacterNode {
  name: string;
  role: string;
  voice_type: string;
  faction: string;
  current_objective: string;
  color: string;
}

export interface WorkAndLibretto {
  _id: string;
  work_id: string;
  title: string;
  composer: string;
  librettist: string;
  language: 'Italian' | 'French' | 'German' | 'Latin' | 'English';
  venue_id: string;
  venue_name: string;
  current_act: number;
  current_scene: number;
  scene_title: string;
  setting_description: string;
  synopsis_5min_ago: string;
  happening_now: string;
  character_motivations: string;
  stage_design_style: 'baroque_palazzo' | 'revolving_barricade' | 'neoclassical_columns' | 'industrial_dock';
  characters: CharacterNode[];
  leitmotifs: LeitmotifStem[];
  lines: LibrettoLine[];
  voyage_embedding_model: 'voyage-3' | 'voyage-multimodal-3';
  semantic_tags: string[];
  sonic_mood_descriptors: string[];
  similar_modern_artists: string[];
}

export interface CivicNode {
  _id: string;
  node_id: string;
  name: string;
  category: CivicNodeType;
  location: GeoPoint; // [lng, lat]
  borough: string;
  address: string;
  source_layer:
    | 'OpenStreetMap & martinhe.co.uk/tube/'
    | 'London Datastore'
    | 'Open-Meteo & LAQN Air Quality'
    | 'Environment Agency Flood API'
    | 'iNaturalist & GBIF';
  accessible_step_free: boolean;
  opening_hours: string;
  interval_queue_mins?: number;
  tfl_lines?: string[];
  tfl_status?: 'Good Service' | 'Minor Delays' | 'Severe Delays' | 'Part Suspended';
  tfl_delay_reason?: string;
  water_pressure?: 'High Flow' | 'Chilled Refill' | 'Standard';
  environmental_reading?: string;
  species_observed?: string;
  notes: string;
}

export interface LiveEvent {
  _id: string;
  event_id: string;
  title: string;
  work_id: string;
  event_category: 'opera' | 'musical_theatre' | 'bandsintown_gig' | 'chamber_luma';
  source_platform:
    | 'Royal Ballet & Opera'
    | 'West End API'
    | 'Bandsintown'
    | 'Luma'
    | 'Eventbrite'
    | 'Ticketmaster'
    | 'Viagogo'
    | 'Operabase'
    | 'Saint URL Drop';
  source_url: string;
  venue_name: string;
  location: GeoPoint;
  start_time_iso: string;
  interval_time_iso: string;
  current_act: number;
  current_scene: number;
  current_bar: number;
  attendee_count: number;
  ticket_status: string;
  nearest_tube_station: string;
  nearest_osm_walk_route: string;
  nearest_water_fountain: string;
  nearest_toilet: string;
  outdoor_weather_aqi: string;
  sonic_tags: string[];
  status: 'live_on_map' | 'pending_hitl_approval';
}

/** A real upcoming timetable event picked for a listener's Last.fm taste. */
export interface TastePick {
  event_id: string;
  title: string;
  category: string;
  venue_name: string;
  start: string;
  time_known: boolean;
  url?: string;
  image?: string;
  price?: string;
  source: string;
  why: string;
  matched: string[];
  /** 'ai' = chosen by Gemini; 'match' = literal artist/title match; 'category' = fallback pick. */
  basis: 'ai' | 'match' | 'category';
  /** The full timetable listing and its venue, so the UI can offer every link (book, venue, map, seats). */
  event?: import('../data/timetableCategories').TimetableEvent;
  venue?: import('../data/timetableCategories').TimetableVenue;
}

export interface UserTasteProfile {
  _id: string;
  lastfm_username: string;
  display_name: string;
  total_scrobbles: number;
  now_playing_track?: {
    artist: string;
    track: string;
    album: string;
  };
  top_artists: {
    name: string;
    playcount: number;
    mbid: string;
    tags: string[];
    bandsintown_london_date?: string;
    bandsintown_venue?: string;
  }[];
  loved_tracks: {
    artist: string;
    track: string;
  }[];
  /** 'lastfm' = scraped from the live public profile (all-time); otherwise bundled sample data. */
  source?: 'seed' | 'lastfm';
  top_albums?: { name: string; artist: string; playcount: number; url: string }[];
  top_tracks?: { name: string; artist: string; playcount: number; url: string }[];
  sonic_dna: {
    harmonic_complexity: number; // 0-100
    orchestral_density: number; // 0-100
    dramatic_intensity: number; // 0-100
    tempo_volatility: number; // 0-100
  };
  dominant_mood_tags: string[];
  voyage_taste_embedding_model: 'voyage-3';
}

export interface CrossGenreRecommendation {
  event_id: string;
  work_id: string;
  title: string;
  event_category: LiveEvent['event_category'];
  venue_name: string;
  source_platform: LiveEvent['source_platform'];
  rrf_match_score: number;
  matching_lastfm_artists: string[];
  shared_sonic_tags: string[];
  why_you_will_love_this_pitch: string;
  nearest_tube_and_walk: string;
  start_time_iso: string;
}

export interface MultimodalContextOutput {
  work_id: string;
  production_title: string;
  venue_name: string;
  act: number;
  scene: number;
  current_bar: number;
  current_line_index: number;
  confidence: number;
  acoustic_fingerprint_match: string;
  visual_stage_match: string;
  synopsis_so_far: string;
  happening_now: string;
  character_motivations: string;
  subtext_explanation: string;
  nearest_amenities: {
    node_id: string;
    name: string;
    category: CivicNodeType;
    distance_meters: number;
    walking_mins: number;
    queue_or_status: string;
  }[];
}

export interface HybridSearchResult {
  id: string;
  collection: 'works_and_libretti' | 'civic_nodes' | 'live_events' | 'user_taste_profiles';
  title: string;
  subtitle: string;
  snippet: string;
  rrf_score: number;
  lexical_rank: number | null;
  vector_rank: number | null;
  geo_rank: number | null;
  distance_meters: number | null;
  metadata: Record<string, string | number | boolean>;
}

export interface SaintHitlTask {
  task_id: string;
  workflow_type: 'url_event_ingestion' | 'night_out_concierge';
  created_at_iso: string;
  status: 'pending_human_approval' | 'approved_live' | 'rejected';
  source_url?: string;
  summary_title: string;
  proposed_action_label: string;
  financial_or_public_impact: string;
  agent_steps_log: string[];
  diff_fields: {
    field: string;
    before: string;
    after: string;
    confidence: string;
  }[];
  linked_civic_nodes: {
    walk_route: string;
    toilet: string;
    water_fountain: string;
    weather_air_flood: string;
  };
  draft_event?: LiveEvent;
  whatsapp_group_preview?: string;
}

export interface OpenLondonLiveTelemetry {
  fetched_at_iso: string;
  weather: {
    source: string;
    temperature_c: number;
    precipitation_mm: number;
    wind_speed_kmh: number;
    condition_summary: string;
  };
  air_quality: {
    source: string;
    pm2_5: number;
    no2: number;
    european_aqi: number;
    band: string;
  };
  flood_monitoring: {
    source: string;
    station_name: string;
    river_name: string;
    water_level_m: number;
    tidal_status: string;
  };
  wildlife: {
    source: string;
    recent_observations: {
      species: string;
      scientific_name: string;
      place_guess: string;
      observed_on: string;
    }[];
  };
  tfl_unified?: {
    source: string;
    stop_point_id: string;
    stop_point_name: string;
    lines_status: {
      line_id: string;
      line_name: string;
      status_severity: string;
      reason?: string;
    }[];
    place_types_found: {
      id: string;
      common_name: string;
      place_type: string;
      lat: number;
      lon: number;
      additional_info: string;
    }[];
  };
  weather_warnings?: {
    source: string;
    warnings: {
      severity: string;
      event: string;
      headline: string;
      area: string;
      expires_iso?: string;
    }[];
  };
  rail_disruptions?: {
    source: string;
    disrupted_count: number;
    total_count: number;
    lines: {
      line_name: string;
      status_severity: string;
      reason?: string;
    }[];
  };
}


/** One stage work in the offline repertoire catalogue (public/libretti/index.json, built by `npm run libretti`). */
export interface RepertoireWork {
  /** Wikidata id, e.g. "Q192941". */
  id: string;
  title: string;
  kind: 'opera' | 'operetta' | 'musical';
  /** Finer form from Wikidata: opera buffa, zarzuela, rock opera, jukebox musical… */
  genre: string;
  composers: string[];
  librettists: string[];
  lyricists: string[];
  year: number | null;
  premiere_venue: string | null;
  languages: string[];
  based_on: string[];
  /** Number of Wikipedia language editions covering the work: a rough "how often is this staged" signal. */
  popularity: number;
  /** One or two sentences from the Wikipedia lead, for list cards. */
  summary: string;
  has_synopsis: boolean;
  roles_count: number;
  wikipedia_url: string;
  /** Added by `npm run libretti:enrich`: lead image path under upload.wikimedia.org/wikipedia/commons/thumb/. */
  thumb?: string | null;
  /** Wikipedia's short description, e.g. "Opera by Georges Bizet". */
  tagline?: string | null;
  /** Wikitext size of the English article, in bytes: a rough "how much is written about it" signal. */
  article_length?: number;
  /** English Wikipedia pageviews over the last 12 full months / the last 3 of them. */
  views_12m?: number;
  views_3m?: number;
  /** Added by `npm run libretti:media`: how many pictures and audio clips the Wikipedia page carries (files are in the details shard). */
  image_count?: number;
  audio_count?: number;
  /** Blended popularity percentile (0–1), computed in the browser when the index loads. */
  score?: number;
}

export interface RepertoireIndex {
  generated_at: string;
  count: number;
  shards: number;
  source: string;
  license_note: string;
  /** Set once `npm run libretti:enrich` has run: the pageview months behind `views_12m`. */
  views_window?: { start: string; end: string };
  /** Set once `npm run libretti:media` has run: when the pictures and recordings were collected. */
  media_at?: string;
  works: RepertoireWork[];
}

/** A picture on the work's Wikipedia page: `f` is the Wikimedia Commons file name, `c` its caption. */
export interface RepertoireImage {
  f: string;
  w: number;
  h: number;
  c: string;
  by: string;
  lic: string;
}

/** A recording on the work's Wikipedia page (an aria, overture or excerpt): `f` is the Commons file name, `d` its length in seconds. */
export interface RepertoireAudio {
  f: string;
  t: string;
  d: number;
  by: string;
  lic: string;
}

/** The long-form text for a work, stored in public/libretti/details/<id number % shards>.json. */
/** A public-domain complete score on IMSLP; `page` is the scan's IMSLP file page. */
export interface RepertoireScore {
  kind: 'vocal' | 'full';
  file: string;
  desc: string;
  publisher: string;
  place: string;
  year?: number;
  lang: string;
  editor: string;
  translator: string;
  arranger: string;
  note: string;
  page: string;
}

export interface RepertoireDetail {
  lead: string;
  synopsis: { heading: string | null; text: string }[];
  roles: { name: string; voice: string | null; premiere_cast: string | null }[];
  numbers: { heading: string | null; items: string[] }[];
  premiere_date: string | null;
  book: string | null;
  lyrics: string | null;
  productions: string | null;
  awards: string | null;
  /** Added by `npm run libretti:media`. */
  media?: { images: RepertoireImage[]; audio: RepertoireAudio[] };
  /** Added by `node scripts/libretto/scores.mjs`: public-domain scans on IMSLP. */
  scores?: { imslp: string; files: RepertoireScore[] };
}

/** A full libretto from public/libretti/texts/<id>.json: acts, then scenes, then lines as [speaker, text, kind]. */
export interface LibrettoText {
  id: string;
  title: string;
  /** Only on works missing from the repertoire (ids starting `libretti-`), which have no catalogue entry to name it. */
  composer?: string;
  /** Machine translation to English, one string per sung line in reading order (public/libretti/translations). Absent until loaded. */
  en?: string[];
  /** English for the act headings, scene titles and scene settings (public/libretti/translations/scenes). */
  scenesEn?: { a: string[]; t: string[]; d: string[] };
  language: LibrettoLine['language'];
  form: string | null;
  source: string;
  source_url: string;
  acts: {
    heading: string;
    scenes: { title: string; description: string; lines: [who: string, text: string, kind: 'sung' | 'dir'][] }[];
  }[];
}

/** public/libretti/texts/index.json: which repertoire works have a full libretto, and how big it is. */
export interface LibrettoTextIndex {
  generated_at: string;
  count: number;
  works: Record<string, { acts: number; scenes: number; lines: number; language: string; source: string; title?: string; composer?: string }>;
}
