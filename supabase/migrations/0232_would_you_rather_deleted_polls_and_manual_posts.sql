-- ---------------------------------------------------------------------------
-- Would You Rather: a poll that no longer exists, and a post nobody scheduled
-- ---------------------------------------------------------------------------
-- TWO PROBLEMS, ONE TABLE.
--
-- 1. A DELETED MESSAGE WAS RETRIED FOREVER.
--    When somebody removes a poll from Discord by hand, the read-back returns
--    404 Unknown Message. Ingestion treated that like any other failed request:
--    a failed request is not evidence about a poll, so the row was left alone
--    for the next hourly sweep. Correct for a timeout or a 500, wrong for a 404,
--    which is a settled fact rather than a bad moment.
--
--    The row therefore never reached a terminal state. It kept its place at the
--    front of the pending sweep (ordered by closes_at ascending, limit 25) and
--    was retried every hour for as long as the row existed. Twenty five of them
--    would have filled that window and stopped ingestion for every other poll.
--
--    A deleted poll now closes out as `status = 'deleted'`, which is why that
--    value joins the check constraint. Not 'error', which in this table means
--    the message never reached Discord, and not 'ingested', which claims we
--    read something. Its votes are lost, honestly and visibly: nobody can read
--    a message that is gone.
--
--    The trade is NOT flagged with an identity gap and can go out again. That
--    is safe precisely because the deleted poll contributed nothing: a fresh
--    poll counts each person once, so there is no double count to prevent.
--
-- 2. THE MANUAL ADMIN POST WAS RATE LIMITED BY THE CRON'S GUARD.
--    "Post one now" runs the real path, which claims `slot_key`, a unique
--    Eastern "YYYY-MM-DD-HH". That guard exists to stop a retried or
--    double-fired CRON TICK from posting an hour twice. Applying it to a person
--    pressing a button was never the point: an admin who wants to send three
--    trades to the channel is not a duplicate cron tick, and was being told the
--    hour had already been posted.
--
--    slot_key becomes NULLABLE, and the uniqueness moves to a partial index
--    over the non-null values. A scheduled post still claims its hour and still
--    cannot post it twice. A manual post writes no slot_key at all, which says
--    exactly what it is: a post that claimed no schedule slot. Nothing in the
--    table needs a separate "was this manual" flag to say so.
--
-- Access matrix: unchanged. The table stays service-role only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A poll whose message is gone
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_discord_polls
  drop constraint if exists would_you_rather_discord_polls_status_check;

alter table public.would_you_rather_discord_polls
  add constraint would_you_rather_discord_polls_status_check
  check (status in ('posted', 'ingested', 'error', 'deleted'));

-- ---------------------------------------------------------------------------
-- A post that claimed no schedule slot
-- ---------------------------------------------------------------------------
alter table public.would_you_rather_discord_polls
  alter column slot_key drop not null;

drop index if exists public.idx_wyr_discord_polls_slot;

-- Still one scheduled post per Eastern hour. Manual posts carry no slot_key and
-- are simply not in this index, so any number of them can go out.
create unique index if not exists idx_wyr_discord_polls_slot
  on public.would_you_rather_discord_polls(slot_key)
  where slot_key is not null;
