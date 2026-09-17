-- Migration 0285: brief_desk settings, the legacy article switch, and the
-- RELAY section of the classify prompt
--
-- Three things, all rows in beacon_settings (no DDL, no RLS change):
--
--   1. The 'brief_desk' category: cadence, the editorial instructions handed
--      to the desk run inside the bundle, the RELAY prompt section, and the
--      Discord flag for approved editions. Loaded by
--      lib/brief-desk/settings.ts, edited at /admin/brief-desk/settings.
--   2. bb_article_write_enabled, default false. The per-post article path
--      stays in the worker but nothing enqueues it while this is off. See
--      docs/beacon-brief/relays-and-briefs-plan.md section 4.2.
--   3. The RELAY section appended to bb_categorize_prompt, guarded by a NOT
--      LIKE on its marker line the way migration 0202 guards its inserts, so
--      re-running cannot append it twice and an admin's later edits survive.
--
-- The two long prompt texts are byte-identical to the code fallbacks in
-- lib/brief-desk/instructions-seed.ts and lib/relays/extract.ts. This file
-- was generated from them by scripts/gen-brief-desk-settings-sql.ts; regenerate
-- rather than editing the text here by hand.
--
-- Access matrix (unchanged): beacon_settings is service_role only; the admin
-- pages read and write it through the service-role client behind requireAdmin.

