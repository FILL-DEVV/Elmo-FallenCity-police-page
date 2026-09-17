-- Callsign Log — Supabase schema + policies
-- Run this in Supabase: Project → SQL Editor → New query → paste → Run

-- ── Officers table ──────────────────────────────────────────────────
-- Holds every officer row across every "bucket" (shared executive tier,
-- each division, and terminated). list_key mirrors the app's in-memory
-- structure: 'shared' | 'general' | 'highway' | 'tou' | 'crime' | 'terminated'
create table if not exists officers (
  id text primary key,
  list_key text not null,
  callsign text,
  rank text,
  unit text,
  discord text,
  promo text,
  time text,
  fto text,
  notes text,
  checklist jsonb default '{}'::jsonb,
  created bigint,
  inserted_at timestamptz default now()
);

-- ── Promotion log table ─────────────────────────────────────────────
create table if not exists promotion_log (
  id text primary key,
  name text,
  callsign text,
  from_rank text,
  from_division text,
  to_rank text,
  to_division text,
  date text,
  created bigint
);

-- ── Row Level Security ──────────────────────────────────────────────
-- Phase 1 = open access: anyone with the publishable key can read/write.
-- (Phase 2 will replace these policies with Discord-role checks.)
alter table officers enable row level security;
alter table promotion_log enable row level security;

drop policy if exists "open access officers" on officers;
create policy "open access officers"
  on officers for all
  using (true)
  with check (true);

drop policy if exists "open access promotion_log" on promotion_log;
create policy "open access promotion_log"
  on promotion_log for all
  using (true)
  with check (true);

-- ── Realtime ─────────────────────────────────────────────────────────
-- Lets every open browser tab see other people's changes live.
alter publication supabase_realtime add table officers;
alter publication supabase_realtime add table promotion_log;
