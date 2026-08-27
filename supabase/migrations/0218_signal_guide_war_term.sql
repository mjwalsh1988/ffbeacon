-- Migration 0218: Signal Guide global term "WAR (wins above replacement)"
--
-- Adds one `term` entry, marked is_global so it appears in the "Metrics &
-- Terms Decoded" section of every page's panel. It sits on the `home` page at
-- display_order 14, directly after "Positional WAR" (13), which is directly
-- after "Power Pulse" (12).
--
-- WHY A SECOND ENTRY WHEN "Positional WAR" ALREADY EXISTS. That one is the
-- full explanation of the metric and runs to about fifteen hundred characters.
-- This one answers the three-letter question: what does WAR stand for. A
-- reader who meets the acronym for the first time needs a definition, not a
-- feature tour, and lib/beam/capabilities/glossary-term.ts serves both from
-- this same table, so "what is WAR" and "what is Positional WAR" should return
-- different lengths of answer.
--
-- WHY THE HEADING IS SHAPED THIS WAY. The BEAM glossary matcher scores an
-- exact heading match above a prefix match above a bare substring hit. With
-- this heading, "what is WAR" matches on the prefix and lands here, while
-- "what is Positional WAR" still matches "Positional WAR" exactly and lands
-- there. The parenthesised expansion follows the existing "TE Premium (TEP)"
-- entry's shape.
--
-- ON THE NAMING RULE. CLAUDE.md requires the word "Positional" adjacent to the
-- token WAR on first use in any surface, so that nothing team-specific is ever
-- read as WAR. This entry is the definition of the token itself, and its body
-- states outright that on FF Beacon WAR always means Positional WAR and is a
-- fact about a league rather than about a team. It teaches the rule rather
-- than breaking it.
--
-- Follows the pattern migrations 0167 and 0213 established.
--
-- Idempotent: guide_entries has no unique key on (page_id, kind, heading), so
-- the insert is guarded by `where not exists` on that triple. Re-running is a
-- no-op and never clobbers copy an admin has since edited at
-- /admin/signal-guide.
--
-- Access matrix (unchanged from migration 0078, repeated here for the record):
--   guide_entries  select  anon + authenticated, published rows only
--                  insert/update/delete  service_role only (admin panel)

insert into public.guide_entries
  (page_id, kind, heading, body, display_order, is_published, is_global)
select
  p.id,
  'term',
  'WAR (wins above replacement)',
  'WAR stands for wins above replacement. It is how many more games you would win by starting a given player instead of the best player at that position nobody in your league starts.

It measures scarcity, not talent. The same running back is worth more in a league that starts three of them, because the player he is being compared against is that much worse. On FF Beacon it is always Positional WAR, computed for your league from your roster slots, your team count and your own scoring settings, so use it to work out which position is worth paying up for.',
  14,
  true,
  true
from public.guide_pages p
where p.page_key = 'home'
  and not exists (
    select 1
    from public.guide_entries e
    where e.page_id = p.id
      and e.kind = 'term'
      and e.heading = 'WAR (wins above replacement)'
  );
