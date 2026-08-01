-- Migration 0160: calibrated normalization (persisted synthetic consensus reference)
--
-- PURELY ADDITIVE. Two new tables, one new function, nine new settings rows. It
-- creates the capability and switches NOTHING on: normalization_method keeps
-- whatever value it already had, and calibration_format_slugs starts empty, so
-- every board keeps running the original method until someone changes a setting.
-- No existing value, ranking, or history row is read, rewritten, or deleted.
--
-- ACCESS MATRIX
--   beacon_reference_versions   anon: none  authenticated: none  service_role: ALL
--   beacon_value_references     anon: none  authenticated: none  service_role: ALL
--   activate_beacon_reference() EXECUTE service_role only; revoked from public,
--                               anon, authenticated. SECURITY DEFINER, search_path
--                               pinned to public.
-- Client writes are BLOCKED on both tables. Reference values are never editable
-- per player from the admin UI: a reference is built, validated, and activated as
-- one immutable version, or it is discarded.
--
-- WHY
-- The canonical-curve normalization in lib/beacon/normalize.ts indexes each
-- source by its within-source quantile, whose denominator is that source's own
-- pool size. A source that publishes 640 players and one that publishes 199
-- therefore assign different quantiles to players they agree about. The blended
-- FF Beacon value moves when a catalog lengthens or a source drops out for a
-- night, which is an artifact of the catalog rather than an opinion about the
-- player.
--
-- The calibrated method fits every source onto ONE STORED scale instead. The
-- scale is built once from the players every expected source ranks, then reused
-- across daily runs. A source disappearing changes which opinions are averaged
-- but not the scale they are averaged on.
--
-- VERSIONING AND ATOMICITY
-- A reference is written in two phases. The version row lands first as
-- 'candidate', then its player rows, then activate_beacon_reference() verifies
-- the persisted row count matches the declared count and only then flips it to
-- 'active'. A crash between the two phases leaves an inert candidate that no
-- calculation can ever load. The previous version is demoted to 'superseded' in
-- the same transaction and kept for rollback and audit.
--
-- One active version per format is enforced by a partial unique index. The
-- promote/demote pair runs inside one plpgsql function, so the index is never
-- transiently violated.

