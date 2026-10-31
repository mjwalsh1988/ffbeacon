-- Migration 0353: orders, column grants for the owner
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT own rows (RLS), on the named columns below only
--   service_role  : ALL
--   client writes : BLOCKED
--
-- RLS is row level, so orders_select_own handed the owner every column. These are
-- for the admin alone and are now not selectable by a customer through PostgREST:
-- dispute_id, dispute_status, disputed_at, duplicate_payment_intent_id,
-- duplicate_resolved_at, mismatch_amount_cents, refund_note, metadata,
-- receipt_email_status, receipt_email_sent_at, receipt_email_attempts,
-- receipt_email_error. A new column is NOT readable by a customer until it is added
-- here, which is the safe direction. lib/commerce/orders.ts OWNER_ORDER_COLUMNS must
-- stay inside this list.

revoke select on public.orders from anon, authenticated;

grant select (
  id, order_number, user_id, product_id, product_snapshot, origin,
  list_price_cents, discount_cents, amount_cents, currency,
  payment_method, payment_status, fulfillment_status,
  stripe_session_id, stripe_session_attempts, stripe_session_expires_at,
  stripe_payment_intent_id, livemode, external_payment_reference,
  customer_reported_paid_at, paid_at, paid_via, due_at, started_at, delivered_at,
  expires_at, reminder_sent_at, cancelled_at, refunded_cents, refunded_at,
  context, intake, coupon_id, coupon_code, created_at, updated_at
) on public.orders to authenticated;
