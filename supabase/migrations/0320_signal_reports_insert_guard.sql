-- Migration 0320: signal_reports enforces its own limits on insert.
--
-- The report route (app/api/signal/report/route.ts) checks the target, the
-- reason and the reporter's rate before it inserts. The table itself only
-- checked `reporter_user_id = auth.uid()`, and `authenticated` can insert every
-- column, so a direct PostgREST insert skipped all of it: any status, any
-- created_at, any target id (including hidden and draft content), at any rate.
--
-- This moves those rules into a BEFORE INSERT trigger, the same shape
-- signal_comments and signal_posts already use for their own limits:
--   - status is forced to 'pending' and created_at to now(), whatever was sent;
--   - the target must exist and be publicly viewable: not hidden, its parent
--     post (for a comment) not hidden, and its Signal published, public and not
--     hidden;
--   - at most one report per 15 seconds, 10 per rolling hour and 40 per rolling
--     day per reporter, the same numbers the route states.
-- The route keeps its own checks for the friendly messages; this is what holds
-- when the route is bypassed. SECURITY DEFINER because draft and hidden rows are
-- invisible to the reporter under RLS, and the lookup has to see them to refuse
-- them. A per-reporter advisory lock serialises two concurrent inserts from the
-- same account so both cannot pass the count.
--
-- Also removes the table privileges anon never needed (no anon policy exists,
-- so this changes no behaviour).
--
-- Safe to apply BEFORE the code deploys: the route already inserts only rows
-- that pass these checks.
--
-- Access matrix (unchanged apart from the trigger)
--   anon          : none
--   authenticated : SELECT own rows; INSERT own rows, subject to the trigger
--   service_role  : ALL (the trigger applies to its inserts too)

create or replace function public.signal_reports_enforce_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  recent_15s integer;
  recent_hour integer;
  recent_day integer;
begin
  new.status := 'pending';
  new.created_at := now();

  if new.target_type = 'post' then
    select true into v_ok
      from public.signal_posts p
      join public.signals s on s.id = p.signal_id
     where p.id = new.target_id
       and not p.hidden
       and s.status = 'published'
       and s.visibility = 'public'
       and not s.hidden;
  elsif new.target_type = 'comment' then
    select true into v_ok
      from public.signal_comments c
      join public.signal_posts p on p.id = c.post_id
      join public.signals s on s.id = p.signal_id
     where c.id = new.target_id
       and not c.hidden
       and not p.hidden
       and s.status = 'published'
       and s.visibility = 'public'
       and not s.hidden;
  end if;

  if v_ok is not true then
    raise exception 'not_reportable: that content cannot be reported'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('signal_reports:' || new.reporter_user_id::text));

  select count(*) filter (where created_at > now() - interval '15 seconds'),
         count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into recent_15s, recent_hour, recent_day
    from public.signal_reports
   where reporter_user_id = new.reporter_user_id
     and created_at > now() - interval '1 day';

  if recent_15s > 0 then
    raise exception 'rate_limit: wait at least 15 seconds between reports'
      using errcode = 'check_violation';
  end if;
  if recent_hour >= 10 then
    raise exception 'rate_limit: at most 10 reports per hour'
      using errcode = 'check_violation';
  end if;
  if recent_day >= 40 then
    raise exception 'rate_limit: at most 40 reports per day'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.signal_reports_enforce_insert() from public, anon, authenticated;

drop trigger if exists trg_signal_reports_enforce_insert on public.signal_reports;
create trigger trg_signal_reports_enforce_insert
  before insert on public.signal_reports
  for each row execute function public.signal_reports_enforce_insert();

-- The rate check reads a reporter's last day of reports on every insert.
create index if not exists idx_signal_reports_reporter_created
  on public.signal_reports (reporter_user_id, created_at desc);

-- A reporter cannot rewrite or remove a report once filed (no policy allowed
-- it; the grants go too so the intent is visible in one place).
revoke insert, update, delete, truncate on table public.signal_reports from anon;
revoke update, delete, truncate on table public.signal_reports from authenticated;
