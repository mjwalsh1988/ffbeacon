# Handoff: On The Clock, the cleanup pass (2026-08-08, session 2)

## Status summary

Complete and reviewed. Nothing committed or pushed, at the owner's request.
No dev server is running.

- Safe to review: YES. `npx tsc --noEmit` clean, 1449 tests across 107 files
  pass, `npx next build` compiles clean.
- Live in the database already: YES. Migrations 0180 to 0185 are applied to
  prod. `lib/database.types.ts` is regenerated and formatted.
- Feature flag: On The Clock is **ON** in prod
  (`on_the_clock_settings.settings.feature.enabled = true`). The previous
  handoff said it ships OFF; that is the code DEFAULT, and the stored row
  overrides it. Worth knowing before the next deploy.

This session closes T522 to T541 (everything the previous session deferred) and
adds T542 to T544 from the owner's own first look at the room.

---

## The three things the owner reported

### 1. A redraft league was being told it was a dynasty startup

The pool notice on entering a draft room said "Looks like this is a dynasty
startup draft" in a redraft league.

The COPY was already right. `describeInferredPool` has had a redraft branch all
along. The DETECTION was wrong.

`lib/sleeper-to-format.ts deriveLeagueFormat` treated a non-empty
`previous_league_id` as a dynasty signal. Sleeper sets that field on ANY league
carried season to season, redraft included. Confirmed against prod:

```
league                  settings.type   previous_league_id   derived
Brooklyn 99 Redraft     0               1253794481229004800  dynasty  <- wrong
Sunday Funday           0               1251663638113046528  dynasty  <- wrong
Mikeys League 2.0       2               null                 dynasty  <- right
```

Only `settings.type === 2` is dynasty now. `lib/league-category.ts` already
classified this way and its header even named "Brooklyn 99 Redraft" as the
misfiled case; it just concluded that value-format resolution was a separate
concern. It was not.

**This is bigger than the modal.** The format drives which VALUE BOARD the room
loads, so a continued redraft league was drafting off dynasty values: rookies
inflated, win-now veterans deflated, all season long. And because the resolver
is shared, it also fixes League Pulse, Signal Check imports, and the trade
finder for those leagues.

**Blast radius to watch:** `leagues.format_config_id` is stored per league and
will change on the next pulse for any continued redraft league. Power rankings
recompute at most once per 24h, so those follow within a day.

### 2. The Trade Analyzer tab is now the Trade Builder

Renamed in the tab, the panel heading, the empty state, the marketing feature
card on /tools/on-the-clock, and the admin section title. The mode chips lost
their old names too, because "Startup Trade Builder" sitting beside a heading
that reads Trade Builder says the same thing twice; they now name the pool
("Startup draft" / "Rookie draft") and the blurb underneath still explains how
picks are priced.

NOT renamed: the component and module filenames (`trade-analyzer.tsx`,
`lib/on-the-clock/trade-analyzer.ts`), the Signal Check trade analyzer at
/tools/signal-check, and `lib/trade-analyzer.ts`. Those are different things.

### 3. "Draft Pulse is missing on the Rosters tab"

It is wired, and the owner's guess was right: it was a completed draft.

`pulseTeams` comes from `snapshot.pulse` in snapshot mode. All 17 snapshot rows
on prod are still `snapshot_version = 1`, which predates Draft Pulse AND grades,
and `getOrCreateDraftSnapshot` serves an existing row as-is and never upgrades
it. So every already-completed draft will show no Draft Pulse column and no
grades tab, permanently, unless its snapshot row is removed and re-finalized.

A LIVE draft is unaffected: it computes Draft Pulse fresh.

**This is the owner's call, and it is a real product decision.** The freeze
exists so a finished draft's verdicts cannot drift as values move, which is the
right instinct. But it also means nobody with a completed draft ever sees two of
the headline features. The snapshot row already stores the frozen board, the
frozen cache, and the frozen trades, so grades and Draft Pulse COULD be
back-computed from those same frozen inputs without touching a single locked
value. Draft Pulse would use today's weekly projections (those are not frozen),
which for a preseason startup is arguably the better answer anyway.

