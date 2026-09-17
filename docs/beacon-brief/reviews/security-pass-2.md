# Security review, pass 2: Relays and Briefs

Reviewed 2026-09-17 against docs/beacon-brief/relays-and-briefs-plan.md
sections 8, 9, 15 and 22, the "Security review sub-agent" list in CLAUDE.md,
and docs/beacon-brief/reviews/security.md (pass 1). This pass verified every
"Resolution: fixed" line in pass 1, read the changes made on 2026-09-17 that
pass 1 never saw, re-read the highest-exposure surfaces whole, queried the live
project read-only for the five new tables, and re-ran npm audit.

Scope: app/api/brief-desk/bundle/route.ts, app/api/brief-desk/drafts/route.ts,
lib/brief-desk/auth.ts, lib/brief-desk/override.ts, lib/brief-desk/bundle.ts,
lib/brief-desk/validate-draft.ts, lib/brief-desk/draft-schema.ts,
lib/brief-desk/publish.ts, app/admin/brief-desk/actions.ts,
lib/relays/feed-params.ts, lib/relays/load.ts, lib/relays/legacy-redirect.ts,
lib/relays/write.ts, lib/relays/types.ts, lib/beacon-brief-feed.ts (the three
resolvers), lib/memo-ttl.ts, lib/rate-limit-claim.ts, lib/json-ld.ts,
lib/beacon-brief/worker.ts (Discord paths), lib/discord.ts,
lib/beacon-brief/email.ts and lib/email/layout.ts, app/brief/(feed)/page.tsx
and its four sibling routes, app/brief/[slug]/page.tsx,
app/brief/relay/[slug]/page.tsx, app/brief/editions/page.tsx,
app/about/page.tsx, components/beacon-brief/brief-feed.tsx,
components/relays/relay-card.tsx, components/relays/relay-filters.tsx,
components/beacon-brief/article-markdown.tsx, scripts/brief-desk/draft.ps1,
migrations 0284 to 0288, and the live pg_policies, pg_class and
role_table_grants rows for relays, relay_players, relay_teams, brief_editions
and legacy_article_redirects.

Counts: 0 blocker, 0 major, 5 minor.

Every finding below was reproduced by reading the cited lines. No code file
was edited, nothing was committed, and the one database query was a SELECT.

---

## Pass 1 resolutions, verified

- M1 (unauthenticated log writes). Fixed as described. Both routes now
  console.warn a refusal and return without touching the database
  (bundle/route.ts:45-49, drafts/route.ts:54-58). See P2-2 below for the two
  token-authenticated branches that still write before the claim.
- M2 (shell in the local run). Fixed. scripts/brief-desk/draft.ps1:61 passes
  `--allowedTools "WebFetch,WebSearch"` and nothing else; the comment at
  lines 51-60 now states the allow list is the control. Plan section 15
  (lines 1497-1502) says the same.
- N2 (source_url scheme). Fixed at the render boundary.
  lib/relays/load.ts:117-124 `httpsOrNull` parses with `new URL` and returns
  null unless the protocol is exactly `https:`; it is applied at line 216, the
  type is nullable at line 63, and components/relays/relay-card.tsx:177-181
  renders the anchor only when the value is non-null, with
  `rel="nofollow noopener noreferrer"` and `target="_blank"`.
- N3 (redirect output validation). Fixed. lib/relays/legacy-redirect.ts:31
  tests the stored `relay_slug` against the same `^[a-z0-9-]{1,120}$` as the
  input and returns null on a miss; app/brief/[slug]/page.tsx:307-308 only
  redirects on a non-null result.
- N1 (per-actor rather than per-token limit) and N4 (npm audit) were left by
  decision and are unchanged; N4 is re-measured under P2-5.

---

## Minor

### P2-1. The hub throws on a repeated `team` or `player` query key

Files and lines:
- lib/relays/feed-params.ts:15-21 (`FeedSearch` types every value as
  `string | undefined`) and :55-56 (`search.team.toUpperCase()`,
  `search.player.slice(0, 80)`)
