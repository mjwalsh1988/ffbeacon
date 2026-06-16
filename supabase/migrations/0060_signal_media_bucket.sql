-- Migration 0060: signal-media public storage bucket + RLS
--
-- Public bucket backing avatars and banners for Signal profiles. Unlike the
-- private user-avatars bucket (migration 0057), this bucket is PUBLIC because
-- profile images render on anonymous, cacheable, high-traffic pages, so
-- per-request signed URLs are not viable. All bytes are re-encoded server-side
-- (EXIF/metadata stripped, normalized to webp) before upload, so raw user files
-- are never stored or served. allowed_mime_types is defense in depth at the
-- storage layer; file_size_limit caps at 8 MB (banner ceiling).
--
-- Access matrix (storage.objects, bucket 'signal-media'):
--   anon          : SELECT (public read)
--   authenticated : SELECT; INSERT/UPDATE/DELETE only within own "<uid>/" folder
--   service_role  : ALL (Supabase default)
--
-- NOTE: migration 0065 later DROPS the broad signal_media_select_public policy
-- created below. A public bucket serves object bytes via the public object URL
-- without any RLS SELECT policy, and the broad policy allowed clients to LIST
-- every file in the bucket. After 0065 the bucket has owner-folder-scoped write
-- policies only; public reads go through the public URL and server reads use
-- service_role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signal-media', 'signal-media', true, 8388608,
  array['image/webp','image/jpeg','image/png']
)
on conflict (id) do nothing;

drop policy if exists signal_media_select_public on storage.objects;
create policy signal_media_select_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'signal-media');

drop policy if exists signal_media_insert_own on storage.objects;
create policy signal_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists signal_media_update_own on storage.objects;
create policy signal_media_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'signal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists signal_media_delete_own on storage.objects;
create policy signal_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'signal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
