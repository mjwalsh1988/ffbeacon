-- Migration 0177: stop the Beacon Brief writing a second article about a story it
-- already covered.
--
-- WHAT WENT WRONG
--
-- Migration 0169 added a size floor: a post the classifier rates at or above
-- bb_merge_block_relevance_tier never merges into an existing article, it always gets
-- its own. It shipped set to 3.
--
-- Tier 3 is what bb_categorize_prompt assigns to any post naming a current player and
-- saying anything at all about their football situation. That is the definition of a
-- post that can become an article on this site, so the floor did not limit merging, it
-- ended it. Between 2026-08-04 and 2026-08-07 the floor fired 129 times and the
-- follow-up matcher ran twice. The daily merge rate went from about 75% (the previous
-- bug, in the other direction) to under 2% without ever passing through the middle.
--
-- What that produced, from one four-day window:
--
--   6 articles  Jonathan Taylor's two-year Colts extension
--   5 articles  Jahmyr Gibbs' three-year Lions extension
--   5 articles  Jalon Walker's torn ACL
--   4 articles  Stefon Diggs signing with the Commanders
--   3 articles  Darnell Wright's Bears extension
--   2 each      Bijan Robinson, Peter Skoronski, O'Cyrus Torrence, Zay Flowers,
--               Aaron Donald
--
-- Twenty-three of the forty-nine articles published in that window covered an event
-- another article already covered. Every one of them ran the full pipeline: a web
-- search research call plus a Sonnet article write, roughly 200,000 input tokens each.
--
-- WHY THE FIX IS NOT ANOTHER THRESHOLD
--
-- The pipeline was asking a language model "is this the same story?" and acting on the
-- answer. Before 0169 the model said yes far too often; after 0169 it was never asked.
-- Neither setting of that dial was ever going to be right, because whether "Jonathan
-- Taylor and the Colts reached agreement on a two-year extension" at 11:55 and
-- "Jonathan Taylor officially has signed his two-year extension" at 19:15 are the same
-- event is not a judgement call. It is a lookup.
--
-- lib/beacon-brief/event-key.ts computes a fingerprint for every post from work the
-- pipeline has already done:
--
--   <kind of event>:<sorted resolved player ids>
--
-- An exact match against a live article inside the window is the same event by
-- construction, and it is settled in code with no model call and no tokens. Everything
-- weaker (same kind of event, overlapping but not identical people) still goes to the
-- model, which now sees a short list of plausible candidates instead of fifteen recent
-- articles. lib/beacon-brief/event-key.test.ts asserts the grouping against the actual
-- posts that produced the duplicates above.
--
-- THE CHANGES HERE
--
--   1. articles.event_key and news_ingestions.event_key, plus indexes.
--   2. bb_merge_block_relevance_tier drops to 0. The floor is superseded, and an exact
--      event match outranks it in code regardless: six articles about one signing is
--      the failure the floor exists to prevent, not an instance of it working.
--   3. bb_event_key_window_hours (72). Wider than the 12-hour follow-up lookback,
--      because a contract reported Tuesday is still that contract when it is made
--      official on Thursday.
--   4. bb_merge_gate_enabled + bb_merge_gate_prompt. Before paying to rewrite a merged
--      article, ask the cheap model whether the post changes anything. Most follow-ups
--      restate what the article already says and are dropped with nothing written.
--   5. bb_model_merge_rewrite (haiku). A merge edits an article that already exists and
--      runs no web research, so it does not need the article model.
--   6. bb_revision_triage_prompt is removed. The merge gate replaced it: same price,
--      reads the whole article body rather than a summary, runs in one place instead
--      of two.
--   7. bb_player_article_cap_per_day (3), a backstop that does not depend on any of the
--      above being correct.
--   8. news_ingestions.filter_reason gains 'volume_cap'.
--   9. A beacon_brief_health row for the volume alert throttle.
--
-- NOT CHANGED HERE, BUT PART OF THE SAME FIX (code only)
--   - A merged post KEEPS its Discord card. Merging is now a website decision; the
--     channel still gets every beat of a developing story. The card-deletion path that
--     ran on merge is gone.
--   - A slug collision with a live article sharing a player inside the window is
--     treated as a duplicate and merged, instead of publishing behind a random 5-char
--     suffix.
--   - Duplicate candidates are compared across every source, not only within one
--     reporter's account.
--
-- ACCESS MATRIX (unchanged by this migration)
--   articles                 SELECT public where status = 'published'; writes service_role only
--   news_ingestions          service_role only
--   beacon_settings          SELECT service_role only; writes service_role behind the admin gate
--   beacon_brief_health      service_role only
-- Two nullable columns and one CHECK are added to tables that already have their
-- policies; no policy, grant, or RLS state changes. The new columns inherit the
-- existing table policies, so no new policy is required.
--
-- Regenerate lib/database.types.ts after applying: articles and news_ingestions both
-- gain a column.

-- ---------------------------------------------------------------------------
-- 1. The event key columns
-- ---------------------------------------------------------------------------

alter table public.articles
  add column if not exists event_key text;

comment on column public.articles.event_key is
  'Deterministic fingerprint of the real-world event this article covers, as <kind>:<sorted player ids>. Computed in lib/beacon-brief/event-key.ts with no model call. Null for articles not written by the Beacon Brief, and for posts whose event kind or players could not be resolved.';

alter table public.news_ingestions
  add column if not exists event_key text;

comment on column public.news_ingestions.event_key is
  'The event key computed for this post at curation time. Recorded even when the post merges or is dropped, so the audit trail shows which event the pipeline believed it belonged to.';

-- Partial indexes: the vast majority of rows carry no key, and every lookup filters
-- on one, so indexing only the non-null rows keeps both indexes small.
create index if not exists articles_event_key_idx
  on public.articles (event_key, created_at desc)
  where event_key is not null;

