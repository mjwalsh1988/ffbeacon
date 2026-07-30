# Beacon Brief relevance plan

STATUS, 2026-07-30: implemented. Migration 0153 carries the settings, the
constraint, and both prompt rewrites. The gate runs at threshold 2. The 43
approved article removals are recorded in
`docs/beacon-brief-removals-2026-07-30.md`.

Two things in this document were wrong when it was written and are corrected in
place below: section 2.6 (the duplicate problem was already fixed the day before)
and the survivor choice in the Kyle Shanahan group of section 4.

Change 5 (new low-relevance categories) was declined by the owner. The intent is
to filter these stories out, not to give them a home.

Date: 2026-07-30
Scope: `lib/beacon-brief/*`, `beacon_settings` (category `beacon_brief`), `news_ingestions`, `news_categories`, published `articles`.

---

## 1. What the pipeline does today

Single active source: `AdamSchefter` on X (`news_sources`, one row).

Order of operations in `lib/beacon-brief/curate.ts` → `processItem()`:

1. Dedupe on `(source_id, source_external_id)`.
2. Age cutoff (`bb_max_post_age_minutes`, 180). Stale posts are recorded and dropped.
3. Revision / follow-up detection.
4. **Gate 1, keyword blocklist** (`curate.ts:551`). Whole-word match against `bb_keyword_filter`. Hit sets `status='filtered'`, `filter_reason='keyword'`. No AI cost, no Discord, no article.
5. **Categorize AI call** (Haiku, `bb_categorize_prompt`). Returns `non_football`, `context_score`, `category_slug`, players, teams, tags, title, slug.
6. **Gate 2, AI non-football flag** (`curate.ts:613`). `non_football === 1` sets `status='filtered'`, `filter_reason='ai_non_football'`.
7. Insert the ingestion, then **always** enqueue `discord_post`.
8. Enqueue `article_write` when `context_score >= bb_context_threshold` (currently 1).
9. Worker runs the research call (Sonnet + web search, up to 3 searches) and the article call (Sonnet, 4096 tokens), then publishes.

Current DB state:

```
revised              221
published            115
filtered / ai_non_football  65
filtered / keyword          34
dropped_no_context          33
deleted                      1
```

Both existing gates work. The 99 filtered rows are LeBron, the World Cup, golf majors, and similar. I found no false positive worth worrying about in that queue.

## 2. Why the unwanted articles still get through

### 2.1 The classifier is told to let them through

`bb_categorize_prompt` (migration 0103) defines the non-football flag as:

> return 0 when the post is about the NFL, college football, **or the life of a football player, coach, or team**.

"The life of a football player, coach, or team" is precisely the bucket you want gone. Jeff Pash joining a law firm's sports group, Ahman Green's Parkinson's diagnosis, and Billy Ray Smith Jr.'s death are all correctly classified as football-adjacent under the current instruction. The prompt is working as written. The definition is wrong for the product.

### 2.2 Nothing in the pipeline measures fantasy relevance

There are two questions the system asks and one it never asks:

- Asked: is this about football? (`non_football`)
- Asked: is there enough information here to write an article? (`context_score`)
- Never asked: **would a fantasy manager act on this?**

`context_score` is a completeness test, not a value test. A well-sourced obituary scores 1 on completeness. Every one of the unwanted articles has `context_score = 1`.

### 2.3 The `general` category is absorbing the noise

Category distribution of the 115 published articles:

```
general              40
transactions         17
suspensions-legal    16
injuries             15
roster-moves         14
draft-rookies         8
coaching-scheme       5
```

33 of the 40 `general` articles are on my removal list below. `general` is currently the only honest home for uniforms, obituaries, stadium renderings, and league finances, and the classifier has no way to signal "I put this in general because it doesn't belong anywhere."

### 2.4 The keyword list cannot express what you want

