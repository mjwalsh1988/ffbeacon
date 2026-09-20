# Chopped, guillotine and death league guide: SEO plan and build spec

Status: APPROVED PLAN, NOT BUILT. Written 2026-09-19.
Companion to `docs/faab/faab-calculator-overhaul-plan.md` (read its section 0 first: the same fresh-session protocol applies, including DO NOT COMMIT, DO NOT PUSH, DO NOT CREATE A BRANCH).

Task prefix in `progress.md`: `FB-G`.

---

## 1. Decision

Build BOTH:

1. A new guide at `/guides/chopped-league-strategy` that owns strategy and "what is" intent for chopped, guillotine, death and knockout leagues, including how to bid FAAB in them.
2. A new section inside the existing `/guides/faab-strategy` that covers FAAB in chopped and guillotine leagues in 150 to 300 words and links to the new guide. The FAAB guide keeps its current targets and does NOT add chopped or guillotine to its title, H1, meta description or keywords list.
3. The calculator `/tools/faab` owns "chopped faab calculator" and "guillotine faab calculator", and only once its chopped mode ships (overhaul plan 7.12).

Why not only a section in the FAAB guide (the owner's first instinct): the combined elimination-format search demand is bigger than the FAAB-strategy terms, and the searches are mostly about the whole format (what it is, how to draft, how to survive), not only about FAAB. A section inside a FAAB guide cannot rank for "guillotine league strategy" or "chopped league strategy" against dedicated pages. Why not only a new guide: people also search "chopped faab" and "guillotine faab" from inside the FAAB topic, and the FAAB guide already has the authority and links on FAAB. The split below keeps the three pages from competing.

Confidence: moderate on direction, low on absolute volumes (free tools give buckets only, see 2.1).

---

## 2. Research

### 2.1 Search volume (Ahrefs free keyword generator, US, pulled 2026-09-19)

- "guillotine league": over 1,000 a month, difficulty Easy.
- Over 100 a month each, Easy: guillotine league strategy, yahoo guillotine league, guillotine league rankings, what is a guillotine league, guillotine league rules, and (inferred from sort order) guillotine league fantasy football, guillotine league faab values, guillotine league draft strategy, guillotine league waiver strategy, guillotine league faab strategy, fantasy guillotine league.
- Every "chopped league" term (chopped league, chopped league strategy, chopped league faab strategy, how much to bid in chopped league, sleeper chopped league): under 100 with difficulty N/A and no update date. Read as stale data for a 2025 term, not as the real number (see Trends).
- Ahrefs blocked the "faab" seed behind a human check; Ubersuggest needed a sign-up. No Semrush data was available in the session.

### 2.2 Google Trends (US, web search, weekly, pulled 2026-09-19)

- "faab" peaks every September in waiver week 1 (99, 90, 93, 100 for 2023 to 2026).
- "guillotine league" peaks late August to early September: 41 (2023), 36 (2024), 40 (2025), 26 (2026) on the same scale as "faab".
- "chopped league" first appears January 2025, 5 in August 2025, 13 in the week of 2026-09-13.
- Head to head since June 2025: at the 2025 peak guillotine 100 against chopped 13; in the week of 2026-09-13 guillotine 51 against chopped 33. Chopped is up about 2.5 times in a year; guillotine's 2026 peak is about 37% below 2025. Combined interest looks roughly flat, with Sleeper's name taking share.
- Rising queries around "guillotine league" include "chopped league" and "sleeper chopped league" (both Breakout). Rising around "faab strategy": "guillotine league strategy" (+140%) and "guillotine faab strategy" (+100%).
- On one scale with "guillotine league" at 100: "how much to faab" max 21, "guillotine league strategy" 10, "faab strategy" 7, "faab calculator" 6.
- "death league" is unusable on Trends: its related queries are Saudi Pro League and Al Nassr (soccer).
- Seasonality: elimination-format interest climbs mid to late July, peaks at draft season (last week of August, first week of September), holds 10 to 25% of peak through October and November, near zero January to June. FAAB queries peak in waiver week 1 and hold up better into October.

### 2.3 Our own Search Console (2026-08-22 to 2026-09-19)

- "chopped faab calculator" 19 impressions at position 8.6 and "guillotine faab calculator" 5, both on `/tools/faab`.
- `/guides/faab-strategy` indexed, zero impressions in 90 days.

### 2.4 Terminology

- Chopped league: Sleeper's name, launched 2025-08-14. Sleeper's help page never says "guillotine".
- Guillotine league: the older generic name (Fantasy Life, FantasyPros, Draft Sharks, RotoWire). Some sites style "Guillotine Leagues" with a trademark symbol (guillotineleagues.com, Fantasy Life). Always write the lowercase generic "guillotine league" and never the stylized brand.
- Death league: Yahoo's 2026 name ("Fantasy Death Leagues"); Yahoo called it Guillotine Leagues in 2025 with Liquid Death. Real but Yahoo-specific and new.
- Knockout league: ESPN's name, launched 2026-07-07.
- Chop league / Chop Classic: MFL and FFPC.
- Eliminator: NFFC.
- Elimination league: generic, not a separate format.
- Survivor league: mostly NFL pick'em survivor pools (including Sleeper's own "Football Survivor"). Do not target it.

