-- Migration 0191: draft_value_targets
--
-- Access matrix:
--   anon          : SELECT     (public: this is the published product; the draft
--                               guide renders it)
--   authenticated : SELECT     (same)
--   service_role  : ALL        (rebuilt nightly by lib/draft-value/build.ts)
--
-- WHY
-- The Beacon Steals board: one row per (format, season, player) answering whether
-- the market is letting that player fall past where FF Beacon would take him.
--
-- THE COLUMN THAT MATTERS IS beacon_pick, AND IT IS NOT overall_rank.
-- rankings.overall_rank is a CROSS-POSITION VALUE rank. ADP is a SCARCITY PRICE.
-- Comparing them directly flags every quarterback in every single-QB format,
-- because nobody spends pick 50 on QB8 no matter how good he is (measured: six of
-- the top twelve raw-gap hits in redraft PPR were QBs). beacon_pick is built on a
-- pick ladder derived from points above a REPLACEMENT STARTER, which prices
-- scarcity the same way a draft room does, blended with the value ladder by
-- league type. value_gap is market_adp minus beacon_pick, so both sides are pick
-- numbers and the comparison is honest.
--
-- Sign convention matches lib/on-the-clock/adp.ts: POSITIVE means taken later
-- than expected, which is value. A number means the same thing here and in the
-- live draft room.
--
-- confidence exists because the raw gap is largest exactly where both inputs are
-- least reliable. It decays with market depth and value depth, and it multiplies
-- into steal_score so an uncertain deep-board name is pulled toward neutral
-- instead of topping the list.
--
-- Derived table: no metadata jsonb. model_version records which model produced
-- the row, so a settings bump makes stale rows identifiable.

create table if not exists public.draft_value_targets (
  format_slug              text not null,
  season                   integer not null,
  player_id                uuid not null references public.players (id) on delete cascade,

  -- Market side
  market_adp               numeric,
  market_adp_key           text,
  market_source            text,
  room_adp                 numeric,
  room_drafts_sampled      integer,

  -- FF Beacon side
  beacon_rank              integer,
  beacon_value             numeric,
  beacon_pick              numeric,
  position_rank            integer,
  position                 text,

  -- Competitive side
  projected_points         numeric,
  points_above_replacement numeric,
  beat_rate                numeric,
  availability             numeric,

  -- Output
  value_gap                numeric,
  steal_score              numeric,
  confidence               numeric,
  category                 text not null,
  verdict                  text not null,

  model_version            text not null,
  computed_at              timestamptz not null default now(),

  primary key (format_slug, season, player_id),
  constraint draft_value_targets_category_check
    check (category in ('steal', 'swing', 'fade', 'fair')),
  constraint draft_value_targets_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint draft_value_targets_steal_score_range
    check (steal_score is null or (steal_score >= 0 and steal_score <= 100))
);

-- The guide reads one (format, season) cohort ordered by steal_score.
create index if not exists idx_draft_value_targets_board
  on public.draft_value_targets (format_slug, season, category, steal_score desc);

create index if not exists idx_draft_value_targets_player
  on public.draft_value_targets (player_id);

alter table public.draft_value_targets enable row level security;

drop policy if exists draft_value_targets_select_public on public.draft_value_targets;
create policy draft_value_targets_select_public
  on public.draft_value_targets
  for select to anon, authenticated using (true);

drop policy if exists draft_value_targets_service_role_all on public.draft_value_targets;
create policy draft_value_targets_service_role_all
  on public.draft_value_targets
  for all to service_role using (true) with check (true);

comment on table public.draft_value_targets is
  'Beacon Steals board: per (format, season, player), where the market drafts him against where FF Beacon would take him, with a competitive read and a plain-language verdict. Rebuilt nightly. Public SELECT (the draft guide renders it); service_role writes.';

comment on column public.draft_value_targets.beacon_pick is
  'Where FF Beacon would draft this player, as a pick number. Built from a points-above-replacement-starter ladder blended with the value ladder by league type. This is NOT overall_rank: comparing a cross-position value rank to a scarcity-priced ADP flags every QB in a single-QB format.';

comment on column public.draft_value_targets.value_gap is
  'market_adp minus beacon_pick. Positive means the market lets him fall past where we would take him, matching the sign convention in lib/on-the-clock/adp.ts.';

comment on column public.draft_value_targets.confidence is
  '0 to 1. Decays with market depth and value depth, and drops when competitive data is missing. Multiplies into steal_score so an uncertain deep-board name cannot top the board.';
