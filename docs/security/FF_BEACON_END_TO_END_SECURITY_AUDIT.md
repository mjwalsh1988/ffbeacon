# FF Beacon End-to-End Security Audit

## 1. Report metadata

- Audit title: FF Beacon End-to-End Security Audit
- Audit date: 2026-07-11
- Repository commit hash: f5b698604922ed705bb8f01c60fd745f12d624bf
- Branch: main
- Auditor identity: Claude (Claude Code, automated security review)
- Scope: Full repository at C:\Users\mjwal\OneDrive\Desktop\ffbeacon. Static review of all application source (app/, components/, lib/), 132 Supabase migrations, configuration (next.config.ts, vercel.json, .gitignore, .env.local.example), the lockfile, and tests. Dynamic read-only validation against the live Supabase project cilvpyivysjxpxbudkfa via MCP (advisors, live RLS/policy state, function definitions, grants, storage buckets). No production website request flooding or exploitation was performed.
- Environment limitations: The production Vercel dashboard, the Supabase Auth dashboard settings, production environment-variable values, and email-provider configuration are not visible from the repository and are listed in the manual verification checklist. No live write test of the confirmed privilege-escalation was performed, to honor the no-production-modification rule; that finding is confirmed by policy, grant, and trigger analysis instead.
- Tools and commands used: git (rev-parse, ls-files, status, log), Read, Grep, Glob, the Supabase MCP tools (get_advisors, execute_sql for pg_class / pg_policies / pg_proc / information_schema grants / storage.buckets / storage.objects policies), Node for lockfile inspection, and four parallel read-only sub-agents covering RLS/migrations, API routes/cron, On The Clock/Sleeper/Realtime/business-logic, and XSS/secrets/headers/dependencies.
- Files created by the audit: docs/security/FF_BEACON_END_TO_END_SECURITY_AUDIT.md and docs/security/FF_BEACON_SECURITY_FINDINGS.json. These two files are the only intended repository changes.
- Explicit statement: No remediation changes were made. No application code, migration, configuration, dependency, lockfile, or test was modified. No production data was modified.

## 2. Executive summary

FF Beacon has a strong baseline security posture. Row Level Security is enabled on all 79 public tables, every table carries at least one policy, all client write paths on user-owned tables bind ownership through auth.uid() in a WITH CHECK clause, internal and admin tables are locked to the service role, the service-role key is confined to server-only code, cron routes fail closed when their secret is missing, search endpoints sanitize input against PostgREST filter injection, the renderer layer (Markdown, post bodies, profile links, OG images) is well defended against XSS, and dependencies are current (Next.js 15.5.18, past the CVE-2025-29927 middleware bypass).

There is one Critical issue that must be fixed immediately. Because the is_admin admin flag on user_preferences is protected only by a BEFORE UPDATE trigger, and the table grants owner INSERT and owner DELETE with no column restriction, any signed-in user can create or recreate their own user_preferences row with is_admin set to true and become a full administrator. This is exploitable directly through the public PostgREST API using the browser-embedded publishable key and a normal user session.

The remaining issues are Medium and below: an On The Clock rate-limit design that lets one client fan out unbounded Sleeper calls, a draft-cache poisoning path from unvalidated client-supplied league identifiers, commissioner authorization based on an unverified self-declared Sleeper username, the absence of global security response headers, a JSON-LD cross-site scripting gap, and an over-broad EXECUTE grant on the league-refresh rate-limit function. A set of Low and Informational hardening items rounds out the report.

There is no evidence of an active compromise. The live database shows 16 users and exactly one admin row, which matches the expected single legitimate owner-administrator.

What to fix first: close the is_admin self-INSERT escalation (FFB-SEC-001) before anything else, then add global security headers and the On The Clock and draft-sync abuse controls.

For a non-technical owner: the site is generally well built and locked down. There is one serious hole where any registered user could promote themselves to administrator by talking directly to the database through the public app key. That single hole should be closed right away. Everything else is lower risk and can be scheduled.

### Severity counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 6 |
| Low | 6 |
| Informational | 8 |
| Total | 21 |

## 3. Immediate action list

Fix immediately:
1. FFB-SEC-001: Block setting user_preferences.is_admin = true on INSERT (and by non-service-role at all). Extend the guard to BEFORE INSERT OR UPDATE, or add column-level grants so authenticated cannot write the is_admin column. After the fix, audit the live user_preferences table to confirm no unexpected admin row exists (verified at audit time: 1 admin, which is the legitimate owner).

Fix before the next production release:
2. FFB-SEC-005: Add global security response headers (frame-ancestors or X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and a starter Content-Security-Policy).
3. FFB-SEC-006: Escape the less-than character before injecting any JSON into a script tag for JSON-LD.
4. FFB-SEC-002: Add an identifier-independent per-IP budget in front of every On The Clock Sleeper fan-out, and prune the lookup-attempt ledger.
5. FFB-SEC-003: Treat client-supplied league_id and season in /draft/sync as hints only; use the Sleeper draft object's league_id and season as authoritative.
6. FFB-SEC-007: Revoke EXECUTE on try_claim_league_refresh from anon and authenticated; the API calls it via the service role.

Fix soon:
7. FFB-SEC-004: Verify Sleeper account ownership before trusting the stored username for commissioner authorization; match on sleeper_user_id, not display_name.
8. FFB-SEC-009: Use a constant-time comparison for CRON_SECRET in the seven sync/recalc cron routes.
9. FFB-SEC-010: Confirm SIGNAL_SCOUT_IP_SALT is set in production; consider failing closed when unset.
10. FFB-SEC-012: Add a MIME allowlist to the user-avatars storage bucket.
11. FFB-SEC-008 / FFB-SEC-011: Harden IP-derivation and cross-instance rate limiting for the email and abuse-sensitive endpoints.

Longer-term hardening:
12. FFB-SEC-014, FFB-SEC-015, FFB-SEC-016: Tighten the is_admin trigger null-claims path, pin search_path on the remaining functions, revoke EXECUTE from anon/authenticated on inert trigger/util RPCs, and move pg_trgm out of the public schema.
13. FFB-SEC-017: Enable Supabase leaked-password protection.
14. FFB-SEC-013: Add an origin check to the logout route.
15. FFB-SEC-021: Delete the stray grep1.json / grep2.json artifacts and gitignore that pattern.

Secret rotation or production shutdown: Not required. No secret was found exposed in the repository or git-tracked files, and there is no evidence of compromise. The is_admin escalation does not disclose secrets. If FFB-SEC-001 is judged to have been exploitable in production for any length of time, re-verify the admin row set as the only follow-up (no key rotation needed).

## 4. Architecture and attack-surface map

