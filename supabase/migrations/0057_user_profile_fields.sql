-- Migration 0057: profile fields on user_preferences + user-avatars storage RLS
--
-- Adds the editable profile fields surfaced on /my-beacon/profile. Display name
-- is NOT stored here: it lives on auth.users (user_metadata.display_name) and is
-- updated via supabase.auth.updateUser, so we never duplicate it.
--
-- avatar_path is an OPERATIONAL reference to the object in the private
-- `user-avatars` storage bucket (e.g. "<user_id>/avatar-<ts>.jpg"), not image
-- data. Each user keeps at most one avatar; the uploader removes the previous
-- file before writing the next one.
--
-- Access matrix:
--   user_preferences  (unchanged: owner-only row policies from migration 0008)
--   storage.objects (bucket 'user-avatars')
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE only within own folder
--                     ((storage.foldername(name))[1] = auth.uid()::text)
--     service_role  : ALL (Supabase default)

alter table public.user_preferences
  add column if not exists first_name text
    check (first_name is null or char_length(first_name) <= 80),
  add column if not exists last_name text
    check (last_name is null or char_length(last_name) <= 80),
  add column if not exists bio text
    check (bio is null or char_length(bio) <= 2000),
  add column if not exists avatar_path text;

-- Storage policies. RLS is already enabled on storage.objects by Supabase.
-- The first path segment must equal the caller's uid, so a user can only ever
-- read or write objects inside their own "<uid>/" folder of this bucket.

drop policy if exists user_avatars_select_own on storage.objects;
create policy user_avatars_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists user_avatars_insert_own on storage.objects;
create policy user_avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists user_avatars_update_own on storage.objects;
create policy user_avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists user_avatars_delete_own on storage.objects;
create policy user_avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
