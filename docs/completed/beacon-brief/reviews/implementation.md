# Relays and Briefs: implementation review

Reviewed 2026-09-17 against docs/beacon-brief/relays-and-briefs-plan.md sections
3 to 14 (binding), with section 20 as the authority and the section 22
deviations accepted. Scope: migrations 0284 to 0287, lib/relays/,
lib/brief-desk/, components/relays/, components/brief-desk/, app/brief/,
app/api/brief-desk/, app/admin/brief-desk/, components/admin/brief-desk/,
scripts/backfill-relays.ts, scripts/archive-legacy-articles.ts,
scripts/brief-desk/, and the changed beacon-brief, sitemap, json-ld, llms,
home-content and player-profile files.

Baseline: `npm run typecheck` exits 0, `npm run lint` exits 0, and
`npx vitest run lib/relays lib/brief-desk lib/projections lib/beacon-brief
lib/json-ld.test.ts` passes 458 tests in 35 files. Every finding below is a gap
the suite does not currently cover.

Counts: 1 blocker, 17 major, 44 minor.

## Blocker

### B1. The grounding check is blind to every ordinal, so a changed draft-pick round passes clean
lib/relays/grounding.ts:120

`NUMBER_RE` ends in `(?![a-z])`, so a digit run immediately followed by letters
yields no candidate at all. "1st", "2nd", "3rd", "4th" and "21st" produce zero
number candidates on both the post side and the relay side.

Why it matters: plan 4.6 bullet 1 is the guarantee behind the extraction prompt,
and rounds, quarters and downs are the commonest number format in football
reporting. A model that changes "2nd round pick" to "1st round pick" from memory
is exactly the failure the owner named in plan 4.3, and the check does not see
it.

Fix: allow an ordinal suffix in the alternation and normalise it to a multiplier
of 1, for example
`/\$?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mil|bil|mm|st|nd|rd|th|[mbk])?(?![a-z])/gi`,
keeping st/nd/rd/th out of `SUFFIX_MULTIPLIER`. Add a test for 2nd against 1st.

Confirmed by running the real module through tsx:
`numberCandidates("a 3rd round pick in 2028")` returns only `2028`, and a post
reading "sending a 2nd round pick" against a headline and fact reading "a 1st
round pick" returns `{ok: true, failures: []}`.

Resolution: fixed in lib/relays/grounding.ts. NUMBER_RE carries the ordinal endings and refuses a trailing digit as well as a trailing letter, spelled ordinals are read as figures through ordinalWordCandidates, and grounding.test.ts covers 1st against 2nd, the spelled form and 49ers.

## Major

### M1. Fact labels are never name-checked
lib/relays/grounding.ts:287-289

`checkNames` runs on `fact.value` only. Plan 4.6 bullet 2 says "every
capitalised token of two or more characters in the headline and facts". Labels
are model-written up to 24 characters and render in the card's `<dt>` and in the
Discord text as "Label: value" (lib/relays/render.ts:85).

Fix: call `checkNames(fact.label, "fact")` beside the value.

Confirmed by running the module: a fact `{label: "Chiefs sent", value: "high
ankle sprain"}` against a post that never says Chiefs returns `{ok: true}`.

Resolution: fixed in lib/relays/grounding.ts. checkNames now runs on fact.label with a SKIP_LABEL_WORDS set for the generic nouns the extraction prompt supplies, so 'Chiefs sent' fails and 'Timeline' does not. Covered by grounding.test.ts.

### M2. The numbersMatched escape hatch defeats the content-word rule
lib/relays/grounding.ts:291-300

`if (!shares && !numbersMatched)` lets a fact value skip the content-word
requirement whenever its numbers all matched. Plan 4.6 bullet 3 is
unconditional, and section 22 does not record a deviation.

Fix: require `shares` unconditionally. The `contentWords.length === 0` continue
at line 297 already covers the bare-number case the hatch was for.

Confirmed by running the module: post "The back will miss 4 to 6 weeks" against
fact `{Contract: "4 year rookie extension guaranteed"}` returns `{ok: true}`;
none of rookie, extension or guaranteed is in the post.

Resolution: fixed in lib/relays/grounding.ts; the numbersMatched hatch is gone and the content-word rule is unconditional. Covered by grounding.test.ts.

### M3. "49ers" is exempt from the name check
lib/relays/grounding.ts:232

`isCapitalisedName` returns false for any token starting with a digit, so the
one NFL team whose name starts with a digit is never checked. The number check
then reads the token as a bare "4" and passes whenever the post contains a 4.

Fix: replace the leading-digit guard with a test that the token is not purely
numeric, keeping the WORD_NUMBERS escape at line 274.

Confirmed by reading the predicate and by the ordinal run above, which shows the
number path reducing such tokens to their digit prefix.

Resolution: fixed in lib/relays/grounding.ts. isCapitalisedName accepts a digit-leading token that carries a letter and rejects a purely numeric one, and a token the number reader can read whole is left to the number check.

### M4. Relay week boundaries drift an hour after the November DST change, and ignore the admin settings
lib/relays/week.ts:104-119, against lib/brief-desk/cadence.ts weekOpen

`assignRelayWeek` steps boundaries with a fixed `WEEK_MS` of 604800000, while
the cadence anchors every close to 9 AM Eastern wall clock through
`easternAddDaysAt`. week.ts also hardcodes `WEEK_CLOSE_WEEKDAY = 2` and
`WEEK_CLOSE_HOUR_ET = 9` (lines 26-28) while the cadence reads the
admin-editable `bd_run_weekday` and `bd_run_hour_et`.

