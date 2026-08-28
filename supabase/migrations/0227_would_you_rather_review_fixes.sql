-- Migration 0227: Would You Rather, the fixes four reviews found.
--
-- Six changes. Each one is here because a review demonstrated the problem
-- rather than suspected it.
--
-- 1. VOTES GET AN ACTOR KEY, so the free-vote allowance cannot be reset by
--    throwing away a cookie.
--
--    `resolveVoter` mints a fresh guest uuid whenever the cookie is absent, and
--    the allowance was counted against that uuid. A caller sending no cookie
--    therefore had a count of zero on every request, and the only thing between
--    them and the public tally was a 30-per-minute IP rate limit: 43,200 votes a
--    day from one address, aimable at a specific trade because /next hands the
--    id back. `actor_key` is the server-derived `user:<uuid>` or `ip:<sha256>`
--    that lib/rate-limit-actor.ts already computes and that a caller cannot
--    choose. The allowance is now counted against BOTH the cookie and the actor,
--    whichever is higher, which is the same shape as the Signal Scout guest cap.
--
--    Uniqueness stays on (trade_id, guest_id), NOT on the actor. Two people
--    behind one office NAT are two people, and collapsing them would show the
--    second one the first one's reveal for a side they did not pick.
--
-- 2. THE VOTE COUNTER TRIGGER LEARNS ABOUT UPDATE. It handled INSERT and DELETE,
--    so a service-role `update ... set side = ...` would silently desync the
--    stored counters from the rows they summarise, and the migration's own claim
--    that "the row and the counter can never disagree" would stop being true.
--
-- 3. THE DISCORD POLL ROW KEEPS THE RAW PAYLOAD. CLAUDE.md requires a `metadata`
--    jsonb on every table that ingests an external object, and this one ingests
--    Discord's `poll.results` and extracts two integers from it. Without the
--    payload there is no audit trail for a count somebody disputes, and no way
--    to re-derive if Discord changes how it assigns answer ids.
--
-- 4. THE POOL ROW CACHES ITS OWN GRADE. Grading one trade is 15 round trips and
--    about 70ms of database time, and it was being run TWICE per round: once by
--    the page that draws the board, and again seconds later by the vote route
--    that draws the reveal, for a result that is identical because it depends on
--    nothing about the reader. `growPool` already computes the whole thing at
--    insert time and threw it away.
--
--    Bounded staleness rather than a permanent cache: the reader is shown a
--    grade, and a grade that disagrees with what /tools/signal-check would say
--    right now is a small lie. The TTL is enforced in application code
--    (`WYR_GRADE_TTL_MS`), set to an hour, which collapses the page-then-vote
--    pair completely while values themselves only move on the nightly sync.
--
-- 5. THE SERVING INDEX MATCHES THE SERVING QUERY. 0225 created
--    (status, last_served_at, added_at) and called it the serving index. Nothing
--    orders by last_served_at; `selectTradeId` orders by (served_count,
--    added_at), so the query was a sequential scan plus a top-N sort. Harmless at
--    356 rows and linear from there.
--
-- 6. TWO INDEXES ON TABLES THIS FEATURE READS HOT. Both were measured with
--    EXPLAIN ANALYZE against production data:
--      league_transactions(type, status, id): the pool sampler's count went
--        96.8ms -> 17.2ms and its 300-row window 118.0ms -> 2.2ms (10,149
--        buffers -> 1,512).
--      players((external_ids->>'sleeper')): mapSleeperPlayers was a sequential
--        scan of 10,480 rows to return 3, on EVERY grade. 27.4ms -> 0.10ms,
--        4,106 buffers -> 9. This one helps every Signal Check caller on the
--        site, not only this game.
--    A third candidate, player_value_trends(format_config_id, source,
--    current_value desc), is deliberately NOT here: it belongs with the Signal
--    Check value engine rather than with a game, and it wants measuring against
--    that module's own write path first.
--
-- Access matrix: unchanged from 0225. No new table, no new policy, no change to
-- who may read or write anything.

-- ---------------------------------------------------------------------------
-- 1. Actor key on votes
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_votes
  add column if not exists actor_key text;

comment on column public.would_you_rather_votes.actor_key is
  'Server-derived actor: user:<auth uid> or ip:<salted sha256>. Never read from '
  'the request. Counted alongside guest_id so discarding the guest cookie does '
  'not reset the free-vote allowance. NOT a uniqueness key: two people behind '
  'one NAT are two people.';

