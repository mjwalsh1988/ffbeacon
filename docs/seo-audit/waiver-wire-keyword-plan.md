# The waiver wire build: research, decisions, and what shipped

Written 2026-09-22. The research is a Google Ads Keyword Planner export of 262
keywords pulled 2026-09-21, cross-read against 90 days of Search Console
(2026-06-24 to 2026-09-21).

This is the record for the pages added under `/waiver-wire`, the platform guide
at `/guides/faab-settings-by-platform`, and the landing page at
`/tools/free-agent-finder`. It supersedes nothing; it fills in section D02 of
`seo-audit-and-plan.md`, which flagged the same gap in July and stayed pending.

---

## 1. Where the site stood before this

Ninety days of Search Console, whole property:

| Page | Impressions | Clicks | Avg position |
| --- | --- | --- | --- |
| /guides/fantasy-football-terms | 2,955 | 3 | 20.3 |
| /tools/faab | 2,227 | 143 | 8.2 |
| /rankings/dynasty-ppr-tep-sflex | 404 | 5 | 9.1 |
| /rankings/dynasty-ppr-sflex | 396 | 6 | 12.0 |
| / | 326 | 156 | 12.8 |

Every query driving `/tools/faab` contains the word "calculator": faab
calculator (911 impressions, position 8.2), faab calculator fantasy football,
faab fantasy football calculator, faab bid calculator, faab estimator, faab
predictor, faab tool, chopped faab calculator, guillotine faab calculator.

**Queries containing the word "waiver" that produced a single impression in
ninety days: zero.**

That is the whole finding. The site had won a modifier and not the noun.

## 2. What the keyword file holds

262 keywords. The piles that matter:

- **The head term.** `waiver wire`, 50,000 a month, low competition. Plus
  `fantasy football waiver wire`, `fantasy waiver wire`, `nfl waiver wire`,
  `fantasy football waiver` at 5,000 each.
- **The weekly family.** `waiver wire week 1` through `waiver wire week 15` at
  roughly 5,000 a month each, plus `fantasy football waiver wire week N`,
  `week N waiver wire`, `week N waiver` and a long tail at 50 to 500. Well past
  60,000 a month combined in season. This is the single largest recurring
  search pattern in fantasy football.
- **The FAAB head terms we were missing.** `faab` (5,000, up 900 percent in
  three months, which is September), `faab fantasy football` (5,000),
  `faab fantasy` (5,000). We rank for the calculator variant and not the noun.
- **Mechanics.** `waiver priority fantasy football` (500), `waiver claim
  fantasy football` (500), `yahoo fantasy football waiver types` (50), `on
  waivers fantasy football` (50).
- **Platform setup.** Ten terms at 50 a month each: yahoo faab settings, faab
  rules, change faab budget, faab minimum bid, auction waivers, weekly waivers,
  waiver priority yahoo, faab espn (twice), faab sleeper. Zero competition, and
  exactly the shape of question an AI assistant gets asked.
- **Recommendation intent.** `waiver wire adds`, `top waiver wire adds`, `best
  waiver wire adds`, `top waiver adds`, `waiver adds`, `must adds fantasy
  football`, `fantasy football adds`, `early waiver wire`, all at 500.
- **Format niches.** `dynasty waiver wire` (500) plus three siblings at 50.
  `idp waiver wire` (500) and `idp waiver` (500).
- **An already-built feature with no URL.** `free agent finder`, 50 a month,
  zero competition. `lib/free-agent-finder.ts` has existed for months behind a
  button inside `/my-beacon/sleeper-leagues`.

Deliberately ignored: NHL, NBA and MLB waiver wire (5,000 each, wrong sport,
no data, would muddy the topic); competitor brand terms (`fantasy footballers
waiver wire` at 5,000, `pff waiver wire`, `the athletic waiver wire`,
`jeff ratcliffe waiver wire`); and planner noise (anything with 2022 in it, the
four `jeff wilson faab` rows, `washington football wire`, `az cardinals wire`).

## 3. The diagnosis

The calculator answers "how much do I bid". Nobody asks that until they have
decided who to bid on, and the "who" question is where all the volume is. The
site was selling the second half of a two-step decision with no page on the
first half.

## 4. What shipped, and why each piece

### `/waiver-wire`, the evergreen hub