Why it matters: week.ts's own header promises the two read the same rule so a
Relay can never fall between two editions. Changing either setting splits them
by up to six days.

Fix: step with `easternAddDaysAt(weekOneOpen, 7 * (n - 1), hour)` (or import the
cadence's `weekOpen`) and take the weekday and hour from the settings. Add a
November boundary case to week.test.ts.

Confirmed by running `assignRelayWeek` with season_start_date 2026-09-10: the
week 2 boundary sits between 2026-09-15T12:30Z and T13:30Z, which is 09:00 EDT
and correct, but the week 9 boundary sits between 2026-11-03T12:30Z and T13:30Z,
which is 08:00 EST, an hour early.

Resolution: fixed in lib/relays/week.ts. seasonWeekOpen and seasonWeekIndexAt step by Eastern calendar arithmetic and take a WeekBoundary; lib/brief-desk/cadence.ts now calls both, so there is one implementation. week.test.ts crosses the November change. The boundary still DEFAULTS to Tuesday 9 AM on the write path: plumbing bd_run_weekday into writeRelay would add a settings read to the curation hot path, and assignRelayWeek accepts the override for the day that is wanted.

### M5. The cadence declares an in-season period closed an hour before it closes, from week 9 on
lib/brief-desk/cadence.ts:158-171

The week index is computed on the same fixed 7-day millisecond grid, while every
boundary it reports comes from `weekOpen`. After the November change the grid
and the wall clock disagree by an hour, and the plan's own cron fires at exactly
13:00 UTC (plan line 1341), which lands inside that hour.

Why it matters: the bundle then serves a period whose `periodEnd` is still in
the future, and the next period starts at that same `periodEnd`, so an hour of
Tuesday-morning Relays belongs to no edition at all, every week from week 9
through week 22.

Fix: correct the grid estimate against the real opens, for example
`while (weekOpen(startDate, settings, n) > at) n -= 1;` then
`while (weekOpen(startDate, settings, n + 1) <= at) n += 1;`.

Confirmed by running `resolveCadence` with the default settings at
2026-11-10T13:00Z: it returns `reason: "week 9 closed"` with
`periodEnd: 2026-11-10T14:00:00.000Z`, an hour after the call. The same call at
2026-09-15T13:00Z returns a periodEnd equal to the call time, which is correct.

Resolution: fixed in lib/brief-desk/cadence.ts; the week index comes from seasonWeekIndexAt, which corrects the millisecond estimate against the real opens. cadence.test.ts asserts the reported period never ends in the future at 8 AM Eastern on 2026-11-10.

### M6. A pre-season edition can never pass validation
lib/brief-desk/blocks.ts:153 with lib/brief-desk/validate-draft.ts:225-229 and lib/brief-desk/bundle.ts:388

`isInSeasonPhase` returns true for "pre" (lib/brief-desk/slug.ts:63), so
`REQUIRED_IN_SEASON_BLOCKS` is enforced as errors, and one entry demands a
`top_scorers` or `box_score_lines` block. `hasWeek` is false for the pre phase,
so `buildAllDatasets` never builds either dataset. Omitting the block fails with
"missing a top_scorers or box_score_lines table"; placing one fails with
"names dataset X, which is not in datasets".

Why it matters: plan section 12 makes the pre-season weekly, so roughly six
editions a year are unpublishable by construction.

Fix: build the required list from the datasets the bundle actually shipped, or
demote the scoreboard requirement to a warning whenever no week-line dataset
exists, which is the treatment off-season already gets.

Confirmed by reading the three files: `hasWeek` at bundle.ts:388 excludes "pre",
line 422 gates `loadWeekLines` on it, and `blockAcceptsDataset` (blocks.ts:182)
returns false for a null dataset when `accepts` is non-empty.

Resolution: fixed in lib/brief-desk/validate-draft.ts and lib/brief-desk/blocks.ts. The scoreboard requirement carries needsWeekLines and is a warning unless the phase is regular or post; the other required blocks are unchanged.

### M7. A twelve-day hole between the last off-season period and the first pre-season one
lib/brief-desk/cadence.ts:173-190

The off-season closes are calendar dates (the 1st and 16th) and the pre-season
periods sit on the Tuesday grid, and the handover is not continuous. The
`n === 1 - PRE_SEASON_WEEKS` branch also computes its off-season close from
`openN` rather than from `at`, so it keeps re-offering the same stale period.

Fix: open the first pre-season period at the last off-season close, or emit the
off-season period that contains `at` and start the pre-season grid at the first
Tuesday after that close.

Confirmed by running `resolveCadence` with season_start_date 2026-09-10 at
2026-07-20, 2026-07-25 and 2026-08-02: all three return the same Jul 1 to Jul 16
period. The Aug 1 close never becomes a period, so Jul 16 to Jul 28 is covered
by nothing.

Resolution: fixed in lib/brief-desk/cadence.ts. The first pre-season branch reads its off-season closes from `at` rather than from the week open, and the first pre-season period starts at the last off-season close, so the two grids hand over with no gap. cadence.test.ts pins the continuity.

### M8. A Relay hidden for grounding can be published with one click and no re-check
lib/relays/write.ts:488 (setRelayStatus) and app/admin/brief-desk/actions.ts:149 (unhideRelay)

`unhideRelay` calls `setRelayStatus(admin, relayId, "published", null)`, and
`setRelayStatus` never runs `checkRelayGrounding`. Plan 4.6 says the owner
publishes from the Relays manager "which re-runs the check on the edited text",
and plan 15 says a Relay that fails the check "is never published and never
posted". `editRelay` does re-check; `unhide` bypasses it entirely. This
compounds with the fallback-extraction path (minor m4 below), which was never
grounded at all.

Fix: in `setRelayStatus`, when the target is `'published'` and the row is
`hidden`, reload the ingestion and re-run grounding on the stored text, refusing
with the failures on a miss. Or route unhide through `updateRelayText`.

Confirmed by reading setRelayStatus in full (lines 488-543, no grounding call)
and every call site of it.

Resolution: fixed in lib/relays/write.ts. setRelayStatus re-runs the grounding check on the stored text whenever the target is 'published' and the row is not, and refuses with the failures on a miss. This also closes m4: the fallback-extraction path can no longer be published unchecked.

### M9. A native source edit patches Discord with text the grounding check rejected
lib/beacon-brief/worker.ts:1011, lib/beacon-brief/curate.ts:691, lib/relays/write.ts:428-443

`updateRelayText` writes the edited headline and facts to the row and flips the
status to `hidden` when the re-grounding fails. `processRevision` then enqueues
the `discord_patch` unconditionally with that relay id, and the patch branch at
worker.ts:1011 renders whatever Relay it finds with no status check, unlike
`handleDiscordPost`, which gates on status at worker.ts:695-703. The edit lands
minutes after the post, so the age gate at worker.ts:970 does not stop it.

Why it matters: Discord shows text the check rejected while the site hides it,
which is the exact case plan 4.6 and the plan 15 checklist forbid.

Fix: in `handleDiscordPatch`, when `!payload.retract && targetRelay.status !==
"published"`, return without patching or patch to a neutral under-review notice.

Confirmed by reading write.ts:428-443 (the update sets both the new text and
`status: "hidden"`), curate.ts:685-697 (the unconditional enqueue), and
worker.ts:995-1020 (the `else if (targetRelay)` branch with no status test).

Resolution: fixed in lib/beacon-brief/worker.ts. handleDiscordPatch returns without patching when the target Relay is not published and the job is not a retraction, and logs a warn saying which status held it back.

### M10. The backfill's --recheck-hidden path can post an archived report to Discord as news
scripts/backfill-relays.ts:145-168 with lib/relays/write.ts:467-475

`updateRelayText(..., { publishIfGrounded: true })` inserts a pending
`discord_post` job when the ingestion has no `discord_message_id`. The script
deletes that job afterwards and asserts none survived, but
/api/cron/beacon-brief-worker runs every minute and `bb_claim_jobs` flips a
claimed job from `pending` to `processing`, so a job claimed inside the window is
neither deleted nor detected. Plan 4.4 states the absolute: "an old report must
never go out to the channel as if it were news."

Fix: give `updateRelayText` a `discord` flag defaulting to true, gate both queue
inserts on it, pass false from the backfill, and delete the insert-then-delete
dance.

Confirmed by reading both queue inserts in `updateRelayText` and the cleanup at
backfill-relays.ts:153-168. The main backfill loop is clean: it passes
`discord: false` and writeRelay's insert is gated on
`status === "published" && input.discord` (write.ts:331).

Resolution: fixed. updateRelayText takes `discord` (default true) and writes no queue row at all when it is false; scripts/backfill-relays.ts passes false and the insert-then-delete dance is gone.

### M11. A follow-up Relay is outside the deletion watch
lib/beacon-brief/deletion.ts:201 with lib/beacon-brief/curate.ts:769-772

The sweep still selects `.eq("status", "published")`. Dropping the `article_id`
filter was right, but a follow-up post that the merge gate says adds new
information now gets its own published Relay while its ingestion row is stamped
`status = 'revised'`. Those Relays are live on the site and in the channel and
are never checked for source deletion. Before this change a revision had no page
of its own, so excluding it was correct.

Fix: `.in("status", ["published", "revised"])`, or select on the existence of a
published Relay rather than on the ingestion status.

Confirmed by reading the candidate query and the status write at the end of
`processRevision`.

Resolution: fixed in lib/beacon-brief/deletion.ts; the candidate query is now `.in("status", ["published", "revised"])`.

### M12. A writeRelay throw orphans the post permanently
lib/beacon-brief/curate.ts:1176 with lib/relays/write.ts:236 and 286

`writeRelay` is called after the ingestion insert and is not wrapped. It throws
when there is no usable headline (write.ts:236) and on any insert error that is
not an ingestion_id race, including a slug collision or a CHECK miss on kind or
availability (write.ts:286). The per-item catch at curate.ts:360 logs and does
not advance the cursor, so the source stops for the run; on the next run the
dedupe check finds the row already ingested and returns early, the cursor moves
on, and the post is left `status = 'published'` with no Relay: invisible on the
site and in Discord, and still consuming deletion-sweep budget.

Fix: wrap the call and, on failure, put the ingestion into an inspectable state
(status `error` with `filter_detail`, or a `failed_task` moderation row).

Confirmed by reading both throw sites, the race-recovery branch (which covers
only an ingestion_id conflict), the catch at curate.ts:360-372 and the early
return at curate.ts:855.

Resolution: fixed in lib/beacon-brief/curate.ts. The writeRelay call is wrapped; a throw sets the ingestion to status 'error' with the reason in filter_detail, opens a failed_task moderation row and logs.

### M13. The feed's player and team filters send up to 1000 UUIDs in one .in() and cap them unordered
lib/relays/load.ts:212-224 and 256, with 336

`relayIdsForPlayer` and `relayIdsForTeam` use `.limit(1000)` with no `order`, so
which rows come back is arbitrary and page 2 of `/brief?team=PHI` is not a
continuation of page 1. The ids are then passed whole to
`.in("id", ids.slice(0, 1000))`, bypassing the file's own `ID_BATCH = 300`
constant at line 41, which exists for this and is used correctly in `hydrate`.
A thousand UUIDs is roughly a 37 KB query string. lib/sitemap/sections.ts
carries the same warning in prose, including that the failure is silent: the
query returns nothing and the caller reads it as no rows. `loadRelayFeed`
swallows the error at line 262 and returns `{ relays: [], total: 0 }`.

Why it matters: `?team=PHI&week=2` is a documented shareable URL (plan 6.1), and
the backfill already puts about 1,131 posts in the archive.

Fix: filter through the join table server-side
(`.select("...,relay_teams!inner(team_id)").eq("relay_teams.team_id", teamId)`),
which keeps ordering, paging and the exact count on the server and sends no id
list. Failing that, order the id query, chunk at `ID_BATCH` and surface the
truncation instead of capping `total` silently.

Confirmed by reading the three functions and `ID_BATCH` in the same file.

Resolution: fixed in lib/relays/load.ts. The player and team feeds filter through the join tables with an inner join, so ordering, paging and the exact count stay on the server and no id list is sent. Same change in app/admin/brief-desk/relays/page.tsx (m37).

### M14. anon and authenticated keep full table grants, including TRUNCATE, on the three Relay tables
supabase/migrations/0284_relays.sql, tables created at lines 42, 90 and 99, no revoke in the file

RLS blocks the DML because no policy covers those commands, but TRUNCATE is not
subject to RLS. The header at line 34 claims "client writes: BLOCKED on all
three", and at the grant level that is not true. Migration 0283, two migrations
earlier, exists to fix exactly this for site_layout_settings and cites 0249
before it.

Fix: `revoke insert, update, delete, truncate, references, trigger on
public.relays, public.relay_players, public.relay_teams from anon,
authenticated;` in a follow-up migration, leaving SELECT.

Confirmed on prod by querying information_schema.role_table_grants for all five
new tables: brief_editions and legacy_article_redirects are service_role only,
the three Relay tables carry the full default grant. 0286 and 0287 name anon and
authenticated explicitly and are clean.

Resolution: fixed in supabase/migrations/0288_relays_perf_indexes.sql, applied through the Supabase MCP and verified: anon and authenticated now hold SELECT only on relays, relay_players and relay_teams.

### M15. Approval ignores bd_discord_briefs_enabled on the server
lib/brief-desk/publish.ts:139-146

The everyone-mention Discord post is gated on `input.postToDiscord` alone.
`bd_discord_briefs_enabled` exists (lib/brief-desk/settings.ts:63, 107) but is
read only as the checkbox's initial value in the page, and neither
`approveBriefEdition` nor `approveEdition` re-reads it. With the setting off, a
stale review page still queues the post. This is the shape CLAUDE.md names for
the RefreshButton `isAuthorized` prop: a client prop is a default, never the
gate.

Fix: load the brief_desk settings inside `approveEdition` and enqueue only when
`discordBriefsEnabled && input.postToDiscord`.

Confirmed by reading publish.ts:139-146 and grepping every reader of the
setting.

Resolution: fixed in lib/brief-desk/publish.ts; approveEdition re-reads bd_discord_briefs_enabled and enqueues only when the setting and the checkbox agree, and the log line says when the setting refused.

### M16. Block option strings skip the banned-character and banned-phrase check
lib/brief-desk/validate-draft.ts:187-188, with lib/brief-desk/blocks.ts:101 and components/brief-desk/blocks/action-list.tsx:92

Plan 11.2 lines 1188-1190 say every string the run writes in a block's options
goes through the same check as body text and names a note explicitly.
`action_list` items carry a free `note` of up to 160 characters and it renders
on the public page. `textProblems` is run over `b.caption` and `b.conclusion`
and nothing inside `b.options`, so an em dash, a curly apostrophe or an emoji in
an action note ships to a reader, against the CLAUDE.md absolute punctuation
rule.

Fix: after `parseBlockOptions` succeeds, walk the parsed options for string
values and run `textProblems` over each, which also covers any future kind that
adds a string option.

Confirmed by reading the validator's two `textProblems` calls for blocks, the
zod schema for the note, and the JSX that renders it.

Resolution: fixed in lib/brief-desk/validate-draft.ts; every string in a block's parsed options is walked and run through textProblems with a dotted path.

### M17. IndexNow fires through a floating promise instead of after()
lib/brief-desk/publish.ts:137 and 245

`void submitIndexNow(...)` can be cancelled when the server action's response is
sent. The repo's convention is `after(() => submitIndexNow(urls))`, used at
lib/beacon-brief/worker.ts:1050, app/api/cron/recalculate-derived/route.ts:77
and app/api/cron/sync-weekly-projections/route.ts:50, each with a comment
explaining why. Plan 11.6 requires the ping on approval and on any later
revision.

Fix: wrap both calls in `after()` from `next/server`.

Confirmed by grepping every `submitIndexNow` call site in the repo; publish.ts
is the only one that does not use `after`.

Resolution: fixed in lib/brief-desk/publish.ts; both submitIndexNow calls are wrapped in after() from next/server.

## Minor

Grounding and Relay writing

- m1. lib/relays/grounding.ts:222-227 against 260: `rawTokens` filters out
  entries that strip to empty and `rawWords` does not, so one whitespace-
  delimited token made only of punctuation (a bare "-", "&" or ":") shifts the
  two arrays out of step for the rest of the string and applies the lenient
  sentence-start stem fallback to the wrong token, in either direction. Build
  both arrays in one pass. Confirmed by reading both constructions; no test
  covers a punctuation-only token.
- m2. lib/relays/grounding.ts:239-241 and 298: the fact content-word check
  shares the name check's haystack, which includes the matcher's resolved player
  and team names. Plan 4.6 grants that allowance to the name check only. Build a
  post-text-only set for the fact check.
- m3. lib/relays/grounding.ts:83: "ir" and "pup" sit in SKIP_CAPITALISED, so an
  invented IR designation in a headline is not name-checked.
- m4. lib/relays/write.ts:189-193: the fallback-extraction path writes a hidden
  Relay with `status_reason = 'extraction'` and `failures: []` without ever
  running grounding. Safe alone, unsafe with M8.
- m5. lib/relays/write.ts:144-164, 290-305: `openGroundingModeration` and both
  join-row upserts discard their errors. A failed moderation insert leaves a
  hidden Relay that never reaches the queue, which is the mechanism plan 4.6
  relies on to surface it. `setRelayStatus` already checks and logs at line 532;
  do the same here.
- m6. lib/relays/write.ts:128-134 and 268-287: `uniqueRelaySlug` caps length
  only on the collision branch, a `slugify` result of "" is stored as an empty
  slug, and the insert error path treats every failure as an ingestion_id race,
  so a genuine slug unique violation throws instead of retrying with the suffix.
- m7. lib/relays/duplicates.ts:91-94 and 171-177:
  `loadRecentRelayCandidates` asks for `.order("created_at", {ascending: true})
  .limit(limit * 4)`, so the truncation drops the newest candidates, and the
  comment at line 171 claims the opposite. The article-side equivalent
  (lib/beacon-brief/followup.ts:234) uses descending. Bounded in practice: the
  default `bb_followup_lookback_hours` is 12 (lib/beacon-brief/settings.ts:183)
  and 60 root ingestions in 12 hours from one reporter is unlikely, which is why
  this is minor rather than major.
- m8. lib/relays/load.ts:525-537: `loadRelayWeeks` caps at 1000 rows ordered by
  week descending, so the early weeks of a busy season disappear from the week
  filter. Page with `range()` or use a distinct RPC.
- m9. lib/relays/types.ts:46-49: the comment says the database CHECK on headline
  is wider than the code constants; both are 20 to 240. The prompt's range is 40
  to 220.

Brief desk

- m10. lib/brief-desk/bundle.ts:644: the ten-minute memo key is period plus
  override, with neither the projection source nor the two resolved value
  sources in it, against the CLAUDE.md rule that the source is part of every
  cache key that outlives a flip. Line 464 also destructures only `{ byPlayer }`
  and discards the `source` that `loadAdjustedProjections` returns, so nothing
  downstream can key on it or name the engine. `BUNDLE_MEMO_PREFIX` is exported
  but `bustMemo` is never called with it anywhere.
- m11. lib/brief-desk/validate-draft.ts:48-55: the comment says the list is
  "built from escapes so this file stays ASCII" and the five lines below it are
  literal em dash, en dash, curly quotes and ellipsis characters. A re-encode or
  a lint autofix would silently disable the check. Use escapes, and add the
  non-breaking space and the middle dot, which CLAUDE.md rule 6 also bans.
- m12. lib/brief-desk/bundle.ts:419-422: post-season box scores are queried with
  the continuing week number 19 to 22, but lib/relays/week.ts:131-133 records
  that Sleeper counts playoff weeks from 1 again in some seasons. A post-season
  edition can come back with zero week lines and an empty required block.
- m13. lib/brief-desk/bundle.ts:456: `next_week` is the live Sleeper week with
  no check that it is later than the period being written about, so a week that
  has not rolled over gets labelled "next week" in a sentence instruction 3 asks
  the run to write.
- m14. lib/brief-desk/bundle.ts:566 with lib/source.ts:163: when neither edition
  format resolves a source, `source_display` becomes the literal "this source",
  which instruction 9 then asks the run to paste into `format_note` and
  components/brief-desk/edition-byline.tsx:41 renders. The field is typed
  `string | null`; null is the honest value.
- m15. app/api/brief-desk/bundle/route.ts:43-49 and drafts/route.ts:56-71: both
  routes claim the rate-limit slot before validating, so a malformed override or
  a draft that fails the shape check burns budget, against the house rule stated
  for Trade Ideas. Both share one bucket, so the combined allowance is 10 per
  hour, not 10 each, and the seeded instructions tell the run to fix and POST
  again after a rejection. `claimRateLimitSlot` also keys on the derived actor
  (IP or session), not on the token as plan 9.1 words it.
- m16. app/api/brief-desk/drafts/route.ts:255-272: the `article_players`,
  `article_teams` and `beacon_brief_moderation` inserts discard their errors,
  while the article and edition pair on lines 249-253 rolls back carefully. A
  failed moderation insert sends the "ready for review" email for an edition
  with no queue row, and publish.ts:129-134 later updates nothing without
  complaining.
- m17. lib/brief-desk/publish.ts:102: the approval-time slug collision check
  queries `articles` only, while the validator checked articles and relays.
- m18. lib/brief-desk/publish.ts:107-112: the update is guarded with
  `.eq("status","in_review")`, but PostgREST returns no error for zero rows, so
  a double approval goes on to stamp relays, revalidate, submit IndexNow and
  queue Discord a second time. Select the updated row and treat zero rows as a
  failure.
- m19. lib/brief-desk/publish.ts:114-134: the `brief_editions`, `relays` and
  moderation updates after the publish all discard their errors, and
  `title_choice` is written in a separate statement from the publish although
  plan 10.1 says the same transaction.
- m20. lib/brief-desk/publish.ts:219-246: `updateEditionText` rewrites the
  title, meta description, tl_dr, section bodies and block captions with no
  banned-character, banned-phrase or raw-HTML re-check, and re-submits to
  IndexNow. Run `textProblems` over the edited strings.
- m21. lib/brief-desk/period.ts:12-21: the period is half-open but
  `formatPeriod` prints both ends inclusive, so consecutive editions share a
  boundary date ("Sep 8 to Sep 15" then "Sep 15 to Sep 22"). It shows in four
  places, and plan 11.3's example reads "Covers Sep 9 to Sep 15".
- m22. lib/brief-desk/datasets.ts:126 and 222, rendered at
  components/brief-desk/blocks/block-shell.tsx:19: the public source note reads
  "change_7d is the move over the last seven days", putting a database column
  name in front of readers.
- m23. supabase/migrations/0287_brief_editions.sql:37 and 59: `article_id` is
  unique but `(season, period_end)` is only indexed, so two concurrent POSTs
  that both read `due: true` create two in-review editions for one period. A
  partial unique index on non-rejected editions would make the 409 a database
  guarantee rather than a read-then-write race.
- m24. supabase/migrations/0287_brief_editions.sql:43-44: `relay_ids` gained
  `default '{}'` and `relay_count` gained `default 0`, which plan 7.2 does not
  specify and section 22 does not record. A provenance row that records nothing
  then satisfies every constraint.

Reader surfaces and SEO

- m25. app/brief/[slug]/page.tsx:137 against :298: `generateMetadata` branches on
  `article.articleType === "brief"` while the page body branches on whether
  `getEdition(slug)` returns a row. No live defect: `loadPublishedEdition`
  (lib/brief-desk/edition-data.ts:105-108) returns null only when the article is
  missing or not a brief, so the two agree today. It is still two predicates for
  one decision, and the head would claim index:true with a person byline over the
  legacy layout's organisation byline if they ever diverged. Line 137 also omits
  `status`, so `isArticleIndexable`'s status guard is nominal on its only caller.
- m26. components/brief-desk/edition-page.tsx:147-151: sections render the whole
  `body_md` and then append every referenced block after it. Plan 11.2 says
  blocks are inserted at their `block_refs`, so a callout or relay_quote written
  to sit mid-argument lands at the end. Not recorded in section 22.
- m27. app/brief/relay/[slug]/page.tsx:25-26: the doc comment still says the
  retracted permalink returns 410. The code returns 200, which section 22
  accepts; the comment is the stale half.
- m28. app/brief/(feed)/page.tsx:83: a `?team=` or `?player=` value that does not
  resolve leaves the filter null and renders the entire unfiltered feed as
  though it were the hub. `?team=PHIL` looks like a working page showing every
  report. Render the empty state with a line saying the value was not
  recognised, or notFound().
- m29. app/brief/[slug]/page.tsx:294 with lib/relays/legacy-redirect.ts:23: the
  redirect target is interpolated from `relay_slug` without re-validating it, so
  a malformed row starting "//" would redirect off site. The table is
  service-role only and written once, so this is hardening.
- m30. components/relays/latest-brief-panel.tsx:137 exports `periodLabel(brief)`
  while lib/brief-desk/period.ts exports a different `periodLabel(week)` that two
  other files use. Two exported functions, one name, different parameters.
- m31. components/brief-desk/blocks/return-planner.tsx:49-53: rows whose return
  week is below the chosen `lo` appear in none of the three lists while the
  undated paragraph implies a full accounting. Line 91 drops the position when a
  player has a position but no team.
- m32. app/page.tsx:165: `HOMEPAGE_FEATURED_COUNT` is unreferenced after the
  Brief block rewrite.

Scripts, admin and records

- m33. scripts/backfill-relays.ts:335-348: the pending-queue assertion compares a
  global count before and after the whole run and throws only after every write,
  so it is a report rather than a guard, and it false-positives on any long
  `--apply` run because the five-minute curation cron and the one-minute worker
  move that queue. `recheckHidden` already scopes its guard by relay id; the
  main path does not.
- m34. scripts/backfill-relays.ts:135: a non-null assertion on the ingestion
  fetch, so a missing row makes the dry-run recheck die with a TypeError instead
  of skipping. Line 123-128 reads hidden Relays with a bare `.limit(1000)` and no
  paging. Lines 325-327 populate `byWeek` only on the `--apply` branch, so the
  dry run prints no by-week counts although plan 14.1 asks for them and the dry
  run is what you read first.
- m35. scripts/archive-legacy-articles.ts:37: filters
  `.eq("status", "published")` while plan 14.2 says every `origin =
  'beacon_brief'` article is archived. Paging in both scripts is correct
  (`range(from, from + 999)` with a `< 1000` break), so the 1000-row rule is
  satisfied for the 1,131-row archive.
- m36. scripts/brief-desk/draft.ps1:51-53: the comment claims the run "is given
  no file write tool", but `--allowedTools "Bash,WebFetch,WebSearch"` permits
  file writes through the shell. The constraint is instruction-level only; say
  so.
- m37. app/admin/brief-desk/relays/page.tsx:51 and 65: the team filter reads
  `relay_teams` with `.limit(1000)` then `.slice(0, 1000)`, so a busy team
  filters against a truncated id set and the "N Relays match" count at line 154
  is wrong.
- m38. lib/beacon-brief/curate.ts:1358: the force-push path ignores
  `writeRelay`'s return value, so it reports ok even when the Relay was hidden by
  grounding and no card went out. The check itself does run on that path, which
  is what plan 15 requires.
- m39. lib/discord.ts:149: `parse: ["everyone"]` enables @here as well as
  @everyone; the comment claims a narrower grant.
- m40. File placement against plan 17: `components/admin/brief-desk/editions-
  manager.tsx` was never created (the list is inline in
  app/admin/brief-desk/editions/page.tsx), `lib/beacon-brief-feed.ts` is
  unchanged and the latest-edition read landed in lib/relays/load.ts instead, and
  a dozen new modules (override.ts, period.ts, edition-data.ts,
  edition-metadata.ts, dataset-read.ts, review-ticks.ts, desk-activity.ts,
  instructions-seed.ts, eastern-time.ts, block-shell.tsx, relay-filters.tsx,
  latest-brief-panel.tsx) are absent from section 17 and unrecorded in section
  22. Each is sensible on its own; section 22 is the record and does not have
  them.
- m41. Migration headers: 0284 lines 36-40, 0286 lines 19-20 and 0287 lines
  31-33 carry prose describing what was run rather than the pg_policies output
  that plan 5.3 and the CLAUDE.md verification sequence ask to be pasted in.
  0284 line 38 also reports "select count(*) from relays; -> 0 rows", which is
  not a result count(*) can return. The end state was verified correct on prod
  independently.
- m42. Unrecorded schema divergences, all harmless: three extra FK-side indexes
  (0284 lines 88, 97, 104), `on delete set null` on category_id,
  follows_relay_id and brief_id (0284 lines 58, 72, 74), and the `week` column
  comment at 0284:63-65 saying "null off-season" when section 22's accepted
  deviation also makes it null through the pre-season.
- m43. lib/brief-desk/draft-schema.ts:24 accepts a section `eyebrow` that
  components/brief-desk/edition-page.tsx:142 never reads, because the page
  composes its own. Dead payload; drop the field or use it.
- m44. Plan 8.4 item 4 asks for an FAQ of three to six questions; the schema
  allows zero to eight and the validator enforces no minimum. Plan 9.3's
  rejection list does not name it, so under the section 20 precedence rule this
  is a gap in the instructions rather than in the validator, but it is worth one
  line either way.

## What was verified as correct

Recorded so a re-review does not repeat the work.

- Both projection guards walk lib/ recursively and no allow-list entry was added.
  bundle.ts is the only brief-desk file touching projections and it goes through
  `loadAdjustedProjections`, which resolves the source itself. Nothing reads
  `projected_pts_*` outside the shared path, and datasets.ts and dataset-read.ts
  make no projection or accuracy read.
- Format and source sync: `EDITION_FORMAT_SLUGS` is fixed at dynasty-ppr-sflex
  and redraft-ppr-std per plan 11.7, values resolve through
  `resolveSourceForFormat` per format, and every user-facing label is a
  `describeSource` display name, never a raw slug.
- RLS: all five new tables have RLS on with policies in the same file and the
  CLAUDE.md naming convention. `relays_select_public` is
  `using (status = 'published')` and both join-table policies are gated on an
  EXISTS against a published parent. brief_editions and legacy_article_redirects
  are service_role only with anon and authenticated grants revoked by name.
- CHECK widenings in 0287 preserve every previously allowed value on
  articles.status, articles.origin, beacon_brief_moderation.type and
  beacon_brief_logs.stage, verified against 0005, 0091, 0150, 0090 and 0186 and
  against `pg_get_constraintdef` on prod. The dropped constraint names are the
  real auto-generated ones.
- lib/database.types.ts carries all five tables with matching columns and
  nullability. The `metadata` exemption for `relays` holds: `ingestion_id` is not
  null and unique against `news_ingestions`, whose `metadata` holds the raw post.
- 0285's two embedded prompt texts are byte-identical to the code fallbacks, and
  the NOT LIKE marker guard follows the 0202 pattern and cannot append twice.
- `writeRelay` runs grounding before the insert on every path that has an
  extraction, writes hidden with `status_reason = 'grounding'`, opens a
  `failed_task` row and never enqueues Discord; `discord: false` genuinely cannot
  reach the queue. Idempotent on ingestion_id both by pre-check and by the race
  lookup.
- `render.ts discordText` is link-free and mention-free unconditionally: markdown
  links collapse, schemed URLs and bare www hosts are stripped, `<@...>` tokens
  are removed and `@everyone` loses its at sign. The 2000-character rule matches
  plan 4.5 verbatim. `relaySourceLine` goes through `formatEastern`.
- `handleDiscordPost` forces `roleIds` to `[]` whenever a Relay exists, so
  `news_categories.discord_role_ids` is ignored on the relay path.
  `allowEveryone` has exactly one caller, the Brief post, reachable only through
  `approveBriefEdition` behind `requireAdmin`.
- Every public Relay read filters `status = 'published'` (feed, permalink, chain,
  player panel, byIds, recent, sidebar, weeks, RSS). The bundle correctly carries
  published and hidden Relays with a flag and excludes retracted, per plan 5.4.
- `article_write` is gated on `bb_article_write_enabled` at all three sites and
  the default is false. Force push goes through the same `writeRelay`.
- Every action in app/admin/brief-desk/actions.ts and every page under
  app/admin/brief-desk/ calls `requireAdmin`. `updateBriefDeskSetting` refuses
  any key outside the brief_desk category except `bb_article_write_enabled`.
  Approval is the only path to `status = 'published'` for a brief.
- The two desk routes: length-safe `timingSafeEqual`, 500 when the token is
  unset, 401 otherwise, the value never logged, stage `brief_desk` logged without
  headers, and the bundle override refused with 403 without an admin session.
  The drafts route writes only `in_review`, publishes nothing and pings nothing.
- Indexing and structured data: the edition clause sits ahead of the master
  switch, Relay permalinks are always noindex/follow with a self canonical and
  appear in no sitemap, the articles sitemap section emits editions only,
  `/brief/editions` is in the core sitemap, and NewsArticle versus Article,
  AUTHOR_ID, jobTitle Founder, FAQPage and BreadcrumbList are all as plan 11.4
  specifies with no isBasedOn, citation or contributor. `research_log`,
  `citations` and `validation_report` never reach the page, the RSS feeds, the OG
  image or the Discord post.
- The OG route whitelists exactly 4x3 and 1x1 and falls back to 16x9 for anything
  else; colours are brand only, no gold and no #0c0c18.
- Legacy redirect ordering is correct: the published-article lookup runs first
  and only a miss reaches `legacy_article_redirects`.
- No bare `toLocale*` and no `Intl.DateTimeFormat` without a timeZone anywhere in
  the new code; the one formatter, lib/relays/eastern-time.ts:14, passes
  `SITE_TIME_ZONE`, and its iterative Eastern solve is correct across both DST
  transitions.
- No em dash, en dash, curly quote, ellipsis character or emoji in any new UI
  copy, aria-label or alt text. The only non-ASCII bytes are inside the
  sanitisers themselves (see m11).
- Neither backfill script is referenced by vercel.json, any cron route or any
  lib, and neither is in `backfill:all`. Both page correctly.
- The new npm scripts follow the repo's verb:noun convention, and next.config.ts
  adds only the `outputFileTracingIncludes` entry the bundle's example read
  needs.

## Test coverage gaps that let the findings above stay invisible

- grounding.test.ts has no case for an ordinal, a fact label, a digit-leading
  name, the numbersMatched hatch or a punctuation-only token.
- week.test.ts has no November boundary case.
- cadence.test.ts has no DST case, no off-season to pre-season handover case and
  no pre-season validation case.
- Nothing exercises `unhideRelay`, the native-edit patch path, or a `writeRelay`
  throw.

Writing check: this report was reread against the CLAUDE.md AI-writing list. No
negative parallelism, no significance inflation, no rule-of-three cadence, no
formulaic transitions, plain ASCII punctuation throughout. One first-draft
sentence read "underscoring how easily this slips through"; it was replaced with
the concrete statement about which test file has no case for it.

## Resolution of the minors

Fixed:

- m1, m2, m3 (lib/relays/grounding.ts): checkNames walks the raw words in one
  pass so the token and its sentence-start flag cannot fall out of step; the
  fact content-word check reads a post-only haystack; "ir" and "pup" are out of
  SKIP_CAPITALISED.
- m5, m6 (lib/relays/write.ts): the moderation insert and both join upserts
  check and log their errors; the slug length cap and the empty-slug guard apply
  on both branches, and a unique violation with no competing ingestion retries
  once with the suffix.
- m7 (lib/relays/duplicates.ts): the candidate query orders descending, so the
  limit drops the oldest rows, and the comment matches.
- m8 (lib/relays/load.ts): loadRelayWeeks pages rather than capping at 1000.
- m9 (lib/relays/types.ts): the comment now states the real relationship between
  the code constants, the database CHECK and the prompt's narrower range.
- m11 (lib/brief-desk/validate-draft.ts): the banned characters are escapes, and
  the non-breaking space and middle dot were added.
- m15 (both desk routes): validation runs before the rate-limit claim.
- m16 (app/api/brief-desk/drafts/route.ts): the three inserts check their
  errors, and a failed review row rolls the edition and article back.
- m17, m18, m19, m20 (lib/brief-desk/publish.ts): the slug check covers relays
  too; the publish selects its updated row so a double approval fails; the three
  follow-up updates log their errors; an edit re-runs the text check.
- m22 (lib/brief-desk/datasets.ts): the public source note says "the move
  column" rather than naming a database column.
- m32 (app/page.tsx): the unreferenced constant is gone.
- m33, m34 (scripts/backfill-relays.ts): the queue guard is scoped to the
  Relays the run wrote; the recheck path pages and drops the non-null assertion;
  the dry run reports its by-week counts.
- m35 (scripts/archive-legacy-articles.ts): every unarchived beacon_brief
  article is archived, not only the published ones.
- m36 (scripts/brief-desk/draft.ps1): see security M2; the shell is gone and the
  comment is accurate.
- m37 (app/admin/brief-desk/relays/page.tsx): the team filter is an inner join,
  so the count is right.
- m38 (lib/beacon-brief/curate.ts): the force push reports the Relay's status
  and says so when no card went out.
- m39 (lib/discord.ts): the comment says @everyone and @here.
- m4 is closed by M8: a hidden Relay can no longer be published without a check.

Left, with reasons:

- m10 (bundle memo key): adding the resolved sources to the key means resolving
  them before the memo, which changes the cheap due-check path the file
  deliberately keeps outside it. Worth its own change.
- m12, m13, m14 (bundle post-season weeks, next_week, "this source"): each needs
  a product decision about what the edition should say, not a mechanical fix.
- m21 (formatPeriod inclusive ends), m30 (two periodLabel exports): both sit in
  lib/brief-desk/period.ts, which the SEO pass rewrote for the pre-season label
  in the same session. Left so the two changes do not collide.
- m23, m24 (0287 constraints and defaults): a schema change, and the partial
  unique index needs a decision about what counts as a live edition.
- m25, m26, m27, m28, m29, m31, m43, m44: reader-surface and schema decisions
  rather than defects with one correct fix; m27 was fixed in the SEO pass.
- m40, m41, m42: records rather than code. Section 22 and the migration headers
  are the owner's to amend.
