# Search growth plan from the 2026-10-15 Search Console review

Status: BUILT. Shipped and deployed 2026-10-15 (GROW-T01 to GROW-T22, commits
6a97a71 to 7dab3af, plus the follow-up ea29982). The Search Console
measurements in section 7 are still to come, on 2026-10-29 and 2026-11-26.
Plan written 2026-10-15. The three owner decisions in
section 1.3 were all answered yes on 2026-10-15, so every task in section 8 is
approved and no task is gated.

Everything in this document is specified to the file and the line, so that an
agent with less context (Opus or Sonnet) can build it by following the steps in
order without re-deriving anything. Where this document says "do not", it
means it.

Companion for the owner: a plain-language page summarizing this plan was
published as an artifact on 2026-10-15 ("Search Growth Plan").

---

## 0. How to use this document (read every line before touching code)

0.1 Work the items in the order given: W1, W2, W3, W4. Each item is split into
atomic tasks (GROW-T01 onward, section 8). Append each task to progress.md in
the house format before starting it, and mark it completed only after the gate
and the three sub-agent reviews in section 9 pass.

0.2 The gate, in order, after every task that touches code:

```
npm run typecheck
npm run lint
npm test
npm run build
```

Lint must finish with zero errors and zero warnings. Run each as its own
shell call. Never chain shell commands with `&&`, `;`, `||` or a pipe
(CLAUDE.md rule 7).

0.3 Punctuation: plain ASCII only, in code, comments, copy, commit messages
and this plan. No em dash, no en dash, no curly quotes, no ellipsis character.
The ESLint plugin fails the run on any of them. Write a banned character as a
JavaScript escape if one is ever genuinely needed.

0.4 Writing: every sentence of user-facing copy follows the "Avoid AI
Writing Patterns" standard in the user's global CLAUDE.md. No "not X, it's Y",
no puffery, no "seamless", no rule-of-three cadence, no trailing participle
clauses. Match the voice of the page you are editing: read 200 lines of it
first.

0.5 Accessibility: every new UI element follows the Accessibility
Requirements section of the project CLAUDE.md. Tables carry a `<caption>`.
Nothing visible is `aria-hidden` except decorative icons. No data is hidden at
any breakpoint (Mobile-First Layout Rule).

0.6 Source and format sync: any new surface showing player values or
projections goes through the resolver chain exactly as the page it sits beside
does. W1 reuses the FAAB page's own resolution; W3 is a documented exception
(no value source prices a defender, stated on the page).

0.7 Git: commit on the current branch, never create a branch, never add any
Claude or Anthropic attribution to a commit message.

0.8 Nothing in this plan adds a link to the home page, the Tools menu, the
all-tools index page, the mobile nav or the footer. Section 2 lists the exact
files that must not be edited. This is the owner's explicit decision
(2026-10-15) and it is final.

0.9 If a step cannot be done as written (a file moved, a function renamed,
a type changed), stop and report the exact mismatch. Do not improvise a
different design.

---

## 1. What Search Console showed, and what this plan does about it

### 1.1 Findings (sc-domain:ffbeacon.com, data through 2026-10-14)

Weekly totals, Monday to Sunday:

| Week | Clicks | Impressions |
| --- | --- | --- |
| Sep 15 to 21 | 113 | 4,173 |
| Sep 22 to 28 | 174 | 6,200 |
| Sep 29 to Oct 5 | 539 | 11,065 |
| Oct 6 to 12 | 327 | 14,831 |
| Oct 13 to 14 (two days) | 219 | 7,811 |

Impressions are climbing fast. Clicks are flat once the Sep 29 outlier is
removed. The two come from different pages for different reasons.

Clicks are one page on one day. In the 28 days to Oct 13, /tools/faab took
978 of 1,294 clicks. The home page took 100 (brand searches). Every other page
combined took about 215.

The FAAB spike is a Tuesday (waiver day) pattern, not a trend. Tuesday clicks
on /tools/faab across the last five waiver days: 54, 70, 343, 157, 138. Sep
29 was driven by guillotine queries (137 clicks from guillotine searches that
day).

Two things underneath that:

- Guillotine and chopped queries are strong and holding: positions 3 to 5,
  click rates 35 to 48 percent. Every one of them lands on the general FAAB
  page, whose title is "FAAB Calculator for Fantasy Football: What to Bid".
  28-day figures: "guillotine faab calculator" 480 impressions, 167 clicks,
  position 4.7; "guillotine league faab calculator" 147 / 61 / 4.3; "chopped
  faab calculator" 109 / 23 / 5.0; "guillotine league bid calculator" 64 /
  22 / 5.0; "chopped league faab calculator" 57 / 22 / 4.2; "guillotine league
  calculator" 43 / 18 / 5.0; "chopped league calculator" 39 / 6 / 4.3;
  "guillotine bid calculator" 36 / 9 / 5.4.
- The generic "faab calculator" is slipping. Tuesday impressions for that one
  query: 399, 534, 486, 302, 166. Position 6.2 on Sep 29, 8.4 on Oct 13.
  Clicks on it fell from 26 to 7 across those two Tuesdays.

The new guides are shown and not clicked. 28-day figures: playoffs guide
3,970 impressions, 11 clicks; glossary 3,585 / 3; FAAB settings by platform
2,239 / 9; weather 2,018 / 23; FAAB strategy 1,672 / 8; IDP guide 1,478 / 11;
chopped strategy 1,329 / 20. All at an average position near 7, where a normal
result earns 3 to 5 percent. Asked which queries produced those impressions,
Search Console attaches a query to under 3 percent of them; the visible ones
are conversational fragments ("how does that even happen?", "what about 3-0",
"but what if it rains", a pasted AI prompt). Inference: these are AI Mode and
AI Overview citations, counted as web impressions with the query withheld. The
reader gets the answer there and never clicks. This plan does not try to
change that; it measures guides on clicks and on tool handoffs instead.

What is growing on its own:

- Player pages, mostly IDP. From about 100 impressions a day at position 50
  in late August to 350 to 880 a day at position 8 to 13 now, with 3 to 15
  clicks a day. Queries are "[name] idp", "[name] stats", "[name] pff".
  Defender profiles already carry height, weight, age and draft slot in
  PlayerBioOverview (components/player-profile/player-bio-overview.tsx), so
  no measurables work is needed.
- The chopped guide: indexed Oct 8, 719 impressions and 14 clicks on Oct 13.
- Season leaders: 434 impressions, 16 clicks, 3.7 percent.
- Weather: 22 clicks on its first weekend (Oct 9 to 10), then almost nothing
  Monday to Thursday. Visible queries: "nfl weather week 5 2026" (12
  impressions, position 9.9), "fantasy football weather week 5" (9, 10.2),
  "nfl weather week 5" (3, 11.7), "nfl fantasy weather" (3, 5.0). Every one
  contains "nfl weather" or "fantasy football weather".

What is declining: the format rankings boards (3 to 6 clicks a day in early
September, 0 to 2 now, positions unchanged, shown less) and the Brief
(effectively zero clicks for two months). Neither is in this plan beyond the
indexing requests the owner has already submitted.

### 1.2 The four work items

- W1: a dedicated guillotine and chopped league calculator page at
  /tools/faab/guillotine, built on the existing chopped mode of the FAAB
  tool, with its own title, heading, copy and FAQ, linked from the pages a
  reader is on when they need it. Target: the eight queries above move from
  positions 3 to 5 to 1 or 2 without the general page losing "faab
  calculator".
- W2: defend the generic "faab calculator" ranking with a server-rendered
  weekly freshness block on /tools/faab and an anchor-text pass on the
  pages that already link to it.