### 2.5 Search results (signed-in Chrome, US, 2026-09-19, may be personalised)

- "chopped league strategy": Fantasy Footballers (Fantasy 101, format plus draft plus FAAB), Fantasy Points (draft only), Reddit threads, chopfantasyfootball.com (bid tool), a Facebook answers page, Fantasy Life (draft), Draft Sharks, YouTube pack, RotoWire. Sleeper does not rank.
- "guillotine league strategy": Draft Sharks, Reddit, FantasyPros, Ben Gretch's Substack (two years old), Fantasy Points, YouTube, Fantasy Life, guillotineleagues.com, DataForce. Almost all draft-focused.
- "chopped league faab": chopfantasyfootball.com, Reddit, Fantasy Life (week 2 advice), Fantasy Footballers, RotoWire, Masters (month-by-month plan), Sleeper Support, Facebook, Fantasy Life tool, videos.
- "guillotine league faab": Fantasy Life tool, Reddit r/GuillotineLeagues, guillotineleagues.com, RotoWire weekly, Draft Sharks, Fantasy Life weekly, Masters, Fantasy Index (2023), Facebook.
- "chopped faab calculator": Football Absurdity, Fantasy Life tool, faablab.app, Reddit, Dynasty Daddy, RotoWire, chopfantasyfootball.com, then ffbeacon.com about 8th. Fantasy Life's result shows "Missing: calculator".
- What the pages miss: measured bid data across leagues, the whole-roster release math, the FFPC week 15 lock and other release cutoffs, and one table mapping names across platforms. Reddit, Facebook and YouTube take three to five slots on every query, a sign the written content is thin.

### 2.6 People Also Ask and related searches

PAA:
- How much FAAB should I spend in a guillotine league?
- How much FAAB should I spend?
- What is the best strategy for drafting in a chopped league?
- What is a chopped Sleeper league?
- Can Sleeper do a guillotine league?
- What is the best strategy for winning a guillotine league?
- Who are the best players for a guillotine league?
- How many teams should be in a guillotine league?

Related:
- chopped league faab reddit
- chopped league faab ppr
- chopped faab
- guillotine league faab week 8
- free chopped faab calculator
- best chopped faab calculator
- guillotine faab calculator
- sleeper chopped league strategy
- chopped league sleeper
- guillotine league rankings
- guillotine league espn
- yahoo guillotine league

Intent seen in the chopped research:
- When chopped players hit waivers.
- Can you trade.
- Who is chopped on a tie.
- How many teams and weeks.
- Whether chopped rosters stop being released late.
- What to do in the endgame with little money left.
- Byes.
- Draft floor versus ceiling.

---

## 3. Keyword map (one owner per intent)

| URL | Primary | Secondary | Must NOT target |
|---|---|---|---|
| `/guides/chopped-league-strategy` | chopped league strategy, guillotine league strategy | chopped league faab, guillotine league faab, how much faab in a guillotine league, what is a chopped league, sleeper chopped league, death league fantasy football, knockout league, guillotine league draft strategy, guillotine league waiver strategy | "calculator" terms |
| `/guides/faab-strategy` | faab strategy, faab bidding strategy, how much to faab (unchanged) | none new | chopped or guillotine in title, H1, meta, keywords |
| `/tools/faab` | faab calculator (unchanged) | chopped faab calculator, guillotine faab calculator (after chopped mode ships) | "strategy" terms |

