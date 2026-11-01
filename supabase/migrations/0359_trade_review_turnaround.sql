-- Migration 0359: the Trade Review turns around in a day (the owner's call,
-- 2026-10-31). The column holds whole days with a floor of one, so the due date
-- is 24 hours after payment; the words say what to actually expect, which is
-- usually an hour or two. Data only; no schema, policy or type change.

update public.products
   set turnaround_days = 1,
       tagline = 'A straight answer on the trade in front of you, from a person, usually within an hour or two.',
       description = 'We look at the trade you ran through Signal Check and tell you what we think of it: whether we would take it, where it is light or heavy, how we would change it, and one or two other deals worth offering instead. Back to you within 24 hours, usually within an hour or two. Add your Sleeper username and league name if you want us to read it against your roster.',
       features = '["Whether we would take this trade, and why","How we would change it if it needs work","One or two other deals worth offering instead","In your My Beacon portal within 24 hours, usually within an hour or two"]'::jsonb,
       updated_at = now()
 where slug = 'trade-review';
