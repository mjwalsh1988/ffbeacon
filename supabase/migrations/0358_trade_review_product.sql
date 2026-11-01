-- Migration 0358: the Trade Review, and two more places the store sells
--
-- The second product family. A Trade Review is a hand-written read of one trade
-- the customer ran through Signal Check: whether we would take it, how we would
-- change it, and one or two other deals worth offering. It is a row here, an
-- `intake_form` of 'trade-review' (one notes box instead of the team review's
-- three questions) and a `context` that stores the frozen Signal Check result
-- rather than a Blueprint. Everything else (orders, payment, delivery, emails,
-- the admin) is the store as it already stands.
--
-- Two placements join the three in 0344: 'trade-calculator' (under a Signal
-- Check result) and 'on-the-clock' (the screen after a draft finishes). The
-- team reviews are offered on the latter; the Trade Review on the former.
--
-- Access matrix: unchanged from 0344. Checks and one data insert only; no new
-- table, no new policy, and the generated types do not change.

alter table public.products drop constraint if exists products_intake_form_check;
alter table public.products
  add constraint products_intake_form_check
  check (intake_form in ('team-review', 'trade-review'));

alter table public.products drop constraint if exists products_placements_check;
alter table public.products
  add constraint products_placements_check
  check (placements <@ array['blueprint','league-overview','my-beacon','on-the-clock','trade-calculator']::text[]);

insert into public.products
  (slug, family, tier_rank, name, tagline, description, features, badge,
   price_cents, turnaround_days, intake_form, requires_league_context, placements, display_order)
values
  ('trade-review', 'trade-review', 1, 'Trade Review',
   'A straight answer on the trade in front of you, from a person.',
   'We look at the trade you ran through Signal Check and tell you what we think of it: whether we would take it, where it is light or heavy, how we would change it, and one or two other deals worth offering instead. Add your Sleeper username and league name if you want us to read it against your roster.',
   '["Whether we would take this trade, and why","How we would change it if it needs work","One or two other deals worth offering instead","Delivered to your My Beacon portal within 2 days"]'::jsonb,
   null, 395, 2, 'trade-review', false, array['trade-calculator']::text[], 30)
on conflict (slug) do nothing;

update public.products
   set placements = array_append(placements, 'on-the-clock'),
       updated_at = now()
 where family = 'team-review'
   and not (placements @> array['on-the-clock']::text[]);
