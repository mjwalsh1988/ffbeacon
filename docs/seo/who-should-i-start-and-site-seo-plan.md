# Who Should I Start (Beacon Breakdown), the trade calculator slug, and the site SEO audit

Plan of record, written 2026-09-10. Planning only: nothing in this document has
been implemented. Every file path and line number below was verified against
the repo on 2026-09-10 by read-only research agents; line numbers drift, so
treat them as "where to look", not as a contract.

Three jobs, in the order they should ship:

1. Reframe and refactor Beacon Breakdown into a start/sit tool that ranks for
   the "who should I start" keyword cluster, on a new slug, with the old one
   permanently redirected.
2. Move the trade calculator (Signal Check) to a slug that matches the title it
   shipped with on 2026-09-10, with a permanent redirect.
3. A site-wide SEO audit with a prioritised fix list.

Two conventions this document follows because the codebase does: plain ASCII
punctuation everywhere (no em dashes, no curly quotes, no ellipsis character),
and every user-visible timestamp resolves through lib/datetime.ts.

A note on the research method. Google does not serve a parseable results page
to a non-browser client, so Google rankings quoted below are index-derived
(via web search) rather than observed on a live results page. Bing results were
captured directly on 2026-09-10 and are exact. Competitor titles, descriptions,
H1s and JSON-LD were pulled from raw HTML on the same day. No Semrush data was
used, per the owner's instruction. Before implementation starts, somebody
should run the four head terms through a logged-out Chrome session on a US IP
and screenshot the Google page, including whether an AI Overview fires and who
it cites.

## 0. Decisions, in one place

These are the calls this plan makes. Each has a reason in the section it
points at. The owner confirmed the five open questions on 2026-09-10 (see
section 7), so every item below is settled and implementation can start
against it without further sign-off.

- New slug: /tools/who-should-i-start. Permanent redirect from
  /tools/beacon-breakdown, query string preserved. Section 2.3.
- Title tag (58 characters, uses an absolute title so the "| FF Beacon"
  template does not push it past 60):
  "Who Should I Start in Fantasy Football? | Beacon Breakdown". Section 2.4.
- H1: "Who Should I Start in Fantasy Football? The Beacon Breakdown Start/Sit
  Tool". Section 2.4.
- Meta description (150 characters at "Week 18", the longest case, and it is
  templated on the live week): "Who should I start this week? Put any players
  into Beacon Breakdown, the free start/sit tool, and get a Week {N} verdict
  from projections and matchups." Section 2.4.
- Short label, used ONLY in the header nav, the footer, the /tools catalogue
  card eyebrow, breadcrumbs and bookmarks: "Start / Sit". Section 2.2.
- Long-form link phrase for body copy and CTAs from other tools, rotated
  across a small set so no single anchor repeats site-wide: "find out who to
  start with Beacon Breakdown", "who should I start this week", "run these
  players through the Beacon Breakdown start/sit tool". Section 2.2.
- One evergreen URL. No /week-N paths, no /ppr or /standard paths. The week
  is templated into the description, the first H2 and a visible label. Format
  is an on-page control with a self-referencing canonical. Section 2.4.
- The start/sit engine is a NEW pure module, lib/start-sit/, that reads
  projections through the existing shared read path
  (lib/projections/read.ts loadAdjustedProjections) so the FF Beacon
  projection switch flips it with zero code change. Section 2.6.
- The existing pairwise Beacon Edge engine (lib/breakdown/) is KEPT and
  generalised to N players for the "background" tabs. BEAM keeps calling it.
  Section 2.7.
- Trade calculator slug: /tools/trade-calculator. Permanent redirects for the
  base path and for /v/:shareId share links. Section 3.
- IndexNow gets built (it is an env var today and nothing else). Section 5.
- Player cap on the start/sit board: 8, as a named constant. Section 2.5
  explains why a cap exists at all.

## 1. The keyword file

Source: C:\Users\mjwal\Downloads\Keyword Stats 2026-09-10 at 14_54_42.csv,
Google Keyword Planner export, UTF-16 tab-separated, 68 rows, window
2025-08-01 to 2026-07-31, all USD, all Low competition or Unknown. A UTF-8
copy was written to the session scratchpad for the research agents; it is not
in the repo and should not be.

Keyword Planner rounds volume into buckets (50, 500, 5,000, 50,000) and
reports one clustered figure against every member of a cluster. Ten rows share
the 50,000 bucket and they are near-synonyms of one intent. They are one
opportunity, not ten. Bing confirms this: it returns dictionary and streaming
results for "who should i play for fantasy football" and "who would you start
in fantasy football", which is what an engine does with a phrase few people
type. Google resolves every one of them to the same page set (FantasyPros,
DraftSharks, RotoBaller, RotoWire, FantasySP).

The 50,000 bucket (the head of the cluster):
- who should i start fantasy football
- who do i start fantasy football
- who should i start
- who i should start fantasy football
- fantasy footballers who should i start (brand-adjacent; The Fantasy
  Footballers podcast has a tool at thefantasyfootballers.com/who-should-i-start)
- who should i start fantasy footballers (same)
- who should i play for fantasy football
- who would you start in fantasy football
- start sit tool fantasy football
- fantasy football start sit analyzer

The 5,000 bucket (qualifiers worth a heading each):
- fantasy who should i start
- who should i play in fantasy
- who should i start ppr
- who should i start week 1
- fantasy sit start tool

The 500 bucket (long tails worth a sentence each, not a page):
- who should i start fantasy football ppr / in fantasy football ppr / ppr
  fantasy football / fantasy ppr / week 1 ppr
- who should i start nfl / nfl fantasy / nfl fantasy football / fantasy nfl /
  in nfl fantasy
- who should i start this week fantasy football / this week in fantasy football
- who should i start fantasy football week 1
- who should i play in fantasy football this week / nfl fantasy
- who do i start ppr / in fantasy / fantasy football ppr
- fantasy football who should i play
- fantasy football start em sit em tool, start em sit em analyzer, start em
  sit em tool, nfl start sit tool, fantasy start analyzer, fantasy start sit
  analyzer

The 50 bucket and the zero rows: "who should i start fantasy football
calculator", "standard", "in my fantasy football league", "on my fantasy team",
"week 1 ppr 2022", "2022". Covered by body copy or ignored.

What the file says, read as a whole:
- The searcher phrases it as a QUESTION ("who should I start") far more than
  as a tool name ("start sit tool"). The page should be titled as the
  question and describe itself as the tool.
- "PPR" and "week 1" are the only qualifiers with real independent volume.
  "Week 1" is seasonal: the same searcher types "week 7" in October. A
  templated week label covers all of them from one URL.
- "Analyzer" and "calculator" are Google-only variants that resolve to the
  same pages. They belong in the "how the verdict is calculated" heading, not
  in the title.
- Nothing in the file is about a LEAGUE. This is a two-players-in-a-box query,
  which is exactly what Beacon Breakdown already is. The refactor adds N
  players and a "start K of N" verdict; it does not need a league sync to
  serve the query.

## 2. Task 1: Beacon Breakdown becomes the Who Should I Start tool

### 2.1 What exists today (so the refactor is scoped against reality)

Route: app/tools/beacon-breakdown/ (18 files, about 4,900 lines). Engine:
lib/beacon-breakdown.ts (orchestration, 538 lines) plus lib/breakdown/ (types,
metrics registry, scoring primitives, edge composite, verdict text,
load-extras, league-mode, league-impact; about 2,950 lines). API:
app/api/breakdown/search/route.ts (autocomplete) and
app/api/og/breakdown/[a]/[b]/route.tsx (share card). Tests:
lib/breakdown/edge.test.ts, lib/breakdown/load-extras.test.ts, plus
lib/llms/build.test.ts asserts "Beacon Breakdown" appears in llms.txt.

What it does: exactly two players (?a=&b=), picked through two WAI-ARIA
comboboxes (breakdown-selector.tsx), scored by 19 metrics in
lib/breakdown/metrics.ts across three lenses (Dynasty, Win now, This week,
lens-switch.tsx), composited by lib/breakdown/edge.ts into a 0..1 share with
labels Toss-Up / Slight / Clear / Strong Edge, and explained by
lib/breakdown/verdict.ts. Five tabs: The Breakdown, Your league (only with
?league=&roster=), Projections, Reliability, Market, Stats. Format and value
source come from the site header through resolveFormatSlug and
resolveSourceSlug (lib/preferences.ts), never from a picker on the page.

What it already gets right for the new job, and must keep:
- Projections already run through lib/power-pulse/project.ts
  projectPlayerWeek, and the projection SOURCE is already resolved once per
  render through lib/projections/source.ts resolveProjectionSourceForWindow
  fed by league_power_pulse_settings.beaconProjections
  (lib/breakdown/load-extras.ts lines 512-520). The switch is honoured today.
- No live Sleeper call on the page. lib/breakdown/load-extras.ts
  resolveSeasonClock derives season and current week from stored rows.
- The comparison URL is never canonical; the canonical is always the bare
  tool path (app/tools/beacon-breakdown/page.tsx lines 164-172). This is
  correct and stays.
- The OG card runs the same loaders as the page so it cannot disagree.
- Every chart is a ChartFigure from components/chart-kit.tsx: visible
  caption, sr-only summary, real table under a disclosure.

What is wrong for the new job:
- Two players only. The type system (MetricSide, share(a, b)) is pairwise.
- The verdict is a VALUE-and-outlook composite. Even the "This week" lens
  gives next-week points 34 percent and matchup 16 percent, and mixes in
  opportunity, health, beat rate, consistency and per-game points. A start/sit
  reader wants one number first: who scores more THIS WEEK under my scoring,
  and how sure are you.
- The H1 is the bare brand name ("Beacon Breakdown") and the crawlable copy on
  the empty state is roughly 160 to 200 words. Every substantive thing is
  behind a client component that renders after two picks.
- One latent scoring defect to verify before anything else: projectPlayerWeek
  is called with scoringSettings null (lib/breakdown/load-extras.ts lines
  576-604), and lib/league-scoring.ts closestScoringBase(null) returns
  "pts_std" (lines 133-138), so the projected POINTS shown to a PPR reader may
  be the standard-scoring column. The accuracy and reliability reads are
  scoped correctly by scoringKey; the per-week points may not be. Section 2.6
  adds the helper that fixes this and a test that pins it.

### 2.2 The naming contract

The tool's name stays Beacon Breakdown. What changes is what the page is FOR
and how every link into it reads.

Short label, exactly "Start / Sit" (with the spaces around the slash, as the
owner wrote it), used in these places and nowhere else:
- Header nav: lib/site.ts TOOLS_NAV entry (around line 88), label "Start /
  Sit", description "Beacon Breakdown: who should I start this week".
- Footer: lib/site.ts FOOTER_COLUMNS entry (around line 284), label "Start /
  Sit".
- /tools catalogue: lib/tools-catalog.ts entry (lines 81-94), eyebrow "Start /
  Sit", title "Beacon Breakdown: Who Should I Start?", cta "Find out who to
  start".
- Breadcrumb: lib/breadcrumbs.ts line 66, "Start / Sit".
- Site search: lib/site.ts SEARCHABLE_TOOLS (lines 169-174), label "Start /
  Sit (Beacon Breakdown)", keywords add "start", "sit", "who should i start",
  "who do i start", "start sit", "start or sit", "lineup".
- Bookmarks and nav-tree icon maps keep their icon; the path key changes.
- Accessible name equals visible text in every one of these. No aria-label
  that says something different from what is on screen.

Long form, for body copy, CTAs from other tools, guides and Brief articles.
Rotate; never repeat the identical string twice on one page, and never use
the exact string "who should I start fantasy football" as anchor text more
than once site-wide (Google's link guidance names keyword-stuffed anchors as
the failure mode; the cure is variety, not a ratio):
- "find out who to start with Beacon Breakdown"
- "who should I start this week"
- "run these players through the Beacon Breakdown start/sit tool"
- "get a start/sit verdict from Beacon Breakdown"
- "Beacon Breakdown, our start/sit tool"

