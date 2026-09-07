-- Migration 0270: the donation receipt ledger.
--
-- FF Beacon now sends its own donation receipt through Resend, in the branded
-- email shell, instead of relying on Stripe's automatic receipt. That needs
-- exactly one thing the previous design deliberately avoided: somewhere to
-- record that a receipt has already gone out.
--
-- WHY A TABLE IS UNAVOIDABLE HERE
--   Stripe retries a webhook until it gets a 2xx, and it can deliver the same
--   event more than once by design. Without a durable record, every retry sends
--   the donor another receipt for the same donation. The unique constraint on
--   stripe_session_id plus the status claim below is what makes exactly-once
--   delivery possible; nothing in application memory can survive a cold start
--   and do that job.
--
-- WHAT IS DELIBERATELY NOT STORED
--   The donor's email address, name, billing address, and card details are NOT
--   in this table and are NOT in `metadata`. They are read from the Stripe event
--   in memory, used to address the receipt, and dropped. Stripe holds the
--   authoritative copy of all of it, so keeping a second one here would add
--   breach exposure for no capability we need. `metadata` stores an ALLOW-LISTED
--   projection of the event (lib/donate/redact.ts): identifiers, amounts, states
--   and our own metadata, and nothing else. A deny-list was the first version and
--   was wrong, because it keeps every field Stripe has not yet been named in it,
--   so a Dashboard setting or a new API version would silently start storing
--   donors' names and addresses with no code change to review.
--
--   This is the documented exception to the "preserve the original source object"
--   rule in CLAUDE.md, which now records the three conditions it applies under.
--   The rule exists for audit, backfill and diagnosis, and the Stripe identifiers
--   below let anyone recover the full object from Stripe itself in one lookup.
--
-- ACCESS MATRIX
--   donation_receipts  SELECT  service_role only. No anon, no authenticated.
--                      INSERT  service_role only (the webhook route).
--                      UPDATE  service_role only (the send claim and result).
--                      DELETE  service_role only.
--   There is no client-facing read of this table anywhere in the product, and
--   there should not be: a row says how much somebody gave.

create table if not exists public.donation_receipts (
  id uuid primary key default gen_random_uuid(),

  -- Stripe's own identifiers. The session id is the idempotency key: one
  -- Checkout Session is one donation is one receipt, however many times Stripe
  -- delivers the event.
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,

  -- What was given. Not personal on its own: no identity is stored beside it.
  amount_total_cents integer not null check (amount_total_cents >= 0),
  currency text not null default 'usd',

  -- Where the donation started (header_modal, donate_page, unknown), copied
  -- from the session metadata our own checkout route set.
  surface text,

  -- False for a Stripe test-mode event. Without it a test donation and a real
  -- one are indistinguishable rows in what is otherwise a financial record, and
  -- the day somebody points a test endpoint at production is the day that
  -- matters.
  livemode boolean,

  -- The delivery state machine.
  --   pending   the row exists, no send has been attempted
  --   sending   a request has claimed this row and is sending right now
  --   sent      Resend accepted it
  --   failed    the send was attempted and did not succeed
  --   deferred  we could not send YET (email provider unconfigured). Reclaimable.
  --   skipped   no receipt is possible at all (no usable address). Terminal.
  --
  -- 'deferred' and 'skipped' were one state to begin with, and collapsing them
  -- was a real defect: a donation that arrived while Resend was misconfigured
  -- became permanently unreceiptable, because 'skipped' is excluded from every
  -- future claim. Only "there is nobody to send to" is genuinely terminal.
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'deferred', 'skipped')),
  attempts integer not null default 0,
  last_error text,

  -- Set once, when a receipt actually goes out. The claim below reads this.
  receipt_sent_at timestamptz,
  -- When the current 'sending' claim was taken, so a crashed send can be retried
  -- rather than wedging the row forever.
  claimed_at timestamptz,

  -- An allow-listed projection of the Stripe event. See the note above.
  metadata jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.donation_receipts is
  'One row per donation Checkout Session, recording that FF Beacon sent its own receipt email. service_role only. Deliberately holds NO donor email, name, address or payment details: Stripe is the authoritative record for all of that.';

