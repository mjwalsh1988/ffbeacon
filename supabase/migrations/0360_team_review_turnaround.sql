-- Migration 0360: the team reviews turn around faster (the owner's call,
-- 2026-10-31): the Basic Review in 1 to 2 days, the Premium Review in 2 to 3.
-- The column holds one whole number of days and sets the due date, so it takes
-- the top of each range; the feature line says the range. Data only.

update public.products
   set turnaround_days = 2,
       features = '["A written read of your roster, in plain words","The direction: contend, rebuild, or hold, and why","Two or three trade ideas with the reasoning","In your My Beacon portal within 1 to 2 days"]'::jsonb,
       updated_at = now()
 where slug = 'team-review-basic';

update public.products
   set turnaround_days = 3,
       features = '["Everything in the Basic Review","Position by position: what is strong, thin, and aging","Buy, sell and hold calls by name","Trade shapes to pursue and the partners to call","A lineup note for this week and your draft capital","One follow-up question by email within 7 days","In your My Beacon portal within 2 to 3 days"]'::jsonb,
       updated_at = now()
 where slug = 'team-review-premium';
