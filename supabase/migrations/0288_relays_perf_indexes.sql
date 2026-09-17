-- 0288_relays_perf_indexes
--
-- Two indexes the Relay and edition reads need, and the table grants 0284 left
-- at Supabase's default on the three Relay tables.
--
-- 1. relays.tags is filtered with `tags @> '{x}'` by the tag feed
--    (lib/relays/load.ts, app/brief/(feed)/tag/[tag]/page.tsx). 0284 created
--    five indexes on relays and none of them serves that shape, so the tag
--    feed was a sequential scan, twice over, because the page also asks for an
--    exact count. The sidebar surfaces 18 tags on every feed page, so these
--    URLs are linked from everywhere and will be crawled.
--
-- 2. articles is read as (article_type, status, published_at desc) by
--    loadLatestBrief, loadPublishedBriefs, the bundle's previous_editions read
--    and extendForRolledPeriods. Three single-column indexes exist and the
--    planner picks one and filters the rest in the heap; one composite serves
--    every edition read on the site.
--
-- 3. Grants. 0284 created relays, relay_players and relay_teams without
--    revoking anything, so anon and authenticated hold the full default table
--    privilege on all three. RLS blocks the DML because no policy covers those
--    commands, but TRUNCATE IS NOT SUBJECT TO RLS, and 0284's own header says
--    "client writes: BLOCKED on all three". This makes the grants say what the
--    header says. SELECT stays; the select policies are what bound it.
--    Same step, same reason, as 0283 and 0249 before it.
--
-- Access matrix after this migration (SELECT still gated by the 0284 policies):
--   relays, relay_players, relay_teams
--     anon          : SELECT only (published rows)
--     authenticated : SELECT only (published rows)
--     service_role  : ALL

create index if not exists idx_relays_tags
  on public.relays using gin (tags);

create index if not exists idx_articles_brief
  on public.articles (article_type, status, published_at desc);

revoke insert, update, delete, truncate, references, trigger
  on table public.relays from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.relay_players from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.relay_teams from anon, authenticated;
