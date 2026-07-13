-- Migration 0138: restrict the user-avatars storage bucket to safe raster image types
-- Finding: FFB-SEC-012.
--
-- The user-avatars bucket had allowed_mime_types = null (any type accepted), unlike
-- signal-media / signal-reaction-emojis which enforce raster-only allowlists. Even
-- though the bucket is private and served via signed URLs, it should not accept
-- arbitrary types (e.g. SVG or HTML). This pins the declared upload content-type to a
-- safe raster allowlist. Storage validates the declared content-type against this list
-- on upload, so an SVG/HTML/HEIC/HEIF upload is rejected.
--
-- The allowlist matches exactly the formats the avatar uploader already advertises and
-- accepts (app/my-beacon/profile/avatar-uploader.tsx: image/jpeg, image/png, image/webp,
-- image/gif). GIF is included deliberately: it is an existing advertised feature, and it
-- is a static/animated raster format with no active/scriptable content, so it is safe to
-- allow. Do NOT add SVG (scriptable), HTML, or HEIC/HEIF (not raster / not re-encoded)
-- here. This migration therefore does not break any existing advertised avatar upload.
--
-- Existing stored avatars are unaffected (the allowlist gates future uploads only, and
-- their stored content-types are already within this set). Size limit is left at its
-- current value (appropriate for avatars). Write policies remain own-folder scoped, the
-- bucket stays private, and no service-role or public-access permission is broadened:
-- this migration only sets allowed_mime_types and touches nothing else.
--
-- Idempotent: a plain UPDATE of the bucket config. If the bucket does not exist yet in
-- a given environment, the UPDATE affects zero rows (harmless).

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'user-avatars';
