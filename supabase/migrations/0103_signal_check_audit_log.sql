-- Migration 0103: signal_check_audit_log (append-only admin audit trail)
--
-- Every admin mutation to Signal Check settings, rules, rulesets (publish),
-- rollbacks, and regression cases appends a row here with before/after jsonb.
-- Written inside the same server action that performs the change.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL (insert + read for the admin audit view)
--   client writes : BLOCKED

create table if not exists public.signal_check_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null
    check (action in (
      'setting_change',
      'rule_change',
      'ruleset_publish',
      'rollback',
      'regression_update'
    )),
  target text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signal_check_audit_log_created
  on public.signal_check_audit_log(created_at desc);

alter table public.signal_check_audit_log enable row level security;

drop policy if exists signal_check_audit_log_service_role_all on public.signal_check_audit_log;
create policy signal_check_audit_log_service_role_all on public.signal_check_audit_log
  for all to service_role using (true) with check (true);

comment on table public.signal_check_audit_log is
  'Append-only audit trail for Signal Check admin changes (settings, rules, publishes, rollbacks, regression). Service-role only.';
