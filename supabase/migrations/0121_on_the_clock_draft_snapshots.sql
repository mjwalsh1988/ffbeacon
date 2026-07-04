-- Migration 0121: on_the_clock_draft_snapshots + on_the_clock_pick_snapshots
-- (permanent finalized results for completed On The Clock drafts)
--
-- Access matrix (both tables):
--   anon          : SELECT only  (public Sleeper draft data valued with public
--                   FF Beacon values / public Sleeper ADP)
--   authenticated : SELECT only
--   service_role  : ALL          (written only by the server snapshot finalizer)
--   client writes : BLOCKED (no anon/auth INSERT/UPDATE/DELETE policy exists)
--
-- WHY: the live On The Clock room values everything against CURRENT FF Beacon
-- values and CURRENT Sleeper ADP. Once a draft completes, its results (pick
-- grades, board indicators, awards, Best Drafter) must never drift as those
-- inputs move. The finalizer freezes everything a completed draft needs to
-- re-render: the board (players + values + ranks + ADP at the resolved snapshot
-- dates), the shaped draft cache (users / rosters / picks / traded picks), the
-- league's trades, and the computed awards. Completed-draft pages read the
-- snapshot INSTEAD of live data; recalculation is intentional (delete the row
-- and reopen) rather than automatic.
--
-- Snapshot provenance: for a draft opened for the first time after completion,
-- the finalizer resolves the closest historical FF Beacon value snapshot and the
-- closest Sleeper ADP snapshot to the draft's completion time. The *_snapshot_source
-- columns record how each was chosen (exact / previous / during_draft /
-- next_available / current_fallback) and snapshot_confidence summarizes overall
-- quality, so estimated results are always distinguishable from exact ones.
--
-- on_the_clock_draft_snapshots is one row per Sleeper draft. The frozen board /
-- cache / transactions / awards live in jsonb (they are render payloads consumed
-- whole, never queried per-field). on_the_clock_pick_snapshots is relational, one
-- row per pick, carrying the per-pick value-vs-ADP result for queryability and
-- admin visibility. It cascade-deletes with its parent snapshot.

