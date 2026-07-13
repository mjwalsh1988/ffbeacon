# FF Beacon Security Remediation Report

## 1. Date

2026-07-13.

## 2. Starting commit

`f5b698604922ed705bb8f01c60fd745f12d624bf` (branch `main`) — the commit the audit was performed against. The working tree was unchanged from this commit at the start of remediation (only the two audit documents plus the stray `grep1.json`/`grep2.json` were present).

## 3. Ending state

Completed and shipped. On 2026-07-13, after owner authorization, migrations `0133`–`0138` were applied to the production Supabase project (`cilvpyivysjxpxbudkfa`) in the documented order, each verified immediately after, and the full remediation was committed and pushed to `main`. The commit hash and push result are recorded at the end of this section once known; see also section 12A "Applied migration results".

Deployment note: applying the migrations hardened the database immediately. The application-level changes (security headers, JSON-LD escaping, public-refresh route, On The Clock routes, cron auth, fail-closed Signal Scout salt, logout guard) go live when Vercel builds the pushed `main` commit.

## 3A. Applied migration results (2026-07-13)

All six migrations returned success via the Supabase MCP `apply_migration`, recorded in the migration history with their file basenames:

1. `0133_user_preferences_is_admin_write_hardening` — applied. Verified: admin_count = 1 of 10 (unchanged legitimate admin); `authenticated`/`anon` denied INSERT/UPDATE on `is_admin`; `authenticated` retains INSERT on `bio`; trigger is now `BEFORE INSERT OR UPDATE`. The `is_admin_write_hardening` harness (ephemeral users, rolled back) passed against the applied schema: INSERT/UPDATE/UPSERT/DELETE-then-INSERT with `is_admin=true` blocked, cross-user blocked, normal preference INSERT/UPDATE succeed, service_role can still set `is_admin`.
2. `0134_league_refresh_rpc_execute_hardening` — applied. Verified: `anon`/`authenticated` cannot EXECUTE `try_claim_league_refresh`; `service_role` can. The `league_refresh_rpc_grants` harness passed (first claim true, repeat false, different league independent, guest actor null).
3. `0135_on_the_clock_ip_budget` — applied. Verified: budget/cleanup RPCs are service_role-only; the `on_the_clock_rate_limits` harness passed (3-of-max then denied, per-IP independent, window reset, retention prune).
4. `0136_function_search_path_and_grants` — applied. Verified: `bb_player_match_candidates` (and the three other flagged functions) now carry `search_path=public, pg_temp`; `rls_auto_enable` EXECUTE revoked from anon/authenticated; `signal_target_publicly_viewable` anon EXECUTE intentionally retained.
5. `0137_durable_rate_limit` — applied. Verified: `try_claim_rate_limit`/`cleanup_rate_limit_hits` are service_role-only.
6. `0138_user_avatars_mime_allowlist` — applied. Verified: `user-avatars.allowed_mime_types = {image/jpeg, image/png, image/webp, image/gif}`; bucket remains private.

`get_advisors(security)` after the migrations no longer flags the four `search_path` functions, `rls_auto_enable`, or `user_preferences_block_is_admin_change`. Remaining advisor warnings are expected and out of this remediation's scope: `pg_trgm` in `public` (deferred, section 17), `signal_target_publicly_viewable` (intentional; used inside RLS), the pre-existing `account_has_password` / `get_my_active_sessions` definer functions (return only the caller's own data), and leaked-password protection (manual, section 16).

The global cache-repair `update public.on_the_clock_draft_cache set last_synced_at = null;` was NOT run: there is no evidence of poisoned rows (23 rows, all synced) and the corrected sync flow self-heals. The 60-second league refresh cooldown was left unchanged.

"Fixed" for a database finding means the migration is applied to production and verified. "Fixed" for an application-code finding means the change is committed to `main` and verified by tests/build; it goes live on the next Vercel deploy.

## 4. Findings fixed

