# Handoff: site-wide dashboard chrome (2026-08-19)

Two task-log entries: `progress.md` T605 (the shell) and T606 (On The Clock's
view switcher moving into it). Both complete and reviewed.

## Status summary

**Complete and reviewed.** Nothing committed or pushed, at the owner's request.
No dev server is running.

- Safe to review: YES. `npx tsc --noEmit` clean, 1747 tests across 122 files
  pass, `npx next build` compiles clean on a fresh `.next` and generates all
  261 static pages.
- No migrations. `supabase/migrations/` is untouched; no schema or RLS change.
- Four review sub-agents ran (implementation, security, performance,
  accessibility) and every confirmed finding is fixed. See the T605 entry in
  `progress.md` for what they found, and "What is left" below for what was
  deliberately not done.

The goal: take the dashboard treatment League Pulse got in commit b87ca43 and
make it the chrome for the whole site. Task log entry is `progress.md` T605.

Owner's brief, verbatim in intent:
- The League Pulse dashboard look and feel applies across all of FF Beacon.
- Horizontal navigations become the left sidebar, with real multi-level
  submenus: pressing a section slides the current level out to the left while
  the new level comes in from the right.
- The breadcrumb bar from League Pulse appears on every page, same styling.
- The sidebar and the horizontal header merge: collapsed sidebar shows only the
  FF Beacon mark, expanded shows the mark plus the "FF Beacon" wordmark. The
  rest of the header always shows and stays sticky.
- Reference images: the four most recently downloaded files in
  `~/Downloads` (`players-research-dark`, `tier-ranking-dark`,
  `projection-levers-dark`, `draft-room-dark`). Heavy uppercase headings, team
  logos in profile headers, dense stat tiles, icon rail with an active row.
- SEO and accessibility must not regress.
- Four review sub-agents at the end: implementation, security, performance,
  accessibility.
- Do not commit, do not push.

## What is done

New files:
- `lib/nav-tree.ts` - the site navigation tree, with icon names and hints, cut
  down by whether the viewer is signed in and whether they are an admin. Tools
  and games come from `lib/site.ts` so the footer and the rail cannot drift.
  SERVER ONLY: it names every admin route, and filtering it in the browser would
  still have shipped the list to everyone.
- `lib/nav-types.ts` - the node type and the active-route lookup, safe to import
  anywhere, so a client component never has to reach for the tree itself.
- `lib/breadcrumbs.ts` - the breadcrumb trail derived from the pathname, a
  written-label registry for known prefixes, a slug humanizer for the rest, and
  the BreadcrumbList JSON-LD builder. Also carries the two deny-lists: routes
  that render their own breadcrumb (League Pulse) and routes that already
  publish their own BreadcrumbList (`/brief`, `/guides`, `/players`).
- `lib/nav-viewer.ts` - `getNavViewer()`, React-`cache`d, so the header and the
  layout share one session read.
- `components/app-shell/` - `sidebar-state.tsx`, `nav-levels.tsx`,
  `nav-icons.ts`, `app-rail.tsx`, `app-rail-sections.tsx`, `app-mobile-nav.tsx`,
  `rail-toggle.tsx`, `rail-sections.tsx`, `breadcrumb-bar.tsx`,
  `breadcrumb-label.tsx`, `app-shell.tsx`, `masthead-card.tsx`,
  `page-masthead.tsx`, `page-body.tsx`.
- `components/league-shell/league-rail-sections.tsx` - League Pulse registering
  its five sections into the shared rail.

Changed:
- `app/layout.tsx` - wraps everything in `SidebarProvider`,
  `RailSectionsProvider`, and `BreadcrumbLabelProvider`, renders `AppShell`
  between the header and the footer, and emits the blocking script that restores
  the rail width before paint. Deliberately synchronous: see the note below.
- `components/header-shell.tsx` - one opaque edge-to-edge sticky bar, 72px,
  always painted. The floating pill and the transparent-at-top state are gone.
- `components/site-header.tsx` - left cell is the width of the rail and holds
  the mark plus the wordmark; the primary nav links are gone (they live in the
  rail); the rail toggle and the mobile drawer trigger sit beside it.
- `components/league-shell/league-shell.tsx` - no second rail.
- `app/globals.css` - the app-shell block at the end: `--app-rail-w`, the
  collapsed-state label and heading clipping, the two-level slide, and
  `.beacon-page-title` (plus its sentence-case variant for article headlines).
- `tailwind.config.ts` - `textColor` redefined outside `extend` to drop the
  `base` entry. See the note below.

Deleted: `components/mobile-menu.tsx`, `components/nav-dropdown.tsx`,
`components/header-nav-link.tsx`, `components/league-shell/league-side-nav.tsx`,
`components/league-shell/league-mobile-nav.tsx`,
`components/beacon-brief/brief-breadcrumb.tsx`, `components/admin-nav.tsx`,
`components/my-beacon-nav.tsx`.

Added asset: `public/img/ff-beacon-mark-96.png` (4.9 KB), which replaces the
1.3 MB `ff-beacon-logo.png` in all five in-page renders. The full-size file
stays for OG images and email, where the resolution is used.

