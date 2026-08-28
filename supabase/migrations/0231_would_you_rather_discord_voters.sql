-- ---------------------------------------------------------------------------
-- Would You Rather: count Discord votes by voter, not by total
-- ---------------------------------------------------------------------------
-- Migration 0230 prevented a trade from reaching Discord twice, because the
-- only thing we read back was `answer_counts`: a number per answer, with no
-- names on it. A count cannot be deduplicated, so the same person inside two
-- polls looks exactly like two people, and the only defence was to make the
-- second poll impossible.
--
-- Names ARE available, from a different endpoint:
--
--   GET /channels/{channel_id}/polls/{message_id}/answers/{answer_id}
--
-- It is channel-scoped and bot-authenticated rather than webhook-authenticated,
-- and it returns the voters themselves, 100 at a time. So each Discord vote can
-- be stored as its own row and deduplicated properly, which is what this
-- migration is for.
--
-- would_you_rather_discord_votes
--   One row per Discord voter per trade. The unique index on
--   (trade_id, discord_user_id) IS THE GUARANTEE: a person counts once on a
--   trade no matter how many polls it appears in, how many times ingestion
--   runs, or how many workers run it at once. The FIRST side recorded stands,
--   because the question is "have they already called this trade", and the
--   answer does not stop being yes when they change their mind on a later poll.
--
--   Only a Discord user id is kept. Not a username, not a display name, not an
--   avatar: none of them are needed to count a vote once, all of them go stale,
--   and this table exists to answer "has this person already voted on this
--   trade" rather than to describe anybody.
--
-- would_you_rather_discord_polls gains
--   discord_channel_id  Where the poll was posted. The voters endpoint is
--                       channel-scoped and a webhook URL does not name its
--                       channel, so this is captured from the create response
--                       (wait=true) and cannot be recovered afterwards.
--   answer_id_a / _b    Discord's own ids for the two answers, read back rather
--                       than assumed to be 1 and 2, so a vote stays attributed
--                       to the right side if Discord ever numbers differently.
--   voters_resolved     Whether this poll's voters were actually read. False
--                       means we only ever had its totals.
--
-- would_you_rather_trades.discord_identity_gap
--   True once any poll for that trade was counted from totals alone. Such a
--   trade can never go to Discord again: we do not know who voted on it, so a
--   repeat voter on a second poll could not be detected. A trade whose polls
--   were all resolved by voter CAN go again, safely, which is what lets the
--   0230 one-poll-per-trade index be dropped.
--
-- Access matrix:
--   would_you_rather_discord_votes
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--       (Written only by the ingestion cron. Nothing client-side reads it: the
--        site shows Discord's contribution as a total, and a list of the
--        Discord ids that voted on a trade is not something a reader is owed.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- What a poll needs to be readable by voter
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_discord_polls
  add column if not exists discord_channel_id text,
  add column if not exists answer_id_a integer,
  add column if not exists answer_id_b integer,
  add column if not exists voters_resolved boolean not null default false;

-- ---------------------------------------------------------------------------
-- One row per Discord voter per trade
-- ---------------------------------------------------------------------------
create table if not exists public.would_you_rather_discord_votes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null
    references public.would_you_rather_trades(id) on delete cascade,
  -- Which poll this vote was read from. Kept for the audit trail: a trade may
  -- legitimately have been polled more than once, and this says which one a
  -- given person answered.
  poll_id uuid not null
    references public.would_you_rather_discord_polls(id) on delete cascade,
  discord_user_id text not null,
  side text not null check (side in ('a', 'b')),
  created_at timestamptz not null default now()
);

-- THE GUARANTEE. One vote per Discord user per trade, enforced by the database
-- rather than by a read-then-write in application code, which two workers
-- racing would both pass.
create unique index if not exists uq_wyr_discord_votes_trade_voter
  on public.would_you_rather_discord_votes(trade_id, discord_user_id);

-- The tally reads every row for a trade and counts by side.
create index if not exists idx_wyr_discord_votes_trade_side
  on public.would_you_rather_discord_votes(trade_id, side);

create index if not exists idx_wyr_discord_votes_poll
  on public.would_you_rather_discord_votes(poll_id);

alter table public.would_you_rather_discord_votes enable row level security;

drop policy if exists would_you_rather_discord_votes_service_role_all
  on public.would_you_rather_discord_votes;
create policy would_you_rather_discord_votes_service_role_all
  on public.would_you_rather_discord_votes
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Which trades can never go back to Discord
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_trades
  add column if not exists discord_identity_gap boolean not null default false;

-- Every poll that exists today was counted from totals alone, so every trade
-- already posted carries the gap. Backfilled rather than defaulted to false,
-- which would quietly declare those trades safe to post again.
update public.would_you_rather_trades t
set discord_identity_gap = true
where t.discord_posted_at is not null
  and t.discord_identity_gap = false;

-- 0230's index said "a trade reaches Discord once", which was the right rule
-- while a count was all we could read. The per-voter unique index above is a
-- stronger one and does not cost the pool its ability to bring a good trade
-- back, so this comes off. A trade with an identity gap is still held back, by
-- the flag rather than by the index.
drop index if exists public.idx_wyr_discord_polls_one_per_trade;

-- The second pick pass again: among trades Discord has already seen, the one it
-- saw longest ago, provided every poll for it was resolved by voter.
create index if not exists idx_wyr_trades_discord_repostable
  on public.would_you_rather_trades(discord_posted_at)
  where status = 'active' and discord_identity_gap = false;