Not done here, because reversing a deliberate decision from the previous session
is not a cleanup task. Deleting a row from `on_the_clock_draft_snapshots` causes
that draft to re-finalize at version 2 on the next open, if the owner wants to
try one.

---

## What else changed, by theme

### Accessibility

- **The alert announcer moved out of the draft radar** and into the room shell
  (`DraftAlertAnnouncer` in `draft-radar.tsx`, mounted once in
  `on-the-clock-client.tsx`). The radar panel unmounts on the Rosters tab and on
  the full-width board view, and its live region went with it, so a run that
  started while someone was looking at the board was never spoken, and coming
  back re-inserted a region with content already in it, which browsers generally
  do not announce. Missed alerts, then silence. The `seen` set now lives
  somewhere that never leaves the DOM.
- **The available-list status is debounced by 500 ms.** Typing "Jefferson" used
  to queue nine announcements over the character echo. The visible sentence
  still updates on every keystroke; only the spoken one waits.
- **Board cells in the trade builder no longer fail silently.** Pressing a pick
  that cannot be priced, or one already on a side, now says why in a polite
  region, and a cell already in the trade says so in its own label instead of
  every cell reading "Add to trade".
- **The Signal Check verdict announces.** The report's live regions were
  inserted along with their content, so the room said "Running this trade
  through Signal Check" and then went quiet exactly when the answer arrived. One
  region now lives in the builder and is written into.
- **Heading levels are normalized.** Every tab panel opens at h2 (Rosters and
  Grades used to open at h3 with no h2 above them), the radar's inner sections
  are h3 rather than h4, and the admin page's five collapsible section titles
  are real headings instead of styled spans.
- **Three scroll containers are keyboard reachable** (draft board, available
  list, the "what your picks cost you" table): `tabIndex={0}` plus a role and a
  name. WCAG 2.1.1.
- **Tap targets:** the view tabs dropped `sm:min-h-0`, so they are 44px at every
  width, not just on mobile. The admin toggles now sit in a 44px row.
- **The team cards stopped announcing themselves twice.** The `<article>` label
  restated the rank, owner, value, Pulse, and archetype, all of which are
  rendered as text inside. It points at the heading now, and the archetype's
  REASON moved out of a `title` attribute (which most screen readers never
  surface) into sr-only text.
- **The Rosters re-sort announces**, matching what the available list already
  did.

### Performance

- **The projection board is memoized in process** (`projection-board.ts`, six
  entries, same 24h TTL). It was a 681 KB read plus a JSON.parse on every pulse
  request for a payload that cannot change during a draft.
- **The 43 KB per-player map is no longer re-sent every pick.** The payload
  carries a `boardEtag` derived from (scoring signature, season, from-week); the
  client sends it back and keeps its own copy. `PulsePayload.players` is now
  nullable, and null means "you already have this", never "no projections".
- **The room's render body is memoized.** It had exactly one `useMemo`, so every
  realtime pick rebuilt a 600-element board, re-sorted it, and re-ran the
  recommendation engine and the ADP simulation, on whatever tab the user was
  actually on. The fresh arrays also meant `available-list.tsx`'s own memo never
  hit. `React.memo` on the draft board and the available list, plus a stable
  `onToggleWatch`, finish the job.
- **Tab panels render their bodies conditionally.** The `role="tabpanel"`
  elements stay mounted for ARIA; their children do not.
- **One ADP simulation, shared.** The room and the Draft Pulse request used to
  run `simulateRemainingDraft` separately, sorting the same 600 players twice.
- **`readDraftCache` names its columns** and projects the four fields it reads
  out of the `metadata` jsonb in Postgres. 105 KB of the 190 KB it pulled on the
  largest real draft was metadata it never looked at.
- **`loadPlayerFacts` stopped selecting a 2.4 MB jsonb to read one string**, and
  `loadPowerPulseSettings` no longer runs twice per request.
- **`weeks.find()` is a Map now** (`lib/on-the-clock/week-index.ts`), keyed by
  the projection object in a WeakMap so it is built once per board and released
  with it.

### Correctness

- **The trade catalog and the asset resolver agree.** The catalog used to
  project an unmade pick by walking the board in VALUE order with a 50-point
  floor, while the resolver used the ADP simulation and returned 0. The dropdown
  could name one player and add another. Both read the simulation now.
