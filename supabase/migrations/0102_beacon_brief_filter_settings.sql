-- Migration 0102: Beacon Brief non-football filter settings
--
-- Three new admin-editable rows in beacon_settings (category 'beacon_brief') that
-- control the two filtering gates. Like every other Beacon Brief tunable these
-- are editable on the admin Settings page with no code deploy; the code defaults
-- in lib/beacon-brief/settings.ts are only fallbacks used when a row is absent.
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes
-- blocked).
--
-- Plain ASCII only (no em dashes etc.), per the project no-AI-tell rule.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_keyword_filter_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'Keyword pre-filter enabled',
   'When on, a new post containing any blocked keyword is filtered before the AI step and sent to the Filtered review queue instead of Discord or an article. Applies to new posts only, not revisions.'),
  ('bb_keyword_filter',
   to_jsonb('nba, basketball, world cup, fifa, soccer, golf, pga, mlb, baseball, nhl, hockey, tennis, ufc, boxing, olympics, cricket, formula 1, f1, nascar, wnba, march madness'::text),
   'string', 'beacon_brief', 'Keyword blocklist',
   'Comma-separated words and phrases. A new post whose text, quoted, or retweeted content contains any of these (whole word, case-insensitive) is filtered out before the AI step. Edit freely; changes apply on the next cron run.'),
  ('bb_non_football_filter_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'AI non-football filter enabled',
   'When on, a post the classifier flags as non-football (non_football=1) is filtered to the review queue instead of being posted to Discord or made into an article.')
on conflict (key) do nothing;
