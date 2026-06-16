-- Migration 0061: signal_posts (the Wall) + abuse controls
--
-- Public posts on a creator's Signal profile. Public read is gated on the parent
-- Signal being publicly viewable AND the post not being hidden by an admin.
--
-- Access matrix:
--   anon          : SELECT posts whose parent Signal is published+public+not-hidden
--                   and post.hidden = false
--   authenticated : same public read, PLUS owner reads own posts in any state;
--                   owner INSERT/UPDATE/DELETE own posts, restricted to
--                   non-moderation columns (hidden/hidden_* are service_role only)
--   service_role  : ALL (admin takedown sets hidden)
--
-- Abuse controls live in a BEFORE INSERT trigger (authoritative, path-independent
-- so a direct RLS insert cannot bypass them):
--   * min 15s between posts, max 10/hour, max 40/day per user
--   * max 3 links per post body
-- The rate-limit counts EVERY post the user has authored in the window, INCLUDING
-- posts later hidden by admin takedown. A hidden post was still a real post the
-- user made, so it still consumes quota. SECURITY DEFINER guarantees the count
-- sees the raw rows, never an RLS- or hidden-filtered subset. signals.user_id is
-- unique, so counting by signal_id is equivalent to counting per user.

create table if not exists public.signal_posts (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  pinned boolean not null default false,
  hidden boolean not null default false,
  hidden_reason text,
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists idx_signal_posts_signal
  on public.signal_posts(signal_id, created_at desc);
-- Ascending companion index for the rate-limit window counts.
create index if not exists idx_signal_posts_rate
  on public.signal_posts(signal_id, created_at);

alter table public.signal_posts enable row level security;

drop policy if exists signal_posts_select_public on public.signal_posts;
create policy signal_posts_select_public on public.signal_posts
  for select to anon, authenticated
  using (
    hidden = false
    and exists (
      select 1 from public.signals s
      where s.id = signal_id
        and s.status = 'published'
        and s.visibility = 'public'
        and s.hidden = false
    )
  );

drop policy if exists signal_posts_select_own on public.signal_posts;
create policy signal_posts_select_own on public.signal_posts
  for select to authenticated
  using (
    exists (
      select 1 from public.signals s
      where s.id = signal_id and s.user_id = auth.uid()
    )
  );

drop policy if exists signal_posts_insert_own on public.signal_posts;
create policy signal_posts_insert_own on public.signal_posts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.signals s
      where s.id = signal_id and s.user_id = auth.uid()
    )
  );

drop policy if exists signal_posts_update_own on public.signal_posts;
create policy signal_posts_update_own on public.signal_posts
  for update to authenticated
  using (
    exists (select 1 from public.signals s where s.id = signal_id and s.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.signals s where s.id = signal_id and s.user_id = auth.uid())
  );

drop policy if exists signal_posts_delete_own on public.signal_posts;
create policy signal_posts_delete_own on public.signal_posts
  for delete to authenticated
  using (
    exists (select 1 from public.signals s where s.id = signal_id and s.user_id = auth.uid())
  );

drop policy if exists signal_posts_service_role_all on public.signal_posts;
create policy signal_posts_service_role_all on public.signal_posts
  for all to service_role using (true) with check (true);

-- Owner cannot set moderation columns. Re-grant only non-moderation columns.
revoke insert, update on public.signal_posts from anon, authenticated;
grant insert (signal_id, body, pinned, created_at, updated_at, edited_at)
  on public.signal_posts to authenticated;
grant update (body, pinned, updated_at, edited_at)
  on public.signal_posts to authenticated;

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
  -- See migration header: count ALL of the user's posts in each window,
  -- INCLUDING hidden = true posts. SECURITY DEFINER (owned by a BYPASSRLS role)
  -- makes the count the true raw count, never hidden- or RLS-filtered.
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

  -- Hard cap: at most 3 links per post (plain-text body, URL-counted).
  select count(*) into link_count
    from regexp_matches(coalesce(new.body, ''), 'https?://', 'gi') as m;
  if link_count > 3 then
    raise exception 'too_many_links: at most 3 links per post'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_signal_posts_enforce_limits on public.signal_posts;
create trigger trg_signal_posts_enforce_limits
  before insert on public.signal_posts
  for each row execute function public.signal_posts_enforce_limits();