| ID | Title | How |
|---|---|---|
| FFB-SEC-001 (Critical) | is_admin self-promotion via INSERT | Migration 0133 (trigger + column grants) |
| FFB-SEC-002 | On The Clock Sleeper amplification | Migration 0135 per-IP budget + route enforcement |
| FFB-SEC-003 | Draft-cache poisoning | Authoritative league binding in sleeper-sync.ts |
| FFB-SEC-005 | Missing security headers | next.config.ts + lib/security-headers.ts |
| FFB-SEC-006 | JSON-LD XSS | lib/json-ld.ts used by all emitters |
| FFB-SEC-007 | Refresh RPC over-granted | Migration 0134 (service_role only) |
| FFB-SEC-008 | IP rate-limit trust | lib/client-ip.ts adopted everywhere |
| FFB-SEC-009 | Non-constant-time cron auth | lib/cron-auth.ts across 9 cron routes |
| FFB-SEC-010 | Hard-coded IP salt fallback | Fail-closed in production |
| FFB-SEC-012 | user-avatars MIME allowlist | Migration 0138 |
| FFB-SEC-013 | Logout CSRF | Same-origin guard on signout |
| FFB-SEC-014 | is_admin trigger null-claims fail-open | Folded into migration 0133 (current_user based) |
| FFB-SEC-016 | Inert definer RPCs anon-executable | Migrations 0133 + 0136 revokes |
| FFB-SEC-020 | No Sleeper response-size cap | 32 MB cap in safeFetch |
| FFB-SEC-021 | Stray repo dumps | Deleted + gitignored |

## 5. Findings partially fixed

- **FFB-SEC-011** (email endpoints): report-format moved to a durable DB rate limit (migration 0137); guide/submit already had a durable per-IP limit and now uses the trusted IP. The arbitrary confirmation-email address remains bounded by that durable per-IP limit (5 per 10 minutes) rather than additionally capped or verified. Judged proportionate for a Low finding; per-address verification is documented as a future option.
- **FFB-SEC-015** (function hygiene): `search_path` pinned on the four flagged functions (migration 0136). Relocating `pg_trgm` out of the `public` schema is deferred as risky (see section 17).

## 6. Findings reclassified

- **FFB-SEC-004** (commissioner authorization): resolved by REMOVING commissioner authorization from the league-refresh flow, because league refresh is intentionally public. The unverified self-declared Sleeper-username check (`getLeagueAdminContext`) was deleted, not replaced. Sleeper account-ownership verification was intentionally NOT implemented — it is unnecessary for a public feature. The shared per-league cooldown remains the protection.

## 7. Findings deferred

- **FFB-SEC-017** (Supabase leaked-password protection): dashboard-only setting. Not changed via code. See the manual-actions checklist (section 15).

## 8. Product decisions required (no change made)

- **FFB-SEC-018** (follower graph visible to any authenticated user): appears intentional; no secret data. Documented below. No change without an explicit product decision.
- **FFB-SEC-019** (public league/draft data enumerable by id): Sleeper-public data on shareable tools. Confirmed no FF Beacon private data is exposed. Documented below. No change without an explicit product decision.

### FFB-SEC-018 — Signal follower/following graph

- Current behavior: `signal_follows_select_authed` is `for select to authenticated using (true)`, so any signed-in user can read the entire follow graph (not just their own edges). The migration header states this is intentional.
- Product consequences: follower/following lists and counts are visible site-wide to logged-in users. This is standard for a public social feature.
- What would break if restricted: any UI that renders another user's followers/following or aggregate counts would need a replacement data path.
- Possible future design: scope `SELECT` to the caller's own edges (`auth.uid() in (follower_id, following_id)`) and expose public follower/following COUNTS via a security-definer view or trigger-maintained counters, keeping counts public while making the raw edge list private.
- Decision: left as-is pending an explicit product decision.

### FFB-SEC-019 — Public league and draft data

- Current behavior: `leagues`, `rosters`, `league_users`, `league_transactions`, `league_power_rankings_cache`, `league_drafts`, and the On The Clock caches have public SELECT policies; the OG routes serve this data unauthenticated via the service role.
- Confirmed during remediation: the OG routes (`/api/og/league`, `/team`, `/trade`, `/player`, `/brief`, `/signal`, `/signal-check`) select only public fields (league/team names, display names, avatars, roster values, ranks, Sleeper `metadata`). No FF Beacon account emails, no `auth.users` metadata, no `user_preferences`, and no `is_admin` are selected. The Signal and signal-check OG routes gate on published/public flags.
- Underlying data is already public via Sleeper's unauthenticated API, and the tools are designed to be shareable.
- Decision: left as-is pending an explicit product decision. If any league/draft data should be private, add ownership scoping to the policies and OG routes.

