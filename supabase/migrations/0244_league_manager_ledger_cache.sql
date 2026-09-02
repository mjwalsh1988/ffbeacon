-- Migration 0244: league_manager_ledger_cache (the Manager Ledger)
--
-- Every other model in League Pulse measures a ROSTER. The trade-value power
-- rankings say who owns the most, Power Pulse says what each roster should win
-- from here, Positional WAR says which positions are scarce. None of them
-- measures the person operating the roster. This does: it grades the decisions
-- a manager actually made, against what was actually available at the moment
-- they made it, using results that have already happened.
--
-- One row per (league, season, roster). Twelve rows for a normal league,
-- because a MANAGER is the unit the page reads. A row per decision would be
-- thousands of rows to answer a question the table asks twelve times.
--
-- LIKE league_power_pulse_cache AND league_positional_war_cache, AND UNLIKE
-- league_power_rankings_cache, THIS TABLE DOES NOT VARY BY VALUE SOURCE OR BY
-- FORMAT CONFIG. Every figure is points that were actually scored under the
-- league's own scoring, so there is exactly one answer per league season.
-- Flipping the source toggle on a league page must never invalidate it, and
-- `source` is deliberately absent from the fingerprint. A trade that moved
-- draft picks is therefore graded on its players only and flagged
-- (trade_any_picks), because pricing a pick would require a value source and
-- would break that guarantee.
--
-- EVERY FIGURE IS RETROSPECTIVE AND SETTLED. The model reads only
-- league_matchups rows marked is_final, which carry the actual points every
-- rostered player scored that week, bench included. Nothing here is a
-- projection, an estimate, or a simulation.
--
-- `fingerprint` is the exact set of inputs the answer is a pure function of:
-- season, the count and the highest of the settled weeks, the roster count, the
-- sorted startable slots, the transaction count, the draft pick count, and the
-- model version. A week settling, a trade landing, or the draft being captured
-- all produce a different key and a recompute on the next page view rather than
-- up to twelve hours later.
--
-- `weeks` holds the per-week grade (official score, set score over gradable
-- slots, best legal lineup, the deficit, the result both ways, and the single
-- biggest swap that was available). `moves` holds the capped per-move detail
-- for the waiver, trade and draft ledgers. Both are read by the page; neither
-- is read by the model.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (pulseLeague / calculate:manager-ledger writes)
--   client writes : BLOCKED

create table if not exists public.league_manager_ledger_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null,
  sleeper_roster_id integer not null,

  -- ----- lineup ledger -----
  weeks_graded integer not null default 0,
  -- Points over the GRADABLE slots only, on both sides, so the difference
  -- between them is a lineup decision and never an ungradable IDP slot.
  set_points numeric not null default 0,
  optimal_points numeric not null default 0,
  points_left numeric not null default 0,
  -- set_points / optimal_points. Null when nothing gradable has happened yet,
  -- never a zero: "we could not measure this" and "you started nobody" are
  -- different statements.
  lineup_efficiency numeric,

  actual_wins integer not null default 0,
  actual_losses integer not null default 0,
  actual_ties integer not null default 0,
  best_lineup_wins integer not null default 0,
  best_lineup_losses integer not null default 0,
  best_lineup_ties integer not null default 0,

  -- THE headline. Games LOST that the best legal lineup out of the same roster
  -- would have WON, against the opponent's score exactly as it happened. A
  -- count of real games, checkable one row at a time against the schedule.
  wins_left_on_bench integer not null default 0,
  weeks_with_ungraded_slots integer not null default 0,

  -- ----- waiver and free agency ledger -----
  waiver_moves integer not null default 0,
  waiver_hits integer not null default 0,
  -- Null in a league with no budget, where a bid does not exist.
  waiver_faab_spent numeric,
  waiver_points_on_roster numeric not null default 0,
  waiver_points_started numeric not null default 0,
  waiver_points_per_dollar numeric,

  -- ----- trade ledger -----
  trade_count integer not null default 0,
  trade_points_in numeric not null default 0,
  trade_points_out numeric not null default 0,
  trade_net numeric not null default 0,
  trade_any_picks boolean not null default false,

  -- ----- draft ledger -----
  draft_picks integer not null default 0,
  draft_points numeric not null default 0,
  -- Measured against the mean production of this draft's own picks in the same
  -- round, so the baseline belongs to the league rather than to somebody else's
  -- idea of what a third-rounder is worth. Keepers are excluded from both.
  draft_above_baseline numeric not null default 0,

  -- ----- ranks, within this league -----
  -- Null rather than last when there is no basis: too few graded weeks for
  -- efficiency, no moves for waivers or trades, no captured draft.
  efficiency_rank integer,
  waiver_rank integer,
  trade_rank integer,
  draft_rank integer,
  -- Total OFFICIAL points, so it matches the league's own standings rather
  -- than the gradable subset efficiency is built on. This is the roster half of
  -- the "good, lucky, or carried" split the page exists to settle.
  scoring_rank integer,

  -- Per week: { week, officialPoints, setPoints, optimalPoints, pointsLeft,
  --   ungradedSlots, opponentPoints, outcome, bestLineupOutcome, biggestMiss }
  weeks jsonb not null default '[]'::jsonb,
  -- { waivers: [...], trades: [...], draftBest: [...], draftWorst: [...] }
  moves jsonb not null default '{}'::jsonb,
  -- League-level facts, denormalized onto every row so the page reads one table.
  graded_weeks jsonb not null default '[]'::jsonb,
  gradable_slots jsonb not null default '[]'::jsonb,
  ungradable_slots jsonb not null default '[]'::jsonb,

  fingerprint text not null,
  model_version text not null default 'ledger-1',
  generated_at timestamptz not null default now(),
  unique (league_id, season, sleeper_roster_id)
);

create index if not exists idx_league_manager_ledger_cache_league
  on public.league_manager_ledger_cache(league_id, season);

alter table public.league_manager_ledger_cache enable row level security;

drop policy if exists league_manager_ledger_cache_select_public
  on public.league_manager_ledger_cache;
create policy league_manager_ledger_cache_select_public
  on public.league_manager_ledger_cache
  for select to anon, authenticated using (true);

drop policy if exists league_manager_ledger_cache_service_role_all
  on public.league_manager_ledger_cache;
create policy league_manager_ledger_cache_service_role_all
  on public.league_manager_ledger_cache
  for all to service_role using (true) with check (true);

comment on table public.league_manager_ledger_cache is
  'The Manager Ledger for one league season, one row per roster. Grades lineup, waiver, trade and draft decisions against settled results. Independent of value source and format config, like league_power_pulse_cache. Written only by pulseLeague and npm run calculate:manager-ledger.';
