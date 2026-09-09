-- Migration 0279: user_bookmarks + user_preferences.bookmarks_bar_enabled
--
-- The bookmark bar. A signed-in reader saves any page on the site (a league
-- deep view, a draft in On The Clock, a player profile, a Brief story) and gets
-- it back as a one-click row of shortcuts under the header, or as a bottom
-- sheet on a phone.
--
-- USER-OWNED table, one row set per reader, exactly like user_ranking_boards.
-- The `user_` prefix plus the ownership column say that this is the reader's
-- own list rather than anything we ingested.
--
-- NO metadata jsonb, deliberately. The Original Source Object Preservation rule
-- in CLAUDE.md covers tables that ingest an external object, so that we can
-- prove what we received and re-derive fields later. Nothing here comes from
-- outside: a bookmark is a path the reader was standing on and a label they
-- typed. There is no source object to preserve.
--
-- NO icon column, deliberately. The glyph beside each bookmark is derived from
-- the path at render time (lib/bookmarks/icon.ts), so a bookmark saved today
-- picks up tomorrow's icon for the tool it points at. Storing it would freeze
-- one reader's copy of a decision that belongs to the navigation.
--
-- Access matrix:
--   user_bookmarks
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE OWN rows only ((select auth.uid()) = user_id)
--     service_role  : ALL
--   user_preferences.bookmarks_bar_enabled
--     covered by the existing owner-only policies on user_preferences (0008).

create table if not exists public.user_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A SAME-ORIGIN path, always. The check is the database's half of the
  -- defence; lib/bookmarks/path.ts is the authoritative validator and runs
  -- before every write. Both exist because this value ends up in an href:
  --   - must start with a single "/", so "//evil.example" (protocol-relative,
  --     which a browser resolves to another origin) and "https://..." and
  --     "javascript:..." are all rejected
  --   - no whitespace or control characters anywhere
  --   - no backslash, which some browsers normalise to "/"
  path text not null
    check (char_length(path) between 1 and 512)
    check (path = '/' or path ~ '^/[^/]')
    check (path !~ '[[:space:][:cntrl:]]' and strpos(path, chr(92)) = 0),
  label text not null check (char_length(trim(label)) between 1 and 60),
  -- 0-based display order within the reader's own list. Rewritten densely on
  -- every move, so it is a position rather than a sparse weight.
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One bookmark per page per reader. Saving a page that is already saved is
  -- an update, never a second row.
  unique (user_id, path)
);

-- The one read this feature makes: every bookmark for one reader, in order.
create index if not exists idx_user_bookmarks_user_order
  on public.user_bookmarks(user_id, sort_order);

alter table public.user_bookmarks enable row level security;

-- ---------------------------------------------------------------------------
-- Owner-only. `(select auth.uid())` rather than a bare call, so the planner
-- hoists it to an InitPlan and evaluates it once per statement instead of once
-- per row (the same change migration 0274 made across every other policy).
-- ---------------------------------------------------------------------------
drop policy if exists user_bookmarks_select_own on public.user_bookmarks;
create policy user_bookmarks_select_own on public.user_bookmarks
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_bookmarks_insert_own on public.user_bookmarks;
create policy user_bookmarks_insert_own on public.user_bookmarks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_bookmarks_update_own on public.user_bookmarks;
create policy user_bookmarks_update_own on public.user_bookmarks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_bookmarks_delete_own on public.user_bookmarks;
create policy user_bookmarks_delete_own on public.user_bookmarks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_bookmarks_service_role_all on public.user_bookmarks;
create policy user_bookmarks_service_role_all on public.user_bookmarks
  for all to service_role
  using (true)
  with check (true);

comment on table public.user_bookmarks is
  'Saved pages for the bookmark bar. Owner-only; paths are same-origin by check constraint.';

-- ---------------------------------------------------------------------------
-- Whether the bar shows at all. A real preference (the reader turns it off from
-- /my-beacon/bookmarks and it follows them to every device), so it belongs in
-- user_preferences rather than in local storage.
--
-- Whether the bar is MINIMISED is a different question and is not stored here:
-- it is per-device, like the navigation rail's width, and lives in local
-- storage so a blocking script can re-apply it before the first paint.
-- ---------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists bookmarks_bar_enabled boolean not null default true;

comment on column public.user_preferences.bookmarks_bar_enabled is
  'Show the bookmark bar under the header on desktop. Minimised state is per-device and lives in local storage.';
