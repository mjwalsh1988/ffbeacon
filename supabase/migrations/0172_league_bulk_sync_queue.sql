-- Migration 0172: the Sync all queue behind My Sleeper Leagues
--
-- What this backs
--   /my-beacon/sleeper-leagues gains one button that syncs every league the
--   signed-in user has, instead of pressing Sync on each row in turn. Somebody
--   with eighteen leagues is not going to press eighteen buttons and wait out a
--   cooldown between each one.
--
--   The button does NOT run eighteen syncs. It writes eighteen rows here and
--   returns. A worker (app/api/cron/league-sync-worker, every minute) drains
--   them a few at a time. That is what lets the page say "you can leave", and it
--   is what keeps a burst of league pulses from arriving at Sleeper all at once.
--
--   This is the dashboard only. The public /tools/league-pulse tool keeps its
--   one-league-at-a-time button (migration 0168) and gains nothing from here.
--
-- Access matrix
--   league_bulk_sync_requests  : service_role ALL. authenticated SELECT own rows
--                                (the page reads its own progress and its own
--                                next-allowed time). anon nothing. No client
--                                writes on any path.
--   league_sync_jobs           : same shape, same reasoning.
--   enqueue_bulk_league_sync   : EXECUTE service_role only. Called by
--                                app/api/leagues/bulk-sync/route.ts after it has
--                                established who the caller is.
--   claim_league_sync_jobs     : EXECUTE service_role only. Called by the worker.
--
--   Reads are open to the owner because everything in these rows is the owner's
--   own request: which of their leagues is queued, and how far it got. Writes are
--   service-role only because the 12-hour limit and the queue depth are the two
--   things a client would want to lie about.
--
-- Why the once-per-12-hours limit lives in an RPC rather than in the route
--   Two clicks landing together would both read "no request in the window" and
--   both enqueue. The check and the insert have to be one transaction, and the
--   per-user advisory lock is what makes concurrent callers take turns instead of
--   interleaving. A limit you can beat by double-clicking is not a limit.
--
-- Why jobs carry user_id when request_id already implies it
--   Two things need it directly: the owner-read RLS policy (no join), and the
--   partial unique index that stops the same league being queued twice for the
--   same person while an earlier attempt is still in flight.
--
-- Rollback note (no down migration ships):
--   drop function if exists public.claim_league_sync_jobs(int);
--   drop function if exists public.enqueue_bulk_league_sync(uuid, jsonb, int);
--   drop table if exists public.league_sync_jobs;
--   drop table if exists public.league_bulk_sync_requests;

-- ---------------------------------------------------------------------------
-- One row per press of Sync all
-- ---------------------------------------------------------------------------
--
-- Doubles as the rate-limit ledger: the newest row's requested_at is what the
-- 12-hour window is measured from, so there is no second table to keep in step.

create table if not exists public.league_bulk_sync_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  -- How many jobs this request actually queued, after duplicates were dropped.
  league_count int not null default 0,
  -- Stamped by the worker once no job for this request is pending or processing.
  completed_at timestamptz
);

comment on table public.league_bulk_sync_requests is
  'One row per Sync all press on /my-beacon/sleeper-leagues. The newest row per user is also the once-per-12-hours ledger: the window is measured from requested_at. Owner-readable, service_role-writable.';

create index if not exists league_bulk_sync_requests_user_idx
  on public.league_bulk_sync_requests (user_id, requested_at desc);

-- ---------------------------------------------------------------------------
-- One row per league in that press
-- ---------------------------------------------------------------------------

create table if not exists public.league_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references public.league_bulk_sync_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sleeper's own league id. No FK: the leagues we most want to queue are the
  -- ones nobody has opened, which have no row in public.leagues yet.
  sleeper_league_id text not null,
  -- Copied at enqueue time so progress can name the league without a join to a
  -- row that may not exist.
  league_name text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.league_sync_jobs is
  'Queue of per-league pulses created by Sync all. Drained by /api/cron/league-sync-worker a few at a time so a user with many leagues never fans out into simultaneous Sleeper traffic. Owner-readable, service_role-writable.';

