# Handoff: search growth plan, 2026-10-15

Plan of record: docs/seo-audit/gsc-growth-plan-2026-10-15.md (untracked, owner's file).
Task list: progress.md, GROW-T01 to GROW-T22, at the bottom of the file.

## State

GROW-T01 to GROW-T16 are completed, each through the gate (typecheck, lint,
test, build) and the three review sub-agents, and committed on main. Nothing
is pushed. Working tree is clean apart from the untracked plan document.

Commits: T01 8b4ff23, T02 804592f, T08 213a6de, T03 ede5714, T04 dd35c0c,
T05 94a7207, T06 d5eb46c, T07 3dfc06f, T09 cb4b6cc, T10 fe5dd96, T11 a03b88c,
T12 1e2b938, T13 830c6df, T14 eed1135, T15 6562435, T16 90b20d5.

Indexing points: /tools/faab/guillotine was ready after T09. /rankings/idp
becomes ready after T19. The owner requests indexing by hand.

## What is left, in order

T17, T18, T19, then T20, T21, T22. Nothing for them is applied yet.

- T17, app/rankings/page.tsx. In the format directory section (the function
  that renders FormatGroup "Dynasty and keeper" and "Redraft and best ball"),
  after the two-column grid and before </section>, add a third group in the
  same visual shape: an h3 "Individual defensive players" (id
  format-group-defenders) over a one-item ul, a Link to /rankings/idp with no
  linkQuery, label "IDP rankings" and hint "Defensive linemen, linebackers and
  defensive backs, projected rest of season" on a second line, ArrowRight icon
  aria-hidden. Do not touch the hub's redirect.
- T18, app/tools/faab/faab-form.tsx, function SelectedPlayerCard. After the
  closing </dl>, when player.unranked (the flag the manual defenders carry),
  render a p: "No value source prices a defender. See where he sits in our "
  + Link /rankings/idp "IDP rankings" + ".". No defender note exists there
  today, so it is a new paragraph.
- T19, lib/site.ts SEARCHABLE_TOOLS only: the entry in plan 5.9, after the
  "Fantasy Leaders" entry.
- T20: plan 6.2. Note that app/waiver-wire/[week]/page.tsx says "Three things
  take it the rest of the way to yours." above that list; with a fourth item
  that sentence must change too.
- T21: plan 6.3. Use the staticSitemapPaths() helper pattern already in
  lib/sitemap/sections.ts for any test seam you need.
- T22: plan 6.4.

## Working notes that save time

- Many files are CRLF. Exact-string edits through a small Node script that
  normalises line endings worked reliably; the Edit tool also works.
- Send npm test and npm run build output to a file and read the summary
  lines; the full build table is about 10k tokens.
- One shell command per call (CLAUDE.md rule 7). Never pass name to Agent.

## Deviations and decisions to carry into the final report

- T01: requestedSourceSlug is string | null (the resolver returns null). The
  before/after check compared the main element with numbers masked, not the
  whole page HTML. server-only import added on review.
- T02: plan said "four keys in BAND_LABELS"; there are three plus overall.
- T08: review found parseManualSeed read danger values off Object.prototype
  (?danger=constructor would crash /tools/faab). Fixed with an own-key check;
  a teams-alive figure with no starting field is now dropped. Tests added.
- T03: login and clear-handle links were hardcoded to /tools/faab; pagePath
  prop added to FaabForm and LeaguePanel.
- T04: three intro paragraphs are blocks inside ToolExplainer's single p.
  Copy corrected on review where it overstated what the release cutoff does.
- T05: p25 added to MarketRead (lib/guides/faab-market-figures.ts). Column
  headers read "1 in 4 paid less than" and "1 in 4 paid more than" so they
  wrap at 360 px. The platform table sits under the market table, per 3.6.
- T06: the llms sentence is emitted for the /tools/faab TOOL_CATALOG entry
  inside lib/llms/llms-full-txt.ts, because that paragraph comes from
  TOOL_CATALOG, which section 2 forbids editing.
- T07: guide line numbers were about 40 lower than the plan says (T02 moved
  code out).
- T10: uses the waiver page's BidFigure (adds about 3 kB to /tools/faab
  first-load JS; its hyphen is aria-hidden with a spoken "to"). Position and
  team spelled out visibly; visible rank numbers.
- T11: faab-strategy and playoffs guides already read "FAAB calculator"; no
  guide date bumped in T11.
- T12: snap share stored 0 to 1, shown 0 to 100, capped at 100 (2025 holds a
  1.0107). Finishes shown only at the position earned. Public tables read with
  the cached publishable client. The "their 2025 points" basis wording is the
  seed's, kept per the plan.
- T13: stacked-cell classes copied from components/rankings-table.tsx (the
  table rankings-view.tsx renders). Section ids derived from positionNoun
  (a second code-to-noun map fails lib/site.test.ts). "Projected by" chip only
  when a row is projected and the engine is not "none". Rail panel added so
  the rail is never empty below xl. "pts" and "No snaps" kept per the plan.
- T14: /rankings/idp is in STATIC_PATHS at 0.8 (plan allows), tested.
- T15: the not-found line renders nothing when a position lists fewer than
  60, so it never claims a cut-off that does not exist.
- npm audit: a T03 reviewer saw 15 advisories (5 moderate, 10 high) against
  an earlier 4; package files are unchanged, so it is the advisory database.
- Writing check: every new string was reviewed against the AI-writing list by
  the implementation reviewer for its task; fixes made are listed above.