## 9. Files changed

New files:
- `lib/client-ip.ts` — trusted client-IP derivation (FFB-SEC-008).
- `lib/cron-auth.ts` — constant-time cron bearer verification (FFB-SEC-009).
- `lib/json-ld.ts` — safe JSON-LD serialization (FFB-SEC-006).
- `lib/security-headers.ts` — centralized security headers + CSP (FFB-SEC-005).
- `lib/http-origin.ts` — same-origin guard (FFB-SEC-013).
- `lib/security/*.test.ts` — unit tests (json-ld, security-headers, client-ip, cron-auth, http-origin, sleeper-size-guard, draft-binding, is-admin-migration, league-refresh-public).
- `supabase/migrations/0133..0138` — six migrations (see section 10).
- `supabase/tests/security/*.test.sql` — three real DB integration harnesses.
- `test/server-only-stub.ts` — Vitest stub for the Next-only `server-only` module.

Modified files (application):
- `next.config.ts` — `headers()` applying the security headers.
- `app/api/leagues/[league_id]/refresh/route.ts` — public refresh; commissioner gate removed; service-role cooldown claim.
- `components/refresh-button.tsx`, `components/league-header-actions.tsx`, `lib/league-header-data.ts`, `app/leagues/[league_id]/page.tsx`, `.../teams/[roster_id]/page.tsx`, `.../transactions/page.tsx` — refresh button now public (removed the `canForceRefresh` plumbing).
- `app/api/on-the-clock/{draft,draft/sync,draft/snapshot,transactions,leagues}/route.ts`, `lib/on-the-clock/cache.ts`, `lib/on-the-clock/sleeper-sync.ts`, `lib/on-the-clock/types.ts` — per-IP budget + trusted IP + authoritative draft binding.
- `lib/sleeper.ts` — response-size cap.
- `lib/signal-scout/route-helpers.ts` — trusted IP + fail-closed salt.
- `app/api/guide/submit/route.ts`, `app/api/on-the-clock/report-format/route.ts` — trusted IP; report-format durable limit.
- `app/api/cron/*` (9 routes) — shared constant-time cron auth; `recalculate-derived` also prunes rate-limit ledgers.
- `app/brief/[slug]/page.tsx`, `app/players/[slug]/page.tsx`, `app/author/michael/page.tsx`, `components/beacon-brief/brief-feed.tsx` — JSON-LD via `serializeJsonLd`.
- `app/auth/signout/route.ts` — same-origin guard.
- `.gitignore` — `grep*.json`.
- `vitest.config.ts` — `server-only` alias for tests.

Deleted:
- `lib/league-auth.ts` — the unverified commissioner-authorization helper (only used by the public refresh flow; removed at the root per FFB-SEC-004).
- `grep1.json`, `grep2.json` — stray Vercel checkpoint dumps (FFB-SEC-021).

Modified tests:
- `app/api/on-the-clock/leagues/route.test.ts`, `.../draft/sync/route.test.ts`, `lib/signal-scout/route-helpers.test.ts` — updated to the corrected behavior (new `claimIpBudget` mock, `ipKey` argument, trusted-IP expectations).

## 10. Migrations added

All are forward-only, idempotent, schema-qualified, with `search_path` set on functions and grants explicitly managed.

1. `0133_user_preferences_is_admin_write_hardening.sql` — FFB-SEC-001, FFB-SEC-014, part of FFB-SEC-016.
2. `0134_league_refresh_rpc_execute_hardening.sql` — FFB-SEC-007 (and RPC part of FFB-SEC-004).
3. `0135_on_the_clock_ip_budget.sql` — FFB-SEC-002 (ledger retention).
4. `0136_function_search_path_and_grants.sql` — FFB-SEC-015, FFB-SEC-016.
5. `0137_durable_rate_limit.sql` — FFB-SEC-011.
6. `0138_user_avatars_mime_allowlist.sql` — FFB-SEC-012.

## 11. Tests added

