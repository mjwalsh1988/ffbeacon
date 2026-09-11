# docs

Work that is still ahead sits at the top level, one folder per feature. Work
whose plan has shipped lives under completed/, keeping the same folder name.

Reorganised twice: on 2026-09-05 into one folder per feature, and on
2026-09-11 when everything already built moved under completed/. Every file was
moved with `git mv`, so `git log --follow` still works on each one. Code
comments, CLAUDE.md and progress.md entries written before 2026-09-11 cite the
path in the "Cited as" column; the file now lives at the path in the first two
columns.

## Active

| Folder | File | What it is | Status | Cited as |
| --- | --- | --- | --- | --- |
| seo-audit | seo-audit-and-plan.md | 2026-09-11 full SEO and answer-engine audit, with Search Console data and the implementation plan to grow organic traffic | Step 1 (Quick fixes) and the five owner decisions built 2026-09-11, not yet committed; continue at step 2 | new |
| beacon-link | beacon-link-plan.md | 2026-09-05 plan (revised 2026-09-07) to link a reader's Sleeper account and act on it across the tools and inside League Pulse | Not started | docs/beacon-link/beacon-link-plan.md |
| league-providers | league-providers-and-yahoo-plan.md | Yahoo beside Sleeper, through a provider layer | Not started | docs/league-providers/league-providers-and-yahoo-plan.md |
| league-providers | yahoo-plan-notes.md | Working notes for the same plan | Not started | docs/league-providers/yahoo-plan-notes.md |
| manager-pulse | manager-pulse-plan.md | Plan of record for Manager Pulse, with section 15 on what shipped differently | Built | docs/manager-pulse/manager-pulse-plan.md |
| manager-pulse | manager-pulse-audit-and-speed-plan.md | 2026-09-05 audit and the plan to make the sync fast, the panel live, and the cap higher | Built; measurement runs outstanding | docs/manager-pulse/manager-pulse-audit-and-speed-plan.md |
| performance | site-speed-audit-and-plan.md | 2026-09-08 site-wide speed audit and the phased build plan | Built; PERF-T034 partial | docs/performance/site-speed-audit-and-plan.md |
| performance | bundle-*.txt, db-baseline-2026-09-08.md, results-2026-09-08.md | Measurements from that build | Reference | docs/performance/ |
| data-sources | data-sources.md | Source taxonomy for rankings, values and projections | Living reference | docs/data-sources/data-sources.md |

Why three built folders are still here:

- manager-pulse: `scripts/measure-manager-pulse.ts` appends to
  docs/manager-pulse/measurements.jsonl without creating the folder, so moving
  it would make `npm run measure:manager-pulse` fail. The three measurement
  runs that script exists for (MPS-T017, MPS-T050, MPS-T054) have not been
  made, and Part 9's tables are still empty.
- performance: `scripts/measure-bundle.ts` writes each new bundle report into
  docs/performance. PERF-T034 is also partial: app/players/loading.tsx and
  app/[handle]/loading.tsx were skipped because a loading boundary would turn
  their not-found pages into soft 404s.
- data-sources: CLAUDE.md tells new source work to record its limits in
  docs/data-sources/data-sources.md. It is out of date: it does not describe
  the ffbeacon native values or DynastyProcess, both of which are built.

Both measurement folders can move to completed/ once the two script paths are
changed to match.

## Completed

