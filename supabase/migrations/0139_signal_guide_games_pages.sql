-- Migration 0139: Signal Guide pages for the Games hub and Signal Scout
--
-- Adds two page registry rows so the Signal Guide launcher can attach to the
-- Games hub (/games) and the Signal Scout game (/games/signal-scout). The
-- canonical key set lives in lib/guide/registry.ts (matchers added alongside
-- this migration). Idempotent on page_key so re-running never duplicates a page
-- and never clobbers admin-edited copy. See migration 0078 for the guide_pages /
-- guide_entries schema, RLS policies, and access matrix (unchanged here).

insert into public.guide_pages (page_key, title, description, route_example, display_order)
values
  ('games', 'Games', 'The free games hub index.', '/games', 180),
  ('signal-scout', 'Signal Scout', 'The Signal Scout guessing game.', '/games/signal-scout', 190)
on conflict (page_key) do nothing;
