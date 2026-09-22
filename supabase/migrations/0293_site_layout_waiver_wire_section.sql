-- Put the new Waiver Wire section where the code default has it.
--
-- Access matrix: unchanged. This is a data update to the single
-- site_layout_settings row, which is already service-role only.
--
-- WHY THIS IS NEEDED AT ALL. The stored menu order was written in migration
-- 0282 and knows nothing about a section added afterwards.
-- `normalizeOrder` in lib/site-layout/order.ts handles that safely: an id the
-- stored order does not mention is APPENDED, so nothing is lost and nothing is
-- duplicated. But appended means last, which would put Waiver Wire under About
-- in the navigation rail while the code default has it third.
--
-- Appending rather than inserting is the right default for that helper, because
-- a stored order is an admin's deliberate arrangement and a new entry should
-- not shove their choices around. It is simply not what we want for this one
-- section, so the row is updated explicitly instead of the helper being
-- changed.
--
-- IDEMPOTENT. The jsonb is rewritten to a literal, so re-running is a no-op
-- rather than inserting a second copy. Guarded on the section being absent so
-- an admin who has since reordered the menu by hand is not overruled by a
-- later re-run of this migration.
update public.site_layout_settings
set settings = jsonb_set(
      settings,
      '{menu,sectionOrder}',
      '["home","tools","rankings","waiver-wire","games","brief","guides","my-beacon","about","admin"]'::jsonb
    )
where id = 'global'
  and not (settings -> 'menu' -> 'sectionOrder' @> '["waiver-wire"]'::jsonb);