- W3: an IDP rankings page at /rankings/idp, built from data the site already
  computes (lib/ranking-boards/seed.ts loadDefenderRows), linked from the IDP
  guide, every defender profile and the rankings hub. This is the one new
  surface in the plan; it exists because defender profiles are the only
  traffic growing on their own and the site has no page that lists them.
- W4: make the weather page win the queries it is already shown for: put
  "NFL" back in that one page's title and heading (owner decision), link it
  from the waiver wire week pages and the start/sit tool, and give it a true
  lastmod in the sitemap.

### 1.3 Owner decisions, all answered yes on 2026-10-15

These were open questions when the plan was drafted. The owner approved all
three the same day, so the tasks they gate (GROW-T09, GROW-T17, GROW-T19,
GROW-T22) are ordinary tasks and are built in the order section 8 gives.

- D1, approved (W4, GROW-T22): restore the word "NFL" to the weather page's
  `<title>` and h1 only. Commit 8aeab0a removed "NFL" from menu labels, page
  titles and headings across Season Pulse for consistency. Every weather
  query Search Console shows contains "nfl weather", so the title and h1 of
  /season/weather carry it again while the menu, footer, search list and
  breadcrumb labels stay "Game Day Weather".
- D2, approved (W3, GROW-T17): the rankings hub (/rankings) gains one entry
  pointing at the IDP rankings. The hub is a directory of rankings boards,
  which is not the home page, the Tools menu or the all-tools index. The
  entry gives the IDP page a link from the page Google already treats as the
  parent of every rankings board, which is the strongest internal link it can
  have.
- D3, approved (W1 and W3, GROW-T09 and GROW-T19): the site search list in
  lib/site.ts (the array starting near line 220 with `keywords` on each
  entry) gains an entry for each new page so a reader typing "guillotine" or
  "idp rankings" in the site search finds it. This list feeds the search box
  only, not any menu.

---

## 2. Files that must not be edited for this plan

The owner does not want the new pages in the home page, the Tools menu, the
all-tools index page or the footer. The following must not change in any
task of this plan. A diff touching any of them fails review.

- lib/site.ts: `TOOLS_NAV` (line 66 onward) and `FOOTER_COLUMNS` (line 508
  onward). The search catalog array near line 220 is the one exception
  (GROW-T09 and GROW-T19, approved under D3).
- lib/tools-catalog.ts: `ToolHref` and `TOOL_CATALOG`. The new calculator
  page is a variant of the FAAB tool, not a new tool, and must not appear
  here.
