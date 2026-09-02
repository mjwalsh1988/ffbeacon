-- Migration 0243: backfill league_transactions.week from the stored raw object
--
-- THE DEFECT. lib/league-pulse.ts built its row with `week: t.week ?? null`.
-- Sleeper does not send `week` on a transaction; it sends `leg`. So the column
-- was null on all 23,847 stored rows, and three things depended on it:
--
--   1. The Transactions page offers a week filter. Its facet list is built by
--      collecting distinct non-null weeks, so the dropdown was always empty and
--      every row rendered with no week against it.
--   2. syncTransactions resumes from the newest stored week so a warm league
--      asks Sleeper only about what it has not seen. With every week null it
--      resolved to week 0 and re-walked the entire history on every resync.
--   3. Anything grading a move by when it happened, which is what the Manager
--      Ledger does, had no week to grade against.
--
-- The code now reads `leg`. This repairs the rows already written, from the
-- `metadata` jsonb, which is exactly the audit trail the preservation rule in
-- CLAUDE.md exists to make possible: the original Sleeper object was stored
-- verbatim, so nothing has to be re-fetched to recover the field.
--
-- Idempotent: it only touches rows whose week is still null, and only when the
-- stored object carries a positive integer leg.
--
-- Access matrix (unchanged; this migration adds no object):
--   anon          : SELECT (existing league_transactions policy)
--   authenticated : SELECT (existing league_transactions policy)
--   service_role  : ALL
--   client writes : BLOCKED

update public.league_transactions
set week = (metadata ->> 'leg')::integer
where week is null
  and metadata ->> 'leg' ~ '^[0-9]+$'
  and (metadata ->> 'leg')::integer > 0;

comment on column public.league_transactions.week is
  'The Sleeper scoring period the transaction landed in, read from the payload''s `leg` field. Null only when the stored object carried neither leg nor week.';
