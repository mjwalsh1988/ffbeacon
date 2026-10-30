# docs

Work that is still ahead sits at the top level, one folder per feature. Work
whose plan has shipped lives under completed/, keeping the same folder name.

Reorganised three times: on 2026-09-05 into one folder per feature, on
2026-09-11 when everything already built moved under completed/, and on
2026-10-15 when every remaining built plan followed them (FAAB, IDP, Beacon
Ranker, Season Pulse, Relays, Manager Pulse, site speed and the search growth
plan), and each plan's own Status line was changed to BUILT. Every file
was moved with `git mv`, so `git log --follow` still works on each one. Code
comments, CLAUDE.md and progress.md entries written before a move cite the path
in the "Cited as" column; the file now lives at the path in the first two
columns.

## Active

| Folder | File | What it is | Status | Cited as |
| --- | --- | --- | --- | --- |
| seo-audit | seo-audit-and-plan.md | 2026-09-11 full SEO and answer-engine audit, with Search Console data and the implementation plan to grow organic traffic | Phase 1 and the five owner decisions built and deployed; Part 7 Phases 2 to 5 run to January 2027 and are about 60 of its tasks are not built | new |
| seo-audit | terms-page-rework-plan.md | 2026-09-22 plan to split the glossary: an abbreviations page and three single-term pages as a test | Not started (no /guides/fantasy-football-abbreviations page exists) | new |
| projection-engine | projection-engine-v2-plan.md | 2026-09-27 plan (revised 2026-10-13) for the second build of the projection engine | Not started (no PE2-T task in progress.md) | new |
| beacon-link | beacon-link-plan.md | 2026-09-05 plan (revised 2026-09-07) to link a reader's Sleeper account and act on it across the tools and inside League Pulse | Not started | docs/beacon-link/beacon-link-plan.md |
| league-providers | league-providers-and-yahoo-plan.md | Yahoo beside Sleeper, through a provider layer | Not started | docs/league-providers/league-providers-and-yahoo-plan.md |
| league-providers | yahoo-plan-notes.md | Working notes for the same plan | Not started | docs/league-providers/yahoo-plan-notes.md |
| data-sources | data-sources.md | Source taxonomy for rankings, values and projections | Living reference | docs/data-sources/data-sources.md |

data-sources stays outside completed/ because it is a living reference, not a
plan: CLAUDE.md tells new source work to record its limits in
docs/data-sources/data-sources.md. It is out of date: it does not describe the
ffbeacon native values or DynastyProcess, both of which are built.

A built plan moves to completed/ even when check-in tasks remain; those stay
open in progress.md and are named in the Left over column below.

## Rule: docs holds documents only

Nothing writes into docs/ while it runs. No script, cron, route, test or build
step may create, append to or read from a file under docs/, and no plan may
tell one to. A person (or a session acting for one) edits these files by hand;
that is the whole of their life cycle. That is what lets a finished plan move
to completed/ without breaking anything.

Anything a program writes or reads at run time goes under data/ at the
repository root, in a subfolder named for the feature, with its own
subfolders as it grows: logs, measurements, generated reports, reference files
the code loads. A plan that needs one names its data/ path in the plan.

What lives there today:

- data/beacon-brief/examples/: the reference Brief editions. The Brief desk
  reads week-3-2026-brief.json on every run (lib/brief-desk/bundle.ts) and
  next.config.ts traces the folder into the deployed function.
  make-week3-draft.mjs, the script that drafted it, sits beside it.
- data/manager-pulse/: `npm run measure:manager-pulse` appends each run to
  measurements.jsonl (created on the first run).
- data/performance/: `npm run measure:bundle` writes one bundle-<date>.txt
  report per run.

data/ is in the ESLint ignore list, the same as docs/.

## Completed

