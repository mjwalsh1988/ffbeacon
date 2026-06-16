-- Migration 0073: GIFs on Wall posts + comments, with images-xor-gif mutual exclusion
--
-- Sub-phase (d) of Signal Phase 4. A Wall post may carry up to 4 images OR exactly
-- one GIF, never both. A comment is text plus an optional single GIF (comments have
-- no image uploads by design). GIFs come from GIPHY via a server-side proxy
-- (/api/signal/gif/search); the picker stores a small normalized object, never the
-- raw GIPHY payload.
--
-- 1. gif jsonb (nullable) on signal_posts AND signal_comments, shaped
--    { giphy_id, url, preview_url, alt, width, height } and guarded by a
--    function-backed CHECK (signal_gif_valid), mirroring signal_links_valid in
--    migration 0069. CHECK constraints cannot contain a subquery, so the shape
--    validation lives in an IMMUTABLE helper the constraint calls. NULL is allowed
--    (no GIF). Crucially the validator REQUIRES a non-empty alt (1..420): we never
--    store a GIF without accessible text, because creators and viewers may be blind.
--
-- 2. IMAGES-XOR-GIF, enforced in BOTH directions so neither write order can produce
--    a post that has both a GIF and images:
--    * Direction A (set a GIF on a post that already has images): a BEFORE INSERT OR
--      UPDATE trigger on signal_posts (signal_posts_block_gif_when_images) rejects a
--      non-null gif when the post already has signal_post_images rows. On INSERT a
--      post has no images yet (the FK requires the post to exist first), so this is
--      meaningful on UPDATE; INSERT coverage is a harmless defensive backstop.
--    * Direction B (insert an image into a post that already has a GIF): a BEFORE
--      INSERT trigger on signal_post_images (signal_post_images_block_when_gif)
--      rejects the insert when the parent post has gif IS NOT NULL. The gif lives on
--      the parent row, so this direction has to be a trigger on the child table.
--    Both functions are SECURITY DEFINER so the cross-table lookup is not filtered
--    by the writing role's RLS, and EXECUTE is revoked from anon/authenticated.
--
-- Access matrix is unchanged. gif is an owner-writable column on signal_posts (set
-- at post creation) and an author-writable column on signal_comments (set on create
-- and editable on update). The moderation/follower columns stay service-role-only.

-- 1a. gif column + shape validator --------------------------------------------
create or replace function public.signal_gif_valid(gif jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(gif) = 'object'
    and jsonb_typeof(gif -> 'giphy_id') = 'string'
    and char_length(gif ->> 'giphy_id') between 1 and 64
    and jsonb_typeof(gif -> 'url') = 'string'
    and char_length(gif ->> 'url') <= 2048
    and (gif ->> 'url') ~ '^https://'
    and jsonb_typeof(gif -> 'preview_url') = 'string'
    and char_length(gif ->> 'preview_url') <= 2048
    and (gif ->> 'preview_url') ~ '^https://'
    and jsonb_typeof(gif -> 'alt') = 'string'
    -- Non-empty alt is mandatory: a GIF with no accessible text is never stored.
    and char_length(gif ->> 'alt') between 1 and 420
    and jsonb_typeof(gif -> 'width') = 'number'
    and (gif -> 'width')::numeric > 0
    and (gif -> 'width')::numeric <= 10000
    and jsonb_typeof(gif -> 'height') = 'number'
    and (gif -> 'height')::numeric > 0
    and (gif -> 'height')::numeric <= 10000;
$$;

-- The constraint is evaluated by the writing role: the Wall owner (authenticated)
-- for posts, any signed-in user (authenticated) for comments. anon never writes
-- either table (RLS blocks it). The function only inspects its argument, so
-- withholding it from anon/public is safe.
revoke execute on function public.signal_gif_valid(jsonb) from public;
revoke execute on function public.signal_gif_valid(jsonb) from anon;
grant execute on function public.signal_gif_valid(jsonb) to authenticated, service_role;

alter table public.signal_posts
  add column if not exists gif jsonb;
alter table public.signal_posts
  drop constraint if exists signal_posts_gif_shape_check;
alter table public.signal_posts
  add constraint signal_posts_gif_shape_check
  check (gif is null or public.signal_gif_valid(gif));

alter table public.signal_comments
  add column if not exists gif jsonb;
alter table public.signal_comments
  drop constraint if exists signal_comments_gif_shape_check;
alter table public.signal_comments
  add constraint signal_comments_gif_shape_check
  check (gif is null or public.signal_gif_valid(gif));

-- Posts set gif at creation time only (parity with images: edit is delete + repost),
-- so gif is added to the INSERT column grant. Comments set gif on create and may
-- change it on edit, so gif is added to both the INSERT and UPDATE column grants.
grant insert (gif) on public.signal_posts to authenticated;
grant insert (gif), update (gif) on public.signal_comments to authenticated;

-- 2. images-xor-gif guards (both directions) ----------------------------------
-- Direction A: block setting a gif on a post that already has images.
create or replace function public.signal_posts_block_gif_when_images()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.gif is not null
     and exists (
       select 1 from public.signal_post_images i where i.post_id = new.id
     ) then
    raise exception 'images_xor_gif: a post with images cannot also have a GIF'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.signal_posts_block_gif_when_images()
  from anon, authenticated, public;

drop trigger if exists trg_signal_posts_block_gif_when_images on public.signal_posts;
create trigger trg_signal_posts_block_gif_when_images
  before insert or update on public.signal_posts
  for each row execute function public.signal_posts_block_gif_when_images();

-- Direction B: block inserting an image into a post that already has a gif.
create or replace function public.signal_post_images_block_when_gif()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.signal_posts p
     where p.id = new.post_id and p.gif is not null
  ) then
    raise exception 'images_xor_gif: a post with a GIF cannot also have images'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.signal_post_images_block_when_gif()
  from anon, authenticated, public;

drop trigger if exists trg_signal_post_images_block_when_gif on public.signal_post_images;
create trigger trg_signal_post_images_block_when_gif
  before insert on public.signal_post_images
  for each row execute function public.signal_post_images_block_when_gif();