Goes after the 50,000-a-month noun and acts as the parent the weekly boards
hang off. Owns the MECHANIC (what a claim is, priority against FAAB, when it
processes, how to read a role change) and deliberately does not overlap
`/guides/faab-strategy`, which owns the bidding. Carries the live board so a
reader arriving on the head term has something to act on today.

### `/waiver-wire/week-N`, one page per week

Targets the weekly family. The URL keeps its season implicit
(`/waiver-wire/week-4`, rewritten each September) rather than dating it: a
dated URL needs eighteen redirects a year and splits whatever authority it
earns across a new set of URLs every season.

Only weeks up to one past the live week exist; anything further is a 404, not
a page of blanks, because Sleeper publishes projections about a week out. The
sitemap lists exactly the publishable set and grows by one a week on its own.

### What makes the boards defensible

Every other waiver page is a columnist's list. Every row here is measured, and
the page says where each number came from:

1. **Availability** from `player_roster_rates` (migration 0292): the share of
   real synced Sleeper leagues that already roster the player, counted from
   rosters rather than published by a platform about itself. 441 leagues in the
   2026 season at time of writing.
2. **Opportunity** from `player_stats`: targets plus carries last week against
   the mean of the weeks before, with snap share beside it. A waiver claim is a
   bet on a role, and a role shows up in touches before it shows up in points.
3. **Projection** through `lib/projections/read.ts`, the same adjusted figure
   every other surface shows, on whichever engine resolves.
4. **Points above replacement**, so a tight end and a receiver can be compared.
5. **A bid range** from `calculateFaabRecommendation`, the calculator's own
   engine, priced for a stated standard league.

### `/guides/faab-settings-by-platform`

One page rather than three, because "how does FAAB work in Yahoo" and "how does
FAAB work in ESPN" are the same question with a different logo on it and three
thin pages would compete for all of it. Explains what each SETTING does rather
than printing click paths, which move every off-season, and links each
platform's own support page for current steps.

### `/tools/free-agent-finder`

A URL for a feature that already existed and had none. The search itself stays
behind the sign-in, because `searchFreeAgent` is deliberately auth-gated and
its own header says the gate is about keeping it a member surface. Opening that
up is a product decision for the owner, not something a landing page should do
quietly; the one change if they want it is in the action.

## 5. Two corrections made during the build

Both worth recording, because both looked right and were not.

**Defenses swept the board.** Ranking every available player against each other
on points above replacement produced a top ten of kickers and team defenses.
The cause is structural rather than a bug: replacement level for a wide
receiver in a twelve-team league is about the 47th best one, which is better
than anything that reaches waivers, so every skill player scores negative; a
defense only has to beat the 12th best defense and the wire is full of
defenses nobody rosters. The comparison was arithmetically honest and useless.
Fixed by grouping the default view by position, which is how a waiver page
should read anyway, and keeping the cross-position score only inside a group.

**A defense had touches.** The usage sentence fired on kickers and team
defenses and produced "0 touches in week 2, in line with his 0.0 average" under
the Detroit Lions: a statistic that cannot exist, a comparison against it, and
a pronoun for a football team. Those two positions now lead on what they
scored, and `lib/waiver-wire/reasons.test.ts` holds the line.

## 6. Measurement

Baseline is clean because it is zero: no query containing "waiver" produced an
impression in the ninety days to 2026-09-21.

Check at 90 days (2026-12-21), filtering Search Console by query contains
"waiver":

- Any non-zero impression count on `waiver wire` and its 5,000-a-month
  siblings.
- Top 20 on `waiver wire week N` for the live week.
- `/tools/faab` cluster moved from position 8.2 toward 3 to 4. That alone would
  roughly triple its 143 clicks without a new page.

## 7. Not done

- **IDP waiver wire** (1,000 a month across two terms). The projection engine
  covers QB, RB, WR, TE, K and DEF only, so an IDP board could not show a
  single projected number or bid range. The one thing that differentiates this
  content is exactly the thing that page could not have. Revisit if IDP
  projections ever land.
- **A per-position availability denominator.** Dynasty leagues frequently do not
  roster kickers or defenses at all, so "rostered in 8 percent of leagues" for a
  kicker is partly "most of our leagues have no kicker slot" rather than "he is
  a hot free agent". Grouping by position hides the effect rather than fixing
  it. The fix is to count each position's denominator from leagues whose
  `roster_positions` include that slot.
- **Sleeper's trending-adds endpoint.** A natural second opportunity signal and
  a new external dependency. Our own roster rates are more defensible and
  already differentiated, so this was left out rather than added on day one.
