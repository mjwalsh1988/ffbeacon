# Saved handle: every tool opens on your leagues, and every league list shows its logo

Status: PLAN ONLY. Nothing in this document has been built. Written 2026-09-05
against `main` at `fec1cd8`. Task prefix for the build: `SH-T###` in
`progress.md`. The build needs exactly one migration, a column-comment update
(Part 4.1). The next free migration number is 0268; the unbuilt Beacon Link
plan (`docs/beacon-link/beacon-link-plan.md`) also names 0268 for its first
table. Whichever build lands first takes 0268 and the other renumbers before
it applies anything.

THIS DOCUMENT IS THE SPEC. It carries every file, function, type, migration,
copy string, state and test the build needs. The companion artifact is the
plain-language explanation and carries none of this detail.

There are three deliverables, and they are ordered so the first two never
wait on the third:

1. A reader who is signed in and has saved a Sleeper username never types it
   again. Every tool that starts with a username search opens as though that
   search had already happened, the search form is not rendered, and an
   identity card says which handle the tool is running under with a Change
   control that brings the form back.
2. A reader who is NOT signed in, or is signed in with no handle saved, sees
   the search form as today plus a short notice that creating an account and
   saving the username skips this step in future.
3. Every list of leagues on the site shows each league's Sleeper logo in its
   own column, beside the name, at a size that reads as a logo rather than a
   favicon.

---

## Part 1. What the owner asked for

Quoted intent, in the owner's words, and the reading this plan takes of each:

- "update the site and all tools that we currently have to be sleeper
  username aware for logged in users who have saved their sleeper username".
  Reading: every surface that today takes a username from a form or from
  `?username=` falls back to the saved handle when neither is present. That
  is the six tools AND the ten league deep-view routes, which today only know
  whose team is "yours" when the URL carries `?username=`.
- "add a notice on all of the tool pages where you have to search for a
  username to let people know they can avoid this step in the future by
  creating an account to save their sleeper username". Reading: one shared
  notice component under every username form, shown to signed-out readers,
  with a variant for signed-in readers who have not saved a handle yet.
- "if the user has a sleeper username saved it should always act like they've
  already searched for that name after loading up a tool and the entire
  search box shouldn't even display for those users, instead it should just
  show like an informational card ... that shows they are currently utilizing
  the tool under [sleeper_username] and if they want to change it they can
  click a quick change textual or button link and clicking that will bring up
  the search box again". Reading: the identity card is a shared component,
  the search form is unmounted rather than hidden while the card is shown,
  and Change is a disclosure (`aria-expanded`, `aria-controls`) that mounts
  the tool's own form with focus moved into it.
- "anytime we are showing a list of leagues I want to start implementing that
  we include the league image / logo ... a decent sized logo showing up next
  to the league name but in its own column that vertically spans so it's just
  like a column in that row". Reading: a new first column (or first grid
  track) on every league list, holding a 48 px logo on desktop rows and a
  40 px logo on phone rows, vertically centred against the full height of
  the row including any second line the row carries. Where a list is a native
  `<select>`, which cannot show an image, the select is replaced by a real
  list (Part 3, D12).

---

## Part 2. How it works today

### 2.1 Where the handle lives

`user_preferences.sleeper_league_settings` is a jsonb column (migration 0028).
`lib/sleeper-league-settings.ts` is the typed accessor:

```ts
export type SleeperLeagueSettings = {
  username?: string | null;
  featured_league_id?: string | null;
  shown_league_ids?: string[];
  signal_league_ids?: string[];
};
```

Only `username` is stored. Every consumer then calls `getSleeperUser(username)`
to turn it into a Sleeper user id before it can call `getSleeperLeagues`. There
is no `sleeper_user_id`, no display name and no avatar cached, so every tool
page spends one Sleeper call resolving a handle the reader already gave us.

The handle is written by two near-identical client-side forms that each do a
read-merge-write against the jsonb through the reader's own session client:

- `app/my-beacon/sleeper-leagues/save-username-form.tsx`
- `app/tools/signal-check/sleeper-import-panel.tsx` (`UsernameSaveForm`, at the
  bottom of the file)

Neither verifies that the handle exists on Sleeper before saving it.

### 2.2 Every surface that asks for a username

| Surface | File | Today |
| --- | --- | --- |
| League Pulse entry | `app/tools/league-pulse/page.tsx`, `league-pulse-form.tsx` | Reads the saved handle, AUTO-SEARCHES it (the `lookupUsername` block), but still renders the full form, prefilled, above the results. `?username=` wins over the saved handle. |
| My Sleeper Leagues | `app/my-beacon/sleeper-leagues/page.tsx`, `sleeper-connection.tsx`, `save-username-form.tsx` | Auto-loads leagues for the saved handle. The connection block collapses to one row with a "Change it" disclosure. This is the closest thing on the site to the card the owner describes. |
| On The Clock | `app/tools/on-the-clock/page.tsx`, `on-the-clock-client.tsx` (steps at lines 1774 and 1833), `username-gate.tsx`, `app/api/on-the-clock/leagues/route.ts` | Prefills the gate with the saved handle. The reader still presses "Find my drafts". Step 2 has a "Change username" button that returns to step 1. |
| FAAB Calculator | `app/tools/faab/page.tsx`, `league-panel.tsx`, `actions.ts connectSleeperLeagues` | Prefills the username field. The reader still presses "Find my leagues". The comment on `initialUsername` says this was deliberate so a reader who came for the manual calculator is not charged a lookup. |
| Beacon Breakdown | `app/tools/beacon-breakdown/page.tsx`, `league-panel.tsx`, `actions.ts connectBreakdownLeagues` | No prefill at all. League mode sits behind a "Connect a league" button that opens an empty form. |
| Signal Check import | `app/tools/signal-check/page.tsx`, `sleeper-import-panel.tsx`, `import-actions.ts listImportLeagues` | Requires sign-in. With a saved handle it goes straight to the league picker. With none it shows the inline save form. The league picker is a `<select>`. |
| Manager Pulse | `app/tools/manager-pulse/page.tsx`, `manager-search-form.tsx` | Requires sign-in. Prefills the search with the reader's OWN handle, even though the tool exists to look up OTHER managers. |
| League deep views (10 routes) | `app/leagues/[league_id]/page.tsx` and `decisions`, `lineups`, `positional-war`, `power-pulse`, `schedules`, `schedules/[week]/[roster_id]`, `teams/[roster_id]`, `trade-ideas`, `transactions` | Each page derives `searchedUsername` from `?username=` with the same four-line expression, copied ten times. It drives "your team" highlighting (`lib/league-viewer.ts matchViewerRoster`), the default roster on Lineups, the identity on Trade Ideas, the back link to League Pulse, and the "other leagues" switcher (`lib/league-header-data.ts`, `lib/league-switcher-data.ts`). With no `?username=`, none of that knows who the reader is, even when they are signed in with a saved handle. |

Two things the table makes visible:

- The saved handle is read in SEVEN places with the same three lines
  (`select("sleeper_league_settings")`, `parseSleeperLeagueSettings`, `.username`).
- The league deep views match the reader to a roster by `display_name`
  (`league_users.display_name` against the forwarded `?username=`), because
  League Pulse forwards `user.display_name`, not `user.username`. A saved
  handle is a USERNAME. Sleeper usernames and display names can differ, so
  falling the deep views back to the saved handle with the existing
  display-name match would silently fail for any reader whose two names
  differ. Part 3, D3 is how the plan avoids that.

### 2.3 Every list of leagues

