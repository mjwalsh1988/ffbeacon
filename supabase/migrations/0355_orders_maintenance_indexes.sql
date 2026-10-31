-- Migration 0355: indexes under the order maintenance cron and the admin figures
--
-- Access matrix statement: UNCHANGED. Indexes only; no policy, grant or column
-- changes.
--
-- idx_orders_receipt_retry (migration 0345) covered receipt_email_status in
-- ('pending','failed'), but the retry step also retries 'skipped' (Resend not
-- configured is a deployment state somebody fixes), so the planner could not use
-- the index for the query that runs every hour. The predicate now matches the
-- query. paid_at and delivered_at drive the admin list's revenue and turnaround
-- figures on every render and had no index; both are partial because most of the
-- value of either column is in the rows where it is set.

drop index if exists public.idx_orders_receipt_retry;
create index if not exists idx_orders_receipt_retry on public.orders (receipt_email_status)
  where receipt_email_status in ('pending','failed','skipped');

create index if not exists idx_orders_paid_at on public.orders (paid_at)
  where paid_at is not null;
create index if not exists idx_orders_delivered_at on public.orders (delivered_at)
  where delivered_at is not null;
