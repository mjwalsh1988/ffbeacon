-- Migration 0225: Would You Rather (the trade voting game)
--
-- A real trade out of a real synced league, stripped of every name that could
-- identify the managers in it, put in front of a reader who calls the winner.
-- After the vote they see where everyone else landed and then the full Signal
-- Check read, which is deliberately withheld until the vote is in: the whole
-- point of the game is an unprimed opinion.
--
-- FOUR TABLES, AND WHY EACH ONE EXISTS
--
--   would_you_rather_settings   One global jsonb row, same shape as
--                               signal_scout_settings and
--                               league_power_pulse_settings. Feature gate,
--                               guest allowance, and the Discord schedule.
--
--   would_you_rather_trades     The pool. A row here is a trade that has
--                               already been proven gradeable, so the game
--                               never has to discover mid-request that the
--                               trade it picked cannot be scored. It also
--                               PINS which roster is Team A, so the labels
--                               are the same on the site, in the Discord
--                               poll, and on a reload three weeks later.
--
--   would_you_rather_votes      One row per voter per trade. The uniqueness
--                               is the whole feature: a vote that can land
--                               twice makes every percentage on screen a lie.
--                               Enforced by two partial unique indexes rather
--                               than application code.
--
--   would_you_rather_discord_polls
--                               One row per poll posted to Discord, keyed by
--                               the schedule slot it was posted for. Discord
--                               returns aggregate counts and no voter
--                               identities, so those counts are ingested ONCE
--                               onto the trade row and the ingestion is
--                               guarded by results_ingested_at. Re-running the
--                               cron cannot re-add them.
--
-- WHY THE SITE TALLY IS A TRIGGER AND THE DISCORD TALLY IS A COLUMN
--   A site vote is a row, so its count is derivable and is kept in step by a
--   trigger: the row and the counter can never disagree. A Discord vote is not
--   a row we own, it is a number Discord hands back for a poll that has closed,
--   with no way to attribute it to a person. Storing it as its own pair of
--   columns keeps the two provenances separate on screen ("1,204 votes,
--   including 96 from Discord") and makes double counting structurally
--   impossible rather than merely unlikely.
--
-- Access matrix:
--   would_you_rather_settings
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--   would_you_rather_trades
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--       (Every read is server-side. The pool row carries the serving order and
--        the side pinning, which a client has no use for, and the game's own
--        responses are assembled by the route handlers.)
--   would_you_rather_votes
--     anon          : NONE
--     authenticated : SELECT own rows only (auth.uid() = user_id). No writes:
--                     the vote route inserts with the service role after it has
--                     resolved the voter itself, so a client cannot vote as
--                     somebody else or vote twice by writing directly.
--     service_role  : ALL
--   would_you_rather_discord_polls
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table if not exists public.would_you_rather_settings (
  id text primary key default 'global',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint would_you_rather_settings_singleton check (id = 'global')
);

alter table public.would_you_rather_settings enable row level security;

drop policy if exists would_you_rather_settings_service_role_all
  on public.would_you_rather_settings;
create policy would_you_rather_settings_service_role_all
  on public.would_you_rather_settings
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- The pool
-- ---------------------------------------------------------------------------
create table if not exists public.would_you_rather_trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  transaction_id uuid not null references public.league_transactions(id) on delete cascade,
  -- Carried alongside the FK because the Discord poll and the share copy both
  -- name the trade by its Sleeper id, and neither should have to join to do it.
  sleeper_transaction_id text not null,
  season integer,
  week integer,
  -- A dynasty STARTUP draft trade reads completely differently from a normal
  -- one (its picks became players), and the game labels it as such, so the fact
  -- is stored rather than re-derived on every serve.
  is_startup boolean not null default false,
  -- WHICH ROSTER IS TEAM A. Pinned at pool time, lowest Sleeper roster id
  -- first, matching how lib/league-signal-check.ts orders the two sides. Every
  -- surface reads these, so "Team A" means the same roster everywhere forever.
  side_a_roster_id integer not null,
  side_b_roster_id integer not null,
  -- How many assets each side receives. Used to keep one-sided salary dumps out
  -- of the pool and to size the Discord poll answers.
  side_a_asset_count integer not null default 0,
  side_b_asset_count integer not null default 0,
  status text not null default 'active'
    check (status in ('active', 'retired')),
  -- Site votes. Maintained by trigger; never written by hand.
  votes_a integer not null default 0 check (votes_a >= 0),
  votes_b integer not null default 0 check (votes_b >= 0),
  -- Discord poll votes, written once by the ingestion job.
  discord_votes_a integer not null default 0 check (discord_votes_a >= 0),
  discord_votes_b integer not null default 0 check (discord_votes_b >= 0),
  -- Serving bookkeeping, so the game can spread rounds across the pool instead
  -- of showing the same trade to everyone on the same afternoon.
  served_count integer not null default 0,
  last_served_at timestamptz,
  discord_posted_at timestamptz,
  added_at timestamptz not null default now(),
  constraint would_you_rather_trades_sides_differ
    check (side_a_roster_id <> side_b_roster_id),
  unique (transaction_id)
);