- lib/nav-tree.ts: `TOOL_ICONS`, `GAME_ICONS`, `ALL_SECTIONS`.
- components/app-shell/*: the rail, the mobile nav, the rail sections.
- app/page.tsx (the home page) and app/tools/page.tsx (the all-tools index).
- lib/guides/published.ts: do not ADD entries. The new pages are not guides.
  Two existing entries have their `updatedAt` bumped (GROW-T07, GROW-T16)
  because their wording changes; that is the only permitted edit.
- app/tools/faab/page.tsx `META_TITLE` and `META_DESCRIPTION`: unchanged. The
  comment above them explains why (the title is what ranks and a rewrite
  resets a learned snippet). The h1 "Fantasy Football FAAB Calculator" is
  unchanged too.
- app/rankings/(board)/[format]/page.tsx and lib/rankings-formats.ts:
  unchanged. W3 is a separate static route.

---

## 3. W1: the guillotine and chopped league calculator page

### 3.1 Decisions, fixed

- URL: `/tools/faab/guillotine`. Nested under the FAAB tool so the breadcrumb
  reads Tools, FAAB Calculator, Guillotine Calculator, and so the two pages
  are visibly one tool with two front doors.
- `<title>`: `Guillotine League FAAB Calculator: Chopped League Bids`
  (54 characters). Both words that the queries use, guillotine first because
  it carries 3 times the impressions.
- h1 (PageMasthead title): `Guillotine and chopped league FAAB calculator`.
- Meta description: `Free guillotine league FAAB calculator: what to bid this
  week in a chopped, guillotine, death or knockout league, your odds of being
  chopped before and after the claim, and when to keep the money.`
- Canonical: `/tools/faab/guillotine`, self-referencing. The general page's
  canonical stays `/tools/faab`.
- The page opens the calculator with league type already set to "Chopped or
  guillotine" and accepts the same `start`, `alive` and `danger` parameters
  the chopped guide's danger form already sends (app/tools/faab/manual-setup.ts
  parseManualSeed). A `kind` parameter on this URL is ignored: the page is
  always chopped.
- The general page keeps accepting `?kind=chopped`. No redirect is added.
  Old links keep working and nothing is indexed twice because the general
  page's canonical already drops the query string.
- The page must NOT render the general page's `WrittenSections`,
  `MarketStats` or `DynastySection`. Those three blocks are the general
  page's body copy; repeating them is what would make Google collapse the two
  URLs into one. The new page gets its own written sections (3.4), its own
  FAQ, and one small chopped-only market table.

### 3.2 GROW-T01: extract the FAAB page's data loading into one shared function

File to create: `app/tools/faab/calculator-data.ts`.

Move, without changing behavior, everything in `app/tools/faab/page.tsx`
from `const supabase = await createClient();` down to and including the block
that appends defenders to `players` and the `mastheadChips` computation, into:

```ts
export type FaabCalculatorData = {
  settings: FaabSettings;
  players: FaabPlayer[];
  format: FormatRow | null;          // whatever type allFormats.find returns today
  formatSlug: string;
  requestedSourceSlug: string;
  reconciled: ReturnType<typeof reconcileFormatWithSource>;
  fallbackBanner: { requested: string | null; actual: string } | null;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
  valueSourceIsBeacon: boolean;
  handleGate: HandleGateState;
  urlViewer: SleeperViewer | null;
  isMember: boolean;
  marketFacts: MarketFacts | null;
  mastheadChips: MastheadChip[];
};

export async function loadFaabCalculatorData(params: {
  format?: string;
  source?: string;
  username?: string | string[];
}): Promise<FaabCalculatorData>
```

Rules for the move:

- Copy the code, do not rewrite it. The two `Promise.all` blocks, the
  reconcile step, the resolver calls, the cached player list read and the
  defender append stay exactly as they are, including their comments.
- `seasonOptions()` stays in page.tsx (it is presentation).
- page.tsx then calls `const data = await loadFaabCalculatorData(params)` and
  reads every field it used before from `data`. The rendered output of
  /tools/faab must be byte-for-byte what it was. Verify by running the dev
  server, saving the HTML of /tools/faab before and after the change (two
  `curl -s http://localhost:3000/tools/faab > file` calls) and diffing them;
  the only acceptable differences are React hydration ids and nonces.
- Type imports: `FaabSettings` and `MarketFacts` from where page.tsx already
  gets them; `HandleGateState` and `SleeperViewer` from
  `@/lib/sleeper-handle/types`; `MastheadChip` from
  `@/components/app-shell/page-masthead`.

Gate, then commit: `refactor(faab): move the calculator's data loading into
one function`.

### 3.3 GROW-T02: move the chopped market read out of the guide

File to create: `lib/faab/chopped-market.ts`.

In `app/guides/chopped-league-strategy/page.tsx`, lines 252 to 281 define
`type ChoppedMarket`, `BAND_LABELS` and `async function loadChoppedMarket()`.
Move all three into the new module and export them. Also move `readCell` and
`newestBuiltAt` if they are defined in the guide file and used only by this
loader; if they are imported from a lib module already, leave them where they
are. The guide imports `loadChoppedMarket` and `type ChoppedMarket` from the
new module. No behavior change.

Add `lib/faab/chopped-market.test.ts` with one test: given a fake cells array
holding the four keys in `BAND_LABELS` plus the overall key, the loader's
pure parts (expose a pure `buildChoppedMarket(cells, minSamples)` that the
async loader calls) return three bands in order and an `overall` read. If
`readCell` is already covered by an existing test, the new test may be
smaller, but it must exist.

Gate, then commit: `refactor(faab): share the chopped market read`.

### 3.4 GROW-T03: the page

File to create: `app/tools/faab/guillotine/page.tsx`.

Skeleton (fill in, do not deviate from the structure):

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { FormatFallbackBanner } from "@/components/format-fallback-banner";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { FaabForm } from "../faab-form";
import { parseManualSeed } from "../manual-setup";
import { loadFaabCalculatorData } from "../calculator-data";
import { loadChoppedMarket } from "@/lib/faab/chopped-market";
import { GuillotineWrittenSections } from "./written-sections";
import { ChoppedMarketTable } from "./chopped-market-table";

const META_TITLE = "Guillotine League FAAB Calculator: Chopped League Bids";
const META_DESCRIPTION = "..." // exactly the text in 3.1

export const metadata: Metadata = {
  alternates: { canonical: "/tools/faab/guillotine" },
  title: META_TITLE,
  description: META_DESCRIPTION,
  ...pageShareMetadata({
    key: "faab-guillotine",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: "/tools/faab/guillotine",
  }),
};

export const dynamic = "force-dynamic";
```

The default export awaits `searchParams` (same shape as the general page),
then:

- `const seed = parseManualSeed({ ...params, kind: "chopped" });` The spread
  first and `kind` last, so the URL can never set a different league type.
- `const [data, choppedMarket] = await Promise.all([loadFaabCalculatorData(params), loadChoppedMarket()]);`
- `seasonOptions()`: import it from page.tsx by exporting it there, or move
  it to `app/tools/faab/season-options.ts` and import it in both pages. Moving
  is preferred; it is a one-function file.
- Render, in this order inside `<main id="main">`:
  1. the WebApplication JSON-LD script, `webApplicationJsonLd({ name: META_TITLE, description: META_DESCRIPTION, url: "/tools/faab/guillotine", category: "SportsApplication" })`.
  2. `<PageBody width="tool">` containing `FormatFallbackBanner`, the same
     fallback `role="status"` paragraph the general page renders, then
     `<FaabForm ... seed={seed} />` with the masthead prop set to a
     `PageMasthead` whose `eyebrow` is `Tools`, `title` is the h1 in 3.1,
     `description` is `Every claim priced against your odds of being chopped
     this week. Tell it how many teams started, how many are left and where
     you stand, or connect your Sleeper chopped league.`, `chips` are
     `data.mastheadChips`, and whose actions are the same `MemberHeroCta`
     the general page uses plus a secondary link to `/guides/chopped-league-strategy`
     labeled `Chopped league strategy` (replacing the general page's
     Player Rankings link).
  3. A short paragraph under the form: `Not in a chopped league? The ` +
     link to `/tools/faab` with anchor text `FAAB calculator` + ` prices
     redraft and dynasty claims.` This is the reverse link; it stops the two
     pages from being orphans of each other.
  4. `<GuillotineWrittenSections />` (3.5).
  5. `<ChoppedMarketTable market={choppedMarket} />` (3.6).
  6. `<DiscordCtaSection ... />` with chopped-specific copy: eyebrow `One bad
     week and you are out`, heading `Not sure the bid is enough? Ask before
     the chop.`, body in the same register as the general page's, `isMember`
     from `data.isMember`.

Every value, projection or rank shown comes through `data`, which already
went through the resolver chain, so the Source and Format Sync rule is met
by construction. Do not add any new read of rankings or values to this page.

### 3.5 GROW-T04: the written sections

File to create: `app/tools/faab/guillotine/written-sections.tsx`, a server
component exporting `GuillotineWrittenSections`.

Use the same primitives the general page's `written-sections.tsx` uses
(open that file and copy its imports and section shell: it uses
`ToolExplainer` with steps, notes, FAQ and tiles). Content is new prose, 500
to 900 words, with these headings in this order. Do not copy sentences from
`app/tools/faab/written-sections.tsx` or from the chopped guide; a reviewer
will grep for any 8-word run shared with either file.

1. `How a chopped league changes what a claim is worth`. Three short
   paragraphs: there is no opponent, only the bottom of the table; the
   player who keeps you off the bottom this week is worth more than his
   season; the pool refills every week as chopped rosters are released, so
   next week's wire is deeper than this week's.
2. `What this calculator reads`. A list: how many teams started and how many
   are left (`start` and `alive`); where you stand this week (`danger`, four
   answers); your platform, because platforms differ (point to the table);
   your remaining budget and the league's full budget. Say that the danger
   answer is the biggest single input and that end to end it is about twice
   the money for the same player, which is what the chopped guide's ladder
   figure shows (link to `/guides/chopped-league-strategy#how-much-heading`
   with anchor `how much to bid in a chopped league`).
3. `Platform differences that change a bid`. One sentence introducing the
   table in 3.6 part two, built from `CHOPPED_PLATFORMS` in
   `app/tools/faab/manual-setup.ts`: Sleeper Chopped (minimum bid 0, rosters
   released all season), Yahoo Death League (0, all season), ESPN Knockout
   (0, all season), FFPC Chop Classic (minimum bid 1, releases stop after week
   14), Fantasy Life Guillotine (0, releases stop after week 14). Render the
   table from the constant, never by hand, so a change to the constant
   changes the page.
4. FAQ, six questions, rendered through the same FAQ component and
   `faqPageJsonLd` the general page uses:
   - How much FAAB should I spend in a guillotine league? (answer: by danger
     rank; cite the four-step ladder; link to the guide)
   - Is a chopped league the same as a guillotine league? (yes in play;
     Sleeper's name since 2025-08; Yahoo calls it a death league; the
     calculator treats them alike and asks for the platform because the
     rules differ)
   - When do chopped players hit waivers? (after the week's chop, released
     to the pool; FFPC and Fantasy Life stop releasing after week 14)
   - Should I save FAAB for the end? (fewer teams means fewer bidders but
     every roster left is strong; the pace line on the result says whether
     you are ahead of or behind a sensible hold)
   - Can I connect my Sleeper chopped league? (yes; the calculator reads the
     league and works out the odds of being chopped with and without the
     player)
   - Does this work for a 10-team league? (yes; the field size and teams
     left are the inputs, and 10, 12, 16 and 18 are all common)

### 3.6 GROW-T05: the chopped market table

File to create: `app/tools/faab/guillotine/chopped-market-table.tsx`.

A server component taking `{ market: ChoppedMarket }` and rendering ONE
`<table>` with a `<caption>` reading `What chopped leagues actually pay for a
claim, as a share of the full budget`, one row per band in `market.bands`
(label, median, 25th and 75th percentile, sample size) plus an `Overall` row
from `market.overall`, and a footnote with `market.updatedAt` formatted
through `formatEastern` from `lib/datetime.ts`. A band whose read is null
renders the words `Not enough leagues yet`, never a zero. Below it, a second
small table from `CHOPPED_PLATFORMS` as described in 3.5 part 3 (platform,
minimum bid, rosters released until). Both tables keep every column at phone
width using the stacked-cell pattern the general page's `MarketTable` uses
(read `app/tools/faab/market-stats.tsx` `MarketTable` and copy its responsive
classes).

### 3.7 GROW-T06: share card, breadcrumb, sitemap

- `app/api/og/page/[key]/route.tsx`: add a `PAGE_CARDS` entry keyed
  `"faab-guillotine"`. Follow the copy rules in that file's header comment.
  Suggested: eyebrow `Guillotine and chopped league FAAB calculator`,
  headlineTop `Bid enough to`, headlineBottom `survive the week`, subhead
  `Priced against your odds of being chopped, how many teams are left, and
  what chopped leagues have actually been paying.`, facts
  `["Free", "No signup", "Sleeper, Yahoo, ESPN, FFPC"]`, path
  `/tools/faab/guillotine`, badge `Chopped FAAB`.
- `lib/breadcrumbs.ts` `ROUTE_LABELS`: add `"/tools/faab/guillotine": "Guillotine Calculator"`.
  Add a case to `lib/breadcrumbs.test.ts` asserting the trail for that path
  is Tools, FAAB Calculator, Guillotine Calculator (check how the existing
  tests assert a trail and copy that shape).
- `lib/sitemap/sections.ts` `STATIC_PATHS`: add
  `{ path: "/tools/faab/guillotine", priority: 0.6 }` directly after the
  `/tools/faab` line. No lastModified (rule 2 in that file's header).
- `lib/sitemap/sections.test.ts`: add a test that the core section's static
  paths include `/tools/faab/guillotine` (there is no direct test of
  STATIC_PATHS today; export a `staticSitemapPaths()` helper that returns the
  paths, test that, and have `coreSection` use it, so the test and the file
  cannot drift).
- `lib/llms/llms-full-txt.ts`: in the paragraph that describes the FAAB
  calculator, add one sentence naming `/tools/faab/guillotine` as the
  chopped and guillotine front door.

### 3.8 GROW-T07: the inbound links

Each is a small edit. Anchor text is part of the specification; use it as
written.

1. `app/tools/faab/page.tsx`: directly after the `<FaabForm ... />` element
   and before the existing "Curious what these bids are actually built from?"
   paragraph, add a paragraph in the same classes:
   `Playing in a chopped or guillotine league? The ` + Link to
   `/tools/faab/guillotine` with text `guillotine FAAB calculator` + ` prices
   every claim against your odds of being chopped this week.`
2. `app/tools/faab/faab-form.tsx`: inside the `{isChopped && (...)}` block
   that renders "Your chopped league, this week", add one line at its top:
   a `<p>` with `This mode has its own page: ` + Link to
   `/tools/faab/guillotine` with text `the guillotine FAAB calculator` +
   `, with chopped-league notes and what chopped leagues actually pay.` Only
   render it when the current path is not already `/tools/faab/guillotine`
   (pass a boolean prop `onGuillotinePage` from each page; default false).
3. `app/guides/chopped-league-strategy/page.tsx`:
   - `DangerCheck` form: `action="/tools/faab"` becomes
     `action="/tools/faab/guillotine"`. Remove the hidden `kind` input; the
     page sets it.
   - The link whose text is `chopped FAAB calculator` (near line 1490):
     href becomes `/tools/faab/guillotine`, text becomes
     `guillotine FAAB calculator`.
   - `<TryIt href="/tools/faab" label="Price a chopped claim">` (near line
     1562): href becomes `/tools/faab/guillotine`.
   - In `ClosingSection` (near line 1751) the link text `FAAB calculator`
     becomes `guillotine FAAB calculator` with href `/tools/faab/guillotine`,
     and the `TryIt` after it (near 1775) points there too.
   - `memberCtaHref="/tools/faab"` (near line 388) becomes
     `/tools/faab/guillotine`.
   - Update the DangerCheck paragraph that says "the calculator opens on its
     chopped mode" to "the guillotine calculator opens" (the mode is now the
     page).
4. `app/guides/faab-strategy/page.tsx`: in the lesson titled `Chopped and
   guillotine leagues` (the LESSONS entry near line 570 names its anchor),
   add one sentence with a link to `/tools/faab/guillotine`, anchor text
   `guillotine FAAB calculator`. The guide's other links to `/tools/faab`
   stay as they are.
5. `lib/guides/published.ts`: bump `updatedAt` on `chopped-league-strategy`
   and `faab-strategy` to the deploy date with a one-line comment saying the
   calculator links moved to the guillotine page. The rule in that file:
   the date moves only when wording changes, and here it does.

### 3.9 GROW-T08: tests for the page's own logic

Create `app/tools/faab/manual-setup.test.ts` (none exists) with:

- `parseManualSeed({ kind: "redraft", start: "12", alive: "9", danger: "near" })`
  returns leagueType `redraft`; the same call with `kind: "chopped"` spread
  last returns `chopped`. This pins the behavior the guillotine page relies
  on.
- `parseManualSeed({ start: "12", alive: "14" })` returns aliveCount null
  (the existing rule: alive above start is dropped).
- `biddersFor("auto", 0.5, { aliveFraction: 0.6 })` returns `"4p"`.

### 3.10 GROW-T09: site search entry (approved, D3)

In `lib/site.ts`, in the search catalog
array (the one whose entries carry `keywords`, near line 220), add after the
FAAB Calculator entry:

```ts
{
  label: "Guillotine FAAB Calculator",
  href: "/tools/faab/guillotine",
  description: "What to bid in a chopped or guillotine league",
  keywords: ["guillotine", "chopped", "chop", "death league", "knockout", "survive"],
},
```

Do not touch `TOOLS_NAV` or `FOOTER_COLUMNS` in the same file.

### 3.11 Acceptance for W1

- `curl -s https://ffbeacon.com/tools/faab/guillotine` (after deploy)
  contains the exact `<title>`, the canonical link, one h1 with the text in
  3.1, and the WebApplication JSON-LD.
- The general page's HTML still contains its original title, description and
  h1 (grep them).
- The chopped guide's danger form submits to the new page and the form opens
  with the three answers filled in and league type set to chopped.
- `/tools/faab?kind=chopped` still opens the general page in chopped mode.
- Lighthouse accessibility on the new page scores 100, and the three
  sub-agent reviews pass (section 9).
- The owner then requests indexing for `/tools/faab/guillotine` in Search
  Console. The daily request cap on this property has been about 4.

---

## 4. W2: defend the generic "faab calculator" ranking

### 4.1 GROW-T10: the weekly freshness block on /tools/faab

File to create: `app/tools/faab/this-week.tsx`, an async server component
`ThisWeekWire` with props `{ format, sourceSlug, sourceName, settings }`
taken from `FaabCalculatorData` (the format row, `requestedSourceSlug`
resolved through the same resolution the waiver pages use; read
`lib/waiver-wire/context.ts resolveWaiverContext` to see how the waiver week
page gets `context.format`, `context.sourceSlug`, `context.sourceName` and
`context.settings`, and reuse that function rather than re-deriving).

Behavior:

- Resolve the live week with `resolveSeasonClock` (lib/start-sit/clock.ts).
  If `season` is null or `currentWeek` is outside 1 to 18, render nothing.
- Call `loadWaiverBoardCached({ week: currentWeek, format, sourceSlug, sourceName, settings })`
  (lib/waiver-wire/load.ts). If `board.emptyReason` is non-null or
  `board.rows.length < 3`, render nothing. Never render an empty panel.
- Render a `<section aria-labelledby=...>` with an h2
  `Week ${week} waiver wire: the five claims most worth pricing`, a one-line
  intro naming the board's `assumptions.formatName` and `sourceName` (display
  names, never slugs), then an ordered list of the top five `board.rows` by
  the board's own order (it is already sorted by `score`). Each item: player
  name linking to `/players/${row.slug}`, position and team, the bid range
  from `row.bid` (read `BoardBid` in lib/waiver-wire/types.ts for the field
  names and render the same figures the waiver page renders, using its
  formatting helper if one is exported), and `row.reason`.
- Close with a link to `/waiver-wire/week-${week}` with anchor text
  `the full week ${week} waiver wire`.
- Every number is one text node with missing words appended `sr-only`
  inside the same element (the Lineups rule in CLAUDE.md), no `aria-hidden`
  on anything but icons.

Placement in `app/tools/faab/page.tsx`: directly after the paragraph added
in GROW-T07 item 1 and before `<WrittenSections />`, wrapped in
`<Suspense fallback={null}>` so a slow board read cannot delay the
calculator. The component is server-rendered on first paint, which is what
gives Google a page that changes every Tuesday.

Why this and not a title change: the title is the one thing on the page
Google has already learned, and the comment above `META_TITLE` says to
leave it alone. Fresh, week-stamped content on the page is the signal we can
add without touching it.

### 4.2 GROW-T11: anchor-text pass

Change the visible text of these links so that at least one link on each
page says `FAAB calculator`. Keep classes and hrefs.

- `app/waiver-wire/[week]/page.tsx`, the masthead action link near line 424
  whose text is `Price a bid for your league`: text becomes `FAAB calculator:
  price a bid for your league`.
- `app/waiver-wire/[week]/page.tsx`, the "Before you put the claim in" list
  near line 572: `title: "Price it for your roster"` becomes
  `title: "FAAB calculator"` and the body sentence keeps its meaning.
- `app/guides/faab-strategy/page.tsx`: of the plain links near lines 504, 681
  and 1010, at least two must read `FAAB calculator`. Read each sentence and
  pick the two where the phrase fits grammatically.
- `app/guides/faab-settings-by-platform/page.tsx` near line 763: ensure the
  link text is `FAAB calculator`.
- `app/guides/fantasy-football-playoffs/page.tsx` near line 896: ensure the
  link text is `FAAB calculator`.
- `lib/guides/fantasy-football-terms.ts` line 602: the FAAB entry's link
  label `Set a bid with the FAAB Calculator` stays (it already carries the
  phrase).
- `app/waiver-wire/page.tsx` already has a link whose text is `FAAB
  calculator` (near line 546). No change.

Bump `updatedAt` in lib/guides/published.ts for any guide whose visible text
changed in this task (faab-strategy may already be bumped by GROW-T07; do not
bump twice in one deploy, one date is enough).

### 4.3 Monitoring, no code

Record in section 7 each Tuesday for six weeks: the query "faab calculator"
impressions, clicks and position for that day, from
`get_advanced_search_analytics` filtered to the query. Baseline Tuesdays:
Sep 29 (486 impressions, 26 clicks, 6.2), Oct 6 (302, 17, 6.9), Oct 13 (166,
7, 8.4).

---

## 5. W3: the IDP rankings page

### 5.1 Decisions, fixed

- URL: `/rankings/idp`. A static route at `app/rankings/idp/page.tsx` takes
  precedence over the `(board)/[format]` dynamic segment in Next.js, so no
  change to the board route is needed.
- `<title>`: `IDP Rankings for Fantasy Football: DL, LB and DB` (48
  characters). h1: `IDP fantasy football rankings`.
- Meta description: `Rest-of-season IDP rankings for every defensive lineman,
  linebacker and defensive back, projected under Sleeper's default IDP scoring,
  with last season's finish and snap share, and a game log for every player.`
- Scoring: Sleeper's default IDP scoring, `IDP_PRESETS.idp123` in
  `lib/idp/scoring-presets.ts`. One scoring, one URL. A scoring switcher is
  deliberately out of scope for this plan (it would be four URLs or a client
  toggle, and the page should earn its first ranking before it grows).
- No value source prices a defender (CLAUDE.md, IDP section). The page says so
  in its method panel and shows no value column. This is a stated exception
  to the Source and Format Sync rule, not an oversight: there is no source or
  format to sync to.
- The page is NOT gated by `league_power_pulse_settings.settings.idp.enabled`.
  That switch governs League Pulse. Defender profiles, the IDP guide and the
  Beacon Ranker defender seed are not gated by it, and this page sits with
  them. `lib/ranking-boards/seed.ts` reads `loadPowerPulseSettings` only to
  resolve the projection engine, not the IDP switch; confirm that when you
  export `loadDefenderRows`.
- A defender is never scored from `pts_ppr`, `pts_half_ppr`, `pts_std` or
  `pts_idp`. The new module lives under `lib/idp/`, so
  `lib/idp/points-guard.test.ts` will fail the suite if it names one of
  those columns. Score through `scoreIdpLine` or read figures already scored
  under idp123 (`player_positional_finishes.scoring = 'idp123'`).

### 5.2 GROW-T12: the data module

In `lib/ranking-boards/seed.ts`, change `async function loadDefenderRows` to
`export async function loadDefenderRows` and export the `DefenderRow` and
`DefenderRows` types. Nothing else in that file changes.

File to create: `lib/idp/rankings.ts`.

```ts
import type { IdpPosition } from "@/lib/site";

export const IDP_RANKINGS_PER_POSITION = 60;

export type IdpRankingRow = {
  playerId: string;
  slug: string;
  name: string;
  position: IdpPosition;
  team: string | null;
  overallRank: number;      // 1-based across all three positions, in list order
  positionRank: number;     // 1-based within position
  /** Projected rest-of-season points under idp123, or null. */
  projectedRos: number | null;
  /** Last season's regular-season idp123 points, or null. */
  lastSeasonPoints: number | null;
  /** Last season's finish at his position under idp123, and the field size. */
  lastSeasonFinish: { finish: number; of: number } | null;
  /** Last season's average defensive snap share, 0 to 100, or null. */
  avgSnapPct: number | null;
  /** Which figure placed him: the projection or last season's points. */
  basis: "projected" | "last_season";
};