| List | File | Source of the rows | Has the avatar id today |
| --- | --- | --- | --- |
| League Pulse results, public desktop grid | `app/tools/league-pulse/league-results.tsx` (`PublicDesktopList`, the `PUBLIC_GRID` grid) | Live Sleeper payload (`SleeperLeague`) | Yes, `league.avatar`, unused |
| League Pulse results, public mobile rows | same file (`PublicMobileList`, `MOBILE_GRID`) | same | Yes, unused |
| League Pulse results, dashboard desktop table | same file (`DashboardDesktopTable`, a real `<table>`) | same | Yes, unused |
| League Pulse results, dashboard mobile rows | same file (`DashboardMobileList`) | same | Yes, unused |
| League detail sheet (mobile dialog) | `app/tools/league-pulse/league-detail-sheet.tsx` | same | Yes, unused |
| On The Clock draft picker | `app/tools/on-the-clock/league-picker.tsx` | `LeagueCard` from `/api/on-the-clock/leagues` | Yes, `LeagueCard.avatar` is already populated by the route and never rendered |
| FAAB league picker | `app/tools/faab/league-panel.tsx` | `ConnectedLeague` from `connectSleeperLeagues` | No. A `<select>`. |
| Beacon Breakdown league picker | `app/tools/beacon-breakdown/league-panel.tsx` | `BreakdownLeague` from `connectBreakdownLeagues` | No. A list of buttons. |
| Signal Check import league picker | `app/tools/signal-check/sleeper-import-panel.tsx` | `ImportLeague` from `listImportLeagues` | No. A `<select>`. |
| Deep-view league switcher | `components/league-switcher.tsx` | `SwitcherLeague` from `lib/league-switcher-data.ts` (live Sleeper payload) | No |
| Projected finishes panel | `components/league-projections-panel.tsx` | `ProjectionInput` built in `app/my-beacon/sleeper-leagues/page.tsx` from the live payload | No |
| Player exposure panel | `components/player-exposure-panel.tsx` | `ExposureLeague` from `lib/player-exposure.ts` (reads `leagues` rows) | No |
| Free agent finder panel | `components/free-agent-finder-panel.tsx` | `FreeAgentLeague` from `lib/free-agent-finder.ts` (reads `leagues` rows) | No |
| Manager Pulse leagues section | `components/manager-pulse/leagues-section.tsx` | `ManagerLeagueRow` from `lib/manager-pulse/load.ts` (reads `leagues` rows including `metadata`) | Metadata is loaded, avatar is not lifted out |
| Public Signal profile league block | `components/signal/signal-block.tsx` | `FeaturedLeagueCard` from `lib/signal-profile.ts` (reads `leagues` rows) | No |
| League masthead (one league, not a list) | `components/league-shell/league-masthead.tsx` | `leagues` row | No. Included as a bonus surface, Part 5.13. |

Where the avatar id comes from when the list is built from OUR rows rather
than Sleeper's payload: `leagues.metadata` holds the raw Sleeper league object
(`lib/league-pulse.ts` line 271 writes it on every pulse; line 906 merges the
brackets into it without dropping keys), and that object carries `avatar` at
the top level (`lib/sleeper.ts` `SleeperLeague.avatar`). PostgREST reads it
with the JSON arrow syntax already used in this codebase
(`lib/league-pulse.ts` line 423: `leg:metadata->settings->leg`), so a select of
`avatar:metadata->>avatar` needs no migration, no new column, and no backfill.

The image itself: `components/sleeper-avatar.tsx` already builds
`https://sleepercdn.com/avatars/{id}` for people, and `sleepercdn.com` is
already allowed by `next.config.ts` `images.remotePatterns` and by the CSP
`img-src` in `lib/security-headers.ts` line 88. Sleeper also serves a thumbnail
at `https://sleepercdn.com/avatars/thumbs/{id}`, which is the right asset for
a 40 to 48 px logo.

---

## Part 3. Decisions

Each is numbered so a task can cite it.

### D1. One resolver, and a guard that keeps it that way

`lib/sleeper-handle/resolve.ts` becomes the only module that reads
`sleeper_league_settings.username`. Every page, action and route that needs
the reader's handle calls it. A repo-wide guard test
(`lib/sleeper-handle/guard.test.ts`, same shape as
`lib/projections/source-guard.test.ts`) fails the suite if
`parseSleeperLeagueSettings(` appears in any file outside the allow-list
(`lib/sleeper-handle/`, `lib/sleeper-league-settings.ts` itself, and the
My Beacon profile/signal code that reads the OTHER keys of the same jsonb).
Seven copies today is how the display-name mismatch in 2.2 went unnoticed.

### D2. Precedence: the URL wins, then the saved handle, then nothing

