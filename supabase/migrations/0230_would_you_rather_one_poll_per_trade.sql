-- ---------------------------------------------------------------------------
-- Would You Rather: a trade reaches Discord once, and once only
-- ---------------------------------------------------------------------------
-- THE PROBLEM. Discord hands a closed poll's results back as AGGREGATE COUNTS
-- with no voter identities attached (`answer_counts`, a number per answer). We
-- can see that 41 people picked Team A. We cannot see who they were. So if the
-- same trade were posted twice, and the same person voted on both polls, the
-- two aggregates would each include them and the trade's Discord tally would
-- count that person twice. Nothing downstream could detect it: the numbers look
-- exactly like 82 different people.
--
-- THE FIX IS TO MAKE THE SITUATION IMPOSSIBLE RATHER THAN TO DETECT IT. A trade
-- is posted to Discord at most once, so a Discord user cannot be offered the
-- same trade a second time. Within that one poll, Discord itself enforces one
-- vote per person: we post with `allow_multiselect: false` (lib/discord.ts
-- buildBody), so a voter appears in exactly one answer's count, and changing
-- their mind moves the vote rather than adding one.
--
-- Two guards, deliberately both:
--
--   The pick already refuses a trade with `discord_posted_at` set, which is
--   stamped only after Discord accepts the message and is never cleared. That
--   is what stops the second post from ever being composed.
--
--   This index is what makes it unrepresentable. The claim row is inserted
--   BEFORE the message is sent, so a second claim for a trade that already has
--   a live poll fails at insert time and nothing is sent. Without it the "at
--   most one poll per trade" invariant would rest entirely on application code,
--   and `recomputeDiscordTally` sums a trade's polls: two rows would silently
--   double the tally, which is the exact bug being closed.
--
-- WHY `status <> 'error'`. A post that never reached Discord leaves its claim
-- row behind on purpose (it stops the next tick in the same hour from hammering
-- a Discord that is already rejecting us) and marks it 'error'. Nobody saw that
-- trade, so it must stay eligible. Excluding 'error' rows frees it. Note the
-- companion change in lib/would-you-rather/discord.ts: a poll that DID reach
-- Discord but came back unreadable is now closed out as 'ingested' with an
-- explanatory note rather than as 'error', because marking it 'error' would
-- release a trade real people have already voted on.
--
-- idx_wyr_trades_discord_stale is dropped with the second pick pass it served.
-- That pass re-posted the trade Discord saw longest ago once everything had
-- been posted, which is the very thing this migration forbids. An exhausted
-- pool now skips the hour and says so, and the admin grows the pool.
--
-- Access matrix: unchanged. The table stays service-role only.
-- ---------------------------------------------------------------------------

create unique index if not exists idx_wyr_discord_polls_one_per_trade
  on public.would_you_rather_discord_polls(trade_id)
  where status <> 'error';

drop index if exists public.idx_wyr_trades_discord_stale;
