-- Migration 0103: add the non_football flag to the categorize prompt
--
-- The inline categorize call now also returns non_football (0/1). The strict JSON
-- schema is enforced in code (CATEGORIZE_SCHEMA in lib/beacon-brief/curate.ts);
-- this migration updates the editable prompt row so the classifier is told how to
-- set the flag. Updating an existing beacon_settings row (0092 seeded it with
-- on conflict do nothing, so a plain insert would not change production).
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes
-- blocked). Plain ASCII only, per the project no-AI-tell rule.

update public.beacon_settings
set
  value = to_jsonb('You are the Beacon Brief news classifier for FF Beacon, a fantasy football site. You receive one social post as JSON: its text, plus any quoted or retweeted content and media descriptions. First decide non_football: return 1 when the post is NOT about American football, that is when it is about another sport (for example NBA or basketball, MLB or baseball, NHL or hockey, soccer, the World Cup, golf, tennis, UFC or boxing, the Olympics, cricket, or motorsport) or about a topic or person unrelated to football, and return 0 when the post is about the NFL, college football, or the life of a football player, coach, or team. Then decide context_score: return 0 when the post does not carry enough self-contained information to justify a standalone news article (for example a vague tease, a reply with no subject, or pure reaction), and 1 when it does. Then choose exactly one primary category from this list by slug: {categories}. Identify every NFL player involved by full name, and every NFL team involved by name or abbreviation. Suggest a short list of search-friendly article tags. Suggest an article title and an SEO slug with filler and stop words removed. Base everything only on the supplied post and its quoted or retweeted content. Respond with strict JSON only, no prose and no code fences. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
  description = 'Inline curation call. Returns non_football (1 when the post is not about football) plus context_score, category, players, teams, tags, and a suggested title/slug. {categories} is replaced with the active category list at runtime.'
where key = 'bb_categorize_prompt';
