# Handoff: On The Clock ADP + draft snapshot enhancements (2026-07-04)

All 16 sections of ontheclock-updates.txt are implemented, typechecked, unit-tested
(29 files / 314 tests), and build-verified. Nothing was committed or pushed.
Migrations 0120 and 0121 are APPLIED to the live Supabase project (RLS verified),
types regenerated, and the first player_market_snapshots partition (2026-07-04,
672 rows) is loaded. The nightly cron (/api/cron/sync-sleeper-market, 11:00 UTC)
is scheduled in vercel.json and will take effect on the next deploy.

## What still needs a human / live pass
- End-to-end QA of the completed-draft snapshot finalizer with a REAL completed
  Sleeper draft (browser testing was out of scope for this session). Open a
  completed league in /tools/on-the-clock (feature flag must be on) and confirm:
  the snapshot row appears in on_the_clock_draft_snapshots, the room shows the
  "Final results" banner, and a later reload does not change any number.
- The admin "Completed-draft snapshots" panel on /admin/on-the-clock will be
  empty until the first completed draft is opened.
- Live-draft regression pass (sync button, realtime, recommendations) per the
  usual pre-launch checklist. The feature flag ships OFF, so nothing is public.

## Intentional design decisions worth knowing
- The raw-object column is named `metadata` (project convention), not `meta` as
  the prompt sketch suggested.
- Sleeper has NO source_registry row on purpose (must never appear in the public
  Source dropdown); player_market_snapshots.source is provenance only.
- ADP history cannot be backfilled (endpoint serves current values only, see
  docs/data-sources.md). Drafts completed before 2026-07-04 finalize with
  adp_snapshot_source = next_available or current_fallback and are flagged
  estimated in the UI + admin panel.
- Regrading a finalized draft is manual: delete its on_the_clock_draft_snapshots
  row (pick rows cascade) and reopen the draft.
