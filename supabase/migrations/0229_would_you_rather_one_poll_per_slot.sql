-- ---------------------------------------------------------------------------
-- Would You Rather: back to one poll per scheduled hour, routed by the trade
-- ---------------------------------------------------------------------------
-- Migration 0228 added per-league-type Discord channels and, with them, a
-- channel-first poster: every scheduled hour walked the list of channels and
-- posted a trade to each. That is the wrong way round. The trade is the thing
-- being chosen, and the channel is a consequence of which league it came out
-- of, not a quota to be filled.
--
-- So a scheduled hour picks ONE trade (recent, not posted lately, and lightly
-- voted), reads that trade's league type, and posts to whichever channel that
-- type is pointed at. A run of dynasty trades means a run of posts in the
-- dynasty room, which is correct: that is what the pool actually held.
--
-- The unique key goes back to slot_key alone, because one post per Eastern hour
-- is once again the whole rule. Keyed on (slot_key, route_key), two ticks in
-- the same hour that happened to pick trades of different types would both
-- post.
--
-- route_key stays. It records which channel a poll went to, and unlike the
-- webhook_id FK (which nulls out when a webhook is deleted) it survives the
-- channel being removed, so the admin table can still say where an old poll
-- went.
--
-- The indexes follow the query the poster actually runs now: the most recently
-- added trades Discord has never seen, then, when it has seen them all, the one
-- it saw longest ago. The (league_category, served_count) index added in 0228
-- matched the channel-first query and matches nothing now.
--
-- Access matrix: unchanged. Both tables stay service-role only.
-- ---------------------------------------------------------------------------

drop index if exists public.idx_wyr_discord_polls_slot_route;

create unique index if not exists idx_wyr_discord_polls_slot
  on public.would_you_rather_discord_polls(slot_key);

drop index if exists public.idx_wyr_trades_category_active;

-- Pass one: what Discord has never posted, newest first.
create index if not exists idx_wyr_trades_discord_fresh
  on public.would_you_rather_trades(added_at desc)
  where status = 'active' and discord_posted_at is null;

-- Pass two: everything has been posted, so take the one posted longest ago.
create index if not exists idx_wyr_trades_discord_stale
  on public.would_you_rather_trades(discord_posted_at)
  where status = 'active';
