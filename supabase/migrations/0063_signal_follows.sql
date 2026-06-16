-- Migration 0063: signal_follows + denormalized follower_count maintenance
--
-- Follower/followee relationships for the future For You feed (feed UI deferred,
-- this migration only stores the graph). Follower COUNT is public via
-- signals.follower_count (denormalized, maintained here by an AFTER trigger).
-- Follower LIST reads are authenticated-only.
--
-- Access matrix:
--   anon          : NONE (the count is read off signals.follower_count, not here)
--   authenticated : SELECT (full graph, for follower/following lists);
--                   INSERT/DELETE only own follower rows (follower_user_id = uid)
--   service_role  : ALL

create table if not exists public.signal_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  followee_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, followee_user_id),
  check (follower_user_id <> followee_user_id)
);

create index if not exists idx_signal_follows_followee
  on public.signal_follows(followee_user_id);
create index if not exists idx_signal_follows_follower
  on public.signal_follows(follower_user_id);

alter table public.signal_follows enable row level security;

drop policy if exists signal_follows_select_authed on public.signal_follows;
create policy signal_follows_select_authed on public.signal_follows
  for select to authenticated using (true);

drop policy if exists signal_follows_insert_own on public.signal_follows;
create policy signal_follows_insert_own on public.signal_follows
  for insert to authenticated
  with check (auth.uid() = follower_user_id);

drop policy if exists signal_follows_delete_own on public.signal_follows;
create policy signal_follows_delete_own on public.signal_follows
  for delete to authenticated
  using (auth.uid() = follower_user_id);

drop policy if exists signal_follows_service_role_all on public.signal_follows;
create policy signal_follows_service_role_all on public.signal_follows
  for all to service_role using (true) with check (true);

-- Maintain the denormalized follower_count on the followee's Signal so public
-- pages never count rows on an anonymous hit. SECURITY DEFINER so the trigger can
-- write follower_count even though authenticated lacks an UPDATE grant on it.
create or replace function public.signal_follows_sync_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.signals
       set follower_count = follower_count + 1
     where user_id = new.followee_user_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.signals
       set follower_count = greatest(follower_count - 1, 0)
     where user_id = old.followee_user_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_signal_follows_sync_count on public.signal_follows;
create trigger trg_signal_follows_sync_count
  after insert or delete on public.signal_follows
  for each row execute function public.signal_follows_sync_count();
