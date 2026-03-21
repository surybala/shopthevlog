-- ============================================================
-- shopthevlog — Initial Schema
-- Apply via: Supabase SQL editor or `supabase db push`
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ============================================================
-- PROFILES  (extends Supabase auth.users 1:1)
-- ============================================================
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  avatar_url      text,
  bio             text,
  onboarded       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- TASTE PREFERENCES
-- ============================================================
create table public.taste_preferences (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  travel_styles   text[] not null default '{}',
  destinations    text[] not null default '{}',
  trip_durations  text[] not null default '{}',
  budget_range    text check (budget_range in ('budget', 'mid', 'luxury')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(user_id)
);

create trigger taste_prefs_updated_at
  before update on public.taste_preferences
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- SOCIAL CONNECTIONS
-- ============================================================
create table public.social_connections (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  platform            text not null check (platform in ('youtube', 'instagram')),
  platform_user_id    text not null,
  platform_username   text,
  access_token        text,
  refresh_token       text,
  token_expires_at    timestamptz,
  scopes              text[],
  connected_at        timestamptz not null default now(),
  unique(user_id, platform)
);

-- ============================================================
-- VLOGS
-- ============================================================
create table public.vlogs (
  id                  uuid primary key default uuid_generate_v4(),
  platform            text not null check (platform in ('youtube', 'instagram')),
  platform_video_id   text not null,
  title               text not null,
  description         text,
  thumbnail_url       text,
  video_url           text,
  channel_name        text,
  channel_id          text,
  duration_seconds    integer,
  published_at        timestamptz,
  view_count          bigint,
  like_count          bigint,
  language            text default 'en',
  destinations        text[] not null default '{}',
  travel_styles       text[] not null default '{}',
  raw_transcript      text,
  processing_status   text not null default 'pending'
    check (processing_status in ('pending', 'transcribing', 'planning', 'ready', 'failed')),
  processing_error    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(platform, platform_video_id)
);

create index vlogs_destinations_gin   on public.vlogs using gin(destinations);
create index vlogs_travel_styles_gin  on public.vlogs using gin(travel_styles);
create index vlogs_processing_status  on public.vlogs(processing_status);
create index vlogs_published_at       on public.vlogs(published_at desc);

create trigger vlogs_updated_at
  before update on public.vlogs
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- VLOG INTERACTIONS
-- ============================================================
create table public.vlog_interactions (
  id                          uuid primary key default uuid_generate_v4(),
  user_id                     uuid not null references public.profiles(id) on delete cascade,
  vlog_id                     uuid not null references public.vlogs(id) on delete cascade,
  action                      text not null check (action in ('view', 'like', 'save', 'share', 'book_started')),
  duration_watched_seconds    integer,
  created_at                  timestamptz not null default now(),
  unique(user_id, vlog_id, action)
);

-- ============================================================
-- ITINERARIES
-- ============================================================
create table public.itineraries (
  id                    uuid primary key default uuid_generate_v4(),
  vlog_id               uuid not null references public.vlogs(id) on delete cascade,
  title                 text not null,
  summary               text,
  total_days            integer,
  destinations          text[] not null default '{}',
  estimated_budget_usd  integer,
  claude_model          text,
  prompt_version        text,
  raw_claude_response   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(vlog_id)
);

create trigger itineraries_updated_at
  before update on public.itineraries
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- ITINERARY DAYS
-- ============================================================
create table public.itinerary_days (
  id              uuid primary key default uuid_generate_v4(),
  itinerary_id    uuid not null references public.itineraries(id) on delete cascade,
  day_number      integer not null,
  location        text,
  title           text,
  description     text,
  created_at      timestamptz not null default now()
);

create index itinerary_days_itinerary_id on public.itinerary_days(itinerary_id);

-- ============================================================
-- ITINERARY ACTIVITIES
-- ============================================================
create table public.itinerary_activities (
  id                  uuid primary key default uuid_generate_v4(),
  day_id              uuid not null references public.itinerary_days(id) on delete cascade,
  order_index         integer not null default 0,
  type                text not null check (type in ('activity', 'meal', 'accommodation', 'transport', 'note')),
  name                text not null,
  description         text,
  location_name       text,
  lat                 numeric(9, 6),
  lng                 numeric(9, 6),
  estimated_cost_usd  integer,
  duration_minutes    integer,
  booking_url         text,
  image_url           text,
  created_at          timestamptz not null default now()
);

create index itinerary_activities_day_id on public.itinerary_activities(day_id, order_index);

-- ============================================================
-- TRIPS
-- ============================================================
create table public.trips (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  itinerary_id    uuid references public.itineraries(id),
  vlog_id         uuid references public.vlogs(id),
  name            text not null,
  status          text not null default 'planning'
    check (status in ('planning', 'booked', 'completed', 'cancelled')),
  start_date      date,
  end_date        date,
  traveller_count integer not null default 1,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index trips_user_id on public.trips(user_id, created_at desc);

create trigger trips_updated_at
  before update on public.trips
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- BOOKINGS
-- ============================================================
create table public.bookings (
  id                          uuid primary key default uuid_generate_v4(),
  trip_id                     uuid not null references public.trips(id) on delete cascade,
  user_id                     uuid not null references public.profiles(id) on delete cascade,
  booking_type                text not null check (booking_type in ('flight', 'hotel')),
  duffel_order_id             text,
  duffel_booking_reference    text,
  status                      text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'failed')),
  total_amount                numeric(10, 2),
  currency                    text default 'USD',
  passenger_details           jsonb,
  search_params               jsonb,
  duffel_response             jsonb,
  booked_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index bookings_user_id  on public.bookings(user_id, created_at desc);
create index bookings_trip_id  on public.bookings(trip_id);

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- FEED CACHE
-- ============================================================
create table public.feed_cache (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  vlog_id         uuid not null references public.vlogs(id) on delete cascade,
  score           numeric(6, 4) not null default 0,
  reason_tags     text[] not null default '{}',
  shown           boolean not null default false,
  created_at      timestamptz not null default now(),
  unique(user_id, vlog_id)
);

create index feed_cache_user_score on public.feed_cache(user_id, score desc) where shown = false;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles              enable row level security;
alter table public.taste_preferences     enable row level security;
alter table public.social_connections    enable row level security;
alter table public.vlog_interactions     enable row level security;
alter table public.trips                 enable row level security;
alter table public.bookings              enable row level security;
alter table public.feed_cache            enable row level security;

-- Vlogs, itineraries, days, activities: readable by all authenticated users
alter table public.vlogs                   enable row level security;
alter table public.itineraries             enable row level security;
alter table public.itinerary_days          enable row level security;
alter table public.itinerary_activities    enable row level security;

create policy "vlogs_read"        on public.vlogs                 for select using (auth.role() = 'authenticated');
create policy "itineraries_read"  on public.itineraries           for select using (auth.role() = 'authenticated');
create policy "itin_days_read"    on public.itinerary_days        for select using (auth.role() = 'authenticated');
create policy "itin_acts_read"    on public.itinerary_activities  for select using (auth.role() = 'authenticated');

-- Users can only access their own data
create policy "profiles_select"  on public.profiles           for select  using (auth.uid() = id);
create policy "profiles_update"  on public.profiles           for update  using (auth.uid() = id);

create policy "taste_all"         on public.taste_preferences  for all    using (auth.uid() = user_id);
create policy "social_all"        on public.social_connections for all    using (auth.uid() = user_id);
create policy "interactions_all"  on public.vlog_interactions  for all    using (auth.uid() = user_id);
create policy "trips_all"         on public.trips              for all    using (auth.uid() = user_id);
create policy "bookings_all"      on public.bookings           for all    using (auth.uid() = user_id);
create policy "feed_all"          on public.feed_cache         for all    using (auth.uid() = user_id);

-- Service role bypasses RLS (used by backend)
-- (Supabase service role key auto-bypasses RLS — no additional policy needed)
