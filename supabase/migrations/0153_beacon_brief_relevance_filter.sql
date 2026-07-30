-- Migration 0153: the Beacon Brief fantasy relevance filter (gate 3)
--
-- WHY
-- Two filter gates already exist. The keyword blocklist (0102) catches other
-- sports by string match, and the AI non_football flag (0103) catches them by
-- classification. Neither can catch a post that IS about football but carries no
-- fantasy decision, and that is where the noise was coming from: obituaries and
-- health news for retired players, Ring of Honor inductions, uniform reveals,
-- stadium renderings, team finances, ownership sales, league governance, front
-- office and scouting moves, broadcaster contracts.
--
-- Two specific causes, both fixed here.
--
-- 1. The categorize prompt told the classifier to let them through. Its
--    non_football definition ended "or the life of a football player, coach, or
--    team", which is exactly the bucket we want gone. Every unwanted article was
--    correctly classified under that instruction.
--
-- 2. Nothing measured fantasy relevance. context_score asks whether there is
--    enough information to write an article, which is a completeness test, not a
--    value test. A well-sourced obituary scores 1. Every unwanted article in
--    production carried context_score = 1.
--
-- WHAT THIS DOES
--   1. Allows 'ai_low_relevance' as a filter_reason on news_ingestions.
--   2. Adds bb_relevance_filter_enabled and bb_relevance_threshold.
--   3. Rewrites bb_categorize_prompt to score relevance_tier 0 to 3, via an
--      ordered decision ladder, with a hard subject-eligibility cap.
--   4. Adds the fantasy_impact verdict to bb_article_prompt, so research that
--      reveals an off-topic story can abort the publish.
--
-- THRESHOLD 2
-- Tier 3 is a current player's football situation; tier 2 is a team deployment
-- change; tier 1 is football news that changes no fantasy decision; tier 0 is not
-- football. Threshold 2 keeps tiers 2 and 3.
--
-- The prompt text below was backtested against all 249 non-revision ingestions in
-- production before this migration was written (scripts/backtest-brief-relevance.ts).
-- At threshold 2 it blocked 53 of the 115 published articles and let through 0 of
-- the 99 already-filtered posts, so it introduces no regression against the gates
-- that already work. Re-run that script before changing either the prompt or the
-- threshold.
--
-- WHY THE GATE RUNS WHERE IT DOES
-- In lib/beacon-brief/curate.ts the check sits before the ingestion insert, which
-- is what enqueues discord_post. A filtered post therefore never reaches Discord,
-- never reaches the research call, and never reaches the article writer. It lands
-- in the Filtered review queue with its tier and reason, where force-push bypasses
-- all three gates.
--
-- Access matrix (unchanged by this migration):
--   beacon_settings   service_role ALL; client writes blocked
--   news_ingestions   service_role ALL; no anon/authenticated access
-- The only DDL is a CHECK constraint swap on an existing column, so there are no
-- RLS policy changes. news_ingestions.filter_reason gains a value; the generated
-- types carry it as `string | null` either way, so no type regeneration either.
--
-- Plain ASCII only, per the project no-AI-tell rule.

-- ---------------------------------------------------------------------------
-- 1. Allow the new filter reason
-- ---------------------------------------------------------------------------

alter table public.news_ingestions
  drop constraint if exists news_ingestions_filter_reason_check;

alter table public.news_ingestions
  add constraint news_ingestions_filter_reason_check
  check (filter_reason in ('keyword', 'ai_non_football', 'ai_low_relevance'));

comment on column public.news_ingestions.filter_reason is
  'Why this post was filtered out of the pipeline: keyword (pre-AI blocklist hit), ai_non_football (classifier flagged another sport), or ai_low_relevance (classifier scored it below the fantasy relevance threshold, or the article stage found no fantasy impact after research). NULL for non-filtered rows.';

