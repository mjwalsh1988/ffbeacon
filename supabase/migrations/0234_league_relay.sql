-- Migration 0234: League Relay (community league updates into Discord)
--
-- A COMMUNITY LEAGUE is a league already synced into FF Beacon that an admin has
-- nominated. Nominating it does two things: it resyncs every 15 minutes instead
-- of only when somebody opens it, and its activity is written up and posted into
-- Discord.
--
-- THREE TABLES, AND WHY EACH ONE EXISTS
--
--   community_leagues     Which leagues are nominated, and the WATERMARK. The
--                         watermark is the whole reason this is not just a
--                         boolean column on `leagues`: a league nominated today
--                         has a season of transactions already stored, and none
--                         of them are news. Nothing older than the watermark is
--                         ever written up.
--
--   league_relay_settings One global jsonb row, the same shape as
--                         would_you_rather_settings and
--                         league_power_pulse_settings. Holds the per-message-
--                         type enable flag and the per-message-type webhook.
--
--   league_relay_posts    The ledger, and the guarantee. One row per message,
--                         claimed on a UNIQUE dedupe_key BEFORE anything is
--                         sent. A claim taken after the send is a claim that
--                         does not stop the send, which is exactly how a retried
--                         cron tick posts the same trade twice.
--
-- WHY THE WATERMARK IS A TIMESTAMP AND NOT A "last processed id"
--   Sleeper backfills. A transaction can appear in our table carrying a
--   created_at_sleeper EARLIER than one we have already handled, because the
--   week it belongs to was refetched. An id-based cursor would skip it forever.
--   A timestamp plus the ledger's unique key means a late arrival is picked up
--   on the next tick and still cannot be posted twice.
--
-- Access matrix:
--   community_leagues
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--   league_relay_settings
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--   league_relay_posts
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--       (Every read is the admin panel, which runs server-side with the service
--        client behind requireAdmin. Nothing here is public: the ledger keeps
--        the rendered message, which names managers in a private league.)

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table if not exists public.league_relay_settings (
  id text primary key default 'global',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint league_relay_settings_singleton check (id = 'global')
);

alter table public.league_relay_settings enable row level security;

drop policy if exists league_relay_settings_service_role_all
  on public.league_relay_settings;
create policy league_relay_settings_service_role_all
  on public.league_relay_settings
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- The nominated leagues
-- ---------------------------------------------------------------------------
create table if not exists public.community_leagues (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  -- Carried alongside the FK because the sync path holds a Sleeper id and the
  -- admin panel searches on one. Unique, so a league cannot be nominated twice
  -- under two spellings.
  sleeper_league_id text not null,
  -- An admin's own name for it, when the Sleeper name is unhelpful. Null means
  -- "use leagues.name".
  label text,
  is_active boolean not null default true,
  -- NOTHING BEFORE THIS IS NEWS. Set to now() on nomination. Every writeup path
  -- filters on it, so nominating a league in November posts what happens next
  -- rather than replaying September into the channel.
  watermark_at timestamptz not null default now(),
  -- Sync bookkeeping, written by the relay cron.
  last_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'ok', 'error')),
  sync_detail text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id),
  unique (sleeper_league_id)
);

alter table public.community_leagues enable row level security;

drop policy if exists community_leagues_service_role_all on public.community_leagues;
create policy community_leagues_service_role_all
  on public.community_leagues
  for all to service_role
  using (true)
  with check (true);

-- The cron's only read: active leagues, least recently synced first, so a
-- capped run rotates through them instead of starving the tail.
create index if not exists idx_community_leagues_due
  on public.community_leagues(is_active, last_synced_at nulls first);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
create table if not exists public.league_relay_posts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  message_type text not null
    check (message_type in ('trade', 'waiver', 'matchup_preview', 'matchup_recap')),
  -- THE GUARANTEE. Unique, and claimed before the message is built or sent.
  --   trade:<league_id>:<sleeper_transaction_id>
  --   waiver:<league_id>:<sleeper_transaction_id>
  --   preview:<league_id>:<season>:<week>:<headline|undercard>
  --   recap:<league_id>:<season>:<week>:<lowest sleeper_roster_id in the game>
  --   recap-hour:<league_id>:<eastern YYYY-MM-DD-HH>
  -- The last one is a rate claim rather than a message, which is why 'reserved'
  -- is a status: it is how Tuesday posts one recap an hour instead of the whole
  -- week's slate on the first tick after eleven.
  dedupe_key text not null,
  season integer,
  week integer,
  -- Which discord_webhooks row it went to. Null on a row that never got as far
  -- as choosing one.
  webhook_id uuid references public.discord_webhooks(id) on delete set null,
  status text not null default 'claimed'
    check (status in ('claimed', 'posted', 'error', 'skipped', 'reserved')),
  discord_message_id text,
  discord_channel_id text,
  -- The rendered message, exactly as sent. Kept so the admin panel can show
  -- what went out without asking Discord for it, and so a complaint about a
  -- writeup is answered with the text rather than a reconstruction of it.
  payload jsonb,
  error text,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (dedupe_key)
);

alter table public.league_relay_posts enable row level security;

drop policy if exists league_relay_posts_service_role_all on public.league_relay_posts;
create policy league_relay_posts_service_role_all
  on public.league_relay_posts
  for all to service_role
  using (true)
  with check (true);

-- The admin panel's feed: newest first, optionally narrowed to one league.
create index if not exists idx_league_relay_posts_recent
  on public.league_relay_posts(created_at desc);
create index if not exists idx_league_relay_posts_league
  on public.league_relay_posts(league_id, created_at desc);
