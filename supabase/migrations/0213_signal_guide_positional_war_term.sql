-- Migration 0213: Signal Guide global term for Positional WAR
--
-- Adds one `term` entry to the Signal Guide, marked is_global so it appears in
-- the "Metrics & Terms Decoded" section of every page's panel, not just the
-- page that owns it. It sits on the `home` page at display_order 13, directly
-- after "Power Pulse" (display_order 12), which is the term readers are most
-- likely to confuse it with. Explaining the difference between the two is most
-- of what this entry is for.
--
-- Follows the pattern migration 0167 established for Power Pulse.
--
-- Idempotent: guide_entries has no unique key on (page_id, kind, heading), so
-- the insert is guarded by `where not exists` on that triple. Re-running is a
-- no-op and never clobbers copy an admin has since edited at
-- /admin/signal-guide.
--
-- Access matrix (unchanged from migration 0078, repeated here for the record):
--   guide_entries  select  anon + authenticated, published rows only
--                  insert/update/delete  service_role only (admin panel)
--
-- See migration 0078 for the guide_pages / guide_entries schema and RLS, and
-- 0079 for the is_global column this row sets.

insert into public.guide_entries
  (page_id, kind, heading, body, display_order, is_published, is_global)
select
  p.id,
  'term',
  'Positional WAR',
  'Positional WAR answers a question about your league rather than about your team: how scarce is each position here? It is short for wins above replacement, and it measures how many more games a team would win by starting a given player instead of the best player at that position nobody in your league starts.

The chart is a line per position, and the shape of the line is the answer. A steep line means the position runs out fast, so the players at the top of it are hard to replace and worth paying up for. A flat line means the next guy down is nearly as good, so spending there buys you very little.

Everything in it is specific to your league. Replacement level is defined by how many players at each position your league actually starts, which depends on your roster slots, your flex, and how many teams you have. A twelve-team league that starts two running backs and a flex starts about twenty-eight running backs, so replacement is roughly the twenty-ninth. Turn on superflex and the number of quarterbacks your league starts roughly doubles, replacement at quarterback drops a long way down the list, and every quarterback''s Positional WAR jumps. Scoring matters too: the whole thing is computed under your league''s own settings, so a TE premium lifts the tight end line on its own.

Here is the part worth reading twice. Positional WAR does not know who owns whom. Every player is measured against a league-average team and a league-average opponent, which is exactly what makes the six positions comparable to each other. It is not a statement about your roster.

That is why it can disagree with the other wins number on this site, and the disagreement is the point. Projected wins, the one you see in Trade Ideas and in the FAAB tools, is about your team specifically: it runs your actual lineup, week by week, against your actual remaining schedule. So the best quarterback in your league might carry 0.65 Positional WAR while adding him is worth almost nothing to you, because you already start a good quarterback and only one of them can play. Positional WAR tells you where the scarcity is. Projected wins tells you what a move does for you. Read them together.',
  13,
  true,
  true
from public.guide_pages p
where p.page_key = 'home'
  and not exists (
    select 1
    from public.guide_entries e
    where e.page_id = p.id
      and e.kind = 'term'
      and e.heading = 'Positional WAR'
  );