create index if not exists news_ingestions_event_key_idx
  on public.news_ingestions (event_key, created_at desc)
  where event_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Turn off the size floor that disabled merging
-- ---------------------------------------------------------------------------

update public.beacon_settings
set value = '0'::jsonb,
    description = 'A post the classifier rates at or above this tier never merges into an existing article. Set to 0 (off) in migration 0177: the classifier rates every post about a current player a 3, so any value at or below 3 stops merging entirely rather than limiting it. The event key handles same-event detection now, and an exact event match ignores this floor in any case. Raise it above 3 only if you want to reinstate a size-based block on the model-judged merges.'
where key = 'bb_merge_block_relevance_tier';

-- ---------------------------------------------------------------------------
-- 3. How far back an event key looks
-- ---------------------------------------------------------------------------

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_event_key_window_hours', '72'::jsonb, 'number',
   'Same-event window (hours)',
   'How far back to look for the article that already covers this event. Wider than the follow-up lookback on purpose: a contract reported on Tuesday is still the same contract when the team announces it on Thursday. Lower it if genuinely separate events for the same player start getting folded together; raise it if slow-developing stories still spawn a second article.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The merge gate: do not pay to rewrite when nothing changed
-- ---------------------------------------------------------------------------

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_merge_gate_enabled', 'true'::jsonb, 'boolean',
   'Check a merge changes something before rewriting',
   'When a post is folded into an existing article, ask the triage model whether it actually adds a fact the article does not already state. If it does not, nothing is written: no rewrite, no revision snapshot, no "Updated" line for a change that is not one. Turn this off to rewrite on every merge, which is what the pipeline did before migration 0177.')
on conflict (key) do nothing;

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_merge_gate_prompt',
   to_jsonb($prompt$You decide whether a new social post changes an FF Beacon article that already covers the same news event. You receive the existing article (its title, summary, and full body) and the new post.

Return true for adds_new_information ONLY when the post states a fact a fantasy manager would act on that the article does not already state. Examples of a real change:
- A status hardened or reversed: feared becomes confirmed, week-to-week becomes out for the season, expected to sign becomes signed.
- A number the article does not have: contract terms, guarantees, a games-missed timeline, a suspension length, a return date.
- A named role change: a starting job won or lost, a depth chart move, a snap or touch share the article does not mention.
- A correction: the post contradicts something the article says.

Return false when the post covers the same event and adds nothing actionable. This is the common case and you should expect it. Examples:
- The post restates the event in different words, or links to another outlet's write-up of it.
- The post is a reaction, a quote about how someone feels, a congratulation, or a note that a celebrity responded.
- The post is a stat line, a career summary, or a list that includes this player alongside others.
- The post confirms something the article already reports as done.

Being second, or shorter, or from a different reporter is not new information. Ask only whether a reader who has read the article would learn something that changes what they do with their roster.

When you return true, put one short clause in what_is_new naming the specific fact. When you return false, return an empty string.

Respond with strict JSON only, no prose and no code fences, with exactly two fields: adds_new_information (boolean) and what_is_new (string). Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.$prompt$::text),
   'string',
   'Merge gate prompt',
   'Asked once, on the cheap model, before a merged post is allowed to trigger a rewrite. A "no" costs a fraction of a cent and stops a rewrite that would have cost several. Replaced bb_revision_triage_prompt, which asked a similar question against a summary rather than the full article body, and asked it in a second place.')
on conflict (key) do nothing;

-- The triage prompt the merge gate replaced. Removed rather than left in place so the
-- Settings page does not show a prompt that no longer runs.
delete from public.beacon_settings where key = 'bb_revision_triage_prompt';

-- ---------------------------------------------------------------------------
-- 5. The model that performs a merge
-- ---------------------------------------------------------------------------

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_model_merge_rewrite', to_jsonb('claude-haiku-4-5'::text), 'string',
   'Merge rewrite model',
   'Model used to fold a follow-up into an existing article. A merge edits an article that already exists and runs no web research, so it is a much smaller job than writing one from nothing. Set this to the article model (claude-sonnet-4-6) if the prose quality of merged updates matters more than the cost difference, which is a few cents a day at current volume.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. The volume backstop
-- ---------------------------------------------------------------------------

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_player_article_cap_per_day', '3'::jsonb, 'number',
   'Max articles per player per day',
   'Most articles the Brief may write about one player in 24 hours. A post that would exceed it is not written: its Discord card still posts, and the post lands in the Filtered queue where one click publishes it anyway. This is a backstop that does not depend on the duplicate detection being correct, and it is what turns a repeat of the 2026-08 incident into one email on day one. Set 0 to disable.')
on conflict (key) do nothing;

-- A capped post is held, not filtered for being bad, so it needs its own reason.
alter table public.news_ingestions
  drop constraint if exists news_ingestions_filter_reason_check;

alter table public.news_ingestions
  add constraint news_ingestions_filter_reason_check
  check (filter_reason = any (array[
    'keyword'::text,
    'ai_non_football'::text,
    'ai_low_relevance'::text,
    'volume_cap'::text
  ]));

-- ---------------------------------------------------------------------------
-- 7. The alert throttle row for the volume cap
-- ---------------------------------------------------------------------------

insert into public.beacon_brief_health (component, status)
values ('article_volume', 'ok')
on conflict (component) do nothing;

comment on table public.beacon_brief_health is
  'Per-component health for the Beacon Brief pipeline. Doubles as the alert throttle: one email per component per cooldown window instead of one per failed job. Components: x_api (the X read integration), queue_failures (permanently failed queue jobs), article_volume (the per-player daily article cap).';
