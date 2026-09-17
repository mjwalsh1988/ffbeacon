# Relays and Briefs: accessibility review

Audited 2026-09-17 against WCAG 2.2 AA, the Accessibility Requirements and
Mobile-First rules in CLAUDE.md, the Lineups rules about never drawing a number
twice and never aria-hiding visible text, and the checklist in
docs/beacon-brief/relays-and-briefs-plan.md section 16.

Scope: components/relays/*, components/brief-desk/** (edition page, byline,
relays-covered, section-icons, every block), components/beacon-brief/brief-feed.tsx,
app/brief/(feed)/page.tsx and its four sibling filter pages,
app/brief/relay/[slug]/page.tsx, app/brief/editions/page.tsx, the edition branch of
app/brief/[slug]/page.tsx, app/admin/brief-desk/**, components/admin/brief-desk/*,
components/admin/brief-desk-subnav.tsx, the relay_grounding branch of
components/admin/beacon-brief/moderation-manager.tsx, the Brief block in
app/page.tsx (ArticlesSection), components/player-profile/beacon-brief-tab.tsx and
quick-news.tsx.

Counts: 0 blocker, 5 major, 8 minor. Verified findings only; every line number
was read, and the contrast figures below were computed from the tokens in
tailwind.config.ts against the actual composited backgrounds.

## Blockers

None. Nothing in this build locks a screen reader or a keyboard out of a
feature.

## Major

### M1. The availability chip on a Relay card fails AA contrast (about 4.0:1)

Resolution: fixed in components/relays/relay-card.tsx.

File: components/relays/relay-card.tsx lines 100 to 104 (classes
`border-brand-purple/40 bg-brand-purple/10 text-brand-purple` on top of the
card's `bg-surface-elevated`), with `chipBase` at line 64 setting
`text-[11px] font-semibold uppercase`.

Barrier: brand-purple `#A855F7` measures about 4.03:1 against
`bg-brand-purple/10` composited over `surface.elevated` `#16162A` (the blended
chip background is roughly `#251C3E`). The text is 11px, so it needs 4.5:1; it
does not qualify for the 3:1 large-text allowance. This is the chip that carries
"Out", "Injured reserve", "Suspended" and the rest of AVAILABILITY_LABELS, which
is the most consequential word on the card.

For comparison, the sibling chips pass: the cyan kind chip is about 8.2:1, the
warning-toned Update chip about 7.0:1, the plain week chip (ink-muted) about
7.6:1. Only the purple one fails, because purple is the darkest of the brand
hues and the elevated surface is the lightest background on the page.

Who it affects: low-vision readers and anyone on a phone in daylight.

Fix: drop the tinted fill on this chip so the text sits on the card surface
(`border-brand-purple/40 text-brand-purple` with no `bg-brand-purple/10`), which
lifts it to about 4.9:1; or keep the fill and use a lighter purple. Do not solve
it by enlarging the text, since 11px uppercase would still fall short of the
18.66px bold threshold.

### M2. The permalink page puts an h1 after an h2, and says the headline twice

Resolution: fixed in components/relays/relay-card.tsx and app/brief/relay/[slug]/page.tsx.

File: app/brief/relay/[slug]/page.tsx lines 86 to 89, with
components/relays/relay-card.tsx lines 78 and 115.

Barrier: the card renders first with `headingLevel={2}`, then an `sr-only` h1
carrying the identical headline text is placed after it. Three consequences.
The document's first heading is an h2, so a reader who opens NVDA's heading list
or presses 1 finds the page title below the card rather than at the top. The
outline reads h2, h1, h2, h2 (the chain headings in relay-chain.tsx lines 18 and
32), which is not a hierarchy. And the headline is announced twice in a row, in
reading order, which is exactly the duplication the Lineups rule exists to
prevent, only with `sr-only` instead of `aria-hidden` as the mechanism.

The comment at line 87 says the h1 is needed "before the h2 chain headings", but
it is not before them in DOM order either; it sits after the card that already
said it.

Who it affects: screen reader users navigating by heading, which on this site is
the primary navigation mode.

Fix: widen `headingLevel` in relay-card.tsx to `1 | 2 | 3`, pass
`headingLevel={1}` from the permalink page, and delete the `sr-only` h1. The
card's `aria-labelledby` then names the article with the page's h1, and the
chain's h2s sit correctly under it.

### M3. The homepage Brief block nests the panel's h2 under an h3

Resolution: fixed in components/relays/latest-brief-panel.tsx and app/page.tsx (the panel takes a heading level, the homepage passes 3 and drops its own "Latest Brief" heading, and the Relay cards move to 4 under "Newest reports"; the card's prop is 1 to 4 so both this and M2 are expressible).

Files: components/relays/latest-brief-panel.tsx line 33 (hardcoded `h2`),
app/page.tsx lines 1129 to 1139.

Barrier: the homepage section heading is an h2 ("What changed this week", line
1098), under it an h3 ("Latest Brief", line 1129), and inside that h3's block
LatestBriefPanel renders its own h2 with the edition title. The level goes 2, 3,
2 inside one subsection, so the edition title reads as a sibling of the section
that contains it. The panel also renders its own eyebrow reading "Latest Brief"
(latest-brief-panel.tsx lines 29 to 32) directly under the homepage's h3 of the
same words, so a reader hears "Latest Brief" twice before the title.

The same panel is correct on /brief, where it is a top-level h2 under the
masthead h1. The defect is that the level is fixed in the component.

Related, same block: app/page.tsx line 1153 renders the Relay cards at
`headingLevel={3}` under the h3 at line 1144, so each card's heading is a
sibling of its own group heading rather than a child.

Who it affects: screen reader users navigating by heading; also any outline
extractor, which matters for a page that is trying to earn back search trust.

Fix: give LatestBriefPanel a `headingLevel?: 2 | 3` prop defaulting to 2, pass 3
on the homepage, drop the homepage's duplicate h3 (or drop the panel's eyebrow
when a heading is supplied), and move the Relay cards to `headingLevel={4}` or
promote "Newest reports" to an h3 with cards at h4 consistently.

### M4. The format toggle announces the whole table on every change

Resolution: fixed in components/brief-desk/blocks/format-toggle.tsx.

File: components/brief-desk/blocks/format-toggle.tsx line 60.

Barrier: `aria-live="polite"` is on the `<div>` that wraps both the status
sentence and the entire results table. Changing the format changes every value
cell and every value column header, so a polite announcement fires for the whole
changed subtree: potentially fifteen rows times five columns of player names and
numbers, read aloud before the reader can do anything. The file's own docstring
describes the intent as announcing "a change", which is the one-sentence status
line, not the table.

Who it affects: NVDA and VoiceOver users, who will sit through a full table
reading for a two-word state change, and cannot interrupt it without moving
focus.

Fix: move `aria-live="polite"` (or better, `role="status"`) onto the `<p>` at
line 61 only, and leave the table outside the live region. The table is
reachable by table navigation immediately afterwards, and the caption at line 69
already names the chosen format.

### M5. The review checklist nests a link inside the checkbox's label

Resolution: fixed in components/admin/brief-desk/edition-review.tsx.

File: components/admin/brief-desk/edition-review.tsx lines 56 to 85 (TickBox) as
used at lines 492 to 507.

Barrier: `TickBox` renders `<label htmlFor={id}>{children}</label>`, and the
research-log children are the claim, a note line, and a full `<a href={r.url}>`
whose visible text is the raw URL with `break-all`. Two problems follow. The
checkbox's accessible name becomes the claim plus "Fetched Sep 15, 2026, 9:05 AM
EDT" plus the note plus the entire URL, read as one string every time the reader
lands on the checkbox and again on every state change. And an anchor sits inside
a label's activation region, which is an HTML anti-pattern: the label element's
content model expects no interactive content other than its own control, and
browsers disagree about whether the click reaches the checkbox.

Who it affects: the owner, on the page where every edition is approved.

Fix: keep only the claim inside the `<label>`, move the note and the link out to
siblings, and associate the note with the checkbox through `aria-describedby`.
The link then appears once in the link list with a sensible name (give it text
such as "Open the source page" with the URL as visible detail text outside the
anchor, or keep the URL as the link text but outside the label).

## Minor

### m6. The return planner's live region wraps the whole result list

Resolution: fixed in components/brief-desk/blocks/return-planner.tsx.

File: components/brief-desk/blocks/return-planner.tsx line 80.

Same shape as M4 but smaller: the region holds the summary sentence, the list of
returning players, the "expected after week N" line and the "no timeline" line.
A week change re-announces all four. Less severe because every changed node is
genuinely part of the answer and the list is short.

Fix: put the live region on the summary `<p>` at line 81 and leave the list
outside it, matching the fix in M4 so the two interactive blocks behave the same
way.

### m7. The filter count region never announces, because the filter is a page load

Resolution: left, the owner has to choose between removing the inert live attributes and making the announcement real, and either way it is a decision rather than a local fix.

Files: components/beacon-brief/brief-feed.tsx lines 177 to 181;
app/admin/brief-desk/relays/page.tsx line 153.

Plan section 16 asks for "an `aria-live="polite"` region [that] announces the
result count after a filter change". Both regions carry `role="status"` and
`aria-live="polite"` on content that is present in the initial HTML, and both
filter forms are plain GET submissions that navigate. A live region never fires
for content that exists at page load, so the announcement the checklist asks for
does not happen; the attributes are inert. The brief-feed comment at lines 175
to 176 acknowledges the full page load but still relies on the live region.

Who it affects: nobody is blocked (the count is visible text and is also in the
masthead stat row), but the checklist item is not actually satisfied.

Fix: either accept it and remove the live attributes (the count is reachable as
ordinary text right under the h2), or make the announcement real by moving focus
to the results heading after a filtered navigation, or by rendering the count
into the page `<title>` and the h2 so it is spoken on page change. Do not leave
an inert live region that a later reviewer will read as covered.

### m8. The Brief desk subnav marks the active chip visually but not programmatically

Resolution: fixed in components/admin/brief-desk-subnav.tsx.

File: components/admin/brief-desk-subnav.tsx lines 29 to 36.

`active` is computed with `pathname.startsWith(p.href + "/")` and drives the
purple border and fill, but `aria-current` is set only on an exact pathname
match. On /admin/brief-desk/editions/[id] the Editions chip looks current and
announces as an ordinary link. The comment at line 9 claims the chip "stays
active on a review page", which is true for the eye and false for the ear. This
is state carried by colour alone.

Fix: pass `aria-current={active ? "page" : undefined}` at line 34, matching the
variable the class already uses.

### m9. The "Update" chip link is 28px tall

Resolution: fixed in components/relays/relay-card.tsx.

File: components/relays/relay-card.tsx lines 63 to 64 (`chipBase` sets
`min-h-7`) as applied to the Link at lines 105 to 113.

Every other chip built on `chipBase` is a span, but this one is interactive. At
28px it clears WCAG 2.2's 24 by 24 minimum (2.5.8) but not the project's own
"at least 44 by 44 CSS px for any interactive element" rule. The player and team
pills beside it use `pillBase` with `min-h-11`, so the row already has a
44px-tall precedent.

Fix: add `min-h-11` to the Update chip's class list (keeping `min-h-7` for the
non-interactive chips so the header row does not grow).

### m10. Horizontally scrollable tables are not keyboard focusable

Resolution: fixed in components/brief-desk/blocks/top-scorers.tsx, format-toggle.tsx and box-score-lines.tsx.

Files: components/brief-desk/blocks/top-scorers.tsx line 100,
components/brief-desk/blocks/format-toggle.tsx line 67,
components/brief-desk/blocks/box-score-lines.tsx line 41.

Each table sits in a bare `<div className="overflow-x-auto">`. Firefox makes
scroll containers focusable; Chrome does not. A sighted keyboard user on a phone
or a narrow window cannot scroll these tables sideways without a mouse or touch,
so the right-hand columns are unreachable. This is the mobile-first rule's
failure mode by a different route: the data is not hidden by a breakpoint, it is
just not reachable.

Fix: give each wrapper `tabIndex={0}`, `role="region"` and an `aria-label`
naming the table, which is the standard fix and also gives a screen reader a
named landmark to jump to.

### m11. Checkbox and radio controls are 16 to 20 CSS px

Resolution: left, the label is part of the same target and the effective hit area already clears 44 px.

Files: components/admin/brief-desk/edition-review.tsx line 45 (`h-5 w-5`) and
lines 612 to 615; components/brief-desk/blocks/format-toggle.tsx line 52
(`h-4 w-4`).

The controls themselves are below the project's 44px bar. WCAG 2.2's 2.5.8 is
satisfied, because each control's label is part of the same target and every
label carries `min-h-11` or `min-h-[44px]` with generous spacing, so the
effective hit area is compliant. Recorded because the project rule is stated
without the label exemption and a future reviewer will measure the input.

Fix, if the owner wants the letter of the rule: size the inputs with a scale
transform or a wrapper of `h-11 w-11` and keep the visual box small, or record
the label-as-target reasoning in a comment beside `checkClass`.

### m12. Opening a disclosure panel in the Relays manager does not move or bound focus

Resolution: fixed in components/admin/brief-desk/relays-manager.tsx.

File: components/admin/brief-desk/relays-manager.tsx lines 341, 363 to 368 and
374 to 408.

The Hide, Retract and Edit buttons carry `aria-expanded`, which is correct, but
no `aria-controls`, and the revealed form is a sibling that appears after the
button row. A reader who presses Edit hears "expanded" and then has to tab
forward through the remaining buttons to find the form. Closing a panel with
Cancel leaves focus on a button that is about to unmount (line 406), so focus
falls to `<body>`.

Fix: add `aria-controls` pointing at the panel's id, move focus to the panel's
first field when it opens, and return focus to the trigger on Cancel. The
success path is already correct: `announce` moves focus to the result paragraph
(lines 418 to 422) before the panel unmounts.

### m13. The four sibling filter pages omit the kind and week filter

Resolution: left, adding the kind and week filter to the four sibling routes is a feature change across four route files rather than a local fix.

Files: app/brief/(feed)/category/[slug]/page.tsx, player/[slug]/page.tsx,
tag/[tag]/page.tsx, team/[abbr]/page.tsx (each calls `BriefFeed` without the
`filters` prop; compare app/brief/(feed)/page.tsx line 134).

`RelayFilters` already accepts a `carry` map for exactly this case, and the hub
uses it to keep the team and player filters while changing the week. On the
filter pages the control is simply absent, so narrowing a team's reports to one
week requires hand-editing the URL. Not a WCAG failure; recorded because the
plan's section 6.1 describes the filters as part of the feed and a
keyboard-only reader has no other route to them.

Fix: pass `filters={<RelayFilters action={basePath} ... />}` from the four
pages, carrying the page's own filter as a hidden field.

## What passes, checked explicitly

- Every timestamp resolves through lib/datetime.ts. A grep for `toLocale` and
  `new Intl.DateTimeFormat` across components/relays, components/brief-desk,
  components/admin/brief-desk, app/brief, app/admin/brief-desk, brief-feed.tsx,
  beacon-brief-tab.tsx, quick-news.tsx and brief-desk-subnav.tsx returns nothing.
  All formatting goes through `formatEastern` or `formatEasternDate`.
- Nothing visible is aria-hidden. Every `aria-hidden` in the new files is a
  lucide icon, a decorative gradient rule, or a chart `<svg>` whose numbers are
  restated in the ChartFigure summary and the disclosure table.
- No number is drawn twice for eye and ear. stat-tiles.tsx line 42 renders each
  tile as one text node (`${label}: ${value}`). Every `sr-only` span in the new
  files appends missing words inside the same element as the visible text
  (relay-card.tsx 173, 187, 196; action-list.tsx 103; top-scorers.tsx 135), which
  is the shape the Lineups rule requires.
- Both charts are ChartFigure with a conclusion sentence and a real table:
  value-movers.tsx lines 78 to 104 and injury-timeline.tsx lines 102 to 130. Both
  pass `titleLevel={3}`, which is right under the edition's h2 sections. Both
  summaries state a conclusion ("the biggest rise is X at +Y"), not a shape.
- Colour is never the only channel. Value-movers bars carry the signed figure as
  text beside every bar (line 135); the Relay status chips in the admin list
  carry the word (relays-manager.tsx line 291); the callout's tone is paired with
  its caption text.
- Every interactive block renders its default state at rest: top-scorers,
  format-toggle and return-planner are client components that server-render their
  default sort, format and week range, so a crawler and a reader without
  JavaScript see the table.
- Sort is announced properly: top-scorers.tsx puts `aria-sort` on the `<th>`
  (line 117), the toggle in a native `<button>`, and a `role="status"` line that
  changes on every sort (line 177). The button's `sr-only` suffix says what
  activating it will do.
- Labels: every control in relay-filters.tsx, return-planner.tsx,
  format-toggle.tsx, the admin Relays filter form and every editor in
  edition-review.tsx has an explicit or wrapping label. The reject notes field
  carries `required`, `aria-required`, `aria-invalid` and `aria-describedby`
  pointing at either the hint or the error (edition-review.tsx lines 670 to 692),
  and the error is `role="alert"`.
- Focus after an action: both admin managers move focus to a `tabIndex={-1}`
  `role="status"` paragraph carrying the result (edition-review.tsx 385 to 392,
  relays-manager.tsx 418 to 422).
- Pagination: components/beacon-brief/brief-pagination.tsx carries
  `aria-label="Article pages"` and `aria-current="page"`; the admin relay pager is
  a `<nav aria-label="Relay pages">`.
- External links announce the new tab: relay-card.tsx 173, edition-review.tsx
  252, 505 and 704, relays-manager.tsx 329.
- FAQ is the shared native `<details>` accordion, so `aria-expanded` comes from
  the platform.
- Mobile: the fact `<dl>` on a Relay card collapses to one column below `sm`
  with every fact present (relay-card.tsx line 130); the admin editions `<dl>`
  goes from four columns to two (editions/page.tsx line 92); the block tables
  scroll rather than dropping columns; the stat tiles go three-up to two-up. No
  `hidden md:` pattern appears anywhere in the new files.
- Landmarks and h1s: every page renders exactly one h1 (PageMasthead for the
  hub, the editions index and the edition; BriefDeskPageShell for each admin
  page), inside a `<main id="main">`. The one exception is the permalink page,
  which is M2.
