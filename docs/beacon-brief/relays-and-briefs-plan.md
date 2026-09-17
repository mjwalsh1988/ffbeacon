# Beacon Brief, second life: Relays and Briefs

Written 2026-09-16. Revised the same day after the owner's review; the seven
open decisions in section 20 are now recorded as decisions, and sections 4.3,
4.5, 4.6, 8.4, 9, 10, 11 and 14 changed to match. Research and plan only.
Nothing in this document is built. docs/README.md was not edited; add a row
for this file when the build starts.

The question asked: is it a better idea to stop rewriting every news post into
an article, keep the posts as short structured headlines, and write one long
edition per period from them, with the editions indexed and the headlines not?

Short answer: yes, on every axis measured, with two honest limits stated in
section 2. The rest of this document is how to build it so nothing is left to
interpretation.

## 0. For the builder: how to use this document

This section exists so a session that has never seen this conversation can
build the plan without asking the owner anything. Read it first.

Before the first task:

- Read CLAUDE.md at the repository root in full. Every rule there applies
  here, and several are load-bearing for this plan: one shell command per
  tool call, migrations applied through the Supabase MCP and saved under
  supabase/migrations with their RLS policies in the same file, types
  regenerated to lib/database.types.ts after every schema change, every
  timestamp through lib/datetime.ts, plain ASCII punctuation everywhere,
  no Claude attribution in commits, and the three sub-agent reviews
  (implementation, accessibility, security) before any task is marked
  complete. Sub-agents are spawned without a `name` parameter.
- Read .env.local and echo back the variable names, as CLAUDE.md requires.
  This plan adds one variable, `BRIEF_DESK_TOKEN` (section 9.1); add it to
  .env.local, to .env.local.example beside `CRON_SECRET` with a comment in
  the same style, and to the Vercel project's environment before the two
  desk routes are deployed.
- Read progress.md to learn the task block format. This plan's tasks go in
  with the prefix BD, in the same block shape the SS- and MPS- prefixed
  tasks use (status, files, depends on, verified). Every task in section
  19 becomes one block before it is started.
- The commands: `npm run typecheck`, `npm run lint`, `npm run test`
  (vitest). All three pass before a task is marked complete. New pure
  modules get a test file beside them, named `<module>.test.ts`, in the
  style of lib/indexnow.test.ts and lib/beacon-brief/match.test.ts.
- The owner reads through a screen reader. Responses to the owner are
  plain text: no markdown markers, no tables, short lists only. Code and
  commands go in fenced blocks.

How the sections fit together: sections 1 and 2 are the reasoning and can
be skimmed once. Sections 3 through 14 are the specification and are
binding; where two sections seem to disagree, the later section number
wins, because the later ones were written to the owner's final decisions.
Section 15 and 16 are the review checklists the sub-agents run. Section 17
is where every file goes. Section 18 is the migration list. Section 19 is
the build order, and it is the order to follow: phase 1 changes the live
pipeline and must run for a day before phase 2 touches the reader. Section
20 records the owner's decisions and is the authority when a question
looks open. Section 22 is filled in during the build.

Things the builder decides alone, with the defaults to use:

- Migration numbers: the next free slot in supabase/migrations at the time.
- The cloud routine's model: Claude Opus 5 (`claude-opus-5`) for the
  drafting routine, because the run is long-form writing and research. The
  classify call stays on Haiku 4.5 as today.
- Setting the token on the routine: the routine environment's variables at
  claude.ai/code. If that surface turns out not to accept environment
  variables, do not put the token in the prompt; use the local fallback
  (section 8.1) and record the limitation in section 22.
- The week 1 edition (section 14.3) is written against the local dev
  server (`npm run dev`, with `BRIEF_DESK_TOKEN` in .env.local and
  `NEXT_PUBLIC_SITE_URL` pointing at localhost), reading the production
  database the way every local run does. The draft then lands in the
  production queue, where the owner reviews it.

## Contents

0. For the builder: how to use this document
1. What exists today, measured
2. The verdict: is the idea right, and what it will and will not do
3. Vocabulary
4. The Relay pipeline (what changes in curation, what is kept)
5. The Relay data model
6. The Relay reader surfaces
7. The Brief data model
8. The Brief drafting run (where it runs, what it may read, what it must do)
9. The bundle and draft endpoints (the only two doors)
10. The moderation queue
11. The Brief reader page, SEO and structured data
12. Cadence
13. Cost, before and after
14. Legacy articles, the backfill, and the first edition
15. Security review checklist
16. Accessibility checklist
17. Module map and file placement
18. Migrations
19. Task list
20. Owner decisions, recorded 2026-09-16
21. Sources read
22. Build record

## 1. What exists today, measured

Read from the repository on 2026-09-16. Line numbers are as of commit 604cc04.

The pipeline is one source (AdamSchefter on X, `news_sources` has one row and
`source_type` is CHECKed to `'x'` at supabase/migrations/0082_news_sources.sql:23)
feeding two crons: `app/api/cron/beacon-brief/route.ts` runs `runCuration`
every five minutes, and `app/api/cron/beacon-brief-worker/route.ts` drains
`beacon_brief_queue` every minute (vercel.json:64-71).

Curation, lib/beacon-brief/curate.ts, in order: dedupe on
(source_id, source_external_id), age cutoff, revision detection, the keyword
blocklist, the classify call, the non-football gate, the relevance gate at
tier 2, the ingestion insert, then `discord_post` always and `article_write`
when context_score clears the threshold.

Eight Anthropic calls exist, all routed through lib/beacon-brief/ai.ts and all
prompt-backed by `beacon_settings` rows (lib/beacon-brief/settings.ts:295,
key map at 446-466):

| Call | File | Model default | Purpose |
| --- | --- | --- | --- |
| classify | curate.ts:791 | claude-haiku-4-5 | non_football, relevance_tier, context_score, category, players, teams, tags, title, slug |
| classify (force push) | curate.ts:1079 | claude-haiku-4-5 | same, from the Filtered queue |
| follow-up link | followup.ts:460 | claude-haiku-4-5 | which recent article a post continues |
| merge gate | merge.ts:83 | claude-haiku-4-5 | does the post add new information |
| research gate | worker.ts:1274 | claude-haiku-4-5 | is web research worth paying for |
| research | worker.ts:1446 | claude-haiku-4-5 | web search, up to bb_research_max_searches |
| article write | worker.ts:1506 | claude-sonnet-4-6 | title, meta, tl;dr, body, fantasy_impact |
| revision rewrite | worker.ts:926 | claude-haiku-4-5 | fold a follow-up into an article |

The classify call's strict schema is `CATEGORIZE_SCHEMA` at curate.ts:50-77.
The article insert is worker.ts:1620-1636; `article_type` is the category
slug, `origin` is `'beacon_brief'`, `status` is `'published'` when
`bb_autopublish` is on, which it is by default (settings.ts:173).

Cost, measured over the seven days ending 2026-08-10 and recorded in
supabase/migrations/0186_beacon_brief_research_cost.sql:5-9:

| Stage | Calls | Input tokens | Cost |
| --- | --- | --- | --- |
| research | 88 | 10,442,262 | $37.21 |
| article write | 101 | 111,451 | $1.29 |
| classify | 137 | 251,938 | $0.34 |
| link and triage | 76 | 129,674 | $0.18 |

Research was 95 percent of the bill. Migration 0186 moved research to Haiku
and cut the search cap to two, so the bill is lower now than that table, but
the shape is unchanged: the expensive calls are research and writing, the
cheap calls are classification and triage. Those cheap calls are the ones
this plan keeps.

Search standing, from Search Console for the ninety days to 2026-09-16: the
site wins branded queries and "faab calculator" (49 clicks, position 8.3).
Everything else is a long tail of player-name impressions at positions 40 to
90, most of them from templated player pages. No query containing "week"
appears in the top two hundred, because nothing on the site targets one.

The AdSense decline of 2026-09-14 (docs/seo-audit/adsense-review-2026-09-14.md)
named low value content. The Brief was 316 of 509 sitemap articles, median
127 to 160 words, every one drafted from another outlet's reporting. The
master switch `BRIEF_SEARCH_INDEXING` at lib/beacon-brief/index-quality.ts:68
is false; `isArticleIndexable` (:133) returns false for every article while it
is. Articles still publish, render, feed Discord and RSS.

## 2. The verdict

### 2.1 Why the current shape cannot be indexed again

Google's spam policy (developers.google.com/search/docs/essentials/spam-policies,
read 2026-09-16) lists under scaled content abuse: "Using generative AI tools
or other similar tools to generate many pages without adding value for users"
and under scraping: "Reproducing content feeds from other sites without
providing some type of unique benefit." A 140-word rewrite of one reporter's
post, published forty times a week, is that description. No amount of prompt
tuning changes the shape, because the shape is one thin page per source post.

### 2.2 Why the proposed shape is the one Google describes wanting

Google's helpful content guidance (developers.google.com/search/docs/fundamentals/creating-helpful-content)
asks: "If the content draws on other sources, does it avoid simply copying or
rewriting those sources, and instead provide substantial additional value and
originality?" and "Are you providing background about how automation or
AI-generation was used to create content?" and "Do pages carry a byline, where
one might be expected?"

A weekly Brief that gathers the period's reports, checks each against a
current source, and puts the site's own numbers beside every one (value
change from `player_value_trends`, the week's box score from `player_stats`,
the next-week projection, the beat rate, Positional WAR where a league context
exists) is original work that no other outlet can publish, because the numbers
are ours. Edited, approved and signed by a named author before publication,
it answers the first and third questions outright. On the second, the owner's
decision (section 20) is that how the desk gathers and prepares material is
proprietary and is not described on the site; the guidance phrases that
point as a question to ask oneself, not as a policy, and the accurate byline
and the original data on every page are what the policies themselves
require. Thirty such pages a year is a body of work; three hundred rewrites
was a liability.

### 2.3 The two honest limits

