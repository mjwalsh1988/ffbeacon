-- Migration 0327: League Relay send lease, so a dead run's claim is not stuck
--
-- lib/league-relay/post.ts claims a dedupe key by inserting a 'claimed' row,
-- builds the writeup, sends it, and records the result. A function that died
-- between the claim and the record left the row 'claimed' forever, and since
-- every tick skips keys that already have a row, that message was never sent
-- and never reported.
--
-- send_started_at marks the moment the send was attempted. It is written in
-- the same guarded statement as the payload, just before the Discord call:
--   - a stale 'claimed' row with no send_started_at (and no payload) never
--     reached Discord, so releaseStaleClaims deletes it and a later tick claims
--     the key fresh;
--   - a stale 'claimed' row whose send had started is closed as 'error' and
--     not retried, because a webhook execute carries no idempotency key and
--     there is no stored message id to check, so a second send could post twice.
-- The guard (status 'claimed' and send_started_at null) is also what stops a
-- process that was merely slow from sending after its claim was released.
--
-- A partial index on created_at where status = 'claimed' keeps the sweep, which
-- runs at the head of every relay tick, off the rest of the ledger.
--
-- Access matrix: unchanged from migration 0234. league_relay_posts stays
-- service-role only (RLS on, service_role policy only, no anon or
-- authenticated privileges). This adds a nullable column and an index; no
-- policy or grant changes.
--
-- Safe to apply before the code deploys: the column is nullable and nothing
-- existing reads it. The code is also safe to deploy first: it detects the
-- missing column and writes the payload the old way, and the sweep does
-- nothing until the column exists.
--
-- Rollback note (no down migration ships):
--   drop index if exists public.idx_league_relay_posts_claimed;
--   alter table public.league_relay_posts drop column if exists send_started_at;

alter table public.league_relay_posts
  add column if not exists send_started_at timestamptz;

comment on column public.league_relay_posts.send_started_at is
  'When the Discord send for this claim began. Null on a claim that never reached the send. A stale claim with this null is released for retry; one with it set is closed as error, never re-sent.';

create index if not exists idx_league_relay_posts_claimed
  on public.league_relay_posts (created_at)
  where status = 'claimed';
