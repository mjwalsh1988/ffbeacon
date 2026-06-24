# Handoff: The Beacon Brief (News Curation) - IN PROGRESS

Active work: building The Beacon Brief, scoped ONLY to the "## The Beacon Brief
(News Curation System)" section of plan.md. Do not touch any other feature.

Read first: CLAUDE.md, the Beacon Brief section of plan.md, and "Phase 13 - The
Beacon Brief" in progress.md (tasks T843+).

## What this feature is (one paragraph)

Source-agnostic news curation. A curation cron (every 5 min) ingests new posts
from sources (X first) via lib/x.ts, normalizes them to BeaconBriefSourceItem,
runs an Anthropic context-score + categorize call, decides routing, and drops
slow work onto beacon_brief_queue. A worker cron (every 1 min) drains the queue
with SELECT ... FOR UPDATE SKIP LOCKED (no separate lock), throttles Discord to
~25 jobs/min, writes web-search-grounded articles, posts/patches Discord as
"Beacon Relay", and on repeated failure sends an admin email. context_score 0 =
Discord only; 1 = Discord + a Beacon Brief article. Revisions = native X edits
(deterministic) plus AI-linked same-account follow-ups. Deleted source posts go
to a moderation queue (nothing auto-deleted). A Discord shadow-mode toggle
(bb_discord_enabled) runs the whole pipeline but skips Discord.

## Status

DONE:
- T843: Migration 0081_discord_webhooks (TABLE ONLY, no seeded URL). RLS verified
  (rls_enabled=true, only *_service_role_all). Types regenerated + formatted.
- T844: Migration 0082_news_sources (source_type CHECK extensible, poll cursor +
  status, unique(source_type,handle)). RLS verified service-role-only. Types regen.
- T845: Migration 0083_news_categories (slug unique, discord_role_ids[] for group
  pings, display_order). RLS verified service-role-only. Types regen.
- T846: Migration 0084_teams (+32 NFL seeded; abbreviation matches players.team;
  discord_role_ids[]). RLS verified PUBLIC SELECT + service-role write. Types regen.
- T847: Migration 0085_article_teams (PK article_id+team_id, cascade FKs, mirrors
  article_players). RLS verified PUBLIC SELECT + service-role write. Types regen.
- T848: Migration 0086_news_ingestions (central table; UUID identity;
  UNIQUE(source_id,source_external_id) dedup net; revision self-FK; ai_result +
  context_score; status incl 'deleted'). RLS verified service-role-only. Types regen.
- T849: Migration 0087_beacon_brief_queue (job_type/status CHECKs, attempts,
  run_after, partial claim index for FOR UPDATE SKIP LOCKED). RLS verified
  service-role-only. Types regen.
- T850: Migration 0088_beacon_brief_moderation (deletion review; pending/approved/
  rejected; resolved_by). RLS verified service-role-only. Types regen.
- T851: Migration 0089_article_revisions (snapshots; unique(article_id,
  revision_number); change_summary; source_ingestion_id). RLS verified
  service-role-only. Types regen.
- T852: Migration 0090_beacon_brief_logs (10-stage CHECK, level, request/response
  payload jsonb, model, token_usage, 4 indexes). RLS verified service-role-only.
  Types regen.
- T853: Migration 0091 articles extension (added metadata jsonb, tags text[],
  category_id FK, origin default 'manual' CHECK manual/beacon_brief; article_type
  kept; RLS unchanged). Columns confirmed via information_schema. Types regen.
- T854: Migration 0092 beacon_settings bb_* rows (17 rows under category
  'beacon_brief': 4 toggles incl bb_discord_enabled shadow mode, 6 editable
  prompts, models sonnet-4-6/haiku-4-5, throttle/backoff/threshold/webhook_id).
  Types regen. ALL 12 MIGRATIONS 0081-0092 COMPLETE; npm run typecheck PASS.

- T855: MANUAL webhook insert DONE via MCP execute_sql. "News & Injuries" row id
  2de0121c-e0b0-475e-8446-ca7031550dfc, active. bb_webhook_id setting wired to it.
  Secret URL NOT stored in repo. (Insert is label-guarded / idempotent.)

DONE (libs):
- T856: lib/beacon-brief/types.ts (BeaconBriefSourceItem contract + result/queue types).
- T857: lib/x.ts (X v2 client; getXUserByUsername / getXUserTweets / getXTweetsByIds).
- T858: lib/discord.ts (post/patch webhook; Beacon Relay identity; roles-only
  allowed_mentions; DiscordResult with status + retryAfterMs).