First, the head terms are owned. A search on 2026-09-16 for "week 2 fantasy
football injury roundup" returns FantasyPros, NBC Sports, Forbes (twice),
Fantasy Points, Fantasy Alarm and Pro Football Network. A three-month-old
domain will not displace them for "week N fantasy football injury report" this
season, and the plan must not promise that. What a Brief can win, from the
first edition, is the long tail the site already gets impressions for: a
player plus a situation plus the fantasy consequence ("kenny gainwell 2026
fantasy football role team depth chart" and "george kittle week 1 2026 injury
status 49ers" both appear in the ninety-day query log at positions 6 and 7).
Every Brief section is a paragraph or three about exactly one of those, with
the player's name in a heading, so each edition targets thirty to sixty such
queries at once. The head terms come later, if they come, from accumulated
topical authority and Discover eligibility.

Second, a Brief that is only the week's forty headlines rewritten in order is
the stitching pattern Google names, in a longer coat. The defence is a hard
rule, stated in section 8.4 and enforced by the draft validator: every section
carries at least one figure the site computed, and every claim not in a Relay
or in the bundle carries a citation to a URL fetched during the run. A section
that cannot meet either is cut, not padded.

### 2.4 Cost

The current week costs about forty dollars in API calls when research runs
freely and something under ten with the 0186 changes. The proposed week costs
under one dollar in API calls (section 13). The Brief itself is drafted by a
scheduled Claude Code run on the owner's subscription, which bills nothing per
token.

### 2.5 Verdict

Build it. It is cheaper by an order of magnitude, it removes the content
Google and AdSense objected to without removing the news, and it produces the
one thing the site lacks for search: dated, reviewed, data-carrying long-form
pages on a schedule. The AdSense re-review should wait until at least three
editions are live and crawled.

## 3. Vocabulary

Relay: one short structured headline made from one accepted source post. Never
indexed. Has a permalink for sharing and Discord, marked noindex, follow.

Brief: one long-form edition covering a period's Relays, written by the desk
run, reviewed by the owner, indexed. "Edition" is the same thing in the admin
UI and the data model; "Brief" is the reader-facing word.

The Beacon Brief: the section of the site that holds both. The hub at /brief
shows Relays as a feed with the latest Brief pinned above it.

Desk run: the scheduled Claude Code session that drafts one Brief.

Bundle: the JSON the desk run reads at the start: the period's Relays, the
site's numbers for every player and team they mention, the editorial
instructions, and any notes from a rejected earlier draft.

## 4. The Relay pipeline

### 4.1 What is kept, unchanged

- Ingestion: lib/x.ts, lib/beacon-brief/ingest-x.ts, the five-minute cron.
- Gates: keyword blocklist, non-football, relevance at threshold 2.
- Dedupe: (source_id, source_external_id), event_key (lib/beacon-brief/event-key.ts),
  the follow-up link call, and the merge gate call. Both Haiku calls stay,
  because "is this the same story" and "does this add anything" are the
  duplication checks the owner asked to keep.
- Reference matching: lib/beacon-brief/match.ts and the player_match and
  team_match moderation rows.
- Discord: the `discord_post` and `discord_patch` jobs. The card text changes
  (section 4.5); the job does not.
- Deletion watch: lib/beacon-brief/deletion.ts. A retracted post retracts its
  Relay (section 5.4).
- Health, logs, the X circuit breaker, the Filtered queue and force push.

### 4.2 What stops

- No `article_write` job is enqueued for a new post. The enqueue at the end of
  `processItem` is gated by a new setting `bb_article_write_enabled`, default
  false. The worker keeps the handler so an admin can turn it back on; nothing
  is deleted.
- No research call, no article call, no revision rewrite. The three settings
  that drive them stay in the table and the admin page, marked "legacy".
- `backfill-article-seo.ts`, `remove-brief-articles.ts` and
  `audit-brief-merges.ts` keep working against the legacy rows.

### 4.3 What is added to the classify call

The classify call is extended, not duplicated. `CATEGORIZE_SCHEMA` gains one
required object, `relay`, and the prompt gains one section that describes it.
Output grows by roughly 150 tokens per post, which at Haiku's rate is a few
cents a week.

```
relay: {
  headline: string,       // 40 to 220 characters. One or two sentences.
                          // States what happened, names the player or team,
                          // no opinion, no hashtags, no "per source".
  kind: enum,             // injury | transaction | contract | suspension |
                          // depth_chart | coaching | performance | draft |
                          // legal | other
  facts: array,           // 0 to 6 items of { label: string (max 24 chars),
                          //   value: string (max 80 chars) }
                          // e.g. { "Injury": "high ankle sprain" },
                          //      { "Timeline": "4 to 6 weeks" },
                          //      { "Contract": "3 years, $54M, $30M guaranteed" }
  timeline: string|null,  // the availability window in the post's own words,
                          // or null when the post gives none
  availability: enum      // out | doubtful | questionable | active | ir |
                          // pup | released | signed | traded | suspended |
                          // waived | none
}
```

The owner's first requirement for this call: the model's prior knowledge is
not a source, and the post is the fact, one hundred percent. Migration 0202
already put a version of that rule at the top of `bb_categorize_prompt` for
the relevance decision ("THE POST IS THE RECORD, NOT YOUR MEMORY"). The Relay
section restates it for extraction, where the failure is different: the
classifier's failure was rejecting a true post, the extractor's would be
quietly correcting one. Draft text, seeded by migration and editable on the
settings page:

```
== RELAY ==
Return a relay object built ONLY from the text of this post.

THE POST IS THE ONLY SOURCE. You have no other. The post is newer than
everything you remember, and it comes from a reporter FF Beacon has chosen
to trust. Every team, position, contract figure, injury, timeline, coach
and roster fact in your output must appear in the post. If the post says a
player is on a team you believe he left, he is on that team. If the post
gives a timeline you believe is wrong, that is the timeline. If the post
names a position you believe is wrong, that is the position. You are not
being asked whether the post is true. You are being asked what it says.

NEVER ADD. Do not add a team, position, age, contract year, injury type,
return date or any other detail the post does not state, even when you are
sure of it. A fact the post leaves out is left out. A timeline the post does
not give is null, never a typical timeline for that injury. If a post names
a player without a team, the headline names the player without a team.

NEVER CORRECT. Do not fix what looks like a typo in a name, a number or a
team. Copy it. A wrong figure copied from a post is the reporter's error and
is handled by the deletion watch; a right figure changed by you is our
error and nobody can find it.

headline: 40 to 220 characters. One or two sentences stating what happened,
naming the player or team as the post names them. No opinion, no
consequence, no "reports" or "sources say" (the card credits the source
underneath), no hashtags, no quotation of the reporter.

kind: one of injury, transaction, contract, suspension, depth_chart,
coaching, performance, draft, legal, other.

facts: 0 to 6 items of { label, value }. Label at most 24 characters, value
at most 80. Each value is a phrase lifted from the post, in the post's own
words and numbers. Typical labels: Injury, Timeline, Status, Contract,
Guaranteed, Traded for, Signed with, Released by, Suspended for, Also.

timeline: the availability window in the post's own words, or null.

availability: one of out, doubtful, questionable, active, ir, pup, released,
signed, traded, suspended, waived, none. Choose none unless the post states
the status.

When a post covers more than one player, the headline names the primary
subject and facts may name the others under the label Also.

Plain ASCII punctuation only. No dashes as separators, no ellipsis
character, no curly quotes, no emoji.
```

The existing `suggested_title` and `suggested_slug` fields stay in the schema
for the legacy path and for the Relay permalink slug.

The prompt alone is not the guarantee. Section 4.6 is.

### 4.4 Where the Relay row is written

In `processItem`, immediately after the ingestion insert succeeds and before
`discord_post` is enqueued, `writeRelay(admin, ingestion, ai, refs, week,
{ discord: true })` inserts the `relays` row and its join rows and, when
`discord` is true, enqueues the `discord_post` job for it. The Discord job
then reads the Relay rather than the ingestion, so the card and the site say
the same thing. The backfill (section 14.1) calls the same function with
`discord: false`, and nothing else in the backfill path can reach the queue:
an old report must never go out to the channel as if it were news.

For a post the follow-up link matched to an earlier event, the merge gate
decides as it does today: no new information means the post is recorded as a
revision and no Relay is written; new information means a new Relay with
`follows_relay_id` pointing at the earlier one. The feed renders the chain as
an "Update" chip and a link. Nothing is rewritten.

Week assignment: `lib/relays/week.ts assignRelayWeek(nflState, postedAt)` is
pure. During the regular season and playoffs a post belongs to the NFL week
Sleeper's state reports at ingest time. Off-season posts carry `week` null and
`season` from `currentNflSeason()`. The Brief cadence (section 12) reads the
same function, so a Relay can never fall between two editions.

### 4.5 Card text is composed by code, never by a model

`lib/relays/render.ts` is pure and tested. It takes a `RelayRow` plus resolved
player and team names and returns:

- `headline` (verbatim from the row)
- `facts` as label and value pairs, in stored order
- `sourceLine`: "Original report: @AdamSchefter on X, Sep 16, 2026, 7:30 AM EDT"
  built with `formatEastern` from lib/datetime.ts, never a bare `toLocale*`
- `discordText`: the headline, a blank line, the facts one per line as
  "Label: value", a blank line, then the attribution "via @AdamSchefter" in
  plain text. No link of any kind: no permalink, no source URL, no markdown
  link syntax. A Relay is our structured record of the report, so there is
  never a URL in it to carry; the "via" line is the whole credit. Discord's
  2,000 character limit is enforced here with the same "never drop a fact,
  fail the post instead" rule Would You Rather uses for poll text; a card
  that cannot fit is logged and posted as headline plus the via line only.

Images attached to the source post continue to travel with the card as
attachments, through the existing `buildMediaAttachments` in worker.ts;
they are files, not links, and the owner's rule is about links.

Mentions: a Relay post mentions nobody. The webhook payload sends
`allowed_mentions: { parse: [] }` and the content carries no `@everyone`,
`@here` or role token. This supersedes the per-category role pings that
`news_categories.discord_role_ids` (migration 0083) drives today; the column
stays for the admin page and for Briefs (section 10.1), and the relay path
ignores it. A Brief post is the opposite (section 10.1).

There is no sentence generation in this file, and the owner has decided
there will not be: no "what it means" line on a Relay. Rewriting is for
Briefs only.

### 4.6 The grounding check, in code

`lib/relays/grounding.ts checkRelayGrounding(post, relay)` is pure and
tested, and runs before `writeRelay`. It is what makes the prompt in 4.3 a
guarantee rather than a request:

- Every number in the headline, the facts and the timeline (integers,
  decimals, dollar amounts, week numbers, years) must appear in the post
  text after normalising separators ("$54M" matches "54 million" and
  "$54,000,000"; "4-6 weeks" matches "4 to 6 weeks" and "four to six").
- Every capitalised token of two or more characters in the headline and
  facts (player names, team names, city names, positions written as
  abbreviations) must appear in the post text, in the quoted post, or in
  the resolved player and team names the matcher produced for this post
  (so "Eagles" may appear when the post said "PHI" and the team matched).
- Every fact value must share at least one content word with the post.

A Relay that fails any check is not published. It is written with
`status = 'hidden'`, `status_reason = 'grounding'`, the failing tokens are
stored in the classify log row, and a `beacon_brief_moderation` row of the
existing `failed_task` type is opened so it appears in the queue. No
Discord post goes out for a hidden Relay. The owner can edit and publish it
from the Relays manager (section 10.2), which re-runs the check on the
edited text.

The check is deliberately strict in one direction only. It cannot catch a
fact the model left out, and it does not try; a missing fact is a shorter
card, which is the safe failure. What it catches is the failure the owner
named: a team, a timeline or a number that came from memory rather than
from the post.

## 5. The Relay data model

### 5.1 Table `relays`

One row per accepted post. Derived from `news_ingestions`, which keeps the raw
object in `metadata`, so per the Data Architecture rule this table carries no
`metadata` column of its own (it is a pre-calculated table whose provenance is
the ingestion row and the classify log).

```
relays
  id                 uuid pk default gen_random_uuid()
  ingestion_id       uuid not null unique references news_ingestions(id) on delete cascade
  slug               text not null unique          -- from suggested_slug, suffixed on collision
  kind               text not null check (kind in ('injury','transaction','contract',
                       'suspension','depth_chart','coaching','performance','draft',
                       'legal','other'))
  headline           text not null check (char_length(headline) between 20 and 240)
  facts              jsonb not null default '[]'   -- [{label, value}], max 6, validated in code
  timeline           text
  availability       text check (availability in ('out','doubtful','questionable','active',
                       'ir','pup','released','signed','traded','suspended','waived','none'))
  category_id        uuid references news_categories(id)
  relevance_tier     integer not null
  tags               text[] not null default '{}'
  season             text not null                 -- '2026'
  week               integer                       -- null off-season
  source_handle      text not null                 -- '@AdamSchefter', from news_ingestions.author_handle
  source_url         text not null                 -- news_ingestions.external_url
  source_posted_at   timestamptz not null          -- the post's own timestamp from metadata, not created_at
  follows_relay_id   uuid references relays(id)    -- the earlier Relay this updates
  brief_id           uuid references articles(id)  -- the edition that covered it, set on publish
  status             text not null default 'published'
                       check (status in ('published','hidden','retracted'))
  status_reason      text
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()
```

Indexes: (season, week, source_posted_at desc); (status, source_posted_at desc);
(brief_id); (follows_relay_id); a trigram index on headline for the admin
search only if the admin page needs it (defer).

### 5.2 Join tables

```
relay_players (relay_id uuid references relays on delete cascade,
               player_id uuid references players on delete cascade,
               is_primary boolean not null default false,
               primary key (relay_id, player_id))
relay_teams   (relay_id uuid references relays on delete cascade,
               team_id uuid references nfl_teams on delete cascade,
               primary key (relay_id, team_id))
```

`is_primary` marks the headline's subject so the card can lead with one pill.

### 5.3 RLS

Public read-only data, per the CLAUDE.md pattern:

- `relays_select_public`: for select to anon, authenticated using
  (status = 'published').
- `relays_service_role_all`.
- `relay_players_select_public` and `relay_teams_select_public`: for select
  using (exists (select 1 from relays r where r.id = relay_id and r.status = 'published')).
- Both join tables get `_service_role_all`.

No client-side writes. The verification sequence in CLAUDE.md (pg_policies
query, anon select works, anon insert blocked) is run and its output pasted
into the migration header before the task is marked complete.

### 5.4 Status transitions

- `published`: the default on insert. Visible in the feed, the permalink and
  the bundle.
- `hidden`: an admin took it off the site; stays in the bundle with a flag so
  the desk run can decide whether the story still matters. Reason required.
- `retracted`: the deletion watch found the source post gone, or an admin
  marked it. Removed from the feed, permalink returns 410, excluded from the
  bundle, and the Discord card is edited through the existing `discord_patch`
  job to read "Retracted: the original report was removed by its author",
  the headline, and the via line, with no link. Reason recorded.

A retraction of a Relay that a published Brief already cites opens a
`beacon_brief_moderation` row of a new type `brief_correction` against the
Brief, with the Relay id in `detail`. The owner decides the correction; the
system never edits a published Brief on its own.

## 6. The Relay reader surfaces

### 6.1 The hub, /brief

Replaces the article feed. Layout, top to bottom:

1. Masthead, unchanged in shape.
2. "Latest Brief" panel: the newest published edition, its title, dateline,
   period covered, tl;dr, and a link. When no edition exists the panel is
   omitted, never a "coming soon" card (the AdSense review removed those).
3. The Relay feed: a list of cards, newest first, paginated at 30. Filters by
   kind, team, player and week stay as URL params, same as the article feed
   today, so `?team=PHI&week=2` is shareable.
4. The sidebar keeps the categories and teams rails from
   components/beacon-brief/brief-rail-sections.tsx, reading Relay counts.

The hub stays indexable, as it is today. Its description changes to describe
what it now is: the running feed of what changed, and the weekly Brief.

### 6.2 A Relay card

`components/relays/relay-card.tsx`, a server component. Semantic shape:

```
<article aria-labelledby={headingId}>
  <header>
    <p>  kind chip, week chip, "Update" chip when follows_relay_id is set  </p>
    <h3 id={headingId}> headline </h3>
  </header>
  <dl> one dt/dd per fact </dl>
  <p> player pills (links to /players/[slug]), team pills (links to /brief?team=) </p>
  <footer>
    <p> Original report: <a href={source_url} rel="nofollow noopener">@handle on X</a>,
        <time dateTime={iso}> formatEastern(iso) </time> </p>
    <a href={`/brief/relay/${slug}`}> Permalink </a>
  </footer>
</article>
```

Nothing visible is aria-hidden; the kind icon, if one is drawn, is decorative
with alt="". The heading level is h3 under the feed's h2. Tap targets on pills
are at least 44 by 44 CSS px. Mobile shows every fact; the dl stacks.

### 6.3 The permalink, /brief/relay/[slug]

Exists for Discord, sharing and the Brief's inline links. Renders the card,
the chain of earlier and later Relays for the same event, and the Brief that
covered it once one exists. Metadata: `robots: { index: false, follow: true }`,
always, not behind the master switch. Canonical is itself. It is not in any
sitemap. Its share image is the generic page card through
`pageShareMetadata` in lib/page-og.ts; no per-Relay image route is built.
A `retracted` Relay returns 410 with a one-line page.

### 6.4 RSS

app/brief/rss.xml/route.ts switches from articles to two feeds:
/brief/rss.xml carries Briefs only (the thing a reader subscribes to), and
/brief/relays.xml carries Relays. The hub's feed autodiscovery link points at
the Briefs feed.

### 6.5 Homepage and player profiles

The homepage's Brief block (app/page.tsx, the article list the worker busts
with `revalidateTag("home")`) shows the latest Brief and the four newest
Relays. The player profile's news panel, which reads `article_players` today,
reads `relay_players` and shows the player's last five Relays with a link to
the Brief that covered each. Both are read-path changes only.

