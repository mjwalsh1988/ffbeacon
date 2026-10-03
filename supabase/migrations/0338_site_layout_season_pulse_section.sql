-- Put the new Season Pulse section where the code default has it: directly
-- before Games.
--
-- Access matrix: unchanged. This is a data update to the single
-- site_layout_settings row, which is already service-role only.
--
-- WHY THIS IS NEEDED AT ALL. Same reason as migration 0293. The stored menu
-- order knows nothing about a section added afterwards, and `normalizeOrder`
-- in lib/site-layout/order.ts APPENDS an id the stored order does not mention.
-- That is safe, and it is last, which would put Season Pulse under About in
-- the navigation rail while the code default has it before Games.
--
-- INSERTED, NOT REWRITTEN. 0293 replaced the whole array with a literal, which
-- was right when the stored order was still the seed. An admin can reorder the
-- menu at /admin/site-layout, so this one places "season" immediately before
-- "games" in whatever order is stored and leaves every other position alone.
-- If "games" is somehow absent the id is appended, which is what the read path
-- would have done anyway.
--
-- IDEMPOTENT. Guarded on the section being absent, so a re-run changes nothing
-- and an admin who has since moved Season Pulse by hand is not overruled.
update public.site_layout_settings s
set settings = jsonb_set(
      s.settings,
      '{menu,sectionOrder}',
      (
        select coalesce(
                 jsonb_agg(item order by position, sub),
                 '[]'::jsonb
               )
        from (
          select e.value as item, e.ordinality as position, 1 as sub
          from jsonb_array_elements(s.settings -> 'menu' -> 'sectionOrder') with ordinality as e(value, ordinality)
          union all
          select
            '"season"'::jsonb,
            coalesce(
              (
                select g.ordinality
                from jsonb_array_elements(s.settings -> 'menu' -> 'sectionOrder') with ordinality as g(value, ordinality)
                where g.value = '"games"'::jsonb
                limit 1
              ),
              jsonb_array_length(s.settings -> 'menu' -> 'sectionOrder') + 1
            ),
            0
        ) merged
      )
    )
where s.id = 'global'
  and not (s.settings -> 'menu' -> 'sectionOrder' @> '["season"]'::jsonb);
