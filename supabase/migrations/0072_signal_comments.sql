-- Migration 0072: signal_comments (comments on Wall posts)
--
-- Comments differ from posts in one important way: a post belongs to the profile
-- owner (authorship is the parent Signal's owner, no author column), but a comment
-- is written by ANY signed-in user. So signal_comments carries an explicit
-- author_user_id, and the rate limit is per author (not per Signal).
--
-- This is also why the public Wall is rendered dynamically and is NOT folded into
-- the cached signal:{handle} bundle (approved Phase 4 decision): comments are
-- written by strangers and must not bust the owner's whole profile cache.
--
-- Body: 1..1000 characters (char_length, i.e. code points), at most 2 links. The
-- composer mirrors these for friendly copy; the DB is the authoritative backstop.
--
-- Abuse controls live in a BEFORE INSERT/UPDATE trigger (authoritative,
-- path-independent so a direct RLS insert cannot bypass them):
--   * min 15s between comments, max 10 per hour, max 40 per day PER AUTHOR
--   * max 2 links per comment body (checked on INSERT and UPDATE)
--   * created_at forced to now() on INSERT (a crafted client cannot backdate a
--     comment to slip outside the rate-limit windows)
-- The windows count EVERY comment the author has written, INCLUDING comments
-- later hidden by moderation. A hidden comment was still a real comment, so it
-- still consumes quota. SECURITY DEFINER guarantees the count sees raw rows, never
-- an RLS- or hidden-filtered subset.
--
-- Moderation columns (hidden, hidden_reason, hidden_at, hidden_by) are
-- service-role-only via column grants: an author cannot hide/unhide their own or
-- anyone else's comment. Owner-of-Wall and admin moderation is performed by a
-- server action (moderateComment) that re-validates "owner of parent Signal OR
-- admin" and then writes the moderation columns with the admin client. We do NOT
-- try to express owner moderation in RLS (the established league-refresh authz
-- pattern: re-validate in the action, write with service role).
--
-- DANGLING REPORTS: signal_reports is polymorphic (migration 0070) with no FK to
-- its target. An AFTER DELETE trigger on signal_comments auto-resolves a deleted
-- comment's open reports to 'dismissed', mirroring the posts-side trigger, so the
-- admin queue never accumulates reports pointing at content that no longer exists.
--
-- Access matrix:
--   anon          : SELECT comments whose comment.hidden = false AND parent post
--                   is not hidden AND parent Signal is published+public+not-hidden
--   authenticated : same public read, PLUS author reads/updates/deletes own
--                   comments (non-moderation columns only), PLUS the parent
--                   Signal's owner reads comments on their own Wall in any state
--                   (moderation context). INSERT own only when the parent post is
--                   publicly commentable.
--   service_role  : ALL (admin queue + moderation writes)

create table if not exists public.signal_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.signal_posts(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  hidden boolean not null default false,
  hidden_reason text,
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);

-- Listing comments under a post, oldest first (chronological reading order).
create index if not exists idx_signal_comments_post
  on public.signal_comments(post_id, created_at);
-- Supports the per-author rate-limit window counts.
create index if not exists idx_signal_comments_author
  on public.signal_comments(author_user_id, created_at);

alter table public.signal_comments enable row level security;

-- Public read: gated through the comment, its post, and the parent Signal.
drop policy if exists signal_comments_select_public on public.signal_comments;
create policy signal_comments_select_public on public.signal_comments
  for select to anon, authenticated
  using (
    hidden = false
    and exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id
         and p.hidden = false
         and s.status = 'published'
         and s.visibility = 'public'
         and s.hidden = false
    )
  );

-- Author read: their own comments in any state.
drop policy if exists signal_comments_select_own on public.signal_comments;
create policy signal_comments_select_own on public.signal_comments
  for select to authenticated
  using (auth.uid() = author_user_id);

-- Wall owner read: every comment on a post belonging to their own Signal, in any
-- state, so the owner can see (and moderate) hidden comments on their Wall.
drop policy if exists signal_comments_select_wall_owner on public.signal_comments;
create policy signal_comments_select_wall_owner on public.signal_comments
  for select to authenticated
  using (
    exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id and s.user_id = auth.uid()
    )
  );