export type IdpRankings = {
  season: number | null;
  currentWeek: number;
  lastSeason: number;
  /** One sentence for the page: which figure ordered the list. */
  basisText: string;
  /** Display name of the projection engine that produced projectedRos. */
  projectionSourceDisplay: string;
  byPosition: Record<IdpPosition, IdpRankingRow[]>;
  rows: IdpRankingRow[];
};

export async function loadIdpRankings(): Promise<IdpRankings>;
export function loadIdpRankingsCached(): Promise<IdpRankings>;
```

Implementation rules:

- Ordering per position is exactly `loadDefenderSeed`'s: projected rows by
  `projected` descending, then rows with no projection by `lastSeasonPoints`
  descending, never interleaved. Reuse the same comparator; do not invent a
  blend. `basisText` is built the same way `loadDefenderSeed` builds it (copy
  the four-branch text).
- Take the first `IDP_RANKINGS_PER_POSITION` per position. `overallRank` is
  assigned after concatenating DL, LB, DB in that order.
- Finish: read `player_positional_finishes` with
  `.eq("scoring", "idp123").eq("season", lastSeason)` selecting
  `player_id, finish, total_points, players_ranked`, PAGED with
  `fetchAllRows` (lib/supabase/fetch-all.ts), filtered in memory to the
  player ids in the list. Never pass hundreds of ids to `.in()` (URL length
  failure documented in lib/sitemap/sections.ts).
- Snap share: read `player_idp_seasons` with
  `.eq("season", lastSeason).eq("season_type", "regular")` selecting
  `player_id, avg_def_snap_pct`, paged the same way, filtered in memory.
- Projection engine display name: resolve the same way `seed.ts
  resolveDefenderSeedKey` does and pass the slug through
  `projectionSourceDisplay` from `lib/projections/source-constants.ts`.
- Cache: mirror how `loadDefenderRows` is cached around line 286 to 300 of
  seed.ts (same helper, key `idp:rankings`, same six-hour TTL, same key
  parts: season, current week, projection source). The source must be in the
  key (Projection Engine Source rule in CLAUDE.md).

Tests, `lib/idp/rankings.test.ts`: a pure `rankDefenders(rows, perPosition)`
function (exported, used by the loader) given six fake rows (two per
position, one projected and one not) returns position ranks 1 and 2 with the
projected row first, overall ranks 1 to 6 in DL, LB, DB order, and respects
`perPosition = 1` by dropping the second row of each position. The test must
not touch the database.

### 5.3 GROW-T13: the page

File to create: `app/rankings/idp/page.tsx`. Pattern it on
`app/season/leaders/page.tsx` (masthead, PageColumns, Panel, FaqAccordion,
JSON-LD array), not on the format board route.

- `export const revalidate = 3600;` No cookies are read, so the page can be
  cached. Use `createCachedReadClient` for any direct read; the data module
  already picks its own client.
- Metadata: `title: { absolute: ... }`, `description`, `alternates.canonical:
  "/rankings/idp"`, `robots` as the weather page sets them, and
  `pageShareMetadata({ key: "rankings-idp", ... })`.
- Masthead: eyebrow `Rankings`, title as in 5.1, chips: season, `Week N`,
  `Sleeper default IDP scoring`, and `Projected by {projectionSourceDisplay}`
  (the resolved engine name, never a hardcoded word). Description: the
  `basisText` from the data.
- Body, in order:
  1. Panel `How this board is built`: idp123 in one sentence listing its main
     weights read from `IDP_PRESETS.idp123` (solo tackle, assist, tackle for
     loss, sack, interception, pass defended, forced fumble, defensive
     touchdown; print the numbers from the constant, do not type them),
     the sentence `No value source prices a defender, so there is no trade
     value column here; the board is projected points and last season's
     record.`, and a link to `/guides/idp-fantasy-football` with anchor text
     `the IDP guide`.
  2. Three Panels, one per position, in DL, LB, DB order, each with an `id`
     (`defensive-linemen`, `linebackers`, `defensive-backs`), an h2 from
     `positionNoun(position)` pluralised (use the existing noun helper; check
     `positionNounMap` in lib/site.ts for a plural form before writing one),
     and a `<table>` with `<caption>` reading `{Plural noun}, ranked by
     projected rest-of-season IDP points` and columns: Rank, Player (link to
     `/players/${slug}`), Team, Projected (one decimal, or the words `No
     projection`), Last season (`{points} pts, {POS}{finish} of {of}` or the
     words `No record`), Snap share (`{n}%` or `No snaps`). Mobile layout:
     every column stays present as stacked cells (read
     `components/rankings/rankings-view.tsx` for the house stacked-cell
     classes and copy them). Numbers use `tabular-nums`.
  3. FAQ Panel with `FaqAccordion` and `faqPageJsonLd`, five questions:
     what is IDP in fantasy football; what scoring are these rankings in;
     how often do they update (projections daily, finishes nightly); why is
     there no dynasty or trade value column; where do I see a player's game
     log (every name links to his profile, which has one).
  4. A SectionNav rail (as the weather page has) listing the three position
     sections and the FAQ.
- JSON-LD: WebPage, FAQPage, BreadcrumbList (Home, Rankings, IDP Rankings),
  built as the weather page builds its array.

### 5.4 GROW-T14: route plumbing

- `lib/rankings-format-redirect.ts`: add `"/rankings/idp"` to
  `NON_BOARD_RANKINGS_PATHS`, and add a test to
  `lib/rankings-format-redirect.test.ts` that `/rankings/idp?format=x` is not
  redirected to `/rankings/x` (copy the shape of the existing community test).
- `lib/breadcrumbs.ts` `ROUTE_LABELS`: add `"/rankings/idp": "IDP Rankings"`
  and a `lib/breadcrumbs.test.ts` case.
- `lib/sitemap/sections.ts` `coreSection`: after the per-format rankings
  loop, push `{ loc: `${SITE.url}/rankings/idp`, priority: 0.8 }`. No
  lastModified (projections refresh daily and the rule is true or absent).
  Add a sitemap test that the core section lists `/rankings/idp` (use the
  `staticSitemapPaths()` helper if the path is added there instead; either
  placement is acceptable as long as it is tested).
- `app/api/og/page/[key]/route.tsx`: add `PAGE_CARDS["rankings-idp"]`.
  Suggested: eyebrow `IDP fantasy football rankings`, headlineTop `Every
  defender ranked,`, headlineBottom `rest of season`, subhead `Defensive
  linemen, linebackers and defensive backs by projected points under
  Sleeper's default IDP scoring, with last season's finish and snap share.`,
  facts `["DL, LB and DB", "Updated daily", "Free"]`, path `/rankings/idp`,
  badge `IDP Rankings`.
- `lib/llms/llms-full-txt.ts`: one sentence in the rankings paragraph naming
  `/rankings/idp`.

### 5.5 GROW-T15: the defender profile rank line

File to create: `components/player-profile/idp-rank-line.tsx`, an async
server component `IdpRankLine` with props `{ playerId: string; position: string }`.

- Calls `loadIdpRankingsCached()`, finds the row by `playerId`.
- Found: renders `<p>` with `Ranked {positionRank} of {byPosition[pos].length}
  {plural noun} in our ` + Link to `/rankings/idp#{section id}` with text
  `IDP rankings` + `, {basis sentence}` where the basis sentence is `by
  projected points for the rest of the season` or `by last season's points`.
