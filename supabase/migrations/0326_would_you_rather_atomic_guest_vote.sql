-- Migration 0326: Would You Rather, the guest allowance checked and spent in
-- one statement
--
-- The vote route counted a guest's votes (by cookie and by actor, the higher
-- of the two), compared the count with guest_vote_limit, and only then
-- inserted. Check-then-insert: a guest with one free vote left who fires five
-- votes at five different trades in parallel had all five pass the check
-- before any of them landed, so the cap was a suggestion.
--
-- cast_would_you_rather_guest_vote does the check and the insert inside one
-- transaction, serialized per guest id AND per actor key with transaction-
-- scoped advisory locks, so the second of two parallel votes sees the first
-- one's row before it counts. Locks are always taken guest first, then actor,
-- so two calls can never wait on each other in opposite orders.
--
-- THE UNIQUE INDEXES STILL DECIDE "ALREADY VOTED". The function reads an
-- existing row for (trade, guest) first so a repeat vote returns the side
-- originally picked and spends nothing, and the insert itself still goes
-- through uq_wyr_votes_guest: a 23505 from it is read as already voted, never
-- swallowed as success. Nothing here replaces or weakens either index.
--
-- Signed-in readers do not come through here. They have no allowance, and
-- their insert stays the plain attempted insert in lib/would-you-rather/vote.ts.
--
-- Returns jsonb: { status, side, used }
--   status 'inserted'       the vote landed; used counts it
--   status 'already_voted'  this guest had voted on this trade; side is theirs
--   status 'limit_reached'  nothing written; used is the count that refused it
--   status 'not_found'      no such trade (foreign key)
--
-- Access matrix
--   anon          : no EXECUTE
--   authenticated : no EXECUTE
--   service_role  : EXECUTE (the vote route calls it with the admin client)
--   SECURITY DEFINER with a pinned search_path; revoked from public, anon and
--   authenticated by name, because Supabase's default grants name those roles.
--   No table or policy changes.
--
-- Safe to apply before the code deploys: it only adds a function. The code
-- that calls it must not deploy before this migration, or guest votes fail
-- with a server error until it is applied.
--
-- Rollback note (no down migration ships):
--   drop function if exists public.cast_would_you_rather_guest_vote(uuid, uuid, text, text, int);

create or replace function public.cast_would_you_rather_guest_vote(
  p_trade_id uuid,
  p_guest_id uuid,
  p_side text,
  p_actor_key text,
  p_limit int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_existing text;
  v_by_cookie int;
  v_by_actor int := 0;
  v_used int;
  v_actor text := nullif(btrim(coalesce(p_actor_key, '')), '');
begin
  if p_trade_id is null or p_guest_id is null then
    raise exception 'trade and guest are required';
  end if;
  if p_side not in ('a', 'b') then
    raise exception 'side must be a or b';
  end if;

  -- Serialize every vote by this guest, and every vote by this actor, for the
  -- rest of this transaction. Guest first, then actor, always.
  perform pg_advisory_xact_lock(hashtext('wyr_guest_vote:guest:' || p_guest_id::text));
  if v_actor is not null then
    perform pg_advisory_xact_lock(hashtext('wyr_guest_vote:actor:' || v_actor));
  end if;

  -- A repeat is the reveal for the side they originally picked, and costs
  -- nothing against the allowance.
  select side into v_existing
  from public.would_you_rather_votes
  where trade_id = p_trade_id and guest_id = p_guest_id
  limit 1;
  if found then
    select count(*) into v_by_cookie from public.would_you_rather_votes where guest_id = p_guest_id;
    if v_actor is not null then
      select count(*) into v_by_actor from public.would_you_rather_votes where actor_key = v_actor;
    end if;
    return jsonb_build_object('status', 'already_voted', 'side', v_existing,
                              'used', greatest(v_by_cookie, v_by_actor));
  end if;

  select count(*) into v_by_cookie from public.would_you_rather_votes where guest_id = p_guest_id;
  if v_actor is not null then
    select count(*) into v_by_actor from public.would_you_rather_votes where actor_key = v_actor;
  end if;
  v_used := greatest(v_by_cookie, v_by_actor);

  if v_used >= greatest(coalesce(p_limit, 0), 0) then
    return jsonb_build_object('status', 'limit_reached', 'side', null, 'used', v_used);
  end if;

  begin
    insert into public.would_you_rather_votes (trade_id, user_id, guest_id, side, actor_key)
    values (p_trade_id, null, p_guest_id, p_side, v_actor);
  exception
    when unique_violation then
      select side into v_existing
      from public.would_you_rather_votes
      where trade_id = p_trade_id and guest_id = p_guest_id
      limit 1;
      return jsonb_build_object('status', 'already_voted', 'side', v_existing, 'used', v_used);
    when foreign_key_violation then
      return jsonb_build_object('status', 'not_found', 'side', null, 'used', v_used);
  end;

  return jsonb_build_object('status', 'inserted', 'side', p_side, 'used', v_used + 1);
end;
$fn$;

comment on function public.cast_would_you_rather_guest_vote(uuid, uuid, text, text, int) is
  'Records one Would You Rather guest vote only if the guest is under guest_vote_limit, counting max(votes by guest cookie, votes by actor) inside the same transaction under per-guest and per-actor advisory locks, so parallel votes cannot overrun the cap. A repeat vote returns the original side and spends nothing; the unique indexes still decide already-voted. service_role-only EXECUTE.';

revoke all on function public.cast_would_you_rather_guest_vote(uuid, uuid, text, text, int) from public;
revoke execute on function public.cast_would_you_rather_guest_vote(uuid, uuid, text, text, int)
  from anon, authenticated;
grant execute on function public.cast_would_you_rather_guest_vote(uuid, uuid, text, text, int)
  to service_role;