-- Author insert: only their own comment, and only when the parent post is
-- publicly commentable (post not hidden, parent Signal live). This stops
-- commenting on draft/private/hidden content or on a hidden post.
drop policy if exists signal_comments_insert_own on public.signal_comments;
create policy signal_comments_insert_own on public.signal_comments
  for insert to authenticated
  with check (
    auth.uid() = author_user_id
    and exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id
         and p.hidden = false
         and s.status = 'published'
         and s.visibility = 'public'
         and s.hidden = false
    )
  );

-- Author update: their own comments. Column grants below restrict this to the
-- non-moderation columns, so an author cannot flip hidden via an update.
drop policy if exists signal_comments_update_own on public.signal_comments;
create policy signal_comments_update_own on public.signal_comments
  for update to authenticated
  using (auth.uid() = author_user_id)
  with check (auth.uid() = author_user_id);

-- Author delete: their own comments (hard delete).
drop policy if exists signal_comments_delete_own on public.signal_comments;
create policy signal_comments_delete_own on public.signal_comments
  for delete to authenticated
  using (auth.uid() = author_user_id);

drop policy if exists signal_comments_service_role_all on public.signal_comments;
create policy signal_comments_service_role_all on public.signal_comments
  for all to service_role using (true) with check (true);

-- Authors cannot set moderation columns. Re-grant only non-moderation columns.
-- hidden / hidden_reason / hidden_at / hidden_by are service-role-only.
revoke insert, update on public.signal_comments from anon, authenticated;
grant insert (post_id, author_user_id, body, created_at, updated_at, edited_at)
  on public.signal_comments to authenticated;
grant update (body, updated_at, edited_at)
  on public.signal_comments to authenticated;

-- Per-author rate limit + link cap, authoritative and path-independent.
create or replace function public.signal_comments_enforce_limits()
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
  -- past the insert-time check. Comments allow at most 2 links.
  select count(*) into link_count
    from regexp_matches(coalesce(new.body, ''), 'https?://', 'gi') as m;
  if link_count > 2 then
    raise exception 'too_many_links: at most 2 links per comment'
      using errcode = 'check_violation';
  end if;

  -- Rate limiting applies to new comments only, not edits.
  if tg_op = 'INSERT' then
    -- Authoritative server timestamp: prevents a crafted client from backdating
    -- a comment to fall outside the rate-limit windows.
    new.created_at := now();

    -- Count ALL of the author's comments in each window, INCLUDING hidden = true
    -- comments. SECURITY DEFINER (BYPASSRLS owner) makes the count the true raw
    -- count, never hidden- or RLS-filtered.
    select count(*) into recent_15s
      from public.signal_comments
     where author_user_id = new.author_user_id
       and created_at > now() - interval '15 seconds';
    if recent_15s > 0 then
      raise exception 'rate_limit: wait at least 15 seconds between comments'
        using errcode = 'check_violation';
    end if;

    select count(*) into recent_hour
      from public.signal_comments
     where author_user_id = new.author_user_id
       and created_at > now() - interval '1 hour';
    if recent_hour >= 10 then
      raise exception 'rate_limit: at most 10 comments per hour'
        using errcode = 'check_violation';
    end if;

    select count(*) into recent_day
      from public.signal_comments
     where author_user_id = new.author_user_id
       and created_at > now() - interval '1 day';
    if recent_day >= 40 then
      raise exception 'rate_limit: at most 40 comments per day'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.signal_comments_enforce_limits()
  from anon, authenticated, public;

drop trigger if exists trg_signal_comments_enforce_limits on public.signal_comments;
create trigger trg_signal_comments_enforce_limits
  before insert or update on public.signal_comments
  for each row execute function public.signal_comments_enforce_limits();

-- Auto-dismiss a comment's open reports when the comment is hard-deleted. Mirrors
-- signal_reports_dismiss_on_post_delete (migration 0070) for the 'comment' target.
-- SECURITY DEFINER so it updates reports regardless of the deleting role's RLS.
create or replace function public.signal_reports_dismiss_on_comment_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.signal_reports
     set status = 'dismissed'
   where target_type = 'comment'
     and target_id = old.id
     and status in ('pending', 'reviewed');
  return old;
end;
$$;

revoke execute on function public.signal_reports_dismiss_on_comment_delete()
  from anon, authenticated, public;

drop trigger if exists trg_signal_reports_dismiss_on_comment_delete on public.signal_comments;
create trigger trg_signal_reports_dismiss_on_comment_delete
  after delete on public.signal_comments
  for each row execute function public.signal_reports_dismiss_on_comment_delete();