- T859: lib/beacon-brief/ai.ts (logBeaconBrief logger; runStructuredCall;
  runWebSearchResearch) + settings.ts (loadBeaconBriefSettings). WATCH: confirm
  web_search_20260209 literal compiles under @anthropic-ai/sdk 0.104.1 at batch typecheck.

- T860: lib/beacon-brief/ingest-x.ts (normalizeTimeline + fetchSourceItems).
- T861: lib/beacon-brief/curate.ts (runCuration fast path; revision detection;
  inline categorize + resolveRefs; routes -> queue; cursor advance). ai_result is
  stored as {...categorize, resolved:{categoryId,playerIds,teamIds,roleIds}} so the
  worker/discord jobs read resolved ids without re-resolving.
- T862: lib/beacon-brief/worker.ts (runWorker; bb_claim_jobs RPC SKIP LOCKED claim;
  discord cap; all 4 handlers incl discord_patch retract; 2-step article_write;
  backoff + fail->email). REQUIRED migration 0093_bb_claim_jobs applied (13 migrations
  total now: 0081-0093). Types regen.
- T863: lib/beacon-brief/deletion.ts (handleDeletionCheck + approveDeletion/
  rejectDeletion for the admin Moderation action).
- T868 (done early, worker dep): lib/beacon-brief/email.ts sendBeaconBriefFailureEmail.

ALL LIBS COMPLETE. npm run typecheck PASS. All lib files prettier-formatted.

DONE (crons + CLI):
- T864/T865: cron routes app/api/cron/beacon-brief + beacon-brief-worker (Bearer
  CRON_SECRET; recordCronRun -> runCuration / runWorker).
- T866: CronJobName union + CRON_JOBS registry + vercel.json (curation */5, worker
  every minute).
- T867: scripts/beacon-brief.ts + npm run beacon-brief. SMOKE TEST PASSED at runtime
  (0 sources/0 jobs no-op) -> full lib wiring + tsx @/ alias + bb_claim_jobs RPC work.

DONE (admin, part 1):
- T869: admin-nav entries (Beacon Brief + System Settings) + path-boundary active
  fix; beacon-brief subnav registry + component + page shell.
- T870: System Settings webhooks (page redirect, webhooks page with masked URL hint,
  system actions.ts CRUD, webhooks-manager client). URL never sent to client.
- app/admin/beacon-brief/actions.ts: ALL beacon-brief actions (sources, categories,
  article content + assignments, moderation approve/reject).
- T871: Overview page (stats, last runs, recent logs).
- T872: Sources page + sources-manager.
- T873: Categories page + categories-manager.

- T874: Articles page + articles-manager (filters, content + assignments editing,
  player search, team checkboxes, revision history). Added searchPlayers +
  getArticleDetail actions.
- T875: Moderation page + manager (approve/reject).
- T876: Logs page (filters + details disclosure).
- T877: Settings page (SettingField reuse + WebhookSelectField).

ALL CODING COMPLETE. npm run typecheck PASS, npm run build PASS, smoke test green.

