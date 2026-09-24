-- Typed columns for individual defensive player (IDP) stats on player_stats.
--
-- Access matrix: unchanged. player_stats keeps the policies it already has
-- (player_stats_select_public for anon and authenticated reads,
-- player_stats_service_role_all for writes). No new table, so no new policy.
--
-- WHY. Every defender's weekly line from 2020 on is already stored, but only
-- inside metadata.stats. No typed column exists, and the stats mapper writes 0
-- into the offensive counting columns for a defender. The finishes rebuild, the
-- IDP season table, the projection accuracy grader and the defender profile all
-- need to read tackles and sacks without unpacking jsonb per row.
--
-- NULL MEANS ABSENT, NEVER ZERO. A column is null when Sleeper did not emit the
-- key for that week (an offensive player, or a defender who did not record the
-- stat). The mapper follows the same rule as the nullable snap columns: a
-- missing key is not a zero, and a zero Sleeper did emit is kept.
--
-- The names are Sleeper's keys verbatim. They describe the stat itself (a solo
-- tackle is a solo tackle whoever counts it), not a source's product, so the
-- naming rule's source-name ban does not bite. def_snap_pct is derived
-- (def_snp / tm_def_snp) the same way snap_pct is for offense.
--
-- Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-104.

alter table public.player_stats
  add column if not exists def_snp numeric,
  add column if not exists tm_def_snp numeric,
  add column if not exists def_snap_pct numeric,
  add column if not exists idp_tkl numeric,
  add column if not exists idp_tkl_solo numeric,
  add column if not exists idp_tkl_ast numeric,
  add column if not exists idp_tkl_loss numeric,
  add column if not exists idp_sack numeric,
  add column if not exists idp_sack_yd numeric,
  add column if not exists idp_qb_hit numeric,
  add column if not exists idp_int numeric,
  add column if not exists idp_int_ret_yd numeric,
  add column if not exists idp_pass_def numeric,
  add column if not exists idp_pass_def_3p numeric,
  add column if not exists idp_ff numeric,
  add column if not exists idp_fum_rec numeric,
  add column if not exists idp_fum_ret_yd numeric,
  add column if not exists idp_def_td numeric,
  add column if not exists idp_safe numeric,
  add column if not exists idp_blk_kick numeric,
  add column if not exists bonus_tkl_10p numeric,
  add column if not exists bonus_sack_2p numeric;

-- Defender reads are always "this season's defender weeks"; offense never sets
-- def_snp, so the partial index stays small.
create index if not exists idx_player_stats_def_weeks
  on public.player_stats (season, week)
  where def_snp is not null;