The guide holds "chopped league faab"; the calculator links to the guide with that phrase rather than targeting it.

---

## 4. The new guide: `/guides/chopped-league-strategy`

### 4.1 Metadata

- Slug: `chopped-league-strategy` (permanent). Keep "chopped" because it is the rising term and Sleeper is our platform; put "guillotine" in the title and H1 because it is the larger term this season.
- Title tag (absolute): "Chopped and Guillotine League Strategy: Draft and FAAB"
- H1: "Chopped and guillotine league strategy"
- Meta description: "How to survive a chopped league on Sleeper, a Yahoo death league or an ESPN knockout league: what to draft, when to spend FAAB, and how much to bid when a roster is cut."
- `keywords` array: chopped league strategy, guillotine league strategy, chopped league faab, guillotine league faab, sleeper chopped league, what is a chopped league, death league fantasy football, knockout league fantasy football, guillotine league draft strategy, guillotine league waiver strategy.
- Canonical `/guides/chopped-league-strategy`. OG image `/api/og/guide/chopped-league-strategy` (add the slug wherever `app/api/og/guide` reads its guide list).
- JSON-LD: Article (with `authorJsonLd`, published and updated from the registry), BreadcrumbList, FAQPage built from the same array as the accordion (pattern in `app/guides/faab-strategy/page.tsx`).

### 4.2 Voice and rules

- Match `app/guides/faab-strategy/page.tsx`: Michael's first person, plain English, short and long sentences mixed, lessons with `GuideSectionHeader`, `GuideShell`, `GuideToc`, `PageMasthead`, `DiscordCtaSection`.
- Every worked number is either measured (cite our data or a named source in text) or clearly labelled invented, in the caption and the copy, the way the FAAB guide does.
- No em dashes, curly quotes, ellipsis characters; no puffery; no negative parallelism; no three-item rhythm lists by default. Run the owner's AI-writing checklist before finishing and state the result.
- Published figures from our synced leagues must be anonymous aggregates (owner approved). Read them from `faab_market_priors` (overhaul plan 7.3) at render, not hardcoded, with the sample size and "Updated {Eastern date}" beside them. If a cell is under the minimum sample, show "Not enough data yet" rather than a number.

### 4.3 Outline (lessons, in order)

Each lesson is an `h2` via `GuideSectionHeader` with an id ending `-heading`; sub-parts are `h3`.

