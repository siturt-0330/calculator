-- ============================================================
-- Add phone and bio columns to profiles
-- ============================================================
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists bio text check (bio is null or length(bio) <= 200);