| Folder | File | What it is | Left over | Cited as |
| --- | --- | --- | --- | --- |
| completed/team-blueprint | team-blueprint-plan.md | Team Blueprint inside League Pulse (page, link preview and portrait share image, overview and homepage calls to action) and the nightly Market Signals engine behind its calls and the player profile badge, with section 21 on what shipped differently | Deploy, then confirm the 10:30 and 10:50 UTC market-signals runs in cron_runs and record the first-week table sizes (BP-T020); BP-T081 (commit) skipped by the owner | docs/team-blueprint/team-blueprint-plan.md |
| completed/beacon-brief | relays-and-briefs-plan.md | 2026-09-16 plan: keep posts as structured Relays and write one indexed Brief per period from them | Owner steps BD-T051 and BD-T052 (first editions, AdSense re-review) and BD-T108 (migration 0334) are pending; BD-T109 (week 3 redo) is in progress | docs/beacon-brief/relays-and-briefs-plan.md |
| completed/beacon-brief | reviews/ | The nine review reports from that build (accessibility, implementation, performance, security, SEO) | None | docs/beacon-brief/reviews/ |
| completed/faab | faab-calculator-overhaul-plan.md | FAAB calculator audit, decisions and build spec | FB-R03, FB-R05 and FB-R07 are pending in progress.md | docs/faab/faab-calculator-overhaul-plan.md |
| completed/faab | chopped-guillotine-guide-seo-plan.md | The chopped, guillotine and death league guide | None | docs/faab/chopped-guillotine-guide-seo-plan.md |
| completed/idp | idp-guide-and-data-plan.md | Defenders across the site, every tool and the IDP guide | None in progress.md | docs/idp/idp-guide-and-data-plan.md |
| completed/idp | *-invariant-report.txt, idp-accuracy-backtest.txt, claude-md-draft-idp-404.txt | Phase invariant reports, the accuracy backtest and the CLAUDE.md draft | Reference | docs/idp/ |
| completed/ranking-boards | board-builder-plan.md | Beacon Ranker, the head-to-head board builder, and community rankings | The community board as a data source is off by design (plan 9.4) | docs/ranking-boards/board-builder-plan.md |
| completed/season-pulse | season-pulse-plan.md | Season Pulse, the /season hub, the positional rank finder and game day weather | None in progress.md | docs/season-pulse/season-pulse-plan.md |
| completed/seo-audit | adsense-review-2026-09-14.md | Why AdSense declined the site on 2026-09-14 and what was changed | The re-review waits on BD-T052 | docs/seo-audit/adsense-review-2026-09-14.md |
| completed/seo-audit | waiver-wire-keyword-plan.md | The /waiver-wire pages, the platform FAAB guide and the free agent finder landing page | None | docs/seo-audit/waiver-wire-keyword-plan.md |
| completed/seo-audit | gsc-growth-plan-2026-10-15.md | 2026-10-15 search growth plan: the guillotine FAAB page, IDP rankings, the weather page title and the links between them | Search Console measurements due 2026-10-29 and 2026-11-26 | docs/seo-audit/gsc-growth-plan-2026-10-15.md |
| completed/manager-pulse | manager-pulse-plan.md | Plan of record for Manager Pulse, with section 15 on what shipped differently | None | docs/manager-pulse/manager-pulse-plan.md |
| completed/manager-pulse | manager-pulse-audit-and-speed-plan.md | 2026-09-05 audit and the plan to make the sync fast, the panel live, and the cap higher | Measurement runs MPS-T017, MPS-T050 and MPS-T054 not made; `npm run measure:manager-pulse` appends them to data/manager-pulse/measurements.jsonl | docs/manager-pulse/manager-pulse-audit-and-speed-plan.md |
| completed/performance | site-speed-audit-and-plan.md | 2026-09-08 site-wide speed audit and the phased build plan | PERF-T034 partial: app/players and app/[handle] have no loading boundary, because one would make their not-found pages soft 404s | docs/performance/site-speed-audit-and-plan.md |
| completed/performance | db-baseline-2026-09-08.md, results-2026-09-08.md | Measurements from that build (the bundle reports moved to data/performance) | Reference | docs/performance/ |
| completed/saved-handle | saved-handle-plan.md | Every tool opens on the reader's saved Sleeper handle, and a logo column on every league list | None | docs/saved-handle/saved-handle-plan.md |
| completed/league-pulse | league-format-resolution.md | How a league view derives its format from Sleeper scoring | Reference | docs/league-pulse/league-format-resolution.md |
| completed/league-pulse | league-pulse-positional-war-plan.md | Positional WAR build plan | None | docs/league-pulse/league-pulse-positional-war-plan.md |
| completed/league-pulse | league-pulse-positional-war-implementation-review.md | Positional WAR review against the plan | None | docs/league-pulse/league-pulse-positional-war-implementation-review.md |
| completed/league-pulse | league-pulse-schedule-and-trade-ideas-plan.md | Schedules section and Trade Ideas plan | T664, saving a built trade, is blocked in progress.md | docs/league-pulse/league-pulse-schedule-and-trade-ideas-plan.md |
| completed/league-pulse | league-pulse-schedule-and-trade-ideas-implementation.md | Schedules and Trade Ideas implementation report | None | docs/league-pulse/league-pulse-schedule-and-trade-ideas-implementation.md |
| completed/projection-engine | projection-engine-plan.md | The FF Beacon projection engine plan of record | PE-T018: one save on /admin/power-pulse clears a stale noise setting | docs/projection-engine/projection-engine-plan.md |
| completed/draft-grades | redraft-and-draft-grades-plan.md | Redraft parity, draft grades and the post-draft handoff | RD-T063: the "What changed since your draft" banner is built but always passed null; the server read is missing | docs/draft-grades/redraft-and-draft-grades-plan.md |
| completed/beacon-steals | beacon-steals-plan.md | Draft value against the market | None beyond its own section 9 deferrals | docs/beacon-steals/beacon-steals-plan.md |
| completed/beam | beam-plan.md | BEAM V1 plan | Phase 7 (language model interpreter) is a separate project | docs/beam/beam-plan.md |
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