comment on column public.donation_receipts.stripe_session_id is
  'Idempotency key. Stripe retries webhooks, so this unique constraint is what stops a donor receiving the same receipt twice.';

comment on column public.donation_receipts.metadata is
  'An allow-listed projection of the Stripe event (lib/donate/redact.ts): identifiers, amounts, states and our own metadata only. Documented exception to the raw-object preservation rule, because the donor identity is not ours to keep and the Stripe ids above recover the full object on demand.';

-- Idempotent add for a database that already has the table from an earlier run
-- of this migration. `create table if not exists` above cannot add a column to
-- an existing table, and this file has to leave both paths in the same state.
alter table public.donation_receipts add column if not exists livemode boolean;

-- Widen the status check for an already-created table. Dropping and recreating
-- rather than altering, because a CHECK constraint cannot be modified in place.
alter table public.donation_receipts drop constraint if exists donation_receipts_status_check;
alter table public.donation_receipts add constraint donation_receipts_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'deferred', 'skipped'));

alter table public.donation_receipts enable row level security;

-- Service role only, for every operation. No anon or authenticated policy is
-- created on purpose: with RLS on and no policy, those roles are blocked.
drop policy if exists donation_receipts_service_role_all on public.donation_receipts;
create policy donation_receipts_service_role_all on public.donation_receipts
  for all to service_role using (true) with check (true);

create index if not exists donation_receipts_created_at_idx
  on public.donation_receipts (created_at desc);

-- Finds rows that still need a receipt, including ones whose 'sending' claim
-- was abandoned by a crashed invocation.
drop index if exists donation_receipts_status_idx;
create index if not exists donation_receipts_status_idx
  on public.donation_receipts (status)
  where status in ('pending', 'sending', 'failed', 'deferred');

/**
 * Claim one receipt for sending, atomically.
 *
 * Returns true to exactly one caller. A second delivery of the same Stripe
 * event, or a retry landing while the first is still in flight, gets false and
 * sends nothing. A claim older than p_stale_seconds is reclaimable, so a send
 * that died mid-flight is retried rather than leaving the row stuck in
 * 'sending' forever.
 *
 * SECURITY DEFINER with a pinned search_path, EXECUTE revoked from public, anon
 * and authenticated, matching try_claim_rate_limit in migration 0137.
 */
create or replace function public.try_claim_donation_receipt(
  p_session_id text,
  p_stale_seconds int default 300,
  p_max_attempts int default 8
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed boolean := false;
begin
  update public.donation_receipts
     set status = 'sending',
         claimed_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   where stripe_session_id = p_session_id
     and receipt_sent_at is null
     and status <> 'skipped'
     -- A permanently undeliverable address would otherwise get one Resend call
     -- per Stripe retry for three days. Past the ceiling the row stops being
     -- claimable and is left for the replay script to look at.
     and attempts < p_max_attempts
     and (
       status in ('pending', 'failed', 'deferred')
       or (
         status = 'sending'
         -- `claimed_at is null` can only arrive by hand, but without this clause
         -- such a row is unclaimable forever: null < anything is null, not true.
         and (claimed_at is null
              or claimed_at < now() - make_interval(secs => p_stale_seconds))
       )
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- The two-argument signature from the first version of this migration, dropped
-- so an old call site cannot bind to a function without the attempt ceiling.
drop function if exists public.try_claim_donation_receipt(text, int);

revoke all on function public.try_claim_donation_receipt(text, int, int)
  from public, anon, authenticated;
grant execute on function public.try_claim_donation_receipt(text, int, int) to service_role;

comment on function public.try_claim_donation_receipt(text, int, int) is
  'Atomically claims a donation receipt for sending. True for exactly one caller; a Stripe webhook retry gets false and sends no duplicate email.';
