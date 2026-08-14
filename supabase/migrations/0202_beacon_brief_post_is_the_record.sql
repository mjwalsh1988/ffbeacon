-- Stop the pipeline rejecting real news because the model remembers an older roster.
--
-- WHY
-- On 2026-08-11 the Vikings named Kyler Murray their starting quarterback. Three posts
-- reported it. One became an article. The other two were filtered out by the classifier
-- with these reasons, recorded in news_ingestions.filter_detail:
--
--   "Post is fabricated; Kyler Murray plays for Arizona Cardinals, not Vikings."
--   "Kyler Murray is not a current Vikings player; post lacks verifiable context."
--
-- Both are wrong, and they are wrong in the one way that is hardest to notice: the
-- model was reasoning from its own training data, which predates the trade, and it
-- graded a correctly sourced ESPN report as a fake. Nothing in the classifier prompt
-- told it not to. The story only survived because a third post about the same event
-- happened to be graded by a different call that did not raise the objection.
--
-- The failure mode scales badly. A player changing teams is exactly when his news
-- matters most to a fantasy manager, and it is exactly when the model's memory is most
-- confidently out of date. A story carried by a single post would have been lost with
-- no trace beyond one line in a filter log.
--
-- WHAT THIS CHANGES
-- Three prompts, one idea: the post is the record of what happened, and the model's
-- memory of who plays where is the least reliable thing in the room.
--
--   1. bb_categorize_prompt gains a rule, ahead of every other instruction, that
--      forbids lowering a tier or flagging a post because a claim contradicts what the
--      model remembers or cannot be verified from memory. Truth is not what this call
--      is being asked to judge; relevance is. Retractions are already handled: every
--      post stays under a deletion watch (lib/beacon-brief/deletion.ts) and a pulled
--      post opens a moderation item against its article.
--
--   2. bb_article_research_prompt gains rule 7. Rule 6 tells the researcher to
--      contradict the post when search does, which is correct and which an older
--      article trivially appears to do: search for a player who moved in August and
--      the whole first page describes his previous team. Only a result covering the
--      same event counts.
--
--   3. bb_article_prompt gains a line in its ACCURACY section so the writer states a
--      surprising fact as given rather than hedging it or quietly correcting it.
--
-- Each update is a surgical insert into the stored text rather than a rewrite, so the
-- editing anyone has done on the Settings page since these prompts shipped survives.
-- Each is guarded by a NOT LIKE on its own marker phrase, so re-running this migration
-- cannot insert the paragraph twice.
--
-- ACCESS MATRIX (unchanged by this migration)
--   beacon_settings   SELECT service_role only; writes service_role only
-- No DDL, so no RLS policy changes and no type regeneration are required.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps the file in a single
-- transaction, so an error in any statement rolls back all of them.

-- ---------------------------------------------------------------------------
-- 1. The classifier
-- ---------------------------------------------------------------------------

update beacon_settings
set value = to_jsonb(
  replace(
    value #>> '{}',
    'Step 1, non_football.',
    $ins$THE POST IS THE RECORD, NOT YOUR MEMORY. Read this before anything else. These posts are published after your training data ends, and they come from a source list FF Beacon curates and trusts. Rosters, depth charts, starting jobs, contracts, and team affiliations have all moved since the world you remember, and when a post disagrees with your memory about any of them, the post is the newer fact and your memory is the stale one. Classify what the post says. Never lower a tier, never set non_football, and never set context_score to 0 because a claim looks wrong, sounds impossible, contradicts the team you remember a player being on, or cannot be checked from what you know. Whether the report is TRUE is not what you are being asked. A reporter who gets it wrong is handled elsewhere: every post stays under a deletion watch, and a deleted post opens a review against its article automatically.

Step 1, non_football.$ins$
  )
)
where category = 'beacon_brief'
  and key = 'bb_categorize_prompt'
  and value #>> '{}' not like '%THE POST IS THE RECORD%';

-- ---------------------------------------------------------------------------
-- 2. The researcher
-- ---------------------------------------------------------------------------

update beacon_settings
set value = to_jsonb(
  replace(
    value #>> '{}',
    'Format: short bullet points',
    $ins$7. An older result is not a contradiction. Search will return articles written before this event, and they describe the world as it was: the team a player used to be on, the job someone used to hold, the deal he used to be playing under. That is background, not evidence against the post. Rule 6 applies only when a result covers THIS event and states something different about it. When all you can find is material that predates the post, treat the post as the newer fact, write what you did confirm, and say plainly what you could not.

Format: short bullet points$ins$
  )
)
where category = 'beacon_brief'
  and key = 'bb_article_research_prompt'
  and value #>> '{}' not like '%An older result is not a contradiction%';

-- ---------------------------------------------------------------------------
-- 3. The writer
-- ---------------------------------------------------------------------------

update beacon_settings
set value = to_jsonb(
  replace(
    value #>> '{}',
    'Never invent a URL,',
    $ins$The post is newer than you are. If the post or the notes have a player on a team you do not associate him with, holding a job you do not remember him winning, or signing a deal you have never seen, write it as stated. Do not correct it, do not hedge it, and do not add a line of doubt about it. Your memory of a depth chart is the one thing in this task that is guaranteed to be out of date. Never invent a URL,$ins$
  )
)
where category = 'beacon_brief'
  and key = 'bb_article_prompt'
  and value #>> '{}' not like '%The post is newer than you are%';
