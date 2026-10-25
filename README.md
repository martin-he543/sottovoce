# sottovoce — London Opera, Theatre & Civic Transit Companion

**sottovoce** (*sotto voce* — "under the voice", and *Sotto* [London Underground] + *Voce* [Voice]) is a unified full-stack monorepo application integrated with the London civic map (`martinhe.co.uk/tube/`).

Built for the **Encode London Hackathon** across three core tracks:
1. **Google DeepMind Pathway 2 (Real World, Hard Tech & Multimodal Creation)**:
   - `gemini-4-argon` (at `thinking_level` "low", its quickest setting) for every text and audio-understanding call: stage/playbill/lyric recognition, British English dramatic subtext translation, the Feed, seat advice, event summaries and autonomous back-office reasoning. `gemini-3.8-flash` is kept only as a fallback if Argon fails.
   - `gemini-3.8-live` & `gemini-3.8-flash-lite-tts` for whispered *Sotto Voce* voice queries and bone-conduction audio cues.
   - `lyria-3-clip-preview` (Lyria 3.5) for 30-second custom orchestral leitmotif primers alongside an interactive Web Audio multi-stem synthesizer.
2. **MongoDB Atlas Challenge (Unified Data Platform)**:
   - 4 unified collections: `works_and_libretti`, `civic_nodes`, `live_events`, and `user_taste_profiles`.
   - Implements **Automated Embedding** (`voyage-3` & `voyage-multimodal-3`), **Atlas Vector Search**, **Atlas Search** (multilingual Italian/French/German/English analyzers + `2dsphere` geospatial), **`$rankFusion` Hybrid Search**, and **Atlas Stream Processing** tumbling telemetry windows.
3. **Saint AI Agent Bounty (Autonomous Back-Office & Event Ingestion Agent with Human-in-the-Loop)**:
   - **Workflow A (Zero-Friction URL & Bandsintown Event Ingestion)**: Scrapes Luma, Bandsintown, Eventbrite, and West End URLs, geocodes against OpenStreetMap, links nearest #OneLess water fountains & public toilets, checks duplicates, and presents a structured diff table with a **1-click Human-in-the-Loop (HITL) approval gate**.
   - **Workflow B (Autonomous Night-Out & Interval Concierge)**: Monitors live Open-Meteo rain radar, air quality, and interval countdowns to stage indoor bar pre-orders and sheltered pedestrian routes behind a 1-click human payment/notification approval gate.

---