- app/brief/(feed)/page.tsx:63-64 (`search.team.slice(0, 4)`,
  `search.player.slice(0, 80)`) and :30 (generateMetadata calls `feedQuery`)
- app/rankings/page.tsx:71-73 for the repo's own convention: a search param
  is `string | string[]`

The issue. Next hands a repeated query key to the page as an array, and the
rest of the app types its search params that way. `FeedSearch` narrows them to
strings, so `feedQuery` calls `toUpperCase` on an array in `generateMetadata`
and throws before the page body runs. The four sibling routes pass
`FILTER_KEYS` of kind and week only, so they are not affected; `parseKind`,
`parseWeek` and `parsePage` tolerate an array (isRelayKind checks
`typeof value === "string"` at lib/relays/types.ts:87, and parseInt of an array
is NaN).

Exploit scenario. `GET /brief?team=a&team=b` (or `?player=a&player=b`)
renders Next's 500 page. It is an availability nuisance rather than a data
exposure: no data leaks and the process survives, but a loop over the URL is
a free way to fill the error log and spend render time on a page that
publishes a sidebar read on every request.

Fix. In lib/relays/feed-params.ts widen `FeedSearch` to
`string | string[] | undefined` and add a `first()` helper that returns the
first element of an array (or undefined) before every use; call it in
`feedQuery`, `feedPath`, `parsePage`, `parseWeek`, `parseKind`, and in
app/brief/(feed)/page.tsx:63-64 for the two resolver calls. Bounding the value
in one place is the reason feed-params.ts exists.

### P2-2. Two token-authenticated branches still write a log row before the rate limit is claimed

Files and lines:
- app/api/brief-desk/bundle/route.ts:55-58 (override present, no admin
  session: `logBeaconBrief` at :56, then 403) versus the claim at :60
- app/api/brief-desk/drafts/route.ts:66-70 (zod shape check failed:
  `logBeaconBrief` at :68, then 400) versus the claim at :75
- The write path is lib/beacon-brief/ai.ts `logBeaconBrief`, a service-role
  INSERT into beacon_brief_logs

The issue. Pass 1's M1 removed the unauthenticated write, and the "validate
before claiming" order is right for the caller's budget. But the two
validation failures that a token holder can trigger at will each cost one
service-role INSERT, and neither sits behind the claim. On the bundle route
the branch also runs `getIsAdmin()` (a session and user_preferences read)
before any claim. Plan section 9.1 says the limit "stops a leaked token from
being used to hammer" the desk; these two branches are outside it.

Exploit scenario. Someone holding the token (a leak from the routine's
environment, or the routine itself stuck in a retry loop sending a body that
fails the shape check) issues `POST /api/brief-desk/drafts` with `{}` in a
loop. Every request appends a beacon_brief_logs row with no limit, burying
the desk lines the moderation and logs pages read. The bundle builder is not
reached, so this is narrower than M1 was, but the ledger the plan promises is
not in front of it.

Fix. Either console.warn these two refusals the way the 401 branch now does
(they carry no period and no outcome, which is what section 15 asks the
`brief_desk` stage to record), or move the `claimRateLimitSlot` call above
the shape check and the override check so a refused request still spends a
slot. The first is the smaller change and keeps beacon_brief_logs for
outcomes.

### P2-3. memoTtl never evicts expired entries, and the hub now feeds it an address-bar value

Files and lines:
- lib/memo-ttl.ts:28-38 (`store.set` on every miss; no deletion on expiry,
  no sweep; `bustMemo` at :47-49 only deletes by prefix on an admin save)
- lib/beacon-brief-feed.ts:308 (`ref:brief:team:${key}`, key is the caller's
  abbreviation upper-cased) and :260 (`ref:brief:category:${slug}`, the raw
  route segment with no length cap)
- app/brief/(feed)/page.tsx:63 (new this build: `?team=` on the hub, sliced
  to four UTF-16 units, passed straight to `resolveTeam`)

