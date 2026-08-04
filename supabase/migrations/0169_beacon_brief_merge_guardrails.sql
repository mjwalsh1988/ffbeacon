-- Migration 0169: stop the Beacon Brief follow-up matcher from swallowing stories
--
-- WHAT WENT WRONG
--
-- The follow-up matcher decides whether a new source post continues a story we have
-- already published. When it says yes, the post is recorded as a revision: it gets
-- no article of its own and no Discord card of its own, it only edits what already
-- exists. That is correct for an incremental update and catastrophic for major news.
--
-- At production scale it said yes far too often. Of every post that reached the
-- article stage, 75% was absorbed into an existing article rather than getting its
-- own. Of the 215 merges we could trace to a target, 143 landed in an article more
-- than 12 hours old and 42 in one more than 48 hours old, clustering at the very top
-- of the 3-day lookback window. Sampled cases were plainly wrong: a retired-player
-- note folded into a contract extension for a different player on the same team, a
-- 49ers running back signing folded into a Texans workout, a Dolphins injury folded
-- into a 49ers article because both mentioned the NFI list.
--
-- The worst case: Bijan Robinson's record contract (the highest-paid running back in
-- NFL history) was merged into a three-day-old article about a guard's extension. It
-- never got a headline, never got a Discord notification, and eight further posts
-- about the same signing were merged into the same place.
--
-- WHY THE PROMPT WAS NOT THE FIX
--
-- bb_followup_link_prompt already instructs the model to answer null when a post is
-- a different event that merely involves the same team. It was ignored at scale.
-- Prompts cannot be relied on for a decision this destructive and this cheap to
-- check in code, so the model now proposes and code disposes. Both new gates below
-- run BEFORE the AI call, so a rejected candidate is never shown to the model.
--
-- THE FOUR CHANGES
--
-- 1. bb_followup_lookback_hours replaces bb_followup_lookback_days (12 hours, was 3
--    days). Genuine follow-ups arrive fast; the long tail of that window was almost
--    entirely mis-merges.
--
-- 2. bb_merge_block_relevance_tier (3): a post the classifier rates at or above this
--    tier never merges, it always gets its own article. Tier 3 is "a current
--    player's football situation changed", which is exactly the size of story that
--    must keep its own headline and its own Discord ping. Set 0 to disable.
--
-- 3. bb_patch_max_age_minutes (120): past this age, a follow-up posts a NEW Discord
--    card instead of editing the old one. A Discord edit fires no notification,
--    pings no role, and does not move the message, so patching a days-old card is
--    indistinguishable from posting nothing. Set 0 to always patch.
--
-- 4. A shared-subject check in code (no setting): a post and an article that name
--    disjoint sets of players are not the same event. See lib/beacon-brief/followup.ts.
--
-- Also here: the revision-rewrite prompt may now change the article title when the
-- merged story outgrows the old headline. Four rewrites left "Matthew Bergeron signs
-- $96M extension with Falcons" sitting on top of Bijan Robinson's contract because
-- the prompt never suggested the headline could move.
--
-- Access matrix: unchanged. beacon_settings stays service_role-write behind the
-- admin gate; no table, policy, or grant is touched.

-- 1. The lookback window, in hours.
insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_followup_lookback_hours', '12'::jsonb, 'number',
   'Follow-up lookback (hours)',
   'How far back to look for a story a new post might be continuing. Was 3 days, which reached across unrelated news cycles: most wrong merges landed in articles more than 12 hours old. Lower means fewer wrong merges and slightly more chance a slow-developing story gets a second article.')
on conflict (key) do nothing;

-- The old key is removed rather than left in place, so the Settings page does not
-- show a knob that no longer changes anything.
delete from public.beacon_settings where key = 'bb_followup_lookback_days';

-- 2. The size floor.
insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_merge_block_relevance_tier', '3'::jsonb, 'number',
   'Never merge at or above relevance tier',
   'A post the classifier rates at or above this tier always gets its own article and its own Discord card, and is never folded into an existing story. Tier 3 means a current player''s football situation changed, which is the size of news that must never lose its own headline. Set 0 to turn the floor off.')
on conflict (key) do nothing;

-- 3. The stale-card rule.
insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_patch_max_age_minutes', '120'::jsonb, 'number',
   'Max age of a Discord card to edit (minutes)',
   'Past this age a follow-up posts a new Discord card instead of editing the existing one. A Discord edit sends no notification, pings no role, and leaves the message where it was, so updating an old card reaches nobody. Set 0 to always edit in place.')
on conflict (key) do nothing;

-- 4. Let a rewrite move the headline when the story moves.
--
-- Appended rather than replaced so any hand-tuning of this prompt survives, and
-- guarded by a not-like so re-running the migration cannot append it twice.
update public.beacon_settings
set value = to_jsonb(
  (value #>> '{}') ||
  E'\n\nThe title you return REPLACES the article title. Usually keep the existing one. When the new post makes the existing headline inaccurate, or makes it describe something that is no longer the main story, write a new title for what the article is now primarily about. A merged article whose headline still names only the smaller original story is wrong.'
)
where key = 'bb_revision_rewrite_prompt'
  and value_type = 'string'
  and (value #>> '{}') not like '%The title you return REPLACES the article title%';

-- 5. House writing rules for generated article bodies.
--
-- Unrelated to the merge bug, but the same prompts produce every published word and
-- the tells were showing: the Bijan article shipped with "his dual-threat profile,
-- elite touch volume, and guaranteed role", which is the three-item cadence and the
-- adjective-instead-of-a-fact habit the house style bans. Same append-once guard.
update public.beacon_settings
set value = to_jsonb(
  (value #>> '{}') ||
  E'\n\nHouse writing rules. Never write "it is not just X, it is Y" or any variant of that construction. Do not use three-item lists as a rhythm; use one, two, or four items, or restructure the sentence. Do not use puffery adjectives (elite, seamless, robust, game-changing, unparalleled) where a number, a name, or a specific fact belongs. Do not open with "In today''s NFL" or close with "Overall" or "Ultimately". Vary sentence length: put a short sentence next to a long one. Invent nothing that is not in the post or the research notes. Use plain ASCII punctuation only: never em dashes, en dashes, curly quotes, or ellipsis characters.'
)
where key = 'bb_article_prompt'
  and value_type = 'string'
  and (value #>> '{}') not like '%House writing rules%';