## 7. The Brief data model

A Brief is an `articles` row. The table already carries `season`, `week`,
`status`, `tl_dr`, `meta_description`, `content_md`, `schema_jsonld`,
`article_players`, `article_teams`, `article_revisions` and the OG route, so
re-using it costs one CHECK widening and avoids a second reader stack.

### 7.1 Changes to `articles`

- `status` CHECK gains `'in_review'` and `'rejected'`
  (0005_articles.sql:34 today allows draft, published, archived). The anon
  select policy is pinned to `status = 'published'`, so a draft in review is
  invisible to the public by the existing rule, with no policy change.
- `origin` CHECK gains `'brief_desk'` (0091 today allows manual, beacon_brief).
- `article_type` for an edition is the literal `'brief'`. No CHECK exists on
  that column; the reader branches on it.

### 7.2 Table `brief_editions`

Provenance and review state for one edition. Service-role only; the public
never reads it, the page reads `articles`.

```
brief_editions
  id                  uuid pk default gen_random_uuid()
  article_id          uuid not null unique references articles(id) on delete cascade
  season              text not null
  week                integer                        -- null off-season
  period_start        timestamptz not null
  period_end          timestamptz not null
  cadence             text not null check (cadence in ('weekly','biweekly','monthly'))
  relay_ids           uuid[] not null               -- the bundle's Relays at draft time
  relay_count         integer not null
  draft_source        text not null check (draft_source in ('cloud_routine','local_run','manual'))
  draft_run_id        text                          -- routine run or session id, for the log link
  draft_model         text                          -- what the run reported it used
  draft_payload       jsonb not null                -- the validated draft JSON (section 9.3)
  research_log        jsonb not null default '[]'   -- [{claim, url, fetched_at, note}]
  validation_report   jsonb not null default '{}'   -- what the validator flagged
  title_choice        integer                       -- off-season: index into draft_payload.title_options
  discord_posted_at   timestamptz                   -- null when approved with Post to Discord off
  review_notes        text                          -- owner's notes on reject or approve
  reviewed_by         uuid references auth.users(id)
  reviewed_at         timestamptz
  created_at          timestamptz not null default now()
```

`draft_payload` is the source object for the edition, which is why it is kept
whole: the page renders from `articles.content_md` plus the figure data in the
payload, and a re-render after a component change re-reads it. This is the
`metadata` rule applied to an internal producer.

### 7.3 Moderation row

A draft that lands in review inserts a `beacon_brief_moderation` row with a
new `type = 'brief_review'` and `article_id` set, so the existing moderation
list shows it beside player matches and deletions. The CHECK on `type`
(0150:27) gains `'brief_review'` and `'brief_correction'`.

## 8. The Brief drafting run

### 8.1 Where it runs

Primary: a Claude Code cloud routine (claude.ai/code/routines). It runs on
the owner's subscription, in Anthropic's cloud, with the repository cloned,
on a cron. Facts verified from the routine tooling on 2026-09-16:

- Minimum interval is one hour; weekly is fine.
- Cron is UTC. The server decides whether an edition is due (section 12), so
  the routine can fire every Tuesday at 13:00 UTC year round and be told "no
  edition due" in a quiet off-season week. That sidesteps the twice-yearly
  DST drift that the Would You Rather Discord cron also had to design around.
- The cloud session has no access to the local machine, .env.local or the
  Supabase MCP server. It has WebSearch, WebFetch and the repository. The
  claude.ai connectors it can use are the ones listed in the account
  (Claude-Docs, Slack, monday-com, Semrush, Google Calendar, Gmail, Drive);
  none of those is the database.
- GitHub was connected to the Claude account on 2026-09-16, after the first
  draft of this plan, so a cloud routine can clone the repository. The
  routine reads `main`; it never pushes.

Fallback: a local scheduled run. `scripts/brief-desk/draft.ps1` invokes
`claude -p` with the same bootstrap prompt from Windows Task Scheduler on the
owner's machine. It has the same two doors (section 9) and no more; it does
not read .env.local either, so the two paths are interchangeable and the
security review only has to look at one design.

Both paths are the owner's subscription. Neither touches the Anthropic API key
in .env.local.

### 8.2 What the run may read and write

Exactly two HTTP doors, both on the site, both bearer-authenticated with a
dedicated token (section 9.1). The run holds no database credential of any
kind. This is the single most important line in the design: a scheduled
agent with a service-role key is a scheduled agent that can drop a table.

The run may also read the public web through its own tools. It may read the
repository it was cloned into, which is how it finds the bootstrap prompt and
the style rules, but it must not run scripts from the repository that need
env vars, because it has none.

### 8.3 The bootstrap prompt

Lives in the routine configuration (cloud) or in `scripts/brief-desk/prompt.md`
(local), and is deliberately short:

```
You are the FF Beacon news desk. Fetch GET {SITE}/api/brief-desk/bundle with
the bearer token in BRIEF_DESK_TOKEN. If the response says no edition is due,
stop. Otherwise follow the `instructions` field in the response exactly; it is
the editorial brief for this edition. When your draft is complete, POST it to
{SITE}/api/brief-desk/drafts with the same token and stop. Never write to the
repository. Never call any other endpoint on the site.
```

The editorial instructions themselves live in `beacon_settings` under a new
category `brief_desk`, key `bd_brief_instructions`, and come back inside the
bundle. That keeps the real prompt DB-backed and editable on the admin page,
per the standing rule that every AI prompt is editable without a deploy. The
routine's prompt changes only when the endpoint contract changes.

### 8.4 What the instructions require of the draft

Written into `bd_brief_instructions` at seed time; the owner edits from there.

1. Sources of truth, in order: the bundle's Relays (what was reported), the
   bundle's numbers (what the site computed), and pages fetched during this
   run (what is true now). Training memory is not a source. A roster, depth
   chart, timeline or contract detail that is not in one of those three is
   not stated.
2. Every Relay in the bundle is checked against at least one current web page
   before it is written about, because a week is long: a "4 to 6 weeks"
   timeline reported on Tuesday may be "placed on IR" by Sunday. The check is
   recorded in `research_log` with the URL, the fetch time and one line on
   what it confirmed or changed. A Relay that cannot be confirmed is written
   as "reported on {date} by {source}" and nothing firmer.
3. Every section carries at least one figure from the bundle, named as what it
   is: "his value on {source display name} moved from X to Y over the week",
   "he scored 18.4 PPR points in week 2 on 9 targets", "the model projects
   11.2 points next week". A figure quoted in prose is also placed as a block
   where a block kind fits it, and the section's `block_refs` record which.
   A section with no bundle figure to carry is cut.
4. Structure: title, meta description, tl;dr of three to five sentences, then
   sections grouped by what a fantasy manager does with them, not by team:
   injuries and availability; trades, signings and releases; depth chart and
   role changes; the week's scoreboard (top scorers by position from the
   bundle, and the biggest value movers); what to do this week (waivers,
   holds, sells, each tied to a Relay); an FAQ of three to six questions
   phrased as people search them. Off-season editions drop the scoreboard and
   add a "what changed in value" section.
5. Length: 1,800 to 4,000 words in season, 1,200 to 2,500 off-season. Long
   because the period had a lot of news, never because of padding.
6. Voice: the site's voice from the guides. First person is Michael's and is
   not used; the desk writes as "we". Plain ASCII punctuation, no em dashes,
   no curly quotes, no ellipsis character, no emoji. None of the patterns in
   the owner's AI-writing list: no negative parallelism, no rule of three as
   rhythm, no significance inflation, no "it's worth noting", no trailing
   participle clauses.