The issue. An expired entry stays in the Map until the same key is asked for
again; a key that is never repeated is never freed. Both resolvers were
already reachable with caller-chosen keys through /brief/team/[abbr] and
/brief/category/[slug] before this build, so the pattern is pre-existing, but
the hub's `?team=` adds a second unauthenticated path into `resolveTeam` with
a value the caller picks. Four code units over any alphabet is not a small key
space.

Exploit scenario. A loop over `GET /brief?team=<distinct 4-char value>` adds
one Map entry per request, each holding a resolved promise of null, for the
life of the process. On Vercel the instance is recycled so this is bounded in
practice, and each entry is tiny, which is why it is minor rather than major.
The category route's uncapped slug makes each entry as large as the URL
allows.

Fix. Two small changes. In lib/memo-ttl.ts, delete the expired entry on the
miss path (`if (hit) store.delete(key)` before recomputing) and, since that
only frees repeated keys, add a cheap sweep when the Map passes a size
threshold (for example every 1,000 sets, drop every entry whose `expires` is
in the past). In lib/beacon-brief-feed.ts validate before memoising:
`resolveTeam` should return null without touching the Map unless the value
matches `^[A-Z]{2,4}$`, and `resolveCategory` should do the same for
`^[a-z0-9-]{1,80}$`.

### P2-4. `parsePage` has no upper bound, so a huge page number reaches PostgREST and the canonical tag

Files and lines:
- lib/relays/feed-params.ts:23-26 (`parsePage` accepts any finite positive
  integer) and :62-67 (`feedPath` prints `page=${page}`)
- lib/relays/load.ts:258-260 (`from = (safePage - 1) * pageSize`, then
  `.range(from, to)` at :281)

The issue. `page=100000000000000000000` parses to 1e20, `from` becomes 3e21,
and JavaScript prints numbers past 1e21 in exponent form, so the request
carries `offset=3e+21`. PostgREST rejects it, `loadRelayFeed` logs a
console.error and returns an empty feed (:282-285), and the canonical URL
becomes `/brief?page=1e+20`. Nothing off-site and nothing unescaped
(URLSearchParams encodes the query), and the sibling routes are noindex, but
it is one more per-request error line an anonymous caller can generate and a
malformed canonical on a page whose first page is indexable.

Exploit scenario. A loop over large page values fills the function log with
PostgREST errors. Availability nuisance only.

Fix. Cap in `parsePage`: `Math.min(n, 10_000)` (or derive the cap from
`total / pageSize` where the page has it). The page is already noindex past
page 1, so the canonical then carries a bounded integer at worst.

### P2-5. Admin server actions accept their arguments untyped; one path publishes before its bad input is noticed

Files and lines:
- app/admin/brief-desk/actions.ts:46-72 (`approveBriefEdition` forwards
  `input.titleChoice` unchecked), :74-84 (`notes.trim()`), :138-147 and
  :159-168 (`reason.trim()`), :113-132 (`ticks` forwarded as `string[]`),
  :179-187 (`edit` forwarded)
- lib/brief-desk/publish.ts:98-104 (`draft.title_options[input.titleChoice]`
  with a truthiness check only) and :121-127 (the article is set to
  `published` before :141-150 writes `title_choice` to the integer column)

The issue. A server action's arguments arrive from the network and TypeScript
types are not enforced at runtime. Every action calls `requireAdmin` first
(lines 50, 78, 87, 99, 117, 139, 150, 160, 180, 198), so the only caller who
can send a malformed argument is the admin, which is why this is minor. But
the shape is not checked anywhere: `titleChoice` of `"constructor"` indexes
`Array.prototype`, passes the truthiness test at publish.ts:99, and yields a
choice whose `title` and `slug` are undefined; supabase-js drops undefined
keys, so the article publishes under the draft's original title, and only
then does the `title_choice` write fail against the integer column and get
logged as "published but the brief_editions review stamp failed". A
non-string `notes` or `reason` throws a TypeError out of the action instead
of returning the `{ ok: false }` shape the form expects.