-- ---------------------------------------------------------------------------
-- 2. The two new tunables
-- ---------------------------------------------------------------------------

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('bb_relevance_filter_enabled', 'true'::jsonb, 'boolean', 'beacon_brief', 'Fantasy relevance filter enabled',
   'When on, a post the classifier scores below the relevance threshold is filtered to the review queue instead of being posted to Discord or made into an article. This is the gate that keeps obituaries, uniform reveals, stadium news, league business, and front office moves off the site. Applies to new posts only, not revisions.'),
  ('bb_relevance_threshold', '2'::jsonb, 'number', 'beacon_brief', 'Relevance threshold',
   'Minimum relevance tier a post needs to continue through the pipeline. 3 = a current player''s football situation changed. 2 = a team''s deployment of its players changed. 1 = real football news that changes no fantasy decision. 0 = not football. Default 2 keeps tiers 2 and 3. Raising it to 3 also drops coordinator hires and starting offensive line injuries. Backtest before changing it.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The rewritten classifier prompt
--
-- Updating the existing row: 0092 seeded these with on conflict do nothing, so a
-- plain insert would not change production.
--
-- Structural notes on the rewrite. The tier is scored through ordered checks that
-- stop at the first match, rather than as an open judgement, because a backtest of
-- an earlier open-judgement draft scored a Jahmyr Gibbs and Bijan Robinson contract
-- holdout as tier 1 ("off-season contract discussions"). The current-player
-- definition is spelled out for the same reason: that draft called free agents and
-- players on injured reserve "former players" and dropped real roster news. The
-- tie-break instruction leans high on purpose, because a false positive here
-- silently drops a real story while a false negative only costs one article.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set
  value = to_jsonb($prompt$You are the Beacon Brief news classifier for FF Beacon, a fantasy football site. You receive one social post as JSON: its text, plus any quoted or retweeted content and media descriptions.

Step 1, non_football. Return 1 when the post is about another sport (for example NBA or basketball, MLB or baseball, NHL or hockey, soccer, the World Cup, golf, tennis, UFC or boxing, the Olympics, cricket, or motorsport) or about a topic with no connection to football at all. Return 0 otherwise. When the post does not make clear which sport it concerns, return 0 and let the relevance tier carry the decision.

Step 2, decide whether the post is about a CURRENT PLAYER. A current player is anyone who could suit up for an NFL team this season. This includes players on a roster, on injured reserve, on PUP or NFI, on a practice squad, suspended, holding out, rehabbing an injury, unsigned free agents of any kind, players just released or waived or claimed, drafted and undrafted rookies, and anyone publicly working toward a return to play. Being unsigned, injured, or recently cut does NOT make someone a former player. Only call someone a former player when he has retired from playing or has been out of the league for at least a full season with no reported attempt to return.

Step 3, relevance_tier, an integer from 0 to 3. Work through these checks in order and stop at the first one that matches.

Check A. Does the post name one or more specific current players and say anything at all about their football situation? Football situation covers injuries and injury updates of any severity, practice and camp participation, activations, PUP, NFI and IR moves, signings, trades, releases, waivers, workouts, team visits, suspensions, holdouts and missed practices over a contract, every contract event including extensions, restructures and rookie deals even when the player stays on the same team in the same role, depth chart and starting job changes, retirements, and the player's own arrest, charge, or legal outcome. If yes, relevance_tier is 3. Stop here. Do not lower the tier because the event looks routine, because it happened in the off-season, because the player is a backup, or because you judge the fantasy impact to be small. That judgement is not yours to make at this step.

Check B. Is the post analysis, rankings, projections, or a preview covering current players for fantasy purposes? If yes, relevance_tier is 3. Stop here.

Check C. Does the post describe something that changes how an NFL team will deploy its players? Head coach or coordinator hires, firings, and absences, scheme changes, starting offensive line injuries, position battles, and any coaching change that plausibly alters snap counts, target share, or touches. If yes, relevance_tier is 2. Stop here.

Check D. Is it real football news that changes no fantasy decision? Uniform reveals, stadium news, ownership changes, team finances, league business and governance, lawsuits against the league, schedule and event logistics, draft and Super Bowl dates, awards, Ring of Honor inductions, jersey retirements, tributes and anniversaries, obituaries, health news about anyone with no current on-field role, media and broadcasting careers, front office and scouting staff moves, position coach discipline, agent news, and off-field matters involving anyone who is not a current player. If yes, relevance_tier is 1. Stop here.

Otherwise relevance_tier is 0.

Hard rule on subject eligibility. If the post's primary subject is not a current player, an active NFL coach, or a team decision that changes on-field usage, then relevance_tier is at most 1, even when the person involved was once a great player. This covers former players, people who have died, people whose illness or death came after their playing career, team owners and their families, league office staff, executives, general managers, scouts, agents, broadcasters and analysts, officials, and family members of any of the above. Honors, ceremonies, tributes, and obituaries are at most 1 in every case. This rule cannot raise a tier, only cap it, and it never overrides Check A: a post about a current player's football situation stays at 3.

When you are genuinely torn between two tiers, choose the higher one. Wrongly dropping real player news costs far more than letting one marginal story through.

Step 4, relevance_reason: one short clause under fifteen words naming the primary subject and the check that decided the tier.

Step 5, context_score. Return 0 when the post does not carry enough self-contained information to justify a standalone news article (for example a vague tease, a reply with no subject, or pure reaction), and 1 when it does.

Then choose exactly one primary category from this list by slug: {categories}. Identify every NFL player involved by full name, and every NFL team involved by name or abbreviation. Suggest a short list of search-friendly article tags. Suggest an article title and an SEO slug with filler and stop words removed. Base everything only on the supplied post and its quoted or retweeted content. Respond with strict JSON only, no prose and no code fences. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.$prompt$::text),
  description = 'Inline curation call. Returns non_football, relevance_tier (0 to 3) with relevance_reason, context_score, category, players, teams, tags, and a suggested title/slug. relevance_tier is compared against bb_relevance_threshold to decide whether the post continues to Discord and the article writer. {categories} is replaced with the active category list at runtime.'
where key = 'bb_categorize_prompt';

-- ---------------------------------------------------------------------------
-- 4. The article-stage abort
--
-- The classifier scores a post from its text alone, which is all it has. Research
-- can surface what the text could not show. The live example that motivated this:
-- a post reading "The No. 1 player in the Class of 2027, Marcus Spears Jr. is
-- reclassifying to the Class of 2026 and committing to Texas" never names a sport,
-- so no text-based gate could catch it. The research call found he is a basketball
-- recruit, the article said so, and it published anyway.
--
-- Appended rather than rewritten so the voice, SEO, and AI-tell sections of the
-- prompt (0146, 0147) are preserved exactly.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set
  value = to_jsonb(
    (value #>> '{}') || $add$

== RELEVANCE VERDICT ==
Along with the article, return two more fields: fantasy_impact (boolean) and no_impact_reason (string).

Set fantasy_impact to false when the research shows this story does not belong on a fantasy football site at all. That means the subject turns out to play a sport other than American football, or is not a current NFL player and the story is an obituary, a health disclosure, a ceremony or honor, a media or broadcasting career move, or a front office matter, or the event changes nothing about any NFL roster, depth chart, or player availability. When you set it to false, put one plain sentence in no_impact_reason saying what the research revealed, and do not pad the article to compensate. The article will not be published.

Set fantasy_impact to true in every other case, and set no_impact_reason to an empty string. Do not use this field to express that a story is minor or that the fantasy impact is small. Minor player news is still player news, and it publishes. This field is only for a story that should not exist on the site.$add$
  ),
  description = 'Article writing call. Returns title, slug, meta_description, tl_dr, body_md, plus fantasy_impact and no_impact_reason. fantasy_impact = false aborts the publish and files the post in the Filtered review queue; see handleArticleWrite in lib/beacon-brief/worker.ts.'
where key = 'bb_article_prompt';