7. Links: the first mention of every player links to /players/{slug} (the
   bundle supplies slugs); every Relay cited links to its permalink; the
   relevant tool is linked where an action is suggested (/tools/faab for a
   waiver bid, /tools/who-should-i-start for a start/sit call,
   /tools/trade-calculator for a sell).
8. Visuals and interactives are required, not optional, and they come from
   the block library (section 11.2). The bundle ships ready-made datasets
   (value movers, top scorers, the injury return timeline, waiver targets
   with bid ranges, format comparisons). The draft places blocks by kind and
   dataset id, writes each block's caption and its one-sentence conclusion,
   and chooses the section icon from the fixed set. An in-season edition
   carries at least: one stat tile row at the top, one value movers chart,
   one box score or top scorers table, one injury return timeline, one
   action list with tool links, and one interactive (the format toggle or
   the return planner). A section that is only paragraphs is a section
   that has not been finished. The run never draws an image, never writes
   HTML, SVG or script, and never invents a number for a block: blocks
   render only the dataset they reference.
9. The draft states its formats once, near the top: "Values and ranks below
   are shown for Dynasty Superflex PPR and Redraft PPR (1QB) on {source
   display name}" from the bundle's `context` field. Every report's fantasy
   consequence is written for both: what a dynasty manager does with it and
   what a redraft manager does with it, in that order, and collapsed into
   one sentence only when the answer is genuinely the same in both.
10. Nothing about the desk, the model or the review process goes in the body.
    The page adds the byline itself (section 11.3).
11. The reference edition is the week 1, 2026 Brief (section 14.3), written
    by hand through the same doors and stored as
    docs/beacon-brief/examples/week-1-2026-brief.json. The bundle carries
    it under `example`, and the instructions say: match its shape, its
    density of figures per section, its heading style and its length. A
    draft that reads like a news wire when the example reads like a guide
    is rejected on shape alone.
12. Off-season editions carry no fixed title. The run researches the
    phrases people are searching for that period (free agency, the draft,
    training camp, rookie rankings, whatever the Relays are actually about)
    and returns three title and slug pairs with the queries each targets and
    one line on why. The owner picks one at approval. In season the title
    pattern is fixed and this step is skipped.

### 8.5 Rejection loop

A period is due whenever its close has passed and it has no edition in
`in_review` or `published`. Rejecting a draft therefore reopens the period
by itself: no flag, no extra state. The next bundle for that period carries
`previous_attempt: { notes, rejected_at, draft_payload }` from the newest
rejected edition, and the instructions tell the run to revise rather than
start over. To get that next attempt sooner than the next scheduled fire,
the owner presses "Run now" on the routine at claude.ai/code/routines; the
review page shows that link beside the reject button, and there is no
"Draft again" action of its own.

Once an edition is published its period is closed for good. Corrections to
a published edition are edits through the review page, never a redraft.

## 9. The two doors

### 9.1 Authentication

A new env var `BRIEF_DESK_TOKEN`, distinct from `CRON_SECRET`, so revoking the
desk's access affects nothing else. Checked with `timingSafeEqual` in
`lib/brief-desk/auth.ts verifyBriefDeskRequest(req)`, modelled on
lib/cron-auth.ts: fails closed with 500 when the var is unset, 401 otherwise.
Both routes are under /api, which app/robots.ts already disallows. Both are
rate limited through `claimRateLimitSlot` at 10 per hour per token, which is
generous for a job that fires once a week and stops a leaked token from being
used to hammer the bundle builder. The token is set in the cloud routine's
environment variables and, for the local path, in the Task Scheduler action's
environment, never in the repository.

### 9.2 GET /api/brief-desk/bundle

Query: none on the normal path; the server decides the period. One
override exists for the hand-written edition and for re-drafting a past
week, accepted only with an admin session in addition to the token
(section 15): `?season=2026&week=1` names an in-season week, and
`?season=2026&period_end=2026-07-16` names the off-season period that
closed on that date. An override never changes what the routine's normal
call sees.

Response when nothing is due:

```
{ "due": false, "reason": "off-season, next edition 2026-10-01", "next_period": {...} }
```

Response when due:

```
{
  "due": true,
  "edition": { "season": "2026", "week": 2, "cadence": "weekly",
               "period_start": iso, "period_end": iso,
               "suggested_slug": "week-2-fantasy-football-news-injuries-2026",
               "suggested_title": "Week 2 Fantasy Football News and Injuries: ..." },
  "context": { "formats": [ { "slug": "dynasty-ppr-sflex", "display": "Dynasty Superflex PPR" },
                            { "slug": "redraft-ppr-std", "display": "Redraft PPR (1QB)" } ],
               "source_slug", "source_display",
               "nfl_state": { season, season_type, week } },
  "instructions": "<bd_brief_instructions text>",
  "relays": [ { id, slug, permalink, kind, headline, facts, timeline, availability,
                source_handle, source_url, source_posted_at, players: [ids],
                teams: [abbrs], follows_relay_id, status } ],
  "players": { "<player_id>": { slug, full_name, position, team,
                 value: { "dynasty-ppr-sflex": { current, change_7d, change_30d, rank_in_format },
                          "redraft-ppr-std":   { current, change_7d, change_30d, rank_in_format } },
                 week_line: { week, opponent, pts_ppr, pts_half_ppr, pts_std,
                              targets, receptions, rush_att, ... },
                 season_to_date: { games, pts_ppr, rank_at_position },
                 next_week: { week, opponent, projected_pts, beat_rate },
                 positional_war_note: string | null } },
  "teams": { "PHI": { name, week_result: { opponent, score, result } | null } },
  "league_wide": { "top_scorers_by_position": {...}, "value_movers": { up: [...], down: [...] },
                   "dvp_notes": [...] },
  "datasets": { "<dataset_id>": { kind, title, columns, rows, source_note, computed_at } },
  "block_kinds": [ { kind, description, accepts: [dataset kinds], interactive } ],
  "section_icons": [ "injury", "trade", "depth-chart", "scoreboard", "waiver", "faq", ... ],
  "example": { slug, draft_payload },
  "previous_editions": [ { slug, title, published_at } ],
  "previous_attempt": { notes, rejected_at, draft_payload } | null
}
```

`datasets` is the block-ready data, computed by `lib/brief-desk/datasets.ts`
from the same reads as the per-player figures: `value_movers_up` and
`value_movers_down` (change_7d on the default source and format), a
`value_movers_by_format` comparison across the two edition formats for the
format toggle, `top_scorers_{position}` for the week, `injury_timeline`
(every Relay with an availability of out, ir, pup or doubtful, with the
stated timeline parsed into an expected return week where the words allow
it, else null and shown as "no timeline given"), `waiver_targets` (free
agents by add rate with a FAAB bid range from lib/faab), and
`week_stat_tiles` (six league-wide numbers for the top of the page). Every
dataset carries its `computed_at` and `source_note`, and the block renders
both.

Every player figure comes through the existing read paths, never a raw
column: values through `player_value_trends` for each of the two edition
formats on the registry's default source (`source_registry.is_default`,
resolved with `resolveSourceForFormat` in lib/source.ts so a source that
does not cover a format falls through the way the site does, and the
bundle names the source actually used per format), the week line through
`player_stats`, the projection through
`lib/projections/read.ts` with the source resolved by
`resolveProjectionSourceForWindow`, and the beat rate through the shared
accuracy read. The raw-column guard test and the source guard test apply to
this file like any other.

The bundle is built by `lib/brief-desk/bundle.ts buildBundle(admin, now)` and
cached in-process for ten minutes keyed on the period, because a retry from
the run should not rebuild it.

Size: a busy in-season week is perhaps 60 Relays and 80 players; the JSON is
under 300 KB. It is one response, never paginated, so the run cannot draft
from half a period.

### 9.3 POST /api/brief-desk/drafts

Body, validated with zod in `lib/brief-desk/draft-schema.ts`:

```
{
  "edition": { "season", "week", "period_start", "period_end" },   // must equal the open period
  "title": string (40..110 chars),            // in season: the fixed pattern
  "slug": string (kebab, must start with the suggested slug's week token in season),
  "title_options": [                           // off-season only: exactly 3
    { "title", "slug", "target_queries": string[], "rationale": string } ],
  "meta_description": string (80..165),
  "tl_dr": string,
  "format_note": string,
  "sections": [ { "id": kebab, "heading": string, "icon": string, "eyebrow": string,
                  "body_md": string, "relay_ids": uuid[], "block_refs": string[],
                  "citations": [ { "url", "claim" } ] } ],
  "blocks": [ { "id", "kind": one of block_kinds, "dataset_id": string,
                "caption": string, "conclusion": string,
                "options": { ... per kind, validated } } ],
  "faq": [ { "question", "answer_md" } ],
  "players": uuid[], "teams": text[],
  "research_log": [ { "claim", "url", "fetched_at", "note" } ],
  "run": { "source": "cloud_routine" | "local_run", "run_id", "model" }
}
```

The validator, `lib/brief-desk/validate-draft.ts`, is pure and tested. It
rejects with a reason the run can act on when:

- the edition does not match the open period;
- any `relay_id` is not in the bundle's set, or any bundle Relay with
  `relevance_tier = 3` is cited nowhere (a tier 3 story left out is a
  question for the owner, so it is a warning that lands in
  `validation_report`, not a rejection);
- any section has no `block_refs` and no `citations`;
- any `block_ref` does not resolve to a block, any block names a `kind` not
  in `block_kinds` or a `dataset_id` not in `datasets`, or a block's
  `options` fail that kind's zod schema (a block carries no rows of its own,
  so there is no free-typed number for the run to invent);
- any section `icon` is not in `section_icons`;
- an off-season draft does not carry exactly three `title_options`, or any
  option's slug is not kebab-case, collides with an existing article or
  Relay slug, or its title is outside the length range; an in-season draft
  that carries `title_options` at all (the pattern is fixed in season);
- an in-season draft is missing any of the required block kinds from
  instruction 8 (a warning in `validation_report` for off-season drafts,
  where the scoreboard blocks do not apply);
- a citation URL was not fetched, judged by absence from `research_log`;
- body text contains a banned character (em dash, en dash, curly quotes,
  ellipsis, emoji) or a banned phrase from a short list mirrored from the
  owner's writing rules;
- word count is outside the cadence's range;
- markdown contains raw HTML or a script.

On success the route inserts the `articles` row with `status = 'in_review'`,
`article_type = 'brief'`, `origin = 'brief_desk'`, `content_md` assembled from
the sections, the `brief_editions` row, the join rows, and the
`beacon_brief_moderation` row of type `brief_review`. It then sends a new
`sendBriefReadyEmail` in lib/beacon-brief/email.ts, built the way
`sendBeaconBriefMatchDigestEmail` is and to the same recipient, with a
"Brief ready for review" subject and the admin link. It returns 201 with the moderation
URL. A second POST for the same period while one is in review returns 409;
after a rejection it is accepted as a new attempt and the previous edition
row is kept with `status = 'rejected'` for the record.

Nothing in this route publishes. Nothing in it pings IndexNow.

`citations` and `research_log` exist so the owner can check the draft and so
the validator can prove a claim was checked. They are stored on
`brief_editions`, shown on the review page, and never rendered anywhere a
reader or a crawler can see.

## 10. The moderation queue

`/admin/brief-desk`, three subpages, following the app/admin/beacon-brief
multi-page pattern with its own `lib/brief-desk-admin-nav.ts` and an entry in
`lib/nav-tree.ts` under the admin section.

### 10.1 Editions

The list: every edition by period, newest first, with status, word count,
Relay count, validation warnings count, and who reviewed it.

The review page for one edition, top to bottom:

1. The validation report: warnings first (uncited tier 3 Relays, a section
   with only one figure), as a list the owner can clear item by item.
2. The research log as a checklist: each row is the claim, the URL, the fetch
   time and the run's note, with a checkbox the owner ticks after reading the
   source. Approval is allowed with unticked rows; the ticks are for the
   owner's own record and are stored in `review_notes`.
