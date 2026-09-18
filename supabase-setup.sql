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

-- Adds the "Promoting officer" column — safe to run even if it already
-- exists. The server fills this in automatically from the logged-in
-- Discord user, so it can't be spoofed from the browser.
alter table promotion_log add column if not exists promoted_by text;

-- ── Row Level Security ──────────────────────────────────────────────
-- Phase 2: the browser (publishable key) may only READ. All writes now
-- go through Vercel API routes using the service_role key, which
-- checks the caller's Discord roles first and then bypasses RLS to
-- perform the write. Run this even if you already ran Phase 1's
-- version — it replaces the old open-write policy.
alter table officers enable row level security;
alter table promotion_log enable row level security;

drop policy if exists "open access officers" on officers;
drop policy if exists "public read officers" on officers;
create policy "public read officers"
  on officers for select
  using (true);

drop policy if exists "open access promotion_log" on promotion_log;
drop policy if exists "public read promotion_log" on promotion_log;
create policy "public read promotion_log"
  on promotion_log for select
  using (true);

-- ── Realtime ─────────────────────────────────────────────────────────
-- Lets every open browser tab see other people's changes live.
alter publication supabase_realtime add table officers;
alter publication supabase_realtime add table promotion_log;
