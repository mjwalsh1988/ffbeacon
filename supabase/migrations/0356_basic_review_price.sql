-- Migration 0356: Basic Review priced at $4.95
--
-- Access matrix statement: UNCHANGED. One data update on products; no policy,
-- grant or column changes.
--
-- The owner's call on 2026-10-30, before the first live order. Every past order
-- keeps the price it was sold at (orders.amount_cents and product_snapshot
-- freeze it), and the 60 second offer memo on a running instance ages out on
-- its own. The guard on the old price keeps a rerun from undoing a later edit
-- made in /admin/orders/products.

update public.products
   set price_cents = 495,
       updated_at = now()
 where slug = 'team-review-basic'
   and price_cents = 995;
