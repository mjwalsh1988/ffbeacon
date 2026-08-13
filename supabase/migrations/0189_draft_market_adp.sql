-- Migration 0189: draft_market_adp
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy)
--   authenticated : NO ACCESS  (no policy)
--   service_role  : ALL        (built by lib/draft-value/room-adp.ts, read by the
--                               draft-value build)
--
-- WHY
-- "Where the room actually takes him", computed from OUR OWN synced drafts
-- (draft_selections) rather than from a public ADP feed. Sleeper's ADP stays the
-- primary market number because it is sampled across orders of magnitude more
-- drafts; this table is the second opinion, and it is format-EXACT in a way the
-- public feed is not (Sleeper publishes ten market keys; we carry thirteen
-- formats, and TE-premium has no public market at all).
--
-- It feeds the draft-value model in exactly one place: the "room agreement"
-- confidence factor. A player our own rooms also let fall gains confidence; a
-- player our rooms take much earlier than the public market loses it. It is
-- deliberately NOT blended into the headline ADP, because at current volume a
-- player has single-digit observations and a mean over five drafts would move the
-- published number around for no good reason.
--
-- Derived table: no metadata jsonb (see the Data Architecture Principles). Its
-- provenance is draft_selections plus the script that produced it.
--
-- draft_rate is the honest denominator: picks_sampled over drafts_sampled. A
-- player taken in 4 of 30 drafts has a real ADP of "usually undrafted", and the
-- model must be able to see that rather than reading his 4-draft mean as a
-- consensus.

create table if not exists public.draft_market_adp (
  format_slug     text not null,
  player_pool     text not null,
  season          integer not null,
  player_id       uuid not null references public.players (id) on delete cascade,

  drafts_sampled  integer not null,
  picks_sampled   integer not null,
  adp             numeric not null,
  adp_median      numeric not null,
  earliest_pick   integer not null,
  latest_pick     integer not null,
  pick_stdev      numeric,
  draft_rate      numeric not null,

  computed_at     timestamptz not null default now(),

  primary key (format_slug, player_pool, season, player_id),
  constraint draft_market_adp_pool_check check (player_pool in ('everyone', 'rookies')),
  constraint draft_market_adp_samples_positive check (picks_sampled > 0 and drafts_sampled > 0)
);

create index if not exists idx_draft_market_adp_cohort
  on public.draft_market_adp (format_slug, player_pool, season, adp);

alter table public.draft_market_adp enable row level security;

drop policy if exists draft_market_adp_service_role_all on public.draft_market_adp;
create policy draft_market_adp_service_role_all
  on public.draft_market_adp
  for all to service_role using (true) with check (true);

comment on table public.draft_market_adp is
  'FF Beacon room ADP: where our own synced drafts actually take each player, per (format, pool, season). A second opinion alongside public Sleeper ADP, used by the draft-value model as a confidence input rather than as the headline number. Derived from draft_selections; service_role only.';

comment on column public.draft_market_adp.draft_rate is
  'picks_sampled / drafts_sampled. A low rate means the player is usually left undrafted in this cohort, which is information the mean pick number hides.';
