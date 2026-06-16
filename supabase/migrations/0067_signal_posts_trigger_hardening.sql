-- Migration 0067: harden the signal_posts enforcement trigger
--
-- Two gaps in the migration 0061 trigger, both of which weakened the
-- "authoritative, path-independent" guarantee of the BEFORE INSERT trigger:
--
--   1. created_at was client-settable (it is in the insert GRANT), and the
--      rate-limit windows compare stored created_at against now(). A crafted
--      client could backdate a post to slip outside the 15s/hour/day windows and
--      partially evade the limiter. Fix: the trigger now FORCES
--      new.created_at := now() on insert, so the server timestamp is
--      authoritative regardless of what the client sends.
--
--   2. The max-3-links cap fired only on INSERT, so an owner could insert a
--      compliant post and then UPDATE the body to add unlimited links. Fix: the
--      trigger now also runs on UPDATE and re-checks the link cap. Rate-limit
--      windows still apply to INSERT only (edits are not new posts).
--
-- The "count ALL posts including hidden" guarantee is unchanged: the windows do
-- not filter on hidden, and the function remains SECURITY DEFINER so the count is
-- the true raw count.

create or replace function public.signal_posts_enforce_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_15s integer;
  recent_hour integer;
  recent_day integer;
  link_count integer;
begin
  -- Link cap applies on INSERT and on UPDATE so an edit cannot smuggle links in
  -- past the insert-time check.
  select count(*) into link_count
    from regexp_matches(coalesce(new.body, ''), 'https?://', 'gi') as m;
  if link_count > 3 then
    raise exception 'too_many_links: at most 3 links per post'
      using errcode = 'check_violation';
  end if;

  -- Rate limiting applies to new posts only, not edits.
  if tg_op = 'INSERT' then
    -- Authoritative server timestamp: prevents a crafted client from backdating
    -- a post to fall outside the rate-limit windows.
    new.created_at := now();

    -- Count ALL of the user's posts in each window, INCLUDING hidden = true
    -- posts. SECURITY DEFINER (BYPASSRLS owner) makes the count the true raw
    -- count, never hidden- or RLS-filtered. signals.user_id is unique, so
    -- counting by signal_id is per user.
    select count(*) into recent_15s
      from public.signal_posts
     where signal_id = new.signal_id
       and created_at > now() - interval '15 seconds';
    if recent_15s > 0 then
      raise exception 'rate_limit: wait at least 15 seconds between posts'
        using errcode = 'check_violation';
    end if;

    select count(*) into recent_hour
      from public.signal_posts
     where signal_id = new.signal_id
       and created_at > now() - interval '1 hour';
    if recent_hour >= 10 then
      raise exception 'rate_limit: at most 10 posts per hour'
        using errcode = 'check_violation';
    end if;

    select count(*) into recent_day
      from public.signal_posts
     where signal_id = new.signal_id
       and created_at > now() - interval '1 day';
    if recent_day >= 40 then
      raise exception 'rate_limit: at most 40 posts per day'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_signal_posts_enforce_limits on public.signal_posts;
create trigger trg_signal_posts_enforce_limits
  before insert or update on public.signal_posts
  for each row execute function public.signal_posts_enforce_limits();