From League Pulse surfaces the anchor names the DIFFERENT job so the two
pages never compete: "compare just these players" or "a single start/sit
call". From the start/sit page back to League Pulse Lineups, once, in the
last section: "set your whole lineup for the week".

Everywhere the tool is referred to in prose (page copy, OG cards, llms.txt,
guides, the About page, the author page), the phrase is "Who should I start?
with Beacon Breakdown" or "Beacon Breakdown, the start/sit tool". The old
framing ("Two players. One verdict.", "Compare two players head-to-head",
"Player comparison") is retired everywhere. Section 2.12 lists every file.

### 2.3 The slug and the redirect

New route folder: app/tools/who-should-i-start/. Moved with git mv from
app/tools/beacon-breakdown/ so history follows.

Why this slug and not the longer one. The owner asked for the full target
keyword in the slug. The target keyword is "who should i start" (50,000 per
month on its own, the head of the cluster). "Fantasy football" is carried by
the title, H1 and description, where it has room. The research found the
question-form slug is a minority in the results page but a winning one:
draftsharks.com/who-should-i-start holds Bing position 1 or 2 for every head
term, 4for4.com/who-should-i-start and fantasyowner.com/tools/who-should-i-start
rank top ten, and nobody in the top twenty stuffs "fantasy-football" into a
question slug. Google's URL guidance makes no ranking claim for keywords in
paths, John Mueller calls it "a very small ranking factor", and since January
2025 mobile snippets show only the domain, so the path's click-through value
is smaller than it was. The owner confirmed this slug on 2026-09-10; the
longer /tools/who-should-i-start-fantasy-football form is not used.

Redirects, in next.config.ts redirects(), following the house pattern
(explicit entries, a comment explaining why, permanent: true, which emits 308;
Google's redirect documentation lists 301 and 308 together as permanent):

```ts
{
  source: "/tools/beacon-breakdown",
  destination: "/tools/who-should-i-start",
  permanent: true,
},
```

Next.js preserves the query string on a redirect by default, so a shared
/tools/beacon-breakdown?a=x&b=y link lands on
/tools/who-should-i-start?a=x&b=y, and section 2.5 keeps ?a=&b= working as
an alias of the new ?p= parameter.

Keep the redirect forever, like the trade-finder and activity entries. Google's
floor is one year.

The OG image route app/api/og/breakdown/[a]/[b]/route.tsx keeps its path.
Social unfurls cache the literal image URL, so a redirect there buys nothing
and a rename breaks cached cards. A new route for the N-player card is added
beside it (section 2.10); the old one keeps serving two-player cards.

The autocomplete API app/api/breakdown/search/route.ts keeps its path. It is
an implementation detail, same-origin gated, never indexed.

No reserved-routes migration is needed: lib/signal/reserved-routes.ts guards
top-level segments only, and "tools" is already reserved.

Sitemap: lib/sitemap/sections.ts line 110 changes to
{ path: "/tools/who-should-i-start", priority: 0.7 }. Priority goes up one
notch because this is now a head-term landing page. (While in that file, add
/tools/manager-pulse, which the research found is linked from /tools but
absent from the core sitemap.)

Canonical: alternates.canonical "/tools/who-should-i-start", always the bare
path, never with query parameters. Same rule as today.

### 2.4 Metadata, headings and on-page copy

Title. The root layout (app/layout.tsx lines 32-35) applies the template
"%s | FF Beacon", which adds twelve characters. The page uses an absolute
title so the brand tool name fits inside the 51 to 60 character band where
Google's rewrite rate is lowest (39 to 42 percent, rising past 76 percent
over 60 and to 99.9 percent over 70):

```ts
title: { absolute: "Who Should I Start in Fantasy Football? | Beacon Breakdown" }
```

58 characters. Reads as the searcher's own question. Carries the head phrase
"who should i start", the qualifier "fantasy football", and the tool name.

The owner confirmed this title on 2026-09-10, choosing the form that keeps
"Beacon Breakdown" in the title. Two alternatives were weighed and rejected,
recorded for history only: "Who Should I Start? Beacon Breakdown Start/Sit"
with the template (58 total, drops "fantasy football", adds "start/sit"), and
"Who Should I Start? Fantasy Start/Sit | Beacon Breakdown" absolute (56,
keeps both but reads less like a question).

H1, visible, one per page, rendered server-side in the masthead in BOTH the
empty and the loaded state (today the masthead disappears once two players
are picked and the H1 becomes sr-only "Beacon Breakdown comparison"; that
stops):

```
Who Should I Start in Fantasy Football? The Beacon Breakdown Start/Sit Tool
```

Title and H1 open with the same six words on purpose: a 2025 study found
titles that match their H1 are rewritten about 20 percent of the time against
76 percent overall.

Meta description, templated on the live week (the same function that names
the week everywhere else on the site, so it can never say Week 2 when Week 1
is live, which is the exact failure Fantasy Life is shipping today):

```
Who should I start this week? Put any players into Beacon Breakdown, the free start/sit tool, and get a Week {N} verdict from projections and matchups.
```

150 characters at "Week 18". Opens with the question, names the tool, names
the week, names the two inputs a searcher cares about.