3. The draft, rendered with the same components the public page uses, so what
   is approved is what is published. Inline, each Relay citation shows the
   Relay card in a disclosure.
4. Edit: title, meta description, tl;dr and each section's body are editable
   in place through `updateArticleContent`, which already exists at
   app/admin/beacon-brief/actions.ts:181 and writes `article_revisions`. A
   block's caption and conclusion are editable; its data is not. If a
   block's numbers are wrong the fix is in the dataset builder, and the
   edition is rejected with that note.
5. Actions: Approve and publish; Reject with notes (required), with the
   routine's "Run now" link beside it (section 8.5); Archive, for a
   rejected edition the owner wants out of the list.

Approve: sets `articles.status = 'published'`, `published_at`, stamps
`relays.brief_id` for every cited Relay, resolves the moderation row, calls
`revalidateTag("home")`, submits the URL through `submitIndexNow`, and, when
`bd_discord_briefs_enabled` is on, enqueues a `discord_post` for the Brief.

The Brief's Discord post is the one place in this feature that mentions
anyone and the one place that carries a link. Content: "@everyone", a blank
line, the title, the tl;dr, and the page URL. Payload:
`allowed_mentions: { parse: ["everyone"] }`. It goes to the same webhook
the Relays use, the one the Beacon Brief posts to today: the `bb_webhook_id`
setting names a row in `discord_webhooks`, resolved by `activeWebhookUrl`
in lib/beacon-brief/worker.ts, and sent through the same
`postWebhookMessage`. There is no second channel. The `beacon_brief_queue`
job is the existing `discord_post` type with a payload variant
`{ kind: "brief", article_id }`; the worker branches on `kind` and the
existing ingestion-shaped payload stays the default. The webhook's channel must allow
the integration to mention everyone; that is checked on the first routine
edition's post and recorded in section 22. Relays never mention and never
link (section 4.5), so a reader in the channel learns the difference by
shape: a quiet card is news, a ping with a link is the edition.

The approve form carries two controls beside the button. "Post to Discord",
a checkbox, on by default when `bd_discord_briefs_enabled` is on; the week
1 edition is approved with it off (section 14.3). And, for an off-season
edition only, the title picker: a radiogroup of the three `title_options`,
required, whose choice is written to `articles.title`, `articles.slug` and
`brief_editions.title_choice` in the same transaction as the publish.

The byline the page carries (section 11.3) is earned by this step. Approval
means the owner has read the draft and stands behind it as the author; the
review page says so above the button, and there is no bulk approve.

### 10.2 Relays

A list with search, filters by status, kind, week and team. Per row: hide
(reason required), unhide, retract (reason required), edit facts and headline
(writes `updated_at`; the Discord card is patched through `discord_patch`).
The Filtered queue's force push continues to produce a Relay through the same
`writeRelay` path.

### 10.3 Settings

The `brief_desk` category of `beacon_settings`, loaded by
`lib/brief-desk/settings.ts loadBriefDeskSettings(admin)` in the shape of
`loadBeaconBriefSettings` (defaults object, key map, memoised, busted with
`bustMemo("settings:brief_desk")` on save), rendered by the same settings
page component the Beacon Brief settings page uses, with these keys:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| bd_enabled | boolean | true | The bundle endpoint answers "due" at all |
| bd_inseason_cadence | string | weekly | Fixed; shown for clarity |
| bd_offseason_monthly | boolean | false | Off, the off-season runs every two weeks; on, monthly |
| bd_run_weekday | number | 2 | Tuesday, Eastern |
| bd_run_hour_et | number | 9 | The hour the period closes, Eastern |
| bd_min_relays | number | 6 | Off-season only: below this the period rolls into the next one. In season every week is due, however quiet |
| bd_brief_instructions | string | seeded | The editorial brief, section 8.4 |
| bd_relay_extract_prompt | string | seeded | The section appended to bb_categorize_prompt |
| bd_relay_headline_max | number | 220 | Enforced in code and stated in the prompt |
| bd_discord_briefs_enabled | boolean | true | Post an approved Brief to Discord, with an everyone mention and the link |
| bb_article_write_enabled | boolean | false | Legacy article path, off |

The page also shows whether `BRIEF_DESK_TOKEN` is set (a boolean, never the
value), the last bundle request time and the last draft received, both read
from `beacon_brief_logs` rows the two routes write with a new stage
`brief_desk`.

## 11. The Brief reader page, SEO and structured data

### 11.1 Route

`/brief/[slug]` already exists and already branches on article data. It gains
a branch: when `article_type === 'brief'` it renders `BriefEditionPage`
instead of the legacy article layout. One route, one canonical pattern, and
the 308 redirects for retired legacy slugs stay where they are. A listing at
`/brief/editions` shows every published Brief by season and week, indexable,
in the core sitemap.

Slugs are the SEO-friendly form the owner asked for, generated by the server
in the bundle and enforced by the validator:

- in season: `week-{n}-fantasy-football-news-injuries-{season}`, with the
  matching title "Week {n} Fantasy Football News and Injuries ({season})".
  The validator only checks the title's length; the run and the owner decide
  the words after the colon.
- off-season: the run does keyword research and proposes exactly three
  title and slug pairs (`title_options` in the draft), each with the
  queries it targets and one line on why. The owner picks one in the
  moderation queue at approval, and that pick sets `articles.title` and
  `articles.slug`. Until approval the row carries the first option as a
  provisional slug, which is fine because an in-review row has no public
  URL. The research is the run's own web search (Google autocomplete and
  the results page for candidate phrases, recorded in `research_log` with
  kind `keywords`); the Semrush connector can be attached to the routine
  later if volume figures are wanted, and nothing here depends on it. The
  validator requires three options, kebab slugs that do not collide with an
  existing article or Relay, and titles inside the length range.

### 11.2 Layout, and the block library

The page is built the way the guides are built, because the owner's brief is
that an edition should read like the superflex guide, not like a wire
report. `GuideShell` with `GuideToc` from the section ids, `PageMasthead`
with the eyebrow "The Beacon Brief" and chips for the period and the format
note, each section opened by `GuideSectionHeader` with its eyebrow (the
period and the section's place, "Week 2, part 3 of 7"), its icon from the
fixed set and its tone alternating cyan and purple as the guides do,
sections rendered from `content_md` through `ArticleMarkdown` with blocks
inserted at their `block_refs`, an FAQ accordion from the draft's `faq`, a
"Relays covered" list at the end linking each permalink, and the Discord
call to action.

The block library, `components/brief-desk/blocks/`, one file per kind. A
block is a server or client component that takes one dataset from the
bundle plus the draft's caption, conclusion and validated options. It never
takes free numbers. Version one:

| Kind | Renders | Interactive |
| --- | --- | --- |
| stat_tiles | Six league-wide figures for the week as tiles with labels | no |
| value_movers | Horizontal bar chart of change_7d, up and down, through chart-kit, table under a disclosure | no |
| top_scorers | Table per position with the week's line, sortable by column | yes, client |
| box_score_lines | The cited players' week lines as a table | no |
| injury_timeline | A timeline drawn with chart-kit's scale, one marker per player at the expected return week, "no timeline given" rows listed under it | no |
| action_list | Cards for waiver, hold and sell calls, each linking to the tool with the player filled in | no |
| format_toggle | A radiogroup of the two edition formats, Dynasty Superflex PPR and Redraft PPR (1QB); the table below re-reads the chosen column from value_movers_by_format | yes, client |
| return_planner | The reader picks a week range (their playoff weeks); the list shows who in the injury timeline is expected back inside it | yes, client |
| relay_quote | One Relay card inline, for the story a paragraph is about | no |
| callout | A short aside with an icon, for a rule of thumb or a caveat | no |

Every chart is `ChartFigure`: a conclusion sentence, an SVG with
`role="img"` and a summary, and the real table under a disclosure. Every
interactive is a native control (radios, a select, buttons) with a label,
and its content is present at rest for the default choice, so a reader
without JavaScript and a crawler both see the default state. Icons come
from the same set the guides index uses (lucide, through the existing
`Guide.icon` pattern in app/guides/page.tsx), decorative, `aria-hidden`,
with the section heading carrying the meaning.

New kinds are added by code, with their zod options schema and a test, and
appear in the bundle's `block_kinds` automatically. The run cannot add a
kind; it can only place the ones that exist.

The per-kind `options` the validator accepts, version one. Every string the
run writes here (a note, a caption, a conclusion) goes through the same
banned-character and banned-phrase check as body text.

| Kind | Accepts dataset | Options |
| --- | --- | --- |
| stat_tiles | week_stat_tiles | none |
| value_movers | value_movers_up, value_movers_down | direction: up, down or both; limit: 5 to 15 (default 10) |
| top_scorers | top_scorers_{position} | positions: subset of QB, RB, WR, TE, K, DEF (default all six); limit: 5 to 20 |
| box_score_lines | box_score_lines | player_ids: 1 to 12 ids, each present in the bundle's players |
| injury_timeline | injury_timeline | none |
| action_list | waiver_targets | items: 1 to 8 of { player_id (in bundle), action: waiver, hold, sell, start or sit, tool: faab, start-sit or trade-calculator, note: up to 160 characters } |
| format_toggle | value_movers_by_format | default: dynasty-ppr-sflex or redraft-ppr-std (default dynasty) |
| return_planner | injury_timeline | default_weeks: [from, to] within 1 to 18 (default the fantasy playoff window, 15 to 17) |
| relay_quote | none | relay_id: present in the bundle |
| callout | none | icon: one of the section icons; tone: cyan or purple |

The fixed section icon set, `section_icons`, mapped to lucide icons in
code: injury, transaction, contract, depth-chart, coaching, scoreboard,
values, waiver, trade, draft, calendar, faq. A section names one.

The six stat tiles in `week_stat_tiles`, in season: reports this period
(count of Relays), injuries reported (Relays of kind injury), players ruled
out or placed on IR (availability out or ir), transactions (kinds
transaction, contract, suspension), the biggest value riser of the week on
the dynasty format (name and change), and the week's top scorer in PPR
(name and points). Off-season the last two become the biggest faller and
the most-mentioned team. Every tile carries its label and the value as one
text node, per the site's rule against drawing a number twice.

### 11.3 Byline

The owner's decision: editions are written by Michael Walsh, founder of FF
Beacon, and the byline says so, the same as the guides. How the desk gathers
and prepares material is proprietary and is not described anywhere on the
site: not on the edition page, not in the how-it-works guide, not in the
llms files. The approval step is what earns the byline (section 10.1).
Above the fold, as text in reading order:

```
By Michael Walsh, founder of FF Beacon. Published Sep 16, 2026.
Covers Sep 9 to Sep 15, 2026. Values and ranks are {format} on {source}.
```

The name links to /author/michael. The second line is the period and the
format note from the bundle's `context`, nothing else. The review page's
research checklist, the `research_log`, the per-section `citations` and the
`validation_report` are review material for the owner and are never
rendered on the public page, in the RSS feed, in the OG image or in the
Discord post. The only outward attribution anywhere in the feature is the
Relay card's "Original report" line and the Discord "via" line, which credit
the reporter of a single report, as the legacy Discord cards already do.

The SEO audit's C01 moved the legacy articles to an organisation byline
because nobody reviewed them. An edition that a person edits and signs is
the case that audit reserved the personal byline for, so this is consistent
with it.

### 11.4 Structured data

`NewsArticle` for in-season editions and `Article` for off-season ones, with:
`headline`, `datePublished`, `dateModified`, `author` as the Person by
`@id` (the C05 `AUTHOR_ID`, `${SITE.url}/author/michael#person`, with
`name: "Michael Walsh"`, `jobTitle: "Founder"`, `worksFor` the Organization
by `@id`, `url` the author page, and `sameAs` built from `SOCIAL_LINKS` in
lib/site.ts, the FF Beacon Instagram, X, TikTok and YouTube profiles, which
the owner has said are his; the Discord entry is an invite path, not a
profile, and is left out), `publisher` as the Organization by `@id`, `image` with the 16x9,
4x3 and 1x1 variants, `mainEntityOfPage`, `articleSection: "The Beacon
Brief"`, and `about` as the players' `Person` entities by profile URL.
`FAQPage` from the FAQ array, and `BreadcrumbList` Home, The Beacon Brief,
the edition. No `isBasedOn`, no `citation`, no `contributor`: the markup
names the author and the subject, not the sources.

The author page's own Person (app/author/michael/page.tsx) carries the same
`@id`, the full name, the founder title and the same `sameAs` list, so a
search engine resolves the byline on every guide and edition to one entity.
Every other detail about the person (the bio, the image if one exists)
comes from what the author page already renders; nothing is added that is
not already there.

The guides already name Michael as `author` through `SITE.author`; task
BD-T046b brings them onto the same `@id` and `jobTitle`, so every guide and
every edition resolves to one Person entity with the founder role, which is
the trust signal the owner asked for.

### 11.5 Images

`/api/og/brief/[slug]` gains a branch for editions: the edition title, the
period, three headline stats from the figures, brand colours, 1200 by 630.
Two more variants, `?ratio=4x3` and `?ratio=1x1`, at 1200 px wide, because
Google's Article guidance asks for all three and Discover needs 1200 px. Same
route, one query param, one satori layout with three frames. No gold, no
DPC background, per the OG brand rule.

### 11.6 Indexing

`lib/beacon-brief/index-quality.ts isArticleIndexable` gains one clause ahead
of the master switch: an article with `article_type === 'brief'` and
`status === 'published'` is indexable. The master switch continues to govern
legacy articles. The articles sitemap section emits only editions; the
sitemap index includes it whenever at least one edition is published. The
core sitemap adds `/brief/editions`. `submitIndexNow` fires on approval and on
any later revision.

Relays are never in a sitemap and always carry noindex, follow.

### 11.7 Format and source

An edition carries two formats, always the same two: Dynasty Superflex PPR
(`dynasty-ppr-sflex`) and Redraft PPR with one quarterback
(`redraft-ppr-std`). Every value figure in the bundle, every value dataset
and the format toggle block carry both, and the instructions require each
report's consequence to be stated for both worlds where they differ: a
running back's injury is a waiver problem in redraft and a buy window in
dynasty, and a section that only says one of those is not finished. The
page states the two formats and the source once, in the format note chip
and sentence, and the format toggle switches the value tables between them.

The page does not re-resolve per reader: the numbers are dated text, part
of the record, and a reader's global toggle must not rewrite a published
article. This is the one deliberate exception to the sync rule, and it is
the same exception the SEO audit's D02 describes for weekly articles.

## 12. Cadence

`lib/brief-desk/cadence.ts` is pure and clock-free; it takes `nflState`, the
settings and `now`, and returns `{ due, period, reason }`. Tests cover every
branch below.

- In season (`season_type` is `regular` or `post`): weekly. The period is the
  NFL week: it opens at the previous close and closes at `bd_run_hour_et` on
  `bd_run_weekday` (Tuesday 9 AM Eastern by default, after Monday night's game
  has settled and the box scores have synced). The edition is due from the
  close until it is published; a bundle request before the close returns
  `due: false` with the close time.
- Pre-season (`season_type` is `pre`): weekly, same clock, editions titled
  by pre-season week, because camp and cut-down news is dense.
- Off-season (`season_type` is `off`): every two weeks by default, with
  periods closing on the 1st and 16th at 9 AM Eastern. When
  `bd_offseason_monthly` is on, periods close on the 1st only. Flipping the
  toggle mid-period does not reopen a published edition; the next close
  follows the new setting. When the period holds fewer than `bd_min_relays`
  Relays it is not due and rolls into the next period, which then covers
  both. This minimum applies off-season only; an in-season week is always
  due, because a quiet week is still a week a reader searches for.
- `season_type` is the Sleeper string on `getNflState()`: "pre", "regular",
  "post" or "off" (lib/sleeper.ts:609).
- The Sleeper state is read through `getNflState` in lib/sleeper.ts, with the
  calendar fallback from `lib/nfl-season.ts` when Sleeper is unreachable, in
  which case the reason says so and nothing is due; a week must never be
  declared from a guess.

The cloud routine's cron is `0 13 * * 2` (Tuesday 13:00 UTC, which is 9 AM
Eastern in daylight time and 8 AM in standard time; the server's own close
time is what matters, so the hour's drift only changes how long the run
waits, and a run that lands before the close is told to stop). A second
fire, `0 13 1,16 * *`, covers the off-season closes. Both hit the same
endpoint and the server sorts it out. This is two routines or one routine
with two cron expressions, whichever the routine UI supports; the plan
assumes two named routines.