| Folder | File | What it is | Left over | Cited as |
| --- | --- | --- | --- | --- |
| completed/saved-handle | saved-handle-plan.md | Every tool opens on the reader's saved Sleeper handle, and a logo column on every league list | None (the "PLAN ONLY" header is stale; SH-T001 to SH-T060 completed) | docs/saved-handle/saved-handle-plan.md |
| completed/league-pulse | league-format-resolution.md | How a league view derives its format from Sleeper scoring | Reference | docs/league-pulse/league-format-resolution.md |
| completed/league-pulse | league-pulse-positional-war-plan.md | Positional WAR build plan | None | docs/league-pulse/league-pulse-positional-war-plan.md |
| completed/league-pulse | league-pulse-positional-war-implementation-review.md | Positional WAR review against the plan | None | docs/league-pulse/league-pulse-positional-war-implementation-review.md |
| completed/league-pulse | league-pulse-schedule-and-trade-ideas-plan.md | Schedules section and Trade Ideas plan | T664, saving a built trade, is blocked in progress.md | docs/league-pulse/league-pulse-schedule-and-trade-ideas-plan.md |
| completed/league-pulse | league-pulse-schedule-and-trade-ideas-implementation.md | Schedules and Trade Ideas implementation report | None | docs/league-pulse/league-pulse-schedule-and-trade-ideas-implementation.md |
| completed/projection-engine | projection-engine-plan.md | The FF Beacon projection engine plan of record | PE-T018: one save on /admin/power-pulse clears a stale noise setting | docs/projection-engine/projection-engine-plan.md |
| completed/draft-grades | redraft-and-draft-grades-plan.md | Redraft parity, draft grades and the post-draft handoff | RD-T063: the "What changed since your draft" banner is built but always passed null; the server read is missing | docs/draft-grades/redraft-and-draft-grades-plan.md |
| completed/beacon-steals | beacon-steals-plan.md | Draft value against the market | None beyond its own section 9 deferrals | docs/beacon-steals/beacon-steals-plan.md |
| completed/beam | beam-plan.md | BEAM V1 plan | Phase 7 (language model interpreter) is a separate project; the "PLAN ONLY" header is stale | docs/beam/beam-plan.md |
| completed/beam | beam-build-report.md | What BEAM shipped | lib/beam/capabilities/player-value.ts multiplies change_30d_pct by 100 twice (handoff.md) | docs/beam/beam-build-report.md |
| completed/beacon-brief | beacon-brief-relevance-plan.md | Beacon Brief relevance gate | None | docs/beacon-brief/beacon-brief-relevance-plan.md |
| completed/beacon-brief | beacon-brief-removals-2026-07-30.md | The approved article removal list, passed to scripts/remove-brief-articles.ts with --file | None | docs/beacon-brief/beacon-brief-removals-2026-07-30.md |
| completed/signal-check | signal-check.md | Signal Check trade analyzer engineering reference | Reference | docs/signal-check/signal-check.md |
| completed/signal-profile | phase5-plan.md | Signal public profile, phase 5 block builder | None | docs/signal-profile/phase5-plan.md |
| completed/donations | donations.md | One-time donations, hosted Stripe Checkout, our own receipt, the donation_receipts ledger | Stripe and Resend dashboard setup steps are manual | docs/donations/donations.md |
| completed/security | FF_BEACON_END_TO_END_SECURITY_AUDIT.md | The end to end audit | See the findings ledger | docs/security/FF_BEACON_END_TO_END_SECURITY_AUDIT.md |
| completed/security | FF_BEACON_SECURITY_FINDINGS.json | Findings ledger | FFB-SEC-011, 015 and 016 partial; 017 waits on a dashboard switch; 018 and 019 wait on a product decision | docs/security/FF_BEACON_SECURITY_FINDINGS.json |
| completed/security | FF_BEACON_SECURITY_REMEDIATION_REPORT.md | What was remediated | SIGNAL_SCOUT_IP_SALT in Vercel and a re-run of the security advisor are manual; the Content Security Policy is still report-only | docs/security/FF_BEACON_SECURITY_REMEDIATION_REPORT.md |
| completed/seo | who-should-i-start-and-site-seo-plan.md | 2026-09-10 plan: the start/sit tool, the trade calculator slug, IndexNow, and the first site-wide SEO audit | Section 4.5 content pages were never built; carried into seo-audit/seo-audit-and-plan.md | docs/seo/who-should-i-start-and-site-seo-plan.md |

When a feature gains a second document, it goes in that feature's folder. A
document that spans features goes with the feature it changes most. When a
plan ships, move its folder under completed/ with `git mv` and add its old path
to the "Cited as" column.
