-- FAAB clearing-price priors: what a waiver claim actually costs, by situation.
--
-- Access matrix
--   anon, authenticated: SELECT (the public calculator and the guides publish
--     these aggregates, and the owner approved publishing them)
--   service_role: ALL (built by the recalculate-derived cron and by
--     npm run faab:priors)
--
-- Contents are anonymous quantiles only. No league, roster, user, manager or
-- player identifier is stored, and no cell can be traced to a single claim:
-- every row is a distribution over many auctions across many leagues. A public
-- read therefore reveals nothing about anyone.
--
-- Derived table, so no metadata jsonb column: its provenance is
-- lib/faab/priors-build.ts and the git history of the script that ran it,
-- which is the pre-calculated table rule in CLAUDE.md.
--
-- Every quantile is a SHARE OF THAT LEAGUE'S FULL FAAB BUDGET, 0 to 100, never
-- dollars. A $12 bid in a $100 league and a $120 bid in a $1,000 league are the
-- same decision and belong in the same cell.
--
-- cell_key is ${league_kind}|${superflex}|${position}|${phase}|${bidders}, and
-- every dimension also carries an 'any' value, so a reader with a thin exact
-- cell can fall back to a coarser one that still has samples.
create table public.faab_market_priors (
  id uuid primary key default gen_random_uuid(),
  cell_key text not null unique,
  league_kind text not null check (league_kind in ('redraft','dynasty','chopped','any')),
  superflex text not null check (superflex in ('yes','no','any')),
  position text not null check (position in ('QB','RB','WR','TE','K','DEF','any')),
  phase text not null,
  bidders text not null check (bidders in ('1','2','3','4p','any')),
  sample_size integer not null check (sample_size >= 0),
  zero_share numeric not null,
  p05 numeric not null, p10 numeric not null, p25 numeric not null, p50 numeric not null,
  p75 numeric not null, p90 numeric not null, p95 numeric not null, p99 numeric not null,
  runner_up_ratio_p50 numeric,
  leagues_count integer not null,
  seasons integer[] not null,
  built_at timestamptz not null default now()
);

alter table public.faab_market_priors enable row level security;

create policy faab_market_priors_select_public on public.faab_market_priors
  for select to anon, authenticated using (true);

create policy faab_market_priors_service_role_all on public.faab_market_priors
  for all to service_role using (true) with check (true);

comment on table public.faab_market_priors is
  'Anonymous FAAB clearing-price quantiles by situation. Derived from league_transactions by lib/faab/priors-build.ts. No identifiers.';

comment on column public.faab_market_priors.phase is
  'Standard leagues: wk1, wk2_6, wk7_10, wk11_13, wk14p, any. Chopped leagues: alive_50p, alive_30_50, alive_lt30, any.';