The blocklist matches raw post text before any AI call, so it can only catch literal strings. "Retired player reveals a diagnosis" is not a string. Expanding the blocklist to try to cover it would generate exactly the false positives you want to avoid. One real example already in the filtered queue:

> "More about NFL players continuing to push for grass fields on the heels of the World Cup"

That is genuine NFL news, blocked on `world cup`. Acceptable at current volume, but it shows the ceiling of string matching. This gap should be closed by the classifier, not the blocklist.

### 2.5 The article stage can discover the post is irrelevant and publish anyway

The clearest proof is `marcus-spears-jr-commits-texas-reclassifies-2026`. The source post reads:

```
The No. 1 player in the @SCNext Class of 2027, Marcus Spears Jr. is reclassifying
to the Class of 2026 and committing to Texas.
```

Nothing in that text identifies the sport, so the keyword gate and the classifier both had no signal. The research call then found out he is a **basketball** recruit, the article says so, and it published anyway. There is no abort path between "research discovered this is not relevant" and "insert into articles". This is also the most expensive failure mode, because the money is already spent by then.

### 2.6 Duplicate coverage of one event: ALREADY FIXED, no action needed

This section was written from production data that predates the fix. Correcting it
rather than deleting it, because the duplicate articles are still visible in the
archive and will look like a live bug to the next person who reads this.

Commit `cae73a6` (2026-07-29) closed it. `findLateDuplicateTarget` in `worker.ts`
re-asks the follow-up question immediately before the research and article calls,
scoped to articles created after the post's own ingestion row. That is exactly the
set curation could not see, and it is the case that produced every duplicate:
queue jobs run in sequence, so by the time the second post's job executes, the
first post's article exists. `collapseDuplicateDiscordCard` then pulls the second
Discord card so one story keeps one card.

Migration 0151 had already merged four of the pairs and 308-redirected the retired
slugs. The duplicates that remain in the archive (Kyle Shanahan, Aaron Donald) all
published before the fix landed.

---

## 3. Proposed changes

Designed so the strict decisions live in one AI call you already pay for, the thresholds stay admin-editable, and nothing is deleted automatically. Everything filtered lands in the existing Filtered review queue with a force-push button.

### Change 1: add a relevance tier to the categorize call

Extend `CATEGORIZE_SCHEMA` in `curate.ts` and `CategorizeResult` in `types.ts` with two fields. No new AI call, no new model, negligible token cost.

```
relevance_tier    integer 0-3
relevance_reason  short string (one clause, for the review queue)
```

Tier definitions to write into `bb_categorize_prompt`:

- **3** Directly changes a specific player's fantasy value or availability. Injury, activation, signing, trade, release, suspension, holdout, depth chart change, contract that changes team or role.
- **2** Changes how a team will deploy players. Coordinator hire or firing, scheme change, starting OL injury, position battle reporting, coaching change that alters usage.
- **1** Real football news that changes no fantasy decision. Uniforms, stadiums, ownership, league finances, schedule and event logistics, awards, ceremonies, obituaries, retired-player health, media and broadcast careers, front office and scouting staff, agents, off-field items with no availability impact.
- **0** Not football at all.

### Change 2: an explicit subject-eligibility rule in the prompt

Add a hard rule so the model does not have to infer the tier from the topic alone. Draft text:

> Before scoring relevance, identify the primary subject. If the primary subject is not an active NFL player, an active NFL coach, or a team decision that changes on-field usage, the tier is at most 1. Treat these as at most tier 1 in every case: retired or former players, deceased people, people who died or fell ill after their playing career, team owners, league office staff, executives, scouts, agents, broadcasters and analysts, family members of any of the above, and honors or ceremonies for anyone.

Also replace the current "or the life of a football player, coach, or team" clause. Proposed replacement:

> return 0 when the post is about another sport or an unrelated topic, and 0 when the person involved has no current on-field role in the NFL and the post is not about their return to one.

### Change 3: Gate 3, the relevance filter

