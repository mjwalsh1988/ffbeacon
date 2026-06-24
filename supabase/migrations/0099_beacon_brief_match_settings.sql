-- Migration 0099: Beacon Brief reference-matching settings
--
-- Two editable tunables for the curation reference matcher (category
-- 'beacon_brief', service_role-only via the existing beacon_settings RLS). Data
-- rows only, no schema change, so no type regeneration is required.
--
--   bb_match_similarity_threshold : minimum pg_trgm similarity (0..1) for a name
--                                   to appear as a candidate suggestion on a
--                                   moderation row when no confident match exists.
--                                   Does NOT affect auto-linking (that requires an
--                                   exact normalized match, never a fuzzy one).
--   bb_match_candidate_limit      : how many ranked candidate suggestions to
--                                   attach to a moderation row.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_match_similarity_threshold', '0.3'::jsonb, 'number', 'beacon_brief', 'Match candidate similarity threshold',
   'Minimum trigram similarity (0 to 1) for a player name to be offered as a suggestion on a moderation row when no confident match is found. Auto-linking always requires an exact normalized name match, never a fuzzy one, so this only affects the suggestion list.'),
  ('bb_match_candidate_limit', '8'::jsonb, 'number', 'beacon_brief', 'Match candidate suggestions',
   'How many ranked candidate suggestions to attach to a player/team moderation row for one-click resolution.')
on conflict (key) do nothing;