## 13. Cost, before and after

Per week, in season, from the 0186 measurement and the model rates on the
Claude API pricing table read on 2026-09-16 (Haiku 4.5 at $1 per million
input and $5 per million output tokens).

| Line | Today | Proposed |
| --- | --- | --- |
| classify (137 calls, 252k in, now ~30k out) | $0.34 | ~$0.45 |
| follow-up link and merge gate (76 calls) | $0.18 | $0.18 |
| research gate (about 100 calls) | ~$0.05 | $0 |
| research (Haiku, cap 2, per 0186) | ~$5 to $10 | $0 |
| article write (Sonnet 4.6, 101 calls) | $1.29 | $0 |
| revision rewrite | ~$0.20 | $0 |
| Brief drafting | n/a | $0 API (subscription run) |
| X API reads | unchanged | unchanged |

Under one dollar a week in API spend against roughly seven to twelve today,
and roughly forty before 0186. The draft run's cost is the subscription's
usage allowance, which the owner already pays; one run a week of perhaps an
hour is well inside it. The one-time Relay backfill over the archive
(section 14) is about 500 Haiku calls on short posts, under a dollar.

## 14. Legacy articles, the backfill, and the first edition

The owner's decision: every old Brief article becomes a Relay, the articles
are then archived, and the first real edition is the week 1, 2026 Brief,
written by hand rather than by the routine.

### 14.1 The backfill

`scripts/backfill-relays.ts`, one-time, never scheduled, `--dry-run` by
default, idempotent on `relays.ingestion_id`:

- Reads every `news_ingestions` row whose status is `published`, `revised`
  or `dropped_no_context` (the statuses in migrations 0086 and 0101; about
  470 rows in July, more now). `dropped_no_context` is included because it
  meant "not enough for an article", and a Relay needs less than an
  article did. Rows already `filtered`, `deleted` or `error` are skipped.
  The raw post is in `metadata`, so no X reads happen. Every row in the
  archive is from 2026 (the desk launched in July 2026), so one season's
  `season_start_date` from Sleeper is enough; a row from any other year,
  should one appear, gets `week` null and its own `season`.
- Runs the extended classify call (section 4.3) on each, with the same
  gates and the same grounding check (section 4.6). A row that fails
  grounding is written hidden and lands in the queue like a live one.
- Assigns `season` and `week` with `assignRelayWeek` given the post's own
  `source_posted_at`, against Sleeper's `season_start_date` for 2026, so a
  July post is off-season, an August post is pre-season week N, and a
  September post is regular-season week N. The function is pure and takes
  the date, so history and live share one rule.
- Preserves the follow-up chains: an ingestion marked `is_revision` with a
  `revision_of_ingestion_id` becomes a Relay with `follows_relay_id` set to
  that ingestion's Relay.
- Writes the join rows from the existing `article_players` and
  `article_teams` of the article the ingestion produced, when one exists,
  rather than re-matching, because those links were already reviewed.
- Never posts to Discord. It calls `writeRelay` with `discord: false`, it
  never touches `beacon_brief_queue`, and the dry run asserts the queue's
  pending count is unchanged before and after. A post the new gates drop
  simply becomes nothing, which is the point of replaying them: the old
  low-relevance stories do not need to be here.
- Reports counts by status and week, which are recorded in section 22.

Cost: about 500 Haiku calls on short posts, under a dollar. Run with
`--dry-run` first and read the grounding failures before the real run.

### 14.2 Archiving and redirects

After the backfill is checked, `scripts/archive-legacy-articles.ts`
(one-time, `--dry-run` default) sets every `origin = 'beacon_brief'`
article to `status = 'archived'` and records, in a new table
`legacy_article_redirects (article_slug text primary key, relay_slug text
not null, created_at)`, service-role only, the Relay each slug redirects
to: the Relay of the article's earliest ingestion (via
`news_ingestions.article_id`). `app/brief/[slug]/page.tsx` looks the slug
up when no published article matches and issues a permanent redirect to
`/brief/relay/[relay_slug]`. The retired slugs that already redirect
(commit 397fbc6 and migration 0151) keep their existing redirects. Nothing
is deleted; `deleteArticle` and `remove-brief-articles.ts` remain available.

The redirect target is noindex, which is what a thin legacy URL should
resolve to. The player profiles, the homepage block and RSS switch to
Relays in phase 2 before this step runs, so no surface is left pointing at
an archived row.

### 14.3 The week 1, 2026 edition, written by hand

The first edition is not drafted by the routine. It is written in a Claude
Code session with the owner, by the same process the routine will follow:
fetch the week 1 bundle (the cadence function is given the week 1 window
explicitly through an admin-only `?period=` override on the bundle
endpoint, which exists for exactly this and for re-drafting a past week),
check every Relay against a current source, place the blocks, write the
sections, and POST the draft through the same validator into the same
queue. `draft_source` is `manual`. The owner reviews, edits and approves it
like any other, with "Post to Discord" unchecked: by the time it publishes
the week is old news to the channel, and the page exists for search and as
the reference, not as an announcement.

Its purpose beyond being the first indexed page: it is the reference. Its
`draft_payload` is copied to docs/beacon-brief/examples/week-1-2026-brief.json
and the bundle hands it to the routine as `example` (instruction 11 in
section 8.4). The block library is built against it, so every kind in
section 11.2 is exercised by a real edition before the routine ever runs.

Week 1 is already settled when this is built, so the box scores, the value
moves through the week and the injury outcomes are all known, which makes
it a fair test of the validator and a better example than a live week.

## 15. Security review checklist

For the sub-agent review before any task in section 19 is marked complete.

- The two desk routes verify `BRIEF_DESK_TOKEN` with `timingSafeEqual`, fail
  closed when unset, rate limit through `claimRateLimitSlot`, and never accept
  a caller-supplied period, slug or Relay set that the server did not offer.
- The draft body is validated before any write; markdown is rendered through
  `ArticleMarkdown`, which already sanitises; raw HTML in a draft is rejected
  at the validator, not stripped at render.
- Every research log URL is stored as text and rendered as a link with
  `rel="nofollow noopener"`; the URL host is not restricted (the desk must be
  able to cite any outlet) but the scheme must be https.
- Figures carry numbers only from the bundle; the validator refuses free
  numbers, so the run cannot put an invented statistic on the page.
- `brief_editions` is service-role only. `relays` and its joins are public
  select on published rows only. `articles` in review are invisible by the
  existing status policy. pg_policies output is pasted into each migration.
- Approve, reject and hide are server actions behind `requireAdmin`, and
  approval is the only path to `status = 'published'` for a `brief`.
- The desk token is never logged; the `brief_desk` log stage records the
  route, the period and the outcome, not headers.
- Blocks render only bundle datasets; the draft carries no rows, no HTML,
  no SVG and no script, and the block options are zod-validated per kind,
  so the run has no path to put markup or an invented number on a page.
- Relay Discord posts carry no link and no mention (`allowed_mentions`
  empty); the only mention in the feature is the Brief post's everyone
  ping, sent from the approve action behind `requireAdmin`.
- The grounding check (4.6) runs before every Relay write, on the live path,
  the force-push path, the backfill and an admin edit; a Relay that fails
  it is never published and never posted.