Unit (Vitest, `lib/security/`): `json-ld`, `security-headers`, `client-ip`, `cron-auth`, `http-origin`, `sleeper-size-guard`, `draft-binding`, `is-admin-migration` (migration structure guard), `league-refresh-public` (route + migration guard).

Integration (SQL, `supabase/tests/security/`), exercising the real anon/authenticated/service_role roles — the security properties that mocks cannot prove:
- `is_admin_write_hardening.test.sql` — 15 assertions (INSERT/UPDATE/UPSERT/DELETE-then-INSERT blocked, cross-user blocked, trigger fires under column grant, fail-closed on null claims, service_role still works, column privileges).
- `league_refresh_rpc_grants.test.sql` — anon/authenticated EXECUTE denied, service_role works, shared cooldown semantics, guest actor null.
- `on_the_clock_rate_limits.test.sql` — budget grants, per-IP window behavior, independence, reset, retention prune.

## 12. Commands run

```
git rev-parse HEAD; git status --porcelain
npx tsc --noEmit                       # typecheck
npx vitest run                         # full unit suite
npm run build                          # production build (prebuild route check + next build)
npx next start -p 3999 ; curl -sI /    # live security-header verification
npm audit
```

Database verification used the Supabase MCP `execute_sql` with each migration wrapped in `begin; ... rollback;` so nothing persisted to production. The three SQL harnesses were run the same way and all passed.

## 13. Test results

- Vitest: 769 tests passed, 62 files (includes the new security suites).
- SQL harnesses: all assertions passed (verified against production inside rolled-back transactions).

## 14. Build result

`npm run build` succeeded (exit 0). All routes compiled; `next.config.ts` security headers compiled and were confirmed live on a production-server response.

## 15. npm audit result

5 vulnerabilities: 1 low, 4 moderate.

- `esbuild` 0.27.3–0.28.0 (low): arbitrary file read via the dev server on Windows. Transitive (test/build tooling), dev-only, not reachable in production runtime.
- `postcss` <8.5.10 (moderate): XSS via unescaped `</style>` in CSS stringify output. Transitive via Next's internal `postcss`, used at build time on our own CSS, not on attacker input. npm's only offered "fix" is a breaking Next downgrade to 9.3.3.
- `next` / `@vercel/analytics` / `geist` (moderate): flagged only because they depend on the above `postcss` resolution; not independent issues.

Triage: no targeted, non-breaking upgrade is currently appropriate. Not reachable in production; the offered remediation is a breaking downgrade. Recommendation: pick up a patched `postcss`/`esbuild` when a compatible Next patch release bundles it; do not force-downgrade Next. Per the remediation guidance, no dependency change was applied.

## 16. Manual dashboard actions still required

- **Vercel — SIGNAL_SCOUT_IP_SALT (FFB-SEC-010):** confirm it is set for the Production environment (Project, Settings, Environment Variables). The code now refuses guest Signal Scout rounds in production if it is unset. Verify: guest play works in production.
- **Supabase Auth — leaked-password protection (FFB-SEC-017):** enable in Authentication settings (HaveIBeenPwned). Verify: `get_advisors(security)` no longer flags `auth_leaked_password_protection`; registering with a known-breached password is rejected.
- **Supabase Storage — user-avatars MIME (FFB-SEC-012):** applied by migration 0138 on deploy. The allowlist is `image/jpeg, image/png, image/webp, image/gif` — exactly the raster formats the uploader advertises (GIF included so the existing GIF avatar feature keeps working; SVG/HTML/HEIC/HEIF stay blocked). If preferred as a dashboard change, set those four Allowed MIME types on the `user-avatars` bucket. Verify: `select allowed_mime_types from storage.buckets where id='user-avatars';`.
- **Supabase — post-deploy advisor re-check:** after applying 0133–0138, run `get_advisors(security)` and re-query `pg_policies` to confirm no policy was unintentionally broadened.
- **Vercel — CRON_SECRET:** unchanged; confirm it remains set (used by the shared cron auth helper).

## 17. Deployment order

