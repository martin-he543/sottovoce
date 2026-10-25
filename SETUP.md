# sottovoce: README and setup

**sottovoce** is a companion for opera and musical theatre in London. It has a library of 5,500+ operas, operettas and musicals with libretti, synopses, pictures and recordings. During a performance it listens to the stage, finds the line being sung and lights it up with a translation. Between acts it explains the plot and characters. It also covers London's listings, venues and seats: an events timetable with hybrid search, a civic map built from open data, and 3D seating plans with a Gemini seat advisor.

**How it was built.** We created the project in **Google AI Studio (Build)** and developed it there extensively with **Gemini 4 Argon** (`gemini-4-argon`). Most of the app was prompted, generated and iterated on with Argon inside AI Studio. We later exported it from AI Studio to this GitHub repository and kept developing it locally. You can still see where it came from: `metadata.json` is the AI Studio applet manifest, the server sends an `aistudio-build` user agent, and `GEMINI_API_KEY` in `.env.example` is the key AI Studio injects at runtime.

The full feature tour (deep links, repertoire, Immerse, 3D seating, native apps) is in [README.md](README.md). This file covers what you need to run the project.

---

## Requirements

**JUST PLUG THIS INTO YOUR LLM**

- **Node.js 22+** and npm (Bun also works: there is a `bun.lock`)
- A **Gemini API key**: required for every AI feature
- A **MongoDB Atlas** cluster and a **MongoDB Model API (Voyage AI)** key, for Atlas search, accounts and sync
- Optional: Python 3 + Playwright, only for re-capturing some seat maps (`scripts/seatmaps/`)
- Optional: Rust + Android SDK / Xcode, only for the native Tauri apps (see [README.md](README.md#native-apps-tauri-2-android-ios-macos))

## 1. Install

```bash
git clone https://github.com/martin-he543/sottovoce.git
cd sottovoce
npm install
```

## 2. Fill in `.env`

Copy the template, then edit `.env`. The file is gitignored, so never commit real keys.

```bash
cp .env.example .env
```

Only `GEMINI_API_KEY` is needed to run the app. Every other variable turns on one more feature, and the app falls back cleanly when it is empty.

### Required

| Variable           | What to put                                                                                                         | Where to get it                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | Your Gemini API key. Replace the placeholder `MY_GEMINI_API_KEY`: the server treats the placeholder as "not set". | [Google AI Studio → Get API key](https://aistudio.google.com/apikey). (When the app runs inside AI Studio, AI Studio injects it from your secrets.) |
| `APP_URL`        | The URL the app is served at. Keep `http://localhost:3000` locally. Use the public URL when deployed.             | —                                                                                                                                                  |

Without `GEMINI_API_KEY` the app still runs on its seed data, but listening, translation, explanations, the Feed and the seat advisor are off.

### MongoDB Atlas (search, live updates, accounts)

| Variable           | What to put                                                                                                                          | Where to get it                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`    | Your Atlas connection string, `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`                 | Atlas → your cluster → **Connect** → **Drivers**. Under **Network Access**, allow your IP (or `0.0.0.0/0` for a demo). |
| `VOYAGE_API_KEY` | A **MongoDB Model API** key (Voyage AI by MongoDB). The code calls `https://ai.mongodb.com/v1/embeddings` with `voyage-4`. | Atlas → **AI Models / Voyage AI** → create an API key                                                                                 |

Without `MONGODB_URI`, the server uses its built-in in-memory search and geo engine. Without `VOYAGE_API_KEY`, the Atlas search endpoints return nothing and the app falls back to local fuzzy search.

### Accounts (sign-in and cross-device sync, needs `MONGODB_URI`)

| Variable                                        | What to put                               | Where to get it                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                          | A long random string that signs sessions  | `openssl rand -base64 32`                                                                                                                                                                                         |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional: turns on "Continue with Google" | Google Cloud Console → **APIs & Services → Credentials → OAuth client ID** (Web). Authorised redirect URI: `{APP_URL}/api/auth/callback/google`, e.g. `http://localhost:3000/api/auth/callback/google` |

### Optional integrations

| Variable                                                              | Turns on                                                                                                 | Where to get it                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LASTFM_API_KEY`, `LASTFM_DEFAULT_USER`                           | The **Taste** tab and personalised Feed, from a Last.fm listening history                          | [last.fm/api/account/create](https://www.last.fm/api/account/create). Set `LASTFM_DEFAULT_USER` to the profile to load first.                      |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                      | Track search and an embedded player in the Spotify dock                                                  | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)                                                                           |
| `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID`, `SKIDDLE_API_KEY` | Extra sources for `npm run timetable` (each is skipped when empty)                                     | [Ticketmaster](https://developer.ticketmaster.com/), [SeatGeek](https://seatgeek.com/account/develop), [Skiddle](https://www.skiddle.com/api/join.php) |
| `TFL_APP_KEY`                                                       | Higher rate limits on the TfL Unified API (it works without a key)                                       | [api-portal.tfl.gov.uk](https://api-portal.tfl.gov.uk/)                                                                                              |
| `CORS_ALLOWED_ORIGINS`                                              | Extra comma-separated origins allowed to call `/api`                                                   | —                                                                                                                                                  |
| `VITE_API_BASE_URL`                                                 | **Build-time only.** The backend URL the native Tauri apps call. Leave it empty for the web build. | Your deployed server URL                                                                                                                            |

The civic data (OpenStreetMap, Open-Meteo weather and air quality, Environment Agency flood gauges, iNaturalist, TfL, London Datastore) needs **no keys**.

### Example: a minimal `.env`

```dotenv
GEMINI_API_KEY="AIza...your-key..."
APP_URL="http://localhost:3000"
```

### Example: a full demo `.env`

```dotenv
GEMINI_API_KEY="AIza..."
APP_URL="http://localhost:3000"
MONGODB_URI="mongodb+srv://sottovoce:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"
VOYAGE_API_KEY="al-..."
BETTER_AUTH_SECRET="<output of openssl rand -base64 32>"
LASTFM_API_KEY="..."
LASTFM_DEFAULT_USER="your-lastfm-username"
```

## 3. Load MongoDB Atlas (optional, once)

With `MONGODB_URI` and `VOYAGE_API_KEY` set, load the bundled listings, venues and works into the `sottovoce_prod` database. This step embeds them with Voyage (`voyage-4`, 1024 dimensions) and creates the Atlas Search and Vector Search indexes:

```bash
node scripts/atlas/ingest.mjs          # load, embed (resumable) and create indexes
node scripts/atlas/status.mjs          # check document and embedding counts and index status
```

Wait until `status.mjs` shows every index as `READY` / queryable before you try search.

## 4. Run

```bash
npm test         # unit tests (node:test via tsx)
npm run dev      # Express + Vite + WebSocket server on http://localhost:3000
```

If port 3000 is taken, run `PORT=3001 npm run dev`. Grant microphone, camera and location permissions in the browser to use **Live**, **Listen** and the map.

Other scripts:

| Command                                                           | What it does                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run build` / `npm start`                                 | Production build, then serve it                              |
| `npm run lint`                                                  | Type-check (`tsc --noEmit`)                                |
| `npm run timetable`                                             | Rebuild the London events snapshot from venue sites and APIs |
| `npm run libretti` → `libretti:enrich` → `libretti:media` | Rebuild the repertoire catalogue (in this order)             |
| `npm run seatmaps`                                              | Rebuild the 3D seating plans                                 |
| `npm run app:dev`, `npm run android:apk`, …                  | Native Tauri apps (see README)                               |

## Repository layout

| Path                                                                 | What's there                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts`                                                        | Express API, `/ws/live` WebSocket, Gemini calls, MongoDB connection                                                                  |
| `src/server/`                                                      | Atlas hybrid search (`atlasSearch.ts`, `eventSearch.ts`), better-auth on MongoDB (`auth.ts`), synced user data (`userData.ts`) |
| `src/`                                                             | React + Three.js front end (`App.tsx`, `components/`, `utils/`)                                                                  |
| `scripts/atlas/`                                                   | Atlas ingest, index and status scripts                                                                                                 |
| `scripts/timetable/`, `scripts/libretto/`, `scripts/seatmaps/` | Data pipelines for listings, the repertoire and seat maps                                                                              |
| `public/`                                                          | Libretti, seat maps and other static data                                                                                              |
| `src-tauri/`                                                       | Tauri 2 shell for Android, iOS and macOS                                                                                               |
| `python_backend/`, `mobile_companion/`                           | Reference FastAPI backend and React Native companion                                                                                   |
| `metadata.json`                                                    | Google AI Studio applet manifest (from the original AI Studio project)                                                                 |

## Troubleshooting

- **"GEMINI_API_KEY not set" in responses:** the key is missing or still the placeholder. Restart `npm run dev` after editing `.env`.
- **"MongoDB Atlas URI not reachable" at startup:** check the URI and your Atlas IP access list. The app keeps running on its in-memory engine.
- **Search returns no Atlas results:** check that `VOYAGE_API_KEY` is set and that `node scripts/atlas/status.mjs` shows the indexes as ready.
- **Google sign-in fails:** the redirect URI in Google Cloud must match `{APP_URL}/api/auth/callback/google` exactly.
