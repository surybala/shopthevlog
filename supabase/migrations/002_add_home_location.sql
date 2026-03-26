-- ============================================================
-- Add home_location to taste_preferences
-- ============================================================
alter table public.taste_preferences
  add column if not exists home_location text;