-- ---------------------------------------------------------------------------
-- Version header: one row per built reference, per format.
-- ---------------------------------------------------------------------------
create table if not exists public.beacon_reference_versions (
  id uuid primary key default gen_random_uuid(),
  format_config_id uuid not null references public.format_configs(id) on delete cascade,
  version integer not null,
  status text not null default 'candidate'
    check (status in ('candidate','active','superseded','failed')),

  generated_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,

  -- How many players the reference covers. activate_beacon_reference() refuses
  -- to promote a version whose persisted rows do not match this number.
  shared_player_count integer not null,
  -- The sources required to be present and fresh when this was built, so a later
  -- audit can tell whether the scale was built from a complete source set.
  expected_sources text[] not null default '{}'::text[],
  -- Per-source pool sizes, P99s, and the build settings. Audit only.
  diagnostics jsonb not null default '{}'::jsonb,

  notes text,
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists idx_beacon_reference_versions_format_version
  on public.beacon_reference_versions (format_config_id, version);

-- One active reference per format. Partial, so any number of candidates,
-- superseded, and failed versions can coexist for audit.
create unique index if not exists idx_beacon_reference_versions_one_active
  on public.beacon_reference_versions (format_config_id)
  where status = 'active';

create index if not exists idx_beacon_reference_versions_recent
  on public.beacon_reference_versions (format_config_id, generated_at desc);

alter table public.beacon_reference_versions enable row level security;

drop policy if exists beacon_reference_versions_service_role_all
  on public.beacon_reference_versions;
create policy beacon_reference_versions_service_role_all
  on public.beacon_reference_versions
  for all to service_role using (true) with check (true);

comment on table public.beacon_reference_versions is
  'One row per built FF Beacon calibration reference, per format. status candidate -> active -> superseded. Exactly one active per format (partial unique index). Promoted only via activate_beacon_reference(), which verifies the persisted row count first.';

-- ---------------------------------------------------------------------------
-- The reference itself: one scaled value per player per version.
-- ---------------------------------------------------------------------------
create table if not exists public.beacon_value_references (
  version_id uuid not null
    references public.beacon_reference_versions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  -- Consensus position on the shared 0..1 scale. 1 = the top player in the
  -- shared set at build time.
  reference_scaled numeric not null check (reference_scaled >= 0 and reference_scaled <= 1),
  primary key (version_id, player_id)
);

-- The PK already indexes version_id first, which is the only access pattern:
-- "load every reference player for this version". No second index needed.

alter table public.beacon_value_references enable row level security;

drop policy if exists beacon_value_references_service_role_all
  on public.beacon_value_references;
create policy beacon_value_references_service_role_all
  on public.beacon_value_references
  for all to service_role using (true) with check (true);

comment on table public.beacon_value_references is
  'Per-player consensus position (0..1) for one calibration reference version. Immutable once its version is activated; a change means a new version, never an edit.';

-- ---------------------------------------------------------------------------
-- Atomic activation. Also the rollback path: a superseded version can be made
-- active again, which is why the accepted statuses include it.
-- ---------------------------------------------------------------------------
create or replace function public.activate_beacon_reference(
  p_version_id uuid,
  p_min_shared integer default 100
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format uuid;
  v_status text;
  v_declared integer;
  v_actual integer;
begin
  select format_config_id, status, shared_player_count
    into v_format, v_status, v_declared
    from public.beacon_reference_versions
   where id = p_version_id;

  if v_format is null then
    raise exception 'Reference version % does not exist', p_version_id;
  end if;

  -- Idempotent: re-activating the live version is a no-op, not an error.
  if v_status = 'active' then
    return;
  end if;

  if v_status not in ('candidate','superseded') then
    raise exception 'Reference version % has status %, which cannot be activated', p_version_id, v_status;
  end if;

  -- Completeness gate. A version whose rows were only partly written can never
  -- reach 'active', which is the whole point of the two-phase write.
  select count(*) into v_actual
    from public.beacon_value_references
   where version_id = p_version_id;

  if v_actual <> v_declared then
    raise exception 'Reference version % is incomplete: % rows persisted, % declared', p_version_id, v_actual, v_declared;
  end if;

  if v_actual < p_min_shared then
    raise exception 'Reference version % covers only % players, minimum is %', p_version_id, v_actual, p_min_shared;
  end if;

  -- Demote first, then promote. Both statements carry a WHERE clause: Supabase
  -- preloads the safeupdate extension on the PostgREST connection role, which
  -- rejects an unqualified UPDATE outright even inside SECURITY DEFINER (see
  -- migration 0159). Running them in this order also means the one-active
  -- partial unique index is never transiently violated.
  update public.beacon_reference_versions
     set status = 'superseded', superseded_at = now()
   where format_config_id = v_format
     and status = 'active'
     and id <> p_version_id;

  update public.beacon_reference_versions
     set status = 'active', activated_at = now(), superseded_at = null
   where id = p_version_id;
end;
$$;

revoke all on function public.activate_beacon_reference(uuid, integer) from public;
revoke all on function public.activate_beacon_reference(uuid, integer) from anon;
revoke all on function public.activate_beacon_reference(uuid, integer) from authenticated;
grant execute on function public.activate_beacon_reference(uuid, integer) to service_role;

comment on function public.activate_beacon_reference(uuid, integer) is
  'Promote a candidate or superseded reference version to active, demoting the format''s current active version in the same transaction. Refuses any version whose persisted row count does not match its declared shared_player_count or falls below p_min_shared.';

-- ---------------------------------------------------------------------------
-- Settings. normalization_method stays 'quantile_median': this migration ships
-- the capability, it does not switch anything on. calibration_format_slugs is
-- the canary control and starts empty, so no format uses the new method.
-- ---------------------------------------------------------------------------
insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('calibration_format_slugs',      '""'::jsonb,  'string', 'calibration', 'Calibrated formats (canary list)',
   'Comma-separated format slugs that use calibrated normalization regardless of the method above. Leave empty for none. This is how a single format is switched over first: put one slug here, watch it, then widen. Clearing this box is the instant rollback.'),
  ('calibration_min_shared_players', '100'::jsonb, 'number', 'calibration', 'Minimum shared players',
   'A reference is only built from players every expected source ranks. Below this many shared players the build is refused and the previous reference stays live.'),
  ('calibration_grid_points',        '41'::jsonb,  'number', 'calibration', 'Quantile grid points',
   'How many points each source is sampled at when it is fitted onto the reference. 41 was the validated value; more points track the shape more closely and are noisier.'),
  ('calibration_rebuild_days',       '30'::jsonb,  'number', 'calibration', 'Rebuild the reference every (days)',
   'How old the active reference may get before the rebuild job replaces it. Measured drift at 28 days moved the average player by under 40 points out of 10000, with nobody moving 500.'),
  ('calibration_max_age_days',       '45'::jsonb,  'number', 'calibration', 'Alert when reference is older than (days)',
   'Grace period past the rebuild cadence. An active reference older than this raises an alert; it does not stop the engine.'),
  ('calibration_drift_mean_abs',     '100'::jsonb, 'number', 'calibration', 'Drift alert: mean move',
   'Alert when a rebuild would move the average player by more than this many points. Observed maximum across every tested reference age was 48.'),
  ('calibration_drift_player_max',   '500'::jsonb, 'number', 'calibration', 'Drift alert: single player move',
   'Alert when a rebuild would move any one player by this many points or more. Never observed at any tested reference age.'),
  ('calibration_drift_pct_250',      '0.02'::jsonb,'number', 'calibration', 'Drift alert: share moving 250+',
   'Alert when more than this fraction of the board would move 250 points or more on a rebuild. Observed maximum was 0.009.'),
  ('calibration_drift_min_spearman', '0.995'::jsonb,'number','calibration', 'Drift alert: minimum rank correlation',
   'Alert when a rebuild would drop the board order correlation below this. Observed minimum was 0.9988.')
on conflict (key) do nothing;

-- The method setting now has a second real option. Reword it so the admin page
-- describes what each one does rather than naming only the original.
update public.beacon_settings
   set description = 'How source values are aligned before blending. quantile_median = the original per-run canonical curve, where each source is indexed by its position within its own list. calibrated = each source is fitted onto a stored consensus reference, so a source lengthening its catalog or dropping out for a night no longer shifts the scale. This setting moves every format at once; the canary list below moves one at a time. Either way, calibrated needs an active reference for each affected format or the recompute stops with an error rather than guessing at a scale.',
       updated_at = now()
 where key = 'normalization_method';
