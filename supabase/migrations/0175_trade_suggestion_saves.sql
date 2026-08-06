-- Migration 0175: bookmarked Trade Finder suggestions
--
-- What this backs
--   Trade Finder used to offer one verb: Not interested. That button records a
--   real opinion AND advances to the next deal, so a reader who merely wanted to
--   look past something had to declare it refused, which corrupted the one
--   steering signal the feature has. Navigation now moves through the shortlist
--   on its own, and this table adds the other thing a person wants to do with a
--   deal they like: keep it, and go and offer it later.
--
--   One row per saved suggestion.
--
-- WHY THE WHOLE SUGGESTION IS STORED, NOT JUST ITS KEY
--   trade_suggestion_declines stores only the fingerprint, because a pass only
--   has to answer "have I seen this". A bookmark has to answer "what was it",
--   and the engine cannot be asked again: rosters move, values move nightly, and
--   the package that balanced on Tuesday may not be constructible on Friday. A
--   bookmark that silently turned into a different trade, or vanished, would be
--   worse than no bookmark. So `snapshot` holds the deal exactly as it was
--   shown, and a saved trade renders from it and is never recomputed. This is
--   the same contract signal_check_analyses holds for a frozen permalink.
--
--   `grade` holds the Signal Check verdict at the moment of saving, for the same
--   reason and with the same caveat surfaced in the UI: values as they were.
--
-- WHY NO expires_at
--   A pass is a snooze, so it expires after fourteen days and the reader gets a
--   fresh hearing on a changed roster. A bookmark is a decision to come back to
--   something, and quietly deleting it after a fortnight would be a bug, not a
--   policy. Saved rows live until the reader removes them.
--
-- Access matrix
--   trade_suggestion_saves : service_role ALL.
--                            authenticated SELECT / INSERT / UPDATE / DELETE own
--                            rows only (auth.uid() = user_id, enforced on both
--                            USING and WITH CHECK so a row cannot be inserted or
--                            re-pointed at another user).
--                            anon: nothing at all.
--
--   Owner writes are allowed, as on trade_suggestion_declines, because the row is
--   the reader's own bookmark and carries no privilege. It is only ever read back
--   by the person who wrote it, so the worst a forged row can do is show its
--   author a trade they invented. The server still validates every field against
--   a bounded Zod schema before insert (lib/trade-finder-saves.ts): that is there
--   to stop the column being used as general storage, not to prove provenance.
--
--   UPDATE is granted for one path: saving the same deal twice refreshes
--   `saved_at` and the snapshot via the upsert, rather than failing the unique
--   index and reading as a dead button.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.trade_suggestion_saves;

create table if not exists public.trade_suggestion_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sleeper's own league id, not a leagues.id FK, matching
  -- trade_suggestion_declines. A bookmark is meaningful the moment it is
  -- pressed, and tying it to a row we may not have synced yet buys nothing.
  sleeper_league_id text not null,
  -- The engine's deal fingerprint. Opaque here on purpose: the shape of a
  -- suggestion is a code concern and this table should not need a migration when
  -- the engine learns to build a new package shape.
  suggestion_key text not null,
  -- Denormalised so the saved list can name the league without reading every
  -- leagues row, and so a bookmark still reads correctly for a league that has
  -- since been left or deleted.
  league_name text,
  -- The TradeSuggestion exactly as it was rendered. See the note above.
  snapshot jsonb not null,
  -- The Signal Check grade at save time. Nullable: a grade is skipped whenever
  -- it would be a guess, and a bookmark should not require one.
  grade jsonb,
  saved_at timestamptz not null default now()
);

comment on table public.trade_suggestion_saves is
  'One row per Trade Finder suggestion a user bookmarked. Stores the full suggestion snapshot rather than only its fingerprint, because the engine cannot rebuild an old deal once rosters and values have moved. Owner-readable and owner-writable; anon has no access. No expiry: a bookmark is not a snooze.';

-- The read: this reader''s bookmarks, newest first.
create index if not exists trade_suggestion_saves_lookup_idx
  on public.trade_suggestion_saves (user_id, saved_at desc);

-- Saving the same deal twice refreshes it rather than stacking rows.
create unique index if not exists trade_suggestion_saves_unique
  on public.trade_suggestion_saves (user_id, sleeper_league_id, suggestion_key);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Auto-RLS creates the table with row level security on and zero policies, which
-- blocks everything including the owner. Add the five this table needs.

alter table public.trade_suggestion_saves enable row level security;

drop policy if exists trade_suggestion_saves_service_role_all
  on public.trade_suggestion_saves;
create policy trade_suggestion_saves_service_role_all
  on public.trade_suggestion_saves
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists trade_suggestion_saves_select_own
  on public.trade_suggestion_saves;
create policy trade_suggestion_saves_select_own
  on public.trade_suggestion_saves
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists trade_suggestion_saves_insert_own
  on public.trade_suggestion_saves;
create policy trade_suggestion_saves_insert_own
  on public.trade_suggestion_saves
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- USING decides which rows can be updated, WITH CHECK decides what they may
-- become. Both are needed: without the second, an owner could hand their row to
-- somebody else's user_id.
drop policy if exists trade_suggestion_saves_update_own
  on public.trade_suggestion_saves;
create policy trade_suggestion_saves_update_own
  on public.trade_suggestion_saves
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists trade_suggestion_saves_delete_own
  on public.trade_suggestion_saves;
create policy trade_suggestion_saves_delete_own
  on public.trade_suggestion_saves
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Policies cannot grant what the table-level privileges withhold, so both halves
-- are stated. anon is named explicitly rather than left to inherit nothing.
revoke all on table public.trade_suggestion_saves from anon, authenticated;
grant select, insert, update, delete
  on table public.trade_suggestion_saves to authenticated;
