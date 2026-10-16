# Relays and Briefs: accessibility review, pass 2

Audited 2026-09-17 against WCAG 2.2 AA, the Accessibility Requirements and
Mobile-First rules in CLAUDE.md, the Lineups rules about never drawing a number
twice and never aria-hiding visible text, the Time Display rule, rule 6 (plain
ASCII copy), and the checklist in docs/beacon-brief/relays-and-briefs-plan.md
section 16. The first pass is docs/beacon-brief/reviews/accessibility.md; this
pass re-verified every "Resolution: fixed" line there in the code, then covered
the changes made on 2026-09-17 that the first pass never saw, then swept the
rest of the build for anything the first pass missed.

Scope: lib/relays/feed-params.ts, app/brief/(feed)/page.tsx and its four
sibling routes (category, team, player, tag), components/relays/*,
components/beacon-brief/brief-feed.tsx, app/brief/relay/[slug]/page.tsx,
app/brief/editions/page.tsx, the edition branch of app/brief/[slug]/page.tsx,
components/brief-desk/** (edition page, byline, relays covered, section icons,
every block), app/admin/brief-desk/**, components/admin/brief-desk/*,
components/admin/brief-desk-subnav.tsx and brief-desk-page-shell.tsx, the
relay_grounding branch of components/admin/beacon-brief/moderation-manager.tsx,
the Brief block in app/page.tsx (ArticlesSection), the Brief tile in
app/about/page.tsx, components/player-profile/beacon-brief-tab.tsx and
quick-news.tsx, components/beacon-brief/brief-pagination.tsx, and the shared
pieces the new code leans on (components/chart-kit.tsx ChartFigure and
DataTable, components/guides/guide-section-header.tsx,
components/dashboard-panel.tsx, components/faq-accordion.tsx).

Method: every file and line cited below was read in full. Contrast figures were
computed from the tokens in tailwind.config.ts with sRGB relative luminance and
alpha compositing over the real ancestor backgrounds (the script is not kept;
the composited colours are stated beside each figure so the arithmetic can be
repeated). `npm run typecheck` passes on the tree as reviewed. No code file was
edited by this pass.

Counts: 0 blocker, 4 major, 5 minor. Verified findings only.

## Blockers

None. Nothing in this build locks a screen reader or a keyboard out of a
feature.

## Major

### P2-M1. The Relay card's availability chip still fails AA, at 4.49:1

File: components/relays/relay-card.tsx line 113 (classes
`border-brand-purple/40 text-brand-purple` on the availability span), with
`chipShape` at line 66 setting `text-[11px] font-semibold uppercase`.

The first pass recorded M1 as fixed by removing the `bg-brand-purple/10` fill,
and estimated the result at about 4.9:1. That estimate is wrong for this card.
The card is `bg-surface-elevated` (#16162A, line 101), and brand purple #A855F7
on #16162A measures 4.49:1 (relative luminance 0.2154 against 0.0091). The
threshold for 11px text is 4.5:1, so the chip fails by a hair on every surface
the card appears on: the hub, the four filter routes, the permalink page, the
homepage, the player profile tab, and the relay_quote block inside an edition.
The 4.9:1 figure the first pass quoted is what purple reaches on
`bg-surface/60` over the page (#0C0C15), which is a darker background than the
elevated card.

Removing the fill did help (it was about 4.03:1 with it), so the fix was in the
right direction and stopped one step short.

Who it affects: low-vision readers, and the chip carries "Out", "Injured
reserve" and "Suspended", the most consequential word on the card.

Fix: use a lighter purple for the chip text on this card. Tailwind's purple-400
#C084FC measures 6.7:1 on #16162A and still reads as the brand hue, so
`text-[#C084FC]` in place of `text-brand-purple` on line 113 is enough; if a
token is preferred, add `brand.purple-light: "#C084FC"` to tailwind.config.ts
and use `text-brand-purple-light`. Keep `border-brand-purple/40` as it is; a
border carries no text and is not measured. The alternative of `text-ink` with
the purple border also passes (about 15:1) but loses the tone the other chips
have, so the lighter purple is the better match.

### P2-M2. The action list's call chip repeats the pattern M1 removed

File: components/brief-desk/blocks/action-list.tsx line 76 (classes
`border-brand-purple/40 bg-brand-purple/10 ... text-[11px] font-semibold
uppercase ... text-brand-purple`).

This chip carries "Waiver claim", "Hold", "Sell", "Start" or "Sit", 11px
uppercase, purple text on a purple wash: the exact combination the first pass
flagged on the Relay card and the build removed there. Here it sits on a card
that is `bg-surface/60` (line 74) over the BlockShell's `bg-base/40`
(block-shell.tsx line 48) over the page, which composites to about #0C0C15,
and the wash on top of that to about #1C132C. Purple on that wash measures
4.50:1 to two decimals, which is the threshold itself, not clearance: the
compositing rounds each channel to a whole number, and the same chip inside a
lighter ancestor (a future edition layout, a highlighted card) drops under.
The word on this chip is the whole point of the block, "Sell" versus "Hold".

Who it affects: low-vision readers of every edition that carries an action
list.

Fix: the same as the Relay card, so the two chips look alike. Drop
`bg-brand-purple/10` (purple on the card surface is 4.92:1) or, better, keep
the wash and use the lighter purple from P2-M1 so the chip reads as the same
component on both surfaces.

### P2-M3. Both chart blocks read the conclusion aloud twice in a row

Files: components/brief-desk/blocks/value-movers.tsx lines 63 to 66 and 80 to
81; components/brief-desk/blocks/injury-timeline.tsx lines 89 and 104 to 105;
components/chart-kit.tsx lines 81 to 89 (ChartFigure).

Each block passes the draft's `conclusion` to ChartFigure twice: once as
`description`, which ChartFigure renders as a visible paragraph inside the
figcaption (chart-kit.tsx line 84), and once as the first sentence of
`summary`, which ChartFigure renders as an `sr-only` paragraph immediately
after it (chart-kit.tsx line 89). `summaryParts` is seeded with
`conclusion.trim()` at value-movers.tsx line 63 and injury-timeline.tsx line
89, then the computed sentences are appended. So a screen reader hears the
figure title, the conclusion, then the conclusion again followed by "The
biggest rise is X at +Y." A sighted reader sees the conclusion once.

This is the duplication the Lineups rule exists to prevent, by the same
mechanism the first pass's M2 used (sr-only rather than aria-hidden), and it
fires on every value_movers and injury_timeline block in every edition. The
first pass's "What passes" list recorded the summaries as stating a conclusion,
which they do; it did not notice that the same conclusion is also the visible
description directly above.

Who it affects: screen reader users reading an edition top to bottom, which on
this site is the primary way an edition is read.

Fix: seed `summaryParts` with the computed sentences only and let
`description` carry the conclusion. In value-movers.tsx line 63 change
`const summaryParts = [conclusion.trim()].filter(Boolean);` to
`const summaryParts: string[] = [];`, and the same at injury-timeline.tsx line
89. The empty-data sentences at value-movers.tsx line 66 and
injury-timeline.tsx line 98 keep the summary non-empty when there is nothing to
compute. If the intent was for the sr-only summary to stand alone when a draft
leaves `conclusion` empty, use `conclusion.trim() ? [] : [fallback]`, where
the fallback is the block title, rather than repeating the visible text.

### P2-M4. Ticking a review checkbox drops keyboard focus

File: components/admin/brief-desk/edition-review.tsx line 90
(`disabled={pending}` on the TickBox checkbox), with `toggleTick` at lines 416
to 428 and the callers at 491 and 514 to 519.

`pending` comes from the component-level `useTransition` (line 391), and
`toggleTick` saves inside `startTransition`, so the moment a checkbox is ticked
every TickBox checkbox on the page becomes disabled until the save returns,
including the one that has focus. Chrome moves focus to the document body when
the focused control becomes disabled, and nothing moves it back on success
(only the failure branch at lines 424 to 426 moves focus, to the status line).
Firefox leaves focus in place but the control ignores Space until it is
re-enabled. Either way, on a research log of twenty rows, the reader ticks row
seven and is either back at the top of the document or pressing keys into a
control that does not respond, once per row.

The Save, Approve and Reject buttons use the same `disabled={pending}` but
their success paths call `run`, which focuses the result paragraph (line 412),
so they are fine. The checkboxes are the gap.

Who it affects: the owner, on the page where every edition is approved, using
the keyboard.

Fix: remove `disabled={pending}` from the checkbox at line 90 (the save is a
set replacement, so a second tick during a save is not harmful; the last write
wins and matches the visible state). If a busy signal is wanted, put
`aria-busy={pending}` on the fieldset at lines 487 and 510 instead. Keep the
failure branch as it is.

## Minor

### P2-m5. The ChartFigure disclosure table is not keyboard scrollable

File: components/chart-kit.tsx line 97 (`<div className="mt-2
overflow-x-auto">{table}</div>`), as used by value-movers.tsx line 84 and
injury-timeline.tsx line 108.

Same defect as the first pass's m10, in the one table wrapper that fix did not
reach because it lives in the shared chart kit rather than in a block file.
The table inside the "View the numbers behind this chart" disclosure has a
`min-w-[18rem]` (DataTable, line 150) and scrolls sideways on a phone, and the
wrapper is not focusable in Chrome, so a keyboard user cannot reach the
right-hand columns. Plan section 16 names this table specifically ("the figure
table scrolls inside its disclosure").

Fix: give the wrapper `tabIndex={0}`, `role="region"` and
`aria-label={`${title}, the numbers`}`, matching top-scorers.tsx lines 103 to
108. chart-kit.tsx is shared with the Beacon Breakdown and Positional WAR
charts, which gain the same fix.

### P2-m6. The off-season title choice: aria-required on a fieldset, and the error does not take focus

File: components/admin/brief-desk/edition-review.tsx lines 639 to 668.

`aria-required="true"` sits on the `<fieldset>` (line 639). A fieldset has the
group role, which does not support aria-required, so it is ignored; the radios
themselves carry no `required`. When the reader submits without a choice the
error renders with `role="alert"` (line 664), which does announce, but focus
stays on the submit button and the fieldset's `aria-describedby` is rarely
read for a group. The visible legend already says "(required)", so nothing is
hidden; the gap is that the reader has to find the radios again.

Fix: drop `aria-required` from the fieldset, add `required` to each radio at
line 644 (one `name`, so one is enough for the group), and on the error path at
line 627 focus the first radio through a ref, the way the reject form focuses
its textarea at line 691.

### P2-m7. The disabled Previous and Next pager ends are visible and aria-hidden

File: components/beacon-brief/brief-pagination.tsx lines 116 to 119 and 160 to
163.

On the first page "Previous" renders as a greyed span with `aria-hidden="true"`,
and on the last page "Next" does the same. Both are visible text hidden from
assistive technology, which the site's rule forbids. A screen reader user on
page 1 hears the page list and "Next" and never learns there is a Previous
that does not apply, which is survivable, but a reader pointing a finger or a
mouse at the greyed control hears nothing at all.

This predates the build: the diff for this file changes only `pageHref`. It is
recorded because the file is in the changed set and the first pass listed the
component as passing.

Fix: replace `aria-hidden="true"` with `aria-disabled="true"` on both spans
(the text then reads as a disabled control), or render nothing at the ends and
let the numbered list carry the position.

### P2-m8. Admin lists without role="list"

Files: components/admin/brief-desk/relays-manager.tsx line 486;
app/admin/brief-desk/editions/page.tsx line 81; app/admin/brief-desk/page.tsx
line 124; components/admin/brief-desk/edition-review.tsx lines 250, 285 and
581.

Tailwind's preflight sets `list-style: none` on every `ul`, and Safari with
VoiceOver then drops the list semantics (no "list, 12 items", no item
position). Every public list in the build carries `role="list"` for this
reason (brief-feed.tsx 241, relay-chain.tsx 21, relays-covered.tsx 27,
stat-tiles.tsx 39, action-list.tsx 63). The admin lists do not. The two
`list-disc` lists in edition-review.tsx (lines 461 and 480) keep their markers
and are fine.

Fix: add `role="list"` to the six `ul` elements.

### P2-m9. Sort buttons claim to control the status line

File: components/brief-desk/blocks/top-scorers.tsx line 130
(`aria-controls={`top-scorers-${blockId}-status`}`) and line 185
(`role="status" aria-live="polite"`).

Each column header button says it controls the status paragraph. What the
button changes is the table; the status line is a side effect. VoiceOver
announces "controls" relationships in some modes, and a reader following it
lands on a sentence rather than the sorted rows. Separately, `role="status"`
already implies `aria-live="polite"`, so the explicit attribute is redundant
(harmless, but the first pass's M4 fix used `role="status"` alone in
format-toggle.tsx line 67 and return-planner.tsx line 83, so the three blocks
now disagree).

Fix: remove `aria-controls` from the button, or point it at the table region
by giving that wrapper an id. Drop `aria-live` from line 185 to match the
sibling blocks.

## First-pass resolutions, re-verified in code

- M1: partly. The fill is gone (relay-card.tsx line 113 has no
  `bg-brand-purple/10`), but the chip is still under 4.5:1. See P2-M1.
- M2: applied. app/brief/relay/[slug]/page.tsx line 103 passes
  `headingLevel={1}` and `isPermalinkPage`, the sr-only h1 is gone,
  relay-card.tsx line 87 types the prop as 1 to 4, and relay-chain.tsx lines
  18 and 32 keep the chain sections at h2 with cards at the default h3.
- M3: applied. latest-brief-panel.tsx line 33 takes `headingLevel` (2 or 3),
  app/page.tsx line 1134 passes 3, the homepage's duplicate "Latest Brief" h3
  is gone, "Newest reports" is an h3 at line 1140 and the cards are h4 at line
  1149. The hub keeps the default 2 (brief-feed.tsx line 197).
- M4: applied. format-toggle.tsx line 67 puts `role="status"` on the one-line
  paragraph and the table at lines 73 to 127 sits outside it.
- M5: applied. edition-review.tsx lines 64 to 107: only `children` is inside
  the `<label>`, the note is a sibling wired through `aria-describedby` (line
  91), and the link is passed as `detail` (lines 526 to 536) and rendered as a
  sibling with "(opens in a new tab)".
- m6: applied. return-planner.tsx line 83 puts `role="status"` on the summary
  sentence; the lists at 88 to 109 are outside it.
- m7: closed in the direction the build record states. The inert live
  attributes are gone from brief-feed.tsx (lines 204 to 214, plain text with
  the reason in a comment) and app/admin/brief-desk/relays/page.tsx (lines
  157 to 162). Plan section 22 records the decision.
- m8: applied. brief-desk-subnav.tsx line 31 computes `active` once and line
  36 sets `aria-current` from the same flag the class uses.
- m9: applied. relay-card.tsx line 70 defines `chipLinkBase` with `min-h-11`
  and line 120 uses it on the Update link; the text chips keep `min-h-7`.
- m10: applied in the three block files (top-scorers.tsx 103 to 108,
  format-toggle.tsx 73 to 78, box-score-lines.tsx 41 to 46). The shared
  ChartFigure wrapper was not covered; see P2-m5.
- m11: left, as recorded. checkClass is still `h-5 w-5` (edition-review.tsx
  line 45) and the radios `h-4 w-4` (format-toggle.tsx line 58); every label
  carries `min-h-11` or `min-h-[44px]`.
- m12: applied. relays-manager.tsx: `aria-controls` at 378, 403 and 413 (set
  only while the panel exists, which is correct since the id is only in the
  DOM then), focus moves into the panel on open (100 to 102 and 189 to 191),
  and Cancel returns it to the trigger (298 to 309).
- m13: closed. All four sibling routes now render RelayFilters (category
  94, team 85, player 85, tag 87) through lib/relays/feed-params.ts.

## What passes, checked explicitly

- The 2026-09-17 changes. feed-params.ts is pure and bounds every value. The
  hub (app/brief/(feed)/page.tsx line 124) and the four sibling routes pass
  the same RelayFilters with the same `action` as their own path, so Apply
  resets to page 1 and keeps the route's own filter by virtue of the path; the
  hub carries team and player as hidden fields (relay-filters.tsx 41 to 43,
  page.tsx 90 to 92). relay-filters.tsx: `<form aria-label="Filter the
  reports">` (38), each select has an explicit `<label htmlFor>` whose id
  matches (45 and 48, 58 and 61), selects and the button are `min-h-11` (33,
  72), the focus ring is explicit. The `emptyMessage` prop (brief-feed.tsx 88,
  229) renders inside the existing empty state with the "Back to all reports"
  link, and the hub passes a sentence that says what happened (page.tsx 119
  to 123). The hub description changes to name the scope when a team or
  player filter is in force (page.tsx 94 to 108).
- Result counts are plain text (brief-feed.tsx 210 to 214, admin relays page
  160 to 162), directly under the h2 and after the form respectively, and the
  number is also in the masthead stat row on the public pages.
- Heading outlines, per page. Hub: h1 masthead, h2 edition title in the
  panel, h2 "Latest reports", h3 cards. Permalink: h1 card headline, h2
  earlier and later reports, h3 chain cards. Edition: h1 masthead, h2 per
  section (guide-section-header.tsx 63, id on the h2 so `aria-labelledby` on
  the section resolves), h3 per block (block-shell.tsx 49; ChartFigure with
  `titleLevel={3}`), h4 for the per-position groups (top-scorers.tsx 99) and
  the "No timeline given" list (injury-timeline.tsx 166), FAQ h2 then h3 per
  question inside the accordion, "Relays covered" h2. Editions index: h1
  masthead, h2 per season (126), h3 per edition (135). Homepage block: h2, h3,
  h3, h4. Player profile tab: Panel defaults to h2 (dashboard-panel.tsx 25),
  cards h3. Admin: one h1 per page in BriefDeskPageShell (21), h2 sections, and
  on the review page h3 per draft section (edition-review.tsx 239) with h4
  lists under it (249, 262, 284). No level is skipped anywhere.
- Landmarks: `<main id="main">` on every public page and on the admin layout
  (app/admin/layout.tsx 30); named navs for the subnav ("Brief desk
  sections"), the admin pager ("Relay pages") and the feed pager ("Article
  pages"); the summary aside is `aria-label="Summary"`; every section is
  `aria-labelledby` its heading; the loading boundary is one `role="status"`
  region whose text is the content that replaces (loading.tsx 57 to 69).
- Every timestamp goes through lib/datetime.ts. A grep across the changed
  and new files for `toLocale`, `new Intl.DateTimeFormat` and
  `new Date(...).toString` finds only two number formatters
  (`counts.editions.toLocaleString()` in app/about/page.tsx 297 and the
  count formatter in app/page.tsx 542), neither a date. Dates render through
  `formatEastern`, `formatEasternDate` and `formatEasternShortDate`
  (period.ts 9, latest-brief-panel.tsx 16, edition-byline.tsx 19,
  relays-covered.tsx 12, editions/page.tsx 6, block-shell.tsx 12,
  relay-card.tsx 33, quick-news.tsx 10, every admin page). Every rendered
  date is inside a `<time dateTime>` on the public pages.
- ASCII only. A grep for any non-ASCII byte across components/relays,
  components/brief-desk, components/admin/brief-desk, app/brief,
  app/admin/brief-desk, lib/relays, lib/brief-desk and the changed
  beacon-brief and player-profile files finds only the validator's own
  detection list (lib/brief-desk/validate-draft.ts 55 to 61), its test, and
  the normaliser in lib/relays/extract.ts 103 to 106, which exist to keep
  those characters out of copy. No aria-label, alt, option label or visible
  string carries one.
- Nothing visible is aria-hidden in the new files. Every `aria-hidden` is a
  lucide icon, the empty-state icon tile, the decorative hairline, or the two
  chart SVGs whose numbers are restated in the table (grep listed above; the
  one exception is the pre-existing pager end, P2-m7).
- No number is drawn twice for eye and ear. stat-tiles.tsx 42 is one text
  node per tile; every sr-only span appends only the missing words inside the
  same element as the visible text (relay-card.tsx 123, 185, 199, 208;
  action-list.tsx 103; top-scorers.tsx 143 to 145; edition-review.tsx 274,
  534, 736; relays-manager.tsx 361). The one duplication found is a sentence,
  not a number, and is P2-M3.
- Contrast, computed this pass (foreground on the composited background):
  brand purple on surface-elevated #16162A 4.49:1 (P2-M1); brand purple on
  the action chip wash #1C132C 4.50:1 (P2-M2); brand purple on
  `bg-surface/60` over the page #0C0C15 4.92:1 (the Latest Brief eyebrow,
  11px, passes); brand purple on the homepage panel #0D0D16 4.89:1 (passes);
  brand purple on `bg-surface` #0F0F1A 4.81:1 (callout caption, 14px
  semibold, passes); brand purple on the page #07070D 5.08:1 (section
  eyebrows, pass); cyan on the kind chip wash 8.17:1; warning on the Update
  chip wash 7.04:1; ink-subtle on surface-elevated 5.24:1 (card fact labels,
  12px, pass), on surface 5.61:1, on the page 5.93:1 (the 10px sort buttons,
  pass); ink-muted on surface-elevated 7.58:1; black on the beacon gradient
  5.31:1 at the purple end and 11.62:1 at the cyan end (both buttons pass);
  ink on the active subnav chip 15.79:1; danger on the admin stat card
  5.17:1; warning on the admin chip 9.06:1.
- Live regions that actually fire: format-toggle.tsx 67, return-planner.tsx
  83 and top-scorers.tsx 185 change on interaction; the two admin result
  paragraphs (edition-review.tsx 436 to 444, relays-manager.tsx 476 to 484)
  are `tabIndex={-1}` and receive focus after every action, so they announce
  by focus as well as by live region.
- Focus management: relays-manager panels take focus on open and give it
  back on Cancel; the reject form focuses its textarea on an empty submit
  (edition-review.tsx 691); the Unhide button's disabled state is followed by
  `announce` moving focus (relays-manager.tsx 388 to 393, 468 to 472).
- Labels: every input, select and textarea in relay-filters.tsx, the admin
  relays filter form (wrapping labels, 101 to 148), return-planner.tsx,
  format-toggle.tsx (fieldset with a visible legend, native radios in
  labels), edition-review.tsx (explicit `htmlFor` on every editor, 198, 202,
  304, 345, 349, 353, 699) and relays-manager.tsx (121, 226, 250 to 257,
  262) has a visible label. The reject notes field carries `required`,
  `aria-required`, `aria-invalid` and `aria-describedby` to the hint or the
  error, and the error is `role="alert"` (702 to 724); the hide, retract and
  edit forms do the same (relays-manager.tsx 124 to 143, 229 to 244).
- Disclosures: `aria-expanded` and `aria-controls` on the three row buttons;
  the FAQ and the cited-Relay disclosures are native `<details>`, so state
  comes from the platform; the ChartFigure table is a native `<details>`
  with a `min-h-11` summary.
- Navigation state: `aria-current="page"` on the active subnav chip and on
  the active feed page number; the feed pager has `rel="prev"` and
  `rel="next"` and every page is a real link.
- External links say so: relay-card.tsx 185, edition-review.tsx 274, 534 and
  736, relays-manager.tsx 361, all with `rel="noopener noreferrer"`.
- Link names are unique and say where they go: "Permalink: {headline}",
  "Covered in the Brief: {title}", "Update: read the earlier report this one
  follows", "Review {title}", "Set a bid in the FAAB calculator for {name}".
- Tap targets: every button and every standalone link in the new files
  carries `min-h-11` or `min-h-[44px]` (relay-card pills and the Update
  chip, the panel and feed buttons, every admin button, the subnav chips, the
  pager, the relays-covered links, the action-list tool links, the sort
  buttons, the disclosure summaries). The only exceptions are links inside
  running sentences (edition-review.tsx 449 and 267 to 275, editions/page.tsx
  121, injury-timeline.tsx 176, return-planner.tsx 30), which WCAG 2.5.8
  excepts as inline.
- Mobile: a grep for `hidden sm:`, `hidden md:`, `hidden lg:` and the
  reverse forms across the new files finds nothing. The Relay card `<dl>`
  stacks below `sm` with every fact present (relay-card.tsx 142); the
  homepage grid stacks below `lg` (app/page.tsx 1128); the editions admin
  `<dl>` goes four columns to two (editions/page.tsx 99); the stat tiles go
  three-up to two-up (stat-tiles.tsx 39); the action cards two-up to one
  (action-list.tsx 63); every table scrolls rather than dropping a column
  (P2-m5 covers the one wrapper that is not yet keyboard reachable).
- Colour is never the only channel: every status chip carries the word
  (relays-manager.tsx 323, editions/page.tsx 95); the value-movers bars carry
  the signed figure as text (135) and the table carries every number; the
  callout's tone is a border beside a caption; the "danger" stat in the admin
  overview is a labelled number.
- Interactive blocks render their default state on the server (top-scorers,
  format-toggle, return-planner are client components whose initial state is
  the default sort, format and week range), so the page is complete without
  JavaScript.
- The retracted permalink page has its own h1, a sentence and a way back
  (app/brief/relay/[slug]/page.tsx 69 to 85).
- The Brief tile on the About page and the Brief block on the homepage carry
  no timestamp and no non-ASCII character; the tile body is a sentence, and
  the count is a number formatter, not a date.

## Resolutions, 2026-09-17

- P2-M1 and P2-M2: fixed with one new token, brand.purple-light (#C084FC,
  6.7:1 on the elevated card), on the Relay availability chip and the
  action-list call chip; the tinted fill is off the action chip.
- P2-M3: fixed. Neither chart repeats the conclusion in its sr-only summary.
- P2-M4: fixed. The tick checkboxes are no longer disabled during a save; the
  two fieldsets carry aria-busy while it runs.
- P2-m5: fixed. The ChartFigure table wrapper is a focusable, named region.
- P2-m6: fixed. aria-required is off the fieldset, the radios are required,
  and the error moves focus to the first radio.
- P2-m7: fixed. The disabled pagination ends use aria-disabled; the icons
  alone are aria-hidden.
- P2-m8: fixed. role="list" on every admin ul named.
- P2-m9: fixed. aria-controls removed from the sort buttons; the status line
  is role="status" alone.
