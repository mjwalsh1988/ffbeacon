-- Migration 0167: Signal Guide global term for Power Pulse
--
-- Adds one `term` entry to the Signal Guide, marked is_global so it appears in
-- the "Metrics & Terms Decoded" section of every page's panel, not just the
-- page that owns it. It sits on the `home` page alongside the other global
-- vocabulary (Power rankings, Player value, PPR, Dynasty, and the rest) at
-- display_order 12, directly after "Power rankings", which is the term readers
-- are most likely to confuse it with.
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
  'Power Pulse',
  'Power Pulse answers one question about a fantasy team: how many games should it win from here? Every team in your league gets a score from 1 to 99, ranked against the other teams in that same league. A 90 means one of the strongest rosters in your league, not in fantasy overall. It is about winning games, so draft picks are left out completely. A 2028 first-rounder cannot start for you in week 4.

Here is how the number is built. We take each player on a roster, project what they score every remaining week, and rescore that projection using your league''s own scoring settings rather than a generic format. Those weekly numbers get adjusted for the defense the player faces, for whether that player tends to beat or miss his own projections, and for injuries that would keep him out. We then fill the best legal starting lineup you could set each week, and play the rest of your season out 4,000 times to see how often you win, make the playoffs, and take the title.

Four things blend into the final score. Scoring power counts the most, because points win games. Then strength of schedule, then depth, which is what happens when a starter gets hurt or hits a bye, then recent form against expectation once real games have been played.

Power Pulse does not move when you switch value source or format, because it reads your league''s scoring rules straight from Sleeper. The trade-value ranking next to it answers a different question: who owns the most.',
  12,
  true,
  true
from public.guide_pages p
where p.page_key = 'home'
  and not exists (
    select 1
    from public.guide_entries e
    where e.page_id = p.id
      and e.kind = 'term'
      and e.heading = 'Power Pulse'
  );
