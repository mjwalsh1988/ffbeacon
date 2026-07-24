-- #4 (performance): materialize the three fantasy-point bases as real columns on
-- player_stats so the profile weekly-stats read no longer ships the full metadata
-- jsonb per week just to pull three numbers. The raw payload stays in metadata
-- (data-preservation rule intact); these columns are a denormalized read cache.
--
-- Access matrix unchanged: columns inherit the table's existing RLS
-- (public SELECT, service-role writes). No policy changes needed.
--
-- Nullable: a stat row whose payload never carried a points key stays NULL, and
-- readers coalesce NULL -> 0 (mirrors readPoints() in lib/player-profile.ts). We
-- do NOT fabricate 0 at the column level so "Sleeper never published this" stays
-- distinguishable from a real 0.
--
-- The backfill below was applied to production in one pass (verified 0 divergent
-- rows vs readPoints() semantics: stats-object-present-but-key-missing never
-- falls back to root). On a 284k-row table it runs a few minutes; safe to re-run
-- (idempotent, sets the same values).

alter table public.player_stats
  add column if not exists pts_ppr numeric,
  add column if not exists pts_half_ppr numeric,
  add column if not exists pts_std numeric;

-- Backfill from the preserved metadata. api.sleeper.com nests the stat map under
-- `.stats`; the legacy flat payload put keys at the root. Prefer nested, fall
-- back to root, exactly like readPoints() in lib/player-profile.ts.
update public.player_stats
set
  pts_ppr = coalesce(
    nullif(metadata -> 'stats' ->> 'pts_ppr', '')::numeric,
    nullif(metadata ->> 'pts_ppr', '')::numeric
  ),
  pts_half_ppr = coalesce(
    nullif(metadata -> 'stats' ->> 'pts_half_ppr', '')::numeric,
    nullif(metadata ->> 'pts_half_ppr', '')::numeric
  ),
  pts_std = coalesce(
    nullif(metadata -> 'stats' ->> 'pts_std', '')::numeric,
    nullif(metadata ->> 'pts_std', '')::numeric
  )
where metadata is not null;

comment on column public.player_stats.pts_ppr is 'Denormalized fantasy points (PPR base) copied from metadata at sync time. Raw payload remains authoritative in metadata.';
comment on column public.player_stats.pts_half_ppr is 'Denormalized fantasy points (Half PPR base) copied from metadata at sync time.';
comment on column public.player_stats.pts_std is 'Denormalized fantasy points (Standard base) copied from metadata at sync time.';
