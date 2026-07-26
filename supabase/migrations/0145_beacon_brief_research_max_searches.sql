-- Migration 0145: cap the Beacon Brief research pass at N web searches
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes blocked).
-- No schema change, one new settings row in category 'beacon_brief'.
--
-- Why: the article research call declares the server-side web_search tool with no
-- max_uses, so the search loop ran unbounded. That loop re-bills the ENTIRE
-- accumulated conversation (post + every prior search result) on every round, so
-- input tokens grow with the SQUARE of the search count, not linearly. Measured
-- over 30 days: the research call averaged 159,245 input tokens (every other call
-- in the pipeline averages under 1,400), and 10 of 85 calls ran 490k to 1,178,489
-- input tokens each, consuming 55% of all Beacon Brief token spend on their own.
--
-- bb_research_max_searches bounds that loop. 3 searches is enough to confirm a
-- football news item (what happened, when, who), and the research step is kept
-- because it is what keeps articles factual and feeds the writing prompt.
--
-- Set to 0 (or less) to remove the cap and restore the old unbounded behavior;
-- lib/beacon-brief/ai.ts then omits max_uses entirely.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_research_max_searches', '3'::jsonb, 'number', 'beacon_brief', 'Research max web searches',
   'Maximum web searches the article research call may run. The server-side search loop re-bills the whole conversation each round, so cost grows with the square of this number: raise it in single steps and watch the Logs page. Set to 0 for no cap (not recommended).')
on conflict (key) do nothing;