Exploit scenario. None beyond the admin's own session. The concern is
robustness: an inconsistent publish (an off-season edition live with no title
choice recorded) from one malformed request, and thrown errors where the
action contract promises a result object.

Fix. Parse every action's input with zod at the top of the action, after
`requireAdmin`: `titleChoice` as `z.number().int().min(0).max(2).nullable()`,
`notes` and `reason` as `z.string().max(4000)`, `ticks` as
`z.array(z.string().max(200)).max(500)`, `edit` and `input` as strict objects.
In publish.ts:99, replace the truthiness check with
`Number.isInteger(input.titleChoice)` and a bounds check before indexing.

### P2-6. npm audit: unchanged from pass 1

```
high     postcss  <=8.5.22   XSS via unescaped </style>; .map file read via
                             attacker-controlled sourceMappingURL
                             (transitive, via next; fix is next@16.3.5, major)
moderate next     direct     inherits the postcss advisory
moderate vitest   direct     dev only; fix in range
moderate @vitest/mocker      path traversal / arbitrary file read (dev only)
```

1 high, 3 moderate, 0 critical, 173 packages. `git diff package.json` shows
three new npm scripts (backfill:relays, archive:legacy-articles,
gen:brief-desk-settings-sql) and no new dependency, so the build adds
nothing. The postcss advisories are build-time; the vitest chain is dev-only.
Same disposition as pass 1: fix the vitest chain when convenient, schedule
the Next.js major on its own.

---

## What was checked and found correct

The two doors:
- lib/brief-desk/auth.ts:15-27. Length compare then `timingSafeEqual` over
  the whole `Bearer <token>` string; 500 when `BRIEF_DESK_TOKEN` is unset,
  401 otherwise; the presented value is never logged or echoed.
  `briefDeskTokenPresent` (:30-32) returns a boolean only.
- Order on both routes: auth (bundle :45, drafts :54), then shape or override
  validation, then the claim (bundle :60, drafts :75), then the expensive
  work. `claimRateLimitSlot` (lib/rate-limit-claim.ts:36-63) fails closed
  and derives the actor from trusted headers, never from the body.
- lib/brief-desk/override.ts:17-34. Season is four digits, week is one or two
  digits in 1 to 22, period_end is YYYY-MM-DD, week and period_end are
  mutually exclusive. bundle/route.ts:55-58 answers 403 to an override
  without an admin session. drafts/route.ts:87-90 derives the override from
  the draft's own edition through `overrideForEdition` and only behind
  `getIsAdmin()`; draft-schema.ts:64-71 bounds that edition object (season
  `^\d{4}$`, week int 1 to 22 or null, two 40-char strings).
- The memo key (lib/brief-desk/bundle.ts:691-692) is built from the period
  the server chose (or an override that `periodForOverride` at :121-125
  rejected unless it names a real period this season), the literal
  `override` or `live`, and `sourceKey` (:617-634), which reads the source
  registry and the projection settings. No caller-supplied string enters the
  key. An admin can create at most one override key per real period, and the
  claim at bundle/route.ts:60 runs before `buildBundle` at :66, so the memo
  cannot be grown faster than 10 entries an hour per actor.
- `context.source_display` (bundle.ts:575, :380) is null when no source
  resolves, never a placeholder; drafts/route.ts:226 stores it as-is and the
  byline reads it as data.
- drafts/route.ts:159-182. The validator's world (Relay ids, dataset ids and
  kinds, player ids, period, taken slugs) comes from the server's bundle;
  nothing from the request body contributes. :261 intersects `draft.players`
  with the bundle; :268-276 resolves team strings against nfl_teams.
- `run.source` is an enum in draft-schema.ts:89 and the CHECK at
  0287_brief_editions.sql:45 matches it; run_id and model are capped strings.