- The `?period=` override on the bundle endpoint is accepted only when the
  request also carries an admin session, never on the token alone.
- The cloud routine's environment holds `BRIEF_DESK_TOKEN` and nothing else
  from .env.local. The routine prompt forbids repository writes; the
  repository is read-only to it in practice because it has no push
  credential, and the plan does not grant one.
- The local fallback run (`scripts/brief-desk/draft.ps1`) is allowed WebFetch
  and WebSearch and nothing else. It is not given a shell. The run fetches
  third-party pages for its research log, so untrusted text reaches the same
  context that holds its tools, and a shell would be an unfiltered file read
  and write on a working tree that contains .env.local. The prompt's "never
  write to the repository" is an instruction; the allow list is the control.
- IndexNow is called only from the approve action, so a POST to the drafts
  route cannot cause a crawl.
- `npm audit` runs as part of the review; no new dependency is expected.

## 16. Accessibility checklist

For the sub-agent audit against WCAG 2.2 AA and the CLAUDE.md rules.

- Relay card: `<article>` labelled by its `<h3>`; facts in a `<dl>`; chips are
  text, not colour alone; the source line is text with a real link; the
  permalink link has a name that includes the headline for screen reader
  link lists ("Permalink: {headline}"); nothing visible is aria-hidden.
- Feed: a `<ul>` of cards under an `<h2>`; pagination as today; filters are
  native controls with labels; an `aria-live="polite"` region announces the
  result count after a filter change.
- Brief page: one `<h1>`, section `<h2>`s matching the table of contents,
  `<h3>` inside sections only; every chart block is `ChartFigure` with its
  conclusion sentence, its `role="img"` summary and its disclosure table;
  every interactive block is a native control with a visible label, its
  default state rendered at rest, and its result region `aria-live="polite"`;
  section icons are decorative with the heading carrying the meaning; the
  FAQ is the existing accordion with `aria-expanded`; the byline and the
  period line are ordinary paragraphs in reading order; the "Relays
  covered" list is a `<ul>` of links.
- Moderation page: the research checklist is real checkboxes with labels; the
  approve and reject buttons are buttons; the reject notes field is required
  and its error is associated with `aria-describedby`; focus moves to the
  result message after an action.
- Mobile: no fact, figure, chip or link is hidden at any breakpoint; the
  figure table scrolls inside its disclosure rather than dropping columns.
- Every timestamp goes through lib/datetime.ts.

## 17. Module map and file placement

New files, kebab-case, one component per file:

```
lib/relays/types.ts             RelayRow, RelayFact, RelayKind, the status enum
lib/relays/extract.ts           the `relay` JSON schema fragment and the prompt section text
lib/relays/week.ts              assignRelayWeek (pure)
lib/relays/render.ts            card text, Discord text (pure, tested)
lib/relays/grounding.ts         checkRelayGrounding (pure, tested)
lib/relays/write.ts             writeRelay (the one insert path; grounding first)
lib/relays/load.ts              feed, permalink, player and team reads
lib/relays/legacy-redirect.ts   slug lookup for archived articles
lib/relays/render.test.ts
lib/relays/grounding.test.ts
lib/relays/week.test.ts

lib/brief-desk/types.ts         Bundle, Draft, Edition shapes
lib/brief-desk/cadence.ts       due / period (pure, tested)
lib/brief-desk/cadence.test.ts
lib/brief-desk/bundle.ts        buildBundle
lib/brief-desk/datasets.ts      the block-ready datasets (pure over the reads)
lib/brief-desk/blocks.ts        block kind registry and per-kind option schemas
lib/brief-desk/draft-schema.ts  zod schema for the POST body
lib/brief-desk/validate-draft.ts  the rules in 9.3 (pure, tested)
lib/brief-desk/validate-draft.test.ts
lib/brief-desk/auth.ts          verifyBriefDeskRequest
lib/brief-desk/publish.ts       approve (title choice, Discord flag), reject, archive
lib/brief-desk/settings.ts      the brief_desk settings loader and defaults
lib/brief-desk/slug.ts          suggested slug and title (pure, tested)
lib/brief-desk-admin-nav.ts

app/api/brief-desk/bundle/route.ts
app/api/brief-desk/drafts/route.ts

app/brief/(feed)/page.tsx       becomes the Relay feed with the latest Brief panel
app/brief/relay/[slug]/page.tsx
app/brief/editions/page.tsx
app/brief/[slug]/page.tsx       gains the edition branch
app/brief/relays.xml/route.ts
app/api/og/brief/[slug]/route.tsx  gains the edition branch and ratio param

components/relays/relay-card.tsx
components/relays/relay-feed.tsx
components/relays/relay-chain.tsx
components/brief-desk/edition-page.tsx
components/brief-desk/edition-byline.tsx
components/brief-desk/relays-covered.tsx
components/brief-desk/blocks/stat-tiles.tsx
components/brief-desk/blocks/value-movers.tsx
components/brief-desk/blocks/top-scorers.tsx        client
components/brief-desk/blocks/box-score-lines.tsx
components/brief-desk/blocks/injury-timeline.tsx
components/brief-desk/blocks/action-list.tsx
components/brief-desk/blocks/format-toggle.tsx      client
components/brief-desk/blocks/return-planner.tsx     client
components/brief-desk/blocks/relay-quote.tsx
components/brief-desk/blocks/callout.tsx
components/brief-desk/blocks/render-block.tsx       the switch on kind
docs/beacon-brief/examples/week-1-2026-brief.json   the reference edition
components/admin/brief-desk/editions-manager.tsx
components/admin/brief-desk/edition-review.tsx
components/admin/brief-desk/relays-manager.tsx

app/admin/brief-desk/page.tsx
app/admin/brief-desk/editions/page.tsx
app/admin/brief-desk/editions/[id]/page.tsx
app/admin/brief-desk/relays/page.tsx
app/admin/brief-desk/settings/page.tsx
app/admin/brief-desk/actions.ts

scripts/brief-desk/prompt.md          the bootstrap prompt, shared by both run paths
scripts/brief-desk/draft.ps1          local fallback for Task Scheduler
scripts/backfill-relays.ts            one-time, never scheduled
scripts/archive-legacy-articles.ts    one-time, never scheduled
```

Changed files:

```
lib/beacon-brief/curate.ts            schema extension, writeRelay call, article_write gate
lib/beacon-brief/worker.ts            discord_post reads the Relay
lib/beacon-brief/settings.ts          bb_article_write_enabled
lib/beacon-brief/index-quality.ts     the edition clause
lib/beacon-brief/deletion.ts          retract the Relay
lib/beacon-brief-feed.ts              latest edition read
lib/sitemap/sections.ts               editions only in the articles section; /brief/editions in core
lib/nav-tree.ts                       admin entry
lib/cron-runs.ts                      no new cron (the desk run is not a Vercel cron)
app/page.tsx                          the Brief block
app/brief/rss.xml/route.ts            Briefs only
app/author/michael/page.tsx           Person with the shared @id, full name, founder title
lib/llms/context.ts, lib/llms/llms-full-txt.ts   describe Relays and Briefs as content and name the author; the automated-desk paragraphs come out
```

## 18. Migrations

Numbered from the next free slot at build time (the folder held 291 files on
2026-09-16). Each carries its access matrix in the header and its pg_policies
verification output before the task closes.

1. relays, relay_players, relay_teams, with RLS and indexes.
2. brief_editions with RLS; articles.status CHECK gains in_review and
   rejected; articles.origin CHECK gains brief_desk;
   beacon_brief_moderation.type CHECK gains brief_review and
   brief_correction; beacon_brief_logs.stage CHECK gains brief_desk.
3. brief_desk settings rows (section 10.3), the bb_article_write_enabled row,
   and the append of the RELAY section to bb_categorize_prompt guarded by a
   NOT LIKE marker the way 0202 does it.
4. legacy_article_redirects, service-role only.
5. Types regenerated to lib/database.types.ts after each.

## 19. Task list

Atomic, in build order, for progress.md. Prefix BD. Each ends with the three
sub-agent reviews before it is marked complete.

Phase 1, Relays (the pipeline stops writing articles and starts writing Relays)

- BD-T001 Migration: relays, relay_players, relay_teams with RLS. Verify policies.
- BD-T002 Regenerate types.
- BD-T003 lib/relays/types.ts.
- BD-T004 lib/relays/extract.ts: schema fragment and prompt section text.
- BD-T005 Migration: settings rows and the categorize prompt append.
- BD-T006 lib/relays/week.ts with tests (live and historical dates).
- BD-T007 lib/relays/render.ts with tests: card text, link-free Discord text with the via line, the length rule.
- BD-T007b lib/relays/grounding.ts with tests: numbers, capitalised tokens, content words, the normalisations in 4.6.
- BD-T008 lib/relays/write.ts, grounding first, hidden plus moderation row on failure.
- BD-T009 curate.ts: extend CATEGORIZE_SCHEMA, call writeRelay, gate article_write.
- BD-T010 settings.ts: bb_article_write_enabled, admin settings page ORDER array.
- BD-T011 worker.ts: discord_post reads the Relay through render.ts, sends empty allowed_mentions, ignores category role ids on the relay path.
- BD-T012 deletion.ts: retract the Relay and patch the Discord text.
- BD-T013 Force push produces a Relay through the same write path.
- BD-T014 Run the pipeline for one day with article_write off; read the logs and the grounding failures.

Phase 2, Relay reader

- BD-T015 lib/relays/load.ts.
- BD-T016 components/relays/relay-card.tsx.
- BD-T017 components/relays/relay-feed.tsx.
- BD-T018 app/brief/(feed)/page.tsx becomes the Relay feed (filters preserved).
- BD-T019 app/brief/relay/[slug]/page.tsx with noindex and the 410 path.
- BD-T020 components/relays/relay-chain.tsx.
- BD-T021 app/brief/relays.xml/route.ts; rss.xml switches to Briefs.
- BD-T022 Homepage Brief block reads Relays.
- BD-T023 Player profile news panel reads relay_players.
- BD-T024 scripts/backfill-relays.ts (one-time), discord: false throughout with the queue-count assertion; dry run, read the grounding failures, real run, record counts in section 22.
- BD-T024b Migration: legacy_article_redirects. Verify policies.
- BD-T024c scripts/archive-legacy-articles.ts (one-time), dry run, real run; lib/relays/legacy-redirect.ts and the lookup in app/brief/[slug]/page.tsx.

Phase 3, the desk doors and the edition model

- BD-T025 Migration: brief_editions and the CHECK widenings. Verify policies.
- BD-T026 Regenerate types.
- BD-T027 lib/brief-desk/settings.ts.
- BD-T028 lib/brief-desk/cadence.ts with tests.
- BD-T029 lib/brief-desk/slug.ts with tests.
- BD-T030 lib/brief-desk/bundle.ts (player figures through the shared read paths only).
- BD-T030b lib/brief-desk/datasets.ts with tests (each dataset kind in 9.2).
- BD-T030c lib/brief-desk/blocks.ts: the kind registry and per-kind option schemas, with tests.
- BD-T031 lib/brief-desk/auth.ts; BRIEF_DESK_TOKEN added to .env.local, .env.local.example and the Vercel environment.
- BD-T032 app/api/brief-desk/bundle/route.ts with rate limit, log stage, and the admin-only period override.
- BD-T033 lib/brief-desk/draft-schema.ts.
- BD-T034 lib/brief-desk/validate-draft.ts with tests, including the required block kinds and the icon set.
- BD-T035 app/api/brief-desk/drafts/route.ts (in_review insert, moderation row, sendBriefReadyEmail in lib/beacon-brief/email.ts).
- BD-T036 lib/brief-desk/publish.ts (approve with the title choice and the Discord flag, reject, archive).

Phase 4, moderation

