-- Migration 0075: signal_reactions (one row per user+target+type) +
-- signal_reaction_counts (denormalized) + count-sync trigger
--
-- Reactions are polymorphic over Wall posts and comments (target_type in
-- ('post','comment'), target_id), mirroring the polymorphic signal_reports model
-- (migration 0070). A user may apply each reaction type to a given target at most
-- once, enforced by the unique(target_type, target_id, reaction_type_id, user_id)
-- constraint; applying the same reaction twice is a no-op (toggle off then on).
--
-- reaction_type_id references signal_reaction_types ON DELETE RESTRICT: a catalog
-- type that has ever been applied cannot be deleted, only disabled (is_active =
-- false). This keeps historical counts intact and named. The denormalized
-- signal_reaction_counts FK uses ON DELETE CASCADE so that a type with no
-- reactions left (its zeroed count rows, if any) can still be deleted cleanly; the
-- real deletion guard is the RESTRICT on signal_reactions.
--
-- signal_reaction_counts is the only thing public pages read for counts: anon and
-- authenticated SELECT it directly. We never count signal_reactions rows live on a
-- request. The count is maintained by an AFTER INSERT/DELETE trigger
-- (SECURITY DEFINER), exactly mirroring the follower_count pattern (migration
-- 0063): +1 on insert (upsert), -1 (floored at 0) on delete.
--
-- Visibility of a target is checked by signal_target_publicly_viewable(type, id),
-- a SECURITY DEFINER helper that resolves the post/comment + parent Signal live
-- gating in one place. It is used both in the reactions RLS (read + insert) and is
-- safe to call directly (returns only a boolean about public visibility).
--
-- Access matrix (signal_reactions):
--   anon          : NONE (counts are read off signal_reaction_counts; reactor
--                   identity is authenticated-only)
--   authenticated : SELECT rows on publicly-viewable targets OR own rows;
--                   INSERT own rows only when the target is publicly viewable AND
--                   the reaction type is active; DELETE own rows; NO UPDATE
--   service_role  : ALL
--
-- Access matrix (signal_reaction_counts):
--   anon / authenticated : SELECT (public counts)
--   service_role         : ALL (writes come only from the SECURITY DEFINER trigger)

-- Shared visibility helper. SECURITY DEFINER so it applies the explicit live
-- gating regardless of the caller's RLS; STABLE because it only reads. Used inside
-- RLS policies, so the querying roles need EXECUTE.
create or replace function public.signal_target_publicly_viewable(t_type text, t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when t_type = 'post' then exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = t_id
         and p.hidden = false
         and s.status = 'published'
         and s.visibility = 'public'
         and s.hidden = false
    )
    when t_type = 'comment' then exists (
      select 1
        from public.signal_comments c
        join public.signal_posts p on p.id = c.post_id
        join public.signals s on s.id = p.signal_id
       where c.id = t_id
         and c.hidden = false
         and p.hidden = false
         and s.status = 'published'
         and s.visibility = 'public'
         and s.hidden = false
    )
    else false
  end;
$$;

revoke execute on function public.signal_target_publicly_viewable(text, uuid)
  from public;
grant execute on function public.signal_target_publicly_viewable(text, uuid)
  to anon, authenticated, service_role;

create table if not exists public.signal_reactions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reaction_type_id uuid not null
    references public.signal_reaction_types(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reaction_type_id, user_id)
);

-- Listing reactions on a target (counts recompute, reactor lists).
create index if not exists idx_signal_reactions_target
  on public.signal_reactions(target_type, target_id);
-- The viewer's own reactions on a target (aria-pressed state, toggle).
create index if not exists idx_signal_reactions_user
  on public.signal_reactions(user_id, target_type, target_id);
-- Supports the ON DELETE RESTRICT existence check from signal_reaction_types.
create index if not exists idx_signal_reactions_type
  on public.signal_reactions(reaction_type_id);

create table if not exists public.signal_reaction_counts (
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reaction_type_id uuid not null
    references public.signal_reaction_types(id) on delete cascade,
  count integer not null default 0,
  primary key (target_type, target_id, reaction_type_id)
);

create index if not exists idx_signal_reaction_counts_target
  on public.signal_reaction_counts(target_type, target_id);

alter table public.signal_reactions enable row level security;
alter table public.signal_reaction_counts enable row level security;

-- Read: own rows always; others' rows only on a publicly-viewable target.
drop policy if exists signal_reactions_select on public.signal_reactions;
create policy signal_reactions_select on public.signal_reactions
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.signal_target_publicly_viewable(target_type, target_id)
  );

-- Insert: only your own reaction, only on a publicly-viewable target, only with an
-- active reaction type.
drop policy if exists signal_reactions_insert_own on public.signal_reactions;
create policy signal_reactions_insert_own on public.signal_reactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.signal_target_publicly_viewable(target_type, target_id)
    and exists (
      select 1
        from public.signal_reaction_types rt
       where rt.id = reaction_type_id
         and rt.is_active = true
    )
  );

-- Delete: only your own reaction (toggle off).
drop policy if exists signal_reactions_delete_own on public.signal_reactions;
create policy signal_reactions_delete_own on public.signal_reactions
  for delete to authenticated
  using (auth.uid() = user_id);

-- No UPDATE policy: a reaction is immutable; changing it is delete + insert.

drop policy if exists signal_reactions_service_role_all on public.signal_reactions;
create policy signal_reactions_service_role_all on public.signal_reactions
  for all to service_role using (true) with check (true);

-- Counts are public to read, but ONLY for publicly-viewable targets. Gating on the
-- same visibility helper the reactions table uses prevents enumerating engagement
-- metadata (existence + tallies) for hidden, draft, or private posts and comments:
-- once a target stops being publicly viewable its count rows go dark too, matching
-- signal_reactions. Only the SECURITY DEFINER trigger writes counts.
drop policy if exists signal_reaction_counts_select_public on public.signal_reaction_counts;
create policy signal_reaction_counts_select_public on public.signal_reaction_counts
  for select to anon, authenticated
  using (public.signal_target_publicly_viewable(target_type, target_id));

drop policy if exists signal_reaction_counts_service_role_all on public.signal_reaction_counts;
create policy signal_reaction_counts_service_role_all on public.signal_reaction_counts
  for all to service_role using (true) with check (true);

-- Maintain the denormalized count. SECURITY DEFINER so it writes the counts table
-- regardless of the inserting/deleting role's grants, mirroring
-- signal_follows_sync_count (migration 0063).
create or replace function public.signal_reactions_sync_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.signal_reaction_counts as c
      (target_type, target_id, reaction_type_id, count)
    values (new.target_type, new.target_id, new.reaction_type_id, 1)
    on conflict (target_type, target_id, reaction_type_id)
    do update set count = c.count + 1;
    return new;
  elsif tg_op = 'DELETE' then
    update public.signal_reaction_counts
       set count = greatest(count - 1, 0)
     where target_type = old.target_type
       and target_id = old.target_id
       and reaction_type_id = old.reaction_type_id;
    return old;
  end if;
  return null;
end;
$$;

revoke execute on function public.signal_reactions_sync_count()
  from anon, authenticated, public;

drop trigger if exists trg_signal_reactions_sync_count on public.signal_reactions;
create trigger trg_signal_reactions_sync_count
  after insert or delete on public.signal_reactions
  for each row execute function public.signal_reactions_sync_count();