1. `what-heading` "What a chopped league is" (answers "what is a chopped league", "what is a guillotine league")
   - Every week the lowest scorer in the whole league is eliminated and every player on that roster goes back to waivers. No playoffs; the last team standing wins. Trades are usually off. Budgets are usually $1,000 and never reset.
   - Platform table (real `table` with caption "The same format under five names"): Sleeper Chopped (up to 32 teams, 18 recommended, $1,000, trades off, lower season points chopped on a tie), Yahoo Death League (public 14 teams over 13 weeks, private up to 18, $1,000, one-day waiver on eliminated players), ESPN Knockout (12 or more teams, final two play for the title), FFPC Chop Classic (18 teams, $1,000, $1 minimum, chopped players locked from week 15), Fantasy Life guillotine leagues ($1,000, chopped players stop being released after week 14), MFL Chop Leagues (18 teams, ends week 17), NFFC Eliminator (17 teams, four-team finals weeks 14 to 17, $1 minimum). Source links under the table.
   - One line on death league and survivor naming (survivor usually means an NFL pick'em pool, a different game).
2. `survive-heading` "The only goal each week: not last"
   - The math: with N teams of equal strength each has a 1 in N chance of being chopped; being average is almost always enough in September. The danger is a bad week, so floor beats ceiling early.
   - Figure: survival odds by week for an average team in an 18-team league (computed with `lib/chopped/survival.ts` on equal teams, labelled "equal-strength teams, illustration"). Chart via `ChartFigure` with a table.
3. `draft-heading` "Drafting for a chopped league"
   - Floor over ceiling, depth over stars, byes (early versus late, both views: Sanderson favours early byes, LaMarca and Childs late), K and DEF only if the league starts them, QB in superflex.
4. `money-heading` "How FAAB works when rosters drop in bulk"
   - Budgets never reset; every surviving team is a rival; a chopped roster arrives all at once so several good players compete for the same money; prices fall as the field shrinks.
   - Measured table from our leagues: chopped winning bids by teams-alive band (cells `chopped|any|any|alive_*|any`) and by position when 3 or more teams bid.
   - Published comparison: Fantasy Life 2024 medians for the same players as the field shrank (Jefferson $434 to $340, Henry $424 to $241, St. Brown $333 to $76) and the NFFC Eliminator bands (top-12 RB 28.9% to 12.8% to 0%). Attribute each.
5. `how-much-heading` "How much to bid in a chopped league" (answers the PAA directly)
   - By phase: September (most of the field alive), October, November, the endgame. Cite Charchian's hold targets ($900 through September, $750 through October, $250 through November) and the champion ledger ($969, $904, $240, $11), and the opposing early-spend view (Masters 20 to 35% in September, Gretch's barbell). Our position: spend on players who start for you through the final week and when your survival odds this week are in danger; otherwise hold.
   - Danger ladder: bottom two, near the cut, middle, safe, with plain guidance for each (no invented percentages; use the calculator's manual danger multipliers only as "the calculator weighs this more").
   - Worked example (invented, labelled): 12 of 18 teams alive, $640 left, a top running back released.
   - Call to action: the calculator's chopped mode, anchor text "chopped FAAB calculator".
6. `endgame-heading` "The endgame"
   - Money left versus talent available; release cutoffs (FFPC week 15 lock, Fantasy Life after week 14); streaming when broke; bidding hard with 65% or more left.
7. `mistakes-heading` "Mistakes that get you chopped"
   - Spending half the budget in week 1; ignoring bye clusters; paying for a player who is a patch; forgetting the tiebreak rules.
8. `faq-heading` FAQ (accordion plus FAQPage JSON-LD), drafted answers in 4.4.
9. Closing links: FAAB calculator (anchor "chopped FAAB calculator"), FAAB strategy guide (anchor "FAAB strategy"), glossary entry, League Pulse.

### 4.4 FAQ drafts

- "What is a chopped league on Sleeper?" A Sleeper redraft league where the lowest scorer each week is eliminated and their whole roster goes to waivers. Sleeper recommends 18 teams and a $1,000 FAAB budget, trades are off by default, and the last team left wins.
- "Is a chopped league the same as a guillotine league?" Yes. Guillotine league is the older name. Yahoo now calls it a death league, ESPN a knockout league, and the FFPC runs a Chop Classic. The rules differ in the details: minimum bids, when chopped players stop being released, and how the final weeks work.
- "How much FAAB should I spend in a guillotine league?" Less than you think in September and more than you think once the field shrinks, but only on players who start for you until the end. Prices fall as teams are eliminated: in 2024 guillotine leagues Derrick Henry's median winning bid fell from $424 with about 11 teams left to $241 with about 8. Our chopped FAAB calculator prices a bid against your league's survivors and their money.
- "How many teams should be in a guillotine league?" 18 is the most common because 17 eliminations fill a 17-week season. Sleeper allows up to 32, and Yahoo public leagues use 14 over 13 weeks.
- "What happens on a tie for lowest score?" On Sleeper the team with fewer season points is chopped (in week 1, the better draft slot goes). Yahoo and the FFPC also use season points first.
- "When do chopped players hit waivers?" After the week's elimination, on the league's normal waiver run. Some formats stop releasing them late: the FFPC locks chopped players from week 15, and Fantasy Life guillotine leagues stopped after week 14 in 2024.
- "Can you trade in a chopped league?" Usually not. Sleeper turns trades off by default, and the FFPC and NFFC ban them.
- "Should I draft a kicker and defense?" Only if your league starts them. Several chopped formats do not, and when they do, streaming them costs almost nothing.

### 4.5 Figures and interactives

- Survival odds chart (lesson 2), computed at build time from `lib/chopped/survival.ts` with equal teams, seed fixed. Table under it.
- Measured bid table(s) (lesson 4) from `faab_market_priors`.
- Price-falls chart (lesson 4): published Fantasy Life medians per player by teams alive, attributed.
- Optional interactive (lesson 5): a small "danger check" form (teams alive, your rank by points this season, your budget) that links into the calculator's manual chopped mode with those values as URL params. Only build if the calculator accepts them (add `?kind=chopped&start=18&alive=12&danger=near` parsing to `app/tools/faab/page.tsx`; otherwise skip and leave a plain link).
- Accessibility as the rest of the site: every chart has a table, no aria-hidden figures, heading order, 44 px targets.

### 4.6 Registration (a guide is not live until all of these are done)

- `lib/guides/published.ts`: add `{ slug: "chopped-league-strategy", navLabel: "Chopped Leagues", title: "Chopped and guillotine league strategy", summary: "What chopped, guillotine, death and knockout leagues are, how to draft for them, and how much FAAB to bid when a roster is cut", publishedAt, updatedAt, priority: 0.7 }` (match other guides' priority values). This feeds `app/sitemap.ts`, `app/llms.txt/route.ts`, the footer and the guide's own metadata.
- `app/guides/page.tsx`: add a card (same shape as the FAAB card near line 185).
- `lib/nav-tree.ts` and `lib/breadcrumbs.ts`: add the route beside `faab-strategy`.
- `lib/site.ts`: confirm the footer column reads from the registry; add only if it does not.
- `app/api/og/guide/...`: add the slug so the OG image renders.
- `lib/guides/fantasy-football-terms.ts`: the "guillotine-league" term (line 244) gains aka "chopped league, death league, knockout league" and a link to the new guide; add a "chopped-league" term that points to the same definition if the glossary supports cross references.
- IndexNow: submit the new URL through the existing `lib/indexnow.ts` path used for new guides (check how other guides were submitted; do not invent a new mechanism).

---

## 5. Changes to `/guides/faab-strategy`

1. New `h2` lesson `chopped-heading` "FAAB in chopped and guillotine leagues", placed after the dynasty lesson (`dynasty-heading`). 150 to 300 words:
   - Budgets never reset and usually start at $1,000. A whole roster lands at once, so several starters compete for the same money. Every surviving team is a rival and the goal is not finishing last this week. Prices fall as teams are eliminated.
   - One measured sentence from `faab_market_priors` (chopped cell) with its sample size.
   - Link: "Our chopped league strategy guide covers drafting, survival and bid sizes week by week." Anchor "chopped league strategy". And "The FAAB calculator has a chopped mode."
   - Update the syllabus list and `GuideToc` entries to include the new lesson, and the "Lesson N of 8" eyebrows become "of 9".
2. The timing lesson (`timing-heading`) currently describes the calculator's early-season discount (`market.ts urgencyMultiplier`). The overhaul removes that discount (overhaul plan A3 and 7.2 calendar). Rewrite that lesson to match the new calendar: weeks 2 to 6 are the busiest bidding, the middle of the season is cheapest, prices climb again from week 14. Cite our measured phase table. Update the file's header comment that describes the discount.
3. The "how much" lesson quotes the old bid-curve bands as "the calculator's fallback". After the overhaul the calculator prices from the auction model and those bands remain only as the no-projection fallback. Keep the bands as rules of thumb, but change the sentence that ties them to the calculator, and add one measured line on what contested adds cost (bidders table from priors).
4. The "room" lesson (`room-heading`) describes the ladder rungs "Bid this / To be sure / Walk away above". Rename to the new rungs ("Bid", "Stretch to", "Walk away above") and add the goal toggle and win chance.
5. Add FAQ entries: "How does FAAB work in a chopped league?" (short answer plus link) and "Should I bid odd numbers?" (yes, ties on round numbers are common; cite 4for4).
6. Do NOT add chopped or guillotine to this guide's TITLE, DESCRIPTION, H1 or `keywords`.
7. Bump `updatedAt` in `lib/guides/published.ts` for faab-strategy to the ship date (real content change).

## 6. Changes to `/tools/faab` (content only; model work is the overhaul plan)

- FAQ entry "How does FAAB work in chopped and guillotine leagues?" (drafted in the overhaul plan 7.16) links to the guide with anchor "chopped league strategy".
- Explainer note "Works for chopped and guillotine leagues" links to the guide.
- One sentence in the explainer intro using the phrase "chopped league FAAB calculator" once, only after the chopped mode ships.

## 7. Internal links

- New guide to calculator: "chopped FAAB calculator" (two places: lesson 5 and closing).
- Calculator to new guide: FAQ answer and explainer note.
- FAAB guide to new guide: new lesson; new guide to FAAB guide: lesson 4 intro and closing ("FAAB strategy").
- Glossary term to new guide.
- `/guides` index card.
- League deep view: for a Sleeper league with `settings.type === 3`, a one-line link under the league header, "New to chopped leagues? Read the chopped league strategy guide." Place in `app/leagues/[sleeper_league_id]/page.tsx` beside the existing header notices; it must not trigger any compute.

## 8. Timing and measurement

- Ship the guide as soon as it is written: in-season FAAB interest runs through October, and Google gets eleven months to settle the page before the July 2027 draft-season climb.
- Search Console checks at 28 and 56 days after publishing: impressions and position for "chopped league strategy", "guillotine league strategy", "chopped league faab", "guillotine league faab", and for the calculator's "chopped faab calculator". Record in `handoff.md`.
- Revisit the `updatedAt` and the measured tables before draft season 2027 (July).

## 9. Tasks (add to progress.md with prefix FB-G)

- FB-G01 Guide page `app/guides/chopped-league-strategy/page.tsx` with metadata, JSON-LD, lessons 1 to 3 and 6 to 9. Depends on nothing.
- FB-G02 Lesson 2 survival chart (`chopped-figures.tsx`). Depends on overhaul FB-T31.
- FB-G03 Lessons 4 and 5 with measured tables from `faab_market_priors`. Depends on overhaul FB-T11 and FB-T33.
- FB-G04 Optional danger-check interactive plus calculator URL params. Depends on overhaul FB-T34.
- FB-G05 Registration: `lib/guides/published.ts`, `app/guides/page.tsx`, `lib/nav-tree.ts`, `lib/breadcrumbs.ts`, OG guide slug, `lib/site.ts` check.
- FB-G06 Glossary aliases and link.
- FB-G07 FAAB guide: new chopped lesson, syllabus and TOC, "of 9" eyebrows.
- FB-G08 FAAB guide: timing lesson rewrite and header comment.
- FB-G09 FAAB guide: how-much lesson sentence change and measured line; room lesson rung names and goal toggle.
- FB-G10 FAAB guide FAQ additions; `updatedAt` bump.
- FB-G11 Calculator content links (overhaul 7.16 FAQ and note) and the one-sentence explainer phrase.
- FB-G12 League deep view chopped link.
- FB-G13 IndexNow submission for the new URL through the existing path.
- FB-G14 Accessibility and implementation review sub-agents on the new guide and changed pages; AI-writing checklist pass on every new string, stated in the final report.

## 10. Sources

- Ahrefs free keyword generator: https://ahrefs.com/keyword-generator?country=us&input=guillotine%20league and https://ahrefs.com/keyword-generator?country=us&input=chopped%20league
- Google Trends: https://trends.google.com (comparisons listed in 2.2, pulled 2026-09-19)
- Sleeper: https://x.com/SleeperHQ/status/1956124863434838030 , https://x.com/SleeperHQ/status/1959016458559619322 , https://support.sleeper.com/en/articles/12005468-introduction-to-chopped-leagues
- Yahoo: https://sports.yahoo.com/fantasy/article/death-leagues-are-back-with-new-name-and-a-new-look-125625273.html , https://help.yahoo.com/kb/fantasy-death-leagues-overview-sln37116.html , https://www.yahooinc.com/press/yahoo-sports-and-liquid-death-team-up-to-launch-yahoo-fantasy-guillotine-leagues
- ESPN: https://espnpressroom.com/press-release/espn-fantasy-football-introduces-knockout-leagues-format/ , https://support.espn.com/hc/en-us/articles/18378552635156-What-is-a-Knockout-League
- FFPC: https://myffpc.com/cms/public/play/chop-classic-leagues-official-rules
- NFFC: https://nfc.shgn.com/rules/2703
- MFL: https://home.myfantasyleague.com/chopleagues.html
- Fantasy Life guillotine articles and tool: https://www.fantasylife.com/tools/guillotine-league-waiver-wire and the article URLs listed in section 13 of the overhaul plan
- Sleeper survivor (disambiguation): https://sleeper.com/football-survivor
- Competing pages seen in results: Fantasy Footballers Fantasy 101 Chopped Leagues, Fantasy Points, Draft Sharks, FantasyPros, RotoWire, Masters Fantasy Football Leagues, chopfantasyfootball.com, guillotineleagues.com