## Four things worth knowing before you touch this

**Rail width is CSS, not React.** A blocking script in `<head>` stamps
`data-sidebar="expanded"|"collapsed"` on `<html>` from localStorage, and
`--app-rail-w` selects off it. React state mirrors the value only so the toggle
can carry a truthful `aria-expanded`. If you move the width into React it will
paint collapsed and snap open on every page load for anyone who expanded it.

**A rail row does one of two things.** It navigates, or it switches something in
place. `NavNode` is a union so it can never be both or neither. In-place rows
exist because On The Clock's eight draft views are eight states of one live page
holding a websocket, a synced board, and a half-built trade, and navigating to
change view would throw all of that away. Only a client registrar sets
`onSelect`, and the server tree is typed `SiteNavNode`, which has no such field.
An in-place row must move focus to whatever it revealed: the rail is nowhere near
the content, so without that a reader gets no feedback at all. See
`app/tools/on-the-clock/draft-room-rail.tsx` and `selectView` in
`on-the-clock-client.tsx`.

**A route can contribute its own rail section.** `RegisterRailSections` from
`components/app-shell/rail-sections.tsx` lets a route prepend a section, ask for
it to be open on arrival, and state which row is current (League sections differ
only by query string, so a pathname match cannot tell them apart). League Pulse
is the reference implementation. This is how a sub-area gets a sidebar without
growing a second rail. Do NOT use it to open a section that is already in
`lib/nav-tree.ts` and already matches the pathname: the rail opens that on its
own, and two components were deleted for doing exactly that.

**The root layout must stay synchronous.** An `await` in its body blocks React
from descending into `children`, which puts the session read in front of every
page's own data fetching rather than alongside it. Both async pieces of chrome,
the header and `AppRailSections`, are children for that reason.

**`text-base` is a font size and nothing else.** The palette names a colour
`base`, and Tailwind turns every colour into a `text-*` utility, so there were
two rules called `.text-base` and the colour one won inside a breakpoint.
Anything written `text-sm sm:text-base` went from readable grey to #07070D
against a #07070D page at the sm breakpoint: invisible text, above one screen
width only. `tailwind.config.ts` now redefines `textColor` outside `extend` to
drop that one entry. If you want the page background as a text colour, name the
hex. `bg-base` and `border-base` are untouched.

## What is left

Nothing blocking. All five page groups landed, all four review passes ran, and
every confirmed finding is fixed. `progress.md` T605 lists what they found.

Known and deliberately not done, in rough order of how much they matter:

- **`<main id="main">` has no `tabIndex={-1}`**, on all 36 call sites. The skip
  link moves the sequential-focus starting point but does not set
  `document.activeElement`, and browsers differ on what happens next. Predates
  this work; worth one global pass.
- **Focus is not restored after a drawer link is followed.** The App Router
  drops focus to `<body>` on client navigation, which was always true but
  matters more now that the drawer is the only navigation below lg. Fixing it
  properly means focusing `#main` after a route change, which needs the
  `tabIndex` above first.
- **The collapsed rail's labels do not appear on focus.** The accessible name is
  correct (the label is in the DOM, clipped rather than removed) and `title`
  covers hover, but a sighted keyboard-only reader on a collapsed rail sees a
  column of icons, several of which repeat across sections. A `:focus-visible`
  tooltip would close it.
- **Three breadcrumb implementations coexist**: the shared
  `components/app-shell/breadcrumb-bar.tsx`, plus `site-breadcrumb.tsx` and
  `league-breadcrumb.tsx`, which together serve one call site. The bar already
  takes `actions` and `currentLabel`, so folding League Pulse into it and
  deleting the other two is straightforward.
- **Switching draft view on a phone costs three taps** (hamburger, "Draft room",
  the row) where the old strip cost one. Nothing is hidden, so the mobile-first
  rule holds and this matches the League Pulse pattern that was asked for, but a
  live draft is the one surface where the tempo matters. The fix, if wanted, is a
  room-level bottom sheet below `lg` reusing `app/tools/on-the-clock/sidebar-sheet.tsx`,
  which already docks under the header in that exact spot.
- **`NAV_ICONS` is a per-page tax by construction.** It is a static map reached
  from `nav-levels.tsx`, so nothing per-page can shake an entry out of it. The
  four icons added for the draft views cost about 324 gzipped bytes on every
  page, which is under the noise floor today. Worth watching if the map keeps
  growing.
- **The player hero has no team logo.** The reference design shows one beside
  the player name. `components/player-profile/` has a Sleeper headshot, a text
  team badge, and the Team Anthem band, but no logo mark. New asset work.
- **The admin index still uses a plain h1** rather than `PageMasthead`, because
  the layout must not add a second one. Internal page; low priority.
- **`public/img/favicon.svg` is 1.78 MB.** Only referenced from the metadata
  block, so it is not on the render path, but it is the same problem as the logo
  PNG and the same pass should fix it.
- `npm audit --omit=dev` reports 4 high, all pre-existing and all transitive
  under `next`. The fix is a `next` bump that needs its own regression pass.

Do NOT commit and do NOT push. The owner reviews first.