insert into public.beacon_settings (category, key, value, value_type, label, description) values
  ('brief_desk', 'bd_enabled', 'true'::jsonb, 'boolean', $lbl$Brief desk enabled$lbl$, $dsc$The bundle endpoint answers due at all. Off means every desk run is told no edition is due.$dsc$),
  ('brief_desk', 'bd_inseason_cadence', to_jsonb('weekly'::text), 'string', $lbl$In-season cadence$lbl$, $dsc$Fixed at weekly. Shown for clarity; the period is the NFL week.$dsc$),
  ('brief_desk', 'bd_offseason_monthly', 'false'::jsonb, 'boolean', $lbl$Off-season monthly$lbl$, $dsc$Off, the off-season runs every two weeks with periods closing on the 1st and 16th. On, periods close on the 1st only.$dsc$),
  ('brief_desk', 'bd_run_weekday', '2'::jsonb, 'number', $lbl$Close weekday$lbl$, $dsc$The weekday an in-season period closes, Eastern. 0 is Sunday, 2 is Tuesday.$dsc$),
  ('brief_desk', 'bd_run_hour_et', '9'::jsonb, 'number', $lbl$Close hour (Eastern)$lbl$, $dsc$The hour the period closes, Eastern. 9 is 9 AM, after Monday night has settled and the box scores have synced.$dsc$),
  ('brief_desk', 'bd_min_relays', '6'::jsonb, 'number', $lbl$Minimum relays (off-season)$lbl$, $dsc$Off-season only: below this many relays the period is not due and rolls into the next one. In season every week is due, however quiet.$dsc$),
  ('brief_desk', 'bd_discord_briefs_enabled', 'true'::jsonb, 'boolean', $lbl$Post approved Briefs to Discord$lbl$, $dsc$When on, approving an edition posts it to the Beacon Brief webhook with an everyone mention and the link. The approve form still carries a per-edition checkbox.$dsc$),
  ('brief_desk', 'bd_relay_headline_max', '240'::jsonb, 'number', $lbl$Relay headline maximum$lbl$, $dsc$Longest headline a Relay may carry, enforced in code and stated in the prompt.$dsc$),
  ('brief_desk', 'bd_brief_instructions', to_jsonb($seed$You are drafting one edition of The Beacon Brief for FF Beacon. The bundle you fetched is the whole of what you may write from. Follow these instructions exactly.

1. SOURCES OF TRUTH, IN ORDER. First, the bundle's relays: what was reported. Second, the bundle's numbers: what the site computed. Third, pages you fetch during this run: what is true now. Your training memory is not a source. A roster, depth chart, timeline or contract detail that is not in one of those three is not stated.

2. CHECK EVERY RELAY AGAINST THE PRESENT. A week is long: a "4 to 6 weeks" timeline reported on Tuesday may be "placed on IR" by Sunday. Before you write about a relay, fetch at least one current web page about it and record the check in research_log with the url, the fetch time and one line on what it confirmed or changed. A relay you cannot confirm is written as "reported on {date} by {source}" and nothing firmer.

3. EVERY SECTION CARRIES A FIGURE FROM THE BUNDLE, named as what it is: "his value on {source display name} moved from X to Y over the week", "he scored 18.4 PPR points in week 2 on 9 targets", "the model projects 11.2 points next week". A figure quoted in prose is also placed as a block where a block kind fits it, and the section's block_refs record which. A section with no bundle figure to carry is cut, not padded.

4. STRUCTURE. A title, a meta description, a tl_dr of three to five sentences, then sections grouped by what a fantasy manager does with them, never by team: injuries and availability; trades, signings and releases; depth chart and role changes; the week's scoreboard (top scorers by position from the bundle, and the biggest value movers); what to do this week (waivers, holds, sells, each tied to a relay); and an FAQ of three to six questions phrased the way people search them. Off-season editions drop the scoreboard and add a "what changed in value" section.

5. LENGTH. 1,800 to 4,000 words in season, 1,200 to 2,500 off-season. Long because the period had a lot of news, never because of padding.

6. VOICE. The site's voice from its guides. First person is Michael's and is not used; the desk writes as "we". Plain ASCII punctuation only: no em dashes, no en dashes, no curly quotes, no ellipsis character, no emoji. None of these patterns: negative parallelism ("not just X, it's Y"), the rule of three as rhythm, significance inflation ("in an era where", "underscoring"), "it's worth noting", trailing participle clauses, formulaic transitions (moreover, furthermore, ultimately, in summary).

7. LINKS. The first mention of every player links to /players/{slug} using the slug the bundle supplies. Every relay you cite links to its permalink from the bundle. Where you suggest an action, link the tool: /tools/faab for a waiver bid, /tools/who-should-i-start for a start or sit call, /tools/trade-calculator for a sell.

8. BLOCKS ARE REQUIRED. Visuals and interactives come only from the block library in the bundle's block_kinds, fed only by the datasets the bundle ships. You place a block by kind and dataset id, write its caption and its one-sentence conclusion, and choose each section's icon from section_icons. An in-season edition carries at least: one stat_tiles block near the top, one value_movers chart, one top_scorers or box_score_lines table, one injury_timeline, one action_list with tool links, and one interactive (format_toggle or return_planner). A section that is only paragraphs is a section that has not been finished. You never draw an image, never write HTML, SVG or script, and never invent a number for a block: a block renders only the dataset it references.

9. TWO FORMATS, ALWAYS. State the formats once, near the top, in format_note: "Values and ranks below are shown for {format 1} and {format 2} on {source display name}", taken from the bundle's context. Write every report's fantasy consequence for both worlds, dynasty first and then redraft, and collapse them into one sentence only when the answer is genuinely the same in both.

10. NOTHING ABOUT THE DESK, THE MODEL OR THE REVIEW goes in the body. The page adds its own byline.

11. MATCH THE REFERENCE. The bundle carries the week 1, 2026 edition under example. Match its shape, its density of figures per section, its heading style and its length. A draft that reads like a news wire when the example reads like a guide is rejected on shape alone.

12. OFF-SEASON TITLES. An off-season edition carries no fixed title. Research the phrases people are searching for that period (free agency, the draft, training camp, rookie rankings, whatever the relays are actually about), record that research in research_log, and return exactly three title_options, each with a kebab-case slug, the queries it targets and one line on why. The owner picks one at approval. In season the title pattern is fixed and title_options is omitted.

When the draft is complete, POST it to the drafts endpoint as the JSON shape the bundle describes and stop. If the drafts endpoint rejects the draft, read the reason, fix exactly that, and POST again. Never call any other endpoint on the site and never write to the repository.$seed$::text), 'string', $lbl$Editorial instructions for the desk run$lbl$, $dsc$The editorial brief returned inside the bundle. The desk run follows it exactly, so every editorial change is an edit here rather than a deploy.$dsc$),
  ('brief_desk', 'bd_relay_extract_prompt', to_jsonb($seed$== RELAY ==
Return a relay object built ONLY from the text of this post.

THE POST IS THE ONLY SOURCE. You have no other. The post is newer than everything you remember, and it comes from a reporter FF Beacon has chosen to trust. Every team, position, contract figure, injury, timeline, coach and roster fact in your output must appear in the post. If the post says a player is on a team you believe he left, he is on that team. If the post gives a timeline you believe is wrong, that is the timeline. If the post names a position you believe is wrong, that is the position. You are not being asked whether the post is true. You are being asked what it says.

NEVER ADD. Do not add a team, position, age, contract year, injury type, return date or any other detail the post does not state, even when you are sure of it. A fact the post leaves out is left out. A timeline the post does not give is null, never a typical timeline for that injury. If a post names a player without a team, the headline names the player without a team.

NEVER CORRECT. Do not fix what looks like a typo in a name, a number or a team. Copy it. A wrong figure copied from a post is the reporter's error and is handled by the deletion watch; a right figure changed by you is our error and nobody can find it.

headline: 40 to 220 characters. One or two sentences stating what happened, naming the player or team as the post names them. No opinion, no consequence, no "reports" or "sources say" (the card credits the source underneath), no hashtags, no quotation of the reporter.

kind: one of injury, transaction, contract, suspension, depth_chart, coaching, performance, draft, legal, other.

facts: 0 to 6 items of { label, value }. Label at most 24 characters, value at most 80. Each value is a phrase lifted from the post, in the post's own words and numbers. Typical labels: Injury, Timeline, Status, Contract, Guaranteed, Traded for, Signed with, Released by, Suspended for, Also.

timeline: the availability window in the post's own words, or null.

availability: one of out, doubtful, questionable, active, ir, pup, released, signed, traded, suspended, waived, none. Choose none unless the post states the status.

When a post covers more than one player, the headline names the primary subject and facts may name the others under the label Also.

Plain ASCII punctuation only. No dashes as separators, no ellipsis character, no curly quotes, no emoji.$seed$::text), 'string', $lbl$Relay extraction prompt section$lbl$, $dsc$The RELAY section of the classify prompt. It is appended to bb_categorize_prompt when that prompt does not already contain the marker line.$dsc$)
on conflict (key) do nothing;

