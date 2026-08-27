-- 0217: Signal Guide pages for the two League Pulse section routes that had none.
--
-- Access matrix (unchanged from migration 0078, repeated here for the record):
--   guide_pages    select  anon + authenticated, all rows
--                  insert/update/delete  service_role only (admin panel)
--   guide_entries  select  anon + authenticated, published rows only
--                  insert/update/delete  service_role only (admin panel)
--
-- WHY. `/leagues/[id]/trade-ideas` and `/leagues/[id]/positional-war` were not
-- in the guide page registry (lib/guide/registry.ts), so the floating Guide
-- button never appeared on either, and no in-page control could open the guide
-- at a term. The Positional WAR card on the Trade Ideas page linked to the
-- League Overview instead, which navigated a reader off the page they were
-- reading in order to define a word in it.
--
-- Registering these two pages is what makes the in-place opener possible. The
-- "Positional WAR" entry seeded by migration 0213 is is_global, so it already
-- surfaces in every registered page's panel; these rows are what give the two
-- routes a panel to surface it in. Neither page needs its own entries to be
-- useful today, and an admin can add page-specific ones at
-- /admin/signal-guide whenever there is something to say.
--
-- display_order continues the league block: overview 80, team 90,
-- transactions 100.
--
-- Idempotent: page_key is unique, and the insert is `on conflict do nothing`,
-- so re-running never clobbers a title or description an admin has edited.

insert into public.guide_pages (page_key, title, description, route_example, display_order)
values
  (
    'league-trade-ideas',
    'Trade Ideas',
    'Suggested trades and the trade builder inside a league.',
    '/leagues/[id]/trade-ideas',
    102
  ),
  (
    'league-positional-war',
    'Positional WAR',
    'The positional scarcity curve for a league.',
    '/leagues/[id]/positional-war',
    104
  )
on conflict (page_key) do nothing;
