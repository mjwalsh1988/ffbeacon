-- Migration 0077: restore owner-scoped SELECT on signal-media storage objects.
--
-- Migration 0065 dropped the broad LIST/SELECT policy on signal-media, reasoning
-- that a public bucket serves reads via the public object URL (true for reads).
-- But that broke AUTHENTICATED UPLOADS: the storage API's upload path performs a
-- SELECT on storage.objects (existence check / INSERT ... RETURNING), so with no
-- SELECT policy at all the authenticated owner's upload to their OWN folder is
-- rejected with "new row violates row-level security policy". The working
-- user-avatars bucket has exactly this owner-scoped SELECT policy.
--
-- This restores a NARROW SELECT (own folder only, matching the insert/update/
-- delete policies), which does not expose other users' objects and does not
-- affect public reads (those bypass RLS via the public object URL).
--
-- Access matrix (storage.objects, bucket signal-media):
--   anon          : no policy (public reads go through the public object URL)
--   authenticated : SELECT/INSERT/UPDATE/DELETE only within own "<uid>/" folder
--   service_role  : full (admin list/remove in the upload route)

drop policy if exists signal_media_select_own on storage.objects;
create policy signal_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signal-media'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