Two new `beacon_settings` rows, same pattern as migration 0102:

```
bb_relevance_filter_enabled   boolean   default true
bb_relevance_threshold        integer   default 2
```

In `processItem()`, immediately after the existing non-football gate and **before** the ingestion insert that leads to `discord_post`: when `relevance_tier < bb_relevance_threshold`, write the row with `status='filtered'`, `filter_reason='ai_low_relevance'`, and `filter_detail = { tier, reason }`. No Discord, no article, no research call, no writing call.

Placing it here is what satisfies "I don't even want them sent into my Discord". The current code enqueues `discord_post` unconditionally for everything that survives the two existing gates.

Supporting work:
- Migration extending the `filter_reason` CHECK constraint to allow `ai_low_relevance` (0101 currently allows only `keyword` and `ai_non_football`).
- `components/admin/beacon-brief/filtered-manager.tsx:16` widens its `reason` union and renders the tier and reason text.
- `app/admin/beacon-brief/settings/page.tsx` `ORDER` array gains both new keys.
- `forcePushFilteredPost()` must bypass this gate the same way it bypasses the other two.
- `CurationSummary` gains a `filteredLowRelevance` counter.

**Threshold 2 is deliberately the conservative setting.** It filters tier 0 and 1 and keeps everything that touches usage. Setting it to 3 would also drop coordinator hires and OL injuries, which I do not recommend. It is one admin field, changeable without a deploy.

### Change 4: a post-research abort at the article stage

This is the fix for the Marcus Spears case, and it is where the real money is.

Add `fantasy_impact` (boolean) and `no_impact_reason` (string) to `ARTICLE_SCHEMA` in `worker.ts:48`, with an instruction in `bb_article_prompt`: if the research shows the subject is not an active NFL player or the event does not affect any fantasy roster decision, set `fantasy_impact` to false and do not pad the article.

When the article call returns `fantasy_impact: false`, skip the `articles` insert entirely, set the ingestion to `status='filtered'`, `filter_reason='ai_low_relevance'`, `filter_detail={ stage: 'article', reason }`, and log it. The Discord post has already gone out at that point, so the existing `discord_patch` retract path should fire to pull it.

Ordering note worth deciding: `discord_post` currently runs before `article_write`. Holding the Discord post until after the article call would remove the retract entirely, at the cost of delaying breaking news by one worker cycle. I would not do this. Breaking-news speed in Discord is worth more than an occasional retract, and Gate 3 will already have removed the large majority of these before Discord sees them.

### Change 5: category-level relevance flag (optional, recommended)

Add `is_fantasy_relevant boolean not null default true` to `news_categories`, plus two new categories:

```
off-field       Off-Field & League Business
remembrance     Obituaries & Tributes
```

Both seeded with `is_fantasy_relevant = false`. Any post the classifier assigns to a category flagged false is filtered regardless of tier.

Why this is worth doing: it gives you a dial in the admin UI instead of a prompt edit, it gives the classifier an honest destination so `general` stops being a dumping ground, and it makes the intent auditable. It is a corroborating signal to the tier, not a replacement for it.

### Change 6: backtest before enabling anything

`scripts/backtest-brief-relevance.ts`, run once, no cron.

Replay the new categorize prompt over every stored ingestion (all 469 rows already carry the full raw post in `metadata`, so no re-fetch from X is needed) and write a CSV of `slug, old status, new tier, new reason, would filter`. Read it against section 4 below.

Cost estimate: ~469 Haiku calls on short posts, well under a dollar. Nothing is written to production tables.

Tune `bb_relevance_threshold` and the prompt against this output before flipping `bb_relevance_filter_enabled` on. This is what keeps the false-positive risk near zero, and it is the step I would not skip.

### Change 7: keyword blocklist, minor additions only

I do not recommend growing this list to chase the off-field problem. It is the wrong tool and it is where false positives come from. Two safe additions given the current list already covers the majors:

```
premier league, champions league
```

Everything else in this plan should be handled by the tier.

### Suggested order of work

1. Backtest script (change 6). Read the output.
2. Prompt rewrite (changes 1 and 2), re-run backtest, compare.
3. Migration for the settings rows and the CHECK constraint, schema and type changes (change 3), admin UI updates.
4. Enable Gate 3 at threshold 2, watch one week.
5. Article-stage abort (change 4).
6. Category flag (change 5) once the tier data shows which categories cluster low.

Each of these is an atomic `progress.md` task. The prompt rewrite and the code change should not land in one commit; the prompt is a DB row and can be rolled back independently.

---

## 4. Articles I recommend removing

47 of the 115 published articles. Grouped by the reason so you can accept or reject a whole group at a time. Every slug is exact and copy-pastable.

### Group A: deaths and illness of people with no active NFL role (9)

```
billy-ray-smith-jr-dies-cte
ahman-green-parkinsons-diagnosis
chris-johnson-als-diagnosis
bills-legend-jim-kelly-stroke-reveal
saints-lb-keith-mitchell-passes-away
rams-legend-leroy-irvin-dies-68
texans-co-founder-janice-mcnair-passes-away-89
remembering-joe-delaney-42-years
doug-martin-parents-wrongful-death-lawsuit-oakland
```

### Group B: ceremonial honors and tributes (6)

```
adrian-peterson-vikings-ring-of-honor
chris-johnson-titans-ring-of-honor-2026-season-opener
commanders-tribute-john-riggins-schefter
commanders-retire-john-riggins-44-jersey-week-9-rams
eagles-lurie-stuart-scott-enspire-award-autism
bills-oj-simpson-not-honored-new-highmark-stadium
```

### Group C: uniforms, stadiums, branding (4)

```
buffalo-bills-nickel-city-uniforms
jets-legacy-collection-uniforms-2025
bengals-white-bengal-uniforms-snf-steelers-week-10
chiefs-new-stadium-renderings-2031
```

### Group D: league business, ownership, finance, calendar (7)

```
packers-record-revenue-2025-financial-report-leadership-change
seahawks-sale-vinod-khosla-9-billion-record
goodell-contract-extension-expected-coming-months
brian-flores-lawsuit-nfl-rooney-rule-crossroads
2027-nfl-draft-washington-dc-dates
super-bowl-lxii-date-february-13-2028-atlanta
nfl-tmrw-sports-pro-flag-football-league-venue-renderings
```

### Group E: broadcast and media careers (3)

```
tim-tebow-re-signs-multi-year-espn-extension-cfb-analyst
chase-daniel-espn-multi-year-extension-sec-nation-nfl-studio
tony-romo-arrested-owi-milwaukee
```

### Group F: non-player staff with no scheme or usage change (9)

```
jeff-pash-proskauer-sports-group
browns-hire-ryan-grigson-senior-football-advisor-chris-cooper-promoted
jaguars-promote-waldron-farwell-title-designations
cardinals-ryan-gold-suspended-indefinitely-gambling-policy
nfl-suspends-cardinals-ryan-gold-gambling
titans-scout-blaise-taylor-guilty-murder
myron-rolle-nflpa-strategic-advisory-player-brain-health
gerald-alexander-vikings-suspension
eric-bieniemy-son-arrested-shooting
```

### Group G: off-field personal items with no availability impact (2)

```
caleb-williams-iceman-trademark-refused
saquon-barkley-family-safe-home-burglary
```

### Group H: wrong sport, got through anyway (1)

```
marcus-spears-jr-commits-texas-reclassifies-2026
```

Basketball recruit. Covered in section 2.5.

### Group I: duplicate coverage of a single event (2 acted on, corrected)

As originally written this group listed six slugs and was wrong twice. What was
actually done:

```
aaron-donald-return-decision-mcvay-very-strict-process     deleted
aaron-donald-return-decision-not-close-rams-training-camp  deleted
   survivor: aaron-donald-rams-return-contract
```

