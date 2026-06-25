-- Migration 0101: signal_check_analyses (frozen, reproducible Signal Check results)
--
-- A saved analysis is the V1 reproducibility snapshot. There is NO separate
-- value_snapshot table: the exact raw + adjusted per-asset values, side totals
-- (pre and post trade-shape), full rule trace, version pins, and value capture
-- timestamp are frozen inline so a public permalink renders the original verdict
-- without recomputing.
--
-- PRIVACY MODEL (critical):
--   This table holds PRIVATE/DEBUG columns: user_id, sleeper_context,
--   raw_values, adjusted_values, side_totals_*, and rule_trace. RLS is
--   row-level, NOT column-level, so there is deliberately NO anon/public SELECT
--   policy. Public share pages and OG images read this table SERVER-SIDE only
--   (createAdminClient) and render ONLY the public_payload jsonb, which by
--   construction contains just the safe, shareable summary fields (verdict,
--   margin, format display, trade shape, confidence label, plain-language
--   explanation, per-side asset display names, created date). public_payload
--   never contains user_id, sleeper_context, raw/adjusted values, or the trace.
--
-- Access matrix:
--   anon          : NONE (public shares are served server-side via service role)
--   authenticated : SELECT OWN rows only (auth.uid() = user_id) for "my saved
--                   analyses". NO insert/update/delete: analyses are created by
--                   the server action via the service role so values, totals,
--                   margin, and verdict can never be forged by a client.
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.signal_check_analyses (
  id uuid primary key default gen_random_uuid(),
  -- Unguessable public permalink id (crypto.randomUUID at creation).
  public_share_id text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  is_public boolean not null default false,

  -- Reproducibility pins ---------------------------------------------------
  value_source_slug text not null,
  value_engine_version text not null,
  rule_interpreter_version text not null,
  ruleset_version integer,
  format_slug text not null,
  format_config_id uuid references public.format_configs(id) on delete set null,
  -- For Sleeper imports: structured detection evidence (roster_positions,
  -- scoring signals). Null for manual builds.
  format_detection_evidence jsonb,

  -- Frozen payload (private/debug) -----------------------------------------
  input_assets jsonb not null default '[]'::jsonb,
  raw_values jsonb not null default '{}'::jsonb,
  adjusted_values jsonb not null default '{}'::jsonb,
  side_totals_pre jsonb not null default '{}'::jsonb,
  side_totals_post jsonb not null default '{}'::jsonb,
  rule_trace jsonb not null default '[]'::jsonb,

  -- Outputs ----------------------------------------------------------------
  trade_shape text,
  confidence text,
  verdict_label text not null,
  -- 'a' | 'b' | null (null = neutral / near even).
  winner_side text check (winner_side is null or winner_side in ('a', 'b')),
  margin numeric,

  -- Private Sleeper import context. NEVER copied into public_payload and never
  -- returned by the public share page or OG route.
  sleeper_context jsonb,

  -- The ONLY object exposed publicly. Pre-built at save time so the share path
  -- physically cannot over-fetch a private column.
  public_payload jsonb,

  value_captured_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_signal_check_analyses_user
  on public.signal_check_analyses(user_id, created_at desc);

alter table public.signal_check_analyses enable row level security;

-- Owner may read their own saved analyses (My Beacon list). No public policy.
drop policy if exists signal_check_analyses_select_own on public.signal_check_analyses;
create policy signal_check_analyses_select_own on public.signal_check_analyses
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists signal_check_analyses_service_role_all on public.signal_check_analyses;
create policy signal_check_analyses_service_role_all on public.signal_check_analyses
  for all to service_role using (true) with check (true);

comment on table public.signal_check_analyses is
  'Frozen, reproducible Signal Check results. Holds private/debug columns; NO anon SELECT. Public shares render only public_payload, read server-side via service role.';
comment on column public.signal_check_analyses.public_payload is
  'The only publicly exposed fields. Safe summary only: never includes user_id, sleeper_context, raw/adjusted values, or rule_trace.';
