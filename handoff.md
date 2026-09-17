# Handoff

## Sessions of 2026-09-16 and 2026-09-17: Relays and Briefs, BUILT AND REVIEWED, NOT COMMITTED

Plan of record: docs/beacon-brief/relays-and-briefs-plan.md. Tasks: progress.md,
prefix BD, at the very end of that file. Every task carries its status there;
this file says where the work stands and what a fresh session must know.

Nothing is committed and nothing is pushed, by instruction.

### State

Phases 1 to 5 and the run scripts are done (BD-T001 to BD-T047, BD-T049,
BD-T049b). Five review passes (implementation, security, accessibility,
performance, SEO) are in docs/beacon-brief/reviews/, every finding with a
Resolution line, and their fixes are applied (BD-T090). The 2026-09-17
session, after the 09-16 one ran out of context, confirmed the tree was
intact (tsc clean, full suite green), closed the review items that were
marked "left" but were mechanical, and filled in plan section 22 (BD-T091).
A second review pass then ran (BD-T092): four reports under
docs/beacon-brief/reviews/*-pass-2.md with their fixes applied; the
implementation reviewer was cut off by the session limit and wrote nothing.

THE BUILD IS COMPLETE. There is no feature code left to write. Do not spawn
another review pass over the whole feature: four sessions of budget went to
reviewers re-reading the tree. If a later change needs review, scope one
reviewer to that change's git diff and ask for blocker and major findings
only.

Deploy-order step found by the SEO pass: production still runs the old
commit, so the live pipeline kept publishing per-post articles after the
archive script ran (one is live at /brief/nico-collins-hamstring-injury).
After this tree deploys: `npm run backfill:relays -- --apply` then
`npm run archive:legacy-articles -- --apply` (both idempotent), then confirm
`select count(*) from articles where status = 'published' and article_type
<> 'brief'` is 0.

Migrations 0284 to 0288 are applied to production through the Supabase MCP
and lib/database.types.ts is regenerated.

Production data changed by the build (both authorised by plan section 20):
the Relay backfill (643 published, then 16 more after the grounding rules
were tightened; 64 hidden for the owner in /admin/brief-desk/relays; 194
dropped by the gates; 212 folded) and the archive of 492 legacy articles with
463 redirects. The live pipeline now writes Relays and no articles.

### Facts a new session needs

- The Supabase MCP server was authorised through the owner's browser
  (organisation FF Beacon). A new session may need to re-run the authenticate
  flow; the owner has to open the URL, or Claude in Chrome can.
- Migrations start at 0289 (0288 is the last file).
- BRIEF_DESK_TOKEN is in .env.local and .env.local.example. It still has to
  be added to the Vercel project environment by the owner.
- `npm run lint` cannot run: the repo has no ESLint config and `next lint`
  drops into its interactive setup. Every session has used `npm run
  typecheck` and `npm run test` instead.
- Owner-only tasks (BD-T014, BD-T048, BD-T048b, BD-T050, BD-T051, BD-T052)
  are left pending on purpose.

### What the owner still has to do

1. Review and commit the working tree.
2. Add BRIEF_DESK_TOKEN (the value in .env.local) to the Vercel environment.
3. Decide the Terms page sentence (docs/beacon-brief/reviews/seo.md, M1).
4. BD-T014: watch one day of the live pipeline in /admin/brief-desk/relays
   and /admin/beacon-brief/logs; clear or edit the 64 hidden Relays.
5. BD-T048: write the week 1, 2026 edition by hand in a session (plan 14.3),
   then BD-T048b copies its draft_payload to
   docs/beacon-brief/examples/week-1-2026-brief.json.
6. BD-T050: create the two cloud routines at claude.ai/code/routines with
   scripts/brief-desk/prompt.md and BRIEF_DESK_TOKEN in their environment.
7. BD-T051 and BD-T052 as the plan states.

### Known and deliberately left

Every item is recorded in plan section 22 with its reason. The short list:

- A retracted Relay's permalink renders the retracted notice with noindex and
  a 200, not a 410 (App Router pages cannot set a 410).
- `week` on relays is stored for regular and post season only; pre-season
  posts carry null with the phase reported by lib/relays/week.ts.
- The hub is dynamic; the permalink walks its ancestor chain one query at a
  time; the desk rate limit is keyed on the caller rather than the token;
  `brief_editions` has no partial unique index on the period.

## Session of 2026-09-11: design pass, NOT COMMITTED

A presentation-only redesign of the Who Should I Start result cards, the
toughest-calls grid and the written sections under both Who Should I Start
and the trade calculator. Tasks DSN-T001 onward in progress.md.
No engine, query or migration change. Nothing committed or pushed, by
instruction: the owner reviews first.

Found and left, pre-existing: the Reliability tab lists unplayed and
unsynced weeks as "Did not play" (lib/breakdown/load-extras.ts
loadReliabilityWeeks has no week bound); the BookmarkBar in the site shell
throws a hydration id mismatch in dev; this week's toughest-calls pairs are
exact projection ties, so every card reads "0.0 points clear, 50 percent".

Earlier entries (the SEO build of 2026-09-10 and before) live in the git
history of this file.