- Not found: renders `<p>` with `He is outside the top {IDP_RANKINGS_PER_POSITION}
  {plural noun} in our ` + the same link + `.`
- Wrap the call in try/catch; on error render nothing. A profile must never
  fail because the rankings read did.

Mount it in `components/player-profile/defender-tabs.tsx` on the overview
tab, directly above `<PlayerBioOverview player={player} />` (line 181), inside
`<Suspense fallback={null}>`. Defender pages only; the component is never
imported by the offensive tabs.

### 5.6 GROW-T16: the IDP guide links

In `app/guides/idp-fantasy-football/page.tsx`:

- In the lesson with `id="season-heading"` (`Managing IDP in season`), after
  the sentence that links the example linebacker's page, add: `Our ` + Link
  to `/rankings/idp` (class `LINK`) with text `IDP rankings` + ` list every
  defensive lineman, linebacker and defensive back by projected points for
  the rest of the season, with last season's finish beside each name.`
- In the draft lesson, after `Box safeties usually outscore free safeties and
  cornerbacks.`, add: `The ` + the same link with text `IDP rankings` + ` show
  who holds those roles today.`
- `lib/guides/published.ts`: bump `updatedAt` on `idp-fantasy-football` with
  a one-line comment.

### 5.7 GROW-T17: rankings hub entry (approved, D2)

