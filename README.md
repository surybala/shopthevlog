# TripMirror

A creator-first travel vlog commerce platform. Creators connect their YouTube/TikTok channels, and the platform automatically transcribes their vlogs, generates AI-powered day-by-day trip itineraries (Trip Kits), and attaches affiliate links so viewers can book the same hotels, tours, and experiences they see on screen.

---

## Architecture

```
shopthevlog/
├── apps/
│   └── web/               # Next.js 14 App Router — frontend + API routes
└── backend/               # Python FastAPI — AI pipeline + social integrations
```

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| Auth | Supabase Auth SSR (`@supabase/ssr`) |
| Database ORM | Prisma 7 with `@prisma/adapter-pg` |
| Database | PostgreSQL (via Supabase) |
| AI Pipeline | Python FastAPI + Gemini Flash 2.5 + OpenAI Whisper |
| State | Zustand (client), TanStack Query (server state) |
| Rate Limiting | In-process sliding window (Next.js) |

---

## Repository Layout

```
apps/web/
├── app/
│   ├── api/
│   │   ├── affiliate-links/         # POST create, GET search links
│   │   ├── auth/youtube/            # OAuth connect + callback
│   │   ├── auth/tiktok/             # OAuth connect + callback
│   │   ├── creator/profile/         # GET/PATCH creator profile
│   │   ├── creator/scan/            # POST trigger catalog scan
│   │   ├── kits/                    # POST create TripKit
│   │   ├── kits/[id]/               # GET/PATCH/DELETE single kit
│   │   ├── kits/[id]/days/          # POST add day
│   │   ├── kits/[id]/days/[dayId]/  # PATCH/DELETE day
│   │   └── kits/[id]/days/[dayId]/activities/  # CRUD activities
│   └── dashboard/
│       ├── vlogs/                   # Vlog list + processing trigger UI
│       └── kits/                    # TripKit editor (ItineraryEditor)
├── lib/
│   ├── validate.ts                  # Input validation helpers
│   ├── rateLimit.ts                 # Sliding-window rate limiter
│   ├── prisma/client.ts             # Prisma singleton
│   └── supabase/                    # Supabase SSR client helpers
├── __tests__/
│   ├── validate.test.ts             # 42 unit tests for validate.ts
│   └── rateLimit.test.ts            # 22 unit tests for rateLimit.ts
└── prisma/schema.prisma             # Full data model

backend/
├── app/
│   ├── api/v1/
│   │   ├── vlogs.py                 # GET /vlogs, POST /vlogs/{id}/process, GET /vlogs/{id}/status
│   │   ├── feed.py                  # Discovery feed
│   │   ├── social.py                # YouTube/TikTok/Instagram OAuth
│   │   └── webhooks.py              # POST /webhooks/scan/trigger
│   ├── services/
│   │   ├── claude_service.py        # Gemini Flash 2.5 — TripKit generation
│   │   ├── transcription_service.py # Whisper transcription
│   │   └── youtube_service.py       # YouTube Data API helpers
│   ├── tasks/
│   │   └── process_vlog.py          # Background pipeline: transcribe → generate
│   ├── core/
│   │   ├── config.py                # pydantic-settings Settings
│   │   ├── security.py              # JWT verification (Supabase JWKS + HS256 fallback)
│   └── db/
│       └── pg_client.py             # psycopg2 PgClient context manager
└── tests/
    ├── conftest.py                  # FakePgClient, env var setup
    ├── test_kit_service.py          # 17 tests — Gemini TripKit generation
    ├── test_process_vlog.py         # 12 tests — transcribe→generate pipeline
    └── test_vlogs_api.py            # 20 tests — vlogs API endpoints
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL 15+ (or a Supabase project)
- ffmpeg (for Whisper transcription)

### 1. Clone & install

```bash
git clone https://github.com/your-org/shopthevlog.git
cd shopthevlog
```

**Frontend:**
```bash
cd apps/web
npm install
```

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Environment variables

**`apps/web/.env.local`**
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

YOUTUBE_CLIENT_ID=your-youtube-client-id
YOUTUBE_CLIENT_SECRET=your-youtube-client-secret

TIKTOK_CLIENT_KEY=your-tiktok-client-key
TIKTOK_CLIENT_SECRET=your-tiktok-client-secret

AI_PIPELINE_URL=http://localhost:8000
```

**`backend/.env`**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key

YOUTUBE_API_KEY=your-youtube-data-api-key

APP_ENV=development
CORS_ORIGINS=http://localhost:3000
```

### 3. Database

Run Prisma migrations from the web app:
```bash
cd apps/web
npx prisma migrate deploy
npx prisma generate
```

### 4. Run locally

```bash
# Terminal 1 — Next.js
cd apps/web
npm run dev