-- The serving query: active rows, least recently served first.
create index if not exists idx_wyr_trades_serving
  on public.would_you_rather_trades(status, last_served_at nulls first, added_at);
create index if not exists idx_wyr_trades_league
  on public.would_you_rather_trades(league_id);

alter table public.would_you_rather_trades enable row level security;

drop policy if exists would_you_rather_trades_service_role_all
  on public.would_you_rather_trades;
create policy would_you_rather_trades_service_role_all
  on public.would_you_rather_trades
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Votes
-- ---------------------------------------------------------------------------
create table if not exists public.would_you_rather_votes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.would_you_rather_trades(id) on delete cascade,
  -- Exactly one of these is set. A signed-in vote follows the person across
  -- devices; a guest vote is anchored to the game's own guest cookie and is the
  -- thing the two-vote free trial counts.
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid,
  side text not null check (side in ('a', 'b')),
  created_at timestamptz not null default now(),
  constraint would_you_rather_votes_one_voter check (
    (user_id is not null and guest_id is null)
    or (user_id is null and guest_id is not null)
  )
);

-- ONE VOTE PER PERSON PER TRADE. Partial unique indexes rather than a single
-- composite, because a null in a unique tuple does not collide in Postgres and
-- a composite would therefore permit unlimited guest votes.
create unique index if not exists uq_wyr_votes_user
  on public.would_you_rather_votes(trade_id, user_id)
  where user_id is not null;
create unique index if not exists uq_wyr_votes_guest
  on public.would_you_rather_votes(trade_id, guest_id)
  where guest_id is not null;

-- "How many free votes has this guest used", and the same question for a user
-- being shown their history.
create index if not exists idx_wyr_votes_guest
  on public.would_you_rather_votes(guest_id, created_at desc)
  where guest_id is not null;
create index if not exists idx_wyr_votes_user_recent
  on public.would_you_rather_votes(user_id, created_at desc)
  where user_id is not null;

alter table public.would_you_rather_votes enable row level security;

drop policy if exists would_you_rather_votes_select_own on public.would_you_rather_votes;
create policy would_you_rather_votes_select_own on public.would_you_rather_votes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists would_you_rather_votes_service_role_all on public.would_you_rather_votes;
create policy would_you_rather_votes_service_role_all on public.would_you_rather_votes
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Site vote counters, kept in step by trigger
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
  end if;
  return null;
end;
$$;

revoke all on function public.would_you_rather_apply_vote() from public;
revoke all on function public.would_you_rather_apply_vote() from anon;
revoke all on function public.would_you_rather_apply_vote() from authenticated;

drop trigger if exists trg_would_you_rather_apply_vote on public.would_you_rather_votes;
create trigger trg_would_you_rather_apply_vote
  after insert or delete on public.would_you_rather_votes
  for each row execute function public.would_you_rather_apply_vote();

-- ---------------------------------------------------------------------------
-- Discord polls
-- ---------------------------------------------------------------------------
create table if not exists public.would_you_rather_discord_polls (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.would_you_rather_trades(id) on delete cascade,
  webhook_id uuid references public.discord_webhooks(id) on delete set null,
  discord_message_id text,
  -- The schedule slot this poll was posted FOR, as an Eastern-time
  -- "YYYY-MM-DD-HH" key. Unique, so a retried or double-fired cron tick cannot
  -- post the same slot twice, which is the only way this job could spam a
  -- channel.
  slot_key text not null unique,
  posted_at timestamptz not null default now(),
  closes_at timestamptz not null,
  results_ingested_at timestamptz,
  ingested_votes_a integer,
  ingested_votes_b integer,
  status text not null default 'posted'
    check (status in ('posted', 'ingested', 'error')),
  error text,
  constraint would_you_rather_discord_polls_ingest_shape check (
    results_ingested_at is null
    or (ingested_votes_a is not null and ingested_votes_b is not null)
  )
);

-- The ingestion sweep: polls that have closed and have not been counted yet.
create index if not exists idx_wyr_discord_polls_pending
  on public.would_you_rather_discord_polls(closes_at)
  where results_ingested_at is null;
create index if not exists idx_wyr_discord_polls_trade
  on public.would_you_rather_discord_polls(trade_id);

alter table public.would_you_rather_discord_polls enable row level security;

drop policy if exists would_you_rather_discord_polls_service_role_all
  on public.would_you_rather_discord_polls;
create policy would_you_rather_discord_polls_service_role_all
  on public.would_you_rather_discord_polls
  for all to service_role
  using (true)
  with check (true);
