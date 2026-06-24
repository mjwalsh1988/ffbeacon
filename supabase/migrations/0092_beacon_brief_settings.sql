-- Migration 0092: Beacon Brief settings into beacon_settings (category 'beacon_brief')
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes blocked).
--
-- Every Beacon Brief tunable and EVERY AI prompt is a row here so it is visible
-- and editable on the admin Beacon Brief Settings page with no code deploy. The
-- code defaults in lib/beacon-brief/* are only fallbacks used when a row is
-- absent. Toggles: bb_enabled (master) and bb_discord_enabled (shadow/test mode:
-- run the whole pipeline but skip Discord). Models, web search, autopublish,
-- the context threshold, the selected webhook, the follow-up lookback, the queue
-- backoff cap, and the per-run Discord throttle are all editable here.
--
-- Prompts use plain ASCII only (no em dashes etc.) and instruct the model to do
-- the same, per the project no-AI-tell rule.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'Beacon Brief enabled',
   'Master switch. When off, the curation cron ingests nothing and the worker processes nothing.'),
  ('bb_discord_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'Discord posting enabled',
   'Shadow/test mode. When off, the pipeline still ingests, scores, and writes articles, but all Discord posts and patches are skipped (jobs are marked done).'),
  ('bb_web_search_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'Web search grounding',
   'When on, article writing first runs a web-search-grounded research call, then a strict structuring call. When off, articles are written from the post and our data only.'),
  ('bb_autopublish', 'true'::jsonb, 'boolean', 'beacon_brief', 'Auto-publish articles',
   'When on, a context_score=1 article is created with status published. When off, it is created as a draft for review.'),
  ('bb_context_threshold', '1'::jsonb, 'number', 'beacon_brief', 'Context score threshold',
   'Minimum context score for a post to become an article. Posts below this are sent to Discord only.'),
  ('bb_followup_lookback_days', '3'::jsonb, 'number', 'beacon_brief', 'Follow-up lookback days',
   'How many days of a source recent articles the follow-up linker compares a new post against when detecting a revision.'),
  ('bb_queue_max_attempts', '5'::jsonb, 'number', 'beacon_brief', 'Queue max attempts',
   'Number of attempts a queue job gets before it is marked failed (which sends the admin email alert).'),
  ('bb_discord_jobs_per_run', '25'::jsonb, 'number', 'beacon_brief', 'Discord jobs per worker run',
   'Maximum Discord post/patch jobs the worker processes per run, kept safely under the 30-per-minute webhook limit.'),
  ('bb_model_article', to_jsonb('claude-sonnet-4-6'::text), 'string', 'beacon_brief', 'Article writing model',
   'Anthropic model used for article writing and rewriting (web-search grounded).'),
  ('bb_model_triage', to_jsonb('claude-haiku-4-5'::text), 'string', 'beacon_brief', 'Triage model',
   'Anthropic model used for the cheap classification calls: context score, revision triage, and follow-up linking.'),
  ('bb_webhook_id', to_jsonb(''::text), 'string', 'beacon_brief', 'Beacon Brief Discord webhook',
   'The discord_webhooks row the Beacon Brief posts through. Set this on the Settings page from the webhooks you added under System Settings.'),
  ('bb_categorize_prompt',
   to_jsonb('You are the Beacon Brief news classifier for FF Beacon, a fantasy football site. You receive one social post as JSON: its text, plus any quoted or retweeted content and media descriptions. First decide context_score: return 0 when the post does not carry enough self-contained information to justify a standalone news article (for example a vague tease, a reply with no subject, or pure reaction), and 1 when it does. Then choose exactly one primary category from this list by slug: {categories}. Identify every NFL player involved by full name, and every NFL team involved by name or abbreviation. Suggest a short list of search-friendly article tags. Suggest an article title and an SEO slug with filler and stop words removed. Base everything only on the supplied post and its quoted or retweeted content. Respond with strict JSON only, no prose and no code fences. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Categorize + context-score prompt',
   'Inline curation call. Returns context_score plus category, players, teams, tags, and a suggested title/slug. {categories} is replaced with the active category list at runtime.'),
  ('bb_article_research_prompt',
   to_jsonb('You are a fantasy football research assistant for FF Beacon. You are given a social post and the players, teams, and people it involves. Use web search to gather the most recent and relevant facts needed to write an accurate news article: confirm what happened, when, who and which teams are involved, and any fantasy football implications. Return concise factual notes with the key points and dates. Do not write the article yet. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Article research prompt (web search)',
   'Queued article_write step A. Web-search-grounded fact gathering. Skipped when web search grounding is off.'),
  ('bb_article_prompt',
   to_jsonb('You are a fantasy football news writer for FF Beacon. Voice: direct, conversational, analytical, friendly, no fluff. You receive the original social post, its quoted or retweeted content, and research notes. Write a clear, accurate news article for a fantasy football audience. Return strict JSON only with these fields: title, slug, meta_description, tl_dr, body_md. body_md is markdown. The slug must be lowercase, hyphenated, with filler and stop words removed. Do not invent facts beyond the post and the research notes. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Article writing prompt',
   'Queued article_write step B. Writes the article body as strict JSON from the post plus research notes.'),
  ('bb_revision_triage_prompt',
   to_jsonb('You compare an existing FF Beacon article with a new revision of the source post it was based on. Decide whether the new post adds critical new information that materially changes the story (for example a status change, a correction of a key fact, new numbers, or a reversal), as opposed to a trivial change such as a spelling fix or rewording. Respond with strict JSON only: a single boolean field named critical. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Revision triage prompt',
   'Inline revision call. Returns whether a revised source post carries critical new info (rewrite the article) or is trivial (patch Discord only).'),
  ('bb_revision_rewrite_prompt',
   to_jsonb('You update an existing FF Beacon article to incorporate new information from a revised source post. You receive the current article (title, body, tags, category, players, teams) and the new post content. Merge only the genuinely new information into the article while preserving its structure and accurate existing content. Return strict JSON only with these fields: title, meta_description, tl_dr, body_md, change_summary. change_summary is one sentence describing what changed. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Revision rewrite prompt',
   'Queued article_write rewrite mode. Merges new info from a critical revision into the existing article.'),
  ('bb_followup_link_prompt',
   to_jsonb('You decide whether a new social post from a source is a follow-up or update to a story FF Beacon already published from the same source. You receive the new post and a list of that source recent articles (id, title, summary). If the new post clearly continues or updates one of them, return its id. Otherwise return null. Respond with strict JSON only with a single field named matched_article_id whose value is the matching id or null. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.'::text),
   'string', 'beacon_brief', 'Follow-up linking prompt',
   'Inline curation call. Links a new non-edit post to a recent article from the same source so it is treated as a revision.')
on conflict (key) do nothing;