PHASE 13b (owner-approved fixes) DONE: curation safeguard (cold-start watch-from-now,
bb_backfill_count, per-run item budget bb_max_items_per_run, incremental cursor advance,
age cutoff bb_max_post_age_minutes), migrations 0094 (settings + bb_enabled=false) + 0095
(pg_trgm indexes), resolveRefs batched, worker uses bb_article_jobs_per_run, constant-time
cron compare, widened webhook regex, a11y (h4->h3, moderation article link, player-search
aria-live, disabled source-type select). typecheck + build PASS. SYSTEM IS OFF (bb_enabled=false).
RE-REVIEW (T883) DONE: 3 agents, NO Blockers. Impl all reqs MET + cursor verified; perf prior
findings resolved + 1 Important (player OR over-match/truncation) FIXED via token-scaled limit;
a11y 3 fixes verified. typecheck PASS. THE BEACON BRIEF IS COMPLETE and OFF (bb_enabled=false).
PHASE 13c (owner-approved deferred minor fixes) DONE this session: (T884) curate cursor fixes -
failed item no longer advances the cursor past itself (source stops for the run, retries next poll;
unique constraint dedupes), and the redundant final last_cursor write is gone (incremental advance
owns it; final UPDATE writes cursor only on a cold start with nothing to process). (T885) articles
editor a11y - "x" remove button is a 44x44 target, Teams/Players are fieldset/legend groups, action
status uses polite (success) + assertive role=alert (failure) regions, Revision history h3 -> h2.
(T886) logs jsonb lazy-load - list query selects metadata + existence probes only; LogPayloads
client component fetches each row's jsonb on first expand via getBeaconBriefLogPayload action.
(T887) worker reliability + Discord pacing - migration 0096 adds bb_worker_max_runtime_ms(50000),
bb_stale_processing_minutes(10), bb_discord_pace_ms(1000) (data rows, no schema change/no type
regen); worker now reaps stale 'processing' jobs via failOrRetry, honors a soft wall-clock deadline
(releases unreached claimed jobs back to pending), and paces consecutive Discord sends. typecheck +
build PASS. SYSTEM STILL OFF (bb_enabled=false confirmed).
PHASE 13c REVIEW (T888) DONE: a11y + perf sub-agents scoped to ONLY the T884-T887 changes, NO Blockers.
Fixed the surfaced Important items + nits: log-payloads <pre> is keyboard-scrollable (tabIndex=0 +
aria-label), dropped the misleading aria-live (kept aria-busy), added a fetch error state; worker
failOrRetry now guards every transition with status='processing' (+ stale cutoff for the reaper) and
returns "lost" on a concurrent transition, closing the reap-vs-reclaim double-attempt/double-email
race; reaper select bounded (order + limit 200). typecheck + build PASS.
STILL DEFERRED / DOCUMENTED (reviewers rated acceptable, intentionally NOT changed):
- cold-start backfill capped at 20 by the X timeline page size (acceptable; documented).
- a poison item that throws on every run permanently stalls its source (the cursor never advances
  past it). Bounded: processItem swallows most soft failures, so only an uncaught DB/network error
  throws. A future per-item attempt cap on news_ingestions would quarantine it instead of stalling.
- logs page uses two id-only existence probes (one extra round trip, bounded to 100 ids); per-item
  cursor UPDATE fires even on pure dedupes (N small no-op writes per run).
PHASE 13d (owner-approved) DONE this session - CONFIDENT reference matching + match moderation. The
old substring resolveRefs (over-linked ambiguous names, false substring matches, silent drops) is
GONE. New behavior: only AUTO-LINK an exact, unambiguous match; everything else -> moderation +
per-run digest email; never link a guess. Pieces:
- Migrations: 0097 extends beacon_brief_moderation (type CHECK adds player_match/team_match; new
  raw_name + candidates jsonb; idx_type_status; article_id already nullable). 0098 RPC
  bb_player_match_candidates (index-assisted trigram top-N, active-first; output col 'pos' since
  'position' is reserved). 0099 settings bb_match_similarity_threshold(0.3) + bb_match_candidate_limit(8).
  Types regenerated.
- lib/beacon-brief/match.ts: normalizeName (lowercase, strip punctuation, collapse ws, drop jr/sr/ii-v);
  teams exact abbrev/name only (else moderation w/ dice-ranked suggestions); players exactly one CURRENT
  (active/ir) normalized-exact -> link, multiple -> disambiguate by referenced team (one -> link else
  moderation), none -> moderation w/ trigram suggestions. Returns confident ids + pending[].
- curate.ts uses matchReferences; stores ai_result.resolved (worker reads, unchanged shape) + .pending;
  when an article is created, openMatchModeration inserts one moderation row per non-confident ref
  (article_id null) and one batched digest email per run (sendBeaconBriefMatchDigestEmail).
- worker.ts backfills article_id onto those moderation rows after the article is written.
- email.ts sendBeaconBriefMatchDigestEmail (one digest/run, to michael@ffbeacon.com, branded shell).
- Admin: lib/beacon-brief/match-resolution.ts (resolve/dismiss; writes article_players/article_teams,
  guards pending+type+article_id), actions resolveMatch/dismissMatch, moderation-manager.tsx renders
  deletion vs match (candidate buttons + player search / team select + dismiss; dual polite/assertive
  status; 44px; fieldset/legend; aria-live results). moderation/page fetches the union + teams.