Major components:
- Public browser client (Next.js App Router, React 19). Holds the Supabase publishable key, which is embedded in the client bundle by design and is safe because RLS is the boundary.
- Next.js middleware (middleware.ts). Refreshes the Supabase session and forwards stray OAuth ?code= params to /auth/callback. It is not an authorization boundary; route and page code re-check auth.
- Server Components and Route Handlers under app/. Two Supabase clients: a cookie-bound anon client (createClient, RLS enforced) and a service-role admin client (createAdminClient, bypasses RLS, server-only).
- Server Action: app/actions/preferences.ts (source and format preference persistence).
- Supabase Postgres with RLS on every public table, SECURITY DEFINER functions for rate-limit claims and moderation triggers, and Supabase Auth (email/password plus Google and Discord OAuth configured in the dashboard).
- Supabase Storage: signal-media (public, raster-only), signal-reaction-emojis (public, webp), user-avatars (private).
- Supabase Realtime: a single publication carrying on_the_clock_pick_cache (public draft data).
- Vercel cron routes under /api/cron/* protected by CRON_SECRET.
- External APIs: Sleeper (fantasy league/draft data, no key), Anthropic (server-side content generation), Resend (email), GIPHY (server-proxied), X (Beacon Brief ingestion).

Trust boundaries and untrusted-input crossings:
1. Browser to PostgREST: any holder of the publishable key plus a user session can issue direct table and RPC calls. RLS, column grants, and function EXECUTE grants are the only controls here. This is the boundary that FFB-SEC-001 and FFB-SEC-007 sit on.
2. Browser to Route Handlers: query params, JSON bodies, path params, and headers. Controls are per-route auth checks, Zod or manual validation, charset allowlists, honeypots, same-origin checks, and the x-requested-with header guard.
3. Route Handlers to Sleeper: user-controlled league/draft/user identifiers become Sleeper URL path segments. Controls are strict numeric and alphanumeric regexes plus encodeURIComponent, which prevent SSRF.
4. External data to storage and render: Sleeper payloads and AI-generated Beacon Brief content are stored and later rendered. Controls are React auto-escaping and safe-href helpers; the JSON-LD path is the gap (FFB-SEC-006).
5. Vercel cron to Route Handlers: the platform injects Authorization: Bearer CRON_SECRET. Controls are the bearer check, fail-closed on missing secret.

Sensitive data stores: user_preferences (holds is_admin, Sleeper username, favorites), auth.users (never exposed via RLS), discord_webhooks (webhook secret URLs, service-role only), beacon_brief_logs (raw AI prompts, service-role only), signal_check_analyses (private user analyses, owner-only), signal_scout secret tables (game answers, service-role only).

Service-role use: confined to createAdminClient in lib/supabase/server.ts and cron/admin/OG/game route handlers, each of which either gates on auth first or serves only public data.

Text description of the primary data flow: A browser sends a request. Middleware refreshes the session. For page and route code, the server reads the session cookie and either uses the RLS-bound anon client (for user-scoped reads and writes) or, after an explicit auth and authorization gate, the service-role client (for privileged sync, admin operations, and OG rendering). Direct browser-to-PostgREST calls bypass all route code and rely entirely on RLS plus grants, which is why the is_admin INSERT gap is severe.

```mermaid
flowchart TD
  Anon[Anonymous browser] -->|publishable key| PostgREST[(Supabase PostgREST + RLS)]
  AuthUser[Authenticated browser] -->|session + publishable key| PostgREST
  AuthUser --> Routes[Next.js Route Handlers / Server Actions]
  Anon --> Routes
  Routes -->|anon client, RLS| PostgREST
  Routes -->|service role, bypasses RLS| DB[(Postgres)]
  Routes --> Sleeper[Sleeper API]
  Routes --> Anthropic[Anthropic API]
  Vercel[Vercel Cron] -->|Bearer CRON_SECRET| Cron[/api/cron/*]
  Cron -->|service role| DB
  PostgREST --> DB
  Admin[Admin browser] --> AdminPages[/admin/* pages]
  AdminPages -->|requireAdmin reads is_admin| PostgREST
  Realtime[(Realtime publication)] --> AuthUser
```

## 5. Findings summary table

Sorted by severity, then exploitability, then business impact, then finding ID.

| ID | Title | Severity | Confidence | Exploitability | Impact | Affected component | Current mitigation | Priority | Complexity | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| FFB-SEC-001 | is_admin self-promotion via INSERT | Critical | Confirmed | Easy (authenticated, public API) | Full admin takeover | user_preferences RLS + trigger | Immediate | Small | Open |
| FFB-SEC-002 | On The Clock throttle keyed on rotating id lets one client fan out Sleeper calls | Medium | Confirmed | Moderate (scripted) | Sleeper ban risk, cost, DB growth | app/api/on-the-clock/* | Before release | Moderate | Open |
| FFB-SEC-003 | Draft-cache poisoning via unvalidated client league_id in /draft/sync | Medium | Confirmed | Moderate | Corrupted shared draft data | lib/on-the-clock/sleeper-sync.ts | Before release | Moderate | Open |
| FFB-SEC-004 | Commissioner authz on unverified self-declared Sleeper username | Medium | Confirmed | Moderate (needs target username) | Impersonate commissioner (bounded to force-refresh today) | lib/league-auth.ts | Soon | Moderate | Open |
| FFB-SEC-005 | Missing global security response headers | Medium | Confirmed | n/a (enabling condition) | Clickjacking, no CSP backstop | next.config.ts | Before release | Small | Open |
| FFB-SEC-006 | JSON-LD XSS via unescaped less-than in script tag | Medium | High confidence | Hard (needs poisoned upstream data) | Stored XSS on public pages | app/brief, app/players, brief-feed | Before release | Small | Open |
| FFB-SEC-007 | try_claim_league_refresh EXECUTE granted to anon/authenticated | Medium | Confirmed | Easy (direct RPC) | Rate-limit griefing, audit spoof, anon write to SR-only ledger | migration 0028 | Before release | Small | Open |
| FFB-SEC-008 | IP rate limits trust x-forwarded-for and fail open without it | Low | Confirmed | Hard on Vercel today | Rate-limit bypass under different proxy | multiple route helpers | Soon | Small | Open |
| FFB-SEC-009 | Non-constant-time CRON_SECRET compare in 7 cron routes | Low | Confirmed | Very hard (network timing) | Theoretical secret disclosure | app/api/cron/* | Soon | Small | Open |
| FFB-SEC-010 | Hard-coded fallback IP-hash salt | Low | Confirmed | Conditional (salt unset in prod) | Guest cap precomputable, IP de-pseudonymization | lib/signal-scout/route-helpers.ts | Soon | Small | Open |
| FFB-SEC-011 | Weak cross-instance limits on admin-inbox email endpoints | Low | Confirmed | Moderate | Inbox spam, email relay to arbitrary address | report-format, guide/submit | Soon | Small | Open |
| FFB-SEC-012 | user-avatars bucket has no MIME allowlist | Low | Confirmed | Moderate | Arbitrary file type upload (private bucket) | storage.buckets user-avatars | Soon | Small | Open |
| FFB-SEC-013 | Logout CSRF | Informational | Confirmed | Easy | Nuisance sign-out | app/auth/signout/route.ts | Longer-term | Small | Open |
| FFB-SEC-014 | is_admin trigger fails open on null jwt claims | Low | Confirmed | Very hard | Compounds FFB-SEC-001 | migration 0018 | Longer-term | Small | Open |
| FFB-SEC-015 | Functions with mutable search_path, pg_trgm in public | Informational | Confirmed | Very hard | Hygiene, definer-hijack surface | several functions | Longer-term | Small | Open |
| FFB-SEC-016 | Inert trigger/util SECURITY DEFINER functions callable by anon via RPC | Informational | Confirmed | n/a | Defense-in-depth | rls_auto_enable, user_preferences_block_is_admin_change | Longer-term | Small | Open |
| FFB-SEC-017 | Supabase leaked-password protection disabled | Informational | Confirmed | n/a | Weaker password hygiene | Supabase Auth | Longer-term | Small | Open |
| FFB-SEC-018 | signal_follows full graph readable by any authenticated user | Informational | Confirmed | Easy | Social-graph disclosure (by design) | migration 0063 | Longer-term | Small | Open |
| FFB-SEC-019 | Public league/draft data enumerable by id | Informational | Confirmed | Easy | Privacy (Sleeper data already public) | leagues/rosters/OG routes | Longer-term | Moderate | Open |
| FFB-SEC-020 | No response-size cap on Sleeper fetches | Informational | Confirmed | Hard | Memory pressure (trusted host) | lib/sleeper.ts | Longer-term | Small | Open |
| FFB-SEC-021 | Stray untracked HTML dumps at repo root | Informational | Confirmed | n/a | Housekeeping | grep1.json, grep2.json | Longer-term | Small | Open |

## 6. Fully detailed findings

### FFB-SEC-001: user_preferences.is_admin self-promotion via INSERT

- Severity: Critical
- Confidence: Confirmed
- Classification: OWASP A01:2021 Broken Access Control; CWE-269 Improper Privilege Management; CWE-284 Improper Access Control; Authorization; Privilege escalation.
- Affected functionality: The entire /admin surface, which is gated by user_preferences.is_admin (Beacon settings and AI prompts, Beacon Brief moderation, Signal Check admin, cron logs, Discord webhook configuration, the users table, force-refresh, and every admin API and server action).
- Affected users or data: All users and all data. An attacker who self-promotes gains admin read/write over every admin-managed table and operation.

Technical description: user_preferences has RLS enabled with owner-scoped policies. The insert_own policy (supabase/migrations/0008_user_preferences.sql:26-29) is `for insert to authenticated with check (auth.uid() = user_id)` and places no restriction on the is_admin column. The delete_own policy (0008:37-40) lets the owner delete their own row. The is_admin column was added in 0018 with `not null default false` and is protected only by trg_user_preferences_block_is_admin_change, which is defined `before update` only (0018:38-41). There is no INSERT-time guard and no column-level GRANT restricting is_admin writes. Live verification confirmed: the primary key is user_id (one row per user), the authenticated role holds table INSERT and DELETE privileges plus column INSERT on is_admin, and the only trigger on the table is the BEFORE UPDATE guard. There is no trigger on auth.users that auto-creates a preferences row, so newly registered users have no row at all and can INSERT one directly. requireAdmin (lib/admin-auth.ts:47-64) and getIsAdmin (lib/admin-auth.ts:24-36) read exactly this column to authorize the admin surface. Existing controls do not prevent the attack because the check trigger never fires on INSERT and the RLS check clause does not constrain the column.

Layman's explanation: The app decides who is an administrator by reading a single true/false flag in each user's settings row. There is a lock that stops a user from flipping that flag from false to true on an existing row. But there is no lock that stops a user from deleting their settings row and creating a brand new one with the flag already set to true. Any logged-in person can do this by talking directly to the database through the same public key the website ships to every browser. The result is that any registered user can make themselves an administrator.

Security impact: Complete administrative takeover. The attacker can read and modify AI prompts and beacon settings, moderate or publish content, read Discord webhook secret URLs, view the users table, and invoke every admin operation. From admin write access to configuration tables the blast radius extends to the integrity of rankings, values, and published content shown to all users.

Likelihood and prerequisites: Required access level is a normal registered account (email/password or OAuth). No special attacker knowledge beyond the public Supabase URL and publishable key, both of which are in the client bundle. No user interaction from a victim. IDs are not needed. Exploitation is a two-line script using the supabase-js client or curl. It can be fully automated.

Exact evidence:
- supabase/migrations/0008_user_preferences.sql:26-29 (insert_own policy, no column guard)
- supabase/migrations/0008_user_preferences.sql:37-40 (delete_own policy)
- supabase/migrations/0018_user_preferences_is_admin.sql:14-15 (is_admin column) and :38-41 (BEFORE UPDATE trigger only)
- lib/admin-auth.ts:24-64 (requireAdmin/getIsAdmin read is_admin as the authorization source)
- Live schema confirmation: authenticated has INSERT and DELETE on user_preferences and INSERT on the is_admin column; primary key is user_id; the only trigger is BEFORE UPDATE; no auth.users trigger creates the row.

Data flow or attack path:
1. Attacker registers and signs in, obtaining an authenticated JWT and the publishable key.
2. If a preferences row exists, attacker issues DELETE /rest/v1/user_preferences?user_id=eq.<self> (allowed by delete_own). A fresh account can skip this step.
3. Attacker issues POST /rest/v1/user_preferences with body {"user_id":"<self>","is_admin":true}. The insert_own check passes, no BEFORE UPDATE trigger fires on INSERT, and the column grant permits is_admin.
4. is_admin is now true; requireAdmin passes; the full admin surface is reachable.

Safe reproduction steps: Do not run against production. In a disposable Supabase branch or local stack, create a user, sign in, then with the publishable key attempt the DELETE-then-INSERT above and observe that is_admin becomes true and requireAdmin returns success. This audit deliberately did not perform the live write to avoid creating an admin row and modifying production data.

Proof or validation result: Confirmed by static policy, live GRANT, live trigger, and primary-key analysis. The live database currently shows exactly one admin among 16 users, consistent with only the legitimate owner being an admin and no active exploitation. The exploit path is proven by construction; the destructive live write was intentionally not executed.

Existing mitigations: The BEFORE UPDATE trigger blocks the simpler flip on an existing row. requireAdmin is enforced server-side (not client-only). Neither prevents the INSERT path.

Why those mitigations are insufficient: The trigger scope is UPDATE only; the RLS insert check does not constrain is_admin; and delete_own removes the only obstacle (an existing row) for accounts that already have one.

Recommended remediation: Enforce the admin-flag invariant at the database layer, which is the correct enforcement point because the attack bypasses all application code. Preferred: replace the trigger with one that fires BEFORE INSERT OR UPDATE and rejects any is_admin change or non-false insert value when the caller is not service_role. Additionally add column-level grants mirroring the signals hardening pattern: revoke INSERT and UPDATE on user_preferences from authenticated, then grant INSERT and UPDATE only on the non-admin columns to authenticated. Combining both is defense in depth. No code change to the app is strictly required, but the app should continue to rely on service-role for any legitimate admin promotion. A new migration is required. Existing sessions do not need invalidation; instead, after deploying, re-audit user_preferences to confirm the admin set. No secret rotation is required.

Alternative remediation: Move is_admin out of the user-writable table entirely into a service-role-only admins table keyed by user_id with no authenticated policies, and have requireAdmin read that table. This is more invasive but removes the shared-row hazard permanently.

Files likely requiring changes:
- supabase/migrations/0133_user_preferences_is_admin_insert_guard.sql (new): the trigger and grant hardening.
- lib/admin-auth.ts (only if the admins-table alternative is chosen).

Database or migration impact: A new migration is required. It must (a) recreate user_preferences_block_is_admin_change to also cover INSERT and reject non-service_role writes that set is_admin true, and (b) optionally apply column-level INSERT/UPDATE grants. It must not weaken existing owner policies for non-admin columns.

Test requirements: Negative test: an authenticated user attempting DELETE-then-INSERT with is_admin true is rejected or the resulting row has is_admin false. Negative test: a fresh user directly inserting is_admin true is rejected or coerced to false. Positive test: an authenticated user can still insert and update their own non-admin preferences. Positive test: service_role can still set is_admin.

Verification criteria: After the fix, a scripted authenticated attempt to set is_admin true through PostgREST (INSERT or UPDATE, with or without a prior DELETE) does not result in is_admin true; requireAdmin remains false for that user.

Regression risks: Overly broad column grants could break legitimate preference upserts (source/format persistence in app/actions/preferences.ts). Test the preference save paths after applying grants.

Remediation complexity: Small.

Recommended remediation order: Fix first and standalone. It shares no code with other findings but is the prerequisite gate for trusting the admin surface.

### FFB-SEC-002: On The Clock throttle keyed on rotating identifier enables Sleeper call amplification

- Severity: Medium
- Confidence: Confirmed
- Classification: OWASP A04:2021 Insecure Design; CWE-770 Allocation of Resources Without Limits or Throttling; CWE-799 Improper Control of Interaction Frequency; Rate limiting.
- Affected functionality: The On The Clock draft tool endpoints that fan out to Sleeper.
- Affected users or data: Site availability and cost; Sleeper egress reputation. No private data.

Technical description: The durable throttle RPC try_claim_on_the_clock_lookup keys on lower(ip || ':' || username) (supabase/migrations/0111_try_claim_on_the_clock_lookup.sql:22). Every caller places the attacker-chosen resource identifier inside that key: leagues route uses the Sleeper username, transactions route uses txns:<leagueId>, snapshot route uses snap:<draftId> (app/api/on-the-clock/leagues/route.ts:86-92, transactions/route.ts:67-80, draft/snapshot/route.ts:88-103, claim logic in lib/on-the-clock/cache.ts:90-101). Because a fresh identifier is a brand new key, the 10-second window only blocks repeats of the exact same value and never bounds the request rate from one source across different values. Worse, /api/on-the-clock/draft and /api/on-the-clock/draft/sync have no per-IP claim at all; their only limiter is the per-draft cooldown lock, which any new draft id wins. The transactions path walks up to roughly 19 to 26 weekly Sleeper endpoints per request (lib/sleeper.ts getAllSleeperTransactions), so each rotated league id triggers a multi-call fan-out plus service-role inserts into on_the_clock_lookup_attempts, which the RPC never prunes.

Layman's explanation: The tool has a speed limit, but the limit is counted separately for each league or draft you ask about. So a script that keeps asking about different leagues never trips the limit, and each question makes the server call Sleeper many times. One attacker can push a lot of traffic through to Sleeper and fill up a tracking table.

Security impact: Sleeper could rate-limit or block FF Beacon's egress, degrading the tool for everyone. Vercel compute cost rises. The lookup-attempt ledger grows without bound.

Likelihood and prerequisites: A scripted client that sets the x-requested-with: ff-beacon header (trivial) and iterates real Sleeper league/draft ids. Fully automatable. No auth required.

Exact evidence: supabase/migrations/0111_try_claim_on_the_clock_lookup.sql:22; lib/on-the-clock/cache.ts:90-101; app/api/on-the-clock/leagues/route.ts:86-92; app/api/on-the-clock/transactions/route.ts:67-80; app/api/on-the-clock/draft/snapshot/route.ts:88-103; app/api/on-the-clock/draft/route.ts; app/api/on-the-clock/draft/sync/route.ts; lib/sleeper.ts getAllSleeperTransactions.

Data flow or attack path: Attacker sends many requests, each with a different league or draft id and the required header. Each request either produces a new claimable key or hits an unthrottled route, and each triggers a Sleeper fan-out and a ledger insert.

Safe reproduction steps: In a non-production environment, send a small number (single digits) of requests with distinct valid ids and observe that each is admitted without throttling and that the lookup-attempts table gains a row per unique key. Do not run at volume against production Sleeper or the live site.

Proof or validation result: Confirmed by code trace of the key construction and route limiters.

Existing mitigations: 20-second per-call timeout, no retry storm (safeFetch returns null on failure), MAX_TRADES and empty-streak caps per response, and a feature flag that can disable the surface. The per-draft lock does collapse concurrent hits on the same draft.

Why those mitigations are insufficient: They bound each single response, not the request rate from one source across many identifiers.

Recommended remediation: Add a second, identifier-independent per-IP token bucket (for example key ip:global with a small per-minute budget) enforced in front of every Sleeper fan-out on all On The Clock routes, including /draft and /draft/sync. Add a retention or cleanup job for on_the_clock_lookup_attempts. Fix FFB-SEC-008 first so the IP used for the budget is trustworthy.

Alternative remediation: Gate the whole On The Clock surface behind authentication to attach a per-user budget.

Files likely requiring changes: lib/on-the-clock/cache.ts, app/api/on-the-clock/leagues/route.ts, transactions/route.ts, draft/snapshot/route.ts, draft/route.ts, draft/sync/route.ts, a new or extended cleanup migration.

Database or migration impact: A migration may be needed for an ip-only claim RPC and a ledger retention routine.

Test requirements: Negative test: rotating identifiers from one IP is throttled after the per-IP budget. Positive test: normal single-user usage is unaffected.

Verification criteria: A script rotating ids from one IP receives 429 after the per-IP budget; Sleeper call count per source is bounded.

Regression risks: Too tight a per-IP budget could block shared-NAT legitimate users; tune the window.

Remediation complexity: Moderate.

Recommended remediation order: Group with FFB-SEC-008 (IP trust) and FFB-SEC-003 (draft/sync).

### FFB-SEC-003: Draft-cache poisoning via unvalidated client league_id in /draft/sync

- Severity: Medium
- Confidence: Confirmed
- Classification: OWASP A04:2021 Insecure Design; A08:2021 Software and Data Integrity Failures; CWE-345 Insufficient Verification of Data Authenticity; Business logic.
- Affected functionality: The On The Clock shared draft cache and everything derived from it (Trade Analyzer pick ownership, team rollups).
- Affected users or data: All viewers of a given public draft. No private data exposure (all Sleeper-public), but shared data integrity is corrupted.

Technical description: When the caller supplies league_id and season, performDraftSync trusts them and never reconciles against the real Sleeper draft object. It claims the lock and fetches league users, rosters, and traded picks using the attacker-supplied league id, while draft picks are fetched with the real draft id. The draft object is fetched but used only for status/type/metadata, not to validate the league binding. The upsert writes sleeper_league_id, league_users, rosters, and traded_picks from the mismatched league into the single shared on_the_clock_draft_cache row keyed by sleeper_draft_id. GET /draft later re-syncs using the poisoned existing.sleeperLeagueId, so the corruption persists.

Layman's explanation: When the tool loads a draft, it also loads the league it belongs to. But it believes whatever league id the caller sends instead of checking which league the draft actually belongs to. An attacker can point a real draft at a different league, so everyone viewing that draft sees the wrong teams and rosters.

Security impact: Corrupted shared draft data for all viewers, including wrong pick ownership in the Trade Analyzer. Persistent until re-synced with a correct league binding.

Likelihood and prerequisites: A single crafted POST with a valid public draft id and a different valid league id and any 4-digit season. Automatable. No auth required.

Exact evidence: lib/on-the-clock/sleeper-sync.ts:84-137 and :167-182; app/api/on-the-clock/draft/sync/route.ts:56-79.

Data flow or attack path: Attacker POSTs {draft_id: valid public draft, league_id: different valid league, season: any}. The mismatched league's users/rosters/traded_picks are written to the draft's cache row. Viewers see the wrong data.

Safe reproduction steps: In a non-production environment, POST a draft id with a deliberately mismatched league id and confirm the cache row stores the wrong league's users/rosters. Do not poison the production cache.

Proof or validation result: Confirmed by code trace; draftObj is fetched but not used to validate the league binding.

Existing mitigations: The identifiers are validated as well-formed numeric strings, and RLS blocks direct client writes (the poisoning goes through the legitimate service-role sync path). No private data is exposed.

Why those mitigations are insufficient: Well-formedness does not prove the league belongs to the draft.

Recommended remediation: Treat client league_id and season as hints only. After fetching draftObj, use draftObj.league_id and draftObj.season as authoritative, and reject or ignore a mismatched supplied league_id before the users/rosters/traded_picks fetch and upsert.

Alternative remediation: Drop the client league_id parameter entirely and always derive it from the draft object.

Files likely requiring changes: lib/on-the-clock/sleeper-sync.ts, app/api/on-the-clock/draft/sync/route.ts.

Database or migration impact: None. Consider a one-time cleanup to re-sync any already-poisoned rows after the fix.

Test requirements: Negative test: a mismatched league_id is ignored and the authoritative draft.league_id is used. Positive test: a correct or absent league_id yields correct data.

Verification criteria: With a mismatched league_id, the stored cache row reflects the draft's true league, not the supplied one.

Regression risks: If some legitimate flow relies on passing league_id for drafts whose object lacks league_id, verify the fallback still resolves.

Remediation complexity: Moderate.

Recommended remediation order: Group with FFB-SEC-002.

### FFB-SEC-004: Commissioner authorization based on unverified self-declared Sleeper username

- Severity: Medium
- Confidence: Confirmed
- Classification: OWASP A01:2021 Broken Access Control; A07:2021 Identification and Authentication Failures; CWE-290 Authentication Bypass by Spoofing; CWE-639 Authorization Bypass Through User-Controlled Key; Authorization.
- Affected functionality: The league force-refresh endpoint and any future feature gated by canForceRefresh.
- Affected users or data: League owners. Today the impact is bounded to triggering a Sleeper resync and power-ranking recompute for a targeted league.

Technical description: user_preferences.sleeper_league_settings.username is written client-side to any string the user types, with no Sleeper handshake proving the FF Beacon account controls that Sleeper account (app/my-beacon/sleeper-leagues/save-username-form.tsx). getLeagueAdminContext then grants isCommissionerForLeague, and therefore canForceRefresh, to whoever's stored username equals the league's commissioner display_name where is_commissioner is true (lib/league-auth.ts:59-72). The code comment at lib/league-auth.ts:14-19 already acknowledges the missing sleeper_user_id and that matching is by display_name.

Layman's explanation: To act as a league's commissioner, the app checks whether your typed-in Sleeper username matches the commissioner's name on that league. But it never verifies you actually own that Sleeper account. If you know a commissioner's Sleeper display name, you can type it as yours and the app treats you as that commissioner.

Security impact: An attacker who knows a commissioner's Sleeper display name can pass the commissioner authorization gate for that league. Currently this only lets them trigger a rate-limited force-refresh. The risk grows if canForceRefresh is ever used to gate heavier or data-changing actions.

Likelihood and prerequisites: The attacker needs a registered account and the target commissioner's Sleeper display name (often public). Automatable.

Exact evidence: app/my-beacon/sleeper-leagues/save-username-form.tsx:40-52; lib/league-auth.ts:59-72; app/api/leagues/[league_id]/refresh/route.ts:63-72.

Data flow or attack path: Attacker sets their My Beacon Sleeper username to the commissioner's display name, then calls the force-refresh endpoint for that league and passes the auth gate as a commissioner.

Safe reproduction steps: In a test environment, set a second account's stored username to a known commissioner display name and confirm getLeagueAdminContext returns isCommissionerForLeague true. Do not exercise against a real user's league.

Proof or validation result: Confirmed by code trace.

Existing mitigations: The only gated action is force-refresh, which independently re-validates auth server-side and is rate-limited to once per 60 seconds per league via the refresh ledger. So the current blast radius is a targeted resync plus power-ranking recompute, not data disclosure.

Why those mitigations are insufficient: They bound the current action, not the underlying identity-spoofing weakness, which becomes dangerous if the capability is reused.

Recommended remediation: Verify Sleeper account ownership before trusting the username. Store the resolved sleeper_user_id from a verification flow and match league_users.sleeper_user_id rather than display_name. Until a verification flow exists, treat commissioner status as advisory and never gate a data-changing action on it.

Alternative remediation: Restrict force-refresh to FF Beacon admins only until Sleeper ownership verification exists.

Files likely requiring changes: lib/league-auth.ts, app/my-beacon/sleeper-leagues/save-username-form.tsx, the refresh route, and a migration if sleeper_user_id is added to user_preferences.

Database or migration impact: A migration to persist a verified sleeper_user_id may be required.

Test requirements: Negative test: a user whose stored username matches a commissioner display name but who is not verified is denied. Positive test: a verified commissioner is allowed.

Verification criteria: Commissioner authorization no longer succeeds on an unverified matching username string.

Regression risks: Existing commissioners relying on the username match would lose access until they verify; provide a migration path.

Remediation complexity: Moderate.

Recommended remediation order: After FFB-SEC-001; can group with FFB-SEC-007 since both concern the refresh feature.

### FFB-SEC-005: Missing global security response headers

- Severity: Medium
- Confidence: Confirmed
- Classification: OWASP A05:2021 Security Misconfiguration; CWE-1021 Improper Restriction of Rendered UI Layers (clickjacking); CWE-693 Protection Mechanism Failure; Configuration.
- Affected functionality: All pages, including authenticated /my-beacon and /admin surfaces.
- Affected users or data: All users.

Technical description: next.config.ts defines no headers() function and vercel.json sets none, so the site ships without Content-Security-Policy, X-Frame-Options or frame-ancestors, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy. Vercel injects HSTS on production domains automatically, but nothing else. A handful of sensitive API routes set Referrer-Policy: no-referrer and no-store locally, but there is no site-wide baseline.

Layman's explanation: Modern sites send a few safety headers that tell the browser not to let the page be embedded in a hostile frame, not to guess file types, and to limit what scripts can run. This site is not sending those, so a few classes of attack have no backstop.

Security impact: Authenticated surfaces can be framed for clickjacking. The absence of CSP means the JSON-LD XSS gap (FFB-SEC-006) has no second line of defense. No nosniff header increases content-type confusion risk.

Likelihood and prerequisites: This is an enabling condition rather than a direct exploit. Clickjacking requires luring a victim to a hostile page that frames the site.

Exact evidence: next.config.ts (no headers() present, lines 3-57); vercel.json (crons only).

Data flow or attack path: A hostile page frames an authenticated FF Beacon surface and overlays deceptive UI, or an injected script executes unrestricted because there is no CSP.

Safe reproduction steps: Fetch any page and inspect response headers to confirm the listed headers are absent. Non-destructive.

Proof or validation result: Confirmed from config; no headers() exists.

Existing mitigations: State changes use Supabase auth plus server actions and the x-requested-with guard, which bounds clickjacking impact. A few API routes set local headers.

Why those mitigations are insufficient: They are per-route, not site-wide, and do not address framing of pages or provide a CSP.

Recommended remediation: Add a headers() function in next.config.ts applying at minimum frame-ancestors 'none' (or X-Frame-Options: DENY), X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, a Permissions-Policy, and a starter Content-Security-Policy (Report-Only first to catch breakage, then enforcing). Account for next/og and inline JSON-LD scripts when authoring the CSP.

Alternative remediation: Set the headers in vercel.json instead of next.config.ts.

Files likely requiring changes: next.config.ts (or vercel.json). A new lib/security-headers.ts helper is optional.

Database or migration impact: None.

Test requirements: A response-header test asserting the headers are present on a sample of routes. Manual verification that OG images, analytics, and inline JSON-LD still function under the CSP.

Verification criteria: The listed headers appear on page responses and no functionality regresses.

Regression risks: A too-strict CSP can block analytics, inline scripts, or images. Start in Report-Only mode.

Remediation complexity: Small.

Recommended remediation order: Pair with FFB-SEC-006 so the CSP and the escaping fix land together.

### FFB-SEC-006: JSON-LD cross-site scripting via unescaped less-than in a script tag

- Severity: Medium
- Confidence: High confidence
- Classification: OWASP A03:2021 Injection; CWE-79 Improper Neutralization of Input During Web Page Generation; Injection; Data exposure.
- Affected functionality: The structured-data (JSON-LD) blocks on article, brief-listing, and player pages.
- Affected users or data: Any visitor to the affected public pages.

Technical description: Three locations render dangerouslySetInnerHTML with JSON.stringify(jsonLd) into a script type application/ld+json tag. JSON.stringify escapes quotes but not the less-than character, so a string value containing a closing script tag followed by an opening script tag terminates the JSON-LD block and injects an executing script, because HTML parsing wins over the JSON string context. The interpolated values are externally influenced: Beacon Brief titles are AI-generated from ingested X and news content, and player names, colleges, and teams come from the Sleeper dump.

Layman's explanation: The site embeds machine-readable data about each article and player inside a special script block. It does not escape one particular character. If a player name or an auto-generated article title contained a crafted snippet, it could break out of that data block and run as code in visitors' browsers. The data is not typed by random visitors, but it does come from outside sources, so a poisoned upstream item is the trigger.

Security impact: Stored XSS on public pages. An attacker who can influence an ingested title or a player field could run script in visitors' browsers, with no CSP to contain it.

Likelihood and prerequisites: The attacker cannot write these DB rows directly (RLS, service-role-only writes). They would need to poison the upstream ingestion (a crafted X/news item that steers an AI title) or a player field. This is a low-likelihood but real supply-chain-shaped trigger, which is why confidence is High rather than Confirmed for live exploitability.

Exact evidence: app/brief/[slug]/page.tsx:112 (jsonLd includes article.title from lines 77 and 102); components/beacon-brief/brief-feed.tsx:67 (breadcrumb c.label from category/tag/player/team names, line 57); app/players/[slug]/page.tsx:136 (jsonLd includes fullName, college, team).

Data flow or attack path: A poisoned upstream item yields an AI-generated title or a player field containing a script-breakout string, which is stored, then rendered unescaped into the JSON-LD script tag on every affected page.

Safe reproduction steps: In a test environment, set a test article title to a benign breakout string and confirm it escapes the JSON context in the rendered HTML. Do not inject executable payloads into production content.

Proof or validation result: Confirmed that the sink is dangerouslySetInnerHTML with JSON.stringify and no less-than escaping; live exploitation depends on upstream poisoning, which was not attempted.

Existing mitigations: RLS prevents direct row writes; the Markdown renderer and post-body renderers elsewhere are safe. There is no CSP backstop.

Why those mitigations are insufficient: The JSON-LD path bypasses the safe renderers and has no encoding for the less-than character.

Recommended remediation: Escape before injection, for example replace the less-than character with its unicode escape in the stringified output, ideally via one shared jsonLdScript helper used by every JSON-LD emitter (including the static ones for consistency). Add the CSP from FFB-SEC-005 as a backstop.

Alternative remediation: Use a vetted JSON-LD serialization helper that escapes the closing-script sequence.

Files likely requiring changes: app/brief/[slug]/page.tsx, components/beacon-brief/brief-feed.tsx, app/players/[slug]/page.tsx, a new lib/json-ld.ts helper, and optionally app/join/page.tsx and app/author/michael/page.tsx for consistency.

Database or migration impact: None.

Test requirements: A test that a title containing the closing-script sequence is escaped in the emitted HTML. Positive test that valid structured data still parses.

Verification criteria: A crafted title does not break out of the JSON-LD script block in rendered output.

Regression risks: Minimal; ensure the escaped output still validates as JSON-LD.

Remediation complexity: Small.

Recommended remediation order: Pair with FFB-SEC-005.

### FFB-SEC-007: try_claim_league_refresh EXECUTE granted to anon and authenticated

- Severity: Medium
- Confidence: Confirmed
- Classification: OWASP A01:2021 Broken Access Control; A04:2021 Insecure Design; CWE-732 Incorrect Permission Assignment for Critical Resource; CWE-639; Authorization.
- Affected functionality: The league force-refresh rate-limit ledger and audit provenance.
- Affected users or data: The league_refresh_attempts service-role-only ledger; the force-refresh feature availability.

Technical description: try_claim_league_refresh is SECURITY DEFINER and, per the live ACL, is EXECUTE-granted to anon, authenticated, and service_role. It writes the service-role-only table league_refresh_attempts and records triggered_by_user_id from the caller-supplied p_user_id with no auth.uid() validation (definition in supabase/migrations/0028_rename_league_sync_to_pulse.sql, original shape in 0026). The API handler calls it via the service-role admin client, so the anon and authenticated grants are unnecessary. A direct RPC call by any anon or authenticated user can claim or occupy the 60-second rate-limit slot for any league (denying the real admin or commissioner a refresh) and write a spoofed provenance user id into the audit ledger. Live verification confirmed the anon grant, which is broader than the migration that only mentioned authenticated.

Layman's explanation: The function that enforces the once-per-minute limit on league refreshes can be called directly by anyone, even a logged-out visitor, through the public database API. They cannot trigger the actual refresh (that is checked separately), but they can occupy the once-per-minute slot so the real commissioner gets rate-limited, and they can write a fake user id into the audit record.

Security impact: Denial of the force-refresh feature for a targeted league (griefing), pollution of the audit ledger with spoofed user ids, and unnecessary anon write access to a table intended to be service-role-only.

Likelihood and prerequisites: A single direct RPC call with the publishable key. No account needed (anon is granted). Automatable.

Exact evidence: supabase/migrations/0028_rename_league_sync_to_pulse.sql (function definition and grant); supabase/migrations/0026_try_claim_league_resync.sql:46-47 (original grant); app/api/leagues/[league_id]/refresh/route.ts:78-99 (call via service-role admin client); live ACL shows anon, authenticated, service_role can execute.

Data flow or attack path: Attacker calls POST /rest/v1/rpc/try_claim_league_refresh with a target league id and arbitrary p_user_id, claiming the window and writing a spoofed ledger row.

Safe reproduction steps: In a test environment, call the RPC as anon and observe it returns a boolean and writes a ledger row. Avoid repeatedly griefing a production league.

Proof or validation result: Confirmed by live ACL and function-body analysis.

Existing mitigations: The API handler independently re-validates admin or commissioner before performing the actual sync, so this cannot trigger the privileged refresh itself.

Why those mitigations are insufficient: The griefing and audit-integrity effects occur at the RPC layer, below the API handler.

Recommended remediation: Revoke EXECUTE on try_claim_league_refresh from anon and authenticated so only service_role (used by the handler) can call it. Additionally, derive triggered_by_user_id inside the function from auth.uid() rather than a caller argument, or drop the p_user_id parameter. The newer On The Clock and Signal Scout claim RPCs already restrict EXECUTE to service_role and are the model to follow.

Alternative remediation: Keep the grant but add an auth.uid() ownership assertion inside the function; less clean than revoking.

Files likely requiring changes: a new migration to revoke the grant and adjust the parameter handling.

Database or migration impact: A migration is required to revoke EXECUTE and, optionally, change the signature.

Test requirements: Negative test: anon and authenticated cannot execute the RPC. Positive test: the refresh endpoint still works via service_role.

Verification criteria: Direct RPC calls as anon or authenticated are denied; the refresh feature still functions.

Regression risks: Ensure the handler continues to call it with the service-role client (it does today).

Remediation complexity: Small.

Recommended remediation order: Group with FFB-SEC-004 (both concern the refresh feature).

### FFB-SEC-008: IP-based rate limits trust x-forwarded-for and fail open without it

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A04:2021 Insecure Design; CWE-348 Use of Less Trusted Source; CWE-770; Rate limiting.
- Affected functionality: Every IP-keyed rate limit and the Signal Scout guest daily cap's ip_hash component.
- Affected users or data: Rate-limit integrity.

Technical description: The clientIp and clientIpHash helpers read the leftmost x-forwarded-for entry (app/api/guide/submit/route.ts:38-43, app/api/on-the-clock/report-format/route.ts:38-43, draft/snapshot/route.ts:40-44, transactions/route.ts:42-46, leagues/route.ts:45-49, lib/signal-scout/route-helpers.ts:87-91). On Vercel the platform sets x-forwarded-for to the real client IP, so this is currently trustworthy; the risk materializes if the app is ever hosted behind a different or misconfigured proxy, where the leftmost entry becomes attacker-controlled. Separately, app/api/guide/submit/route.ts:100-120 skips its rate limit entirely when no IP resolves (a fail-open), which is unreachable on Vercel but real elsewhere. The header is used only for rate-limit keys, never for authorization, which bounds the impact.

Layman's explanation: The speed limits are counted per visitor IP, and the app reads that IP from a header. On the current host that header is set by the platform and is reliable. If the site ever moves behind a different proxy, a visitor could fake the header and dodge the limits. Also, one form skips its limit if it cannot read an IP at all.

Security impact: Under a non-Vercel proxy, self-chosen IP keys defeat every IP throttle, including the guest game cap. On Vercel today the exposure is minimal.

Likelihood and prerequisites: Requires a hosting change or misconfiguration to be exploitable; not exploitable on Vercel as deployed.

Exact evidence: the helper locations listed above; app/api/guide/submit/route.ts:100-120 (fail-open branch).

Data flow or attack path: Under a different proxy, attacker sends a self-chosen x-forwarded-for per request and rotates keys freely.

Safe reproduction steps: Inspect the helper code; no live exploit on Vercel.

Proof or validation result: Confirmed by code; platform-mitigated on Vercel.

Existing mitigations: Vercel overwrites x-forwarded-for with the real client IP; the header is never used for authorization.

Why those mitigations are insufficient: They depend on the specific host; the fail-open branch is a latent hazard.

Recommended remediation: Derive the client IP from a trusted platform header (x-vercel-forwarded-for) or take the rightmost hop, centralize this in one helper, and fail closed (or use a conservative default key) when no trusted IP resolves.

Alternative remediation: Move to authenticated per-user limits where feasible.

Files likely requiring changes: a shared lib/client-ip.ts, and the routes that currently inline the logic.

Database or migration impact: None.

Test requirements: Test that a spoofed x-forwarded-for does not change the derived key; test that a missing IP does not disable the limit.

Verification criteria: The derived key is stable against client-supplied x-forwarded-for and never fails open.

Regression risks: Ensure the trusted header is present in the target environment.

Remediation complexity: Small.

Recommended remediation order: Prerequisite for FFB-SEC-002's per-IP budget.

### FFB-SEC-009: Non-constant-time CRON_SECRET comparison in seven cron routes

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A02:2021 Cryptographic Failures (weak comparison); CWE-208 Observable Timing Discrepancy; Configuration.
- Affected functionality: Cron endpoint authentication.
- Affected users or data: The CRON_SECRET.

Technical description: Seven cron routes compare the bearer token with a plain string inequality (app/api/cron/sync-ktc/route.ts:30, sync-fantasycalc/route.ts:25, sync-dynastyprocess/route.ts:22, sync-sleeper-stats/route.ts:30, sync-sleeper-market/route.ts:37, recalculate-derived/route.ts:40, recalculate-beacon/route.ts:30). The beacon-brief and beacon-brief-worker routes already use crypto.timingSafeEqual with a length check. All routes fail closed (500) when CRON_SECRET is unset, and the secret never appears in URLs or logs.

Layman's explanation: The cron endpoints check a secret password by comparing it character by character in a way that can, in theory, leak timing information. In practice, network noise makes this attack impractical, and the secret is long and random. Two of the routes already use the safer comparison; the rest should match.

Security impact: A theoretical timing oracle against a high-entropy secret; practically negligible over the network.

Likelihood and prerequisites: Extremely low; requires precise timing across network jitter against a random secret.

Exact evidence: the seven route lines above; the safe pattern in beacon-brief/route.ts:7-12 and beacon-brief-worker/route.ts:7-12.

Data flow or attack path: Repeated timed requests to infer the secret byte by byte; impractical.

Safe reproduction steps: Code review only.

Proof or validation result: Confirmed by code.

Existing mitigations: Fail-closed on missing secret; secret not logged; high entropy.

Why those mitigations are insufficient: They do not address the comparison method itself.

Recommended remediation: Reuse the timingSafeEqual-based helper (the bearerMatches pattern already present) in all cron routes.

Alternative remediation: Centralize cron auth in a single shared verifyCron helper.

Files likely requiring changes: the seven cron routes, or a new lib/cron-auth.ts consumed by all nine.

Database or migration impact: None.

Test requirements: Test that a wrong secret is rejected and a correct secret is accepted through the shared helper.

Verification criteria: All cron routes use the constant-time helper.

Regression risks: None significant.

Remediation complexity: Small.

Recommended remediation order: Standalone.

### FFB-SEC-010: Hard-coded fallback IP-hash salt

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A02:2021 Cryptographic Failures; A05:2021 Security Misconfiguration; CWE-1188 Insecure Default; CWE-760 Predictable Salt; Configuration.
- Affected functionality: Signal Scout guest daily-round cap and guest IP pseudonymization.
- Affected users or data: Guest IP hashes.

Technical description: lib/signal-scout/route-helpers.ts:103,108 defines a public fallback salt used when SIGNAL_SCOUT_IP_SALT is unset. Because IPs are low-entropy, a public salt makes the stored guest IP hashes reversible by dictionary and the guest daily cap precomputable. The env template (.env.local.example:36-39) documents that the variable is required in production.

Layman's explanation: The game hashes guest IP addresses using a secret salt so they cannot be reversed. If that secret is not set in production, the code falls back to a value that is checked into the repo, which makes the hashes guessable and the guest limit easy to precompute.

Security impact: If the salt is unset in production, guest IP hashes are de-pseudonymizable and the guest cap is bypassable. This is conditional on the production configuration.

Likelihood and prerequisites: Only if SIGNAL_SCOUT_IP_SALT is not set in Vercel Production.

Exact evidence: lib/signal-scout/route-helpers.ts:103,108; .env.local.example:36-39.

Data flow or attack path: With the public salt, an attacker precomputes IP hashes to reverse them or to game the guest cap.

Safe reproduction steps: Confirm in the Vercel dashboard whether the variable is set (manual). Code review otherwise.

Proof or validation result: Confirmed the fallback exists; production configuration must be verified manually.

Existing mitigations: Documented requirement; used only for a rate-limit ledger, not authorization.

Why those mitigations are insufficient: A documented requirement is not an enforced one.

Recommended remediation: Confirm the variable is set in production. Consider failing closed (refuse guest rounds) in production when the salt is unset, rather than silently using the public fallback.

Alternative remediation: Generate a per-deploy random salt if unset (breaks cross-instance consistency, so prefer the env var).

Files likely requiring changes: lib/signal-scout/route-helpers.ts.

Database or migration impact: None.

Test requirements: Test that production behavior fails closed when the salt is unset.

Verification criteria: With the salt unset in a production-like build, guest rounds are refused rather than using the public salt.

Regression risks: Ensure the salt is set before enabling fail-closed to avoid blocking guests.

Remediation complexity: Small.

Recommended remediation order: Standalone; pair with the manual dashboard check.

### FFB-SEC-011: Weak cross-instance limits on admin-inbox email endpoints

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A04:2021 Insecure Design; CWE-770; CWE-799; Rate limiting.
- Affected functionality: The On The Clock report-format email endpoint and the guide submission email.
- Affected users or data: Admin inbox and Resend quota.

Technical description: app/api/on-the-clock/report-format/route.ts:36-64 uses a per-serverless-instance in-memory window (4 per 10 minutes), so cold starts and instance spread multiply the effective cap. app/api/guide/submit/route.ts additionally emails an arbitrary user-supplied address (asker confirmation, around lines 183-193), making it a small email-relay primitive bounded to 5 per 10 minutes per IP. Both are same-origin and honeypot guarded and the code documents the tradeoff.

Layman's explanation: Two endpoints send email. Their rate limits are either kept only in one server's memory (so multiple servers each allow the full amount) or can be pointed at any email address the sender types. The result is a limited spam or email-relay opportunity.

Security impact: Inbox spam to a fixed admin address, and a bounded ability to send confirmation emails to arbitrary addresses, consuming Resend quota.

Likelihood and prerequisites: A scripted client that satisfies the same-origin and honeypot checks. Bounded by the per-IP limits (which depend on FFB-SEC-008).

Exact evidence: app/api/on-the-clock/report-format/route.ts:36-64; app/api/guide/submit/route.ts:183-193.

Data flow or attack path: Repeated submissions across instances (report-format) or targeted confirmation emails (guide submit).

Safe reproduction steps: Code review; do not send bulk email against production.

Proof or validation result: Confirmed by code.

Existing mitigations: Same-origin fails closed, honeypot, per-IP DB-backed limit on guide submit, fixed recipient for report-format, documented tradeoff.

Why those mitigations are insufficient: The report-format limit is not durable across instances; guide submit can target arbitrary addresses.

Recommended remediation: Move report-format to the durable ledger pattern used elsewhere. For guide submit, cap or remove the arbitrary confirmation-email address, or verify it belongs to the submitter, and keep the durable per-IP limit (with the FFB-SEC-008 IP fix).

Alternative remediation: Require authentication for these endpoints.

Files likely requiring changes: app/api/on-the-clock/report-format/route.ts, app/api/guide/submit/route.ts.

Database or migration impact: A durable ledger table or reuse of an existing one for report-format.

Test requirements: Test that limits hold across simulated instances; test that confirmation email cannot be sent to an unrelated address at volume.

Verification criteria: The report-format limit is enforced globally; guide submit cannot be used as an open relay.

Regression risks: Ensure legitimate single submissions still send.

Remediation complexity: Small.

Recommended remediation order: Group with FFB-SEC-008.

### FFB-SEC-012: user-avatars storage bucket has no MIME allowlist

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A05:2021 Security Misconfiguration; CWE-434 Unrestricted Upload of File with Dangerous Type; Configuration.
- Affected functionality: User avatar uploads.
- Affected users or data: Avatar storage; downstream avatar rendering.

Technical description: The live storage config shows user-avatars with public = false, file_size_limit 10485760, and allowed_mime_types null (no MIME restriction), while signal-media and signal-reaction-emojis both enforce raster-only allowlists. Because user-avatars is private and served via signed URLs, the risk is lower, but the absence of a MIME allowlist permits arbitrary file types (including SVG or HTML) to be stored, which can matter depending on how avatars are later served and rendered. Write policies are correctly scoped to the user's own auth.uid() folder prefix.

Layman's explanation: Two of the three file buckets only accept safe image types. The avatar bucket accepts any file type. It is a private bucket, so the risk is limited, but it should still restrict to safe image formats.

Security impact: Arbitrary file types (potentially active content like SVG) stored in the avatar bucket; impact depends on serving and rendering, mitigated by the private bucket and signed-URL access.

Likelihood and prerequisites: An authenticated user uploading to their own folder.

Exact evidence: live storage.buckets row for user-avatars (public false, allowed_mime_types null); contrast with signal-media (image/webp, image/jpeg, image/png) and signal-reaction-emojis (image/webp).

Data flow or attack path: A user uploads a non-image file to their avatar folder; if the app ever serves it with a permissive content type, active content could execute.

Safe reproduction steps: Inspect the bucket config (done). Do not upload malicious files to production.

Proof or validation result: Confirmed by live bucket configuration.

Existing mitigations: Private bucket, signed-URL access, own-folder write scoping, and the app re-encodes images via sharp on the media path (verify avatars follow the same re-encode path).

Why those mitigations are insufficient: The bucket itself does not constrain type; defense should not rely solely on the serving layer.

Recommended remediation: Set allowed_mime_types on user-avatars to the same raster allowlist as signal-media, and confirm avatar uploads pass through a server-side re-encode to a static raster format with metadata stripped.

Alternative remediation: Keep the bucket private and ensure avatars are always served with a safe, non-executable content type and Content-Disposition.

Files likely requiring changes: a storage configuration change (dashboard or migration), and the avatar upload handler if re-encode is not already applied.

Database or migration impact: A storage bucket configuration update (can be scripted).

Test requirements: Test that a non-image upload to user-avatars is rejected.

Verification criteria: user-avatars enforces a raster MIME allowlist.

Regression risks: Ensure legitimate avatar formats are within the allowlist.

Remediation complexity: Small.

Recommended remediation order: Standalone.

### FFB-SEC-013: Logout CSRF

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A01:2021 (CSRF); CWE-352 Cross-Site Request Forgery; Authentication.
- Affected functionality: Sign-out.
- Affected users or data: Session state only.

Technical description: app/auth/signout/route.ts handles POST with no origin, x-requested-with, or CSRF-token check, so any cross-site form can sign the user out. The redirect target is fixed to the origin.

Layman's explanation: A malicious page could quietly log a visitor out of FF Beacon. It is a nuisance, not a data risk.

Security impact: Forced sign-out (denial of a convenience), no data exposure or state change beyond the session.

Likelihood and prerequisites: A victim visits a hostile page while logged in.

Exact evidence: app/auth/signout/route.ts:4-9.

Data flow or attack path: Cross-site auto-submitting form posts to the signout route.

Safe reproduction steps: Code review.

Proof or validation result: Confirmed by code.

Existing mitigations: Fixed redirect target; no further state affected.

Why those mitigations are insufficient: They do not prevent the forced logout.

Recommended remediation: Add the same-origin check used by guide/submit, or require the x-requested-with header.

Alternative remediation: Require a CSRF token.

Files likely requiring changes: app/auth/signout/route.ts.

Database or migration impact: None.

Test requirements: Test that a cross-origin POST is rejected and a same-origin logout succeeds.

Verification criteria: Cross-site logout is blocked.

Regression risks: Ensure the app's own logout button still sends the required header or origin.

Remediation complexity: Small.

Recommended remediation order: Longer-term.

### FFB-SEC-014: is_admin trigger fails open when jwt claims are null

- Severity: Low
- Confidence: Confirmed
- Classification: OWASP A01:2021; CWE-636 Not Failing Securely; Authorization; Defense in depth.
- Affected functionality: The is_admin BEFORE UPDATE guard.
- Affected users or data: The is_admin flag.

Technical description: supabase/migrations/0018_user_preferences_is_admin.sql:27-33 raises the exception only when request.jwt.claims is not null and the role is not service_role. If the claims GUC is null, the change is permitted. For normal PostgREST authenticated requests the claims are populated (role authenticated), so the UPDATE path is blocked in practice. The residual risk is any execution context that reaches the table with null claims and a non-superuser role. This is Low on its own but compounds FFB-SEC-001 because the write-time guard is the only defense and it is narrow.

Layman's explanation: The lock that stops non-admins from flipping the admin flag only engages when it can read the caller's role. In the rare case it cannot read a role, it lets the change through. Normal app requests always carry a role, so this is a defense-in-depth concern layered on top of the bigger INSERT gap.

Security impact: Weakens the admin-flag guard in unusual contexts; not exploitable by ordinary authenticated PostgREST callers.

Likelihood and prerequisites: An execution context with null claims and a non-superuser role; not the normal request path.

Exact evidence: supabase/migrations/0018_user_preferences_is_admin.sql:27-33.

Data flow or attack path: A null-claims context updates is_admin without the guard firing.

Safe reproduction steps: Code review.

Proof or validation result: Confirmed by code; not reachable by standard authenticated requests.

Existing mitigations: Normal requests carry claims; the trigger blocks them.

Why those mitigations are insufficient: The null-claims branch fails open.

Recommended remediation: Fold this into the FFB-SEC-001 fix: the rewritten INSERT-and-UPDATE guard should default to rejecting non-service_role is_admin writes rather than permitting them when claims are absent.

Alternative remediation: Explicitly treat null claims as non-service_role.

Files likely requiring changes: the FFB-SEC-001 migration.

Database or migration impact: Same migration as FFB-SEC-001.

Test requirements: Test that a null-claims non-service_role context cannot set is_admin true.

Verification criteria: The guard fails closed when claims are absent.

Regression risks: Ensure legitimate service_role operations (which may present differently) are still allowed.

Remediation complexity: Small.

Recommended remediation order: With FFB-SEC-001.

### FFB-SEC-015: Functions with mutable search_path and pg_trgm in public schema

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A05:2021; CWE-426 Untrusted Search Path; Configuration; Defense in depth.
- Affected functionality: Database hygiene.
- Affected users or data: None directly.

Technical description: The Supabase security advisor flags four functions with a mutable search_path: signal_links_valid, signal_gif_valid, bb_claim_jobs, bb_player_match_candidates. Live inspection confirms all four are SECURITY INVOKER (not definer) and are either argument-only validators or restricted to service_role EXECUTE, so there is no definer-hijack path. The advisor also flags pg_trgm installed in the public schema. These are hardening and hygiene items.

Layman's explanation: A few database helper functions and one extension are not pinned to a fixed schema. None of them run with elevated privileges in a way that could be hijacked, so this is cleanup, not an active hole.

Security impact: Minimal; a latent hygiene concern that only matters if combined with an ability to create objects in an earlier schema on the path, which authenticated users do not have by default.

Likelihood and prerequisites: Not exploitable under the current grants.

Exact evidence: Supabase advisor output (function_search_path_mutable and extension_in_public); live pg_proc config showing no search_path on the four functions; these functions are not in the SECURITY DEFINER set.

Data flow or attack path: None practical.

Safe reproduction steps: Review advisor output.

Proof or validation result: Confirmed by advisor and live function metadata.

Existing mitigations: INVOKER execution and restrictive EXECUTE grants; authenticated cannot create functions in public.

Why those mitigations are insufficient: They are sufficient today; this is proactive hardening.

Recommended remediation: Set search_path on the four functions, and move pg_trgm to an extensions schema per the Supabase guidance.

Alternative remediation: Leave as-is and document acceptance.

Files likely requiring changes: a hygiene migration.

Database or migration impact: A small migration.

Test requirements: Confirm the functions still behave after pinning search_path.

Verification criteria: The advisor no longer flags these items.

Regression risks: Moving pg_trgm requires updating references; test trigram search paths.

Remediation complexity: Small.

Recommended remediation order: Longer-term.

### FFB-SEC-016: Inert trigger and utility SECURITY DEFINER functions callable by anon via RPC

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A05:2021; CWE-732; Defense in depth.
- Affected functionality: PostgREST RPC surface.
- Affected users or data: None (calling them directly is inert).

Technical description: The advisor reports that rls_auto_enable and user_preferences_block_is_admin_change (both SECURITY DEFINER trigger or utility functions) are EXECUTE-granted to anon and authenticated and are reachable via /rest/v1/rpc. Calling them directly outside their trigger context is inert (they operate on trigger pseudo-rows), but the grants are unnecessary. signal_target_publicly_viewable is also anon-executable but must be, since it is used inside RLS policies and returns only a public-visibility boolean.

Layman's explanation: A couple of internal database helpers are technically callable through the public API. Calling them does nothing useful or harmful, but they should not be exposed.

Security impact: None practical; a tidiness and least-privilege concern.

Likelihood and prerequisites: n/a.

Exact evidence: Supabase advisor (anon_security_definer_function_executable and authenticated variant) for rls_auto_enable and user_preferences_block_is_admin_change; signal_target_publicly_viewable intentionally public.

Data flow or attack path: None meaningful.

Safe reproduction steps: Review advisor output.

Proof or validation result: Confirmed by advisor.

Existing mitigations: The functions are inert when called directly.

Why those mitigations are insufficient: Least privilege still favors revoking the grants.

Recommended remediation: Revoke EXECUTE from anon and authenticated on rls_auto_enable and user_preferences_block_is_admin_change. Leave signal_target_publicly_viewable as is (required by RLS).

Alternative remediation: Document acceptance for the inert functions.

Files likely requiring changes: a hygiene migration.

Database or migration impact: A small grant migration.

Test requirements: Confirm triggers still fire after revoking direct EXECUTE.

Verification criteria: The advisor no longer flags these two functions.

Regression risks: Revoking EXECUTE on a trigger function does not affect trigger firing; verify.

Remediation complexity: Small.

Recommended remediation order: Longer-term; can accompany FFB-SEC-015.

### FFB-SEC-017: Supabase leaked-password protection disabled

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A07:2021; CWE-521 Weak Password Requirements; Configuration.
- Affected functionality: Password sign-up and reset.
- Affected users or data: User account passwords.

Technical description: The advisor reports leaked-password protection is disabled. Enabling it checks new passwords against the HaveIBeenPwned dataset and blocks known-compromised passwords.

Layman's explanation: The sign-up flow does not currently reject passwords that are known to have leaked in past breaches. Turning on this option makes accounts harder to guess.

Security impact: Users can choose passwords already known to attackers, easing credential-stuffing.

Likelihood and prerequisites: Depends on user password choices.

Exact evidence: Supabase advisor (auth_leaked_password_protection).

Data flow or attack path: Credential-stuffing against accounts with breached passwords.

Safe reproduction steps: Check the Supabase Auth dashboard.

Proof or validation result: Confirmed by advisor.

Existing mitigations: Standard Supabase password hashing.

Why those mitigations are insufficient: They do not prevent weak or breached password choices.

Recommended remediation: Enable leaked-password protection in the Supabase Auth settings.

Alternative remediation: Enforce a strong password policy.

Files likely requiring changes: None (dashboard setting).

Database or migration impact: None.

Test requirements: Attempt to register with a known-breached password and confirm rejection.

Verification criteria: The advisor no longer flags this item.

Regression risks: Minimal.

Remediation complexity: Small.

Recommended remediation order: Longer-term.

### FFB-SEC-018: signal_follows full social graph readable by any authenticated user

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A01:2021; CWE-1230 Exposure of Sensitive Information Through Metadata; Data exposure.
- Affected functionality: The Signal follow graph.
- Affected users or data: Who follows whom.

Technical description: supabase/migrations/0063_signal_follows.sql:29-31 defines signal_follows_select_authed as for select to authenticated using (true), so any logged-in user can read the entire follower and following graph, not just their own edges. The migration header states this is intentional (follower and following lists).

Layman's explanation: Any logged-in user can see the full list of who follows whom across the site. This appears intentional for a social feature, and it is not secret data, but it is broader than showing only your own connections.

Security impact: Social-graph disclosure to any authenticated user. By design.

Likelihood and prerequisites: Any authenticated user.

Exact evidence: supabase/migrations/0063_signal_follows.sql:29-31.

Data flow or attack path: An authenticated user queries signal_follows for the whole graph.

Safe reproduction steps: Review the policy.

Proof or validation result: Confirmed by policy.

Existing mitigations: No secret data in the table.

Why those mitigations are insufficient: n/a (documented design choice).

Recommended remediation: Confirm this matches the intended product behavior. If follower and following counts should be public but edges private, scope SELECT to the user's own edges and expose aggregate counts via a view or trigger-maintained counters.

Alternative remediation: Accept as designed and document.

Files likely requiring changes: a policy migration if the design changes.

Database or migration impact: A policy migration if changed.

Test requirements: If scoped, test that a user reads only their own edges.

Verification criteria: The follow-graph visibility matches product intent.

Regression risks: Follower/following UI may rely on reading the full graph; provide counts if scoping.

Remediation complexity: Small.

Recommended remediation order: Longer-term; product decision.

### FFB-SEC-019: Public league and draft data enumerable by identifier

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A01:2021; CWE-200 Exposure of Sensitive Information; Data exposure; Privacy.
- Affected functionality: League Pulse and On The Clock public views, and the OG image routes.
- Affected users or data: Synced Sleeper league and draft data (team names, display names, rosters, transactions), for any league or draft that has been pulsed.

Technical description: leagues, rosters, league_users, league_transactions, league_power_rankings_cache, league_drafts, and the on_the_clock draft and pick caches and snapshots all have public SELECT policies (anon and authenticated using true). The OG routes under app/api/og/league, team, and trade serve this data unauthenticated via the service-role client. CLAUDE.md designates these as public read-only data, and the underlying data is already public through Sleeper's own unauthenticated API. Ids are the same numeric identifiers used publicly by Sleeper.

Layman's explanation: Anyone can look up any league or draft that the site has ever loaded, by its id, and see team names, member display names, rosters, and trades. This is the same information Sleeper already exposes publicly, and it is intended for the shared tools, so it is a privacy note rather than a leak.

Security impact: Enumerable disclosure of Sleeper-public league and draft data. No FF Beacon private data (emails, user_preferences, auth) is reachable from these queries; the OG route column lists were verified to exclude such fields.

Likelihood and prerequisites: Knowledge of a league or draft id.

Exact evidence: public SELECT policies on the listed tables (live pg_policies); app/api/og/league/[league_id]/route.tsx, team route, trade route (service-role, no auth, verified column lists exclude private data).

Data flow or attack path: An observer requests a league or draft by id and reads the public rows.

Safe reproduction steps: Request a known league id and observe public data (the same as Sleeper's public API).

Proof or validation result: Confirmed by live policies and route review.

Existing mitigations: The data is already public via Sleeper; no FF Beacon private data is exposed; OG routes for Signal correctly gate on published and public and return generic fallbacks.

Why those mitigations are insufficient: n/a for the design; documented as a privacy consideration.

Recommended remediation: Confirm this matches product intent. If any league or draft data should be private, add ownership scoping to the relevant policies and OG routes. Otherwise accept and document.

Alternative remediation: Add a robots and noindex posture for enumerable OG endpoints if indexing is a concern.

Files likely requiring changes: policy migrations and OG routes only if the design changes.

Database or migration impact: Policy migrations if scoped.

Test requirements: If scoped, test that non-owners cannot read private league data.

Verification criteria: League and draft visibility matches product intent.

Regression risks: The shared tools rely on public reads; scoping would change UX.

Remediation complexity: Moderate if changed.

Recommended remediation order: Longer-term; product decision.

### FFB-SEC-020: No response-size cap on Sleeper fetches

- Severity: Informational
- Confidence: Confirmed
- Classification: OWASP A04:2021; CWE-770; External integration.
- Affected functionality: All Sleeper API calls.
- Affected users or data: Server memory.

Technical description: lib/sleeper.ts safeFetch calls response.json() with no byte cap. The host is a fixed, trusted Sleeper endpoint, not attacker-controlled content, so the risk is low. Timeouts are present (20 seconds default, 45 for projections) and there is no retry storm.

Layman's explanation: When the server downloads data from Sleeper, it does not limit how large that download can be. Because Sleeper is a trusted source, this is a minor robustness note.

Security impact: Theoretical memory pressure if Sleeper returned an unexpectedly huge payload.

Likelihood and prerequisites: Would require Sleeper to serve an abnormally large response.

Exact evidence: lib/sleeper.ts safeFetch (json() with no size guard); timeout constants at lib/sleeper.ts:5-23.

Data flow or attack path: An oversized upstream response consumes memory.

Safe reproduction steps: Code review.

Proof or validation result: Confirmed by code.

Existing mitigations: Trusted fixed host, timeouts, no retries, per-response caps in the callers.

Why those mitigations are insufficient: They bound time and trust, not raw response size.

Recommended remediation: Add a maximum response-size guard in safeFetch (read with a byte limit and abort beyond it).

Alternative remediation: Accept given the trusted host.

Files likely requiring changes: lib/sleeper.ts.

Database or migration impact: None.

Test requirements: Test that an over-limit response is rejected.

Verification criteria: safeFetch enforces a size cap.

Regression risks: Ensure the cap exceeds the largest legitimate Sleeper payload.

Remediation complexity: Small.

Recommended remediation order: Longer-term.

### FFB-SEC-021: Stray untracked HTML dumps at repo root

- Severity: Informational
- Confidence: Confirmed
- Classification: CWE-540 Information Exposure Through Source Code (housekeeping); Configuration.
- Affected functionality: None.
- Affected users or data: None.

Technical description: grep1.json and grep2.json (untracked per git status) are saved Vercel Security Checkpoint HTML pages. They contain no credentials (only ephemeral challenge tokens) and are not committed, but they are junk containing obfuscated third-party JavaScript.

Layman's explanation: Two leftover files at the top of the project are just saved copies of a Vercel bot-check page. They hold no secrets, but they should be deleted.

Security impact: None; housekeeping.

Likelihood and prerequisites: n/a.

Exact evidence: grep1.json and grep2.json at repo root (untracked); content is a Vercel Security Checkpoint page.

Data flow or attack path: None.

Safe reproduction steps: Inspect the files (done; no secrets).

Proof or validation result: Confirmed by inspection.

Existing mitigations: Untracked, not committed.

Why those mitigations are insufficient: n/a.

Recommended remediation: Delete the files and add a gitignore entry (for example grep*.json) to prevent accidental commits. Note: deletion is outside this read-only audit's scope and is left to remediation.

Alternative remediation: Leave and ignore.

Files likely requiring changes: .gitignore (optional); delete the two files during remediation.

Database or migration impact: None.

Test requirements: None.

Verification criteria: The files are removed and ignored.

Regression risks: None.

Remediation complexity: Small.

Recommended remediation order: Longer-term.

## 7. Supabase RLS and database authorization matrix

RLS is enabled on all 79 public tables; every table has at least one policy. Legend: SR = service_role ALL with check true; public SELECT = anon and authenticated using true; own = auth.uid() ownership (directly or via a parent join); none = no policy for that role/verb (deny).

| Table / View | Sensitivity | RLS | SELECT | INSERT | UPDATE | DELETE | Anon | Authed | Admin | Primary concern | Recommended correction |
|---|---|---|---|---|---|---|---|---|---|---|---|
| format_configs | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| players | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| rankings | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| player_value_history | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| player_value_trends | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| projections | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| player_stats | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| player_market_snapshots | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| player_market_latest (view) | low | invoker | inherits base (public) | n/a | n/a | n/a | read | read | via SR | none | none |
| articles | low | yes | public where published | SR | SR | SR | read | read | via SR | drafts hidden | none |
| article_players | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| article_teams | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| article_revisions | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| vote_matchups | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| votes | med | yes | own | own | own | own | none | own | via SR | none | none |
| news_items | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| news_sources | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| news_categories | low | yes | public where active | SR | SR | SR | read | read | via SR | none | none |
| news_ingestions | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| nfl_teams | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| source_registry | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| user_preferences | high | yes | own | own (no is_admin guard) | own + UPDATE trigger | own | none | own | via SR | FFB-SEC-001, 014 | guard is_admin on INSERT; column grants |
| user_ranking_boards | med | yes | own or public-when-profile | own | own | own | conditional read | own | via SR | none | none |
| user_ranking_board_players | med | yes | own-via-board or public-when-profile | own-via-board | own-via-board | own-via-board | conditional read | own | via SR | none | none |
| beacon_custom_formats | med | yes | own | own | own | own | none | own | via SR | none | none |
| beacon_custom_value_cache | low | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_ai_cache | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_settings | high | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_signal_weights | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_value_bands | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_manual_signals | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_value_runs | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_stat_profiles | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_format_status | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| beacon_brief_queue | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_brief_moderation | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| beacon_brief_logs | high | yes | none | none | none | none / SR | none | none | via SR | raw AI prompts; SR-only correct | none |
| cron_runs | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| discord_webhooks | high | yes | none | none | none | none / SR | none | none | via SR | webhook secrets; SR-only correct | none |
| guide_pages | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| guide_entries | low | yes | public where published | SR | SR | SR | read | read | via SR | none | none |
| guide_question_submissions | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| faab_calculator_settings | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| leagues | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-019 (privacy) | product decision |
| rosters | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-019 | product decision |
| league_users | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-019 | product decision |
| league_transactions | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-019 | product decision |
| league_drafts | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-019 | product decision |
| league_power_rankings_cache | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| league_refresh_attempts | med | yes | none | none | none | none / SR | none | none | via SR | FFB-SEC-007 (RPC grant) | revoke RPC grant |
| on_the_clock_settings | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| on_the_clock_draft_cache | med | yes | public | SR | SR | SR | read | read | via SR | FFB-SEC-003 (poisoning) | validate league binding |
| on_the_clock_pick_cache | low | yes | public | SR | SR | SR | read | read | via SR | Realtime source; public data | none |
| on_the_clock_lookup_attempts | med | yes | none | none | none | none / SR | none | none | via SR | FFB-SEC-002 (growth) | retention job |
| on_the_clock_draft_snapshots | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| on_the_clock_pick_snapshots | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| signals | med | yes | public (published/public/!hidden) or own | own (col-restricted) | own (col-restricted) | own | conditional read | own | via SR | none | none |
| signal_posts | med | yes | public-if-parent-live or own | own-via-signal (col-restricted) | own (col-restricted) | own-via-signal | conditional read | own | via SR | none | none |
| signal_post_images | med | yes | public-if-parent-live or own | own-via-post | none | own-via-post | conditional read | own | via SR | none | none |
| signal_comments | med | yes | public-if-live or own or wall-owner | own (col-restricted, parent live) | own (col-restricted) | own | conditional read | own | via SR | none | none |
| signal_reactions | med | yes | own or target-viewable | own (uid + viewable + active type) | none | own | conditional read | own | via SR | none | none |
| signal_reaction_counts | low | yes | public if target viewable | none | none | none / SR | conditional read | conditional read | via SR | trigger-written | none |
| signal_reaction_types | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| signal_follows | med | yes | authenticated all | own (follower=uid) | none | own | none | full graph | via SR | FFB-SEC-018 (by design) | product decision |
| signal_reports | med | yes | own | own (uid) | none | none | none | own | via SR | status default (benign) | none |
| signal_reserved_handles | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| signal_handle_history | low | yes | public | SR | SR | SR | read | read | via SR | none | none |
| signal_check_rulesets | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_check_rules | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_check_analyses | high | yes | own | none (SR) | none | none | none | own | via SR | private; owner-scoped | none |
| signal_check_regression_cases | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_check_audit_log | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_scout_settings | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_scout_rounds | high | yes | none | none | none | none / SR | none | none | via SR | holds hidden answer; SR-only correct | none |
| signal_scout_round_clues | high | yes | none | none | none | none / SR | none | none | via SR | answer data; SR-only correct | none |
| signal_scout_guesses | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_scout_user_stats | med | yes | own | none (SR) | none | none | none | own | via SR | none | none |
| signal_scout_daily_scores | med | yes | own | none (SR) | none | none | none | own | via SR | none | none |
| signal_scout_player_overrides | med | yes | none | none | none | none / SR | none | none | via SR | none | none |
| signal_scout_activity_counters | med | yes | none | none | none | none / SR | none | none | via SR | none | none |

Storage buckets:

| Bucket | Public | Size limit | MIME allowlist | Write scope | Concern |
|---|---|---|---|---|---|
| signal-media | yes | 8 MB | webp, jpeg, png | own auth.uid() folder | none (safe raster only) |
| signal-reaction-emojis | yes | 256 KB | webp | admin/SR | none |
| user-avatars | no | 10 MB | none (null) | own auth.uid() folder | FFB-SEC-012 (add MIME allowlist) |

SECURITY DEFINER functions (all reviewed): user_preferences_block_is_admin_change (search_path public; UPDATE trigger; FFB-SEC-014/016), try_claim_league_refresh (search_path public; anon+authenticated+SR EXECUTE; FFB-SEC-007), get_my_active_sessions and account_has_password (search_path empty; auth.uid()-scoped; authenticated EXECUTE; correct), set_default_source (SR only; correct), the signal moderation and limit triggers (search_path public, pg_temp; EXECUTE revoked; correct), signal_target_publicly_viewable (public boolean; correct), claim/complete/release_on_the_clock_sync and try_claim_on_the_clock_lookup and cleanup_on_the_clock_cache (SR only after migration 0114; correct), try_claim_signal_scout_action and try_start_signal_scout_guest_round (SR only; correct), signals_guard_handle and signals_record_handle_change (SR only; correct), rls_auto_enable (anon-executable but inert; FFB-SEC-016). SECURITY INVOKER helpers bb_claim_jobs and bb_player_match_candidates and get_player_positional_finishes and signal_links_valid and signal_gif_valid: acceptable, with the search_path hygiene note in FFB-SEC-015.

Views: only player_market_latest, created security_invoker true, so base-table RLS applies to the caller. No RLS-bypassing views exist.

Policy-evolution check: no leftover over-permissive policy coexists with a stricter one. The signal-media broad public SELECT (0060) was dropped in 0065 and replaced by an owner-folder SELECT in 0077; news_categories public read (0118) is a clean drop-and-replace; the teams to nfl_teams merge (0120) renamed policies and dropped the old table; get_player_positional_finishes was replaced via create or replace (0124). No table has a stale using(true) write policy.

## 8. Endpoint security inventory

Legend: XRW = requires x-requested-with: ff-beacon header; anon client = RLS-enforced; admin client = service-role (bypasses RLS).

### Cron (all GET, all bearer CRON_SECRET, all fail closed when secret unset, all admin client, no user params)

| File | Method | Auth | Authz | Validation | Rate limit | CSRF | Sensitivity | External | Finding IDs | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| app/api/cron/sync-ktc/route.ts | GET | Bearer secret (!== compare) | cron only | none needed | Vercel schedule | n/a | low | KTC scrape | FFB-SEC-009 | fails closed |
| app/api/cron/sync-fantasycalc/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | FantasyCalc | FFB-SEC-009 | fails closed |
| app/api/cron/sync-dynastyprocess/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | DynastyProcess | FFB-SEC-009 | fails closed |
| app/api/cron/sync-sleeper-stats/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | Sleeper | FFB-SEC-009 | fails closed |
| app/api/cron/sync-sleeper-market/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | Sleeper, DP | FFB-SEC-009 | fails closed |
| app/api/cron/recalculate-derived/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | none | FFB-SEC-009 | fails closed |
| app/api/cron/recalculate-beacon/route.ts | GET | Bearer (!==) | cron | none | schedule | n/a | low | none | FFB-SEC-009 | fails closed |
| app/api/cron/beacon-brief/route.ts | GET | Bearer (timingSafeEqual) | cron | none | schedule | n/a | med | ingest/AI | none | constant-time compare |
| app/api/cron/beacon-brief-worker/route.ts | GET | Bearer (timingSafeEqual) | cron | none | schedule | n/a | med | Discord/AI | none | constant-time compare |

### Mutating and privileged routes

| File | Method | Auth | Authz | Validation | Rate limit | CSRF | Client | External | Finding IDs | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| app/api/leagues/[league_id]/refresh/route.ts | POST | getUser via league-auth, 401 | admin or commissioner, re-validated | id length cap | atomic RPC pre-sync, 60s/league | XRW | anon+admin | Sleeper | FFB-SEC-004, 007 | solid handler; commissioner check weak upstream |
| app/api/rankings/import/route.ts | GET | getUser, 401 | any signed-in | scope enum, format/source resolver | none (read, 1000 cap) | XRW | anon | none | none | public rankings; no IDOR |
| app/api/guide/submit/route.ts | POST | optional | public intake | validator, honeypot, same-origin | 5/10min per hashed IP (skips if no IP) | same-origin | admin | Resend | FFB-SEC-008, 011 | emails arbitrary address |
| app/api/on-the-clock/report-format/route.ts | POST | none | n/a | validator, honeypot, same-origin | in-memory per-instance | same-origin | none | email fixed inbox | FFB-SEC-008, 011 | non-durable limit |
| app/api/signal/report/route.ts | POST | getUser, 401 | reporter; target must be public | UUID, reason allowlist, 1000 cap | 15s/10hr/40day per reporter | XRW | admin read + anon insert | none | none | good layering |
| app/api/admin/signal/reaction-emoji/route.ts | POST | getIsAdmin, 403 | admin, before SR use | size caps, magic-byte sniff, sharp re-encode | none (admin) | n/a | admin storage | none | none | solid upload hardening |
| app/api/signal/gif/search/route.ts | GET | getUser, 401 | signed-in | query cap, offset clamp, rating locked g | in-memory per-user | XRW | anon | GIPHY (server key) | none | key never leaks |
| app/api/on-the-clock/draft/sync/route.ts | POST | none | n/a | id regexes; feature flag | per-draft lock; no per-IP | XRW | admin | Sleeper | FFB-SEC-002, 003 | poisoning + fan-out |
| app/api/on-the-clock/draft/route.ts | GET | none | n/a | id regexes; feature flag | per-draft cooldown; no per-IP | XRW | admin | Sleeper | FFB-SEC-002 | fan-out |
| app/api/on-the-clock/draft/snapshot/route.ts | GET | none | n/a | id regex, name strip+cap | per (ip, snap:draftId) 10s | XRW | admin | Sleeper | FFB-SEC-002, 008 | rotating key |
| app/api/on-the-clock/transactions/route.ts | GET | none | n/a | id regex; feature flag | per (ip, txns:leagueId) 10s | XRW | admin | Sleeper (up to ~19 calls) | FFB-SEC-002, 008 | rotating key |
| app/api/on-the-clock/leagues/route.ts | GET | none | n/a | username/season regex; flag | per (ip, username) 10s | XRW | admin | Sleeper | FFB-SEC-002, 008 | rotating key |
| app/api/on-the-clock/board/route.ts | GET | none | n/a | format slug, pool enum; flag | none (DB read) | XRW | admin | none | none | public board |
| app/actions/preferences.ts | server action | getUser | own row | slug regex + registry existence | none | server action | anon | none | none | explicit columns, no mass assignment |
| app/auth/callback/route.ts | GET | code exchange | n/a | open-redirect guard, slug regex | none | n/a | anon | none | none | safe redirect handling |
| app/auth/signout/route.ts | POST | session | n/a | none | none | none | anon | none | FFB-SEC-013 | logout CSRF |

### Signal Scout game (all XRW, admin client, ownership enforced in round-engine)

| File | Method | Auth | Rate limit | Finding IDs | Notes |
|---|---|---|---|---|---|
| app/api/games/signal-scout/round/route.ts | POST | session or httpOnly guest UUID | 5s claim + guest daily cap RPC | FFB-SEC-010 | resume avoids burning caps |
| app/api/games/signal-scout/round/[id]/route.ts | GET | ownership; bad UUID = 404 | none | none | active DTO cannot carry the answer |
| app/api/games/signal-scout/round/[id]/guess/route.ts | POST | ownership | 2s claim | none | duplicate guess 409; 3-strike bound |
| app/api/games/signal-scout/round/[id]/hint/route.ts | POST | ownership | 6s claim | none | returns only the purchased clue |
| app/api/games/signal-scout/round/[id]/skip/route.ts | POST | ownership | status-guarded | none | once per round |
| app/api/games/signal-scout/search/route.ts | GET | none | 1s claim, salted IP for cookieless | FFB-SEC-010 | round-independent, cannot leak target |
| app/api/games/signal-scout/me/stats/route.ts | GET | getUser, 401 | none | none | own row only |
| app/api/games/signal-scout/leaderboards/route.ts | GET | optional (login-gated by setting) | 2s claim per user or IP | FFB-SEC-008 | board enum + page clamp |

### Search and public read routes

| File | Method | Auth | Validation | Finding IDs | Notes |
|---|---|---|---|---|---|
| app/api/search/route.ts | GET | none (XRW) | 60-char cap, charset allowlist strips or-filter syntax, %/_ escaped, published only | none | injection-safe |
| app/api/players/search/route.ts | GET | getUser, 401 | same sanitizer, position allowlist, limit clamp | none | fine |
| app/api/breakdown/search/route.ts | GET | none (XRW) | same sanitizer, limit clamp | none | fine |
| app/api/signal-check/search/route.ts | GET | none (XRW) | same sanitizer, min length, limit clamp, format slug regex | none | fine |
| app/api/guide/[pageKey]/route.ts | GET | none | slug regex + cap | none | anon client, RLS published-only |
| app/api/guide/viewer/route.ts | GET | getUser or null | n/a | none | returns caller's own name/email only |
| app/api/rankings/import/route.ts | GET | getUser | scope enum | none | listed above |

### OG image routes (all GET, unauthenticated, admin client, nodejs runtime)

| File | Data exposed | Gating | Finding IDs | Notes |
|---|---|---|---|---|
| app/api/og/league/[league_id]/route.tsx | league name, season, top-3 teams/values | league must exist; id cap | FFB-SEC-019 | Sleeper-public only |
| app/api/og/team/[league_id]/[roster_id]/route.tsx | team name, record, values, top-5 | same | FFB-SEC-019 | same |
| app/api/og/trade/[transaction_id]/route.tsx | trade sides, verdict | tx exists, type trade | FFB-SEC-019 | same |
| app/api/og/player/[slug]/route.tsx | player name/pos/team/headshot | public players | none | none |
| app/api/og/brief/[slug]/route.tsx | article title/summary | status published | none | none |
| app/api/og/signal/[handle]/route.tsx | profile name/handle/headline/avatar | published+public+!hidden; generic fallback | none | no existence leak |
| app/api/og/signal-check/[shareId]/route.tsx | frozen public_payload only | is_public + payload | none | shareId is capability |
| app/api/og/join/route.tsx | static brand card | n/a | none | none |

## 9. Secrets and environment-variable inventory

Values are never listed. Redacted throughout.

| Name | Usage locations | Expected env | Client/server | Sensitivity | Required privilege | Validation | Rotation | Concerns |
|---|---|---|---|---|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | lib/supabase/* | all | client + server | public | none | present at build | no | none |
| SUPABASE_PUBLISHABLE_KEY | lib/supabase/client.ts, server.ts, middleware.ts; forwarded via next.config.ts:17-19 | all | client (inlined) + server | public by design | anon | non-null asserted | no | intentional, documented |
| SUPABASE_SECRET_KEY | lib/supabase/server.ts:33; scripts | server only | server | Critical | service role | non-null asserted | if leaked | correctly server-only; never forwarded |
| ANTHROPIC_API_KEY | lib/calculate-beacon-values.ts, scripts | server only | server | high | Anthropic | none | if leaked | server-only |
| CRON_SECRET | 9 cron routes | server only | server | high | cron | fail-closed if unset | if leaked | non-constant-time compare in 7 routes (FFB-SEC-009) |
| RESEND_API_KEY | lib/email/send.ts | server only | server | high | Resend | no-ops if unset | if leaked | missing from example (doc drift) |
| X_BEARER_TOKEN | lib/x.ts | server only | server | high | X API | none | if leaked | missing from example |
| GIPHY_API_KEY | app/api/signal/gif/search/route.ts | server only | server | medium | GIPHY | none | if leaked | proxied server-side |
| GITHUB_TOKEN | backfill scripts | local scripts | server | medium | GitHub | optional | if leaked | local scripts only |
| SIGNAL_SCOUT_IP_SALT | lib/signal-scout/route-helpers.ts | production required | server | medium | none | public fallback if unset | rotate if leaked | FFB-SEC-010 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Supabase dashboard | dashboard | n/a | high (secret half) | OAuth | n/a | dashboard | declared in example, unused in code |
| DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET | Supabase dashboard | dashboard | n/a | high (secret half) | OAuth | n/a | dashboard | declared in example, unused in code |
| EMAIL_FROM / EMAIL_REPLY_TO | lib/email/send.ts | server | server | low | none | none | no | missing from example |
| BEACON_BRIEF_ALERT_TO / ADMIN_NOTIFICATION_EMAIL | server | server | server | low (PII-ish) | none | none | no | missing from example |
| INDEXNOW_KEY | declared only | n/a | n/a | low | n/a | n/a | no | unused |
| NEXT_PUBLIC_SITE_URL | lib/site.ts | all | client + server | public | none | none | no | none |
| NEXT_PUBLIC_PLAUSIBLE_DOMAIN / NEXT_PUBLIC_GA4_ID | declared only | n/a | client | public | none | none | no | unused |

Exposure flags: No variable is exposed that should not be. The Discord alert webhook is stored in the DB (validated against a strict https://discord.com/api/webhooks/ regex in app/admin/system/actions.ts), not in env. Committed-secret sweep of git-tracked files found no JWTs, service-role keys, or private keys; .gitignore excludes .env and .env.* except .env.local.example, which contains only blank placeholders. No secret rotation is indicated by this audit.

## 10. Dependency and supply-chain review

- Audit commands executed: lockfile inspection via Node (package-lock.json), git ls-files for CI workflows, package.json script review. `npm audit` was not run (read-only environment; recommended for a human).
- Installed versions (package-lock.json): next 15.5.18, react and react-dom 19.2.6, @supabase/supabase-js 2.105.4, @supabase/ssr 0.10.3, zod 4.4.3, sharp 0.35.1, @anthropic-ai/sdk 0.104.1, tsx 4.22.0, vitest 4.1.9.
- Important note: next 15.5.18 is well past the critical middleware auth-bypass CVE-2025-29927 (fixed in 15.2.3) and subsequent 15.x advisories. The app does not use middleware as an authorization boundary regardless, so even the CVE class would not bypass admin gating. @supabase/ssr 0.10.x is the current cookie-handling line. sharp 0.35.1 is recent, which matters because it processes user-uploaded images in the Signal media routes.
- Supply-chain hygiene: No postinstall, preinstall, or install lifecycle scripts in package-lock.json. package.json scripts run only local project scripts (prebuild runs scripts/check-reserved-routes.ts). Every lockfile resolved URL points at registry.npmjs.org; no git or remote-tarball dependencies. No .github/workflows directory exists, so no CI secret-exposure or pull_request_target risk.
- Recommended action: Run `npm audit` periodically. Do not blanket-upgrade major versions; the tree is small and current. No dependency-driven finding is raised.

## 11. Security-header assessment

| Header | Current status | Current value | Recommended value | Reason | Compatibility concern | Finding ID |
|---|---|---|---|---|---|---|
| Content-Security-Policy | missing | none | Report-Only starter, then enforcing | Backstop for XSS (FFB-SEC-006) | Must allow next/og, inline JSON-LD, analytics | FFB-SEC-005 |
| X-Frame-Options / frame-ancestors | missing | none | DENY or frame-ancestors 'none' | Clickjacking of authed surfaces | Breaks intentional embedding if any | FFB-SEC-005 |
| X-Content-Type-Options | missing | none | nosniff | MIME sniffing | none | FFB-SEC-005 |
| Referrer-Policy | partial (some API routes) | no-referrer locally | strict-origin-when-cross-origin site-wide | Referrer leakage | none | FFB-SEC-005 |
| Permissions-Policy | missing | none | deny unused features | Least privilege for browser features | none | FFB-SEC-005 |
| Strict-Transport-Security | present (Vercel) | Vercel default on prod domain | keep; consider preload | Transport security | Confirm on custom domain | manual |
| Cross-Origin-Opener-Policy | missing | none | same-origin | Cross-window isolation | Verify OAuth popups | FFB-SEC-005 |
| Cross-Origin-Resource-Policy | missing | none | same-site or same-origin | Resource isolation | Verify OG/image consumers | FFB-SEC-005 |
| Access-Control-Allow-Origin | not set anywhere | none | keep unset | No CORS relaxation is correct | none | none (positive) |

## 12. Security test-gap analysis

Existing tests are largely unit tests over pure logic (faab, on-the-clock derivation, signal-check pipeline, signal-scout scoring, format fallback). They do not assert security controls. Missing or insufficient:

- Authentication: No test asserts that unauthenticated requests to getUser-gated routes get 401.
- Authorization / RLS: No test asserts that an authenticated user cannot set is_admin (the FFB-SEC-001 gap has no regression test), cannot read another user's user_preferences, votes, signal_check_analyses, or signal_scout stats, and cannot write is_admin on INSERT.
- Admin access: No test asserts requireAdmin redirects non-admins and that admin API routes reject non-admins server-side.
- Cross-user access: No test for IDOR on league refresh, signal report, or ranking-board writes.
- Input validation: No test asserts the search charset allowlist blocks PostgREST or-filter injection, or that Sleeper id regexes reject path-traversal-shaped input.
- Rate limiting: No test for the durable claim RPCs or the per-IP behavior (including the rotating-key weakness FFB-SEC-002 and the fail-open FFB-SEC-008).
- Cron authentication: No test asserts fail-closed on missing secret or rejection of a wrong bearer.
- CSRF: No test for the x-requested-with guard or the logout route.
- Malicious external payloads: No test that a crafted Sleeper draft_picks shape (array/object/string/null) is normalized, or that a script-breakout title is escaped in JSON-LD (FFB-SEC-006).
- Realtime isolation: No test that only public pick-cache data is published.
- Race conditions: No test for concurrent refresh claims or draft-sync locks.
- Secret handling: No test that SUPABASE_SECRET_KEY is never referenced from client components.
- Cache isolation: No test that OG routes never return private columns.

## 13. Manual verification checklist

For each item, the project owner should verify in the relevant dashboard.

- Vercel project settings: Confirm Deployment Protection on preview deployments; confirm production and preview use separate environment variable scopes.
- Vercel environment variables: Confirm SUPABASE_SECRET_KEY, CRON_SECRET, ANTHROPIC_API_KEY, RESEND_API_KEY, X_BEARER_TOKEN, GIPHY_API_KEY, and SIGNAL_SCOUT_IP_SALT are set in Production and not exposed to the client. Steps: Vercel dashboard, Project, Settings, Environment Variables; confirm each is Production-scoped and none is prefixed NEXT_PUBLIC_ except the intended public ones.
- SIGNAL_SCOUT_IP_SALT: Confirm it is set in Production (FFB-SEC-010).
- Production RLS state versus migrations: This audit verified the live database matches the migration intent (all tables RLS-on, policies present). Re-confirm after applying the FFB-SEC-001 migration.
- Supabase Auth settings: Enable leaked-password protection (FFB-SEC-017). Confirm email confirmation and OAuth redirect allowlist (redirect uri /auth/callback) are as intended. Confirm Google and Discord OAuth client secrets are configured in the dashboard.
- Email templates: Review Supabase auth email templates for correct branding and no open-redirect links.
- Redirect allowlists: Confirm the Supabase Site URL and additional redirect URLs are restricted to ffbeacon.com and intended preview hosts.
- Deployment protection: Confirm preview URLs are not publicly indexable and require auth if they render real data.
- Domain settings: Confirm HSTS applies on the custom domain and consider preload.
- Log retention: Confirm Supabase and Vercel log retention and that logs do not capture secrets (code review found none logged).
- Secret rotation history: Not required by this audit; confirm no secret was ever committed (git sweep was clean).
- Backups and point-in-time recovery: Confirm PITR is enabled for the Supabase project.
- Supabase network restrictions: Consider restricting direct database connections; the app uses PostgREST and the pooler.
- Production CORS behavior: Confirm no proxy adds permissive CORS headers (the app sets none).
- Storage: Set a MIME allowlist on user-avatars (FFB-SEC-012) via dashboard or migration.

## 14. Remediation roadmap

- Phase 0 (Emergency containment): FFB-SEC-001 (is_admin INSERT guard), folding in FFB-SEC-014 (null-claims fail-open). After deploy, re-audit the admin row set. No secret rotation needed.
- Phase 1 (Critical and high-severity authorization): FFB-SEC-007 (revoke the RPC grant), FFB-SEC-004 (commissioner verification). These depend on Phase 0 being trusted.
- Phase 2 (Database and RLS hardening): FFB-SEC-012 (avatar MIME), FFB-SEC-015 and FFB-SEC-016 (search_path and inert RPC grants), FFB-SEC-018 and FFB-SEC-019 (product decisions on graph and league visibility).
- Phase 3 (API, cron, and abuse protection): FFB-SEC-002 (per-IP budget and ledger retention), FFB-SEC-003 (draft-sync league binding), FFB-SEC-008 (IP derivation), FFB-SEC-011 (email limits), FFB-SEC-009 (cron constant-time), FFB-SEC-010 (IP salt), FFB-SEC-020 (Sleeper size cap). FFB-SEC-002 depends on FFB-SEC-008.
- Phase 4 (Browser and deployment hardening): FFB-SEC-005 (headers) and FFB-SEC-006 (JSON-LD escaping) together, FFB-SEC-013 (logout CSRF), FFB-SEC-017 (leaked-password protection), FFB-SEC-021 (stray files).
- Phase 5 (Dependency and operational security): Run npm audit; confirm dashboard items from the manual checklist.
- Phase 6 (Security tests and monitoring): Add the tests in section 12, starting with the FFB-SEC-001 regression test and cron auth tests.

Dependencies between fixes: FFB-SEC-001 and FFB-SEC-014 share one migration. FFB-SEC-002 depends on FFB-SEC-008. FFB-SEC-005 and FFB-SEC-006 pair. FFB-SEC-004 and FFB-SEC-007 both touch the refresh feature.

## 15. Complete remediation file map

### Supabase migrations (new)
- supabase/migrations/0133_user_preferences_is_admin_insert_guard.sql (new). Findings FFB-SEC-001, FFB-SEC-014. Required. Small. No dependency. Tests: is_admin INSERT/UPDATE negative tests; preference-save positive tests.
- supabase/migrations/0134_revoke_league_refresh_grant.sql (new). Finding FFB-SEC-007. Required. Small. Independent. Test: anon/authenticated cannot execute the RPC.
- supabase/migrations/0135_function_search_path_and_grants.sql (new). Findings FFB-SEC-015, FFB-SEC-016. Optional. Small. Independent.
- A storage config change for user-avatars MIME allowlist. Finding FFB-SEC-012. Required. Small.

### Authorization
- lib/league-auth.ts:59-72. Finding FFB-SEC-004. Required. Moderate. Depends on a Sleeper verification flow and possibly a user_preferences.sleeper_user_id migration. Tests: unverified username denied.
- app/my-beacon/sleeper-leagues/save-username-form.tsx:40-52. Finding FFB-SEC-004. Optional (UI side of verification). Moderate.

### Admin and application routes
- app/api/leagues/[league_id]/refresh/route.ts:78-99. Finding FFB-SEC-007 (ensure call stays service-role after grant revoke). Required. Small.
- app/api/on-the-clock/draft/sync/route.ts and lib/on-the-clock/sleeper-sync.ts:84-137,167-182. Finding FFB-SEC-003. Required. Moderate.
- app/api/on-the-clock/{leagues,transactions,draft,draft/snapshot}/route.ts and lib/on-the-clock/cache.ts:90-101. Finding FFB-SEC-002. Required. Moderate. Depends on FFB-SEC-008.
- app/api/on-the-clock/report-format/route.ts:36-64 and app/api/guide/submit/route.ts:183-193. Finding FFB-SEC-011. Optional. Small.
- app/auth/signout/route.ts:4-9. Finding FFB-SEC-013. Optional. Small.

### Server utilities
- A new lib/client-ip.ts and the route helpers that inline IP derivation (guide/submit, report-format, on-the-clock snapshot/transactions/leagues, lib/signal-scout/route-helpers.ts). Finding FFB-SEC-008. Required for FFB-SEC-002. Small.
- A new lib/cron-auth.ts (or reuse bearerMatches) consumed by the 9 cron routes. Finding FFB-SEC-009. Optional. Small.
- lib/signal-scout/route-helpers.ts:103,108. Finding FFB-SEC-010. Optional. Small.
- lib/sleeper.ts safeFetch. Finding FFB-SEC-020. Optional. Small.

### UI output encoding
- app/brief/[slug]/page.tsx:112, components/beacon-brief/brief-feed.tsx:67, app/players/[slug]/page.tsx:136, plus a new lib/json-ld.ts helper. Finding FFB-SEC-006. Required. Small.

### Configuration
- next.config.ts (add headers()). Finding FFB-SEC-005. Required. Small.
- .gitignore (add grep*.json) and delete grep1.json, grep2.json. Finding FFB-SEC-021. Optional. Small.

### Tests
- New tests under lib/ and a route-test harness per section 12. Findings FFB-SEC-001 (regression), FFB-SEC-005, FFB-SEC-006, FFB-SEC-009, and the authz/RLS gaps. Required for the controls to be durable. Moderate.

### Documentation
- docs/data-sources.md and docs/security (update with the applied fixes). Optional.

## 16. Proposed new files

- supabase/migrations/0133_user_preferences_is_admin_insert_guard.sql. Responsibility: block non-service_role is_admin writes on INSERT and UPDATE, fail closed on null claims. Findings FFB-SEC-001, FFB-SEC-014.
- supabase/migrations/0134_revoke_league_refresh_grant.sql. Responsibility: revoke EXECUTE from anon and authenticated on try_claim_league_refresh; optionally derive triggered_by_user_id from auth.uid(). Finding FFB-SEC-007.
- supabase/migrations/0135_function_search_path_and_grants.sql. Responsibility: pin search_path on the four flagged functions, revoke anon/authenticated EXECUTE on the inert trigger/util functions, and move pg_trgm to an extensions schema. Findings FFB-SEC-015, FFB-SEC-016.
- lib/client-ip.ts. Responsibility: single trusted-IP derivation helper that fails closed. Finding FFB-SEC-008.
- lib/cron-auth.ts. Responsibility: shared constant-time cron bearer verification. Finding FFB-SEC-009.
- lib/json-ld.ts. Responsibility: safe JSON-LD serialization that escapes the closing-script sequence. Finding FFB-SEC-006.
- lib/security-headers.ts (optional). Responsibility: centralized header configuration consumed by next.config.ts. Finding FFB-SEC-005.
- Security tests under lib/ and a route-test harness. Responsibility: assert the controls above. Section 12 and multiple findings.

## 17. Commands executed and results

| Command | Purpose | Result | Exit | Finding IDs | Truncated |
|---|---|---|---|---|---|
| git rev-parse HEAD; git branch --show-current; git log -1 | Identify commit and branch | f5b6986..., main, 2026-07-11 | 0 | metadata | no |
| git status --porcelain -uall | Working tree state | only grep1.json, grep2.json untracked | 0 | FFB-SEC-021 | no |
| git ls-files (routes, migrations, lib) | Inventory | 817 tracked files; 44 route files; 132 migrations | 0 | many | no |
| Read middleware.ts, lib/supabase/*, lib/admin-auth.ts, lib/league-auth.ts | Trust-boundary core | requireAdmin server-side; service-role confined | n/a | 001, 004 | no |
| head -c grep1.json grep2.json | Classify untracked files | Vercel Security Checkpoint HTML, no secrets | 0 | FFB-SEC-021 | no |
| mcp get_advisors security | Live security advisories | WARN-level only; no RLS-disabled tables | n/a | 007, 015, 016, 017 | no |
| mcp execute_sql (pg_class rowsecurity) | RLS enabled per table | all 79 tables RLS-on, each has policies | n/a | matrix | no |
| mcp execute_sql (pg_policies write+anon) | Write and anon policies | all writes SR or auth-own; no anon writes | n/a | matrix | no |
| mcp execute_sql (pg_policies SELECT own) | Owner-scoped reads | sensitive tables owner-scoped | n/a | matrix | no |
| mcp execute_sql (pg_proc prosecdef) | Definer functions | search_path and grants reviewed | n/a | 007, 015, 016 | no |
| mcp execute_sql (triggers, column grants, PK on user_preferences) | Confirm escalation | authenticated INSERT+DELETE, is_admin column INSERT grant, PK user_id, trigger BEFORE UPDATE only | n/a | 001 | no |
| mcp execute_sql (auth.users triggers) | Row auto-creation | none; fresh users have no row | n/a | 001 | no |
| mcp execute_sql (admin count) | Compromise check | 16 users, 1 admin (legitimate) | n/a | 001 | no |
| mcp execute_sql (storage.buckets, objects policies) | Storage review | user-avatars has null MIME | n/a | 012 | no |
| mcp execute_sql (views) | RLS-bypass views | only player_market_latest, security_invoker | n/a | matrix | no |
| Read next.config.ts, vercel.json, .env.local.example, .gitignore | Config review | no headers(); tight image patterns; env gitignored | n/a | 005, 010 | no |
| node lockfile inspection | Dependency versions | next 15.5.18, current tree | 0 | dependencies | no |
| Read migrations 0008, 0018, 0025, 0026 | Escalation and ledger | confirmed policy/trigger/grant shapes | n/a | 001, 007 | no |
| Four parallel read-only sub-agents | Breadth coverage | RLS matrix, endpoint inventory, OTC/Sleeper/Realtime, XSS/secrets/headers/deps | n/a | all | agent transcripts not inlined |

No secret values were printed. No write or destructive command was executed.

## 18. Audit limitations and residual uncertainty

- The live privilege-escalation (FFB-SEC-001) was proven by policy, grant, and trigger analysis, not by a live write, to honor the no-production-modification rule. The exploit is confirmed by construction; the destructive step was intentionally skipped.
- FFB-SEC-006 exploitability depends on the ability to poison upstream ingested content or a player field; that end-to-end path was not attempted, so it is rated High confidence rather than Confirmed for live exploitation.
- FFB-SEC-010 depends on the production value of SIGNAL_SCOUT_IP_SALT, which is not visible from the repository and must be checked in the dashboard.
- Vercel and Supabase dashboard settings (deployment protection, PITR, network restrictions, Auth options, environment scoping) are not repository-visible and are deferred to the manual checklist.
- The four sub-agent transcripts were consumed for findings but not inlined; their conclusions were cross-checked against direct file reads and live DB queries where feasible.
- One cross-agent discrepancy was reconciled: the leftmost x-forwarded-for concern is Low (not Medium) because Vercel overwrites that header; the residual risk is a hosting change and a fail-open branch (FFB-SEC-008).
- npm audit was not run; a human should run it to catch any transitive advisory not evident from versions.

## 19. Final remediation handoff package

This section is self-contained for a future remediation agent.

Ordered findings to fix:
1. FFB-SEC-001 (+ FFB-SEC-014) Critical, one migration.
2. FFB-SEC-007 revoke RPC grant.
3. FFB-SEC-005 + FFB-SEC-006 headers and JSON-LD escaping.
4. FFB-SEC-002 (after FFB-SEC-008) + FFB-SEC-003 On The Clock abuse and poisoning.
5. FFB-SEC-004 commissioner verification.
6. Remaining Low and Informational items.

Exact file map: see section 15. New files: see section 16.

Migration requirements: 0133 (is_admin INSERT/UPDATE guard, fail closed on null claims), 0134 (revoke try_claim_league_refresh EXECUTE from anon and authenticated; optionally derive triggered_by_user_id from auth.uid()), 0135 (search_path pinning, inert RPC grant revokes, pg_trgm relocation), plus a storage config change for user-avatars MIME. A user_preferences.sleeper_user_id migration may be needed for FFB-SEC-004.

Required tests: FFB-SEC-001 regression (authenticated cannot set is_admin via INSERT or DELETE-then-INSERT), cron fail-closed and wrong-bearer rejection, authz/RLS cross-user denials, search injection allowlist, JSON-LD escaping, draft-sync league-binding, per-IP throttle behavior. See section 12.

Environment or dashboard changes: Enable leaked-password protection; confirm SIGNAL_SCOUT_IP_SALT in Production; set user-avatars MIME allowlist; confirm PITR, deployment protection, and env scoping (section 13).

Secret rotations: None required by this audit unless FFB-SEC-001 is judged to have been actively exploited (re-audit the admin set as the follow-up; no key rotation).

Deployment sequence: Apply 0133 first and verify the admin set. Then 0134. Then the header and JSON-LD changes. Then the On The Clock and IP changes (0135 and code) together with a ledger retention job. Then FFB-SEC-004 with its verification flow.

Rollback considerations: Each migration should be reversible or paired with a down note. The is_admin guard must not block legitimate service_role promotion or normal preference upserts; test the preference save path before and after. The header CSP should ship Report-Only first.

Post-deployment verification: Re-run get_advisors; confirm the is_admin escalation is closed by a scripted authenticated attempt returning is_admin false; confirm anon cannot execute try_claim_league_refresh; confirm the headers appear; confirm a script-breakout title is escaped in JSON-LD; confirm the per-IP budget bounds Sleeper fan-out.

Findings that can be fixed together: FFB-SEC-001 + FFB-SEC-014 (one migration); FFB-SEC-005 + FFB-SEC-006 (browser hardening); FFB-SEC-002 + FFB-SEC-008 + FFB-SEC-003 (On The Clock); FFB-SEC-004 + FFB-SEC-007 (refresh feature); FFB-SEC-015 + FFB-SEC-016 (DB hygiene).

Findings that must be fixed separately: FFB-SEC-001 stands alone and first. FFB-SEC-004 requires a product decision on a Sleeper verification flow and should not be rushed with the quick wins.

Questions to answer before remediation: Is the signal_follows full-graph visibility (FFB-SEC-018) intended? Is public enumerable league and draft data (FFB-SEC-019) intended? Is there an appetite for a Sleeper account verification flow now, or should force-refresh be restricted to admins until then (FFB-SEC-004)? What CSP does next/og and the analytics stack require?

Areas where the remediation agent must re-inspect current code rather than trusting this audit blindly: the exact grant and trigger state of user_preferences at remediation time (re-query live before writing 0133); the live EXECUTE ACL of try_claim_league_refresh (confirm anon before revoking); the current On The Clock route rate-limit code (it may change); the JSON-LD emitters' current line numbers (they may drift). Line numbers in this report correspond to commit f5b698604922ed705bb8f01c60fd745f12d624bf.

End of report.