Open Graph and Twitter: same title and description; image is the new
N-player card (section 2.10) when players are in the URL, otherwise the
generic page card from app/api/og/page/[key]/route.tsx with its
"beacon-breakdown" entry rewritten (eyebrow "Start / Sit", headline "Who
should I start?", subhead "Put your players in. Get a start/sit verdict
built from this week's projections and matchups.", facts ["Free", "No
signup", "Any players, any format"]).

Server-rendered copy. Every heading and every paragraph below ships in the
initial HTML. The Vercel and MERJ crawler study (December 2024) found no
major AI crawler executes JavaScript; only Googlebot and Applebot render. A
page whose substance appears after hydration is invisible to ChatGPT, Claude
and Perplexity search. The interactive board hydrates; the words around it do
not wait for it.

Outline (H2 unless marked), with what goes under each:

- H2 "Who should I start in Week {N}?" The board. The player picker, the
  "How many do you start" stepper, the format chip, the week picker, and the
  result cards. Above the board a visible line: "Week {N}, {season}.
  Projections updated {formatEastern(updatedAt)}." The timestamp is the
  freshest player_weekly_projections.updated_at for the resolved source and
  week.
- H2 "This week's toughest start/sit calls". A server-rendered grid of eight
  to twelve real comparisons for the live week, verdict already computed and
  visible in the HTML (section 2.8). Each card links to the board pre-filled.
  This is the highest-leverage block on the page: only StatPick has one, the
  comparison-form query ("X or Y") triggers an AI Overview 95 percent of the
  time in Seer's data, and a cited page earns about 120 percent more clicks
  per impression than an uncited one.
- H2 "How the Beacon Breakdown start/sit verdict is calculated". Four short
  paragraphs, in this order, each starting with its answer: the projection
  (whose engine, named by projectionSourceDisplay, so it says Sleeper today
  and FF Beacon the day the switch flips), the matchup (nfl_defense_vs_position,
  computed from our own play-by-play back to 2020, not the source's), the
  reliability discount (beat rate and availability from
  player_projection_accuracy), and the confidence figure (the probability the
  chosen starters outscore the best benched option, from the same
  winProbability the Schedules board uses). Then one sentence on cadence:
  "Projections refresh nightly and again when injury reports move; the
  timestamp above the board is the truth."
- H2 "Who should I start in PPR, half PPR and standard leagues?" Two
  paragraphs: the format chip at the top of the board follows the site header
  and reprices every player under that scoring; TE premium and superflex are
  real formats here, not a checkbox nobody else offers. Links to the two
  rankings pages for the reader's format.
- H2 "Who should I start at quarterback?" Then running back, wide receiver,
  tight end, the flex, and defense and kicker. Each is 60 to 120 words of
  genuinely written positional guidance (what moves the needle at that
  position this season, what the tool weighs there), followed by a
  server-rendered "Closest calls at {position} this week" list of three pairs
  drawn from the same computation as the toughest-calls block. RotoBaller
  ranks on exactly this structure and its sections are actually written; empty
  anchors do not count.
- H2 "How do I decide who to start in fantasy football?" A plain method in
  five sentences, the kind of passage an AI Overview lifts: projection first,
  then matchup, then floor if you are favoured and ceiling if you are not,
  then injury and weather last, and never bench a stud for a matchup.
- H2 "Start/sit questions, answered". H3 per question, answer in the first
  sentence: Can I compare more than two players? (yes, up to eight, and you
  choose how many start). Does it work for my league's scoring? (the header
  format; connect a Sleeper league for its literal scoring). What does the
  confidence figure mean? How often is it updated? Is it free? Why does the
  verdict differ from my rankings? (a ranking is rest-of-season, this is one
  week). Should I start a running back or a wide receiver in my flex?
  Rendered as visible text; a FAQPage JSON-LD block is optional because
  Google retired the FAQ rich result on 2026-05-07, while Microsoft still
  names FAQ sections as a Copilot citation aid. Ship the words; the markup is
  fifteen minutes and harmless if included.
- H2 "Set your whole lineup, not just one call". One paragraph and the single
  link to League Pulse Lineups with the anchor "set your whole lineup for the
  week". This is the differentiation sentence: this page answers "these
  players, which ones", Lineups answers "my nine starters, which nine".

Structured data, in this order and nothing else:
- BreadcrumbList: Home, Tools, Start / Sit. Still a live rich result on
  desktop; the site already emits it.
- WebApplication: name "Beacon Breakdown Start/Sit Tool", applicationCategory
  "SportsApplication", operatingSystem "Any", url, description, offers
  { price "0", priceCurrency "USD" }, dateModified equal to the visible
  timestamp. NO aggregateRating: Google tightened review-snippet guidance on
  2026-07-24 around self-serving ratings, and a rating we collected about our
  own tool is the pattern it targets.
- Optional FAQPage mirroring the visible questions verbatim.
- Do not add Article, HowTo (dead since 2023) or SiteNavigationElement.

Do not build scoring-variant URLs (/ppr, /standard) or week URLs (/week-3).
Every ranking tool in the set uses one permanent URL with the week injected at
render time. Eighteen near-identical pages a season splits authority eighteen
ways and lands inside Google's scaled content abuse policy, which names
"creating content variations for every query permutation".

### 2.5 Product spec: the start/sit board

The question the board answers: "Of these players, which K should I start
this week?" K defaults to 1.

Inputs, all in the URL so every state is linkable and the redirect from the
old slug keeps old links working:
- ?p=slug1,slug2,...,slugN. Two to eight player slugs, comma separated,
  order preserved (it is the order the reader added them, and the cards keep
  it until the verdict re-sorts). ?a=&b= is accepted as an alias and
  normalised into ?p=a,b on the server; the canonical never carries either.
- ?start=K. Integer, 1 to N-1, default 1. Labelled on screen "How many of
  these do you start?" as a native number input with a visible label, min 1,
  max N-1, step 1, plus minus/plus buttons that are real buttons with
  accessible names ("Start one fewer", "Start one more"). It is not a slot
  model; the reader has already decided which slot they are filling.
- ?week=W. Regular-season week, default the live week from resolveSeasonClock.
  Rendered as a native select of the remaining weeks ("Week 3 (this week)",
  "Week 4", ...). Past weeks are not offered: a played week is the Decisions
  page's question.
- ?lens= is retired from the URL. The three lenses survive inside the
  Background tab (section 2.7) as the existing Dynasty / Win now switch; the
  headline verdict is always this week.
- ?league=&roster= keep working exactly as today and unlock the "Your
  lineup" tab.
- Format and value source: from the site header as today, shown as read-only
  chips with the "Change format or source from the site header" note. The
  format chip drives scoring (section 2.6). The value-source chip drives the
  Market tab only; it never touches the verdict.

The player picker. One WAI-ARIA combobox (the existing breakdown-selector.tsx
pattern, hitting /api/breakdown/search with the same same-origin guard) with
an "Add player" affordance that appends a chip to a list above it. Chips are
real buttons ("Remove Bijan Robinson from the comparison"). The list is a
role="list" with the players in add order. A duplicate pick is refused inline
with role="alert" ("Bijan Robinson is already in the comparison"). At eight
players the combobox is disabled with a visible reason and an sr-only one in
the same element. Pressing "Who should I start?" (the run button) pushes the
URL; the server renders the result. The picker works without JavaScript for
the URL-driven path (a plain form with a text input that accepts a comma list
of names is the no-JS fallback and is also what the toughest-calls links use).

Why eight. Every player costs the same reads a Beacon Breakdown side costs
today (values, trends, rankings, finishes, projections for the remaining
season, accuracy, reliability weeks, market, stats). The docs/performance
audit measured the market column alone at 0.6 to 1.3 seconds for two players.
Eight is the point past which the row of cards stops being readable at any
width and the request stops being cheap. It is a named constant,
MAX_START_SIT_PLAYERS, in lib/start-sit/types.ts, and the copy that states
the limit reads it.

The result, top to bottom:

1. The verdict line, one sentence, role="status", rendered in the HTML:
   "Start Bijan Robinson. He projects 2.4 points clear of Josh Jacobs in
   PPR, 71 percent to outscore him." For K greater than 1: "Start Bijan
   Robinson and Josh Jacobs. The last spot is close: Jacobs is 55 percent to
   outscore Alvin Kamara." The sentence is a deterministic template
   (section 2.6); every figure in it is on the cards below.

2. The card row. One card per player, laid out horizontally in a scroll
   container (overflow-x auto, tabIndex 0, sr-only caption, snap-x on touch)
   at every width, following the TableShell pattern in
   app/tools/on-the-clock/draft-pulse-board.tsx lines 433-455. Nothing is
   hidden at any breakpoint; on a phone the row scrolls, and a "Show as a
   list" toggle stacks the same cards vertically for a reader who prefers it.
   Starters come first, then the bench, each group in descending projected
   points. Each card is an article with the player's name as its h3, and it
   carries, in this order:
   - A START or SIT badge, using the TeamStatusBadge pattern
     (components/team-status-badge.tsx): icon plus word plus colour, never
     colour alone. START cards get a rank ("Start 1 of 2"). The badge is the
     first thing after the name so a screen reader hears the answer before
     the numbers.
   - Headshot, position pill (POSITION_BADGE tokens), team, opponent via
     opponentLabel() from components/league-schedule/format.ts (which never
     guesses venue), bye handling ("On bye" replaces the whole projection
     block, and the card is SIT with reason "Bye week").
   - Projected points, large, as a StatTile hero
     (components/manager-pulse/stat-tile.tsx), with the floor and ceiling
     beside it in small type ("Floor 8.1, ceiling 21.6", computed as mean
     minus and plus one sigma, clamped at zero).
   - Matchup: the opponent multiplier as a word and a number ("Matchup:
     favourable, 1.08") with the defence's rank against the position.
   - Game environment: implied team total and tier from
     lib/nfl-game-environment.ts, with "No line yet" as the null sentence.
   - Reliability: beat rate and availability rate as percentages, with the
     "not enough graded weeks" sentence when weeksPlayed is under the
     existing MIN_GRADED_WEEKS.
   - Injury status when present, using components/player-profile/injury-status
     tone rules but as a one-line pill, not the full card.
   - Market value and overall rank under the header source, marked with the
     BeaconValue icon when the source is FF Beacon. This is context; the copy
     under the card row says so ("Value is what he is worth in a trade, not
     what he scores this week").
   Every figure is one text node with only the MISSING words appended as
   sr-only inside the same element. Nothing visible is aria-hidden except
   icons and the decorative hairline. This is the Lineups board rule and it
   applies here for the same reason (a pointer-following screen reader that
   finds a hidden twin goes silent).

3. The confidence meter. A two-sided bar built on the WinProbBar component
   (components/league-schedule/win-prob-bar.tsx) showing the probability that
   the K-th starter outscores the first benched player, with both names on
   the ends, a "Close call" or "Clear call" text pill, and one sr-only
   sentence. For K equal to 1 and N equal to 2 this is simply P(A beats B).

4. The reasons. Three to five sentences, deterministic templates from
   lib/start-sit/reasons.ts (section 2.6), each citing a figure on a card. A
   null figure means the sentence does not fire. Examples: "Robinson has the
   better matchup: Atlanta's opponent allows the fourth-most points to running
   backs." "Jacobs has beaten his projection in 6 of 8 graded weeks; Kamara in
   3 of 8." "Kamara's game has the lowest implied total of the three."

5. A "Copy link" and a "Copy as image" pair (components/copy-link-button.tsx,
   components/copy-image-button.tsx) pointing at the new OG route.

6. The Background tabs (section 2.7): "Head to head" (renamed from The
   Breakdown), "Your lineup" (with a league), "Projections", "Reliability",
   "Market", "Stats". All generalised to N players. This is where every piece
   of data the tool shows today lives on; none of it is removed.

Empty state (no ?p=): the masthead with the H1, the picker, the stepper set
to 1, the toughest-calls grid, and the full written outline from section 2.4.
No skeleton where content should be. The four "How it works" cards are
replaced by the written sections, which say the same things with more words
and headings a crawler can read.

Loading: the board streams behind a Suspense boundary with the existing
AnalysisSkeleton and its sr-only "Working out who to start." status. The H1,
the picker and the written sections are outside the boundary and paint first.

Error and not-found: unchanged patterns (role="alert" "We couldn't find
those players..."), plus a new one for a week with no projections yet ("No
projections for Week 9 yet. They usually land on Tuesday.").

Live week and in-progress games: the board evaluates the selected week on
projections only. A week with points on the board is still graded on
projections here; results belong to the Decisions and Lineups pages. The copy
says so under the board during a live week: "Games are underway. This verdict
is what the projections said before kickoff."

Mobile: the card row scrolls, the stepper and picker stack, the confidence
bar is full width, and the tabs keep the existing horizontal-scroll tablist.
Tap targets stay at 44 by 44. No data is hidden at any breakpoint.

### 2.6 Engine spec: lib/start-sit/

A new pure module. It introduces no new model: every number it emits comes
from a function that already exists and is already used by Power Pulse,
Lineups, FAAB and Trade Ideas. The module's job is to ask those functions the
start/sit question and to say the answer in words.

Files:

- lib/start-sit/types.ts. Shapes and the constants. MAX_START_SIT_PLAYERS =
  8, MIN_START_SIT_PLAYERS = 2, DEFAULT_START_COUNT = 1. The header carries
  the rules from this section so a future reader does not have to find this
  document.

```ts
export type StartSitCandidate = {
  playerId: string;            // players.id
  slug: string;
  sleeperId: string | null;
  name: string;
  position: PulsePosition;     // QB RB WR TE K DEF; anything else is refused at load
  team: string | null;
  injuryStatus: string | null; // players.metadata.sleeper.injury_status
};

export type StartSitProjection = {
  playerId: string;
  week: number;
  points: number | null;       // adjusted, under the resolved scoring; null = absent week (bye, unpublished)
  rawPoints: number | null;
  sigma: number | null;
  floor: number | null;        // max(0, points - sigma)
  ceiling: number | null;      // points + sigma
  opponent: string | null;
  opponentMultiplier: number | null;
  defenseRankVsPosition: number | null;
  beatRate: number | null;
  availabilityRate: number | null;
  weeksGraded: number;
  environment: GameEnvironment | null;
  environmentTier: EnvironmentTier | null;
  onBye: boolean;
  availability: "projected" | "out" | null;  // player_weekly_projections.availability, verbatim
};

export type StartSitVerdict = {
  week: number;
  season: number;
  startCount: number;
  starters: string[];          // playerIds, descending points
  bench: string[];             // playerIds, descending points
  marginPoints: number | null; // starters[last].points - bench[0].points
  confidence: number | null;   // P(starters[last] > bench[0]); null when either sigma is null
  callLabel: "clear" | "lean" | "toss-up" | "unmeasured";
  reasons: string[];           // deterministic templates, section below
  projectionSource: string;    // the resolved slug, for the label
};
```

- lib/start-sit/rank.ts. Pure. rankForWeek(candidates, projections,
  startCount): the K best of N. Ordering rule, in this order: a player with
  points null (bye, unpublished, position unprojectable) is always benched and
  never counted toward K; among the rest, descending adjusted points; ties
  broken by higher floor, then by higher beat rate, then by slug so the order
  is stable. No slot model. The reader has decided what slot they are
  filling; this is the unconstrained top-K. The research on the optimiser
  (lib/power-pulse/lineup.ts) concluded a matroid fill is the wrong tool here
  because there is no "any position" token in PULSE_SLOT_ELIGIBILITY and
  inventing one just to bypass the slot logic defeats the point; a sort is
  correct and obviously so. Mixed positions are allowed (a flex decision
  between an RB and a WR is exactly the use case), and the copy states that
  points are compared directly across positions.

- lib/start-sit/confidence.ts. Pure. The probability the K-th starter
  outscores the first benched player: winProbability(meanK, sigmaK, meanB,
  sigmaB) from lib/power-pulse/math.ts, the same function the Schedules board
  and the Lineups what-if use for the same kind of question. callLabel
  thresholds: 0.65 and up "clear", 0.55 to 0.65 "lean", under 0.55 "toss-up",
  null "unmeasured". Nobody in the competitor set publishes a probability;
  this is the honest differentiator and it costs nothing.

- lib/start-sit/reasons.ts. Pure. Deterministic sentence templates, the Trade
  Ideas rule: every sentence cites a figure that is on a card, and a null
  figure means the sentence does not fire. Candidates, in priority order,
  capped at five: projection margin ("{A} projects {x} points clear of {B} in
  {format}"), matchup ("{A} has the better matchup: {opponent} allows the
  {nth}-most points to {position plural}"), reliability ("{A} has beaten his
  projection in {m} of {n} graded weeks; {B} in {p} of {q}"), environment
  ("{B}'s game has the lowest implied total of the {N}, at {t}"), floor or
  ceiling depending on which side of even the confidence sits ("If you need a
  safe floor, {A}'s is {f} points to {B}'s {g}"), bye and injury ("{C} is on
  bye" / "{C} is listed {status}"), and the mixed-position note when
  positions differ ("Points are compared directly across positions here;
  a flex slot is the usual reason to do that"). Names come from the players
  row; no possessive apostrophe is produced by the template except the
  straight one.

- lib/start-sit/load.ts. Server only. Every read for one board, in three
  waves so the header paints first:
  1. resolveSeasonClock() (lifted from lib/breakdown/load-extras.ts into
     lib/start-sit/clock.ts and re-exported from the old location so the
     Breakdown extras keep importing it), the players rows for the slugs
     (the PLAYER_SELECT list from lib/beacon-breakdown.ts), format and source
     through resolveFormatSlug and resolveSourceSlug, active formats through
     getActiveFormats.
  2. loadPowerPulseSettings, then loadAdjustedProjections from
     lib/projections/read.ts with { playerIds, season, fromWeek: week,
     toWeek: week, scoringSettings: scoringSettingsForFormat(format),
     positionByPlayer, injuryByPlayer, currentWeek }. That one call resolves
     the projection source through resolveProjectionSourceForWindow with
     settings.beaconProjections, loads accuracy and defence splits scoped to
     the SAME source, and runs projectPlayerWeek per player. It is the shared
     read path both guard tests exist to protect, so the new module needs no
     allow-list entry in lib/projections/source-guard.test.ts or
     lib/projections/raw-column-guard.test.ts.
  3. In parallel: loadGameEnvironment(season, week) from
     lib/nfl-game-environment.ts, and the defence rank for each opponent and
     position (a new small reader over nfl_defense_vs_position that returns
     rank within the season for the scoring base; add it beside
     loadDefenseSplits in lib/power-pulse/load.ts). loadAdjustedProjections
     returns points, rawPoints and opponent per week today; extend
     AdjustedProjection with sigma, opponentMultiplier, beatRate,
     availabilityRate and weeksPlayed rather than re-reading, since
     projectPlayerWeek already has them in hand. That extension is a
     backwards-compatible field addition and lib/projections/read.test.ts
     gains a case for it.

- lib/start-sit/engine.ts. Pure. computeStartSit(input): StartSitVerdict.
  Takes plain data, calls rank, confidence, reasons. Tests run against
  fixtures with no database.

- lib/start-sit/toughest-calls.ts. Section 2.8.

- lib/start-sit/copy.ts. Client-safe strings: the labels, the call words,
  the week sentence. Nothing here imports a server module.

The format-to-scoring helper, the one genuinely new piece of arithmetic. Add
to lib/league-scoring.ts:

```ts
export function scoringSettingsForFormat(format: {
  scoring_type: string;        // "ppr" | "half_ppr" | "standard"
  te_premium_bonus: number | null;
}): ScoringSettings {
  const rec = format.scoring_type === "ppr" ? 1 : format.scoring_type === "half_ppr" ? 0.5 : 0;
  const settings: ScoringSettings = { rec };
  if (format.te_premium_bonus && format.te_premium_bonus > 0) {
    settings.bonus_rec_te = format.te_premium_bonus;
  }
  return settings;
}
```

Why it exists: scoreWithFallback reads the stored pts_ppr / pts_half_ppr /
pts_std column when the scoring map is unusable, and closestScoringBase
picks the column from settings.rec. With scoringSettings null the base is
always pts_std. A minimal { rec } map makes closestScoringBase pick the right
column for the reader's format, and the TE premium add-on in scoreWithFallback
(lib/league-scoring.ts lines 184-192) applies on top. This helper is also the
fix for the latent Beacon Breakdown defect in section 2.1, so
lib/breakdown/load-extras.ts adopts it in the same change. Test: a PPR
format produces pts_ppr for a WR with 6 receptions; a half-PPR format
produces pts_half_ppr; a TEP format adds te_premium_bonus times receptions
for a TE and nothing for a WR; standard produces pts_std.

Projection source, restated as the contract the module must satisfy:
- The source is resolved by loadAdjustedProjections (which calls
  resolveProjectionSourceForWindow) for the (season, week, week) window. It
  makes zero queries while beaconProjections.enabled is false.
- The label on the page ("Projections: Sleeper") is
  projectionSourceDisplay(verdict.projectionSource), the resolved slug from
  the same read, never a hardcoded word and never the no-argument
  currentProjectionSourceCached() (which answers a different question,
  "what season do we hold", and is pinned to Sleeper by design).
- The source is part of every cache key that outlives a flip: the
  toughest-calls unstable_cache key and the OG image's cache key both carry
  it (section 2.8 and 2.10).
- Enumeration reads (which season has projections, which weeks remain) stay
  pinned to SLEEPER_SOURCE with the comment that Sleeper is the coverage
  baseline. resolveSeasonClock already does this correctly.

Rate limiting. The base board is a GET rendered on the server, capped at
eight players, and it shares the existing budget shape of Beacon Breakdown
(no limit on the base run, "breakdown_league" at 20 per minute for league
mode, "og_breakdown" at 20 per minute for the image, "breakdown_connect" at
10 per minute for the connector). No new bucket for the base run: the cap on
N is the guard. If load testing after launch shows the Sunday-morning peak
needs one, the seam is one claimRateLimitSlot call in lib/start-sit/load.ts
after validation and before wave 2, failing to a visible "busy" state rather
than an error, the way the Lineups free-agent panel does.

### 2.7 The background tabs: generalising the pairwise engine to N

The owner wants every piece of information the tool shows today kept, with
the start/sit verdict in front of it. The pairwise Beacon Edge engine is also
a live dependency of BEAM (lib/beam/capabilities/player-compare-verdict.ts
calls loadBreakdown, loadBreakdownExtras and assembleBreakdown and returns
the verdict sentence verbatim). So the engine is kept, and generalised
without breaking its two-player surface.

The change in lib/breakdown/metrics.ts: each Metric gains an optional
`scalar(side: MetricSide): number | null`, a per-side value where higher is
better, alongside the existing `share(a, b)`. For 17 of the 19 metrics the
scalar is the value share() already compares (value, rank negated, trend
percentage, finish negated, role weight, health score, projected points,
multipliers, age via youthScore, upside, beat rate, availability,
consistency negated, safety score, lineup impact, weeks starting, playoff
odds delta). The two blended, unscored outlook rows keep their phrase
display and have no scalar.

lib/breakdown/edge.ts gains computeGroupEdge(sides: MetricSide[], lens):
for each scored metric with a scalar on at least two sides, rank the sides
and convert rank to a 0..1 share ((N - rank) / (N - 1)); renormalise weights
over metrics that resolved, exactly as computeEdge does; the composite per
side is the weighted mean of its shares. The identity that the existing
test pins (contributions sum to the composite) holds per side. For N equal
to 2 computeGroupEdge must reproduce computeEdge's leader and label; a test
pins that so the pairwise surface and BEAM are unaffected.

The tabs, each taking sides: BreakdownPlayer[] instead of a pair:
- Head to head (was The Breakdown): the BreakdownTable becomes N columns
  with the category label as the row header, one cell per player, and a
  "Best" badge on the top-ranked cell (was "Edge"). On mobile each row
  collapses to the category then a 2-up grid of cells, as today; with more
  than four players the grid wraps to more rows. The edge meter becomes a
  ranked horizontal bar list (RankedBars from components/manager-pulse/
  charts.tsx) of composite scores, one bar per player, with the lens switch
  above it (Dynasty / Win now / This week; the lens lives in the tab's own
  state, not the URL). The contribution chart stays a diverging chart for
  N equal to 2 and becomes a per-player StackedShareBar for N above 2.
- Your lineup (was Your league): calculateLeagueImpact already runs once per
  candidate; it takes the list. The weekly start/bench grid becomes N rows.
- Projections: the weekly line chart takes N series. components/chart-kit.tsx
  POSITION_SERIES gives six distinguishable series (colour plus dash plus
  marker); for players seven and eight extend it with two more entries in
  the same file (a solid grey with a plus marker, a dotted white with a
  hexagon), validated with the dataviz contrast formula the file documents.
  The schedule strip and the floor/ceiling range bars become N rows.
- Reliability: N cards, N strips.
- Market: the 90-day value overlay takes N series; the real-trades list
  shows the most recent three per player under a per-player disclosure.
- Stats: StatsCompare becomes an N-column table with the same 24 stats;
  "Best" badge per row.

Everything in this section is additive. lib/breakdown/types.ts gains
BreakdownGroup { sides: BreakdownPlayer[]; edges: GroupEdge } beside the
existing pair shapes; lib/beacon-breakdown.ts loadBreakdown accepts a slug
list (two to eight) and returns a group, with loadBreakdownPair as a thin
wrapper that BEAM and the old OG route keep calling.

### 2.8 The toughest-calls block

What it is: eight to twelve real comparisons for the live week, pre-computed
and server-rendered on the empty state, each a link that opens the board
pre-filled. Three per position appear again under the positional headings.

How a call is chosen, in lib/start-sit/toughest-calls.ts, pure over plain
data:
- Universe: players in the current rankings for the reader's format
  (rankings, week null, freshest generated_at) with position in the six
  projectable positions and a projection row for the live week.
- Startable cut: top 16 QB, 30 RB, 36 WR, 14 TE, 12 K, 12 DEF by positional
  rank. Constants in the file.
- Pairs: adjacent and near-adjacent by projected points within a position
  (each player against the next three below him), scored by closeness:
  absolute points difference under 2.0, then the pair whose winProbability
  is nearest 0.5 first.
- Diversity: at most one appearance per player across the twelve, at least
  one pair per position where a pair exists.
- Output: { a, b, week, points, confidence, verdict } per pair, and the
  verdict sentence is the same template the board prints.

Caching: unstable_cache keyed ["start-sit-toughest", season, week,
formatSlug, projectionSource], revalidate 6 hours, tag
CACHE_TAGS.playerProjections so the nightly projection sync and any
injury-driven re-sync revalidate it. The source in the key is what keeps a
switch flip from serving Sleeper's calls under an FF Beacon label for six
hours. The block renders inside the same request as the page, so it is in the
initial HTML.

Why this and not a "most-run comparisons" table: that needs a write on every
public GET, a new table with RLS, and a warm-up period; the algorithmic
version is honest on day one and the pairs it picks are, by construction,
the ones a reader would actually be torn about.

### 2.9 File architecture and the move

Route folder, after git mv app/tools/beacon-breakdown
app/tools/who-should-i-start:

- page.tsx: generateMetadata (section 2.4), the masthead with the H1 in both
  states, the written sections as server components, the Suspense boundary
  around the board, the toughest-calls block. Keeps force-dynamic (it reads
  cookies for format and source).
- start-sit-board.tsx (new, server): the verdict line, the card row, the
  confidence bar, the reasons, the copy buttons.
- start-sit-card.tsx (new, server): one card. Uses Panel from
  components/dashboard-panel.tsx for the shell, StatTile for the projected
  points, a new small StartSitBadge in components/start-sit-badge.tsx built
  on the TeamStatusBadge pattern (icon plus word plus colour), PlayerHeadshot,
  POSITION_BADGE, opponentLabel.
- start-sit-picker.tsx (new, client): the multi-player combobox with chips
  and the start-count stepper. Built from breakdown-selector.tsx, which is
  then deleted.
- week-select.tsx (new, client, tiny): the native select that pushes ?week=.
- written-sections.tsx (new, server): every H2 from section 2.4 with its
  copy, pulling the week and the projection source display name as props.
  The FAQ is a list of details/summary elements; closed details are fine for
  crawlers because the text is in the DOM.
- toughest-calls.tsx (new, server): the grid.
- The tabs and their files stay, renamed where the name lies:
  breakdown-tabs.tsx (keep), breakdown-table.tsx, breakdown-summary.tsx
  (the takeaways move into the Head to head tab), edge-contribution-chart.tsx,
  beacon-edge-meter.tsx (becomes the ranked bar list), league-panel.tsx,
  league-tab.tsx, lens-switch.tsx (moves inside the Head to head tab, becomes
  a button group with aria-pressed rather than links, since it no longer
  changes the URL), market-tab.tsx, projections-tab.tsx, reliability-tab.tsx,
  stats-compare.tsx, stats-data.ts, load-stats.ts, matchup-header.tsx
  (deleted; the card row replaces it), actions.ts (keep), chart-kit.tsx shim
  (delete; import from components/chart-kit directly).

Lib:
- lib/start-sit/ as in section 2.6.
- lib/beacon-breakdown.ts: loadBreakdown takes a slug list; loadBreakdownPair
  wrapper for BEAM and the old OG route.
- lib/breakdown/*: scalar on Metric, computeGroupEdge, group types.
- lib/league-scoring.ts: scoringSettingsForFormat.
- lib/projections/read.ts: AdjustedProjection gains sigma,
  opponentMultiplier, beatRate, availabilityRate, weeksPlayed.
- lib/power-pulse/load.ts: loadDefenseRanks(supabase, scoring, season):
  Map keyed team|position to { rank, of }.
- The live week stays resolveSeasonClock, moved to lib/start-sit/clock.ts
  and re-exported from lib/breakdown/load-extras.ts.
- lib/site.ts, lib/tools-catalog.ts, lib/breadcrumbs.ts, lib/nav-tree.ts,
  lib/bookmarks/icon.ts, lib/sitemap/sections.ts: the path and label changes
  from section 2.2.
- lib/llms/context.ts: the "Beacon Edge" glossary line is rewritten to
  describe the start/sit verdict and the confidence figure; a "Start / Sit"
  tool line is added to the tools list; lib/llms/build.test.ts's assertion on
  "Beacon Breakdown" still passes because the name survives.

API:
- app/api/breakdown/search/route.ts: unchanged.
- app/api/og/breakdown/[a]/[b]/route.tsx: unchanged, keeps serving pair
  cards.
- app/api/og/start-sit/route.tsx (new): section 2.10.
- app/api/og/page/[key]/route.tsx: the "beacon-breakdown" card copy from
  section 2.4; the key stays "beacon-breakdown" (it is an internal key).

### 2.10 The share image

New route app/api/og/start-sit/route.tsx, GET with ?p=slugs&start=K&week=W&
format=&source=. runtime nodejs, 1200 by 630, the same headers as every OG
route. Rate limited on the "og_breakdown" bucket (same budget, same reason).
Runs lib/start-sit/load.ts and computeStartSit so it cannot disagree with
the page. Layout: wordmark and "Who should I start? Week {N}" top left, the
verdict sentence as the headline, then up to eight small cards in a row
(headshot, name, points, START or SIT), the confidence figure bottom right,
"ffbeacon.com" footer. Fonts, logo and image loading from lib/og/assets.ts.
Brand only: base #07070D, purple to cyan gradient, Geist. No gold, no
#0c0c18.

The in-process cache key for the rendered card includes the projection
source slug; the page's og:image URL includes ?source= for the value source
only, as today, because the projection source is global and not a reader
choice.

### 2.11 BEAM

lib/beam/capabilities/player-compare-verdict.ts and player-compare-stat.ts
keep calling the pair loaders. Their outbound links change to
/tools/who-should-i-start?p={a},{b} with labels "Open the start/sit
breakdown" and "Full head-to-head in Beacon Breakdown". lib/beam/engine.ts
line 64's out-of-scope suggestion for trades points at the new trade
calculator slug (section 3). The BEAM interpreter's phrase list for the
compare capability should gain "who should I start", "start or sit", "start
X or Y" if it does not already route them; check lib/beam/interpret/.

### 2.12 Every inbound link and label that changes

From the exhaustive grep (50 files). Runtime code first, then docs.

Navigation and catalogue (section 2.2 has the new strings):
- lib/site.ts lines 88-92 (TOOLS_NAV), 169-174 (SEARCHABLE_TOOLS), 284-289
  (FOOTER_COLUMNS).
- lib/tools-catalog.ts lines 34 (ToolHref union) and 81-94 (card).
- lib/breadcrumbs.ts line 66.
- lib/nav-tree.ts line 46, lib/bookmarks/icon.ts line 53 (path key only).
- lib/sitemap/sections.ts line 110.
- app/tools/page.tsx lines 101-108 (TOOL_ICONS key) and 120-124.

Prose links, each gets a long-form anchor from section 2.2 (rotate them):
- app/page.tsx lines 119-124: title "Beacon Breakdown: Who Should I Start?",
  description "Put your players in and get a start/sit verdict built from
  this week's projections and matchups, with the confidence to back it.",
  cta "Find out who to start".
- app/about/page.tsx lines 269-274: title "Start / Sit", body "Who should I
  start? Beacon Breakdown answers it from this week's projections and
  matchups."
- app/author/michael/page.tsx: the LinkTile list of things built (lines
  227-273) if it names Beacon Breakdown; anchor "the Beacon Breakdown
  start/sit tool".
- app/leagues/[league_id]/teams/[roster_id]/page.tsx lines 269-277: href
  /tools/who-should-i-start?league=...&roster=..., button text "Who should I
  start from this roster?" (the league-connected board pre-fills the league).
- app/leagues/[league_id]/lineups/page.tsx: add one link in the bench or
  moves panel, anchor "compare just these players", href with ?p= of the
  bench candidates and ?league=&roster= set. This is the reciprocal link
  that keeps the two pages on different jobs.
- lib/beam/capabilities/player-compare-verdict.ts lines 223-228 and
  player-compare-stat.ts lines 182-187: hrefs and labels per section 2.11.
- lib/beam/engine.ts line 64: trade calculator slug (section 3).
- app/api/og/page/[key]/route.tsx lines 133-142: card copy per section 2.4.
- lib/llms/context.ts lines 89-93: glossary line rewritten.
- lib/guides/fantasy-football-terms.ts: if the glossary has a "start/sit"
  or "flex" entry, add the link with anchor "our start/sit tool"; if not,
  add a "Start/sit" term (definition plus the link), which is also the
  cheapest new internal link into the page.
- The trade calculator page's "smaller than a trade" hand-off in the
  opposite direction, if present, uses "who should I start this week".

Code comments and docs that cite the old path (accuracy only, no behaviour):
components/chart-kit.tsx lines 33-39, components/league-category-tabs.tsx
lines 22-27, app/games/signal-scout/leaderboard-panel.tsx lines 197-205,
lib/sleeper-handle/validate.ts lines 13-18, lib/signal-scout/stats-bundle.ts
lines 21-24, lib/beam/stats/registry.ts lines 18-24, docs/beam/beam-plan.md,
docs/beam/beam-build-report.md, docs/saved-handle/saved-handle-plan.md,
docs/league-providers/league-providers-and-yahoo-plan.md line 1404
(permission key tools.beacon_breakdown stays; it is an identifier),
docs/performance/site-speed-audit-and-plan.md, docs/beacon-link/
beacon-link-plan.md. progress.md entries are history and stay.

Retired copy, deleted wherever it appears: "Two players. One verdict.",
"Compare two players head-to-head", "Player comparison", "Compare players",
"Drop any two players into a matchup card", "Torn between two players?".

### 2.13 Tests

- lib/start-sit/rank.test.ts: top-K ordering; null points always benched and
  never counted; K clamped to N-1; ties stable; mixed positions allowed.
- lib/start-sit/confidence.test.ts: P equals 0.5 at equal means; null when a
  sigma is null; label thresholds at the boundaries.
- lib/start-sit/reasons.test.ts: every template fires only with its figure
  present; no em dash, en dash, curly quote or ellipsis character in any
  output (the same fixture pattern lib/manager-pulse/narrative.test.ts uses).
- lib/start-sit/engine.test.ts: fixture boards for N of 2, 3 and 8; K of 1
  and 3; a bye; an "out" availability; confidence and margin agree with the
  cards.
- lib/start-sit/toughest-calls.test.ts: diversity rules; startable cuts;
  closeness ordering; deterministic output for a fixed input.
- lib/league-scoring.test.ts: scoringSettingsForFormat cases from section
  2.6.
- lib/projections/read.test.ts: the new AdjustedProjection fields.
- lib/breakdown/edge.test.ts: computeGroupEdge with N of 2 equals
  computeEdge; contributions sum per side; missing scalars drop out.
- lib/projections/source-guard.test.ts and raw-column-guard.test.ts: pass
  with no new allow-list entry. If either needs one, the design is wrong.
- lib/llms/build.test.ts: the tool list carries "Start / Sit" and "Beacon
  Breakdown"; the crawlability test sees the new path.
- A metadata test for the page: title length under 60 with the absolute
  form, description under 155 at Week 18, canonical never carries a query,
  and the templated week equals resolveSeasonClock's week at a fixture
  Tuesday-rollover boundary.
- A redirect check: curl -I in the rollout checklist, since next.config
  redirects are not unit-tested in this repo today.

### 2.14 Accessibility contract

The existing rules hold and three are restated because the new layout
invites breaking them:
- One visible H1 in every state. Heading levels do not skip: H2 sections,
  H3 per card and per FAQ question.
- The card row is a scroll region with tabIndex 0 and an sr-only caption;
  cards are articles with the START/SIT badge before the numbers; every
  figure is one text node with missing words appended sr-only inside the
  same element; icons and the hairline are the only aria-hidden things.
- The stepper is a native number input with a visible label plus real
  buttons; the week picker is a native select; the picker chips are real
  buttons with full accessible names; the removal of a chip moves focus to
  the combobox; the run button's result is announced once through the
  role="status" verdict line, not through a second live region.
- Confidence bar: text pill and sr-only sentence; never colour alone.
- Colour: START uses signal.success plus icon plus word; SIT uses ink.muted
  plus icon plus word.
- Reduced motion: no animation on the board at all; the only motion is the
  existing dialog transitions, which already honour motion-reduce.
- Before marking complete, the accessibility review sub-agent confirms "no
  data hidden at any breakpoint" and walks the board with a screen reader
  in table-navigation mode and in browse mode.

### 2.15 Rollout order and the Search Console steps

1. Land the engine and the scoring helper with tests, behind no flag (pure
   code, no surface).
2. Land the generalised breakdown engine with the N equals 2 parity test.
3. Build the new route folder in place under the OLD path first (so the diff
   is reviewable), including the written sections and the toughest-calls
   block.
4. Move the folder, add the redirect, change every label and link (section
   2.12), update the sitemap, bump the OG card copy. One commit.
5. Deploy. Then: curl -I the old URL and confirm 308 to the new one with the
   query preserved; open the new URL logged out and confirm the H1, week
   label, timestamp, toughest-calls grid and every H2 are in view-source;
   validate the JSON-LD with the Rich Results test; ping IndexNow for both
   URLs (section 5); in Search Console request indexing on the new URL and
   watch Page indexing over the next weeks for the old URL to move to "Page
   with redirect"; submit the updated sitemap. No Change of Address (it is
   for domain moves only).
6. Two weeks after launch, pull the Search Console query report for the page
   and the Bing Webmaster Tools AI Performance report, and revisit the
   positional copy against what is actually pulling impressions.

## 3. Task 2: the trade calculator slug

Finding: commit 8ae3504 changed the title ("Fantasy Football Trade
Calculator: Signal Check"), the description, the H1 ("Fantasy Football Trade
Calculator: Signal Check"), the nav and footer labels ("Trade Calculator"),
the breadcrumb and the /tools card. It did not change the URL. The route is
still app/tools/signal-check, the canonical is still "/tools/signal-check",
and next.config.ts has no redirect for it. No reserved-routes migration is
needed for a rename (top-level segments only). There is no IndexNow
implementation anywhere in the repo; INDEXNOW_KEY is declared and unused.

Decision: /tools/trade-calculator. Reasons: it matches the label already
shipping in the nav and footer, it is the head term, every sibling tool slug
is short, and "fantasy football" is in the title and H1 where it has room.
The owner confirmed this slug on 2026-09-10; the longer
/tools/fantasy-football-trade-calculator form is not used.

Redirects, next.config.ts, house style (explicit, commented, permanent):

```ts
{
  source: "/tools/signal-check",
  destination: "/tools/trade-calculator",
  permanent: true,
},
{
  source: "/tools/signal-check/v/:shareId",
  destination: "/tools/trade-calculator/v/:shareId",
  permanent: true,
},
```

Two explicit entries rather than a :path* catch-all, matching the
trade-finder precedent at next.config.ts lines 126-130, so a future child
route under the old path is a deliberate decision rather than a silent
forward. Share links live in Discord messages and group chats indefinitely;
the second entry is what keeps them alive.

Steps, in order:
1. git mv app/tools/signal-check app/tools/trade-calculator (the v/[shareId]
   subfolder moves with it).
2. Fix the one module import that breaks: app/tools/on-the-clock/actions.ts
   line 23, "@/app/tools/signal-check/actions" becomes
   "@/app/tools/trade-calculator/actions".
3. Add the two redirects.
4. Update every URL reference (all verified 2026-09-10):
   app/tools/trade-calculator/page.tsx lines 39 (canonical) and 46
   (pageShareMetadata path); v/[shareId]/page.tsx line 206 (back link);
   actions.ts line 94 and import-actions.ts line 655 (shareUrl strings);
   sleeper-import-panel.tsx lines 269 and 276 (login next path and
   SaveHandleNotice nextPath); signal-check-workspace.tsx line 56 comment;
   app/tools/page.tsx line 106 (icon map); app/api/og/page/[key]/route.tsx
   line 100 (PAGE_CARDS path); app/page.tsx line 128; app/about/page.tsx
   line 263; app/author/michael/page.tsx line 253; app/my-beacon/page.tsx
   line 93; app/my-beacon/sleeper-leagues/page.tsx line 225 (keep
   #sleeper-import); app/guides/fantasy-football-terms/page.tsx line 473;
   lib/guides/fantasy-football-terms.ts lines 654 and 1043; the Beacon
   Breakdown page's hand-off link (line 699 today); app/games/
   would-you-rather/page.tsx line 226; lib/beam/engine.ts line 64;
   lib/site.ts lines 85, 155, 287; lib/tools-catalog.ts lines 35 and 110;
   lib/breadcrumbs.ts lines 70, 71, 87; lib/nav-tree.ts line 45;
   lib/bookmarks/icon.ts line 58; lib/sitemap/sections.ts line 114.
5. Leave the two API routes where they are: app/api/og/signal-check/
   [shareId]/route.tsx (cached unfurls hold the literal image URL) and
   app/api/signal-check/search/route.ts (same-origin, never indexed).
6. Leave every internal identifier alone: /admin/signal-check, the
   signal_check* settings categories, the signal_check_rulesets,
   signal_check_rules, signal_check_audit_log and signal_check_analyses
   tables, lib/signal-check/*, lib/league-signal-check.ts,
   components/signal-check-trade-card.tsx, the "settings:signal_check" memo
   key. They are internal names with no search exposure, and the Data
   Architecture rule says internal names describe what the thing is, not
   what the marketing page is called.
7. Update lib/llms/build.test.ts line 123's regex from the signal-check share
   path to the new base. llms.txt itself is generated from
   lib/tools-catalog.ts and lib/site.ts and needs no edit.
8. Correct the stale-comment references for accuracy: app/tools/on-the-clock/
   trade-analyzer.tsx line 24, signal-check-report.tsx line 6,
   app/tools/loading.tsx line 17, app/leagues/[league_id]/transactions/
   page.tsx line 317, app/games/would-you-rather/verdict-panel.tsx line 10,
   lib/would-you-rather/types.ts line 162, side-names.ts line 19, round.ts
   line 117, grade.ts line 5, lib/league-signal-check.ts line 5,
   lib/league-pick-position.ts line 34, lib/league-relay/trade-writeup.ts
   line 11, lib/league-relay/side-names.ts lines 6 and 18,
   components/signal-check-trade-card.tsx line 4, components/trade-ideas/
   trade-outcome.tsx lines 54 and 297, app/games/signal-scout/score-meter.tsx
   line 6, result-card.tsx line 4, guess-combobox.tsx line 5;
   docs/signal-check/signal-check.md, plan.md lines 1501-1504,
   docs/saved-handle/saved-handle-plan.md, docs/beacon-link/beacon-link-plan.md
   line 2968, docs/league-providers/league-providers-and-yahoo-plan.md line
   2668, docs/performance/site-speed-audit-and-plan.md line 768. Migration
   0227's SQL comment stays (migrations are immutable).
9. Run the suite. lib/manager-pulse/load.test.ts and
   lib/would-you-rather/tally.test.ts import lib/signal-check/* and
   lib/league-signal-check, neither of which moves.
10. After deploy: curl -I both old URLs, confirm 308 and the shareId survives;
    IndexNow ping for the new URL; Search Console request indexing; watch
    Page indexing.

Also in this pass, because the page is now the site's highest
commercial-intent landing page and carries the thinnest static copy of any
tool (about 120 to 150 words, one sr-only H2, no how-it-works, no worked
example, no FAQ): add a server-rendered written section under the builder
with H2s "How the trade calculator grades a trade" (values, the near-even
guard, the margin, dynasty versus redraft), "What counts as a fair fantasy
football trade?", "Trade calculator questions, answered" (is it accurate, can
I include picks, does it work for my league's scoring, why does it disagree
with my league mates), and one link each to Trade Ideas ("trade suggestions
for your league") and Would You Rather. Same crawler reasoning as section
2.4: the builder hydrates, the words do not wait for it.

## 4. Task 3: the site-wide SEO audit

Two read-only agents audited the codebase on 2026-09-10, one for technical
SEO (every public route's metadata, structured data, crawl controls, internal
linking, rendering) and one for content and intent (headings, crawlable copy,
keyword mapping, cannibalisation, the anti-AI-writing scan, content gaps). A
third researched the current algorithm and best practice with citations. This
section is the merged result, ordered by what to do first. Every item has a
file, a severity and a concrete fix.

### 4.1 The state of the algorithm, in six sentences

Google shipped five core updates between March 2025 and May 2026 and four
spam updates, none of the spam updates with a policy announcement, and the
helpful content system is retired into core ranking, so there is no separate
recovery event to wait for. The February 2026 Discover core update was the
first to be labelled Discover-only and it rewards topic-level expertise from
a site's own country, which is directly relevant to the Beacon Brief. AI
Overviews fire on roughly 20 to 40 percent of general queries (18 percent in
Pew's real-browsing sample, higher in vendor sets), cut organic clicks by
about 40 percent in the only randomised field experiment (Agarwal and Sen,
2026), and cite pages that already rank (76 percent of citations are top
ten). Google's own July 2026 optimisation guide says there are no special
requirements for AI features, that Google Search does not read llms.txt, and
that schema markup is recommended for SEO generally but not required for AI
visibility; Ahrefs' controlled test found schema produced no citation lift.
FAQ rich results were retired on 2026-05-07 and HowTo in 2023; BreadcrumbList
still works on desktop; review snippets were tightened on 2026-07-24 against
self-serving ratings. Microsoft is ahead on AI reporting (Bing Webmaster Tools
AI Performance with Citation Share since June 2026), still names FAQ sections
and IndexNow as citation aids, and Copilot grounds in the Bing index with no
separate crawler, so blocking bingbot removes a site from Bing, Yahoo and
Copilot together.

What that means for this site: the work is ordinary SEO done well.
Server-rendered substance, one URL per intent, titles that match H1s,
descriptions that fit, structured data for the types that still render,
internal links with written anchors, an author and a methodology, and a push
to Bing when something changes. Nothing in the evidence rewards AI-specific
tricks.

### 4.2 High severity

1. Five League Pulse routes serve a wrong title on a league's first crawl.
   app/leagues/[league_id]/decisions/page.tsx lines 80-85,
   positional-war/page.tsx 49-54, power-pulse/page.tsx 57-62,
   trade-ideas/page.tsx 134-139, transactions/page.tsx 55-60. Each
   generateMetadata does a raw, unsynced leagues select without
   pulseLeagueCore, while the page body syncs and renders. A crawler can index
   "League not found | FF Beacon" over a full page. Fix: route all five through
   the cached getSyncedLeague helper that lineups and schedules already use.

2. /leagues/[league_id]/** has no robots decision. Ten routes, unbounded,
   per-third-party, near-identical templates keyed by an opaque league id,
   excluded from the sitemap (lib/sitemap/sections.ts line 45) but not from
   robots (app/robots.ts lines 27-54) and with no page-level robots key. Fix,
   confirmed by the owner on 2026-09-10 (a league's pages are relevant only to
   the people in that league):
   robots { index: false, follow: true } in every league generateMetadata (so
   internal equity still flows to /tools/league-pulse and the player pages),
   and keep them out of the sitemap. This also closes the cannibalisation door
   between Lineups and the new start/sit page for good.

3. Descriptions over the snippet length. app/page.tsx lines 45-46 (196
   characters), app/rankings/page.tsx 28-29 (188), every /rankings/[format]
   through lib/rankings-formats.ts line 115 (the fixed suffix alone is 153, so
   every format lands at 165 to 185), app/guides/fantasy-football-draft-guide/
   page.tsx 59-60 (227), app/tools/page.tsx (175), app/brief/page.tsx 9-10
   (184), app/games/page.tsx (164), signal-scout and would-you-rather (162 to
   164), app/players/[slug]/page.tsx (159 in the worked example; overflows for
   long names). Fix: trim each to 150 or under; shorten the rankings suffix
   once since it is multiplied across formats; cap the player template with a
   shorter suffix for long names.

4. /tools/manager-pulse/[handle] has no description at all
   (app/tools/manager-pulse/[handle]/page.tsx lines 80-83). It is noindexed
   correctly, but share previews and internal search show the site default.
   Fix: build one from the handle beside the title.

5. The trade calculator and the start/sit tool are the two highest-intent
   landing pages and carry the thinnest static copy on the site (120 to 200
   words, mostly behind client components). Sections 2.4 and 3 fix both.

6. The start/sit tool's comparison state has no visible H1 and its "How it
   works" block uses styled paragraphs instead of headings
   (app/tools/beacon-breakdown/page.tsx lines 254-256 and 739-794). Section
   2.4 fixes it.

### 4.3 Medium severity

7. /brief and its four archive views skip a heading level: h1 to card h3
   with no h2 (components/beacon-brief/brief-feed.tsx, article-card.tsx line
   37). Fix: an h2 "Latest articles" above the grid, or promote card titles.

8. /brief/tag/[tag] has no noindex gate for free-text tags
   (app/brief/tag/[tag]/page.tsx, the comment at 18-22 acknowledges it).
   Fix: index only when the tag has three or more indexable articles,
   matching the isIndexable gate the article page already has.

9. No WebSite or Organization JSON-LD anywhere (app/layout.tsx and
   app/page.tsx emit none). Fix: one script in the root layout with
   Organization (name, url, logo, sameAs from SOCIAL_LINKS, founder Person
   linking /author/michael) and WebSite (name, url, and a SearchAction only if
   a query-string search URL exists; the site search is a palette, so omit
   SearchAction rather than invent an endpoint).

10. No WebApplication schema on any tool or game (app/tools/*/page.tsx,
    app/games/*/page.tsx). Fix: a shared helper webApplicationJsonLd({name,
    description, url, category}) in lib/json-ld.ts, emitted by each tool page
    with offers price 0 and no aggregateRating. Low ranking value, but it
    is the entity work and it is an hour.

11. Signal profile and board pages have no structured data
    (app/[handle]/page.tsx and components/signal/profile-view.tsx; app/[handle]/
    rankings/[boardId]/page.tsx and board-view.tsx), and the board's Open Graph
    object has no description and no image (board-view.tsx lines 39-40). Fix:
    Person on the profile (mirror /author/michael), ItemList on the board, and
    a real OG image route for boards (mirror /api/og/player).

12. League Pulse decisions has no OG image while declaring
    summary_large_image (decisions/page.tsx 92-93); transactions is the only
    sibling with a lowercase title and triplicated inline description
    (transactions/page.tsx 64-75). Fix both.

13. Root metadata has no openGraph or twitter default, no manifest, no
    viewport export, no verification key (app/layout.tsx 31-55). /privacy,
    /terms and the not-found branch of the share page ship with no share card
    at all. Fix: a generic site card as the root default; app/manifest.ts;
    export const viewport with themeColor "#07070D".

14. /rankings/[format] declares generateStaticParams and force-dynamic
    together, so nothing prerenders and twelve high-value pages rebuild on
    every request (app/rankings/[format]/page.tsx lines 31, 57-67). Fix: this
    is the deferred Partial Prerendering decision from the performance audit;
    the pragmatic interim is unstable_cache on the board read keyed by format,
    source and the freshest generated_at, with a 15-minute revalidate.

15. Seven loading boundaries render no indexable text. Known trade-off,
    documented in app/leagues/loading.tsx lines 6-19. Fix: add one real
    sentence naming the destination to each skeleton.

16. Home page does not link to /guides at all, /donate is footer-only (the
    header Donate control is a modal), and /author/michael is footer and
    byline only. Fix: a guides card in the home content, a "Support the site"
    link in the CTA section, and the author name in the home hero's byline.

### 4.4 Low severity

17. /tools/signal-check's H1 is built from an admin-editable label the
    static title cannot await (page.tsx 20-33), so the two can drift. Fix:
    generateMetadata that reads the same setting, or freeze the H1.

18. lib/site.ts PRIMARY_NAV (116-129) is dead code. Delete it.

19. /join uses an absolute canonical and a share description that differs
    from the base one (app/join/page.tsx 7, 33-40, 56-57). Align with every
    other page.

20. The draft guide and the guides index have no FAQ while the glossary does.
    Add three or four questions to the draft guide.

21. Effective dates on /privacy and /terms are plain text, not time
    elements. Wrap them.

### 4.5 Content and intent

Keyword map, one line per surface, so nobody targets the same intent twice:
- Home: "FF Beacon", the brand, plus "fantasy football tools" as a hub.
- /tools: "free fantasy football tools".
- /tools/who-should-i-start: "who should i start fantasy football" and the
  start/sit cluster (section 1).
- /tools/trade-calculator: "fantasy football trade calculator".
- /tools/league-pulse: "sleeper league tracker" and "sync sleeper league".
- /tools/on-the-clock: "live draft helper for sleeper".
- /tools/faab: "faab calculator", "how much to bid on waivers".
- /tools/manager-pulse: "scout a fantasy football manager" (novel; gated
  behind sign-in, so the sample report carries the page).
- /rankings/[format]: "{format} fantasy football rankings".
- /players/[slug]: "{player} fantasy football".
- /brief: "fantasy football news explained"; articles carry their own terms.
- /guides/fantasy-football-terms: "fantasy football terms".
- /guides/fantasy-football-draft-guide: "fantasy football draft guide".
- /games/*: engagement, branded.

Cannibalisation: League Pulse Lineups versus the start/sit tool is the one
real risk and it is handled by keeping "who should I start" out of every
Lineups heading, noindexing /leagues (item 2), and linking each way with
anchors that name the different job (section 2.2). Signal Check versus
Beacon Breakdown is complementary and stays linked. Rankings versus Players
is complementary. /brief/player/[slug] versus the Beacon Brief tab on
/players/[slug] is a partial duplicate; the article template already routes
player pills to /players, and /brief/player should be noindexed with
follow, since the player page is the canonical home.

The tab-canonical problem on player pages: /players/[slug]?tab=statistics
and ?tab=trades carry unique data but share the overview's title, description
and canonical (app/players/[slug]/page.tsx lines 41-67), so only the
overview is realistically indexed. Fix: generateMetadata reads searchParams,
gives each tab its own title suffix ("{name} Game Log", "{name} Trade
History") and description, and a self-referencing canonical that keeps the
tab parameter. Thin-content risk across thousands of player pages is real
(the only page-specific text is the name); the cheapest mitigation is a
server-rendered two-sentence factual summary per player built from the data
already on the page (position rank, trend, projection, last three finishes),
which is a template over facts, not generated prose.

The anti-AI-writing scan: zero violations of the banned-punctuation list in
any user-visible string across app/, components/ and lib/; the only em and en
dashes in the repo are test fixtures that assert rejection. Puffery words:
every hit was a false positive (Tailwind class names, a domain term of art,
or a literal use like "it unlocks nothing"). Negative parallelism: none with
the second clause. The codebase enforces the owner's writing standard
already; this document was checked against the same list (section 8).

Content gaps worth building, each powered by data the site already holds,
ordered by effort:
- S: a public methodology page, /about/how-it-works or /guides/how-ff-beacon-
  works: projections (whose engine, named live), the matchup model, the
  reliability discount, the confidence figure, values and sources, what the
  models do not know. Linked from every tool page. This is the E-E-A-T "How"
  the site lacks and the page the start/sit tool cites.
- S: a dynasty trade value chart page, a flat ranked list over the data
  /rankings already reads, targeting "dynasty trade value chart".
- S: a FAAB strategy guide beside the calculator.
- S: link each /rankings/[format] page to its glossary terms (superflex, TE
  premium); nothing links rankings to the glossary today.
- M: position pages under rankings, /rankings/{format}/{position}, the
  deferred decision in app/rankings/[format]/page.tsx lines 25-28.
- M: defense-versus-position pages, 32 teams or one grid, from
  nfl_defense_vs_position, which is computed today and shown nowhere.
- M: the "Accessible fantasy football" guide that has been a coming-soon card
  (app/guides/page.tsx lines 164-174), targeting "fantasy football for blind
  players", the one keyword nobody else can honestly claim.
- M: a public Power Pulse and Positional WAR explainer that does not require
  a synced league (the prose exists in components/power-pulse/
  how-power-pulse-works.tsx and is unreachable without a league id).
- M: curated static comparison pages, /compare/{a}-vs-{b}, for the top pairs
  within a position, with their own canonicals, distinct from the dynamic
  tool, which stays non-indexed per pair.
- M to L: a weekly "Week N start/sit" Brief article type, auto-drafted from
  the toughest-calls computation, dated slug, linking to the tool. This is
  where the "week N" queries live for every competitor.

### 4.6 The Discover and Brief note

The February 2026 Discover core update rewards demonstrated topic expertise
and penalises clickbait. The Brief already has the template right (byline,
dates, NewsArticle, entity links, an index-quality gate). Two things to keep
doing and one to add: keep the index-quality gate strict, keep headlines
descriptive, and add the Search Console generative AI performance report and
the Bing AI Performance report to whatever monthly review exists, because
they are the only first-party signals of AI citation and neither backfills.

## 5. IndexNow

Today: INDEXNOW_KEY is declared in .env.local.example and .env.local and
read by nothing. Google does not participate; Bing, Yandex, Seznam, Naver,
Yep, the Internet Archive and Amazonbot do, and one endpoint forwards to all
of them. For a page that updates every Wednesday and on every injury move, a
push beats waiting for a crawl, and Microsoft names it as a Copilot citation
aid.

Build:
- Key file: app/[key].txt cannot be a dynamic segment safely (it would
  collide with the /{handle} route). Serve it as a route handler at
  app/indexnow-key/route.ts? No: the protocol requires the file at
  /{key}.txt. Add public/{key}.txt as a static file committed with the key
  value as its only content. The key is not a secret (it proves you control
  the host, not identity), so committing it is fine; keep INDEXNOW_KEY in env
  so the code and the file agree, and add a test that reads both.
- lib/indexnow.ts: submitIndexNow(urls: string[]): Promise<{ ok: boolean;
  status: number }>. POST https://api.indexnow.org/indexnow with
  { host, key, keyLocation, urlList } (up to 10,000). 20-second timeout,
  never throws, logs status. No retry loop; a 429 is logged and dropped.
- Callers, each after a successful write and never before:
  - Beacon Brief publish and update (lib/beacon-brief/worker.ts, at the point
    an article becomes published or its content changes): the article URL and
    /brief.
  - The nightly projection sync (the cron that writes
    player_weekly_projections): /tools/who-should-i-start and
    /rankings/{format} for each active format.
  - The rankings and trends rebuild (/api/cron/recalculate-derived):
    /rankings and each format page.
  - A manual script, npm run indexnow -- <url...>, for the two slug moves.
- Reserved route: add the key filename to nothing; public/ files are served
  before dynamic routes, so /{key}.txt cannot be shadowed by a handle. Add a
  test in lib/signal/reserved-routes.test.ts that the key filename is not a
  valid handle shape anyway (it contains no lowercase-only alphanumerics
  pattern a handle would; verify against the handle regex).
- Test: lib/indexnow.test.ts with a mocked fetch: payload shape, host from
  SITE.url, a failure returns ok false and does not throw.

## 6. Atomic task list

In progress.md format, to be appended to progress.md when implementation is
approved. T numbers are placeholders; renumber from the current tail.

```
T900 | pending | Add scoringSettingsForFormat to lib/league-scoring.ts with tests
     | files: lib/league-scoring.ts, lib/league-scoring.test.ts
     | depends on: none
     | verified: no

T901 | pending | Adopt scoringSettingsForFormat in lib/breakdown/load-extras.ts and pin the PPR points column with a test
     | files: lib/breakdown/load-extras.ts, lib/breakdown/load-extras.test.ts
     | depends on: T900
     | verified: no

T902 | pending | Extend AdjustedProjection with sigma, opponentMultiplier, beatRate, availabilityRate, weeksPlayed
     | files: lib/projections/read.ts, lib/projections/read.test.ts
     | depends on: none
     | verified: no

T903 | pending | Add loadDefenseRanks to lib/power-pulse/load.ts
     | files: lib/power-pulse/load.ts, lib/power-pulse/load.test.ts
     | depends on: none
     | verified: no

T904 | pending | Move resolveSeasonClock to lib/start-sit/clock.ts, re-export from load-extras
     | files: lib/start-sit/clock.ts, lib/breakdown/load-extras.ts
     | depends on: none
     | verified: no

T905 | pending | lib/start-sit/types.ts with the constants and shapes
     | files: lib/start-sit/types.ts
     | depends on: none
     | verified: no

T906 | pending | lib/start-sit/rank.ts with tests
     | files: lib/start-sit/rank.ts, lib/start-sit/rank.test.ts
     | depends on: T905
     | verified: no

T907 | pending | lib/start-sit/confidence.ts with tests
     | files: lib/start-sit/confidence.ts, lib/start-sit/confidence.test.ts
     | depends on: T905
     | verified: no

T908 | pending | lib/start-sit/reasons.ts with tests including the banned-character fixture
     | files: lib/start-sit/reasons.ts, lib/start-sit/reasons.test.ts
     | depends on: T905
     | verified: no

T909 | pending | lib/start-sit/engine.ts computeStartSit with fixture tests
     | files: lib/start-sit/engine.ts, lib/start-sit/engine.test.ts
     | depends on: T906, T907, T908
     | verified: no

T910 | pending | lib/start-sit/load.ts, the three-wave read through loadAdjustedProjections
     | files: lib/start-sit/load.ts
     | depends on: T900, T902, T903, T904, T905
     | verified: no

T911 | pending | lib/start-sit/toughest-calls.ts with tests and the unstable_cache wrapper
     | files: lib/start-sit/toughest-calls.ts, lib/start-sit/toughest-calls.test.ts
     | depends on: T909, T910
     | verified: no

T912 | pending | Add scalar() to every Metric in lib/breakdown/metrics.ts
     | files: lib/breakdown/metrics.ts
     | depends on: none
     | verified: no

T913 | pending | computeGroupEdge in lib/breakdown/edge.ts with the N=2 parity test
     | files: lib/breakdown/edge.ts, lib/breakdown/edge.test.ts, lib/breakdown/types.ts
     | depends on: T912
     | verified: no

T914 | pending | loadBreakdown takes a slug list; loadBreakdownPair wrapper for BEAM and the pair OG route
     | files: lib/beacon-breakdown.ts, lib/beam/capabilities/player-compare-verdict.ts, app/api/og/breakdown/[a]/[b]/route.tsx
     | depends on: T913
     | verified: no

T915 | pending | components/start-sit-badge.tsx
     | files: components/start-sit-badge.tsx
     | depends on: none
     | verified: no

T916 | pending | start-sit-picker.tsx: multi-player combobox with chips and the start-count stepper
     | files: app/tools/beacon-breakdown/start-sit-picker.tsx
     | depends on: T905
     | verified: no

T917 | pending | week-select.tsx
     | files: app/tools/beacon-breakdown/week-select.tsx
     | depends on: none
     | verified: no

T918 | pending | start-sit-card.tsx
     | files: app/tools/beacon-breakdown/start-sit-card.tsx
     | depends on: T915
     | verified: no

T919 | pending | start-sit-board.tsx: verdict line, card row, confidence bar, reasons, copy buttons
     | files: app/tools/beacon-breakdown/start-sit-board.tsx
     | depends on: T909, T910, T918
     | verified: no

T920 | pending | written-sections.tsx: every H2 from section 2.4 with its copy
     | files: app/tools/beacon-breakdown/written-sections.tsx
     | depends on: none
     | verified: no

T921 | pending | toughest-calls.tsx grid
     | files: app/tools/beacon-breakdown/toughest-calls.tsx
     | depends on: T911
     | verified: no

T922 | pending | Generalise the Head to head tab to N players (table, ranked bars, lens button group)
     | files: app/tools/beacon-breakdown/breakdown-table.tsx, beacon-edge-meter.tsx, edge-contribution-chart.tsx, lens-switch.tsx, breakdown-summary.tsx
     | depends on: T913
     | verified: no

T923 | pending | Generalise the Projections tab to N series and extend POSITION_SERIES to eight entries
     | files: app/tools/beacon-breakdown/projections-tab.tsx, components/chart-kit.tsx
     | depends on: T914
     | verified: no

T924 | pending | Generalise the Reliability tab to N
     | files: app/tools/beacon-breakdown/reliability-tab.tsx
     | depends on: T914
     | verified: no

T925 | pending | Generalise the Market tab to N
     | files: app/tools/beacon-breakdown/market-tab.tsx
     | depends on: T914
     | verified: no

T926 | pending | Generalise the Stats tab to N
     | files: app/tools/beacon-breakdown/stats-compare.tsx, stats-data.ts, load-stats.ts
     | depends on: T914
     | verified: no

T927 | pending | Generalise the Your lineup tab to N
     | files: app/tools/beacon-breakdown/league-tab.tsx, lib/breakdown/league-mode.ts, lib/breakdown/league-impact.ts
     | depends on: T914
     | verified: no

T928 | pending | page.tsx: new metadata, H1 in both states, ?p= and ?start= and ?week= parsing with ?a=&b= alias, Suspense layout
     | files: app/tools/beacon-breakdown/page.tsx
     | depends on: T916, T917, T919, T920, T921, T922
     | verified: no

T929 | pending | Metadata test: title under 60, description under 155 at Week 18, canonical bare, week rollover
     | files: app/tools/beacon-breakdown/page.test.ts
     | depends on: T928
     | verified: no

T930 | pending | app/api/og/start-sit/route.tsx
     | files: app/api/og/start-sit/route.tsx
     | depends on: T909, T910
     | verified: no

T931 | pending | git mv the route folder to app/tools/who-should-i-start and add the redirect
     | files: app/tools/who-should-i-start/**, next.config.ts
     | depends on: T928
     | verified: no

T932 | pending | Labels and paths: lib/site.ts, tools-catalog, breadcrumbs, nav-tree, bookmarks icon, sitemap sections (plus the manager-pulse sitemap entry)
     | files: lib/site.ts, lib/tools-catalog.ts, lib/breadcrumbs.ts, lib/nav-tree.ts, lib/bookmarks/icon.ts, lib/sitemap/sections.ts, app/tools/page.tsx
     | depends on: T931
     | verified: no

T933 | pending | Inbound prose links and copy: home, about, author, team page, lineups reciprocal link, BEAM links, OG page card, llms glossary, terms guide
     | files: app/page.tsx, app/about/page.tsx, app/author/michael/page.tsx, app/leagues/[league_id]/teams/[roster_id]/page.tsx, app/leagues/[league_id]/lineups/page.tsx, lib/beam/capabilities/player-compare-verdict.ts, lib/beam/capabilities/player-compare-stat.ts, app/api/og/page/[key]/route.tsx, lib/llms/context.ts, lib/guides/fantasy-football-terms.ts
     | depends on: T931
     | verified: no

T934 | pending | Stale comments and docs citing the old path
     | files: see section 2.12
     | depends on: T931
     | verified: no

T935 | pending | Accessibility audit of the board (sub-agent), fix findings
     | files: as found
     | depends on: T928
     | verified: no

T936 | pending | Security review of the new route and OG route (sub-agent), fix findings
     | files: as found
     | depends on: T930, T931
     | verified: no

T940 | pending | git mv app/tools/signal-check to app/tools/trade-calculator, fix the on-the-clock import, add the two redirects
     | files: app/tools/trade-calculator/**, app/tools/on-the-clock/actions.ts, next.config.ts
     | depends on: none
     | verified: no

T941 | pending | Every URL reference for the trade calculator (section 3 step 4)
     | files: see section 3
     | depends on: T940
     | verified: no

T942 | pending | lib/llms/build.test.ts share-path regex
     | files: lib/llms/build.test.ts
     | depends on: T940
     | verified: no

T943 | pending | Stale comments and docs citing signal-check paths
     | files: see section 3 step 8
     | depends on: T940
     | verified: no

T944 | pending | Trade calculator written sections under the builder
     | files: app/tools/trade-calculator/page.tsx, app/tools/trade-calculator/written-sections.tsx
     | depends on: T940
     | verified: no

T945 | pending | Trade calculator generateMetadata reads the admin label so title and H1 cannot drift
     | files: app/tools/trade-calculator/page.tsx
     | depends on: T940
     | verified: no

T950 | pending | lib/indexnow.ts with tests
     | files: lib/indexnow.ts, lib/indexnow.test.ts
     | depends on: none
     | verified: no

T951 | pending | public/{key}.txt plus the env-agreement test
     | files: public/<key>.txt, lib/indexnow.test.ts
     | depends on: T950
     | verified: no

T952 | pending | IndexNow pings from the Brief worker, the projection sync and recalculate-derived
     | files: lib/beacon-brief/worker.ts, the projection sync cron route, app/api/cron/recalculate-derived/route.ts
     | depends on: T950
     | verified: no

T953 | pending | npm run indexnow script
     | files: scripts/indexnow.ts, package.json
     | depends on: T950
     | verified: no

T960 | pending | League routes: generateMetadata through getSyncedLeague on decisions, positional-war, power-pulse, trade-ideas, transactions
     | files: the five page.tsx files
     | depends on: none
     | verified: no

T961 | pending | League routes: robots noindex follow on all ten
     | files: app/leagues/[league_id]/**/page.tsx
     | depends on: none
     | verified: no

T962 | pending | Trim every description over 150 characters (section 4.2 item 3)
     | files: app/page.tsx, app/rankings/page.tsx, lib/rankings-formats.ts, app/guides/fantasy-football-draft-guide/page.tsx, app/tools/page.tsx, app/brief/page.tsx, app/games/page.tsx, app/games/signal-scout/page.tsx, app/games/would-you-rather/page.tsx, app/players/[slug]/page.tsx
     | depends on: none
     | verified: no

T963 | pending | Manager Pulse report description
     | files: app/tools/manager-pulse/[handle]/page.tsx
     | depends on: none
     | verified: no

T964 | pending | Brief feed h2 above the grid
     | files: components/beacon-brief/brief-feed.tsx
     | depends on: none
     | verified: no

T965 | pending | Brief tag pages: index gate
     | files: app/brief/tag/[tag]/page.tsx
     | depends on: none
     | verified: no

T966 | pending | Organization and WebSite JSON-LD in the root layout
     | files: app/layout.tsx, lib/json-ld.ts
     | depends on: none
     | verified: no

T967 | pending | webApplicationJsonLd helper and emit on every tool and game page
     | files: lib/json-ld.ts, app/tools/*/page.tsx, app/games/*/page.tsx
     | depends on: T966
     | verified: no

T968 | pending | Person JSON-LD on Signal profiles; ItemList and OG image on boards
     | files: components/signal/profile-view.tsx, components/signal/board-view.tsx, app/api/og/board/[handle]/[boardId]/route.tsx
     | depends on: none
     | verified: no

T969 | pending | Root openGraph and twitter defaults, manifest, viewport
     | files: app/layout.tsx, app/manifest.ts
     | depends on: none
     | verified: no

T970 | pending | Decisions OG image, transactions title casing and shared description
     | files: app/leagues/[league_id]/decisions/page.tsx, app/leagues/[league_id]/transactions/page.tsx
     | depends on: none
     | verified: no

T971 | pending | Player page tab metadata and canonical per tab
     | files: app/players/[slug]/page.tsx
     | depends on: none
     | verified: no

T972 | pending | Player page factual summary sentence (template over facts)
     | files: components/player-profile/player-hero.tsx or overview-tab.tsx
     | depends on: none
     | verified: no

T973 | pending | Home links to guides, donate and author
     | files: app/page.tsx, lib/home-content.ts
     | depends on: none
     | verified: no

T974 | pending | Rankings pages link their glossary terms
     | files: components/rankings/rankings-view.tsx
     | depends on: none
     | verified: no

T975 | pending | Delete PRIMARY_NAV; align /join canonical and description; time elements on legal dates
     | files: lib/site.ts, app/join/page.tsx, app/privacy/page.tsx, app/terms/page.tsx
     | depends on: none
     | verified: no

T976 | pending | Methodology page /guides/how-ff-beacon-works, linked from every tool page
     | files: app/guides/how-ff-beacon-works/page.tsx, lib/guides catalogue, tool pages
     | depends on: none
     | verified: no

T977 | pending | Draft guide FAQ block
     | files: app/guides/fantasy-football-draft-guide/page.tsx
     | depends on: none
     | verified: no

T978 | pending | Rankings board cache keyed by format, source and freshest generated_at
     | files: components/rankings/rankings-view.tsx or its loader
     | depends on: none
     | verified: no

T979 | pending | /brief/player noindex follow
     | files: app/brief/player/[slug]/page.tsx
     | depends on: none
     | verified: no

T980 | pending | Loading skeletons carry one real sentence
     | files: the seven loading.tsx files
     | depends on: none
     | verified: no
```

Sequencing: T900 to T936 is the start/sit build and ships as one release
(the folder move in T931 is the moment the redirect goes live, so everything
before it can land on main under the old path). T940 to T945 is the trade
calculator and can ship first, on its own, since it is small. T950 to T953 is
IndexNow and should land before either slug move so the pings are available
on launch day. T960 to T980 is the audit backlog, ordered by severity, and
each item is independent.

## 7. Decisions, confirmed by the owner on 2026-09-10

The five questions the first draft of this plan left open were answered the
same day. They are recorded here so nobody reopens them during the build.

- The slug is /tools/who-should-i-start. The longer
  /tools/who-should-i-start-fantasy-football form is not used. Section 2.3.
- The trade calculator slug is /tools/trade-calculator. The longer
  /tools/fantasy-football-trade-calculator form is not used. Section 3.
- The title is the absolute form that keeps "Beacon Breakdown":
  "Who Should I Start in Fantasy Football? | Beacon Breakdown". The page sets
  title: { absolute } so the root "| FF Beacon" template does not apply to
  it. The template alternatives in section 2.4 are recorded for history only.
- The player cap is eight, as MAX_START_SIT_PLAYERS in lib/start-sit/types.ts.
- Every route under /leagues/[league_id]/** is marked robots
  { index: false, follow: true } (section 4.2 item 2, task T961). The owner's
  reasoning: a league's pages are relevant only to the people in that league.
  This also settles the Lineups versus start/sit cannibalisation question for
  good, because the Lineups page can no longer compete in the index at all.

Two smaller defaults stand unless someone objects during implementation:
- The FAQPage JSON-LD is emitted (harmless, no rich result on Google, named
  by Microsoft as a citation aid).
- The "toughest calls" startable cuts are top 16 QB, 30 RB, 36 WR, 14 TE, 12
  K, 12 DEF. Constants, easy to tune after launch.

Housekeeping: docs/README.md did not gain a row for this file, per the
planning-only instruction. The first implementation commit should add one
under a new "seo" folder row.

## 8. Writing check

This document was read against the anti-AI-writing list before saving. Three
first-draft fixes: a sentence in section 2.4 originally read "this is not a
comparison tool, it is a start/sit tool", which is negative parallelism, and
now states what the page is for; a three-item rhythm in section 4.1 ("fast,
fresh and honest") was cut because it existed only as cadence; and two
trailing participle clauses in section 5 ("improving discovery and ensuring
freshness") were deleted so the fact stands alone. No em dashes, en dashes,
curly quotes, ellipsis characters or emoji appear in the file; a grep for each
character was run before saving. Competitor strings quoted from the research
that contained an em dash or curly apostrophe in the original were rendered in
plain ASCII.
