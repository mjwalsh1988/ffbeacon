# Reworking /guides/fantasy-football-terms

Written 2026-09-22. A plan, not an implementation. Nothing in here has been
built.

Search Console figures are 90 days, 2026-06-24 to 2026-09-21.

---

## 1. The problem, in four numbers

| | |
| --- | --- |
| Impressions | 2,955 |
| Clicks | 3 |
| Click-through rate | 0.10% |
| Average position | 20.3 |

It is the largest impression pool on the site, nearly a third more than
`/tools/faab`, and it converts at one twentieth of one percent. `/tools/faab`
takes 143 clicks from fewer impressions.

## 2. What it actually ranks for, and the split nobody would guess

The named queries account for about 140 of those 2,955 impressions. The rest is
long tail below Search Console's reporting threshold: hundreds of distinct
"what does X mean in fantasy football" queries with one or two impressions
each.

The named ones divide cleanly into two groups, and they behave in opposite ways.

**Group A: glossary head terms. The page is on page six to eight.**

| Query | Position |
| --- | --- |
| fantasy football terms | 62.4 |
| fantasy football terminology | 68.0 |
| fantasy football abbreviations | 70.0 |
| fantasy football lingo | 75.0 |
| fantasy football glossary | 76.7 |
| fantasy football acronyms | 84.5 |

**Group B: single-term definition queries. The page is on page one.**

| Query | Impressions | Position | Clicks |
| --- | --- | --- | --- |
| cel meaning fantasy football | 46 | 6.7 | 0 |
| cheap definition football | 1 | 9.0 | 0 |
| fantasy football tep meaning | 1 | 10.0 | 0 |
| fantasy football wrt meaning | 1 | 10.0 | 0 |
| fantasy football na meaning | 4 | 10.8 | 0 |
| ff meaning football | 6 | 18.5 | 0 |

So the page is losing badly at the thing it is titled for, and winning
positions it gets no clicks from.

## 3. Diagnosis

Three separate things are going on, and they need three different answers.

**One URL is doing two jobs.** It is built as a reference work (191 entries:
161 terms, 30 abbreviations) and titled for the reference-work head term. But
the traffic it earns is people asking about one term. Those are different
searchers wanting different pages.

**One URL cannot win 161 passage matches.** For a query like "cel meaning
fantasy football", Google picks one passage from one page. A 191-entry page is
a weak passage match for any single entry compared with a page whose title,
heading and first sentence are all about that entry. Position 6.7 is roughly
the ceiling for a buried definition, and page one on a definition query with no
snippet is worth almost nothing.

**Definition queries are largely zero-click by nature.** 46 impressions at
position 6.7 with zero clicks is Google answering the question on the results
page. This is not fixable by writing a better definition. It is only fixable by
having something on the other side of the click that the SERP cannot give away.

## 4. The honest framing before any work starts

Glossary traffic is top-of-funnel, mostly beginners, and low commercial intent.
Even a good outcome here is worth less per hour than the waiver work. I would
not put this ahead of anything in the waiver or FAAB cluster, and I would
not measure it on clicks alone.

I would also not try to beat ESPN, NFL.com and Sleeper on "fantasy football
terms" from position 62. That is a link-authority fight rather than a content
fight, and the page is already thorough. Chasing it is the part of this I would
drop.

What is worth doing is the part where the page already has traction and is
leaving it on the floor.

## 5. The plan

### A. Split the highest-value terms into their own pages

The core fix. Give a term its own URL and its title, h1 and first sentence all
match the query exactly, which is what wins the passage.

Only split a term where both are true:

1. There is real search volume for "X meaning fantasy football" or "what is X
   in fantasy football".
2. FF Beacon has a tool, a guide or a live number the page can link into, so
   there is a reason to click that the SERP cannot satisfy.

Rule 2 is what stops this becoming 161 thin pages. A term with a one-line
answer and nowhere to go stays in the glossary.

Starting candidates, from the queries the page already ranks for plus the
site's existing surfaces:

| Term | Why it qualifies | Links into |
| --- | --- | --- |
| FAAB | Already a head term for the site | /guides/faab-strategy, /tools/faab |
| TEP | Ranks position 10 already; a live format toggle exists | /rankings/redraft-ppr-tep |
| Superflex | Guide already exists | /guides/superflex-strategy |
| CEL | 46 impressions, position 6.7, the single biggest term query | Needs a destination; see note |
| WRT / FLEX | Ranks position 10; lineup slots are explainable with a diagram | /tools/who-should-i-start |
| OPRK | Matchup rating; we compute our own | /tools/who-should-i-start |
| PA / PF | Standings columns; we compute all-play and luck | /leagues/[id]/schedules |
| DTD / Q / O | Injury tags; feed straight into start/sit | /tools/who-should-i-start |
| ADP | We hold real ADP snapshots | /guides/fantasy-football-draft-guide |
| Waiver priority | 500 a month on its own | /waiver-wire |

CEL is the awkward one: it is the biggest single-term query the page has and
the answer is "the cost of a player in a salary-cap or auction league". Worth
checking what the searchers actually want before building anything for it,
because the volume is real and the intent is not obvious.

Each split page is short and structured the same way: the definition as the
first sentence, then why it matters to a decision, then a worked example with
real numbers, then the tool. Two to four hundred words, not two thousand.

### B. Keep the glossary as the hub, and strengthen what it is for

The glossary keeps every entry, including the split ones, with the inline
definition intact. A glossary with holes in it is not a glossary. Each split
term gains a "full explanation" link under its entry.

The page already has the two things this needs: every term carries a permanent
anchor id, and every `body[0]` opens with a standalone definition sentence.
That is unusually good groundwork and no data restructuring is required.

### C. Split abbreviations onto their own URL

`fantasy football abbreviations`, `abbreviations in fantasy football`,
`fantasy football acronyms`, `fantasy football symbols and meanings` are a
distinct and less contested intent from `fantasy football terms`. The page
already holds 30 abbreviations in their own section with their own groups.

A dedicated `/guides/fantasy-football-abbreviations` would stop the two intents
competing inside one document and gives a second, more winnable head term. This
is the one head-term play I would make.

### D. Structured data and titles

- Add `DefinedTermSet` and `DefinedTerm` schema to the glossary, and
  `DefinedTerm` to each split page. It is the schema type built for exactly
  this and the page does not currently use it.
- Split-page titles match the query shape, not the brand voice: "TEP in Fantasy
  Football: What Tight End Premium Means" rather than "Understanding TEP".
- Keep the glossary's own title on the terms head term, but accept it is not
  going to win it, and stop optimising for that.

### E. Accept and measure the zero-click reality

For pure definition queries the win is a brand impression and an eventual
click into a tool, not a click today. Judge the split pages on clicks; judge
the glossary on impressions and on assisted paths into tools, not on its own
CTR.

## 6. Sequence and effort

1. Abbreviations split (D + C). Small. One new page from data that exists.
2. Three split pages as a test: FAAB, TEP, superflex. All three already have a
   destination, so they are the cheapest way to find out whether the split
   works at all.
3. Measure at 60 days. If the three split pages outrank the glossary for their
   own terms and take clicks, build the next eight. If they do not, stop, and
   the glossary keeps its long tail at no further cost.

Step 3 is the point of doing it in this order. The whole plan rests on a claim
about passage matching that is worth testing on three pages before it is worth
testing on eleven.

## 7. Baseline to compare against

Recorded 2026-09-22, for the whole page, 90 days:

- 2,955 impressions, 3 clicks, 0.10% CTR, average position 20.3.
- Best single-term position: 6.7 (cel meaning fantasy football).
- Best head-term position: 62.4 (fantasy football terms).

A fair 90-day target after step 2: any split page inside the top 5 for its own
term, and the first double-digit monthly click count the glossary cluster has
ever produced.
