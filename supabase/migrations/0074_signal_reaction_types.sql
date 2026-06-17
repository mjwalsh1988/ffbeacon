-- Migration 0074: signal_reaction_types (admin-managed reaction catalog) +
-- signal-reaction-emojis storage bucket
--
-- The reaction catalog is the single source of truth for which reactions a viewer
-- may apply to a Wall post or comment. It is admin-managed only: there is NO
-- client write path. Each reaction is one of two kinds:
--   * kind = 'text'  : a short Unicode glyph stored in `char` (e.g. an emoji). No
--                      image asset. `image_path` must be null.
--   * kind = 'image' : a small static custom image stored in the
--                      signal-reaction-emojis bucket, referenced by `image_path`.
--                      `char` must be null.
-- `label` is REQUIRED accessible text for the reaction (1..60 chars). Image
-- reactions render as <img alt=""> inside a button labeled by `label`, never as a
-- bare image, so a screen-reader user always hears a meaningful name.
--
-- is_active gates whether a reaction appears in the PUBLIC picker. Disabling a
-- type (is_active = false) keeps it in the catalog so historical counts stay
-- named: a post reacted to with a now-disabled type still shows that count with
-- its label. This is why public SELECT returns disabled rows too. Deletion is the
-- separate, harder operation and is blocked by the ON DELETE RESTRICT foreign key
-- from signal_reactions (migration 0075) whenever any reaction references the type.
--
-- Access matrix (signal_reaction_types):
--   anon          : SELECT all rows (labels needed even for disabled types so
--                   historical counts remain named on public pages)
--   authenticated : SELECT all rows
--   service_role  : ALL (the admin catalog UI writes via service role only)
--
-- Access matrix (storage bucket 'signal-reaction-emojis'):
--   anon / authenticated : public read via the object URL (no LIST policy, same
--                          posture as signal-media after migration 0065)
--   service_role         : ALL writes (the admin upload route re-encodes to WebP
--                          server-side, animated frames flattened, metadata
--                          stripped, then uploads with the service-role client)

create table if not exists public.signal_reaction_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) between 1 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null check (char_length(label) between 1 and 60),
  kind text not null check (kind in ('image', 'text')),
  char text check (char is null or char_length(char) between 1 and 32),
  image_path text check (image_path is null or char_length(image_path) between 1 and 400),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one payload column is populated, matching kind.
  constraint signal_reaction_types_payload_matches_kind check (
    (kind = 'text' and char is not null and image_path is null)
    or (kind = 'image' and image_path is not null and char is null)
  )
);

-- The picker reads active types in display order; the index covers that read.
create index if not exists idx_signal_reaction_types_order
  on public.signal_reaction_types(display_order, created_at);

alter table public.signal_reaction_types enable row level security;

-- Public read includes disabled rows on purpose (see header): historical counts
-- on a post/comment must stay labeled even after a type is disabled.
drop policy if exists signal_reaction_types_select_public on public.signal_reaction_types;
create policy signal_reaction_types_select_public on public.signal_reaction_types
  for select to anon, authenticated
  using (true);

drop policy if exists signal_reaction_types_service_role_all on public.signal_reaction_types;
create policy signal_reaction_types_service_role_all on public.signal_reaction_types
  for all to service_role using (true) with check (true);

-- There is deliberately NO insert/update/delete policy for anon or authenticated:
-- the catalog is admin-only and every write goes through a requireAdmin server
-- action using the service-role client.

-- Public bucket for kind='image' reactions. Re-encoded static WebP only; the
-- admin route caps the output near 100 KB at 256x256, so the storage-layer
-- file_size_limit is a generous defense-in-depth ceiling (256 KB). Like
-- signal-media after 0065, no LIST SELECT policy is added: public reads go through
-- the object URL and the only writer is the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signal-reaction-emojis', 'signal-reaction-emojis', true, 262144,
  array['image/webp']
)
on conflict (id) do nothing;
