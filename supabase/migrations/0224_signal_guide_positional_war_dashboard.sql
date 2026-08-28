-- Migration 0224: Signal Guide copy for the Positional WAR dashboard
--
-- Two things happen here.
--
-- 1. The global "Positional WAR" term gets a plainer opening and, for the
--    first time, says out loud that the whole thing runs on PROJECTIONS for
--    the games left to play rather than on what has already happened. That
--    omission was the single biggest gap in the copy: a reader could
--    reasonably have assumed WAR was a record of production, which is the
--    opposite of what it is. The deeper paragraphs (scarcity by lineup shape,
--    superflex, and why Positional WAR and projected wins legitimately
--    disagree) stay, because the brief asks for detailed methodology to remain
--    available for advanced readers and this entry is where it lives.
--
-- 2. The `league-positional-war` page gets its own entries. It had a guide
--    page row and zero entries, so the panel on that route rendered nothing
--    page-specific, and the page now carries a chart, a scatterplot, a tier
--    ladder and a ten-column table that a reader can reasonably have questions
--    about.
--
-- Every body here follows the brief's copy rules: short sentences, no
-- unexplained acronym (never "PORP"), replacement level described as the best
-- projected player who would not make a starting lineup anywhere in the
-- league, and never as an "average bench player" or an "average waiver
-- player".
--
-- IDEMPOTENT, AND NON-CLOBBERING. The inserts are guarded by `where not
-- exists` on (page_id, kind, heading), matching migrations 0167, 0213 and
-- 0218; guide_entries has no unique key on that triple. The one UPDATE is
-- guarded on the body still starting with the sentence this project shipped,
-- so an admin who has since rewritten the term at /admin/signal-guide keeps
-- their version and this migration is a no-op against it.
--
-- Access matrix (unchanged from migration 0078, repeated here for the record):
--   guide_pages    select  anon + authenticated
--                  insert/update/delete  service_role only (admin panel)
--   guide_entries  select  anon + authenticated, published rows only
--                  insert/update/delete  service_role only (admin panel)

-- 1. Rewrite the global term, only if it is still the shipped copy.
update public.guide_entries
set
  body = 'Positional WAR estimates how many extra matchups a player should help you win, compared with a replacement player. A replacement player is the best one at his position who would not make a starting lineup anywhere in your league.

It runs on projections for the games left to play, not on what players have already done, and it is scored under your league''s own settings. It answers a question about your league rather than about your team.

The chart is a line per position, and the shape of the line is the answer. A steep line means the position runs out fast, so the players at the top of it are hard to replace and worth paying up for. A flat line means the next player down is nearly as good, so spending there buys you very little.

Everything in it is specific to your league. Replacement level is set by how many players at each position your league actually starts, which depends on your roster slots, your flex, and how many teams you have. A twelve-team league that starts two running backs and a flex starts about twenty-eight running backs, so replacement is roughly the twenty-ninth. Turn on superflex and the number of quarterbacks your league starts roughly doubles, replacement at quarterback drops a long way down the list, and every quarterback''s Positional WAR jumps. Scoring matters too, so a TE premium lifts the tight end line on its own.

Here is the part worth reading twice. Positional WAR does not know who owns whom. Every player is measured against a league-average team and a league-average opponent, which is exactly what makes the six positions comparable to each other. It is not a statement about your roster.

That is why it can disagree with the other wins number on this site, and the disagreement is the point. Projected wins, the one you see in Trade Ideas and in the FAAB tools, is about your team specifically: it runs your actual lineup, week by week, against your actual remaining schedule. So the best quarterback in your league might carry 0.65 Positional WAR while adding him is worth almost nothing to you, because you already start a good quarterback and only one of them can play. Positional WAR tells you where the scarcity is. Projected wins tells you what a move does for you. Read them together.',
  updated_at = now()
where kind = 'term'
  and heading = 'Positional WAR'
  and body like 'Positional WAR answers a question about your league%';

-- 2. Page entries for /leagues/[id]/positional-war.

insert into public.guide_entries
  (page_id, kind, heading, body, display_order, is_published, is_global)
select p.id, v.kind, v.heading, v.body, v.display_order, true, false
from public.guide_pages p
cross join (values
  (
    'question',
    'What does a number on this page actually mean?',
    'A player with 1.20 Positional WAR should help you win about one and a bit more matchups over the rest of the season than a replacement player would. A replacement player is the best one at his position who would not make a starting lineup anywhere in this league.

The figures come from weekly projections for the games left to play, scored under this league''s own settings. They are an estimate of what is ahead, not a record of what has happened.',
    0
  ),
  (
    'question',
    'Why do the lines flatten out at the bottom?',
    'Because past a certain rank a player projects for fewer points than a replacement, and swapping him in would not win you anything. Those players sit at zero rather than going negative: you would never actually start one when the replacement is sitting on waivers, so the wins are not wins you would give up.

The table still separates them. "Replacement level" means he is roughly as good as a freely available player; "Below replacement" means he projects for fewer points a week than one.',
    1
  ),
  (
    'question',
    'Why do the two charts disagree about a player?',
    'They are measuring different things, and that is the useful part. The left chart is what a player is worth in this league''s lineup. The right chart puts that against what the market charges for him.

A player high on the left and far to the left on the right chart wins you games and costs little to acquire. One low and far to the right is expensive for what he adds. Trade value comes from the source you picked in the header; Positional WAR never changes when you switch sources.',
    2
  ),
  (
    'question',
    'What are the tiers based on?',
    'Every player this league actually starts, ranked by Positional WAR. League breaker is the top two per cent of those starting jobs, Elite the top ten per cent, Strong advantage the top quarter.

They are worked out from your league rather than from a fixed number of wins, so they still mean the same thing in week fourteen as in week one, and in a ten-team league as in a sixteen-team one.',
    3
  ),
  (
    'question',
    'Why is a player missing a trade value?',
    'The value source you have chosen does not publish one for him. Kickers and team defenses usually have none at all.

He is shown with a dash rather than a zero, and he is left off the value chart entirely. A zero would say he is worthless, and that is not what a missing number means.',
    4
  ),
  (
    'term',
    'Points above replacement',
    'The projected fantasy points a player scores over the whole remaining window, above what a replacement player at his position would have scored in the same weeks.

It is the raw material Positional WAR is built from. Points above replacement counts points; Positional WAR turns those points into matchups won, which is why a big points edge at a position everybody has can still be worth few extra wins.',
    5
  ),
  (
    'term',
    'Replacement level',
    'The best player at a position who would not make a starting lineup anywhere in your league.

It moves with your lineup, not with the waiver wire. A twelve-team league starting two running backs plus a flex fills about twenty-eight running back spots, so replacement is roughly the twenty-ninth best running back. Add a superflex and replacement at quarterback drops a long way down the list, which is why every quarterback is suddenly worth more.',
    6
  )
) as v(kind, heading, body, display_order)
where p.page_key = 'league-positional-war'
  and not exists (
    select 1
    from public.guide_entries e
    where e.page_id = p.id
      and e.kind = v.kind
      and e.heading = v.heading
  );