In `app/rankings/page.tsx`, after the list of format boards, add one entry
in the same visual shape as the format entries: label `IDP rankings`, hint
`Defensive linemen, linebackers and defensive backs, projected rest of
season`, href `/rankings/idp`. It must not take the reader's format or source
params (it has none). Read the hub's own header comment first: the page
redirects a reader with a saved format straight to their board, and the
`?view=formats` path shows the directory to everyone. The new entry belongs
in the directory render only; do not touch the redirect.

### 5.8 GROW-T18: the FAAB manual list cross-link (small)

In `app/tools/faab/faab-form.tsx`, where the player combobox marks a
defender as `not ranked` (search for `unranked` in the result or combobox
rendering), add a short note visible only when the selected player is a
defender: `No value source prices a defender. See where he sits in our ` +
Link to `/rankings/idp` with text `IDP rankings` + `.` If the selected-player
result already carries a defender note, append the link to that note rather
than adding a second paragraph.

### 5.9 GROW-T19: site search entry (approved, D3)

In the lib/site.ts search catalog, after the `Fantasy Leaders` entry:

```ts
{
  label: "IDP Rankings",
  href: "/rankings/idp",
  description: "Every defender ranked for the rest of the season",
  keywords: ["idp", "defender", "defenders", "linebacker", "defensive back", "defensive line", "dl", "lb", "db", "tackles", "sacks"],
},
```

