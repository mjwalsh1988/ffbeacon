-- Migration 0100: signal_check_rulesets + signal_check_rules
--
-- Signal Check (public feature) / Beacon Verdict (result) calibration layer.
-- A ruleset is a versioned container of admin-authored calibration and
-- trade-shape rules. Exactly one published ruleset is active at a time; the
-- rest are draft or archived. Rollback = re-point is_active to a prior version.
--
-- Rules are STRUCTURED JSON only. The interpreter (lib/signal-check/rules/
-- interpreter.ts) is a deterministic switch over enumerated condition/action
-- types. There is NO eval, Function constructor, or free-form expression
-- string. condition/action jsonb is validated by a strict Zod schema in the
-- server action before it is ever written here.
--
-- Access matrix (both tables):
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL (admin server actions write/read via createAdminClient
--                        after requireAdmin; the public engine reads the active
--                        ruleset via the service role too)
--   client writes : BLOCKED
--
-- No anon/authenticated policy exists on purpose: rules are admin/debug data and
-- must never leak to the public. The public Signal Check pipeline runs
-- server-side with the service role.

create table if not exists public.signal_check_rulesets (
  id uuid primary key default gen_random_uuid(),
  -- Monotonic human-facing version number, pinned into saved analyses.
  version integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  label text,
  notes text,
  -- At most one row may have is_active = true (the partial unique index below).
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (version)
);

-- Enforce a single active ruleset across the whole table.
create unique index if not exists idx_signal_check_rulesets_single_active
  on public.signal_check_rulesets ((is_active))
  where is_active;

create table if not exists public.signal_check_rules (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null
    references public.signal_check_rulesets(id) on delete cascade,
  -- Deterministic application order within a (ruleset, phase).
  sort_order integer not null default 0,
  scope text not null
    check (scope in ('single_asset', 'one_side', 'whole_trade')),
  phase text not null
    check (phase in ('post_format_calibration', 'post_aggregation_trade_shape')),
  -- Structured filters (position, format, value range, pick round, asset count,
  -- side total, best-asset share, trade-shape category, etc). Validated by Zod.
  condition jsonb not null default '{}'::jsonb,
  -- Structured effect (multiply_pct, add_points, cap, side_penalty, side_boost,
  -- assign_shape, confidence_modifier, trace_note). Validated by Zod.
  action jsonb not null default '{}'::jsonb,
  -- Stackable rules compound within a phase. Non-stackable rules that share a
  -- stack_group are mutually exclusive (first match by sort_order wins).
  stackable boolean not null default false,
  stack_group text,
  -- Guardrail on the maximum magnitude this rule may move a value, e.g.
  -- {"type":"pct","value":25} or {"type":"points","value":300}.
  max_adjustment jsonb,
  admin_label text not null,
  internal_description text,
  -- Template rendered into the public plain-language explanation. Placeholders
  -- like {side}, {asset}, {margin} are substituted as TEXT (React-escaped), so
  -- no raw value points leak unless the public toggle allows it.
  public_explanation_template text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_signal_check_rules_ruleset_phase
  on public.signal_check_rules(ruleset_id, phase, sort_order);

alter table public.signal_check_rulesets enable row level security;
alter table public.signal_check_rules enable row level security;

drop policy if exists signal_check_rulesets_service_role_all on public.signal_check_rulesets;
create policy signal_check_rulesets_service_role_all on public.signal_check_rulesets
  for all to service_role using (true) with check (true);

drop policy if exists signal_check_rules_service_role_all on public.signal_check_rules;
create policy signal_check_rules_service_role_all on public.signal_check_rules
  for all to service_role using (true) with check (true);

comment on table public.signal_check_rulesets is
  'Signal Check (Beacon Verdict) versioned calibration rulesets. One active published ruleset at a time; rollback re-points is_active. Service-role only.';
comment on table public.signal_check_rules is
  'Signal Check structured calibration/trade-shape rules. JSON-only, interpreted by a deterministic switch (no eval). Service-role only.';