-- The worker's claim predicate, and nothing else. Partial so the index stays the
-- size of the backlog rather than the size of the history.
create index if not exists league_sync_jobs_pending_idx
  on public.league_sync_jobs (run_after)
  where status = 'pending';

-- The reaper's predicate: rows a dead worker left mid-flight.
create index if not exists league_sync_jobs_processing_idx
  on public.league_sync_jobs (updated_at)
  where status = 'processing';

create index if not exists league_sync_jobs_request_idx
  on public.league_sync_jobs (request_id);

create index if not exists league_sync_jobs_user_idx
  on public.league_sync_jobs (user_id, created_at desc);

-- A league already queued (or mid-sync) for this user is not queued again. The
-- enqueue RPC leans on this with ON CONFLICT DO NOTHING rather than pre-checking,
-- so the guarantee holds under concurrency instead of only under good manners.
create unique index if not exists league_sync_jobs_active_unique
  on public.league_sync_jobs (user_id, sleeper_league_id)
  where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Auto-RLS leaves both tables at zero policies, which blocks everything. Add the
-- two each is supposed to have and nothing else.

alter table public.league_bulk_sync_requests enable row level security;
alter table public.league_sync_jobs enable row level security;

drop policy if exists league_bulk_sync_requests_service_role_all
  on public.league_bulk_sync_requests;
create policy league_bulk_sync_requests_service_role_all
  on public.league_bulk_sync_requests
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists league_bulk_sync_requests_select_own
  on public.league_bulk_sync_requests;
create policy league_bulk_sync_requests_select_own
  on public.league_bulk_sync_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists league_sync_jobs_service_role_all on public.league_sync_jobs;
create policy league_sync_jobs_service_role_all
  on public.league_sync_jobs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists league_sync_jobs_select_own on public.league_sync_jobs;
create policy league_sync_jobs_select_own
  on public.league_sync_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Read-only for the owner, nothing at all for a guest. The policies above cannot
-- grant what the table-level privileges withhold, so both halves are stated.
revoke all on table public.league_bulk_sync_requests from anon, authenticated;
revoke all on table public.league_sync_jobs from anon, authenticated;
grant select on table public.league_bulk_sync_requests to authenticated;
grant select on table public.league_sync_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue: the 12-hour check and the insert, in one transaction
-- ---------------------------------------------------------------------------
--
-- p_leagues is a jsonb array of { "sleeper_league_id": "...", "league_name": "..." }.
-- The caller builds it from Sleeper's own answer for that user, never from the
-- request body, so a client cannot queue work against leagues it has nothing to
-- do with.
--
-- Returns one of:
--   { "claimed": true, "request_id": "...", "queued": 12, "next_allowed_at": "..." }
--   { "claimed": false, "reason": "cooldown", "retry_after_seconds": 40311,
--     "next_allowed_at": "..." }
--   { "claimed": false, "reason": "already_queued" }   -- nothing new to add
--   { "claimed": false, "reason": "no_leagues" | "no_user" }
--
-- "already_queued" deliberately does NOT spend the window. Every league the
-- caller asked for is already in the queue, so the request did no work, and
-- charging twelve hours for a no-op would punish a reader for pressing a button
-- that had already worked.