- **Traded future picks keep their owner.** The catalog minted
  `tfut-2027-1-3` while the resolver produced the generic `fut-2027-1-mid`, so
  `usedIds` never suppressed the option and the placed asset lost which team's
  pick it was. The ref carries an optional `originalRosterId`, used for the id
  and the label and never for the price.
- **Reverted picks leave the cache.** A commissioner can revert a pick and
  Sleeper simply stops returning it; the upsert never removed anything, so it
  stayed on the board forever. The sync now deletes rows above the highest pick
  in the fresh payload, and a cleanup failure never fails an otherwise good sync.
- **Survivors are capped per position, not by board order.** The route's flat
  800 cap took the first 800 in board order, so kickers and defenses could be
  cut out entirely and then read as maximal scarcity. 25 per position keeps
  every position represented and drops the upload to about a quarter.

### Security

- **Migration 0185** extends `cleanup_on_the_clock_cache` to the two cache
  tables that had no eviction at all. `on_the_clock_projection_cache` keys on a
  scoring signature derived from a user-controlled `scoring_settings`, and each
  distinct shape wrote a roughly 1 MB row that nothing ever deleted. It now
  prunes projection rows past a 72 hour window (three times the TTL) and pulse
  rows whose draft is gone, and returns `{drafts, projections, pulses}`.
  service_role EXECUTE only; still not cron-wired, same as 0113.

---

## The review pass caught two things that would have shipped broken

Four sub-agent reviews ran against the finished work. Both of these are worth
knowing about, because one of them was written this session.

**The reverted-pick cleanup would have wiped live drafts.** T539 deletes pick
rows above the highest pick number Sleeper returned. `getSleeperDraftPicks`
flattened a failed request to `[]`, so a 429, a timeout, or a 5xx made the
highest pick number 0 and the delete removed every cached pick for the draft:
every drafted player back on the available board, every roster empty, pinned for
the whole cooldown, and `pick_count` written as 0 on top. The implementation and
security reviews found it independently.

This is the failure CLAUDE.md already names as an ABSOLUTE RULE for Power Pulse,
where `getSleeperMatchups` returns null on a failure and `[]` only when Sleeper
answered with no games. The picks path never got that treatment.
`getSleeperDraftPicksOrNull` keeps the null now, and a picks outage fails the
sync outright rather than writing a partial one.

**The Grades tab was dead in every live draft.** Pre-existing, from the previous
session. `teamRollups` is computed while the Rosters, Rankings, or board view is
open, and grades was never added to that list, so `computeDraftGrades` always
received an empty array and returned nothing. The tab rendered its "nothing to
grade yet" state forever. A completed draft hid it, because a version 2 snapshot
serves frozen grades and never reaches that code.

**Two more worth naming.** The Draft Pulse effect could drop its own response and
leave the room on "Loading weekly projections" for the rest of the session, and
`includePreDraftRoster` was trusted from the request body but absent from the
pulse cache key, so one crafted request could poison every viewer's standings
and, after the last pick, freeze into the permanent snapshot. Both fixed.

**T526 was reverted for six of the seven tab panels.** Gating a panel's body on
its tab unmounts it, and with it the search box, the sort, a half-built trade,
and every open grade card. The accessibility review made the case that this costs
a screen-reader user more than a sighted one, because re-finding a row in a
600-player table by ear is expensive. Only the Board panel stays gated: it holds
no state and it is the 400-cell one.

## Owner follow-ups, and what the second review round caught

Three changes the owner asked for after a first look at the room.

**Who is on the clock now leads the sidebar** on every tab, above the draft
radar. It is the panel a drafter checks constantly.

**Draft Pulse has its own tab**, and the power-rankings table moved out of
Awards into it. A ranking table was never an award. The new tab puts the POINTS
ranking beside the VALUE ranking, which is the comparison that matters mid
draft: value counts future picks, and a lineup cannot start a pick. It also
carries a "your team" summary, a section naming the teams the two rankings
disagree about most, and a per-team positional points breakdown on one shared
scale. No expected wins and no playoff odds anywhere, per the Draft Pulse rule.

