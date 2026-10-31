-- Migration 0357: product descriptions in the site's own voice
--
-- Access matrix statement: UNCHANGED. One data update on products; no policy,
-- grant or column changes.
--
-- The store's copy moved from "Michael reads..." to "we" on 2026-10-31, and
-- the seeded Basic Review description was the one row still in the third
-- person. The guard on the old opening keeps a rerun from undoing a later edit
-- made in /admin/orders/products. The Premium description already read in the
-- right voice and is untouched.

update public.products
   set description = 'We read your roster against your league''s own numbers and your Team Blueprint, then write you a short, plain review: where the team actually stands, the direction to take this season, and two or three trades worth offering, with the reasoning.',
       updated_at = now()
 where slug = 'team-review-basic'
   and description like 'Michael reads%';
