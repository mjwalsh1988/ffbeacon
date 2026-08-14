-- Migration 0200: Signal Guide page + entries for Ask BEAM
--
-- Access matrix: unchanged. See migration 0078 for the guide_pages /
-- guide_entries schema and RLS.
--
-- The Signal Guide is the site's promise that any tool explains itself in the
-- same view where you use it. BEAM is the tool most in need of that, because it
-- is the only one where the reader has to guess what it can do before they can
-- use it. These entries answer the questions the empty input raises: what can I
-- ask, why did it ask me back, and why can it not see my league.
--
-- Idempotent on page_key, and entries are inserted only when the page has none,
-- so re-running never duplicates content or clobbers an admin edit.

insert into public.guide_pages (page_key, title, description, route_example, display_order)
values (
  'ask-beam',
  'Ask BEAM',
  'The natural-language question tool.',
  '/tools/ask-beam',
  55
)
on conflict (page_key) do nothing;

insert into public.guide_entries (page_id, kind, heading, body, display_order, is_published, is_global)
select
  p.id, v.kind, v.heading, v.body, v.display_order, true, false
from public.guide_pages p
cross join (values
  (
    'question',
    'What can I ask BEAM?',
    E'Season statistics for any player back to 2020, current values and rankings in your format, a head-to-head verdict between two players, basic profile facts like age and college, and definitions of fantasy terms.\n\nWrite it the way you would say it. "How many yards did Purdy throw for last year" works as well as "brock purdy passing yards 2025".',
    10
  ),
  (
    'question',
    'Do I have to spell names correctly?',
    E'No. BEAM matches exact names, surnames on their own, first initials, common nicknames, and typos. "cmc", "b purdy", and "brock prudy" all land on the right player.\n\nWhen more than one player fits what you typed, BEAM asks which one you meant instead of picking. Answering the question keeps the rest of your original question intact.',
    20
  ),
  (
    'question',
    'Why did BEAM ask which yards I meant?',
    E'For a running back, "yards" is genuinely three different numbers: rushing, receiving, and the two combined. Rather than pick one and hope, BEAM asks.\n\nYou can skip the question by saying which you meant up front: "how many rushing yards did Gibbs have".',
    30
  ),
  (
    'question',
    'Why can BEAM not answer questions about my league?',
    E'BEAM only reads public player data. It cannot see your roster, your matchups, or a trade offer sitting in your inbox.\n\nLeague Pulse syncs your actual Sleeper leagues, and Signal Check grades a specific trade. BEAM will point you at whichever one fits when you ask something it cannot reach.',
    40
  ),
  (
    'question',
    'Which season does BEAM use if I do not say one?',
    E'The most recent season we hold completed games for. During the offseason that is last season, not the one about to start, because the new season has no games in it yet.\n\nWhenever BEAM has to make that call, it says so underneath the answer.',
    50
  ),
  (
    'question',
    'BEAM could not answer my question. Now what?',
    E'Use the "Help BEAM learn this" button on the answer. Your question comes along automatically, so there is nothing to retype.\n\nWe read every one of these, and the questions people ask most are the ones BEAM learns next. Leave an email and we will tell you when yours works.',
    60
  ),
  (
    'term',
    'BEAM',
    'Beacon Engine for Answers and Metrics. The part of FF Beacon that turns a plain-English question into a lookup against our own data. It has no model behind it: it matches your words against a fixed vocabulary and reads the answer from the same rows the rest of the site shows.',
    70
  ),
  (
    'term',
    'Clarification',
    'When BEAM is not confident enough about who or what you meant, it shows you the options instead of guessing. Picking one re-asks your original question with that choice filled in, so you never lose the rest of what you typed.',
    80
  ),
  (
    'term',
    'Matched',
    'The quiet line under an answer showing which player BEAM decided you meant, when it had to work that out from a nickname or a typo rather than a full name. If it got it wrong, the link next to it lets you fix it in one click.',
    90
  )
) as v(kind, heading, body, display_order)
where p.page_key = 'ask-beam'
  and not exists (
    select 1 from public.guide_entries e where e.page_id = p.id
  );
