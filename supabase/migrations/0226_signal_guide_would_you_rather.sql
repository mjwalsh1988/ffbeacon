-- 0226: Signal Guide page and entries for Would You Rather.
--
-- Access matrix (unchanged from migration 0078, repeated here for the record):
--   guide_pages    select  anon + authenticated, all rows
--                  insert/update/delete  service_role only (admin panel)
--   guide_entries  select  anon + authenticated, published rows only
--                  insert/update/delete  service_role only (admin panel)
--
-- WHY. Registering the page in lib/guide/registry.ts is what makes the floating
-- Guide button appear on a route; without a matching `guide_pages` row the
-- button has no panel to open. Signal Scout has one, and the new game is the
-- kind of surface the guide exists for: it deliberately withholds information
-- until a reader acts, and a reader who wants to know why should be able to
-- find out without leaving the round.
--
-- The entries answer the three questions the game actually raises: why nothing
-- is shown before the vote, why the managers are not named, and why the crowd
-- and Signal Check are allowed to disagree. The "Positional WAR" entry seeded
-- by migration 0213 is marked is_global, so it already surfaces here without
-- being repeated.
--
-- display_order continues the games block: games 180, signal-scout 190.
--
-- Idempotent: page_key is unique and the page insert is `on conflict do
-- nothing`; the entries are inserted only where no entry with the same heading
-- already exists on the page, so a re-run never duplicates a row and never
-- clobbers text an admin has edited.

insert into public.guide_pages (page_key, title, description, route_example, display_order)
values
  (
    'would-you-rather',
    'Would You Rather?',
    'The trade voting game: a real trade with the names taken off.',
    '/games/would-you-rather',
    200
  )
on conflict (page_key) do nothing;

insert into public.guide_entries (page_id, kind, heading, body, display_order, is_published, is_global)
select
  p.id,
  v.kind,
  v.heading,
  v.body,
  v.display_order,
  true,
  false
from public.guide_pages p
cross join (
  values
    (
      'question',
      'Why can I not see any values before I vote?',
      'Because the game would stop working. The whole point is your read on a trade before anything nudges it, so the board carries names, positions and the league''s rules and nothing else: no prices, no margin, no grade, and nothing that hints at which side we think won. All of that is worked out on the server and only sent to your browser after your vote is recorded, so there is nothing to find in the page either.',
      10
    ),
    (
      'question',
      'Whose trade is this?',
      'A real one, out of a real Sleeper league that somebody has synced with League Pulse. The league is named and its scoring and roster rules are shown, because the same two players are a completely different deal in a superflex TE premium league than in a standard one. The two managers are not named anywhere: they are Team A and Team B, on the page, in the Discord poll, and in every sentence of the breakdown.',
      20
    ),
    (
      'question',
      'The room and Signal Check disagree. Which one is right?',
      'They are answering slightly different questions, and both answers are worth having. Signal Check prices the assets: what each side received is worth, in this league''s format, using FF Beacon values. The room is reading context a price does not carry, like whether a rebuilding team should want a 30-year-old running back at all. A trade can be a clear win on value and still be the wrong deal for the team that made it.',
      30
    ),
    (
      'question',
      'What is a startup draft trade?',
      'A trade made around a dynasty league''s very first draft, where the picks being moved are startup picks rather than rookie picks. A startup pick is a seat in that draft, and it becomes whichever player was taken there, so the game shows the player and says which seat he came from. A pick from a draft that has not reached that seat yet is shown as the player expected there, and labelled as a projection.',
      40
    ),
    (
      'question',
      'Do I need an account?',
      'Not to try it. You get a couple of trades as a guest so you can see what the game is before deciding. After that a vote needs an account, because a vote only means anything if it can be counted once per person, and that is exactly what makes the percentages worth reading. Your guest votes are already counted and are not lost when you sign in.',
      50
    )
) as v(kind, heading, body, display_order)
where p.page_key = 'would-you-rather'
  and not exists (
    select 1
    from public.guide_entries e
    where e.page_id = p.id
      and e.heading = v.heading
  );