typecheck + build PASS. SYSTEM STILL OFF (bb_enabled=false confirmed). NOTE: matcher not yet exercised
live (system off); verified via RPC SQL smoke test + typecheck/build.
PHASE 13d REVIEW (T898) DONE: impl + perf + a11y sub-agents scoped to ONLY this change, NO Blockers.
Fixed all 3 Important + 3 cheap Minors: (perf) migration 0100 adds an exact case-insensitive tie-break
to bb_player_match_candidates ORDER BY so an exact match is never crowded out of the top-N by a common
surname (verified exact-first); (a11y) player-search result buttons now use the real 44px btnClass +
aria-busy while searching; (impl) worker failOrRetry closes an ingestion's pending null-article
player_match/team_match rows when its article_write job fails, so they never strand unresolvable;
(minor) dedupeNames keys on normalizeName; (minor) moderation page query bounded .limit(500). Verified
article_players/article_teams composite PKs back the resolution upsert (no change needed). typecheck +
build PASS. Documented Minors not fixed: focus not restored after an item resolves (announcement fires;
matches existing pattern); one sequential RPC per player name (fine at cron cadence). SYSTEM STILL OFF.
TO GO LIVE: add sources in admin, set bb_webhook_id + Discord role ids on categories/teams, flip
bb_enabled=true, deploy (Vercel crons activate). Consider testing with bb_discord_enabled=false first.

EARLIER: T878 review agents (4 independent, Beacon-Brief-scoped). NO Blockers.
Findings surfaced to owner; awaiting fix decisions (no silent auto-fix of majors).
Key Important items if approved to fix:
- a11y: articles editor h4->h3 (heading skip); moderation page render the (already
  computed) article link before destructive approve; player search results need an
  aria-live region + empty-state; sources source-type select is dead (disable it).
- perf: add pg_trgm GIN index on players.full_name + teams.name and batch resolveRefs
  lookups; cap curation items per run + advance cursor incrementally; make worker
  heavy-bucket limit a setting; logs page lazy-load jsonb payloads.
- security (minor): constant-time cron compare; widen webhook host regex. + articles-manager (filter by status/category/player/team; edit
  content via updateArticleContent + assignments via updateArticleAssignments; show
  article_revisions history). Server page loads articles + categories + (players/teams for pickers).
- T875 Moderation page + manager (approveModeration/rejectModeration).
- T876 Logs page (data-heavy; filters stage/level; show request/response payloads; a11y focus).
- T877 Settings page (reuse SettingField + updateBeaconSetting from app/admin/beacon/actions
  for bb_* rows; custom webhook <select> field for bb_webhook_id populated from discord_webhooks).
- Then T878 review agents. DELETE .regen-types.mjs before review.
- Admin actions already exist for all of the above in app/admin/beacon-brief/actions.ts
  and app/admin/system/actions.ts.
- Admin patterns: requireAdmin() from @/lib/admin-auth; colocated actions.ts
  ("use server", ActionResult/fail, createAdminClient, revalidatePath); add tab to
  NAV_ITEMS in components/admin-nav.tsx; subnav modeled on components/admin/beacon-subnav.tsx
  + a new lib/beacon-brief-admin-nav.ts; settings page mirrors
  app/admin/beacon/settings + components/admin/setting-field.tsx (category 'beacon_brief').
- DELETE temp helper .regen-types.mjs before the review phase.
  T860 ingest-x -> T861 curate -> T862 worker -> T863 deletion, then crons
  (T864-867), email (T868), admin (T869-877), review (T878).
- Typecheck will be run at the end of the libs batch (not after every file).
- All 12 migrations 0081-0092 applied + verified; webhook seeded; types green.

## Migration verification snapshot (all via MCP execute_sql)
- discord_webhooks, news_sources, news_categories, news_ingestions,
  beacon_brief_queue, beacon_brief_moderation, article_revisions,
  beacon_brief_logs: rls_enabled=true, ONLY <table>_service_role_all policy.
- teams, article_teams: rls_enabled=true, <table>_select_public (anon+authed read)
  + <table>_service_role_all. teams seeded 32 rows.
- news_ingestions has UNIQUE(source_id, source_external_id). beacon_brief_queue has
  the partial claim index where status='pending'.
- articles gained metadata/tags/category_id/origin (information_schema confirmed).
- T855 manual MCP insert of the "News & Injuries" webhook row (URL from owner;
  NEVER put it in a migration file).
- Then libs (T856-T863), crons + CLI (T864-T867), email (T868), admin UI
  (T869-T877), final review sub-agents (T878).

