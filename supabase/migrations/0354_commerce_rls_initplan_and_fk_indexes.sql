-- Migration 0354: commerce policies in the initplan form, and two covering indexes
--
-- Access matrix statement: UNCHANGED on every table this migration touches.
-- Policy expressions are rewritten only; no policy name, role, command or
-- permissiveness changes.
--
-- Reason: the same one as migration 0274. A bare auth.uid() inside a policy is
-- evaluated once per candidate row; wrapped as (select auth.uid()) it is hoisted
-- into an initplan and evaluated once per query. The four owner-read policies
-- from migrations 0345 to 0348 were written in the bare form, and the Supabase
-- performance advisor flagged each of them on 2026-10-30. The customer's order
-- list and order page are the reads these policies sit under.
--
-- The two indexes cover foreign keys the advisor flagged on the two tables that
-- will grow: orders.product_id (every order points at a product, and the product
-- editor never deletes one because of the on delete restrict) and
-- payment_webhook_events.order_id (set null on an order delete). The remaining
-- flagged keys (coupons.created_by, coupons.product_id, order_events.actor_user_id,
-- order_messages.sent_by, commerce_settings.updated_by) sit on tables that stay
-- small or are only ever walked by order_id, so they are left alone on purpose.
--
-- ALTER POLICY is used instead of DROP + CREATE so the name, roles, command and
-- permissiveness cannot drift.

-- orders.orders_select_own (SELECT)
alter policy "orders_select_own" on public.orders
  using (((select auth.uid()) = user_id));

-- order_events.order_events_select_own (SELECT)
alter policy "order_events_select_own" on public.order_events
  using (
    visible_to_customer
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = (select auth.uid())
    )
  );

-- order_messages.order_messages_select_own (SELECT)
alter policy "order_messages_select_own" on public.order_messages
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = (select auth.uid())
    )
  );

-- order_deliverables.order_deliverables_select_own (SELECT)
alter policy "order_deliverables_select_own" on public.order_deliverables
  using (
    status = 'published'
    and upload_state = 'ready'
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = (select auth.uid())
    )
  );

create index if not exists idx_orders_product on public.orders (product_id);
create index if not exists idx_payment_webhook_events_order
  on public.payment_webhook_events (order_id) where order_id is not null;
