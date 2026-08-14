-- Migration 0198: beam_settings
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy)
--   authenticated : NO ACCESS  (no policy)
--   service_role  : ALL        (read by /api/beam/ask, written by the admin
--                               editor behind requireAdmin)
--
-- WHY
-- Same single-pinned-row pattern as faab_calculator_settings,
-- on_the_clock_settings, league_power_pulse_settings, and draft_value_settings.
-- Code holds the fallback defaults in lib/beam/default-settings.ts, so a missing
-- or unreadable row degrades to a working assistant instead of an error.
--
-- WHAT LIVES HERE
-- The numbers that decide when BEAM speaks and when it asks:
--   resolver.acceptConfidence / resolver.acceptMargin  (name resolution)
--   intent.acceptScore / intent.acceptMargin           (question routing)
--   limits.*                                           (input cap, rate limits)
--   capabilities.disabled                              (kill switch per capability)
--   interpreter.strategy                               (reserved: deterministic |
--                                                       llm | deterministic-then-llm)
--   interpreter.systemPrompt                           (reserved for the future
--                                                       LLM layer; every AI prompt
--                                                       on this site is DB-backed
--                                                       and admin-editable)
--
-- Tuning a threshold is a live product decision. Making it a deploy would mean
-- BEAM keeps guessing wrong for a day, so these are editable at /admin/beam.

create table if not exists public.beam_settings (
  id          text primary key,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint beam_settings_single_row check (id = 'global')
);

alter table public.beam_settings enable row level security;

drop policy if exists beam_settings_service_role_all on public.beam_settings;
create policy beam_settings_service_role_all
  on public.beam_settings
  for all to service_role using (true) with check (true);

insert into public.beam_settings (id, settings)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

comment on table public.beam_settings is
  'Single-row (id=global) JSONB config for BEAM: resolver and intent confidence thresholds, input and rate limits, per-capability kill switches, and the reserved slot for the future LLM interpreter. Service-role only; code holds fallback defaults in lib/beam/default-settings.ts. Admin-editable from /admin/beam.';