-- Counting the allowance for one actor.
create index if not exists idx_wyr_votes_actor
  on public.would_you_rather_votes(actor_key, created_at desc)
  where actor_key is not null;

-- ---------------------------------------------------------------------------
-- 2. The counter trigger handles UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.would_you_rather_apply_vote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.would_you_rather_trades
       set votes_a = votes_a + (case when new.side = 'a' then 1 else 0 end),
           votes_b = votes_b + (case when new.side = 'b' then 1 else 0 end)
     where id = new.trade_id;
    return new;

  elsif tg_op = 'DELETE' then
    update public.would_you_rather_trades
       set votes_a = greatest(0, votes_a - (case when old.side = 'a' then 1 else 0 end)),
           votes_b = greatest(0, votes_b - (case when old.side = 'b' then 1 else 0 end))
     where id = old.trade_id;
    return old;

  elsif tg_op = 'UPDATE' then
    -- Nothing in the application updates a vote. It is here so that the claim
    -- "the row and the counter can never disagree" holds against a service-role
    -- correction as well, rather than only against the paths we happen to have
    -- written. Handles a moved trade_id as well as a changed side.
    if old.trade_id is distinct from new.trade_id then
      update public.would_you_rather_trades
         set votes_a = greatest(0, votes_a - (case when old.side = 'a' then 1 else 0 end)),
             votes_b = greatest(0, votes_b - (case when old.side = 'b' then 1 else 0 end))
       where id = old.trade_id;
      update public.would_you_rather_trades
         set votes_a = votes_a + (case when new.side = 'a' then 1 else 0 end),
             votes_b = votes_b + (case when new.side = 'b' then 1 else 0 end)
       where id = new.trade_id;
    elsif old.side is distinct from new.side then
      update public.would_you_rather_trades
         set votes_a = greatest(0, votes_a
               - (case when old.side = 'a' then 1 else 0 end)
               + (case when new.side = 'a' then 1 else 0 end)),
             votes_b = greatest(0, votes_b
               - (case when old.side = 'b' then 1 else 0 end)
               + (case when new.side = 'b' then 1 else 0 end))
       where id = new.trade_id;
    end if;
    return new;
  end if;

  return null;
end;
$$;

-- `revoke ... from public` alone leaves Supabase's named anon and authenticated
-- grants in place, so all three roles are named. Repeated after the CREATE OR
-- REPLACE because the grants are re-evaluated.
revoke all on function public.would_you_rather_apply_vote() from public;
revoke all on function public.would_you_rather_apply_vote() from anon;
revoke all on function public.would_you_rather_apply_vote() from authenticated;

drop trigger if exists trg_would_you_rather_apply_vote on public.would_you_rather_votes;
create trigger trg_would_you_rather_apply_vote
  after insert or update or delete on public.would_you_rather_votes
  for each row execute function public.would_you_rather_apply_vote();

-- ---------------------------------------------------------------------------
-- 3. Raw Discord payload
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_discord_polls
  add column if not exists metadata jsonb;

comment on column public.would_you_rather_discord_polls.metadata is
  'Discord''s raw poll object as returned when the results were read. Nullable: '
  'a poll that failed before Discord answered has none. Never modified once '
  'written.';

-- ---------------------------------------------------------------------------
-- 4. The cached grade
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_trades
  add column if not exists graded jsonb,
  add column if not exists graded_at timestamptz;

comment on column public.would_you_rather_trades.graded is
  'The LeagueTradeSignalCheck this trade last graded to. Service-role only, and '
  'never sent to a browser: the round DTO is rebuilt from it and carries no '
  'values. Stale past WYR_GRADE_TTL_MS, at which point it is recomputed.';

-- ---------------------------------------------------------------------------
-- 5. The serving index that matches the serving query
-- ---------------------------------------------------------------------------
create index if not exists idx_wyr_trades_least_served
  on public.would_you_rather_trades(status, served_count, added_at);

-- Superseded by the index above; nothing orders by last_served_at.
drop index if exists public.idx_wyr_trades_serving;

-- ---------------------------------------------------------------------------
-- 6. The two hot reads this feature drives
-- ---------------------------------------------------------------------------
create index if not exists idx_league_transactions_trade_scan
  on public.league_transactions(type, status, id);

create index if not exists idx_players_external_sleeper
  on public.players((external_ids->>'sleeper'));
