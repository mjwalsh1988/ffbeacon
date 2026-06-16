-- Migration 0071: signal_post_images (images attached to a Wall post)
--
-- A Wall post may carry up to 4 images. Each image is a re-encoded WebP stored in
-- the existing signal-media bucket under "<uid>/posts/<uuid>.webp" (the bucket's
-- owner-folder write RLS already authorizes the owner). Per-image alt text is
-- REQUIRED (creators and viewers may be blind): the alt_text CHECK is the DB
-- backstop, and the composer + create action enforce it before insert.
--
-- The 4-image cap is enforced structurally, with no trigger needed: ordinal is
-- constrained to 0..3 and unique per post, so at most 4 rows can exist for a post.
--
-- Sub-phase (d) NOTE (images-xor-gif): when the gif column lands on signal_posts,
-- two guards enforce mutual exclusion in BOTH directions:
--   * image-insert side: a BEFORE INSERT trigger on signal_post_images rejects
--     the insert when the parent post already has gif IS NOT NULL.
--   * gif-set side: a BEFORE UPDATE guard on signal_posts rejects setting gif when
--     the post already has signal_post_images rows.
-- Neither exists yet (no gif column until 0073); both ship in 0073.
--
-- Access matrix:
--   anon          : SELECT images whose parent post is publicly viewable
--                   (post.hidden = false AND parent Signal published+public+not-hidden)
--   authenticated : same public read, PLUS owner reads/inserts/deletes images on
--                   posts belonging to their own Signal
--   service_role  : ALL

create table if not exists public.signal_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.signal_posts(id) on delete cascade,
  storage_path text not null,
  alt_text text not null check (char_length(alt_text) between 1 and 420),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  ordinal smallint not null check (ordinal between 0 and 3),
  created_at timestamptz not null default now(),
  unique (post_id, ordinal)
);

create index if not exists idx_signal_post_images_post
  on public.signal_post_images(post_id, ordinal);

alter table public.signal_post_images enable row level security;

-- Public read: gated through the post and its parent Signal.
drop policy if exists signal_post_images_select_public on public.signal_post_images;
create policy signal_post_images_select_public on public.signal_post_images
  for select to anon, authenticated
  using (
    exists (
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

-- Owner read: any state, for the editor.
drop policy if exists signal_post_images_select_own on public.signal_post_images;
create policy signal_post_images_select_own on public.signal_post_images
  for select to authenticated
  using (
    exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id and s.user_id = auth.uid()
    )
  );

drop policy if exists signal_post_images_insert_own on public.signal_post_images;
create policy signal_post_images_insert_own on public.signal_post_images
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id and s.user_id = auth.uid()
    )
  );

drop policy if exists signal_post_images_delete_own on public.signal_post_images;
create policy signal_post_images_delete_own on public.signal_post_images
  for delete to authenticated
  using (
    exists (
      select 1
        from public.signal_posts p
        join public.signals s on s.id = p.signal_id
       where p.id = post_id and s.user_id = auth.uid()
    )
  );

drop policy if exists signal_post_images_service_role_all on public.signal_post_images;
create policy signal_post_images_service_role_all on public.signal_post_images
  for all to service_role using (true) with check (true);
