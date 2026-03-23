-- Add provider column to bookings (e.g. 'duffel', 'liteapi', 'unknown')
alter table public.bookings
  add column if not exists provider text;