1. Deploy migration **0133** (critical is_admin fix). Verify expected admin rows and preference saving (section 18).
2. Deploy migration **0134** (refresh RPC grants). Verify direct RPC denial and that guest refresh still works.
3. Deploy the **public refresh route change** (already regression-safe; the refresh button is now public). Verify guest refresh + shared cooldown.
4. Deploy migration **0135** + the On The Clock route/lib changes (per-IP budget, trusted IP, authoritative draft binding). Repair any poisoned cache rows (section 19 note).
5. Deploy **JSON-LD escaping + security headers** (application) — no migration.
6. Deploy migrations **0136, 0137, 0138** and the remaining route hardening (cron auth, email limit, salt, logout, function hygiene, avatar MIME).
7. Complete the Supabase/Vercel dashboard actions (section 16).
8. Run post-deployment verification (section 18) and monitor logs/error rates.

The critical admin migration is standalone and is not bundled with any unrelated refactor.

### Cache repair for FFB-SEC-003

The authoritative-binding fix self-heals: every resync now writes the league binding from the Sleeper draft object, so a previously poisoned `on_the_clock_draft_cache` row is corrected the next time its draft is loaded. To force healing without waiting for organic views, run this bounded, safe one-time repair (it only clears the cooldown so the next view resyncs; it deletes nothing):

```sql
update public.on_the_clock_draft_cache set last_synced_at = null;
```

## 18. Post-deployment verification steps

Admin escalation (run after 0133):
```sql
-- expected admin set (owner review): should be exactly the legitimate admin(s)
select count(*) filter (where is_admin) as admin_count, count(*) as total from public.user_preferences;
select user_id from public.user_preferences where is_admin;   -- confirm each is expected
-- privilege check
select has_column_privilege('authenticated','public.user_preferences','is_admin','INSERT') as should_be_false,
       has_column_privilege('authenticated','public.user_preferences','is_admin','UPDATE') as should_be_false_2;
```
Then run `supabase/tests/security/is_admin_write_hardening.test.sql` against the deployed DB (a branch or production; it rolls back). Confirm normal preference saving still works from `/my-beacon/profile` and the source/format toggles.

Refresh RPC (run after 0134): run `supabase/tests/security/league_refresh_rpc_grants.test.sql`. Confirm a guest (logged-out) can POST `/api/leagues/<id>/refresh` and succeed; a second immediate request for the same league returns 429; a different league is independent.

Headers + JSON-LD:
```
curl -sI https://ffbeacon.com/ | grep -iE "x-content-type-options|x-frame-options|referrer-policy|permissions-policy|content-security-policy"
```
Review CSP-Report-Only violations before switching to enforcing. Confirm a crafted `</script>` value in structured data is escaped in page source.

On The Clock: from one IP, rotating draft/league ids eventually receives 429 (or served cache on `/draft`); normal draft-room use is unaffected. A mismatched `league_id` on `/draft/sync` cannot change the stored league. Run `supabase/tests/security/on_the_clock_rate_limits.test.sql`.

## 19. Remaining security risk

- CSP is Report-Only, so it is not yet an enforcing XSS backstop. The JSON-LD escaping fix (FFB-SEC-006) is the primary control; flip CSP to enforcing after reviewing report-only violations.
- `pg_trgm` remains in the `public` schema (FFB-SEC-015). Not exploitable under current grants; relocation deferred as high-risk.
- FFB-SEC-011: the guide-submit confirmation email can still be sent to an arbitrary address, bounded by the durable per-IP limit; not additionally verified.
- Product decisions FFB-SEC-018 and FFB-SEC-019 remain as designed pending owner input.
- Manual dashboard actions (section 16) are required to fully close FFB-SEC-010 and FFB-SEC-017.
- Dependency advisories (section 15) remain until a compatible Next patch ships; not reachable in production.

## 20. Rollback considerations

- All migrations are forward-only and idempotent; none rewrite tables or perform long-blocking operations. Each migration file contains a rollback note in its header. Reverting the security migrations reopens the corresponding finding and is not recommended.
- 0133: to revert, re-grant table INSERT/UPDATE to `authenticated` and restore the BEFORE UPDATE-only trigger from 0018 (reopens the critical escalation).
- 0134: re-grant EXECUTE to `authenticated` (reopens RPC griefing/spoofing).
- 0135/0137: drop the added tables/functions (removes the abuse budget and durable email limit).
- Application changes can be reverted by restoring the files; no data migration is involved.
- No secrets were rotated (none were exposed; the audit found no evidence of compromise, and the live admin set matched the single legitimate owner).