insert into public.beacon_settings (category, key, value, value_type, label, description) values
  ('beacon_brief', 'bb_article_write_enabled', 'false'::jsonb, 'boolean', 'Legacy article writing', 'Legacy. When on, a post that clears the context threshold still enqueues the old per-post article. Off since the Relay pipeline landed (migration 0285); the worker keeps the handler so this can be turned back on without a deploy.')
on conflict (key) do nothing;

update public.beacon_settings
set value = to_jsonb((value #>> '{}') || E'\n\n' || $seed$== RELAY ==
Return a relay object built ONLY from the text of this post.

THE POST IS THE ONLY SOURCE. You have no other. The post is newer than everything you remember, and it comes from a reporter FF Beacon has chosen to trust. Every team, position, contract figure, injury, timeline, coach and roster fact in your output must appear in the post. If the post says a player is on a team you believe he left, he is on that team. If the post gives a timeline you believe is wrong, that is the timeline. If the post names a position you believe is wrong, that is the position. You are not being asked whether the post is true. You are being asked what it says.

NEVER ADD. Do not add a team, position, age, contract year, injury type, return date or any other detail the post does not state, even when you are sure of it. A fact the post leaves out is left out. A timeline the post does not give is null, never a typical timeline for that injury. If a post names a player without a team, the headline names the player without a team.

NEVER CORRECT. Do not fix what looks like a typo in a name, a number or a team. Copy it. A wrong figure copied from a post is the reporter's error and is handled by the deletion watch; a right figure changed by you is our error and nobody can find it.

headline: 40 to 220 characters. One or two sentences stating what happened, naming the player or team as the post names them. No opinion, no consequence, no "reports" or "sources say" (the card credits the source underneath), no hashtags, no quotation of the reporter.

kind: one of injury, transaction, contract, suspension, depth_chart, coaching, performance, draft, legal, other.

facts: 0 to 6 items of { label, value }. Label at most 24 characters, value at most 80. Each value is a phrase lifted from the post, in the post's own words and numbers. Typical labels: Injury, Timeline, Status, Contract, Guaranteed, Traded for, Signed with, Released by, Suspended for, Also.

timeline: the availability window in the post's own words, or null.

availability: one of out, doubtful, questionable, active, ir, pup, released, signed, traded, suspended, waived, none. Choose none unless the post states the status.

When a post covers more than one player, the headline names the primary subject and facts may name the others under the label Also.

Plain ASCII punctuation only. No dashes as separators, no ellipsis character, no curly quotes, no emoji.$seed$::text),
    updated_at = now()
where category = 'beacon_brief'
  and key = 'bb_categorize_prompt'
  and value #>> '{}' not like '%== RELAY ==%';
