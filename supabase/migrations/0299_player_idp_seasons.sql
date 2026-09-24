-- player_idp_seasons: one row per defender per season per season type.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (the season build script and the stats cron write)
--   client writes : BLOCKED (no insert/update/delete policy for anon or authenticated)
--
-- WHY. Search needs a relevance gate for defenders (did he play real snaps this
-- season or last), the defender profile needs a career table, and the IDP guide
-- needs season totals by position. All three would otherwise sum weekly rows on
-- every request.
--
-- DERIVED, SO NO metadata AND NO POINTS. Built by lib/idp/seasons.ts from the
-- typed player_stats columns (0296). There is no points column on purpose:
-- points depend on a league's scoring, and the profile re-scores stat lines in
-- the browser per preset. position is the player's primary (players.position)
-- and eligible_positions is copied from players at build time.
--
-- games counts weeks with a defensive snap recorded; games_20_snaps counts the
-- weeks with at least 20 of them, which is the "played a real role" signal the
-- search gate (plan R-15) reads.
--
-- Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-107.

create table if not exists public.player_idp_seasons (
  player_id uuid not null references public.players(id) on delete cascade,
  season integer not null,
  season_type text not null check (season_type in ('regular', 'post', 'pre')),
  position text not null check (position in ('DL', 'LB', 'DB')),
  eligible_positions text[] not null default '{}',
  games integer not null default 0,
  games_20_snaps integer not null default 0,
  avg_def_snap_pct numeric,
  def_snp numeric,
  tm_def_snp numeric,
  idp_tkl numeric,
  idp_tkl_solo numeric,
  idp_tkl_ast numeric,
  idp_tkl_loss numeric,
  idp_sack numeric,
  idp_sack_yd numeric,
  idp_qb_hit numeric,
  idp_int numeric,
  idp_int_ret_yd numeric,
  idp_pass_def numeric,
  idp_pass_def_3p numeric,
  idp_ff numeric,
  idp_fum_rec numeric,
  idp_fum_ret_yd numeric,
  idp_def_td numeric,
  idp_safe numeric,
  idp_blk_kick numeric,
  bonus_tkl_10p numeric,
  bonus_sack_2p numeric,
  computed_at timestamptz not null default now(),
  primary key (player_id, season, season_type)
);

-- The search gate and the guide both read "this position, this season".
create index if not exists idx_player_idp_seasons_season_position
  on public.player_idp_seasons (season, season_type, position);

alter table public.player_idp_seasons enable row level security;

drop policy if exists player_idp_seasons_select_public on public.player_idp_seasons;
create policy player_idp_seasons_select_public on public.player_idp_seasons
  for select to anon, authenticated using (true);

drop policy if exists player_idp_seasons_service_role_all on public.player_idp_seasons;
create policy player_idp_seasons_service_role_all on public.player_idp_seasons
  for all to service_role using (true) with check (true);