create table if not exists public.on_the_clock_draft_snapshots (
  sleeper_draft_id   text primary key,
  sleeper_league_id  text not null,
  season             text not null,
  league_name        text,
  draft_type         text,
  draft_status       text not null default 'complete',
  teams              integer,
  rounds             integer,
  -- FF Beacon format the draft was valued against (auto-detected from the league).
  format_slug        text,
  format_label       text,
  -- Player pool inferred at finalize ("everyone" | "rookies").
  player_pool        text not null default 'everyone'
                       check (player_pool in ('everyone', 'rookies')),
  -- The Sleeper ADP map key the draft was graded against (e.g. "dynasty_2qb").
  adp_format_key     text,
  -- When the draft actually completed on Sleeper (last pick time when known).
  draft_completed_at timestamptz,
  finalized_at       timestamptz not null default now(),
  -- How the FF Beacon value snapshot was chosen relative to draft_completed_at.
  value_snapshot_source text
    check (value_snapshot_source in
      ('exact', 'previous', 'during_draft', 'next_available', 'current_fallback')),
  -- How the Sleeper ADP snapshot was chosen relative to draft_completed_at.
  adp_snapshot_source text
    check (adp_snapshot_source in
      ('exact', 'previous', 'during_draft', 'next_available', 'current_fallback')),
  -- The captured_at of the FF Beacon value batch the board was frozen from.
  value_snapshot_date timestamptz,
  -- The snapshot_date of the player_market_snapshots partition used for ADP.
  adp_snapshot_date  date,
  snapshot_confidence text not null default 'low'
    check (snapshot_confidence in ('high', 'medium', 'low')),
  -- Frozen render payloads (consumed whole by the completed-draft room):
  -- board: { players: [...], pickValues: [...], formatSlug, formatLabel, season }
  board              jsonb not null default '{}'::jsonb,
  -- draft: the shaped draft cache (draft meta, users, rosters, picks, tradedPicks).
  draft              jsonb not null default '{}'::jsonb,
  -- transactions: the league's completed trades, shaped for the Trade History tab.
  transactions       jsonb not null default '[]'::jsonb,
  -- awards: the six computed awards, locked at finalize.
  awards             jsonb not null default '[]'::jsonb,
  -- Provenance details (lookup candidates considered, fallback notes, etc).
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_on_the_clock_draft_snapshots_league
  on public.on_the_clock_draft_snapshots (sleeper_league_id);
create index if not exists idx_on_the_clock_draft_snapshots_finalized
  on public.on_the_clock_draft_snapshots (finalized_at desc);

create table if not exists public.on_the_clock_pick_snapshots (
  sleeper_draft_id  text not null
                      references public.on_the_clock_draft_snapshots (sleeper_draft_id)
                      on delete cascade,
  pick_no           integer not null,
  round             integer,
  draft_slot        integer,
  roster_id         integer,
  picked_by         text,
  sleeper_player_id text,
  player_id         uuid references public.players (id) on delete set null,
  -- Display fields captured at snapshot time (never re-resolved later).
  player_name       text,
  position          text,
  team              text,
  is_keeper         boolean not null default false,
  -- The FF Beacon value and overall rank the player carried in the frozen board.
  beacon_value      numeric,
  beacon_rank       integer,
  -- The Sleeper ADP (overall pick number) from the frozen ADP snapshot.
  sleeper_adp       numeric,
  -- pick_no minus sleeper_adp: positive = taken later than market (value),
  -- negative = taken earlier than market (reach). Null when ADP is unknown.
  pick_value_delta  numeric,
  -- 'value' | 'reach' | 'neutral' at the threshold used when finalizing; null
  -- when the player had no ADP.
  value_verdict     text check (value_verdict in ('value', 'reach', 'neutral')),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (sleeper_draft_id, pick_no)
);

create index if not exists idx_on_the_clock_pick_snapshots_player
  on public.on_the_clock_pick_snapshots (player_id);

alter table public.on_the_clock_draft_snapshots enable row level security;
alter table public.on_the_clock_pick_snapshots enable row level security;

drop policy if exists on_the_clock_draft_snapshots_select_public on public.on_the_clock_draft_snapshots;
create policy on_the_clock_draft_snapshots_select_public on public.on_the_clock_draft_snapshots
  for select to anon, authenticated using (true);
drop policy if exists on_the_clock_draft_snapshots_service_role_all on public.on_the_clock_draft_snapshots;
create policy on_the_clock_draft_snapshots_service_role_all on public.on_the_clock_draft_snapshots
  for all to service_role using (true) with check (true);

drop policy if exists on_the_clock_pick_snapshots_select_public on public.on_the_clock_pick_snapshots;
create policy on_the_clock_pick_snapshots_select_public on public.on_the_clock_pick_snapshots
  for select to anon, authenticated using (true);
drop policy if exists on_the_clock_pick_snapshots_service_role_all on public.on_the_clock_pick_snapshots;
create policy on_the_clock_pick_snapshots_service_role_all on public.on_the_clock_pick_snapshots
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_draft_snapshots is
  'Permanent finalized snapshot per completed Sleeper draft for On The Clock: frozen board (values + ranks + ADP), shaped draft cache, trades, computed awards, and snapshot provenance (how the value/ADP dates were chosen). Completed-draft pages read this instead of live data so results never drift. Public SELECT; writes via the service-role finalizer only.';
comment on table public.on_the_clock_pick_snapshots is
  'Relational per-pick results for a finalized On The Clock draft snapshot: the FF Beacon value/rank and Sleeper ADP used, the pick-vs-ADP delta, and the value verdict. Cascade-deletes with the parent draft snapshot. Public SELECT; service-role writes only.';
