-- Migration 0236: League Activity index corrections, found by review of 0235.
--
-- THREE CHANGES, EACH MEASURED RATHER THAN GUESSED.
--
-- 1. `league_transactions` had no (league_id, created_at_sleeper) index, so the
--    activity projector's overlap read planned as a BitmapAnd whose second leg
--    scanned EVERY transaction on the site inside a 7-day window in order to
--    intersect it with the three rows belonging to one league. That leg grows
--    with the number of leagues rather than with the league being viewed: 1,948
--    index entries at 249 leagues, roughly 78,000 at 10,000. The composite turns
--    it into a three-row index scan with the ordering satisfied for free.
--
-- 2. `idx_league_activity_rosters` (GIN on roster_ids) was never used and never
--    will be. `pg_stat_user_indexes` recorded zero scans against thirteen on
--    each btree, and forcing the planner's hand confirms why: every roster
--    filter is prefixed by an equality on `league_id`, so the feed btree already
--    serves it with the sort included and applies `roster_ids @> {n}` as a cheap
--    filter. A standalone GIN on roster_ids matches roster 7 in every league on
--    the site, which makes it the less selective leg of any bitmap, so the
--    planner correctly declines it. What is left is GIN maintenance, the most
--    expensive index type to write, on every insert, for no reads. If a
--    genuinely league-agnostic roster query ever appears, the right index then
--    is a btree_gin on (league_id, roster_ids), not this.
--
-- 3. The dedupe uniqueness moves from (dedupe_key) to (league_id, dedupe_key).
--    Migration 0235 claimed "every key is prefixed with the league id so two
--    leagues can never collide", but that prefix is applied in application code
--    rather than by the constraint. Putting the league in the key itself makes
--    the guarantee structural, so a future writer that inserts without going
--    through `writeActivity` collides within its own league instead of across
--    somebody else's.
--
-- Access matrix: unchanged from migration 0235.
--   league_activity  anon SELECT, authenticated SELECT, service_role ALL.

create index if not exists idx_league_transactions_league_created
  on public.league_transactions(league_id, created_at_sleeper desc);

drop index if exists public.idx_league_activity_rosters;

alter table public.league_activity
  drop constraint if exists league_activity_dedupe_key_key;

create unique index if not exists league_activity_league_dedupe_key
  on public.league_activity(league_id, dedupe_key);