- BD-T037 lib/brief-desk-admin-nav.ts and the nav-tree entry.
- BD-T038 app/admin/brief-desk/page.tsx and editions list.
- BD-T039 Edition review page with the validation report, research checklist, rendered draft, edit, the Post to Discord checkbox, the off-season title picker, and the actions.
- BD-T040 Relays manager page.
- BD-T041 Settings page, including the token-present indicator.

Phase 5, the public Brief page and SEO

- BD-T042 components/brief-desk/edition-page.tsx, edition-byline.tsx and relays-covered.tsx.
- BD-T042b Block library, one task per kind: stat_tiles, value_movers, top_scorers, box_score_lines, injury_timeline, action_list, format_toggle, return_planner, relay_quote, callout, then render-block.tsx. Each with its accessibility audit.
- BD-T043 app/brief/[slug]/page.tsx edition branch with JSON-LD (author Person by @id, jobTitle Founder).
- BD-T044 app/brief/editions/page.tsx.
- BD-T045 OG route edition branch with the three ratios.
- BD-T046 index-quality.ts edition clause and tests; sitemap sections.
- BD-T046b lib/json-ld.ts: AUTHOR_ID, ORG_ID and WEBSITE_ID; the guides, the editions and the author page reference the same Person, name Michael Walsh, jobTitle Founder, sameAs from SOCIAL_LINKS minus the Discord invite (the SEO audit's C05, done here if not already landed).
- BD-T047 llms files updated to describe Relays and Briefs as content and name the author; every sentence describing the automated desk, its sources or its method comes out. The existing legacy-article disclosure line (SEO audit C01 step 1) is removed from the archived articles' render path as part of BD-T024c, since they no longer render.

Phase 6, the first edition and the run

- BD-T048 The week 1, 2026 edition written by hand in a session with the owner through the bundle and drafts doors (section 14.3); reviewed, edited and approved with Post to Discord off; published. Record what the validator flagged in section 22.
- BD-T048b Copy its draft_payload to docs/beacon-brief/examples/week-1-2026-brief.json; the bundle serves it as `example`.
- BD-T049 scripts/brief-desk/prompt.md.
- BD-T049b scripts/brief-desk/draft.ps1 (local fallback), documented in this file.
- BD-T050 Create the two cloud routines (GitHub is already connected) with BRIEF_DESK_TOKEN in the routine environment; run one manually against the week 2 period.
- BD-T051 The first routine-drafted edition reviewed, corrected as needed, published. Record what the validator flagged and what the owner changed in section 22, and compare it to the hand-written one.
- BD-T052 Three editions live; request the AdSense re-review.

## 20. Owner decisions, recorded 2026-09-16

The seven questions the first draft of this plan left open, and the answers
the owner gave the same day. The sections above are written to these.

1. The run is a cloud routine. The owner connects GitHub to the Claude
   account before the build starts. The local script stays as the fallback.
2. Off-season cadence is every two weeks, with a monthly toggle
   (`bd_offseason_monthly`) the owner can turn on and off from the settings
   page.
3. Every old Brief article is turned into a Relay, the articles are archived
   and their slugs redirect to the Relay permalinks (section 14.1, 14.2).
   This is not deferred past the AdSense re-review.
4. The backfill runs before launch, so the hub is full on day one.
5. Relays keep posting to Discord in the new card shape: headline, facts, a
   plain "via @handle" line, no link, no mention.
6. No "what it means" line on a Relay. Rewriting is for Briefs only.
7. Approved Briefs post to Discord with an everyone mention and the link.
   Relays mention nobody.

Six more answers, given later the same day after the plan was reviewed:

8. Author page: `sameAs` is the FF Beacon social profiles from
   `SOCIAL_LINKS`; everything else comes from the existing author page.
9. Discord: Briefs and Relays share the one webhook already in use. No
   second channel.
10. Close times as proposed: Tuesday 9 AM Eastern in season, the 1st and
    16th at 9 AM Eastern off-season.
11. Titles: the in-season pattern as proposed. Off-season, the run
    researches keywords and offers three title and slug pairs, and the
    owner picks one in the moderation queue at approval.
12. Formats: every edition carries Dynasty Superflex PPR and Redraft PPR
    (1QB), and every report's consequence is written for both.
13. Backfill: replay the old posts through the new gates and let the gates
    drop what they drop. No Discord message for any backfilled Relay, and
    none for the hand-written week 1 edition either.

Four further points of feedback, also built in:

- The extraction prompt treats the post as the whole truth and the model's
  memory as nothing (section 4.3), and a code check makes that enforceable
  rather than requested (section 4.6).
- Editions carry the byline "By Michael Walsh, founder of FF Beacon", the
  same as the guides, and one Person entity across the author page, the
  guides and every edition. How material is gathered and prepared is
  proprietary and is described nowhere on the site (section 11.3, 11.4).
- Editions are built like the guides: section headers with icons, charts,
  tables, and interactive blocks from a code-owned library, placed by the
  run and fed only by bundle datasets (section 8.4 item 8, section 11.2).
- The week 1, 2026 edition is written by hand in a session, through the
  same doors and validator, and becomes the reference example the routine
  is told to match (section 14.3).

## 21. Sources read

- Repository at commit 604cc04, files cited inline.
- supabase/migrations/0186_beacon_brief_research_cost.sql (the cost table).
- docs/seo-audit/adsense-review-2026-09-14.md and
  docs/seo-audit/seo-audit-and-plan.md sections 6C and 6D.
- docs/completed/beacon-brief/beacon-brief-relevance-plan.md.
- Google Search Console, sc-domain:ffbeacon.com, ninety days to 2026-09-16.
- developers.google.com/search/docs/essentials/spam-policies, read 2026-09-16.
- developers.google.com/search/docs/fundamentals/creating-helpful-content,
  read 2026-09-16.
- A web search for "week 2 fantasy football injury roundup 2026" on
  2026-09-16, for the competing publishers named in section 2.3.
- The Claude API pricing table and the Claude Code routine tooling, both read
  in the same session, for section 8.1 and section 13.

## 22. Build record

Started 2026-09-16 (build session). Every task is in progress.md under the BD
prefix with its files and verification. Deviations from the specification
above, each deliberate:

- Relay `week` (5.1, 14.1): stored for regular and post season weeks only.
  Pre-season posts carry `week` null; `assignRelayWeek` reports the phase and
  the weeks-to-kickoff count beside it, and the cadence keys periods on
  timestamps. Storing a pre-season week number in the same column as a
  regular-season one would make "week 2" mean two things in one table.
- Retracted permalink (6.3): renders the one-line retracted page with
  noindex, follow and a 200, not a 410. An App Router page cannot set a 410;
  a true 410 would need middleware with a database read per permalink request.
- Native source edits (4.1): the edited post is re-classified and its
  extraction folded into the earlier Relay through `updateRelayText`, which
  re-runs the grounding check against the edited text before the card is
  patched. A card that still showed a figure the reporter had removed was the
  worse outcome.
- Follow-up matching (4.4): the article-side matcher was kept and a Relay-side
  matcher (`lib/relays/duplicates.ts`) runs beside it, so dedupe keeps working
  with the article path off. The merge gate runs at curation time against the
  earlier Relay's headline and facts.
- The Relay feed component (17): `components/beacon-brief/brief-feed.tsx` was
  converted to render Relays rather than adding a parallel `relay-feed.tsx`,
  so the four filter routes share one frame.
- Backfill (14.1): the archive held 1,131 candidate posts, not about 500; the
  relevance gates dropped roughly half in the dry-run sample. Counts from the
  applied run are in progress.md under BD-T024.
- Block placement (11.2): a section's blocks render AFTER its body, in
  `block_refs` order. `body_md` carries no inline marker, so "inserted at
  their block_refs" has no position to insert at within the prose; a run that
  wants a callout mid-argument splits the argument across two sections.
  Adding a marker syntax is a change to the draft contract and to the
  reference edition, and is deferred until the week 1 edition shows it is
  wanted.
- Modules beyond section 17, each with its reason in its header:
  lib/brief-desk/override.ts (the admin-only period override, parsed once),
  period.ts (the period words, one place for the page, the listing and the
  OG card), edition-data.ts and edition-metadata.ts (the public read path and
  the typed `articles.metadata` projection, kept apart from the admin read),
  dataset-read.ts, review-ticks.ts, desk-activity.ts, instructions-seed.ts
  (the seed text the migration is generated from); lib/relays/eastern-time.ts
  (the Eastern wall-clock arithmetic week.ts and cadence.ts share),
  duplicates.ts (the Relay side of dedupe, 4.4), feed-params.ts (one parser
  for the hub and its four filter routes); components/brief-desk/blocks/
  block-shell.tsx and components/brief-desk/section-icons.tsx;
  components/relays/relay-filters.tsx and latest-brief-panel.tsx;
  components/admin/brief-desk-subnav.tsx and brief-desk-page-shell.tsx;
  scripts/gen-brief-desk-settings-sql.ts. Not created:
  components/admin/brief-desk/editions-manager.tsx (the list is inline in
  app/admin/brief-desk/editions/page.tsx) and the lib/beacon-brief-feed.ts
  change (the latest-edition read landed in lib/relays/load.ts beside the
  other Relay reads).
- Schema details beyond sections 5 and 7, all applied: three FK-side indexes
  on relays (category_id, follows_relay_id, brief_id); `on delete set null`
  on those three columns, so archiving a category or an edition never
  cascades into the Relay rows; `relay_ids default '{}'` and `relay_count
  default 0` on brief_editions; migration 0288 adds the tags GIN index, the
  `idx_articles_brief` composite and the explicit anon and authenticated
  revokes on the three Relay tables. The migration headers describe the
  verification in prose rather than pasting pg_policies output; the end
  state was re-queried on production during the reviews.
- Rate limiting (9.1): `claimRateLimitSlot` keys on the caller (IP or
  session), not on the token, and both routes share one bucket of 10 per
  hour. Keying on a hash of the presented token is a change to the shared
  limiter and is left for its own pass. Validation runs before the claim.
- Bundle memo (9.2): the ten-minute key carries the period, the override
  flag, the value source resolved for each edition format and the projection
  engine for the next-week window, per the CLAUDE.md rule that a cache which
  can outlive a source flip carries the source in its key.
  `context.source_display` is null when neither format resolves a source,
  never a placeholder phrase.
- Validator warnings beyond 9.3: a title over 60 characters or a description
  over 155 (what a search result shows), and an FAQ outside three to six
  entries (8.4 item 4). Warnings only; the owner edits all three at approval.
- Feed filters (6.1): the four filter routes (category, team, player, tag)
  carry the kind and week filters as well as the hub, through
  lib/relays/feed-params.ts, so a team's reports can be narrowed to one week
  without editing the address. A `?team=` or `?player=` value on the hub that
  resolves to nothing renders the empty state and says so, rather than the
  whole feed.
- Period wording (11.3): `formatPeriod` prints both boundary dates ("Sep 8 to
  Sep 15"). A period closes at 9 AM Eastern on Tuesday, so the first and the
  last calendar day both carry reports and consecutive editions genuinely
  share a date. The plan's example assumed midnight boundaries.
- The result-count lines on the hub and the admin Relays page are plain
  text with no live region (16). Both filter forms are full page loads, and
  a live region never announces content present in the initial HTML, so the
  attribute would have been inert.
- Left for their own pass, each recorded in docs/beacon-brief/reviews/: the
  hub stays dynamic rather than behind unstable_cache (needs an invalidation
  tag written by every Relay status change); the permalink's ancestor chain
  is walked one query at a time and hydrated separately from the page's own
  Relay (bounded at eight links); post-season box scores are queried on the
  continuing week number while Sleeper sometimes restarts at 1;
  `next_week` is the live Sleeper week with no check that it follows the
  period; `brief_editions` has no partial unique index on the period, so the
  409 is a read-then-write check rather than a database guarantee; the Terms
  page sentence about language-model assistance (reviews/seo.md M1) is the
  owner's decision.

What the validator flagged on the first drafts, what the owner changed, and
how long the review took still go here (BD-T048, BD-T051).