### 5.10 Acceptance for W3

- The page renders with three tables, every row linking to a profile that
  exists (spot check ten).
- `npm run verify:idp-invariant` still prints "identical" for every league
  (the plan touches no League Pulse loader, but the check is cheap and the
  CLAUDE.md IDP section asks for it after any IDP change).
- `lib/idp/points-guard.test.ts` passes with the new module in place.
- Lighthouse accessibility 100; three sub-agent reviews pass.
- The owner requests indexing for `/rankings/idp`.

---

## 6. W4: the weather page

### 6.1 What already exists (do not rebuild)

`app/season/weather/page.tsx` already has: a week-stamped `<title>` via
`titleFor(week, season)`, a week-stamped h1, a per-game anchor
(`#game-{key}`) and h3 for every game, a summary list, a FAQ with FAQPage
JSON-LD, a stadium roof table, and NWS plus MET Norway attribution. Forecasts
are refreshed by `/api/cron/sync-nfl-weather` daily at 13:45 UTC and three
more times on game days (vercel.json). The NWS window is seven days, so a
Sunday game has a forecast from the Monday before. None of that changes.

### 6.2 GROW-T20: inbound links

- `app/waiver-wire/[week]/page.tsx`, the "Before you put the claim in" list
  (near line 572, three items today): add a fourth item
  `{ href: "/season/weather", title: "Check the weather", body: "Wind above
  15 miles per hour is the one forecast that moves a lineup. Every game's
  kickoff forecast, worst first.", icon: CloudRain }`. Import `CloudRain`
  from lucide-react alongside the existing icons. The grid is
  `sm:grid-cols-3 xl:grid-cols-1`; change it to `sm:grid-cols-2
  xl:grid-cols-1` so four items sit two by two at tablet width and do not
  leave one orphaned.
- `app/tools/who-should-i-start/page.tsx`: near the existing `/rankings` link
  (line 504), add a sentence in the same paragraph style: `Before you lock in
  a kicker or a quarterback, check ` + Link to `/season/weather` with text
  `this week's game day weather` + `.` Read the surrounding 40 lines first
  and place it where a reader has just seen a result.
- `app/tools/faab/this-week.tsx` (from GROW-T10): no weather link. Keep that
  block about bids.

### 6.3 GROW-T21: a true lastmod for the weather page

In `lib/sitemap/sections.ts` `coreSection`, add to the opening `Promise.all`
a read of the newest forecast:

```ts
supabase
  .from("nfl_game_weather")
  .select("fetched_at")
  .order("fetched_at", { ascending: false })
  .limit(1),
```

and change the `/season/weather` push to
`{ loc: ..., lastModified: newest([newestWeather?.[0]?.fetched_at]), priority: 0.8 }`.
This satisfies rule 2 of that file: the page changes exactly when a forecast
is re-read, and `fetched_at` is when that happened. Add a test alongside the
existing sitemap tests that, given a fake client returning a `fetched_at`,
the weather URL carries that date and the other Season Pulse URLs carry none.

### 6.4 GROW-T22: put NFL back in the title and heading (approved, D1)

In `app/season/weather/page.tsx`:

- `titleFor` returns
  `NFL Weather, Week ${week} ${season}: Forecast for Every Game and Fantasy Impact`
  when a week is known, and
  `NFL Weather This Week: Forecast for Every Game and Fantasy Impact`
  otherwise. (Front-loaded; Google shows about 60 characters and the first
  three words are the query.)
- The masthead `title` becomes `NFL game day weather, week ${week}` and
  `NFL game day weather this week`.
- The `keywords` array already carries the nfl weather phrases; add
  `fantasy football weather week ${week}` to the week-dependent part.
- Nothing else: menu label, footer label, breadcrumb label, search list entry
  and the OG card stay "Game Day Weather", per commit 8aeab0a.

### 6.5 Acceptance for W4

- The waiver week pages and the start/sit page render the new links at phone
  width without overflow.
- `curl -s https://ffbeacon.com/sitemaps/core.xml` shows a `<lastmod>` on
  the weather URL and none on `/season/leaders`.
- The live `<title>` begins `NFL Weather, Week`, and the menu, footer and
  breadcrumb labels still read `Game Day Weather`.

---

## 7. Measurement

Record the following from Search Console (`get_advanced_search_analytics`,
sc-domain:ffbeacon.com) on 2026-10-29 (two weeks) and 2026-11-26 (six
weeks). Add the rows to this section; do not keep them elsewhere.

Baseline, 28 days to 2026-10-13:

| Target | Metric | Baseline |
| --- | --- | --- |
| /tools/faab/guillotine | clicks, impressions, position | page does not exist |
| guillotine faab calculator (query) | clicks, impressions, position | 167, 480, 4.7 |
| guillotine league faab calculator | same | 61, 147, 4.3 |
| chopped faab calculator | same | 23, 109, 5.0 |
| faab calculator (query), Tuesday only | same | Oct 13: 7, 166, 8.4 |
| /tools/faab | clicks, impressions, position | 978, 9,387, 6.7 |
| /rankings/idp | clicks, impressions, position | page does not exist |
| idp rankings (query) | same | not in the top 150 queries |
| /players/* containing idp queries | clicks per day | 3 to 15 |
| /season/weather | clicks, impressions | 23, 2,018 |
| nfl weather week N (query, that week) | position | 9.9 to 11.7 |

Success at six weeks: the three guillotine queries at position 1 to 2 with
the new URL as the landing page; the generic "faab calculator" Tuesday
position back under 7; /rankings/idp indexed and appearing for at least one
query containing "idp rankings"; weather week-query position under 8.

Also watch for the one failure mode W1 can produce: if Search Console shows
`/tools/faab/guillotine` with a "Duplicate, Google chose different
canonical" status in URL inspection, the two pages read as one. The fix is
more distinct written content on the new page (3.5), never a change to the
general page.

---

## 8. Task list, in the progress.md format

Append these to progress.md as they are started. IDs are GROW-T01 to
GROW-T22. Status values: pending, in_progress, blocked, completed.

```
GROW-T01 | pending | Extract /tools/faab data loading into app/tools/faab/calculator-data.ts, no behavior change
     | files: app/tools/faab/calculator-data.ts, app/tools/faab/page.tsx
     | depends on: none
     | verified: no

GROW-T02 | pending | Move the chopped market read into lib/faab/chopped-market.ts with a test
     | files: lib/faab/chopped-market.ts, lib/faab/chopped-market.test.ts, app/guides/chopped-league-strategy/page.tsx
     | depends on: none
     | verified: no

GROW-T03 | pending | Create /tools/faab/guillotine page (metadata, masthead, form seeded chopped, reverse link)
     | files: app/tools/faab/guillotine/page.tsx, app/tools/faab/season-options.ts, app/tools/faab/page.tsx
     | depends on: GROW-T01, GROW-T02
     | verified: no

GROW-T04 | pending | Guillotine page written sections and FAQ
     | files: app/tools/faab/guillotine/written-sections.tsx
     | depends on: GROW-T03
     | verified: no

GROW-T05 | pending | Guillotine page chopped market table and platform table
     | files: app/tools/faab/guillotine/chopped-market-table.tsx
     | depends on: GROW-T02, GROW-T03
     | verified: no

GROW-T06 | pending | Guillotine page share card, breadcrumb label, sitemap entry, llms text, with tests
     | files: app/api/og/page/[key]/route.tsx, lib/breadcrumbs.ts, lib/breadcrumbs.test.ts, lib/sitemap/sections.ts, lib/sitemap/sections.test.ts, lib/llms/llms-full-txt.ts
     | depends on: GROW-T03
     | verified: no

GROW-T07 | pending | Inbound links to the guillotine page from the FAAB tool, the form, the chopped guide and the FAAB guide; bump guide dates
     | files: app/tools/faab/page.tsx, app/tools/faab/faab-form.tsx, app/guides/chopped-league-strategy/page.tsx, app/guides/faab-strategy/page.tsx, lib/guides/published.ts
     | depends on: GROW-T03
     | verified: no

GROW-T08 | pending | Tests for parseManualSeed and biddersFor
     | files: app/tools/faab/manual-setup.test.ts
     | depends on: none
     | verified: no

GROW-T09 | pending | Site search entry for the guillotine page (approved D3)
     | files: lib/site.ts
     | depends on: GROW-T03
     | verified: no

GROW-T10 | pending | Week-stamped "this week's wire" block on /tools/faab, server rendered, under Suspense
     | files: app/tools/faab/this-week.tsx, app/tools/faab/page.tsx
     | depends on: GROW-T01
     | verified: no

GROW-T11 | pending | Anchor-text pass: "FAAB calculator" on waiver week pages and four guides; bump guide dates once
     | files: app/waiver-wire/[week]/page.tsx, app/guides/faab-strategy/page.tsx, app/guides/faab-settings-by-platform/page.tsx, app/guides/fantasy-football-playoffs/page.tsx, lib/guides/published.ts
     | depends on: none
     | verified: no

GROW-T12 | pending | lib/idp/rankings.ts data module on exported loadDefenderRows, with pure rankDefenders test
     | files: lib/ranking-boards/seed.ts, lib/idp/rankings.ts, lib/idp/rankings.test.ts
     | depends on: none
     | verified: no

GROW-T13 | pending | /rankings/idp page: metadata, masthead, method panel, three tables, FAQ, JSON-LD
     | files: app/rankings/idp/page.tsx
     | depends on: GROW-T12
     | verified: no

GROW-T14 | pending | IDP route plumbing: redirect exclusion, breadcrumb, sitemap, share card, llms text, with tests
     | files: lib/rankings-format-redirect.ts, lib/rankings-format-redirect.test.ts, lib/breadcrumbs.ts, lib/breadcrumbs.test.ts, lib/sitemap/sections.ts, lib/sitemap/sections.test.ts, app/api/og/page/[key]/route.tsx, lib/llms/llms-full-txt.ts
     | depends on: GROW-T13
     | verified: no

GROW-T15 | pending | IdpRankLine on every defender profile overview
     | files: components/player-profile/idp-rank-line.tsx, components/player-profile/defender-tabs.tsx
     | depends on: GROW-T12, GROW-T13
     | verified: no

GROW-T16 | pending | IDP guide links to the rankings; bump guide date
     | files: app/guides/idp-fantasy-football/page.tsx, lib/guides/published.ts
     | depends on: GROW-T13
     | verified: no

GROW-T17 | pending | Rankings hub entry for IDP rankings (approved D2)
     | files: app/rankings/page.tsx
     | depends on: GROW-T13
     | verified: no

GROW-T18 | pending | FAAB manual mode: defender note links to IDP rankings
     | files: app/tools/faab/faab-form.tsx
     | depends on: GROW-T13
     | verified: no

GROW-T19 | pending | Site search entry for IDP rankings (approved D3)
     | files: lib/site.ts
     | depends on: GROW-T13
     | verified: no

GROW-T20 | pending | Weather links from waiver week pages and the start/sit tool
     | files: app/waiver-wire/[week]/page.tsx, app/tools/who-should-i-start/page.tsx
     | depends on: none
     | verified: no

GROW-T21 | pending | True lastmod on /season/weather from nfl_game_weather.fetched_at, with test
     | files: lib/sitemap/sections.ts, lib/sitemap/sections.test.ts
     | depends on: none
     | verified: no

GROW-T22 | pending | "NFL" back in the weather page title and h1 only (approved D1)
     | files: app/season/weather/page.tsx
     | depends on: none
     | verified: no
```

Order of work: T01, T02, T08, T03, T04, T05, T06, T07, T09, deploy and
request indexing for /tools/faab/guillotine; T10, T11, deploy; T12, T13, T14,
T15, T16, T17, T18, T19, deploy and request indexing for /rankings/idp; T20,
T21, T22, deploy.

---

## 9. Review gates (every task)

After each task, before marking it completed, dispatch the three sub-agents
the project CLAUDE.md requires. Spawn them WITHOUT a `name` parameter
(the user's global rule), keep the returned ids, and let the completion
notifications deliver the reports.

1. Implementation review. Checks: the task matches this document to the
   file and the text; no file in section 2 changed; format and source
   propagation where values are shown (W1 through the shared loader, W3
   stated as the no-source exception); projection engine named through
   `projectionSourceDisplay` (W3); every table has a caption; punctuation is
   ASCII; `updatedAt` bumped where guide wording changed and nowhere else.
2. Accessibility review against WCAG 2.2 AA and the CLAUDE.md list: heading
   order (one h1), captions, link text that makes sense out of context (the
   anchor texts in this plan do), no data hidden at any breakpoint, 44 by 44
   CSS px tap targets, nothing visible `aria-hidden` except icons, the
   stacked-cell mobile tables keep every column.
3. Security review. The new pages add no write paths. Checks: URL parameters
   on `/tools/faab/guillotine` go through `parseManualSeed` only (strict
   parse, unexpected values dropped); no `dangerouslySetInnerHTML` except the
   JSON-LD scripts through `serializeJsonLd`; no new Supabase reads outside
   the paged helpers; no secret in client code; `npm audit` unchanged.

If any reviewer finds an issue, fix it, re-run the gate, and only then mark
the task completed.

---

## 10. Notes for whoever maintains this later

- The reason W1 is a nested route and not a new tool: the owner does not want
  a second calculator in the menus, and a reader who lands on it is already in
  the FAAB tool. The breadcrumb says so.
- The reason the guides are not getting more work: Search Console shows them
  cited in AI answers at scale (thousands of impressions, no clicks, queries
  withheld). More guide prose would raise impressions and not clicks. Pages
  that act (a calculator, a ranked table) are what get clicked on this site.
- The reason the IDP rankings page is the only new surface: defender profiles
  are the one thing growing without a Tuesday, the data to rank them is
  already computed for the Beacon Ranker's seed, and the site had no page
  that lists them.
- Writing check: this plan was reread against the AI-writing pattern list in
  the user's global CLAUDE.md before it was saved. One rule-of-three list in
  section 1.2 was rewritten as four items and one "not X, Y" sentence in
  section 4.1 was rewritten as a plain statement.
