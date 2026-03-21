# shopthevlog

> Discover travel vlogs. Plan your trip. Book everything in one place.

shopthevlog lets you connect your YouTube and Instagram accounts, get a personalised feed of travel vlogs matching your taste, then generate a shoppable day-by-day itinerary from the vlog — with flights and hotels booked directly via Duffel.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS (glass morphism) |
| Backend | Python FastAPI |
| Auth + DB | Supabase (Postgres + Auth) |
| AI | Claude `claude-sonnet-4-6` (itinerary) + OpenAI Whisper (transcription) |
| Booking | Duffel API (flights + hotels) |
| Deploy | Vercel (frontend) + Render (backend) |

## Getting Started

### Prerequisites
- Node.js >= 20
- Python >= 3.11
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- ffmpeg (for audio processing)

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # fill in Supabase keys
npm run dev                 # → http://localhost:5173
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in all API keys
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/docs
```

### Database

```bash
# Apply migrations via Supabase CLI
supabase db push
# OR paste supabase/migrations/001_initial_schema.sql into the Supabase SQL editor
```

## Project Structure

```
shopthevlog/
├── frontend/          # React + Vite + Tailwind
├── backend/           # FastAPI
└── supabase/
    └── migrations/    # Postgres schema + RLS policies
```

## Environment Variables

See `frontend/.env.example` and `backend/.env.example`.