Three of the six were already `archived` by migration 0151 and needed no action:
`jacoby-brissett-new-deal-cardinals-2026-starter`,
`geno-smith-case-inactive-no-charges`,
`kyle-shanahan-car-accident-chris-foerster-49ers-training-camp`.

The sixth, `kyle-shanahan-car-accident-limited-49ers-training-camp-2026`, was
removed from the list. It is not a duplicate: 0151 made it the merged survivor
carrying facts from both original articles, and it is the destination of a
permanent redirect. Deleting it would have destroyed merged content and pointed
that redirect at a 404. `kyle-shanahan-car-crash-eye-injury` (Jul 28, admitting
fault) is a separate later event, and both remain published.

The four Terrion Arnold articles are **not** duplicates. Arrest, release, waivers, and the Texans physical are four distinct events in a developing story. Keep all four.

---

## 5. Borderline, your call (11)

I would keep these. Listing them so the decision is yours rather than mine, and so the backtest has a labeled set to check the threshold against.

```
eric-bieniemy-chiefs-camp-absent               OC absent from camp, some usage relevance
ben-steele-fired-commanders-tight-ends-coach   Wes Welker as TE coach, weak usage signal
will-grier-cowboys-coaching-staff-offensive-assistant   QB3 retires into a staff job
belichick-unc-year-2-culture-improvement       college program, devy stretch
49ers-sign-bouwmeester-dinkins-nfi             punter signing plus a TE on NFI
texans-sign-febechi-nwaiwu-rookie-contract     4th-round interior OL
2025-nfl-training-camp-all-32-teams            calendar logistics (also has a wrong-year title)
cardinals-panthers-first-report-training-camp-2026   calendar logistics
panthers-cardinals-2026-hall-of-fame-game-august-6    preseason game, snap counts
brendan-sorsby-settlement-2027-nfl-draft       draft eligibility, dynasty and devy
kyle-shanahan-car-crash-eye-injury             head coach availability
```

If you want these gone too, the mechanism is `bb_relevance_threshold = 3` rather than a prompt change. Test that setting against the backtest first; at 3 you will start losing coordinator hires and starting-OL injuries.

---

## 6. Deletion mechanics

`deleteArticle()` in `app/admin/beacon-brief/actions.ts:281` already does the right thing: it cascades `article_players`, `article_teams`, and `article_revisions`, keeps the `news_ingestions` row as the dedup guard with `status='deleted'`, clears pending queue jobs and moderation rows, and optionally deletes the linked Discord message. It takes one article id per call.

For a 47-article removal I would write `scripts/remove-brief-articles.ts` that reads a slug list and calls the same logic, with `--dry-run` as the default. Doing it one at a time through the admin UI would work but is 47 confirmation dialogs.

Two things to decide before running it:

1. **Discord.** `deleteArticle` takes `deleteDiscordPost`. Do you want the historical Discord messages pulled too, or left alone?
2. **SEO.** These 47 URLs are in the sitemap and some are indexed. After deletion they will 404. That is acceptable for thin content and is arguably what you want Google to see. If you would rather return 410 (a permanent signal that speeds up de-indexing), that is a small addition to the brief route's not-found path and is worth doing as part of the same task. Check whether any of the 47 are linked from player profile pages or the brief sidebar before deleting; the cascade removes the `article_players` rows, so those links will resolve themselves.

---

## 7. Open questions

1. Threshold 2 or 3 to start? My recommendation is 2, then read a week of the Filtered queue.
2. Retract Discord messages for the article-stage abort (change 4), or leave them?
3. Add the two new categories (change 5), or keep the tier as the only signal?
4. Delete the Discord history for the 47 removals, or only the articles?
5. Do you want the duplicate-event problem (section 2.6) opened as its own task? It is a separate root cause in `followup.ts` and it is costing real money on the article calls.
