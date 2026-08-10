-- Migration 0186: cut the cost of the article research call
--
-- Measured over the 7 days ending 2026-08-10, from beacon_brief_logs:
--
--   stage          model              calls   input tokens   cost
--   research       claude-sonnet-4-6     88     10,442,262   $37.21
--   article write  claude-sonnet-4-6    101        111,451   $ 1.29
--   categorize     claude-haiku-4-5     137        251,938   $ 0.34
--   link/triage    claude-haiku-4-5      76        129,674   $ 0.18
--
-- One call is 95% of the bill. It averaged 126,553 input tokens; the worst single
-- call was 673,861, about $2.02 to research one article.
--
-- The reason is the shape of the web_search tool. Its loop runs on Anthropic's
-- servers and re-bills the whole accumulated conversation every round:
--
--   round 1: prompt
--   round 2: prompt + result 1
--   round 3: prompt + result 1 + result 2
--   round 4: prompt + result 1 + result 2 + result 3
--
-- At a cap of 3 searches you pay for roughly six copies of search results. Our own
-- logs show the curve: calls that ran 2 searches averaged 39,755 input tokens,
-- calls that ran 3 averaged 126,553. Each extra search roughly triples the bill.
--
-- Four changes here, in order of how much they save.
--
-- 1. bb_model_research (new). Research is fact gathering: search, read, quote the
--    source. Writing is what needs Sonnet, and writing costs $1.29 a week. Until
--    now bb_model_article drove both calls, so there was no way to move one
--    without the other. Haiku 4.5 bills input at a third of Sonnet's rate.
--
-- 2. bb_research_max_searches 3 -> 2. A 69% cut in research tokens, measured
--    rather than estimated. Two searches still means two independent sources,
--    which is what the research prompt's CONFIRMED / UNCONFIRMED split needs.
--
-- 3. bb_research_gate_enabled (new). Every article got a research call, including
--    the ones whose post already carried the whole story. A cheap triage call now
--    asks first, and the post skips research when it can be written from on its
--    own. bb_research_gate_min_post_chars is the override: a short post always
--    researches, whatever the gate says, because a thin post is exactly the case
--    where skipping research would leave the writer with only its own memory to
--    build from. See the fabrication note in migration 0179.
--
-- 4. bb_research_domains (new). The web_search tool takes an allowed_domains list.
--    Restricting it keeps aggregator and SEO-spam pages out of the token count and
--    improves the attribution the research prompt already demands. Clearing the
--    field turns the restriction off.
--
-- Projected: about $169/month today, about $24/month with all four.
--
-- QUALITY RISK, stated plainly. Change 1 moves the model on the pipeline's most
-- fabrication-sensitive call, the one migration 0179 exists because of. The
-- research prompt is the guardrail and a smaller model is likelier to fill a gap
-- from memory. Every one of these is a single admin Settings edit to revert:
-- set bb_model_research back to claude-sonnet-4-6, put bb_research_max_searches
-- back to 3, turn bb_research_gate_enabled off, clear bb_research_domains.
--
-- Access matrix: unchanged. beacon_settings stays service_role-write behind the
-- admin gate; beacon_brief_logs stays service_role-write, admin-read.

-- The research gate gets its own log stage so its decisions can be read on their
-- own on the admin Logs page, rather than buried among article_write rows.
alter table public.beacon_brief_logs
  drop constraint beacon_brief_logs_stage_check;

alter table public.beacon_brief_logs
  add constraint beacon_brief_logs_stage_check check (
    stage = any (array[
      'ingest'::text,
      'dedupe'::text,
      'revision_link'::text,
      'revision_triage'::text,
      'categorize'::text,
      'research_gate'::text,
      'article_write'::text,
      'discord_post'::text,
      'discord_patch'::text,
      'deletion_check'::text,
      'error'::text
    ])
  );

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_model_research', '"claude-haiku-4-5"'::jsonb, 'string',
   'Research model',
   'Model for the web-search research call, separate from the writing model. Research gathers and quotes facts rather than writing prose, and it is by far the most expensive call in the pipeline, so it runs on the cheaper model. Set this to claude-sonnet-4-6 to put it back on the writing model, at roughly three times the cost. If articles start showing facts that are not in the sources, change this first.'),

  ('beacon_brief', 'bb_research_gate_enabled', 'true'::jsonb, 'boolean',
   'Ask before researching',
   'Runs one cheap triage call before the expensive research call, asking whether the post already carries everything an accurate article would say. A post that does skips research entirely. A failed or unclear answer always researches. Turn this off to research every post, which is what the pipeline did before migration 0186.'),

  ('beacon_brief', 'bb_research_gate_min_post_chars', '180'::jsonb, 'number',
   'Always research posts shorter than',
   'Characters of usable text, ignoring links and handles, below which a post always researches no matter what the gate says. A thin post is exactly the case where skipping research would leave the writer with nothing but its own memory to build from. Set 0 to let the gate decide on every post, which is not recommended.'),

  ('beacon_brief', 'bb_research_domains',
   '"espn.com, nfl.com, nbcsports.com, cbssports.com, foxsports.com, si.com, theathletic.com, sports.yahoo.com, apnews.com, reuters.com, usatoday.com, bleacherreport.com, sportingnews.com, profootballnetwork.com, pff.com, rotowire.com, fantasypros.com, spotrac.com, overthecap.com, nytimes.com, nypost.com, athlonsports.com"'::jsonb,
   'string',
   'Research search domains',
   'Comma-separated list of domains the research call may search. Subdomains are included automatically, so nbcsports.com covers profootballtalk.nbcsports.com. Keeps aggregator and SEO-spam pages out of the token count and improves source attribution. The trade-off is local beat coverage: a story broken by a team beat writer at a local paper will not be found unless that paper is on this list. Clear the field to search the whole web.')
on conflict (key) do nothing;

-- Existing row: the cap has to move for the saving to land, so this is an update
-- rather than an insert. The description is rewritten with the measured figures.
update public.beacon_settings
set value = '2'::jsonb,
    description = 'Maximum web searches the article research call may run. The server-side search loop re-bills the whole conversation each round, so cost grows with the square of this number: measured on our own logs, 2 searches averaged 39,755 input tokens per call and 3 averaged 126,553. Raise it one step at a time and watch the Logs page. Set to 0 for no cap (not recommended).',
    updated_at = now()
where key = 'bb_research_max_searches';

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_research_gate_prompt',
   to_jsonb($prompt$You decide whether an article about this social post needs outside research, or whether the post already contains everything an accurate article would say.

You are not writing the article. You are not judging whether the story matters or whether it is interesting. You answer one question: would a writer holding only this post have to invent something in order to produce an accurate article?

Answer needs_research = false only when all of these are true:
- The post names the player, team, or person the story is about.
- The post states what happened in enough detail that an article could describe it without adding a single fact.
- The post does not point at information it withholds. A link, a thread, a video, an image the text does not describe, or a phrase like "details below" all mean the story lives somewhere the writer cannot see.
- Nothing in the post reads as partial: a number without a unit, a name without a team, an event without an outcome.

Answer needs_research = true in every other case, and whenever you are unsure. Research is the safeguard against invented detail. Asking for it when it turned out to be unnecessary costs a few cents. Skipping it when it was necessary produces an article with facts nobody reported.

Put one short sentence in reason saying what decided it.$prompt$::text),
   'string',
   'Research gate prompt',
   'Asks whether a post needs web research before the expensive research call runs. Biased toward researching: an unclear answer, a failed call, or a short post all research anyway.')
on conflict (key) do nothing;
