-- ---------------------------------------------------------------------------
-- Would You Rather: one Discord channel per league type
-- ---------------------------------------------------------------------------
-- Until now the game posted every poll through a single webhook, so a dynasty
-- trade and a redraft trade landed in the same channel. An admin can now point
-- each league type at its own webhook: dynasty trades to the dynasty room,
-- redraft to the redraft room, best ball to the best ball room.
--
-- The routing table itself lives in would_you_rather_settings.settings ->
-- 'discord' -> 'routes', alongside the schedule it shares a form with. This
-- migration adds the two columns the routing needs to work efficiently and
-- safely.
--
-- would_you_rather_trades.league_category
--   Which bucket the trade's league falls in, written at pool time from the
--   same rule lib/league-category.ts uses everywhere else on the site
--   (settings.best_ball = 1, settings.type = 2 is dynasty, everything else is
--   redraft). Stored rather than derived on read because the poster has to ask
--   "give me an unposted dynasty trade" and joining leagues to inspect a jsonb
--   field on every pick is the expensive way to answer that.
--
--   Nullable on purpose. A pool row whose league has not finished syncing has
--   no honest answer, and a wrong bucket is worse than no bucket: it would post
--   a redraft trade into the dynasty channel. A null row is served by a route
--   that covers every category and skipped by a route that does not.
--
-- would_you_rather_discord_polls.route_key
--   Which destination a poll was posted to. The unique index moves from
--   slot_key alone to (slot_key, route_key), because "one post per Eastern
--   hour" now means one post per hour PER CHANNEL rather than one in total.
--   The key is the webhook's id rather than the list of categories behind it,
--   so a channel cannot be posted to twice in an hour even if an admin
--   regroups the categories midway through it.
--
--   Existing rows take 'default', which is what the single-webhook era was.
--
-- Access matrix: unchanged. Both tables stay service-role only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The pool row's league type
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_trades
  add column if not exists league_category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'would_you_rather_trades_league_category_check'
  ) then
    alter table public.would_you_rather_trades
      add constraint would_you_rather_trades_league_category_check
      check (
        league_category is null
        or league_category in (
          'dynasty', 'redraft', 'best-ball-dynasty', 'best-ball-redraft'
        )
      );
  end if;
end $$;

-- Backfill from the raw Sleeper league object every leagues row preserves.
-- Same rule as lib/league-category.ts: best ball first, then type 2 is dynasty
-- and every other type (redraft, keeper, chopped) is redraft.
update public.would_you_rather_trades t
set league_category = case
  when coalesce((l.metadata -> 'settings' ->> 'best_ball')::int, 0) = 1
    then case
      when coalesce((l.metadata -> 'settings' ->> 'type')::int, 0) = 2
        then 'best-ball-dynasty'
      else 'best-ball-redraft'
    end
  when coalesce((l.metadata -> 'settings' ->> 'type')::int, 0) = 2 then 'dynasty'
  else 'redraft'
end
from public.leagues l
where l.id = t.league_id
  and t.league_category is null
  and l.metadata ? 'settings';

-- The poster's query: active trades in a set of categories, least-posted first.
create index if not exists idx_wyr_trades_category_active
  on public.would_you_rather_trades(league_category, served_count desc)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- The poll row's destination
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_discord_polls
  add column if not exists route_key text not null default 'default';

-- One post per Eastern hour PER CHANNEL. The old constraint said one post per
-- Eastern hour in total, which was right when there was one channel and would
-- now silence every channel but whichever one posted first.
alter table public.would_you_rather_discord_polls
  drop constraint if exists would_you_rather_discord_polls_slot_key_key;

create unique index if not exists idx_wyr_discord_polls_slot_route
  on public.would_you_rather_discord_polls(slot_key, route_key);
