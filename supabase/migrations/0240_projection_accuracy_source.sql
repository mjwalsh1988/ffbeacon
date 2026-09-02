-- 0240: grade every projection source on the same table, with the same code.
--
-- ACCESS MATRIX (unchanged, re-verified after this migration)
--   anon           SELECT
--   authenticated  SELECT
--   service_role   ALL
--   Existing policies on player_projection_accuracy are preserved. This
--   migration adds one column and re-keys two unique indexes. It creates no
--   policy and drops none, and RLS stays enabled.
--
-- WHY
--
-- This table already answers "how reliable is this player against his
-- projection". It has never had to say WHOSE projection, because there has only
-- ever been Sleeper's.
--
-- Once we publish projections of our own, the single most important question in
-- the whole build is whether ours are better than the ones they replace, and
-- the honest way to answer it is to grade both on the SAME weeks with the SAME
-- code rather than on two dashboards that were built separately and can
-- disagree for reasons nobody can trace. One column does that.
--
-- It also protects the thing that already works. `shrunk_multiplier` is applied
-- to a player's projection by lib/power-pulse/project.ts, and a multiplier
-- measured against Sleeper's projection is only meaningful when applied to
-- Sleeper's projection. Without this column, publishing a second source would
-- silently mix two populations into one reliability figure and the first symptom
-- would be a board that quietly reorders for no football reason.
--
-- DEFAULT 'sleeper' IS THE HONEST BACKFILL
--
-- Every row in this table today was measured against Sleeper's projection, so
-- stamping them 'sleeper' is a statement of fact rather than an assumption. The
-- calc rebuilds the table wholesale on every run anyway (see the delete in
-- runCalculateProjectionAccuracy), so the default matters only for the window
-- between this migration and the next nightly run.
--
-- RE-KEYING
--
-- Both unique indexes have to gain `source` or the second source's rows collide
-- with the first source's on insert. The blended partial index keeps its
-- `where season is null` clause, because that is the row the engine reads and
-- its uniqueness guarantee is what stops two blended rows for one player.

alter table public.player_projection_accuracy
  add column if not exists source text not null default 'sleeper';

alter table public.player_projection_accuracy
  drop constraint if exists player_projection_accuracy_player_id_season_scoring_key;

drop index if exists public.player_projection_accuracy_player_id_season_scoring_key;

create unique index if not exists player_projection_accuracy_player_season_scoring_source_key
  on public.player_projection_accuracy (player_id, season, scoring, source);

drop index if exists public.idx_player_projection_accuracy_blended;

create unique index if not exists idx_player_projection_accuracy_blended
  on public.player_projection_accuracy (player_id, scoring, source)
  where season is null;

drop index if exists public.idx_player_projection_accuracy_lookup;

create index if not exists idx_player_projection_accuracy_lookup
  on public.player_projection_accuracy (source, scoring, season);

comment on column public.player_projection_accuracy.source is
  'Whose projection this row grades. Matches player_weekly_projections.source. A reliability figure measured against one source is only meaningful applied to that same source.';