`?username=` is a shareable-link mechanism and stays one. A reader who
follows a link carrying someone else's handle sees that person's leagues and
team, exactly as today. With no URL param, a signed-in reader with a saved
handle is that handle. With neither, the surface behaves as it does for a
guest. The resolver reports WHICH source won (`source: "url" | "saved"`), and
the identity card says so in words when it is the URL ("Viewing as @x from
this link. Switch to your saved handle, @y.").

### D3. The saved identity carries the Sleeper user id, and roster matching uses it

At save time the server resolves the handle on Sleeper and stores, beside
`username`, the `sleeper_user_id`, `sleeper_display_name` and
`sleeper_avatar` it got back, plus `handle_verified_at`. Three consequences:

- Every tool page skips the `getSleeperUser` call: one Sleeper call per visit
  instead of two, and under the site-wide budget in `lib/sleeper-budget.ts`
  that is the difference that matters on a busy Sunday.
- The league deep views match the reader to a roster by
  `rosters.owner_user_id` (which holds the Sleeper user id verbatim, see
  `lib/league-team-status-data.ts` line 120) and by `co_owners`, before
  falling back to the display-name match that URL-driven guests still need.
  Exact, and immune to the username-versus-display-name gap in 2.2.
- The identity card can show the reader's Sleeper avatar and display name
  without a network call.

A handle that Sleeper cannot resolve at save time is REFUSED with a message,
which is a change from today, where any string is saved. A handle that was
valid at save time and later stops resolving (the reader renamed themselves
on Sleeper) is handled at read time: the tool shows the card, opens the form
automatically, and says the saved handle no longer resolves (the pattern
`sleeper-connection.tsx` already uses for `lookupFailed`).

### D4. The card replaces the form; the form is unmounted, not hidden

When the card is shown the search form is not in the DOM. A hidden form still
holds a focusable input for a keyboard reader to land in, and the owner's
instruction is that the box "shouldn't even display". Change mounts the form,
moves focus to its username input, and the Change button becomes Close. Close
or Escape unmounts it and returns focus to the button. This is
`aria-expanded` and `aria-controls` on the button, the same contract
`sleeper-connection.tsx` already implements.

### D5. Change is a one-off lookup unless the reader says otherwise

The form the card reveals carries a checkbox, "Save this as my Sleeper
username". It is UNCHECKED when a handle is already saved, because the most
common reason to open the form on a tool page is to look at a leaguemate's
leagues once, and overwriting the saved handle on that path would be a
surprise. It is CHECKED by default for a signed-in reader who has no handle
saved, because that reader is about to type their own. After a one-off
lookup the card reads "Viewing as @other for this visit" with a link back to
the saved handle. On `/my-beacon/sleeper-leagues` there is no checkbox: that
page IS the settings page, and saving is the only thing the form there does.

Owner decision, recorded in Part 8: flip the default for the already-saved
case to CHECKED if the intended meaning of "change usernames" was
"permanently".

### D6. The notice is one component with two states

`components/sleeper-handle/save-handle-notice.tsx`, rendered under every
username form:

- Signed out: "Tired of typing this? Create a free account and save your
  Sleeper username once. Every tool then opens on your leagues." with a link
  to `/login?next=<current path>`.
- Signed in, no handle saved: "Save your Sleeper username and skip this step
  next time." with the checkbox from D5 already in the form above it, so the
  notice points at the checkbox rather than at another page.
- Signed in with a handle saved: not rendered. The card is the notice.

The existing marketing block on League Pulse (`CtaSection`, "Sign in once,
never paste your username again") stays; it is a page section, not the
form-level notice.

### D7. Auto-run is one call, and it goes through the existing gates

Every tool that auto-runs the saved handle does so with the cached Sleeper
user id, so the auto-run is exactly one `getSleeperLeagues` call. Each path
keeps its existing rate limit: League Pulse and My Beacon run server-side in
the page render as they do today; On The Clock goes through
`/api/on-the-clock/leagues`, which keeps its per-IP budget and its
per-(ip, username) 10-second cooldown; FAAB and Breakdown go through their
server actions and their `try_claim_rate_limit` buckets. The token bucket in
`lib/sleeper-budget.ts` sits under all of it. Nothing bypasses anything.

One consequence needs a specific behaviour: On The Clock's 10-second cooldown
means a reader who reloads the page twice quickly gets a 429 on the auto-run.
That is a soft failure, not a reason to drop them back to the form:
the card stays, a `role="status"` line says "Give it a few seconds and press
Retry", and a Retry button re-runs. A 404 (handle gone) or a 5xx IS a reason
to open the form, with the message.

### D8. Auto-run on FAAB and Breakdown overrides the "do not charge a lookup" comment

`app/tools/faab/league-panel.tsx` deliberately did not auto-connect, so a
reader who wanted only the manual calculator was not charged a lookup. The
owner's instruction supersedes that for readers WITH a saved handle: the
league list is the better answer and it should be waiting. Guests and readers
without a saved handle are unchanged. The comment is rewritten to say so.

### D9. Manager Pulse keeps its search box, and gets the card above it

Manager Pulse exists to look up OTHER managers. Hiding its search box behind
the reader's own handle would hide the tool. So this is the one deliberate
divergence from the "no search box" rule: the identity card renders above the
search form with a primary button, "Open my own report", linking to
`/tools/manager-pulse/<saved handle>`, and the search form no longer prefills
the reader's own handle (it prefills nothing, with the placeholder
"their-sleeper-handle" it already has). Owner decision recorded in Part 8.

The alternative, auto-navigating to the reader's own report on page load, was
rejected because a report costs a capture budget
(`manager_pulse_settings.capture.leaguesPerUserPerHour`) and a reader who came
to scout an opponent would have paid it for nothing.

### D10. Signal Check keeps its sign-in gate, and gets the card and the list

The import panel already requires an account and already uses the saved
handle. It changes in three small ways: the panel header becomes the identity
card (with Change revealing the shared save form from D3, replacing the
panel's private `UsernameSaveForm`); the signed-out state gets the D6 notice
wording; and the league `<select>` becomes the shared league list from D12 so
it can carry logos.

### D11. The logo is decorative, square-cornered, and never a broken image

`components/league-logo.tsx` wraps `components/image-with-fallback.tsx`, which
already guarantees a dead URL renders a same-sized placeholder rather than a
broken image. The logo passes `alt=""`: the league name is always adjacent
visible text, and `ImageWithFallback` hides a decorative fallback from
assistive tech outright, so no row gains a phantom "image" announcement.
`radiusClass="rounded-card"`: circles are reserved for people
(`ImageWithFallback` documents this), and a league logo is not a person.
A league with `avatar: null` (Sleeper leagues without a custom image) renders
the placeholder at the same size, so the column stays aligned.

Sizes: 48 px on desktop rows, 40 px on phone rows, 32 px inside the switcher
dropdown and the three cross-league panels, 64 px in the league masthead.
Thumbnail URL for everything up to 48 px; full URL at 64 px.

### D12. A native select cannot show an image, so two selects become lists

FAAB and Signal Check pick a league with a `<select>`. Both become
`components/league-choice-list.tsx`: a `role="radiogroup"` of rows, one radio
per league, each row carrying the logo, the name, and the meta line the select
used to carry in parentheses ("12 FAAB left", "syncs when picked", "(2026)").
Arrow keys move between rows as a radiogroup does natively, so keyboard
behaviour is not worse than the select it replaces, and the meta text is
inside the label so it is announced with the choice. The Breakdown picker,
already a list of buttons, adopts the same component so the three tools read
the same way.

The league switcher's MOBILE presentation stays a native `<select>` (it is
there specifically to get the platform picker) and therefore shows no logo on
phones; the desktop panel rows get one. This is the single place the plan
allows a logo to be absent at one breakpoint, and it is because the native
control is the accessibility feature. Owner decision recorded in Part 8.

### D13. The column is a column

In the grid-based public League Pulse list, `PUBLIC_GRID` gains a first track
of `3rem` and the logo is the first item in the `LeagueOpenLink` subgrid, so
it sits under a header cell whose text is `sr-only` "Logo". In the dashboard
`<table>`, a new first `<th scope="col">` with `sr-only` "League logo" and a
matching `<td>`. On phone rows, the `li` becomes a two-column grid
(`grid-cols-[2.5rem_1fr]`) with the logo in column one spanning both rows
(`row-span-2 self-center`), so the logo is vertically centred against the
name line AND the standing line beneath it. That is the "vertically spans"
the owner described.

### D14. No new table, no new data column

The avatar id lives where the source object already is (`leagues.metadata`),
per the Data Architecture rule that source data goes in `metadata` and only
operational columns get a name of their own. The saved identity's new keys go
in the existing jsonb, per migration 0028's stated intent that
Sleeper-related preferences stop accumulating per-feature columns. The only
migration is the column comment that documents the new keys.

---

## Part 4. Architecture

### 4.1 Migration 0268: the jsonb shape comment

`supabase/migrations/0268_sleeper_handle_settings_shape.sql`

```sql
-- Migration 0268: document the saved Sleeper identity keys.
--
-- user_preferences.sleeper_league_settings gains four keys beside `username`,
-- written only by app/actions/sleeper-handle.ts saveSleeperHandle after the
-- handle resolved on Sleeper. No schema change, no RLS change: the column,
-- its owner-only policies and its grants are exactly as migration 0028 left
-- them. This file exists so the column comment stays in sync with
-- lib/sleeper-league-settings.ts, which is the rule that file states.
--
-- Access matrix (unchanged):
--   user_preferences : SELECT/INSERT/UPDATE/DELETE own row only; no anon access

comment on column public.user_preferences.sleeper_league_settings is
  'Sleeper-related preferences, one jsonb so per-feature columns stop accumulating. Keys: '
  'username (text, the saved Sleeper handle as typed, case preserved), '
  'sleeper_user_id (text, resolved from Sleeper at save time), '
  'sleeper_display_name (text, from Sleeper at save time), '
  'sleeper_avatar (text or null, Sleeper avatar id at save time), '
  'handle_verified_at (ISO timestamp of the last successful resolution), '
  'featured_league_id, shown_league_ids, signal_league_ids (unchanged, see 0028).';
```

Applied through the Supabase MCP, then types regenerated into
`lib/database.types.ts` (no type change expected; the regeneration is the
rule, and it proves it).

### 4.2 `lib/sleeper-league-settings.ts`

The type gains the four keys; `parseSleeperLeagueSettings` coerces each the
way it coerces `username` (string or null, anything else dropped);
`mergeSleeperLeagueSettings` is unchanged. Tests in
`lib/sleeper-league-settings.test.ts` (new): a legacy row with only
`username` parses to the same object as before; each new key round-trips;
`null` clears; a non-string is dropped.

```ts
export type SleeperLeagueSettings = {
  username?: string | null;
  sleeper_user_id?: string | null;
  sleeper_display_name?: string | null;
  sleeper_avatar?: string | null;
  handle_verified_at?: string | null;
  featured_league_id?: string | null;
  shown_league_ids?: string[];
  signal_league_ids?: string[];
};
```

### 4.3 `lib/sleeper-handle/types.ts`

```ts
/** What the site knows about the reader's Sleeper identity. */
export type SavedSleeperHandle = {
  username: string;
  /** Null for a row saved before 0268; the resolver fills it lazily (4.4). */
  sleeperUserId: string | null;
  displayName: string | null;
  avatar: string | null;
  verifiedAt: string | null;
};

export type SleeperViewerSource = "url" | "saved";

/**
 * Who a surface is acting for. `username` is what goes into links and
 * lookups; `sleeperUserId` is what roster matching prefers (D3).
 */
export type SleeperViewer = {
  username: string;
  sleeperUserId: string | null;
  displayName: string | null;
  avatar: string | null;
  source: SleeperViewerSource;
};

/** The three states every username surface renders one of (Part 5.0). */
export type HandleGateState =
  | { kind: "guest" }
  | { kind: "member-unsaved" }
  | { kind: "member-saved"; handle: SavedSleeperHandle }
  | { kind: "member-overridden"; handle: SavedSleeperHandle; viewer: SleeperViewer };
```

### 4.4 `lib/sleeper-handle/resolve.ts` (server only)

```ts
import "server-only";

/**
 * The saved handle for the signed-in reader, or null. Wrapped in React
 * cache() so a page and its layout share one read. Never throws.
 */
export const loadSavedSleeperHandle: (
  supabase: SupabaseClient<Database>,
) => Promise<SavedSleeperHandle | null>;

/**
 * URL wins, then the saved handle, then null (D2). `usernameParam` is the raw
 * searchParams value; trimmed here, and an empty string counts as absent.
 * When the URL wins, `sleeperUserId` is null unless the saved handle happens
 * to be the same username (case-insensitive), in which case the saved id is
 * carried across.
 */
export const resolveSleeperViewer: (
  supabase: SupabaseClient<Database>,
  usernameParam: string | string[] | undefined,
) => Promise<SleeperViewer | null>;

/**
 * For the one state where both matter (D2's "viewing as @x from this link").
 */
export const resolveHandleGate: (
  supabase: SupabaseClient<Database>,
  usernameParam: string | string[] | undefined,
) => Promise<HandleGateState>;

/**
 * Lazy upgrade for rows saved before 0268: when `sleeperUserId` is null,
 * resolve the username on Sleeper once, write the four keys back through the
 * reader's own session client, and return the filled handle. A failed
 * resolution returns the handle unchanged (username only) and writes nothing;
 * the caller then behaves as D3's "no longer resolves" case. Bounded by the
 * 1.5 s interactive deadline `lib/sleeper-budget.ts` gives page renders.
 */
export const ensureSleeperUserId: (
  supabase: SupabaseClient<Database>,
  handle: SavedSleeperHandle,
) => Promise<SavedSleeperHandle>;
```

`lib/sleeper-handle/resolve.test.ts`: precedence (url over saved, saved over
nothing, empty param counts as absent), case-insensitive id carry-over,
`ensureSleeperUserId` writes on success and not on failure (Supabase client
stubbed the way `lib/manager-pulse/*.test.ts` stubs it).

### 4.5 `lib/sleeper-handle/validate.ts` (pure, client-safe)

```ts
/** Trim, lowercase, and test against Sleeper's grammar. Null when invalid. */
export function normalizeSleeperHandle(raw: unknown): string | null;
```

Uses `HANDLE_PATTERN` from `lib/manager-pulse/handle.ts`, which is the one
copy of the grammar and is already client-safe. This module exists so the
save form and the server action agree, and so nothing new imports
`lib/manager-pulse/*` for a reason unrelated to Manager Pulse. Note, not
changed by this plan: `app/tools/faab/actions.ts` and
`app/tools/beacon-breakdown/actions.ts` each carry a looser
`USERNAME_PATTERN` (dot and hyphen, 64 chars) and `lib/on-the-clock/validation.ts`
a stricter one (32 chars, case-sensitive). Reconciling them is debt recorded
in Part 8, not work in this plan.

### 4.6 `app/actions/sleeper-handle.ts` (server actions)

```ts
"use server";

export type SaveHandleResult =
  | { ok: true; handle: SavedSleeperHandle }
  | { ok: false; error: string; reason: "invalid" | "not-found" | "rate-limited" | "signed-out" | "failed" };

/**
 * Validate (4.5), rate limit (bucket "sleeper_handle_save", 6 per minute per
 * actor via try_claim_rate_limit, fail closed), resolve on Sleeper with
 * getSleeperUser, then read-merge-write the jsonb through the reader's own
 * session client (owner-only RLS is the boundary). Refuses a handle Sleeper
 * cannot find (D3). Calls revalidatePath("/", "layout") so every open tool
 * page re-renders with the new identity on its next request.
 */
export async function saveSleeperHandle(input: { username: string }): Promise<SaveHandleResult>;

/** Sets the five identity keys to null. Same client, same rate bucket. */
export async function clearSleeperHandle(): Promise<{ ok: boolean; error?: string }>;
```

The two existing client-side forms are deleted once every caller uses this
action (Part 6, SH-T017 and SH-T026). Writing through the session client
rather than the admin client is deliberate: the RLS policy on
`user_preferences` is what stops one reader writing another's row, and the
action should be inside that boundary, not around it.

### 4.7 `lib/sleeper-handle/guard.test.ts`

Reads every `.ts` and `.tsx` under `app/`, `components/` and `lib/` and fails
if `parseSleeperLeagueSettings(` appears outside the allow-list:
`lib/sleeper-league-settings.ts`, `lib/sleeper-handle/`,
`app/my-beacon/actions.ts`, `app/my-beacon/profile/`, `app/my-beacon/signal/`,
`lib/signal-profile.ts`, `lib/signal/editor-data.ts`,
`app/api/leagues/bulk-sync/route.ts`, `app/my-beacon/layout.tsx`. Each
allow-list entry carries a one-line reason (they read `featured_league_id`,
`shown_league_ids` or `signal_league_ids`, never `username`), and the test
also asserts that none of those files contains `.username` on the same line
as the parse call. An allow-list entry is a debt ledger line, never a way to
pass the test.

### 4.8 `lib/sleeper-avatar-url.ts` (pure, client-safe)

```ts
export const SLEEPER_AVATAR_BASE = "https://sleepercdn.com/avatars";

/** Full-size or thumbnail URL for a Sleeper avatar id. Null in, null out. */
export function sleeperAvatarUrl(
  avatarId: string | null | undefined,
  size: "full" | "thumb" = "full",
): string | null;
```

`components/sleeper-avatar.tsx` drops its private `AVATAR_BASE` and calls
this. `lib/sleeper-avatar-url.test.ts`: both sizes, null and empty string
return null, an id containing a slash or a dot returns null (defence against
a hostile `metadata.avatar`; Sleeper ids are 32 hex characters, and the
function accepts `^[A-Za-z0-9]{1,64}$`).

### 4.9 `components/league-logo.tsx`

```tsx
export function LeagueLogo({
  avatarId,
  name,
  size = 48,
  className,
}: {
  avatarId: string | null | undefined;
  /** The league name, for the title attribute. The image itself is decorative (D11). */
  name: string;
  size?: 32 | 40 | 48 | 64;
  className?: string;
}): JSX.Element;
```

Renders `ImageWithFallback` with `src = sleeperAvatarUrl(avatarId, size >= 64
? "full" : "thumb")`, `alt=""`, `radiusClass="rounded-card"`, and a fallback
of the `Shield` icon from lucide at `size * 0.5`. Client component, because
`ImageWithFallback` is one.

### 4.10 `components/sleeper-handle/` (the shared surface)

Four files, one job each.

`identity-card.tsx` (client):

```tsx
export function SleeperIdentityCard({
  toolName,           // "League Pulse", "On The Clock", "the FAAB Calculator"
  handle,             // SavedSleeperHandle
  viewer,             // SleeperViewer, when the URL overrode the saved handle (D2)
  headingLevel = 2,
  status,             // "idle" | "loading" | "throttled" | "failed"
  statusMessage,      // the sentence for throttled and failed
  onRetry,            // shown for "throttled" (D7)
  children,           // the tool's own form, mounted only while open
  formId,             // for aria-controls
  manageHref,         // "/my-beacon/sleeper-leagues" link in the card footer
}): JSX.Element;
```

Structure, in DOM order: a `<section aria-labelledby>` with a heading of the
given level reading "Using {toolName} as @{username}" (when `viewer.source ===
"url"` the heading reads "Viewing as @{viewer.username} from this link" and a
line beneath offers "Switch to your saved handle, @{handle.username}", a link
to the current path without `?username=`); `SleeperAvatar` at 40 px with
`title = handle.displayName ?? handle.username`; the display name when it
differs from the username; a `role="status"` line that carries the auto-run
state ("Loading your leagues.", "Loaded 14 leagues.", or the throttled or
failed sentence) and is otherwise empty; the Change button (`aria-expanded`,
`aria-controls={formId}`, label "Change" closed and "Close" open); the
`<div id={formId}>` holding `children` only while open; and a footer link
"Manage your Sleeper connection" to `manageHref`. On open, focus moves to the
first `input` inside the form region on the next frame; on close, focus
returns to the button; Escape inside the region closes. When `status ===
"failed"` the region opens itself on mount (D3) and the status line is
`role="alert"` for that one render.

`save-handle-form.tsx` (client):

```tsx
export function SaveHandleForm({
  defaultUsername = "",
  autoFocus = false,
  mode,               // "settings" (always saves) | "inline" (checkbox, D5)
  saveByDefault,      // inline only: the checkbox's initial state
  onSaved,            // (handle: SavedSleeperHandle) => void
  onLookup,           // inline only: (username: string) => void, the one-off path
  submitLabel,        // "Save", "Find leagues", "Find my drafts"
}): JSX.Element;
```

Calls `saveSleeperHandle` when saving; calls `onLookup(username)` when the
inline checkbox is off. A tool's own submit behaviour (navigating to
`?username=`, calling `connect`) lives in `onLookup`, so this form never knows
which tool it is in. Client-side validation through `normalizeSleeperHandle`
before either path, with the message from `manager-search-form.tsx` ("That
doesn't look like a Sleeper handle. Use letters, numbers, and underscores
only, up to 32 characters."). Errors in a `role="alert"` `<p>` linked by
`aria-describedby`; the pending state on the button; the input keeps
`autoComplete="username"`.

`save-handle-notice.tsx` (server-safe, no hooks):

```tsx
export function SaveHandleNotice({
  state,     // "guest" | "member-unsaved"
  nextPath,  // for the login link
}): JSX.Element;
```

Copy per D6. Rendered as a `<p>` with a leading `UserPlus` icon
(`aria-hidden`), inside the form's own card so it reads as part of the form.

`handle-gate.tsx` (client, the composer):

```tsx
export function SleeperHandleGate({
  state,              // HandleGateState from resolveHandleGate
  toolName,
  nextPath,
  headingLevel,
  status, statusMessage, onRetry,
  renderForm,         // (ctx: { defaultUsername: string; onLookup: (u: string) => void; saveByDefault: boolean }) => ReactNode
  onLookup,
}): JSX.Element;
```

`guest` and `member-unsaved` render `renderForm(...)` followed by
`SaveHandleNotice`. `member-saved` and `member-overridden` render
`SleeperIdentityCard` with `renderForm(...)` as its children. Every tool page
becomes: resolve the state on the server, hand it to the gate, and hand the
gate a `renderForm` that returns the tool's existing form component with the
checkbox added. The tool keeps its own form and its own submit semantics; the
gate decides whether that form is on screen.

### 4.11 `components/league-choice-list.tsx` (client)

```tsx
export type LeagueChoice = {
  sleeperLeagueId: string;
  name: string;
  avatar: string | null;
  /** One line under the name: "12 teams, 2026", "syncs when picked", "3 FAAB left". */
  meta: string | null;
  /** A choice that cannot be picked, with the reason inside its label. */
  disabledReason?: string | null;
  /** A row doing async work right now, said out loud. */
  busyLabel?: string | null;
};

export function LeagueChoiceList({
  label,          // accessible name of the group: "Your leagues"
  choices,
  value,          // selected sleeperLeagueId or ""
  onChange,       // (sleeperLeagueId: string) => void
  logoSize = 40,
}): JSX.Element;
```

`role="radiogroup"` with `aria-label`; each row a `<label>` wrapping a
visually-hidden native `<input type="radio" name={groupName}>`, the
`LeagueLogo`, the name and the meta. Native radios give arrow-key movement,
`aria-checked` and form participation for free, which is the reason not to
hand-roll `role="radio"` on divs. A disabled choice is a disabled radio whose
label includes `disabledReason`. The selected row carries the
`border-brand-purple bg-brand-purple/10` treatment the Signal Check trade
cards use; every row is at least 44 px tall. `components/league-choice-list.test.tsx`
covers the pure `describeChoice(choice)` helper that assembles the label text
so the announced string is tested without a DOM.

---

## Part 5. Surface by surface

### 5.0 The state machine every username surface shares

```
signed out                          -> guest:            form + notice
signed in, no handle                -> member-unsaved:   form (checkbox ON) + notice
signed in, handle, no ?username=    -> member-saved:     card; auto-run; form unmounted
signed in, handle, ?username=other  -> member-overridden: card in "from this link" mode; run for `other`
saved handle fails to resolve       -> member-saved with status "failed": card, form auto-opened, alert
auto-run throttled (OTC 429)        -> member-saved with status "throttled": card, Retry, form closed
```

"Form" always means the tool's own existing form component, rendered by the
gate. Nothing in this part invents a second search form for any tool.

### 5.1 League Pulse entry, `/tools/league-pulse`

`page.tsx`: replace the inline prefs read with `resolveHandleGate(supabase,
params.username)`. `lookupUsername` becomes `viewer?.username`; when
`viewer.sleeperUserId` is present skip `getSleeperUser` and call
`getSleeperLeagues(viewer.sleeperUserId, season)` directly, using
`viewer.displayName ?? viewer.username` where `user.display_name` was used.
`searchWasRequested` stays tied to the URL param (the auto-scroll rule in the
file's comment still holds). The "Connect your Sleeper account" cockpit
renders `SleeperHandleGate` with `renderForm` returning `LeaguePulseForm`.
`StepRail current` starts at 2 for `member-saved`. The masthead sentence
"Sign in to save your username and load it instantly each visit" renders only
for `guest` and `member-unsaved`. The `CtaSection` at the bottom is unchanged
(it already hides when signed in).

`league-pulse-form.tsx`: gains the D5 checkbox (rendered only in inline mode
with `saveByDefault` from the gate) and, when it is checked on submit, calls
`saveSleeperHandle` BEFORE navigating to `?username=`, so the saved handle and
the URL agree. Its help line becomes "Your username is never stored unless
you save it." (the second sentence, "All requests hit the Sleeper API
directly", stays).

Season: the identity card does not carry a season control. The results
heading already states the season, and Change reveals the full form with the
season field. Owner decision in Part 8 if a standalone season picker on the
card is wanted.

### 5.2 My Sleeper Leagues, `/my-beacon/sleeper-leagues`

Replace `SleeperConnection` and `SaveUsernameForm` with `SleeperIdentityCard`
in settings mode (`children` = `SaveHandleForm mode="settings"`), keeping the
`lookupFailed` behaviour (the card opens the form and alerts). Delete
`sleeper-connection.tsx` and `save-username-form.tsx`. The page reads the
handle through `loadSavedSleeperHandle` and calls `getSleeperLeagues` with the
cached id. The "Not connected" state (no handle) renders the pitch heading
the page has today ("Link your Sleeper username.") above `SaveHandleForm
mode="settings"`; no notice, because this page is the destination the notice
points at.

`app/my-beacon/beacon-rail.tsx` shows `@username` today from
`facts.sleeperUsername`; it gains the 24 px `SleeperAvatar` beside it when
`sleeper_avatar` is present. `app/my-beacon/layout.tsx` builds `facts`
through its own prefs read; it moves to `loadSavedSleeperHandle` (the guard
in 4.7 requires it).

### 5.3 On The Clock, `/tools/on-the-clock`

`page.tsx`: pass `handleGate` (the resolved `HandleGateState`) to the client
instead of `defaultUsername`.

`on-the-clock-client.tsx`:

- Initial `step` is `"pick-league"` when the gate is `member-saved` or
  `member-overridden`, else `"connect"`. An effect runs `runLookup(viewer,
  season, "connect")` once on mount for those two states.
- `runLookup` and `fetchLeagues` take a `LookupRequest` = `{ username }` or
  `{ saved: true }`. The saved form calls `/api/on-the-clock/leagues?saved=1&season=`.
- The step-1 cockpit renders `SleeperHandleGate` with `renderForm` returning
  `UsernameGate`. The step-2 cockpit's "Change username" back button becomes
  the identity card (with Change opening `UsernameGate` inline, in the card)
  for the saved states, and stays the back button for guests.
- Failure classification for the auto-run, a pure helper in
  `lib/on-the-clock/lookup-failure.ts` with a test: 429 -> `"throttled"`
  (card stays, Retry); 404 -> `"failed"` (card opens the form, alert); other
  -> `"failed"`.
- `StepRail` step 1 reads "Connected as @handle" for the saved states (a
  `label` override prop on `step-rail.tsx`).
- `lookupRef.current.username` (used at line 2233 for the report's
  `sleeperUsername`) is set from the viewer, so reports still carry a name.

`app/api/on-the-clock/leagues/route.ts`: accept `saved=1`. In that mode the
route reads the session through `createClient()` from `lib/supabase/server`,
calls `loadSavedSleeperHandle`, returns 401 when there is no signed-in reader
or no saved handle, and otherwise proceeds with the saved username for the
throttle key and the cached `sleeper_user_id` for `getSleeperLeagues`,
skipping `getSleeperUser`. Every existing guard (the `x-requested-with`
header, per-IP budget, per-(ip, username) cooldown, feature flag) runs
unchanged. The response is unchanged.

`username-gate.tsx`: gains the D5 checkbox in inline mode and the notice slot
(the gate renders the notice under it). Its help text drops "Your username is
never stored unless you sign in and save it" in favour of the notice, which
says the same thing with a link.

### 5.4 FAAB Calculator, `/tools/faab`

`page.tsx`: pass `handleGate` instead of `initialSleeperUsername`; `faab-form.tsx`
forwards it to `LeaguePanel`.

`league-panel.tsx`: the step-1 row (username, season, Find my leagues) is
rendered through `SleeperHandleGate`. For the saved states an effect calls
`connect({ saved: true, season })` on mount (D8), with the card's status line
carrying "Loading your leagues." and then "Loaded N leagues." The season
`<select>` moves INTO the revealed form for the saved states and stays inline
for guests. The league `<select>` becomes `LeagueChoiceList` (D12) with
`meta` = the parenthetical it used to render. The username used in the
"could not find a team owned by" message comes from the viewer.

`actions.ts`: `connectSleeperLeagues(input: { season: string } & ({ username:
string } | { saved: true }))`. The saved branch reads the handle server-side
through `loadSavedSleeperHandle` (never from the client), returns the same
error shape when there is none, and uses the cached user id. `ConnectedLeague`
gains `avatar: string | null` from the Sleeper payload. Rate bucket unchanged.

### 5.5 Beacon Breakdown, `/tools/beacon-breakdown`

`page.tsx`: resolve the gate and pass it to `LeaguePanel`.

`league-panel.tsx`: for the saved states the collapsed "Connect a league"
block becomes the identity card, with an effect that calls
`connectBreakdownLeagues({ saved: true, season })` on mount and renders the
league list (`LeagueChoiceList`, picking a row navigates as `applyLeague`
does today) directly under the card. Change reveals the existing username
form inside the card. Guests keep the "Connect a league" button, the form it
opens, and gain the notice under it. The `active` state (a league already
applied) is unchanged apart from the logo beside the league name.

`actions.ts`: same `saved: true` branch as FAAB; `BreakdownLeague` gains
`avatar`.

### 5.6 Signal Check import, `/tools/signal-check`

`sleeper-import-panel.tsx` (D10): `PanelHeader` for the signed-in-with-handle
state becomes `SleeperIdentityCard` with `SaveHandleForm mode="settings"` as
its children (Change here always saves: the panel has no one-off lookup path,
because `listImportLeagues` reads the saved handle server-side). The
no-username state renders `SaveHandleForm mode="settings"` and the
`member-unsaved` notice. The signed-out state keeps its sign-in button and
adopts the `guest` notice sentence. Delete the private `UsernameSaveForm`.
The league `<select>` becomes `LeagueChoiceList` with `meta` = the season.

`import-actions.ts`: `savedUsername()` becomes `loadSavedSleeperHandle`;
`listImportLeagues` uses the cached user id; `ImportLeague` gains `avatar`.

### 5.7 Manager Pulse, `/tools/manager-pulse`

`page.tsx` (D9): for `member-saved`, render `SleeperIdentityCard` (no
children, no Change) above `ManagerSearchForm`, with a primary button "Open my
own report" linking to `/tools/manager-pulse/<handle>` and the footer link to
`/my-beacon/sleeper-leagues`. `defaultHandle` is no longer passed;
`ManagerSearchForm` opens empty. For `member-unsaved` the page renders the
notice variant beneath the search form ("Save your Sleeper username in My
Beacon and this page will offer your own report in one press.", linking to
the settings page, since this form saves nothing). The signed-out page is
unchanged.

### 5.8 League deep views, ten routes under `/leagues/[league_id]`

Each page replaces its four-line `searchedUsername` derivation with:

```ts
const viewer = await resolveSleeperViewer(supabase, usernameParam);
const searchedUsername = viewer?.username ?? null;
```

and threads `viewer` (not just the string) into the calls below. One task per
page in Part 6; the rest of this section is what changes underneath them.

`lib/league-viewer.ts`: `matchViewerRoster` gains an optional
`viewerSleeperUserId` and matches `ownerSleeperUserId` or `coOwnerIds` first
(D3), then the display-name path as today. `ViewerCandidate` gains
`ownerSleeperUserId: string | null` and `coOwnerIds: string[]`. Every
caller that builds candidates (`lib/league-view-data.ts`, the Lineups page's
`resolveRosterId`, Trade Ideas' identity, Positional WAR's focus) supplies
them from the roster rows they already load. Test in
`lib/league-viewer.test.ts` (new): id match beats name match; a co-owner
matches; the name path still works with a null id.

`lib/league-header-data.ts` and `lib/league-switcher-data.ts`: take
`SleeperViewer | null`. With `viewer.sleeperUserId` present, skip the
`league_users` display-name lookup and call `getSleeperLeagues` with the id
directly. `SwitcherLeague` gains `avatar`.

`components/league-shell/nav-items.ts leagueTabHref` and every in-view href
builder in the ten pages: forward `?username=` only when `viewer.source ===
"url"`. A reader on their saved identity navigates between tabs on clean
URLs, and a link they copy resolves to the RECIPIENT's saved handle, which is
the correct reading of "your team". The Copy link button
(`components/league-header-actions.tsx`) behaves the same way. The League
Pulse back link in the breadcrumb goes to `/tools/league-pulse` without a
param for a saved viewer, because that page will resolve the same handle.

The Teams tab, Lineups, Trade Ideas, Schedules matchup and the team page all
inherit the id-first match through `matchViewerRoster`, so "your team"
highlights, the default roster and the trade identity all work for a
signed-in reader arriving on a clean URL.

### 5.9 League logos: League Pulse results

`league-results.tsx`, all four renderers plus `league-detail-sheet.tsx`,
per D13. `PUBLIC_GRID` and `MOBILE_GRID` gain their first track; the header
row gains an `sr-only` "Logo" cell; the `LeagueOpenLink` subgrid becomes
`col-span-4`. The dashboard table gains the `<th>` and `<td>`. The detail
sheet shows the logo at 48 px beside its heading. `aria-label` strings on the
links and buttons are unchanged (the logo adds nothing to say).

### 5.10 League logos: pickers

`league-picker.tsx` (On The Clock): the card button gains the logo as its
first flex child at 48 px (`LeagueCard.avatar` is already there). FAAB,
Breakdown and Signal Check pickers get theirs through `LeagueChoiceList`
(5.4 to 5.6).

### 5.11 League logos: switcher and cross-league panels

`league-switcher.tsx` desktop rows: logo at 32 px (D12 records the mobile
exception). `league-projections-panel.tsx`, `player-exposure-panel.tsx`,
`free-agent-finder-panel.tsx` rows: logo at 32 px. Types gain
`avatar: string | null`: `ProjectionInput` and `ProjectedLeague`
(`lib/league-projections.ts`, filled from the Sleeper payload in
`app/my-beacon/sleeper-leagues/page.tsx`), `ExposureLeague`
(`lib/player-exposure.ts` select becomes `id, sleeper_league_id, name,
avatar:metadata->>avatar`), `FreeAgentLeague` (`lib/free-agent-finder.ts`,
same select change).

### 5.12 League logos: Manager Pulse and the public profile

`lib/manager-pulse/load.ts` already selects `metadata`; `ManagerLeagueRow`
gains `avatar`, lifted from `metadata.avatar` where the row is shaped;
`leagues-section.tsx` renders it at 32 px in both of its list variants.
`lib/signal-profile.ts` `FeaturedLeagueCard` gains `avatar` (select adds
`avatar:metadata->>avatar`); `components/signal/signal-block.tsx` renders it
at 40 px beside the league name.

### 5.13 Bonus: the league masthead

`components/league-shell/league-masthead.tsx` gains an optional
`avatarId` prop and renders `LeagueLogo` at 64 px before the `<h1>`. The one
caller (`league-shell.tsx`, fed by each page's `league` row) passes
`(league.metadata as SleeperLeague).avatar ?? null`. Not a list, so outside
the letter of the ask, but a reader who just clicked a logo on a list should
see the same logo at the top of what opened. Cheap, and recorded as optional
in Part 8.

---

## Part 6. Implementation specification

Conventions for the whole part:

- One task is one file or one migration. The three review sub-agents run per
  task as `CLAUDE.md` requires; the accessibility review must confirm "no
  data hidden at any breakpoint" on every task in Phases 2 and 4.
- No em dash, no en dash, no curly quote, no ellipsis character, no emoji,
  anywhere.
- Every task lands with `npx tsc --noEmit` at 0 and `npx vitest run` green.
  Phase 4 tasks that touch a route also require `npm run build`.
- Every task cites the decision (D#) it implements in the commit body.
- Progress entries use the `progress.md` task format with `SH-T###`.

### Phase 0: foundations (no visible change)

#### SH-T001 | `supabase/migrations/0268_sleeper_handle_settings_shape.sql`

Part 4.1 verbatim. Apply via MCP, regenerate types, run prettier on
`lib/database.types.ts`, confirm the diff is empty or whitespace only.
Verify with `select col_description('public.user_preferences'::regclass,
(select attnum from pg_attribute where attrelid = 'public.user_preferences'::regclass and attname = 'sleeper_league_settings'))`
returning the new comment.

#### SH-T002 | `lib/sleeper-league-settings.ts` (+ new test)

Part 4.2. Test file `lib/sleeper-league-settings.test.ts`.

#### SH-T003 | `lib/sleeper-handle/types.ts`

Part 4.3. The header comment carries D1 to D5 in short form.

#### SH-T004 | `lib/sleeper-handle/validate.ts` (+ test)

Part 4.5. `lib/sleeper-handle/validate.test.ts`: trims, lowercases, rejects
a dot, a space, 33 characters, an empty string.

#### SH-T005 | `lib/sleeper-handle/resolve.ts` (+ test)

Part 4.4. Depends on SH-T002, SH-T003.

#### SH-T006 | `app/actions/sleeper-handle.ts`

Part 4.6. Depends on SH-T004, SH-T005. Rate bucket `sleeper_handle_save`
through the existing `try_claim_rate_limit` RPC and
`lib/rate-limit-actor.ts resolveRateLimitActorKey`, copied from
`app/tools/faab/actions.ts claimSlot`. Security review confirms: session
client for the write, never admin; the handle is validated before the Sleeper
call; the error message never echoes an unvalidated string.

#### SH-T007 | `lib/sleeper-handle/guard.test.ts`

Part 4.7. Written BEFORE the pages migrate (Phase 2), so it is red first and
each page task turns one line of it green. The initial allow-list therefore
temporarily includes the seven page files, each with the reason "migrates in
SH-T0xx"; the Phase 2 task that migrates a file also removes its line.

#### SH-T008 | `lib/sleeper-avatar-url.ts` (+ test) and `components/sleeper-avatar.tsx`

Part 4.8. Two files, because the second is a one-line import swap that
cannot break on its own; recorded as one task on that basis.

#### SH-T009 | `components/league-logo.tsx`

Part 4.9.

### Phase 1: the shared surface

#### SH-T010 | `components/sleeper-handle/save-handle-notice.tsx`

Part 4.10. Copy exactly as D6.

#### SH-T011 | `components/sleeper-handle/save-handle-form.tsx`

Part 4.10. Depends on SH-T004, SH-T006.

#### SH-T012 | `components/sleeper-handle/identity-card.tsx`

Part 4.10. Depends on SH-T008. Accessibility review must verify: the heading
level prop is honoured; `aria-expanded` and `aria-controls` are wired; focus
moves in on open and back on close; Escape closes; the status line is a
single `role="status"` region that never carries a clock; the avatar is
decorative with the name as adjacent text.

#### SH-T013 | `components/sleeper-handle/handle-gate.tsx`

Part 4.10. Depends on SH-T010 to SH-T012. Test
`components/sleeper-handle/handle-gate.test.tsx` covers the pure
`gateRenderPlan(state)` helper that decides card-versus-form-versus-notice,
so the four states are asserted without a DOM.

#### SH-T014 | `components/league-choice-list.tsx` (+ test)

Part 4.11. Depends on SH-T009.

### Phase 2: the tools

#### SH-T015 | `app/tools/league-pulse/page.tsx`

Part 5.1 page half. Removes its line from the guard allow-list.

#### SH-T016 | `app/tools/league-pulse/league-pulse-form.tsx`

Part 5.1 form half.

#### SH-T017 | `app/my-beacon/sleeper-leagues/page.tsx` (deletes two files)

Part 5.2. Deletes `sleeper-connection.tsx` and `save-username-form.tsx` in
the same commit, since they have no other importer (verify with grep before
deleting). Removes its guard line.

#### SH-T018 | `app/my-beacon/layout.tsx` and `beacon-rail.tsx`

Part 5.2 last paragraph. Removes the layout's guard line.

#### SH-T019 | `app/api/on-the-clock/leagues/route.ts`

Part 5.3 route paragraph. Security review confirms the saved mode reads the
session server-side and that every existing guard still runs before the
Sleeper call.

#### SH-T020 | `lib/on-the-clock/lookup-failure.ts` (+ test)

Part 5.3 classification helper.

#### SH-T021 | `app/tools/on-the-clock/username-gate.tsx` and `step-rail.tsx`

Part 5.3 form and rail. Two small files, one task, same reasoning as SH-T008.

#### SH-T022 | `app/tools/on-the-clock/page.tsx`

Passes the gate state. Removes its guard line.

#### SH-T023 | `app/tools/on-the-clock/on-the-clock-client.tsx`

Part 5.3 client paragraph. Depends on SH-T019 to SH-T022. The largest task
in the plan; the implementation review must confirm the `lookupRef`,
`myUserId` and report-name paths still receive a username in every state.

#### SH-T024 | `app/tools/faab/actions.ts`

Part 5.4 actions. `ConnectedLeague.avatar`.

#### SH-T025 | `app/tools/faab/page.tsx` and `faab-form.tsx`

Pass the gate state through. Removes the page's guard line.

#### SH-T026 | `app/tools/faab/league-panel.tsx`

Part 5.4 panel. Depends on SH-T013, SH-T014, SH-T024.

#### SH-T027 | `app/tools/beacon-breakdown/actions.ts`

Part 5.5 actions. `BreakdownLeague.avatar`.

#### SH-T028 | `app/tools/beacon-breakdown/page.tsx`

Resolve the gate, pass it.

#### SH-T029 | `app/tools/beacon-breakdown/league-panel.tsx`

Part 5.5 panel. Depends on SH-T013, SH-T014, SH-T027.

#### SH-T030 | `app/tools/signal-check/import-actions.ts`

Part 5.6 actions. Removes its guard line.

#### SH-T031 | `app/tools/signal-check/page.tsx`

Resolve the gate. Removes its guard line.

#### SH-T032 | `app/tools/signal-check/sleeper-import-panel.tsx`

Part 5.6 panel. Deletes the private `UsernameSaveForm`.

#### SH-T033 | `app/tools/manager-pulse/page.tsx`

Part 5.7. Removes its guard line. Depends on SH-T012.

### Phase 3: the league deep views

#### SH-T034 | `lib/league-viewer.ts` (+ new test)

Part 5.8 matcher.

#### SH-T035 | `lib/league-switcher-data.ts` and `lib/league-header-data.ts`

Part 5.8 loaders. `SwitcherLeague.avatar`.

#### SH-T036 | `components/league-shell/nav-items.ts`

`leagueTabHref` takes a `SleeperViewer | null` and forwards the param only
for `source === "url"`. Callers in `league-shell/*.tsx` pass the viewer.

#### SH-T037 to SH-T046 | one task per page

`app/leagues/[league_id]/page.tsx` (T037), `decisions/page.tsx` (T038),
`lineups/page.tsx` (T039, includes `resolveRosterId` taking the viewer id),
`positional-war/page.tsx` (T040), `power-pulse/page.tsx` (T041),
`schedules/page.tsx` (T042), `schedules/[week]/[roster_id]/page.tsx` (T043),
`teams/[roster_id]/page.tsx` (T044), `trade-ideas/page.tsx` (T045),
`transactions/page.tsx` (T046). Each: `resolveSleeperViewer`, thread the
viewer to `loadLeagueHeaderActions`, `matchViewerRoster` candidates gain the
owner id, href builders honour `source`. Verification for each: signed in
with a saved handle on a clean URL, the reader's team is highlighted and the
switcher lists their other leagues; with `?username=other`, the other
person's team is highlighted and the card says "from this link"; signed out
on a clean URL, nothing is highlighted, exactly as today.

#### SH-T047 | `components/league-header-actions.tsx`

Copy link honours `viewer.source`.

### Phase 4: logos on every list

#### SH-T048 | `app/tools/league-pulse/league-results.tsx`

Part 5.9, all four renderers. The accessibility review confirms the logo is
present at every breakpoint and that the row `aria-label`s are unchanged.

#### SH-T049 | `app/tools/league-pulse/league-detail-sheet.tsx`

Part 5.9 sheet.

#### SH-T050 | `app/tools/on-the-clock/league-picker.tsx`

Part 5.10.

#### SH-T051 | `components/league-switcher.tsx`

Part 5.11 switcher.

#### SH-T052 | `lib/league-projections.ts` and `components/league-projections-panel.tsx`

Part 5.11. Plus the one-line fill in `app/my-beacon/sleeper-leagues/page.tsx`
where `projections` is built.

#### SH-T053 | `lib/player-exposure.ts` and `components/player-exposure-panel.tsx`

Part 5.11. Existing `lib/player-exposure.test.ts` gains the avatar field in
its fixtures.

#### SH-T054 | `lib/free-agent-finder.ts` and `components/free-agent-finder-panel.tsx`

Part 5.11. Existing `lib/free-agent-finder.test.ts` gains the field.

#### SH-T055 | `lib/manager-pulse/load.ts`, `lib/manager-pulse/types.ts`, `components/manager-pulse/leagues-section.tsx`

Part 5.12 Manager Pulse. `lib/manager-pulse/load.test.ts` gains the field.

#### SH-T056 | `lib/signal-profile.ts` and `components/signal/signal-block.tsx`

Part 5.12 profile.

#### SH-T057 | `components/league-shell/league-masthead.tsx` and `league-shell.tsx`

Part 5.13. Optional; skip if the owner declines it in Part 8.

### Phase 5: copy, rules, records

#### SH-T058 | copy that describes the old flow

`app/page.tsx` (lines 87 and 107), `app/tools/page.tsx` (lines 119 and 162),
the `metadata.description` strings on `league-pulse/page.tsx` and
`manager-pulse/page.tsx`, and the On The Clock masthead. Each sentence that
says "type your Sleeper username" gains the saved-handle reading where it is
true ("or save it once and every tool opens on your leagues"). Written
against the AI-writing checklist in the owner's global instructions; the
report for this task says which patterns were checked.

#### SH-T059 | `CLAUDE.md`

Part 7, as a new section "Saved Sleeper handle" placed before the Manager
Pulse section, in that file's voice.

#### SH-T060 | `progress.md` and `docs/README.md`

The `SH-T001` to `SH-T060` block in `progress.md`. The `docs/README.md` row
for this document is added at plan time (Part 10) and this task only
confirms it is still correct.

---

## Part 7. Rules this plan adds, for CLAUDE.md

- ABSOLUTE RULE: the reader's Sleeper identity is read through
  `lib/sleeper-handle/resolve.ts` and nowhere else. `loadSavedSleeperHandle`
  for "who is this reader", `resolveSleeperViewer` for "who is this surface
  acting for". `lib/sleeper-handle/guard.test.ts` fails the suite on any
  other read of `sleeper_league_settings.username`.
- ABSOLUTE RULE: `?username=` wins over the saved handle, always. It is the
  shareable-link mechanism. The identity card says in words when the URL won.
- ABSOLUTE RULE: a saved handle is written only by
  `app/actions/sleeper-handle.ts saveSleeperHandle`, which resolves it on
  Sleeper first and stores the user id, display name and avatar beside it. A
  handle Sleeper cannot find is refused, not saved.
- ABSOLUTE RULE: roster matching prefers the Sleeper user id
  (`rosters.owner_user_id`, `co_owners`) and falls back to the display name
  only when no id is known. Sleeper usernames and display names differ, and
  matching a saved USERNAME against `league_users.display_name` fails
  silently for anyone whose two names are not the same.
- When the saved handle is in force the search form is UNMOUNTED, not hidden,
  and Change mounts it with focus inside. A hidden form is a focus trap for a
  keyboard reader.
- An auto-run for a saved handle is one Sleeper call (the cached user id, no
  `getSleeperUser`) and goes through the same rate limit as the manual path.
  A 429 on an auto-run is a Retry state on the card, never a reason to drop
  the reader to the form.
- A league's logo comes from `leagues.metadata->>avatar` or the live
  `SleeperLeague.avatar`; there is no avatar column and none is to be added.
  Every logo renders through `components/league-logo.tsx`, decorative, with
  `ImageWithFallback` behind it, in its own column on every list at every
  breakpoint. The one permitted exception is the switcher's native mobile
  `<select>`.
- Manager Pulse keeps its search box under the identity card. Its search is
  for other people, and hiding it behind the reader's own handle hides the
  tool.

---

## Part 8. Decisions for the owner

Each is answerable in one line; the build proceeds on the default shown
unless told otherwise.

1. D5, Change semantics. Default: the revealed form's "Save this as my
   Sleeper username" checkbox is OFF when a handle is already saved (one-off
   lookup), ON when none is. Alternative: ON always, so Change means "change
   my saved handle".
2. D9, Manager Pulse. Default: card with "Open my own report" above the
   search box, search box stays. Alternative: hide the search box behind
   Change like the other tools.
3. 5.1, a season control on the League Pulse identity card. Default: none;
   Change reveals the form which has the season field. Alternative: a small
   season select on the card.
4. D12, the switcher's native mobile select shows no logo. Default: keep the
   native picker. Alternative: replace it with the desktop-style panel on
   phones too, gaining the logo and losing the platform picker.
5. 5.13, the league masthead logo (SH-T057). Default: build it. Alternative:
   skip.
6. Debt, not in this plan: three different username grammars
   (`lib/on-the-clock/validation.ts`, the FAAB and Breakdown
   `USERNAME_PATTERN`s, `lib/manager-pulse/handle.ts`). Recommend a follow-up
   that makes `lib/sleeper-handle/validate.ts` the one gate; recorded here so
   it is not forgotten.
7. Numbering: 0268 is claimed by whichever of this plan and Beacon Link
   builds first.

---

## Part 9. Acceptance checklist

Run before the block is marked complete in `progress.md`, signed in with a
saved handle unless the row says otherwise.

- `/tools/league-pulse` on a clean URL: no username form, identity card, leagues
  listed, step rail at 2, the masthead "Sign in to save" sentence absent.
- Same page as a guest: form, notice with a login link carrying `next`.
- Same page signed in without a handle: form with the checkbox ON, notice.
- `?username=other` while signed in with a handle: the other person's
  leagues, the card says "from this link" and offers the saved handle.
- Change on any card: form appears, focus lands in the username field, Escape
  closes and returns focus to the button, the form is not in the DOM while
  closed (inspect).
- On The Clock: lands on "Choose your draft" with the card; reload twice
  inside ten seconds shows the Retry state, not the form; a saved handle that
  was renamed on Sleeper opens the form with an alert.
- FAAB and Breakdown: league list waiting on load, radiogroup navigable with
  arrow keys, disabled rows announce their reason.
- Signal Check: card at the top of the import panel; league list with logos.
- Manager Pulse: card with "Open my own report"; search box present and
  empty.
- Any league deep view on a clean URL: your team highlighted on Teams, your
  roster is the Lineups default, the switcher lists your other leagues, tab
  links carry no `?username=`; with `?username=other` every link carries it.
- A reader whose Sleeper display name differs from their username is
  highlighted correctly (test with a real such account; the fixture in
  `lib/league-viewer.test.ts` covers the logic, this covers the wiring).
- Every list in Part 2.3 shows a logo per row at desktop and phone widths,
  the placeholder for a league without one, and no broken image when the
  Sleeper CDN is blocked in devtools.
- `npx tsc --noEmit` 0; `npx vitest run` green including the new guard;
  `npm run build` clean; the banned-character scan over every changed file
  clean.

---

## Part 10. The docs folder

This document lives at `docs/saved-handle/saved-handle-plan.md`. The row for
it in `docs/README.md` was added when the plan was written. A build report,
when the build ships, goes beside it as
`docs/saved-handle/saved-handle-build-report.md`, following the BEAM
convention of a plan and a report in one folder.