## Open Zero-Key Real-World London Data Sources
No proprietary TfL API key is required. All civic and environmental telemetry is powered by open, key-free APIs:
- **Maps & Pedestrian Accessibility**: OpenStreetMap (Overpass / Nominatim) & `martinhe.co.uk/tube/` step-free station metadata.
- **Civic Amenities**: London Datastore (#OneLess drinking water fountains & Westminster public toilets).
- **Live Weather & Air Quality**: Open-Meteo Forecast & European Air Quality API (Breathe London / LAQN NO₂ & PM2.5).
- **River Thames Flood & Tidal Gauges**: UK Environment Agency Real-Time Flood-Monitoring API.
- **Urban Biodiversity**: iNaturalist Open API (live species observations around Covent Garden & St Paul's Churchyard).

---

## Repository Structure
- `/server.ts` — Full-stack Express + WebSocket (`/ws/live`) + MongoDB Atlas + `@google/genai` server.
- `/src/App.tsx` — Unified React + Three.js WebGPU theatre companion & civic map interface.
- `/src/utils/sottovoceEngine.ts` & `/src/utils/sottovoceEngine.test.ts` — Decoupled pure TypeScript engine (Haversine geo distance, Reciprocal Rank Fusion `$rankFusion`, cross-genre Last.fm recommender, Saint AI HITL task builder) and `node:test` test suite.
- `/python_backend/main.py` — FastAPI + `pymongo` + `google-genai` backend reference implementation.
- `/mobile_companion/SottoVoceCompanion.tsx` — React Native OLED mobile companion & multimodal sensor schema.

---

## Deep links
Every page has its own URL, and the query string carries the exact view, so a refresh or a shared link lands where you were:

| Page | Path | Query |
| --- | --- | --- |
| Libretto | `/libretto` | `work`, `line` |
| Immerse | `/immerse` | `work`, `line` (synced libretto), or `rep=<wikidata id>` / `show=<title>` with `at=<venue>` (listen-only) |
| Discover → Events | `/discover/events` | List: `category` (comma list), `range` (`today`/`week`/`month`/`all`), `sort` (`day`/`venue`/`source`, comma list), `venue`, `kind`, `source`, `q` (searches every field by meaning; `"quoted"` or `exact=1` match title, venue and hall literally), `exact`, `map=0`. Map: `location=<lat>,<lng>`, `zoom`, `pin` (open venue popup), `venues=0`, `amenities=0`, `layers` (`bike`,`carpark`,`taxi`,`weather`). Journey Planner: `station` (open panel), `jploc`, `jpzoom`, `jpvenue`, `jpvenues=0`, `jpamenities=0` |
| Discover → Seating | `/discover/seating` | `plan` (seat plan id, e.g. `roh`), `seat` (`<tier>\|<row>\|<number>`, e.g. `Grand Tier\|B\|12`), `event` (Events listing id: prices for that performance) |
| Discover → Taste | `/discover/taste` | |
| Discover → Agent | `/discover/agent` | |

e.g. `/discover/events?location=51.5129,-0.1222&zoom=16&pin=node_venue_roh`. Defaults are omitted from the URL. The old `/discover/map` links still work: they open the Events map at the same view (`venue` becomes `pin`). Route parsing and URL helpers live in `src/utils/urlState.ts`.

## Repertoire: pictures, recordings and London performances
The Libretto tab's repertoire search covers 5,537 operas, operettas and musicals from Wikidata and English Wikipedia (`npm run libretti`, then `npm run libretti:enrich` for thumbnails and pageviews, then `npm run libretti:media`; run them in that order, since each rebuild of an earlier step drops what the later ones added). `libretti:media` (add `-- --popular=100` to cover the top 100 under every popularity sort, all kinds of work; without flags it covers every work) collects the pictures and audio clips embedded in each work's Wikipedia page (arias and overtures from Wikimedia Commons). Nothing is downloaded: the app streams files from Commons by name, and each clip and picture links back to its Commons page for credit. Search suggestions show thumbnails and a clip count, and the sort menu can order by recordings or filter to works that have them.

Each work's page also lists its upcoming **London performances**, matched by title to the Discover Events listings (`src/utils/londonPerformances.ts`: the listing's category must fit the kind of work, and a "Composer: Title" prefix must be the work's composer). The count shows beside each work in search and the list, **London performances** is a sort order, **Only playing in London** is a filter, and **Open in Discover Events** jumps to Events filtered to that title across all dates. Counts follow the bundled timetable snapshot (`npm run timetable`).

## Live and Immerse by ear
The header's **Live** button takes the device's location, finds today's listings at the nearest venues (`src/utils/liveGuess.ts`: distance, how well the start time fits now, and the GPS accuracy) and, when one clearly stands out, offers it with one tap ("Yes, follow this"). With no clear answer (two shows in one building, a poor fix, no location permission) it lists the likeliest listings, and any of the ≈5,500 works can be picked by name. Either way it opens **Immerse** on the work.

Immerse's **Listen** turns the microphone into short clips that `POST /api/live/listen` transcribes, translates and explains with Gemini; where the browser has speech recognition it also captions on-device. For the works with a synced libretto, each transcript is fuzzy-matched to the libretto's lines (`src/utils/lyricMatch.ts`) so the text follows the stage. Every other work opens listen-only: captions, translation and explanations of what was heard, with the Wikipedia synopsis alongside, and nothing made up. Without `GEMINI_API_KEY` only the on-device captions work.

## 3D seating plans
**Discover → Seating** (and **Seats in 3D** on any timetable listing at a covered venue) shows the main London houses in 3D. Every seat is placed where it is on the venue's own booking seat map, with the real row letters, seat numbers, boxes and slips. You can orbit the house, show a tier with the ones above it hidden, find a seat by tier, row and number, or sit in it to see the stage from there. The **seat advisor** sends the whole house (every seat with its distance, angle and height to the stage) to Gemini with a plain-language wish and highlights its picks. Booking stays a click through to the venue.

**Prices.** Every seat has a price (`src/utils/seatPrices.ts`). Apollo Victoria, Lyceum and Palace use the real price bands from their booking maps (one captured performance each). Seats that were sold when the map was captured take the band of the nearest priced seat. Every other venue gets an estimate: its usual full-price range (`TYPICAL_PRICES`) spread over the house by distance and angle to the stage. Pick a performance ("Prices for…", or open the plan from a listing) and the prices are rescaled to that listing's price. **Prices** colours the seats by band, and each band in the legend lights up its seats. Listings with no price show the venue's usual range. The seat advisor gets the prices too, so a budget in the wish works.

Plans live in `public/seatmaps/<id>.json`, one script per venue in `scripts/seatmaps/venues/`. The scripts capture the seat data each venue's "choose your seats" screen loads: Spektrix, Tessitura, ATG, nliven (Delfont Mackintosh, Nederlander), TodayTix/Line-Up TickX and Tixly, plus the National Theatre's own seating-plan PDFs. Most West End and larger London houses read the seating chart TodayTix draws for them: `python3 scripts/seatmaps/capture-todaytix.py <id>=<showId>` saves a chart (needs Python playwright) and `todaytixVenue()` in `scripts/seatmaps/todaytix.mjs` turns it into a plan from a few lines of per-venue config (tier names, heights, stage size). Not covered: flexible rooms whose seating changes with each production (Park, Young Vic, Bush, Old Vic, Dorfman, Kit Kat Club at the Playhouse), venues with unreserved seating, and houses whose booking maps sit behind a bot wall (Donmar, Almeida, Soho Theatre, Fortune). Tier heights, rake and stage sizes are estimates. The Royal Albert Hall's booking site is behind a bot wall, so its plan is traced from a screenshot of the seat map instead: `scripts/seatmaps/trace/rah-trace.py` finds the seats and groups them into tier, block and row (`rah.rows.json`, committed), and `venues/rah.mjs` adds the heights. Its seat positions are real; its seat, row and box numbers are counted off the map in order, because the printed ones are too small to read. The Gallery isn't on the map. `npm run seatmaps` rebuilds them all. Scripts whose source needs a browser session read a capture from `scripts/seatmaps/raw/` (gitignored); each script's header says how to recapture it. `node scripts/seatmaps/preview.mjs <id>` draws a plan flat for checking against the booking site.

## Quick Start
```bash
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm test
npm run dev            # serves on http://localhost:3000 (override with PORT=<port>)
```

---

## Native apps (Tauri 2: Android, iOS, macOS)
The same Vite/React build is wrapped by [Tauri 2](https://tauri.app) (`src-tauri/`), so there is one UI codebase for web, Android (APK), iOS and macOS.

**Backend URL.** Native bundles have no Express server on their own origin. Build with `VITE_API_BASE_URL=https://your-host` so `/api/*` calls go to your deployed `server.ts` (it already allows the Tauri origins via CORS; add more with `CORS_ALLOWED_ORIGINS`). With no URL the app runs on its built-in seed data.

**Prerequisites:** Rust (`rustup`), plus
- Android: Android SDK + NDK, JDK 17, and `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`. Set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME`.
- iOS / macOS: a Mac with Xcode (these cannot be built on Linux).

```bash
npm run app:dev                    # desktop shell against the dev server
npm run app:build                  # macOS .app/.dmg (run on a Mac)
npm run android:apk -- --debug     # debug-signed universal APK -> src-tauri/gen/android/app/build/outputs/apk/
npm run ios:init && npm run ios:build   # on a Mac
```
Release APKs/IPAs need your own signing keys. Replace the placeholder icons with `npx tauri icon path/to/1024.png`.

**Responsive layout.** Phones get a bottom tab bar, notch/home-indicator safe areas, 44px touch targets and 16px inputs (no iOS focus-zoom); tablets and the macOS window use the top nav and resize fluidly down to 400×560.
