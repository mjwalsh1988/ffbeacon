-- Migration 0118: public read for news_categories (The Beacon Brief public reader)
--
-- Migration 0083 deferred the public read policy on news_categories until the
-- public Beacon Brief reader shipped. It has now landed (/brief), which needs to
-- list the active category taxonomy to anonymous and authenticated visitors so
-- they can filter the feed by category. Inactive categories stay hidden from the
-- public; the admin + curation pipeline continue to read every row through the
-- service-role client (which bypasses RLS).
--
-- Access matrix (after this migration):
--   anon          : SELECT where is_active = true
--   authenticated : SELECT where is_active = true
--   service_role  : ALL (unchanged)
--   client writes : BLOCKED (no insert/update/delete policy for anon/auth)

drop policy if exists news_categories_select_public on public.news_categories;
create policy news_categories_select_public on public.news_categories
  for select to anon, authenticated
  using (is_active = true);

comment on table public.news_categories is
  'Editable Beacon Brief category set + article taxonomy; discord_role_ids drives Discord group pings per category. Active rows are publicly readable for the /brief category filter; writes remain service_role-only behind the admin gate.';