**Awards, Draft Pulse, and Grades have a real pre-draft state.** Before the
first pick they showed a full page of real-looking placeholders: every award
"up for grabs", a grade table of zeroes, every team tied on points. Each now
renders a branded card saying the draft has not started and listing what will
appear once it does.

The review round on those three found two things worth stopping for:

- **Draft Pulse would still have faked a ranking on an empty projection slate.**
  The gate read "have picks been made OR does anyone have points", and the first
  half short-circuited the only question that actually mattered. A draft with
  picks but no published weekly projections rendered a complete standings table
  of zeroes with ranks assigned to a set of ties, plus a header reading "over the
  0 remaining weeks". That is the same degenerate-answer failure CLAUDE.md
  forbids for Power Pulse, arriving through a different door. There are three
  states now.
- **The not-started cards had no heading**, so pressing H inside the panel found
  nothing. Those cards are often the entire contents of a tab, and the moment
  they render is exactly the moment a user is sitting in the room waiting.

Smaller ones fixed in the same pass: the archetype chip's screen-reader text was
borrowed from League Pulse and said "by Power Pulse" on the one tab that spends
its header explaining it is not that; the room-status panel is mounted twice and
both copies claimed the same DOM id, so the visible one could end up with no
accessible name; the reliability column used a hardcoded sample threshold while
the awards used the admin's; and a team name sat at 3.7:1 contrast.

## Where the deferred plan was not followed

Two items were solved differently from what the previous handoff proposed.

- **T534 (survivorIds).** The plan was to run the ADP simulation server-side so
  the list is never uploaded. That means loading the ranked board and its ADP on
  the server on every pulse request, which costs more than the 23 KB it saves.
  The per-position cap closes the actual defect for a fraction of the work.
- **T532 (readDraftCache columns).** The plan warned that `shapePickRow` is
  shared with the Realtime handler, which receives the full row. Rather than
  making one shaper tolerant of both shapes, there are two, and
  `lib/on-the-clock/cache-shape.test.ts` pins them to the same output for an
  empty string and an absent field. That test caught a real drift while it was
  being written.

---

## Not done

- **Still no browser testing.** Everything is verified by unit tests, typecheck,
  and build. Nobody has driven the clickable draft board, the side-picker
  dialog, the grades tab, or the Shift-R summary in a real browser. This is the
  largest untested surface, and the room's render body was substantially
  restructured this session, so it deserves a real pass.
- **Draft Pulse has still never been computed against a live draft.** Two prod
  drafts now carry `league_metadata` (Brooklyn 99 Redraft, Sunday Funday), so
  the points path is available; nobody has opened them since.
- **Version 1 snapshots are still not backfilled.** See section 3 above.
- **`npm audit`: pre-existing highs only.** package.json untouched.
- **Shift+R still collides with NVDA browse-mode quick nav** (R and Shift+R move
  between radio buttons there). The visible "Read the room" button is the
  workaround. Making the shortcut configurable is the real fix.
- **An OTC snapshot finalized before the format fix keeps a dynasty
  `format_slug`.** Snapshots are immutable and nothing re-derives them, so a
  continued redraft league whose draft was already locked shows dynasty values
  there while the live room now shows redraft. Same decision as the version 1
  snapshot question above.
- **`draft-grade.ts` curve parity cannot be verified from the repo.** The file is
  untracked, so the local `zScores` and `surplusByRoster` it used to reimplement
  exist nowhere in git history. `lib/power-pulse/math.ts stdev` is the SAMPLE
  formula; if the deleted copy used the population one, every curved component
  moved when they were swapped for the shared helpers.
- **`readDraftCache` still runs in full on every pulse request** (about 120 KB,
  where the pulse path reads three of its columns). With the projection board
  memoized, the performance review names this the largest remaining server cost,
  followed by `computeMarginal`'s 200-odd lineup solves, which are cacheable on
  (draft, roster, pick count) and are not cached.

---

## Where to start next session

1. Open a live draft in a browser and drive the room. That is the gap.
2. Decide the version 1 snapshot question (section 3).
3. Note that the feature flag is already ON in prod.
