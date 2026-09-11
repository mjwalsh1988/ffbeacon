# BEAM: what got built

A report on the Ask BEAM feature. Section 1 is plain English. Section 2 is the
technical detail. Nothing has been committed or pushed.

**Where BEAM lives changed after this report was written.** It is no longer a
page at `/tools/ask-beam`. It is a panel that opens from a button in the site
header, next to search, on every page. The route, its tools-hub card, its nav,
footer and search-palette entries, and its sitemap line are all gone. Everything
below about the engine, the resolver, the capabilities, the API routes and the
admin pages is unchanged; only the surface moved. The UI files moved with it,
from `app/tools/ask-beam/*` to `components/beam/*`, and the conversation was
rebuilt as a chat (mascot greeting, your question as your own message, answers
under BEAM's avatar, a pinned composer). The `ask-beam` Signal Guide page from
migration 0200 lost its host page: its nine entries are still in the database
and currently unreachable.

---

# 1. In plain terms

## What BEAM is

A visitor types a fantasy football question the way they would say it out loud,
and gets an answer from FF Beacon's own data.

```
You: how many yards did purdy throw for
BEAM: Brock Purdy threw for 2,167 yards in 2025.
```

It lives at **/tools/ask-beam**. BEAM stands for Beacon Engine for Answers and
Metrics.

There is no AI behind it. It does not guess, and it cannot make something up,
because every answer is read out of the same database rows the rest of the site
already shows. When it is not sure, it asks.

## What it can answer today

Eight kinds of question:

1. **One statistic, one player, one season.** "How many passing yards did Brock
   Purdy have in 2025?" About 40 statistics, going back to 2020.
2. **A whole season.** "How did Jahmyr Gibbs do in 2025?"
3. **Two players, one statistic.** "Who had more receiving yards, Lamb or
   Wilson?"
4. **Who is better.** "Who is better for dynasty, Garrett Wilson or Drake
   London?" This one hands the question to Beacon Breakdown and reads its verdict
   back, so BEAM and the tool can never disagree.
5. **What a player is worth**, in your format and from your chosen source.
6. **Where a player ranks.**
7. **Player facts.** Age, team, college, draft slot, injury designation.
8. **What a term means.** "What is FAAB?" Answered from the Signal Guide
   glossary you already wrote, so there is no second glossary to maintain.

Team defenses work too: "How many sacks did the Ravens have in 2024?"

## Spelling does not have to be right

All of these find Brock Purdy:

```
brock purdy      purdy       b purdy      brock prudy      brock purdys
```

And nicknames work: `cmc`, `ceedee`, `hollywood`, `jsn`.

## When it is not sure, it asks

This is the part that matters most, and it is why BEAM is trustworthy.

Type **"purdy"** and it answers, because only one fantasy player has that
surname. Type **"brock"** and it stops and asks, because Brock is Kevin Brock's
surname and Brock Purdy's first name and there is no safe way to pick.

It also asks when the statistic is ambiguous. "How many yards did Gibbs have"
means three different numbers for a running back (rushing, receiving, or the two
combined), so BEAM offers the three rather than choosing one.

Picking an option re-asks your **whole** original question with that choice
filled in. You never retype anything.

## When it cannot answer

Every dead end says specifically what went wrong, and gives three ways out:

- Where to go instead, when another tool answers it. Ask about your own roster
  and BEAM points at League Pulse, because it genuinely cannot see your league.
- A few example questions it does handle, generated from what is actually
  switched on, so it can never advertise something that does not work.
- A **Help BEAM learn this** button. Your question travels with it
  automatically, so you type only your name.

## How BEAM gets smarter

Every question is logged, answered or not. `/admin/beam/gaps` shows the ones it
could not answer, grouped and ranked by **how many different people** asked
(not how many times, so a script cannot manufacture a priority). That list is
what tells you what to build next.

When the gap is a missing nickname, `/admin/beam/aliases` fixes it in about a
minute with no deploy.

## Reviews

Four independent reviews were run: implementation, security, accessibility, and
speed. They found real problems. The five worst:

1. **BEAM would have confidently answered about the wrong player.** The nickname
   list I seeded included 48 entries that were just a player's surname, and a
   nickname outranks the "ask when the surname is shared" safety rule. So "cook"
   would have answered for James Cook with six other Cooks in the database, no
   question asked. All 48 removed, and the admin editor now refuses to let one
   back in.
2. **A comparison could name the right team with the wrong verb.** Two separate
   lists tracked which stats are better when lower, and they disagreed about
   points allowed. "Who allowed fewer points" would have said "had more".
3. **A missing statistic read as a real zero.** If we hold no air-yards data for
   a receiver, BEAM said "he did not record any air yards", which is a different
   claim from "we do not have that", and a false one.
4. **A screen reader user lost their place after every single question.**
   Disabling the text box while BEAM was thinking unfocused it, and the code that
   was supposed to put focus back could not work because the box was still
   disabled when it ran. Focus fell to the top of the page every time.
5. **A stored fingerprint was reversible.** The feedback form stored an unsalted
   hash of the visitor's IP address next to their name and email. That kind of
   hash can be reversed in minutes.

All fixed. Two statistics were also **removed** after checking production data:
defensive interceptions and target share are empty in our database, so offering
them would have guaranteed a wrong answer.

## State

Working and verified against live data. Not committed, not pushed. Six database
migrations have been applied to production (they are additive: four new tables,
two new columns, one function).

---

# 2. Technical detail

## Architecture

One boundary carries the whole design:

```
raw text -> INTERPRETER -> BeamRequest -> CAPABILITY -> result -> PRESENTER -> BeamAnswer
            (swappable)    (contract)     (deterministic)         (templates)
```

The interpreter is the only component that ever sees user text. Capabilities
receive validated parameters and resolved player UUIDs; presenters receive typed
results. Neither can be handed a string.

That is what makes the future LLM layer one new file implementing
`BeamInterpreter`. The model would route the question and propose a name string;
`resolve/player.ts` would still turn that string into an id, and the presenters
would still write the sentence. The model never produces a number and never
asserts a player id, which is what keeps an answer unhallucinatable.

## Player resolution

Five algorithmic tiers plus a fuzzy tier, grouped so only the **best tier
present** competes:

| Tier | Method | Confidence |
|---|---|---|
| exact | `search_name` matches outright | 0.97 |
| alias | editorial nickname in `beam_player_aliases` | 0.95 |
| single | one word that is someone's first OR last name | 0.88 |
| initials | first initial or prefix plus surname | 0.88 |
| fuzzy | trigram plus bounded Damerau-Levenshtein | 0.50 to 0.90 |

First and last name share one tier at one confidence deliberately. Ranking
surnames above given names would answer a Purdy question with a backup tight
end. Uniqueness decides: one member in the tier answers, more than one asks.

Two extra inferences narrow safely:

- **The statistic narrows the player.** "How many yards did brock throw for"
  goes from four Brocks to two quarterbacks, because the verb already said
  quarterback. Applied as a hint, never a filter: it is ignored when no candidate
  matches.
- **Scope.** Stat and bio questions search every player we hold, including
  retired ones. Value, rank, and comparison questions are restricted to currently
  ranked players. `lib/player-search.ts` is deliberately NOT reused, because its
  relevance gate is correct for Signal Check and wrong here.

## Interpretation

Subtractive, and it works because the vocabulary is closed. Eight vocabularies
run in fixed order over the same `claimed` array (stats, verbs, seasons, lenses,
positions, teams, heads, concepts, filler); whatever nobody claims is a candidate
name.

The one real inference is the **verb rule**. "How many yards did purdy throw
for" contains no stat phrase: "yards" alone is ambiguous, "throw for" names no
unit. Together they mean passing yards.

Capability routing uses **ordered fallthrough**, not a confidence gate.
Candidate readings are tried in order and the first that can be built wins, so a
wrong reading eliminates itself against reality. "What is FAAB" scores as a value
question about a player named Faab, fails at player resolution in microseconds,
and answers as a definition.

## Schema

Seven migrations, `0194` to `0201`, all applied to production.

| Migration | What |
|---|---|
| 0194 | `players.search_name` / `search_last_name` generated columns, GIN trigram index, two btree indexes |
| 0195 | `beam_player_aliases`, public SELECT, seeded |
| 0196 | `beam_queries` question log plus `cleanup_beam_queries()` |
| 0197 | `beam_learning_requests` feedback queue |
| 0198 | `beam_settings` single pinned row |
| 0199 | `beam_search_players()` trigram RPC |
| 0200 | Signal Guide page and nine entries for Ask BEAM |
| 0201 | Review fixes: alias cleanup, RPC inlining and input cap |

All four tables are `beam_`-prefixed. Each ships its RLS in the same file with an
access matrix in the header. Verified as `anon`: `beam_queries`, `beam_settings`,
and `beam_learning_requests` return zero rows; `beam_player_aliases` returns its
74 public rows.

`search_name` rebuilds from `first_name || ' ' || last_name` rather than
`full_name`, because `full_name` is itself generated and Postgres forbids one
generated column referencing another.

## Files

**New:** `lib/beam/**` (31 modules across `interpret/`, `resolve/`, `stats/`,
`capabilities/`, `answers/`), `app/api/beam/{ask,learn}/route.ts`,
`app/tools/ask-beam/**` (6 components), `app/admin/beam/**` (4 pages plus
actions), `components/beam/beam-mark.tsx`, three admin managers,
`lib/email/beam-emails.ts`, `lib/beam-admin-nav.ts`, `scripts/beam-smoke.ts`,
two test files, seven migrations.

**Modified:** `lib/site.ts` (nav, search, footer), `app/tools/page.tsx`,
`app/sitemap.ts`, `components/admin-nav.tsx`, `lib/guide/registry.ts`,
`app/api/cron/recalculate-derived/route.ts`, `lib/database.types.ts`,
`package.json`, `progress.md`.

**Read, never modified:** `lib/beacon-breakdown.ts`, `lib/breakdown/*`,
`lib/player-profile.ts`, `lib/player-search.ts`, `lib/preferences.ts`,
`lib/source.ts`, `lib/sleeper.ts`, `lib/rate-limit-actor.ts`.

## Project rules

- **Format and source sync.** `buildBeamContext` runs the full resolver chain.
  Better than required: format-independent statistics are NOT stamped with a
  format label, only fantasy points are, because passing yards do not change
  between leagues.
- **Time display.** Every timestamp goes through `formatEastern`, and the one
  custom formatter passes `timeZone: SITE_TIME_ZONE` with `timeZoneName: "short"`.
- **No AI-tell punctuation.** Verified all-ASCII across 62 files.
- **Mobile-first.** No `hidden sm:` on any data. The fact grid stacks rather than
  dropping a column. Tap targets are 44px throughout.

## Review findings and fixes

### Correctness

| Finding | Fix |
|---|---|
| 48 seeded surname aliases outranked the surname tier, so a shared surname answered instead of asking | Deleted; admin editor rejects surname aliases with the reason |
| `pts_allow` direction disagreed between the comparison and the sentence | Single `lowerIsBetter` flag on the registry feeds both |
| Unordered `LIMIT 60` could drop the exact-match row (81 rows share "williams") | Ordered by `search_name`, cap raised to 200 |
| `sum`/`combine` reported an all-null column as a measured zero | Return null unless at least one week carried a value |
| Team defenses were unanswerable: the team vocabulary consumed the name | Teams count as subjects and become the name span |
| Three players answered about two without saying so | `too-many-players` dead end |
| `def_int` and `target_share` have no data in production | Both removed from the registry, with a test asserting it |

### Security

| Finding | Fix |
|---|---|
| `beam_search_players` had no input length cap and is anon-executable; 1MB query cost 750ms vs 5ms | Capped at 80 characters |
| Rate limit claimed after the context build, so a throttled caller still cost a Sleeper call | Claimed immediately after the actor key; second claim only when the admin limit is tighter |
| Unsalted SHA-256 of the client IP stored beside name and email | Stores the salted actor key instead |
| `queryId` accepted with no ownership check | Bound to the actor who asked, falling back to body text on mismatch |
| Body parsed before any size check | 8KB `Content-Length` guard on both routes |
| `cleanup_beam_queries()` documented as wired but never called | Added to the nightly prune, using the admin-configured window |
| Gaps board rankable by a script | Ranked by distinct actors |
| Double-escaped name in the confirmation email | Removed the inner `esc()` |

Confirmed sound: the PostgREST `.or()` filter cannot be reached with filter
syntax (normalized to `[a-z0-9 ]`, re-asserted before use), the stat registry is
genuinely closed (`STAT_SELECT` is a compile-time constant), all six server
actions call `requireAdmin` first, both limiters fail closed, no
`dangerouslySetInnerHTML`, and the debug trace never leaves the server.

### Accessibility

| Finding | Fix |
|---|---|
| **Blocker:** focus dropped to `<body>` after every turn | Stopped disabling the focused control; `aria-disabled` plus a guard |
| Errors announced twice, once assertively | One polite channel |
| Answer spoken twice: prose, then the fact grid | `buildSpeech` drops facts whose value the headline already said |
| "WR" and "QB, SF" read as letters | Spelled out via `positionNoun` and the team nickname |
| The matched-player line announced zero times | Appended to the announcement, naming the correction button |
| Dead-end exits announced zero times | Announcement counts the links, examples, and feedback button |
| Clarification announcement raced its own focus move | Short announcement; the legend and focused option carry the detail |
| Clarification announced labels, so identical names sounded identical | Uses the `speech` field |
| Closing the feedback form dropped focus | Restored to the button that opened it |
| Success announced twice (`role="status"` plus focus move) | Focus move only; target is a real heading |
| Answers had no heading, and levels skipped h1 to h3 | Each turn's question is an `h2`, card headings demoted |
| Admin filter announced on every keystroke | Debounced 350ms |
| Admin alias delete was silent | Announces what was deleted |
| `text-ink-subtle` at ~3.7:1 carried provenance | Moved to `text-ink-muted` (~8.6:1) |
| `aria-labelledby` on a `<p>` (prohibited on a generic role) | `role="group"` |

### Performance

| Finding | Fix | Measured |
|---|---|---|
| `SET search_path` blocked function inlining | Dropped, schema-qualified instead | 5.4ms warm / 43-62ms cold to **1.1ms** |
| Ranking read ran even when it could not change the answer | Skipped for historical scope with a unique best tier | One round trip off the most common question |
| Resolution re-ran per candidate reading | Memoised per interpret call | Up to 32 round trips to 4 to 8 |
| `loadPowerPulseSettings` serialized behind `loadBreakdown` | Parallel | One wave off the slowest capability |
| Season bounds read serially | Parallel | One wave off cold start |

Confirmed already efficient: every hot-path query uses an index (no sequential
scans, including the prefix LIKE, which the GIN trigram index serves in 0.098ms),
the stat read is 0.22ms for a player-season, RLS costs nothing on the hot tables
(all policies are `USING (true)`), and the interpret layer is 25 to 93
microseconds per question.

## Verification

- `npx tsc --noEmit` clean
- `npm test`: **1691 tests across 120 files**, all passing (37 new BEAM tests, 4
  new guide-registry regression tests)
- `npm run build` clean, all BEAM routes present
- All-ASCII scan clean across 62 files
- RLS re-verified as `anon` after every migration
- `npm run beam:smoke`: 30 real questions against production data

Latency on the smoke run: 120 to 460ms for stat, value, rank, bio, and glossary
questions; roughly 900ms for a head-to-head comparison, which is the price of the
real Beacon Breakdown verdict rather than a cheaper different one.

## Deliberately not done

**The Ask BEAM pane inside the Signal Guide panel.** The plan flagged this as
needing sign-off, because the Guide launcher currently renders only on pages that
already have published guide entries, and making BEAM reachable everywhere means
changing the mount condition on a shipped, site-wide surface. BEAM has its own
Signal Guide page instead (nine entries, migration 0200), so the Guide button
appears on `/tools/ask-beam` with BEAM's own help in it.

The other four open questions from the plan were resolved as recommended:
`/tools/ask-beam` as the route, the Tier A capability list, the "Matched: Brock
Purdy" confidence line shipped, and learning requests emailing
`ADMIN_NOTIFICATION_EMAIL` (defaulting to michael@ffbeacon.com, matching the
Signal Guide route).

## Known limits

- **Nickname coverage is a cold start.** 74 seeded. The gaps page is the loop
  that fills it.
- **One season per question.** No career totals, no multi-season aggregation.
- **No week-level questions.** Season totals only.
- **The comparison is the slow one** at roughly 900ms. Not cached: a 15-minute
  TTL keyed on every context field would be safe, but caching a verdict that
  reads as current is a correctness risk for a small latency win.
- **`beam_queries` write is awaited** so the query id can travel back for the
  feedback form. It only needs to be awaited on the unsupported and clarify
  paths; the happy path could defer it.

---

Writing check: I reread this report against the AI-writing-pattern list. First
draft had one negative-parallelism construction in section 1 ("It is not just a
search box, it is a question answerer"), which was cut rather than rewritten, and
one significance-inflation phrase ("reflecting a broader shift toward
conversational interfaces"), deleted. No em-dashes, en-dashes, curly quotes, or
ellipsis characters are present anywhere in the document.