# Terminal 2 — FastAPI
cd backend
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:3000`.

---

## Key Features

### TripKit Generation Pipeline

When a creator clicks **Generate Kit** on a vlog:

1. `POST /api/vlogs/[id]/process` (Next.js) — verifies ownership and proxies to FastAPI with the user's JWT
2. `POST /api/v1/vlogs/{id}/process` (FastAPI) — marks vlog `QUEUED`, spawns background task
3. `process_vlog_task` — calls `transcribe_vlog` (Whisper via yt-dlp) then `generate_trip_kit` (Gemini)
4. `generate_trip_kit` — sends transcript to **Gemini Flash 2.5**, parses structured JSON itinerary, writes `TripKit` + `ItineraryDay` + `DayActivity` rows, marks vlog `COMPLETE`

The frontend polls `GET /api/vlogs/[id]/status` every 5 seconds while `processingStatus` is in progress.

If primary JSON parsing fails, a compact fallback prompt is tried automatically. If both fail, the vlog is marked `FAILED` and can be retried.

### Itinerary Editor

After a TripKit is generated (or created manually), creators can:
- Add / remove / reorder days
- Edit each day's title, city, and country inline
- Add activities with time, type (10 types with emoji icons), title, description, and GPS coordinates
- Attach affiliate links to any activity — paste a URL and the provider is auto-detected

### Affiliate Links

- `POST /api/affiliate-links` — validates URL, auto-detects provider from domain (Booking.com, GetYourGuide, Viator, Klook, Airbnb, Amazon, Skyscanner, etc.), generates a cryptographically-random 7-char `shortCode`
- `GET /api/affiliate-links?q=...` — fuzzy-search creator's links by name/URL (max 100 chars)

### Channel Scanning

1. Creator connects YouTube via OAuth 2.0 (CSRF-protected with session-bound state)
2. `POST /api/creator/scan` triggers `runScan` in the background
3. Paginates through the uploads playlist, upserts all videos as `Vlog` records with `processingStatus: PENDING`
4. Optionally pings the AI pipeline to start processing immediately

---

## Security

| Control | Implementation |
|---|---|
| Authentication | Supabase JWT — FastAPI verifies via JWKS (ES256/RS256) with HS256 fallback |
| OAuth CSRF | YouTube and TikTok callbacks verify `state` param matches the authenticated user's session before processing the auth code |
| Short code randomness | `crypto.randomBytes(6).toString('base64url')` — not `Math.random()` |
| Input validation | `lib/validate.ts` — length limits, URL scheme checks (`http`/`https` only), handle format `[a-z0-9_-]`, enum membership |
| Rate limiting | Next.js sliding-window Map |
| Ownership checks | All vlog/kit mutations join on `creator.userId` so users only access their own data |
| SQL injection | All queries use psycopg2 parameterized `%s` — no string interpolation |

---

## Running Tests

### Backend (pytest)

```bash
cd backend
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pytest tests/test_kit_service.py tests/test_process_vlog.py tests/test_vlogs_api.py -v
```

All external calls are mocked — no real DB, Gemini, or Whisper calls:

| File | Tests | Coverage |
|---|---|---|
| `test_kit_service.py` | 17 | Gemini TripKit generation, fallback, JSON parsing, DB writes, slugify |
| `test_process_vlog.py` | 12 | Pipeline guards, transcription failures, exception safety |
| `test_vlogs_api.py` | 20 | All vlog endpoints — auth, ownership, status transitions, query params |

### Frontend (vitest)

```bash
cd apps/web
npm test
```

| File | Tests | Coverage |
|---|---|---|
| `validate.test.ts` | 42 | Every validation helper — boundary conditions, error messages, edge cases |
| `rateLimit.test.ts` | 22 | Sliding-window — allow/block, per-user isolation, fake-timer window expiry |

---

## Data Model Highlights

| Model | Purpose |
|---|---|
| `Creator` | Platform account linked to Supabase user; holds YouTube/TikTok channel IDs |
| `Vlog` | YouTube/TikTok video with `ProcessingStatus` lifecycle (`PENDING` → `QUEUED` → `TRANSCRIBING` → `EXTRACTING` → `COMPLETE`) |
| `TripKit` | AI-generated (or manually built) travel guide; published or gated behind access tier |
| `ItineraryDay` | One day of an itinerary with an ordered list of activities |
| `DayActivity` | Single activity (accommodation, food, transport, etc.) with optional affiliate link |
| `AffiliateLink` | Tracked deep-link with 7-char `shortCode`, provider detection, and click analytics |
| `ClickEvent` | Immutable click record for commission attribution and dashboard analytics |

---

## Environment Variables Reference

| Variable | Where | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | both | ✅ | PostgreSQL connection string |
| `SUPABASE_URL` | both | ✅ | Supabase project URL |
| `SUPABASE_JWT_SECRET` | backend | ✅ | JWT signing secret for HS256 fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | both | ✅ | Service role key for server-side Supabase calls |
| `GEMINI_API_KEY` | backend | ✅ | Google Gemini API key for TripKit generation |
| `OPENAI_API_KEY` | backend | ✅ | OpenAI API key for Whisper transcription |
| `YOUTUBE_CLIENT_ID` / `SECRET` | both | for YouTube OAuth | |
| `TIKTOK_CLIENT_KEY` / `SECRET` | web | for TikTok OAuth | |
| `AI_PIPELINE_URL` | web | ✅ | URL of the FastAPI backend |
| `APP_ENV` | backend | | `development` enables Swagger UI at `/docs` |
| `WHISPER_LOCAL_ENABLED` | backend | | `true` to use local Whisper model instead of OpenAI API |
| `WHISPER_LOCAL_MODEL` | backend | | `tiny` / `base` / `small` / `medium` / `large` |
