# Challenges and bounties entered

**sottovoce** follows opera and musical theatre with you, line by line, and brings London's live listings, venues and seats into one place. Setup is in [SETUP.md](SETUP.md).

**How it was built.** We created the project in **Google AI Studio (Build)** and developed it there extensively with **Gemini 4 Argon**. AI Studio was where we prompted, generated and iterated on most of the app. We then exported it to GitHub and kept developing it locally. `metadata.json` (the AI Studio applet manifest) and the `aistudio-build` user agent in `server.ts` come from that origin.

We are entering:

1. [Google DeepMind: Build with Gemini 4 Argon](#1-google-deepmind-build-with-gemini-4-argon) (Pathway 2: The Real World, Hard Tech & Multimodal Creation)
2. [MongoDB: Build Anything, Change Everything with MongoDB Atlas](#2-mongodb-build-anything-change-everything-with-mongodb-atlas)
3. [Encode Club: The Real World: AI that understands the world around us](#3-encode-club-the-real-world)

We are **not** entering the Saint bounty. The "Saint AI" console in the Agent tab is our own agent powered by Gemini, not a Saint agent.

---

## 1. Google DeepMind: Build with Gemini 4 Argon

**The problem.** People at an opera or a musical in a language they don't speak lose the thread in the dark. Surtitles are far away, missing or only in one language. We built sottovoce for an opera-goer in the stalls who wants to know what is being sung, and why it matters, without staring at their phone.

### Models

| Model | Where and how |
| --- | --- |
| **`gemini-4-argon`** | **Every** AI call in the app goes through one `askGemini()` wrapper in `server.ts`, with `thinking_level: "low"` (Argon's fastest setting) and a timeout. Following the Argon API rules, we never set `temperature`, `top_p`, `top_k` or `thinking_budget`. |
| **Google AI Studio (Build)** | Where we built the app: we created, generated and iterated on it with Argon, then exported it. |

There are no flash fallbacks. When Argon fails, the error is recorded and shown (`/api/state`) instead of being replaced by a canned answer.

### Argon features we use

- **Multimodal audio understanding (Immerse → Listen)** (`POST /api/live/listen`): the browser records short microphone clips and sends them to Argon as `inlineData` audio. Argon transcribes, translates and explains what is being sung. For works with a synced libretto, the transcript is fuzzy-matched to the libretto's lines (`src/utils/lyricMatch.ts`), so the text follows the stage.
- **Image understanding** (`POST /api/context/detect`): a camera frame of the stage or a programme is sent as `inlineData` image. Argon identifies the work, act and scene, using location and audio hints too.
- **Structured output:** 18 endpoints use `responseMimeType: application/json` with a `responseSchema`, so the UI gets typed data (scene IDs, seat picks, event extractions) rather than prose.
- **Long context:** the **3D seat advisor** (`/api/seatmaps/advise`) sends the *whole house* (every seat with its distance, angle, height and price) plus a plain-language wish in one prompt. The **Feed** and **Taste** (`/api/feed/recommend`, `/api/lastfm/recommend`) send a whole Last.fm library and the upcoming London timetable in one prompt.
- **Reasoning over the libretto:** line explanations, translation into British English with the dramatic subtext, character notes, a running commentary and an Argon chat sidebar in Immerse (`/api/libretto/*`, `/api/immerse/*`). We tell Argon not to spoil later acts.
- **Query understanding for search (HyDE):** for "deep" Events search, Argon says what the query is about (the composer behind a piece, the shows a performer is known for) and writes an imagined matching listing. That listing is embedded and searched in Atlas (`src/server/eventSearch.ts`).
- **Agent with a human in the loop:** the event-ingestion agent (`/api/saint/ingest-url`) fetches a Luma, Eventbrite, Bandsintown or venue page. Argon extracts the event, the server geocodes it and finds nearby amenities, and a person approves or rejects it in one click (`/api/saint/approve-hitl`). Nothing is written to the listings without that approval.
- **Low-latency whisper channel:** a `/ws/live` WebSocket for short, hushed replies during a performance.

### Real-world and 3D

It runs on real inputs: live microphone audio, camera frames, GPS (**Live** picks today's nearest performance), real venue seat maps rendered in Three.js, and live London open data.

---

## 2. MongoDB: Build Anything, Change Everything with MongoDB Atlas

MongoDB Atlas (`sottovoce_prod` database) is the backend for search, live updates, accounts and user data. `scripts/atlas/ingest.mjs` loads the London timetable (events and venues) and the 5,500-work repertoire catalogue into it.

### Atlas features used

| Feature | How we use it | Code |
| --- | --- | --- |
| **Atlas Search** | `events_search` and `works_search` indexes. They have `lucene.english` and `lucene.standard` analyzers, `autocomplete` on titles, `stringFacet`/`dateFacet` on category and date, and a `geo` field. Queries use phrase matching and typo tolerance across every field of a listing. | `scripts/atlas/ingest.mjs` (`INDEXES`), `src/server/eventSearch.ts` |
| **Atlas Vector Search** | `events_vector` and `works_vector` indexes: 1024-dimension cosine, with filter fields (`category`, `start`, `kind`). They power meaning-based search and "more like this" (`/api/atlas/similar`). | `src/server/atlasSearch.ts` |
| **Hybrid Search** | Atlas `$search` and `$vectorSearch` results, plus distance rank for geo-tagged events, combined with weighted reciprocal rank fusion. The Events box fuses four lists: keyword, meaning, Argon-related terms and a HyDE concept vector. | `atlasHybridSearch()`, `searchEvents()`; endpoints `/api/atlas/search`, `/api/events/search`, `/api/atlas/hybrid-search` |
| **Voyage AI by MongoDB** | `voyage-4` embeddings (1024 dimensions) from the MongoDB Model API (`ai.mongodb.com/v1/embeddings`). Stored documents use `input_type: document` and live queries use `query`. | `scripts/atlas/ingest.mjs`, `src/server/atlasSearch.ts` |
| **Embedding on insert** | A listing added through `/api/atlas/listing` is embedded with Voyage as it is written, so it is searchable at once. A **TTL index** (`expires_at`) removes demo listings after 15 minutes. | `server.ts` |
| **Change Streams** | `/api/atlas/changes` watches `events` and `live_events` and pushes every insert or update to the browser as Server-Sent Events. | `server.ts` |
| **Geospatial** | `2dsphere` indexes on `events.location` and `venues.location`. | `scripts/atlas/ingest.mjs` |
| **Accounts and user data** | better-auth's MongoDB adapter keeps users, sessions and OAuth accounts in the same database, next to synced saved events, history and taste profiles. | `src/server/auth.ts`, `src/server/userData.ts` |

To be clear about what we did **not** use: hybrid fusion runs in our own code (reciprocal rank fusion over the two Atlas result lists), not through the `$rankFusion` stage. We embed with Voyage ourselves instead of using Atlas Automated Embedding. The "stream telemetry" panel is simulated in the app, not Atlas Stream Processing.

Without `MONGODB_URI` the app runs on an in-memory fallback engine, so the demo still works offline. Atlas is what makes search real at scale.

---

## 3. Encode Club: The Real World

**The problem.** Live performance happens in the physical city: a stage you can't understand, a venue you have to reach, a seat you have to choose, weather at the interval. sottovoce reads all of these:

- **Audio from the room:** microphone clips of the performance → Argon transcription and translation → the matching libretto line. On-device speech recognition adds captions where the browser supports it.
- **Photos:** camera frames of the stage or programme → Argon picks out the work and scene. The surtitle scanner reads surtitles with Tesseract.js OCR in the browser.
- **Location:** **Live** uses GPS, its accuracy and the time of day to guess which of today's performances you are at (`src/utils/liveGuess.ts`). When the answer isn't clear, it asks instead of guessing.
- **Maps and open data, no keys needed:** OpenStreetMap (Overpass, Nominatim), the TfL Unified API (stop points and places), the London Datastore (#OneLess water fountains, public toilets), Open-Meteo weather and air quality, MeteoAlarm warnings, Environment Agency flood gauges, and iNaturalist species sightings near venues.
- **Physical venues:** 3D seating plans built from each venue's real booking seat map, with real rows, numbers, boxes and price bands.

**Handling messy input and being honest about uncertainty.** We expect noisy audio, so transcripts are fuzzy-matched rather than exact. Works without a synced libretto open listen-only: captions, translation and explanation, and nothing made up. Estimated seat prices and tier heights are labelled as estimates. When Gemini fails, the app shows the error instead of a canned answer.

**Privacy.** Location and microphone are used only when you tap **Live** or **Listen**. Audio clips are sent for transcription and not stored. Accounts and sync are optional.
