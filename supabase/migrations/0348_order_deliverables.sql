-- Migration 0348: order_deliverables (the sections and attachments of a written
-- review)
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT rows on own orders that are published and ready
--   service_role  : ALL
--   client writes : BLOCKED
--
-- upload_state exists because an attachment row is created BEFORE its bytes do:
-- the admin's browser uploads straight to Storage with a signed upload URL, and
-- the row stays 'pending' until finalizeAttachmentAction has confirmed the object
-- is there. Publishing takes only 'ready' rows, and the cron clears 'pending'
-- rows older than 24 hours along with any object at their path.

create table if not exists public.order_deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('section','attachment')),
  title text not null check (length(title) between 1 and 120),
  body text check (length(body) <= 20000),
  storage_path text check (length(storage_path) <= 300),
  file_name text check (length(file_name) <= 160),
  file_size integer check (file_size >= 0),
  mime_type text check (length(mime_type) <= 100),
  sort_order integer not null default 100,
  status text not null default 'draft' check (status in ('draft','published')),
  upload_state text not null default 'ready' check (upload_state in ('pending','ready')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'section' and body is not null and storage_path is null)
      or (kind = 'attachment' and storage_path is not null)),
  check (kind = 'attachment' or upload_state = 'ready')
);

create index if not exists idx_order_deliverables_order_sort
  on public.order_deliverables (order_id, sort_order);

alter table public.order_deliverables enable row level security;

drop policy if exists order_deliverables_select_own on public.order_deliverables;
create policy order_deliverables_select_own on public.order_deliverables
  for select to authenticated
  using (
    status = 'published'
    and upload_state = 'ready'
    and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

drop policy if exists order_deliverables_service_role_all on public.order_deliverables;
create policy order_deliverables_service_role_all on public.order_deliverables
  for all to service_role using (true) with check (true);

drop trigger if exists order_deliverables_set_updated_at on public.order_deliverables;
create trigger order_deliverables_set_updated_at
  before update on public.order_deliverables
  for each row execute function public.set_updated_at();

comment on table public.order_deliverables is
  'Sections and attachments of a delivered review. Owner reads published, ready rows; drafts stay with the admin.';
