-- Migration 0152: teach bb_followup_link_prompt to recognise a same-event duplicate
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes blocked).
-- No schema change. Updates one existing row in category 'beacon_brief'.
--
-- Why: the prompt matched only a post that "clearly continues or updates" an existing
-- article. That wording covers a later development in a story and misses the case that
-- actually produced duplicate articles in production: two reporters posting the SAME
-- event minutes apart. Migration 0151 merged four such pairs by hand, and in two of
-- them the second post genuinely continued nothing. It restated the first.
--
--   Maaddi: "Ryan Gold suspended indefinitely for gambling"
--   Schefter (47s later): "NFL suspends Cardinals' Ryan Gold indefinitely"
--
-- Asked whether the second "continues or updates" the first, a reasonable model says
-- no, and a second article gets written. So the matching rule now names the same-event
-- restatement explicitly, alongside the added-detail and next-step cases it already
-- handled implicitly.
--
-- The counterweight matters just as much. Over-merging is worse than a duplicate,
-- because it folds a distinct story into the wrong article and the reader gets a
-- muddled page. So the prompt draws the line on event identity rather than on subject
-- (same player is not same story), and says explicitly to return null when unsure.
--
-- This is one half of the fix. The other half is that the curate-time matcher cannot
-- see a sibling article that has not been written yet; the worker now re-asks with
-- this same prompt just before writing. See lib/beacon-brief/followup.ts.
--
-- Dollar-quoted so the apostrophes inside the prompt need no escaping.

update public.beacon_settings
set value = to_jsonb($prompt$You decide whether a new social post from a source belongs to a story FF Beacon has already published an article about. You receive the new post and a list of that source's recent articles, each with an id, a title, and a summary.

Return the id of an article when the new post is about the SAME underlying news event as that article. All of these are the same event:
- The post reports the event again, from a different reporter or in different words, and adds nothing new.
- The post adds detail to the event: contract terms, a diagnosis, a timeline, an official statement, a named source.
- The post is the immediate next beat of the event: a confirmation, a correction, a denial, or the resolution of something the article described as pending.

Return null when the post is about a DIFFERENT event, even when it involves the same player, coach, or team as one of the articles. A player's contract extension and, separately, his ankle injury are two stories. What makes one story is that the post and the article describe the same event, or the direct continuation of it, not that they name the same person.

If you cannot tell whether the post and an article describe one event or two, return null.

Respond with strict JSON only, with a single field named matched_article_id whose value is the matching id or null. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.$prompt$::text),
    description = 'Follow-up link triage. Decides whether a new source post belongs to an already-published article from the same source, so the pipeline revises instead of writing a duplicate. Matches same-event restatements, added detail, and the immediate next beat; returns null for a different event about the same subject, and when unsure.',
    updated_at = now()
where key = 'bb_followup_link_prompt';