- lib/brief-desk/validate-draft.ts. The new warnings (:95-100, :266-285) are
  advisory and cannot pass a draft the errors would refuse. `optionStrings`
  (:132-143) walks parsed block options so every string in them meets the
  same banned-character and raw-HTML check as body text (:231-233).
  Citations must appear in `research_log` (:253-255) and URLs are https by
  schema (draft-schema.ts:15).

Approve is the only path to published:
- lib/brief-desk/publish.ts:121-131. `status: "published"` is written once,
  guarded by `.eq("status", "in_review")` with the updated row selected so a
  second click fails rather than repeating the side effects. No other file in
  lib/brief-desk or app/api/brief-desk writes that status; the drafts route
  writes `in_review` (:214).
- IndexNow: publish.ts:173 (approve) and :308 (edit of an already published
  edition, guarded by `loaded.article.status === "published"`). Nowhere else.
- The Discord `kind: "brief"` job is enqueued only at publish.ts:181-186,
  behind the server's own re-read of `bd_discord_briefs_enabled` (:178-179),
  inside `approveEdition`, which is called only from
  app/admin/brief-desk/actions.ts:59 after `requireAdmin` at :50.

Server actions: every exported action in app/admin/brief-desk/actions.ts
calls `requireAdmin` as its first statement (lines 50, 78, 87, 99, 117, 139,
150, 160, 180, 198). `updateBriefDeskSetting` (:197-230) refuses any key
outside the `brief_desk` category except the one legacy switch, coerces by the
row's declared `value_type`, and uses `.eq` throughout.

Grounding before every write:
- lib/relays/write.ts:202-234 `assessRelay` runs `checkRelayGrounding`
  before `writeRelay` inserts at :287; a failure lands as `hidden` with
  `status_reason = 'grounding'` and a moderation row (:363-375).
- The Discord card is enqueued only when `status === "published" && input.discord`
  (:387), with `role_ids: []` (:391). The backfill passes `discord: false`.
- `updateRelayText` re-runs grounding against the stored post (:480-489)
  and an admin edit publishes only on a pass (:491-495).
- `setRelayStatus` re-checks stored grounding before an unhide can publish
  (:576-587), and a retracted Relay stays retracted (:571).

Discord payloads:
- Relay card: lib/beacon-brief/worker.ts:487-502 returns
  `{ content, embeds: [], allowedRoleIds: [], attachments }`; no link, no
  embed, no role. :791-795 forces `roleIds` to `[]` whenever a Relay backs
  the card; :782-790 posts nothing for a hidden or retracted Relay.
- lib/discord.ts:148-151 sends `allowed_mentions.parse: []` unless
  `allowEveryone` is set; the only caller setting it is the Brief edition post
  at worker.ts:751-756, reached only through the `kind: "brief"` payload
  above. That post claims `discord_posted_at` with a conditional update
  (:741-747) so it cannot double-send.

XSS and injection:
- All three JSON-LD script tags (app/brief/[slug]/page.tsx:295 and :452,
  app/brief/editions/page.tsx:110) go through `serializeJsonLd`, which
  escapes `<`, `>`, `&`, U+2028 and U+2029 to `\uXXXX` (lib/json-ld.ts:25-41).
  The edition's FAQ answers and title enter only through that path.
- Markdown renders through components/beacon-brief/article-markdown.tsx,
  whose `safeHref` (:16-17) allows http(s), mailto and site-relative targets
  only, so a `javascript:` link in a draft body cannot become an anchor even
  if it somehow passed the validator.
- The review email escapes the draft title and every row value through
  `esc()` (lib/email/layout.ts:240-243).
- `emptyMessage` on components/beacon-brief/brief-feed.tsx is a fixed
  sentence chosen by app/brief/(feed)/page.tsx:119-123 and rendered as a text
  node (:229-230); no caller string reaches it.
