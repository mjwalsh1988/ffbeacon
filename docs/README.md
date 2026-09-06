# docs

One folder per feature. Reorganised 2026-09-05; every file was moved with
`git mv`, so `git log --follow` still works on each one. Code comments written
before that date cite the old flat paths listed in the last column.

| Folder | File | What it is | Old path |
| --- | --- | --- | --- |
| manager-pulse | manager-pulse-plan.md | Plan of record for Manager Pulse, with section 15 on what shipped differently | docs/manager-pulse-plan.md |
| manager-pulse | manager-pulse-audit-and-speed-plan.md | 2026-09-05 audit and the plan to make the sync fast, the panel live, and the cap higher | new |
| beacon-link | beacon-link-plan.md | 2026-09-05 plan to link a reader's Sleeper account and act on it (lineups, trades, waivers) across the tools and inside League Pulse | new |
| saved-handle | saved-handle-plan.md | 2026-09-05 plan: every tool and league view opens on the reader's saved Sleeper handle with no search, a notice for readers who have not saved one, and a logo column on every league list | new |
| league-pulse | league-format-resolution.md | How a league view derives its format from Sleeper scoring | docs/league-format-resolution.md |
| league-pulse | league-pulse-positional-war-plan.md | Positional WAR build plan | docs/league-pulse-positional-war-plan.md |
| league-pulse | league-pulse-positional-war-implementation-review.md | Positional WAR review against the plan | docs/league-pulse-positional-war-implementation-review.md |
| league-pulse | league-pulse-schedule-and-trade-ideas-plan.md | Schedules section and Trade Ideas plan | docs/league-pulse-schedule-and-trade-ideas-plan.md |
| league-pulse | league-pulse-schedule-and-trade-ideas-implementation.md | Schedules and Trade Ideas implementation report | docs/league-pulse-schedule-and-trade-ideas-implementation.md |
| projection-engine | projection-engine-plan.md | The FF Beacon projection engine plan of record | docs/projection-engine-plan.md |
| draft-grades | redraft-and-draft-grades-plan.md | Redraft parity, draft grades and the post-draft handoff | docs/redraft-and-draft-grades-plan.md |
| beacon-steals | beacon-steals-plan.md | Draft value against the market | docs/beacon-steals-plan.md |
| beam | beam-plan.md | BEAM V1 plan | docs/beam-plan.md |
| beam | beam-build-report.md | What BEAM shipped | docs/beam-build-report.md |
| beacon-brief | beacon-brief-relevance-plan.md | Beacon Brief relevance gate | docs/beacon-brief-relevance-plan.md |
| beacon-brief | beacon-brief-removals-2026-07-30.md | The approved article removal list, also the script input | docs/beacon-brief-removals-2026-07-30.md |
| signal-check | signal-check.md | Signal Check trade analyzer engineering reference | docs/signal-check.md |
| signal-profile | phase5-plan.md | Signal public profile, phase 5 block builder | docs/phase5-plan.md |
| data-sources | data-sources.md | Source taxonomy for rankings, values and projections | docs/data-sources.md |
| security | FF_BEACON_END_TO_END_SECURITY_AUDIT.md | The end to end audit | unchanged |
| security | FF_BEACON_SECURITY_FINDINGS.json | Findings ledger | unchanged |
| security | FF_BEACON_SECURITY_REMEDIATION_REPORT.md | What was remediated | unchanged |

When a feature gains a second document, it goes in that feature's folder. A
document that spans features goes with the feature it changes most.