create or replace function public.enqueue_bulk_league_sync(
  p_user_id uuid,
  p_leagues jsonb,
  p_cooldown_seconds int default 43200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_last public.league_bulk_sync_requests%rowtype;
  v_ready_at timestamptz;
  v_request_id uuid;
  v_queued int;
  v_asked int;
begin
  if p_user_id is null then
    return jsonb_build_object('claimed', false, 'reason', 'no_user');
  end if;

  v_asked := coalesce(jsonb_array_length(p_leagues), 0);
  if v_asked = 0 then
    return jsonb_build_object('claimed', false, 'reason', 'no_leagues');
  end if;

  -- Take turns per user for the rest of this transaction. Without it, two clicks
  -- landing together both read "no request in the window" and both enqueue.
  perform pg_advisory_xact_lock(hashtext('bulk_league_sync:' || p_user_id::text));

  select * into v_last
  from public.league_bulk_sync_requests
  where user_id = p_user_id
  order by requested_at desc
  limit 1;

  if found then
    v_ready_at := v_last.requested_at + make_interval(secs => p_cooldown_seconds);
    if v_now < v_ready_at then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'cooldown',
        'retry_after_seconds',
          greatest(1, ceil(extract(epoch from (v_ready_at - v_now)))::int),
        'next_allowed_at', v_ready_at
      );
    end if;
  end if;

  insert into public.league_bulk_sync_requests (user_id, league_count)
  values (p_user_id, 0)
  returning id into v_request_id;

  insert into public.league_sync_jobs
    (request_id, user_id, sleeper_league_id, league_name)
  select v_request_id,
         p_user_id,
         btrim(l->>'sleeper_league_id'),
         nullif(btrim(coalesce(l->>'league_name', '')), '')
  from jsonb_array_elements(p_leagues) as l
  where coalesce(btrim(l->>'sleeper_league_id'), '') <> ''
  -- No conflict target: any unique violation means this league is already in
  -- flight for this user, whatever index caught it.
  on conflict do nothing;

  get diagnostics v_queued = row_count;

  if v_queued = 0 then
    -- Everything asked for was already queued. Undo the request row so the
    -- 12-hour window is not spent on a press that changed nothing.
    delete from public.league_bulk_sync_requests where id = v_request_id;
    return jsonb_build_object('claimed', false, 'reason', 'already_queued');
  end if;

  update public.league_bulk_sync_requests
     set league_count = v_queued
   where id = v_request_id;

  return jsonb_build_object(
    'claimed', true,
    'request_id', v_request_id,
    'queued', v_queued,
    'next_allowed_at', v_now + make_interval(secs => p_cooldown_seconds)
  );
end;
$$;

comment on function public.enqueue_bulk_league_sync(uuid, jsonb, int) is
  'Atomically enforces the once-per-12-hours Sync all limit for one user and queues a league_sync_jobs row per league. Returns {claimed:true, request_id, queued, next_allowed_at} or {claimed:false, reason, ...}. service_role-only EXECUTE: /api/leagues/bulk-sync resolves the user from the session and the league list from Sleeper, never from the request body.';

revoke all on function public.enqueue_bulk_league_sync(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_bulk_league_sync(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_bulk_league_sync(uuid, jsonb, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Claim: the worker's batch, taken atomically
-- ---------------------------------------------------------------------------
--
-- Same shape and same reasoning as bb_claim_jobs (migration 0093). FOR UPDATE
-- SKIP LOCKED so two worker runs that overlap (a slow run still going when the
-- next minute fires) take different rows instead of the same ones.

create or replace function public.claim_league_sync_jobs(p_limit int)
returns setof public.league_sync_jobs
language sql
-- Pinned even though every name below is already schema-qualified and this runs
-- as the caller: an unpinned search_path is a standing invitation to resolve
-- something unexpected later, and the linter is right to say so.
set search_path = public, pg_temp
as $$
  with claimed as (
    select id
    from public.league_sync_jobs
    where status = 'pending'
      and run_after <= now()
    order by run_after, created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 0), 0)
  )
  update public.league_sync_jobs j
     set status = 'processing',
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
$$;

comment on function public.claim_league_sync_jobs(int) is
  'Atomically claims up to p_limit due league_sync_jobs (FOR UPDATE SKIP LOCKED) and flips them to processing. SECURITY INVOKER: runs as the caller and respects league_sync_jobs RLS. service_role-only EXECUTE.';

revoke all on function public.claim_league_sync_jobs(int) from public;
revoke execute on function public.claim_league_sync_jobs(int) from anon, authenticated;
grant execute on function public.claim_league_sync_jobs(int) to service_role;
