-- Migration 0349: order-files storage bucket (attachments on a delivered review)
--
-- Access matrix (storage.objects, bucket order-files):
--   anon          : none
--   authenticated : none
--   service_role  : ALL (bypasses RLS on storage.objects)
--
-- PRIVATE, with deliberately NO storage.objects policies. Uploads use a signed
-- upload URL minted by an admin server action with the service role client; the
-- token in that URL is the whole authorization, so the admin's browser needs no
-- policy to PUT the bytes. Reads go through
-- /api/orders/[order_id]/files/[deliverable_id], which checks ownership or admin
-- and redirects to a 60-second signed URL.
--
-- file_size_limit and allowed_mime_types are enforced by Storage on the PUT,
-- whatever the browser claims. Object path:
-- orders/{order_id}/{deliverable_id}/{sanitized file name}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 10485760,
  array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown'])
on conflict (id) do nothing;
