-- Migration 0037: beacon_settings (global tunable key-value store)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine reads; admin server actions write via service role)
--   client writes : BLOCKED
--
-- Single source of truth for every global FF Beacon tunable. The constants in
-- lib/beacon/freshness.ts, the factor clamp, normalization method,
-- MIN_PLAYERS_FOR_QUANTILE, and the AI toggles are DB-backed DEFAULTS seeded
-- here, NOT hardcoded source-of-truth values. The admin dashboard edits these
-- via requireAdmin server actions so nothing needs a code deploy to retune.
--
-- value is jsonb so a setting can be a number, boolean, or string. value_type +
-- category + label + description let the admin UI render typed controls
-- generically and group them.

create table if not exists public.beacon_settings (
  key text primary key,
  value jsonb not null,
  value_type text not null check (value_type in ('number','boolean','string')),
  category text not null,
  label text not null,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.beacon_settings enable row level security;

drop policy if exists beacon_settings_service_role_all on public.beacon_settings;
create policy beacon_settings_service_role_all on public.beacon_settings
  for all to service_role using (true) with check (true);

-- Seeded defaults (admin-editable from /admin/beacon).
insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('stale_after_days_daily',    '3'::jsonb,                  'number',  'staleness',     'Daily source stale after (days)',   'A daily-cadence source whose newest snapshot is older than this is dropped from the blend.'),
  ('stale_after_days_weekly',   '10'::jsonb,                 'number',  'staleness',     'Weekly source stale after (days)',  'A weekly-cadence source whose newest snapshot is older than this is dropped from the blend.'),
  ('stale_after_days_default',  '3'::jsonb,                  'number',  'staleness',     'Unknown-cadence stale after (days)','Fallback staleness threshold for a source with no recognised cadence.'),
  ('factor_min',                '0.5'::jsonb,                'number',  'factor',        'Adjustment factor minimum',         'Lower clamp on the combined adjustment factor, applied before the band clamp.'),
  ('factor_max',                '1.5'::jsonb,                'number',  'factor',        'Adjustment factor maximum',         'Upper clamp on the combined adjustment factor, applied before the band clamp.'),
  ('min_players_for_quantile',  '30'::jsonb,                 'number',  'normalization', 'Min players for quantile matching', 'Below this many players in a (position, format) slice, a source degrades to P99 scaling and is flagged low-confidence.'),
  ('normalization_method',      '"quantile_median"'::jsonb,  'string',  'normalization', 'Normalization method',              'How source values are aligned before blending. quantile_median = trimmed-P99 median canonical curve with quantile matching.'),
  ('ai_enabled',                'false'::jsonb,              'boolean', 'ai',            'AI signal enabled',                 'Master on/off for the ai_adjust signal. Off until a non-AI baseline is trusted.'),
  ('ai_model',                  '"claude-haiku-4-5"'::jsonb, 'string',  'ai',            'AI model',                          'Anthropic model id used for the per-player adjustment call.'),
  ('ai_adjustment_bound',       '0.12'::jsonb,               'number',  'ai',            'AI adjustment bound',               'Hard clamp on the AI adjustment_pct, magnitude in each direction.')
on conflict (key) do nothing;

comment on table public.beacon_settings is
  'Global FF Beacon tunables (staleness, factor clamp, normalization, AI). DB-backed source of truth; freshness.ts and friends carry only fallback defaults. Admin-editable.';