## Conventions to follow every task (verified against the codebase)

- Migrations: write supabase/migrations/00NN_name.sql AND apply via MCP
  apply_migration. Latest existing pre-feature was 0080; Beacon Brief starts 0081.
- RLS in the SAME migration. Patterns:
  - service-role-only table: enable RLS, single policy
    `<table>_service_role_all for all to service_role using(true) with check(true)`,
    no anon/authed policies (see 0032_cron_runs.sql).
  - public-read table (teams, article_teams): add
    `<table>_select_public for select to anon, authenticated using(true)`
    plus the service_role_all policy (see 0005_articles.sql).
  - Add an access-matrix comment block at the top of every migration.
- After EVERY migration: regenerate types via MCP generate_typescript_types.
  Output is JSON-wrapped and too big for context: it saves to a tool-results
  .txt file; extract the `.types` field to lib/database.types.ts with a tiny
  Node script (python3 is NOT available on this machine), then
  `npx prettier --write lib/database.types.ts`, then delete the temp script.
- Verify RLS via MCP execute_sql against pg_class/pg_policy after applying.
- Admin CRUD = colocated `actions.ts` Server Actions ("use server"), each calls
  `await requireAdmin("/admin/...")` FIRST, writes via `createAdminClient()`
  (lib/supabase/server.ts), returns `ActionResult = {ok:true}|{ok:false,error}`
  via a `fail()` helper, then `revalidatePath(...)`. Mirror app/admin/beacon/actions.ts.
- Admin top-level tab: add to NAV_ITEMS in components/admin-nav.tsx (+ lucide
  icon import). Sub-nav: new lib/beacon-brief-admin-nav.ts + a subnav component
  modeled on components/admin/beacon-subnav.tsx.
- Settings: rows in beacon_settings (key/value jsonb/value_type/category/label/
  description), category 'beacon_brief', edited with components/admin/setting-field.tsx
  pattern. No new constants hardcoded.
- Service client for pipeline/cron/scripts: createAdminClient() in routes;
  scripts/_supabase.ts getServiceClient() in tsx scripts.
- Cron route auth: Bearer CRON_SECRET (see app/api/cron/sync-ktc/route.ts);
  wrap work in recordCronRun(name, fn) from lib/cron-runs.ts and add the name to
  CRON_JOBS there + to vercel.json.
- External API client: copy lib/sleeper.ts safeFetch shape (AbortController
  20s timeout, try/catch -> null, no throw). X needs Authorization: Bearer
  ${X_BEARER_TOKEN}. Add lib/x.ts.
- Email: reuse lib/email/ (Resend); needs RESEND_API_KEY + verified sender,
  no-ops silently if unset.
- Screen-reader-first UI: semantic HTML, aria-live announcers
  (components/admin/admin-controls.tsx useAdminAnnouncer), 44px targets,
  no data hidden at any breakpoint. NO em-dashes / AI-tell punctuation anywhere.
- One shell command per Bash call (no && chaining for batching).

## Verification gate (every session)

`npm run typecheck` then `npm run build` (prebuild runs the reserved-route guard).
Commit to main, do not push (only when the owner asks). Env present in .env.local:
X_BEARER_TOKEN, X_API_KEY, X_API_SECRET, ANTHROPIC_API_KEY, DISCORD_*,
RESEND_API_KEY, CRON_SECRET, SUPABASE_PUBLISHABLE_KEY/SECRET_KEY. Do not edit
.env.local.

## Key decisions (locked with owner)

- X Pro tier. Curation cron every 5 min (*/5 * * * *) native Vercel only (no
  external pinger). Worker every 1 min (* * * * *).
- Web-search grounding ON for article writing; two AI calls (web search yields
  citations which are incompatible with strict output_config.format, so
  research call then strict structuring call). web_search_20260209.
- Default models: Sonnet 4.6 for article write/rewrite, Haiku 4.5 for triage +
  follow-up linking. All models/prompts editable in beacon_settings.
- Public /articles/[slug] reader is DEFERRED to a later phase (out of scope here).
- No source trust tiers anywhere.

## Pre-existing project carry-forwards (NOT Beacon Brief; preserved so they are not lost)

- GIPHY production key still pending (Signal uses a BETA key) before public launch.
- Signal live-profile manual end-to-end test still pending (see git history /
  prior handoff for detail). These are unrelated to the Beacon Brief.
