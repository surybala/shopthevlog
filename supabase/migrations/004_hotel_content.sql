-- Migration 004: Hotel content cache
-- Stores enriched hotel photos and reviews fetched from Google Places / Foursquare.
-- Acts as the persistent L2 cache for hotel_content_service.py.
-- hotel_id is the LiteAPI raw hotel ID and is the stable lookup key.

CREATE TABLE IF NOT EXISTS hotel_content (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id         text NOT NULL UNIQUE,              -- LiteAPI hotel ID
  hotel_name       text,
  lat              float8,
  lng              float8,
  photos           jsonb DEFAULT '[]'::jsonb NOT NULL, -- [{url: string}, ...]
  reviews          jsonb DEFAULT '[]'::jsonb NOT NULL, -- [{author, rating, title, text, date, source}, ...]
  review_score     float8,                            -- aggregate 0–10 scale
  review_count     integer,
  source           text,                              -- 'google' | 'foursquare' | null
  created_at       timestamptz DEFAULT now() NOT NULL,
  last_enriched_at timestamptz DEFAULT now() NOT NULL -- when we last called external APIs
);

CREATE INDEX IF NOT EXISTS hotel_content_hotel_id_idx ON hotel_content(hotel_id);

-- Row-level security: table is backend-only; service role has unrestricted access.
ALTER TABLE hotel_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON hotel_content
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE hotel_content IS
  'Persistent cache of hotel photos and reviews from Google Places / Foursquare. '
  'Refreshed when last_enriched_at is older than 7 days. '
  'Photos and reviews are accumulated (union on refresh, never deleted).';