- Every address-bar value reaches PostgREST through `.eq`, `.contains` or
  `.in` with a parameterised value: kind is an enum (`parseKind`), week is an
  integer in 1 to 22 (`parseWeek`), team and player resolve to a row id first
  (`resolveTeam` :312, `resolvePlayer` :283 in lib/beacon-brief-feed.ts) and
  an unresolved value renders the empty state rather than the whole feed
  (page.tsx:70, :82), tag goes through `.contains("tags", [tag])`
  (load.ts:275), and the joined filters use the embedded-column `.eq`
  (load.ts:276-277). No `.or()`, `.ilike()`, `.filter()` or raw string
  building from user input. The canonical query is built by URLSearchParams
  (feed-params.ts:46-58), so it is percent-encoded and can carry nothing
  off-site: it always begins with the route's own `base`.
- app/brief/relay/[slug]/page.tsx:61 guards the slug with
  `^[a-z0-9-]+$` and a 120-character cap before any read.
- components/relays/relay-filters.tsx:41-43 carries only the resolved
  team abbreviation and player slug from the database as hidden inputs, never
  the raw query value.

The About page count (app/about/page.tsx diff): a `head: true` count with
fixed `status` and `article_type` filters through the cookie client; the
number is gated below five and rendered as text.

RLS and grants, verified on the live project (read-only, 2026-09-17):
- pg_class.relrowsecurity is true on all five tables.
- pg_policies holds exactly: relays_select_public (SELECT to anon,
  authenticated, `status = 'published'`), relay_players_select_public and
  relay_teams_select_public (SELECT to anon, authenticated, EXISTS against a
  published parent), and one `_service_role_all` (ALL, using true, with check
  true) on each of the five tables. Eleven policies, matching 0284, 0286 and
  0287 line for line.
- information_schema.role_table_grants: anon and authenticated hold SELECT
  only on relays, relay_players and relay_teams (the 0288 revoke of insert,
  update, delete, truncate, references and trigger is applied), and hold
  nothing on brief_editions or legacy_article_redirects (the 0286 and 0287
  `revoke all` are applied). service_role holds all seven privileges on all
  five.
- The public read layer (lib/relays/load.ts) uses the cookie or cached read
  client only; the one admin read on a public page (`loadRelayStatusBySlug`,
  :305-311) selects a single `status` column to tell "retracted" from
  "never existed" and the page renders a fixed sentence.

Secrets: no literal key, token or webhook URL in any new file;
scripts/brief-desk/draft.ps1 reads `BRIEF_DESK_TOKEN` and `SITE_URL` from its
own environment and never from .env.local. No server secret is referenced from
a client component in the new code.

CSRF: every state change is a Next.js server action (origin-checked, admin
re-checked server side) or a bearer route a browser cannot attach the
credential to cross-origin.

IDOR: admin actions take an edition or relay id, but every one of them sits
behind `requireAdmin` and there is no ownership model below the admin bit.

SSRF and path traversal: no `fetch()` of a caller-supplied URL anywhere in
lib/relays, lib/brief-desk, app/api/brief-desk or app/admin/brief-desk.
`readExample` (bundle.ts:356-364) reads one fixed path under process.cwd().

## Not verifiable from the repository

As in pass 1: the cloud routine's environment must hold `BRIEF_DESK_TOKEN`
and nothing else from .env.local, which is a routine setting rather than a
file here.

## Resolutions, 2026-09-17

- P2-1: fixed. lib/relays/feed-params.ts types every value as string or
  string array and reads the first through one helper; the hub reads team
  and player through parseTeamCode and parsePlayerSlug.
- P2-2: fixed. The override-without-admin and shape-check refusals on both
  desk routes go to the console, not to beacon_brief_logs.
- P2-3: fixed. memoTtl sweeps expired entries past 256 live keys; the bundle
  evicts its predecessors before memoising; resolveTeam and resolveCategory
  refuse a key that is not a team code or a category slug before memoising;
  the team route bounds its segment first.
- P2-4: fixed. parsePage caps at MAX_PAGE (10,000).
- P2-5: fixed. Every action in app/admin/brief-desk/actions.ts zod-parses its
  arguments after requireAdmin, and approveEdition checks the title choice
  as an integer inside the options range.
- P2-6: left, as in pass 1 (dev-only chain and the Next major).
