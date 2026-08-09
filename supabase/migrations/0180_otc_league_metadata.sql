-- On The Clock: persist the raw Sleeper league object alongside the draft cache.
--
-- WHY
-- The draft cache stores the Sleeper DRAFT object (metadata), its picks, users,
-- rosters, and traded picks. It never stored the LEAGUE object, so the room had
-- no access to scoring_settings or roster_positions. Every points-based feature
-- (Draft Pulse, marginal starting-lineup value, draft grades) needs the league's
-- literal scoring map and its true starting-slot list. The draft object's
-- settings.slots_* keys are a coarse approximation that flattens REC_FLEX,
-- WR_TE, and WRRB_FLEX into one bucket and carries no scoring at all.
--
-- Per the project's raw-source-preservation rule we store the WHOLE Sleeper
-- league object rather than three extracted columns, so a later feature can read
-- a field we did not think to extract today. The read path whitelists what
-- reaches the client (lib/on-the-clock/cache.ts shapeMeta).
--
-- ACCESS MATRIX (unchanged by this migration; the column inherits the table's
-- existing policies)
--   anon           SELECT on on_the_clock_draft_cache: allowed (public draft data)
--   authenticated  SELECT: allowed
--   anon/auth      INSERT/UPDATE/DELETE: blocked (no policy grants writes)
--   service_role   ALL: allowed (the sync path in lib/on-the-clock/sleeper-sync.ts)
--
-- The Sleeper league object is public data from a public API. It carries no user
-- email, no auth identity, and nothing the league page does not already show.

alter table public.on_the_clock_draft_cache
  add column if not exists league_metadata jsonb not null default '{}'::jsonb;

comment on column public.on_the_clock_draft_cache.league_metadata is
  'Raw Sleeper league object (GET /league/{id}) captured at sync time. Source of scoring_settings and roster_positions for the points-based draft features. Never modified after write; each sync replaces it wholesale.';
