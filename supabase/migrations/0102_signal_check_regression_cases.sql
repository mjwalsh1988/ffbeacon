-- Migration 0102: signal_check_regression_cases (admin calibration test set)
--
-- A bounded set of known trades with expected outcomes. After any rule/setting
-- change, the admin runs the draft ruleset against every case and diffs the
-- result against expectations (verdict flips, margin drift beyond tolerance,
-- trade-shape changes, confidence changes). Used for before/after preview and
-- the regression run. The same rows double as the Vitest fixture.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL (admin server actions via createAdminClient after requireAdmin)
--   client writes : BLOCKED

create table if not exists public.signal_check_regression_cases (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  format_slug text not null,
  -- Same asset shape the public builder submits: players + (dynasty) picks.
  input_assets jsonb not null default '[]'::jsonb,
  expected_verdict text,
  expected_margin_min numeric,
  expected_margin_max numeric,
  expected_trade_shape text,
  expected_confidence text,
  -- Optional per-case tolerances overriding global defaults.
  tolerance jsonb not null default '{}'::jsonb,
  admin_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.signal_check_regression_cases enable row level security;

drop policy if exists signal_check_regression_cases_service_role_all on public.signal_check_regression_cases;
create policy signal_check_regression_cases_service_role_all on public.signal_check_regression_cases
  for all to service_role using (true) with check (true);

comment on table public.signal_check_regression_cases is
  'Signal Check regression test set (known trades + expected outcomes). Service-role only. Drives before/after preview, regression runs, and the Vitest fixture.';
