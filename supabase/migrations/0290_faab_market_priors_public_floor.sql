-- Only real aggregates are public.
--
-- Access matrix, unchanged except for the floor below
--   anon, authenticated: SELECT, but only cells built from 5 or more claims
--   service_role: ALL
--
-- The table is built with a cell for every combination, including the thin
-- ones, because the fallback ladder in lib/faab/priors-read.ts needs to know
-- a cell is thin in order to widen past it. But a cell whose sample_size is 1
-- is not an aggregate at all: it is one manager's bid, republished as a
-- quantile. Owner decision 3 on the overhaul plan allows publishing these
-- figures as "aggregates only, percentages and sample sizes" and "never a
-- single identifiable claim". A one-claim cell is exactly that. At the time
-- this was written the table held 1,955 cells, of which 152 rested on a
-- single claim and 299 on a single league.
--
-- The floor is 5 rather than the admin's display threshold
-- (priors.minCellSamples, default 30) on purpose: the display threshold is a
-- judgement about when a number is worth showing a reader, and an admin may
-- lower it. This is a privacy floor and must not move with a settings change.
-- The application still refuses to print anything under its own threshold, so
-- the two guards are independent and neither relies on the other.
--
-- service_role keeps full access: the builder has to read and replace every
-- cell, thin ones included.
drop policy if exists faab_market_priors_select_public on public.faab_market_priors;

create policy faab_market_priors_select_public on public.faab_market_priors
  for select to anon, authenticated using (sample_size >= 5);

comment on policy faab_market_priors_select_public on public.faab_market_priors is
  'Public reads see aggregates only. A cell with fewer than 5 claims is one manager''s bid, not a market, and is not published.';
